import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { db, productionRooms } from "@workspace/db";
import { getAuthenticatedProducer } from "../lib/auth";
import {
  acceptInvite,
  claimRoom,
  createInvite,
  createOwnedRoom,
  getRoomAccess,
  listMembers,
  listRooms,
} from "../lib/rooms";

const router: IRouter = Router();
const requireUser = async (req: Request, res: Response) => {
  const user = await getAuthenticatedProducer(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to manage production rooms." });
    return null;
  }
  return user;
};

router.get("/room-context", async (req, res): Promise<void> => {
  const requested = req.get("x-production-room") || req.cookies?.the_line_room;
  const roomId = requested && /^[a-zA-Z0-9_-]{8,64}$/.test(requested)
    ? requested
    : `room_${randomUUID()}`;
  let room = await getRoomAccess(roomId);
  if (!room) {
    const [created] = await db
      .insert(productionRooms)
      .values({ roomId, anonymous: true, visibility: "private" })
      .returning();
    room = { roomId, role: "anonymous", room: created };
  }
  const user = await getAuthenticatedProducer(req);
  const access = user
    ? await getRoomAccess(roomId, user.userId)
    : room.room.ownerUserId
      ? null
      : room;
  if (!access) {
    res.status(403).json({ error: "You are not a member of this room." });
    return;
  }
  res.cookie("the_line_room", roomId, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 365,
  });
  res.json({
    room: {
      roomId: access.room.roomId,
      name: access.room.name,
      role: access.role,
      visibility: access.room.visibility,
      anonymous: access.room.anonymous,
    },
    user,
  });
});

router.get("/rooms", async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  res.json({ rooms: await listRooms(user.userId) });
});

router.post("/rooms", async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!req.body || typeof req.body.name !== "string" ||
      req.body.name.trim().length < 1 || req.body.name.trim().length > 120) {
    res.status(400).json({ error: "A production name is required." });
    return;
  }
  res.status(201).json({ room: await createOwnedRoom(user, req.body.name) });
});

router.post("/rooms/:roomId/claim", async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  const roomId = String(req.params.roomId);
  if (req.body?.name != null &&
      (typeof req.body.name !== "string" || req.body.name.trim().length > 120)) {
    res.status(400).json({ error: "The production name is invalid." });
    return;
  }
  const room = await claimRoom(roomId, user, req.body?.name);
  if (!room) {
    res.status(409).json({ error: "This room is already claimed or no longer exists." });
    return;
  }
  res.json({ room });
});

router.post("/rooms/:roomId/invites", async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  const roomId = String(req.params.roomId);
  const access = await getRoomAccess(roomId, user.userId);
  if (!access || !["owner", "editor"].includes(access.role)) {
    res.status(403).json({ error: "Only room owners and editors can invite collaborators." });
    return;
  }
  if (!req.body || typeof req.body.email !== "string" ||
      !req.body.email.includes("@") || req.body.email.length > 255 ||
      (req.body.role != null && req.body.role !== "editor" && req.body.role !== "viewer")) {
    res.status(400).json({ error: "Use a valid collaborator email and role." });
    return;
  }
  const token = await createInvite(
    roomId,
    user.userId,
    req.body.email.trim().toLowerCase(),
    req.body.role ?? "editor",
  );
  res.status(201).json({ token, expiresInDays: 7 });
});

router.post("/room-invites/:token/accept", async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  const accepted = await acceptInvite(String(req.params.token), user);
  if (!accepted) {
    res.status(400).json({ error: "This invite is invalid, expired, already used, or belongs to another email." });
    return;
  }
  res.json({ roomId: accepted.roomId });
});

router.get("/rooms/:roomId/members", async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  const roomId = String(req.params.roomId);
  const access = await getRoomAccess(roomId, user.userId);
  if (!access) {
    res.status(403).json({ error: "You are not a member of this room." });
    return;
  }
  res.json({ members: await listMembers(roomId) });
});

export default router;