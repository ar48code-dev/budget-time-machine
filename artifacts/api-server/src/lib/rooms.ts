import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, or } from "drizzle-orm";
import { db, productionRoomInvites, productionRoomMembers, productionRooms, producerUsers } from "@workspace/db";
import type { ProducerUser } from "./auth";

export type RoomRole = "owner" | "editor" | "viewer" | "anonymous";
export type RoomAccess = {
  roomId: string;
  role: RoomRole;
  room: typeof productionRooms.$inferSelect;
};

const inviteHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export async function getRoom(roomId: string) {
  const [room] = await db
    .select()
    .from(productionRooms)
    .where(eq(productionRooms.roomId, roomId))
    .limit(1);
  return room ?? null;
}

export async function getRoomAccess(roomId: string, userId?: string): Promise<RoomAccess | null> {
  const room = await getRoom(roomId);
  if (!room) return null;
  if (!room.ownerUserId) return { roomId, role: "anonymous", room };
  if (!userId) return null;
  if (room.ownerUserId === userId) return { roomId, role: "owner", room };
  const [member] = await db
    .select()
    .from(productionRoomMembers)
    .where(
      and(
        eq(productionRoomMembers.roomId, roomId),
        eq(productionRoomMembers.userId, userId),
      ),
    )
    .limit(1);
  return member
    ? { roomId, role: member.role as RoomRole, room }
    : null;
}

export async function createOwnedRoom(user: ProducerUser, name = "Untitled production") {
  const roomId = `room_${randomUUID()}`;
  const [room] = await db
    .insert(productionRooms)
    .values({
      roomId,
      ownerUserId: user.userId,
      name: name.trim() || "Untitled production",
      visibility: "team",
      anonymous: false,
    })
    .returning();
  await db.insert(productionRoomMembers).values({
    roomId,
    userId: user.userId,
    role: "owner",
  });
  return room;
}

export async function listRooms(userId: string) {
  const rows = await db
    .select({
      room: productionRooms,
      role: productionRoomMembers.role,
    })
    .from(productionRooms)
    .leftJoin(
      productionRoomMembers,
      and(
        eq(productionRoomMembers.roomId, productionRooms.roomId),
        eq(productionRoomMembers.userId, userId),
      ),
    )
    .where(
      or(
        eq(productionRooms.ownerUserId, userId),
        eq(productionRoomMembers.userId, userId),
      ),
    )
    .orderBy(desc(productionRooms.updatedAt));
  return rows.map(({ room, role }) => ({
    roomId: room.roomId,
    name: room.name,
    role: room.ownerUserId === userId ? "owner" : (role as RoomRole),
    visibility: room.visibility,
    hasProduction: Boolean(room.graph),
    updatedAt: room.updatedAt,
  }));
}

export async function claimRoom(roomId: string, user: ProducerUser, name?: string) {
  const [room] = await db
    .update(productionRooms)
    .set({
      ownerUserId: user.userId,
      name: name?.trim() || undefined,
      visibility: "team",
      anonymous: false,
      updatedAt: new Date(),
    })
    .where(and(eq(productionRooms.roomId, roomId), eq(productionRooms.anonymous, true)))
    .returning();
  if (!room) return null;
  await db.insert(productionRoomMembers).values({
    roomId,
    userId: user.userId,
    role: "owner",
  });
  return room;
}

export async function createInvite(
  roomId: string,
  userId: string,
  email: string,
  role: "editor" | "viewer",
) {
  const token = randomBytes(24).toString("base64url");
  await db.insert(productionRoomInvites).values({
    inviteId: `invite_${randomUUID()}`,
    roomId,
    email,
    role,
    tokenHash: inviteHash(token),
    createdBy: userId,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  return token;
}

export async function acceptInvite(token: string, user: ProducerUser) {
  const [invite] = await db
    .select()
    .from(productionRoomInvites)
    .where(eq(productionRoomInvites.tokenHash, inviteHash(token)))
    .limit(1);
  if (
    !invite ||
    invite.acceptedAt ||
    invite.expiresAt <= new Date() ||
    invite.email !== user.email
  ) {
    return null;
  }
  await db
    .insert(productionRoomMembers)
    .values({ roomId: invite.roomId, userId: user.userId, role: invite.role })
    .onConflictDoUpdate({
      target: [productionRoomMembers.roomId, productionRoomMembers.userId],
      set: { role: invite.role },
    });
  const [accepted] = await db
    .update(productionRoomInvites)
    .set({ acceptedAt: new Date() })
    .where(eq(productionRoomInvites.inviteId, invite.inviteId))
    .returning();
  return accepted;
}

export async function listMembers(roomId: string) {
  return db
    .select({
      userId: producerUsers.userId,
      email: producerUsers.email,
      displayName: producerUsers.displayName,
      role: productionRoomMembers.role,
    })
    .from(productionRoomMembers)
    .innerJoin(producerUsers, eq(producerUsers.userId, productionRoomMembers.userId))
    .where(eq(productionRoomMembers.roomId, roomId));
}