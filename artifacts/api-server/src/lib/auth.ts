import { randomBytes, randomUUID, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt } from "drizzle-orm";
import { db, producerSessions, producerUsers } from "@workspace/db";
import type { Request, Response } from "express";

const scrypt = promisify(nodeScrypt);
const sessionCookie = "the_line_session";
const sessionDays = 30;
const sessionPepper = process.env.SESSION_SECRET ?? "development-only-session-pepper";

export type ProducerUser = {
  userId: string;
  email: string;
  displayName: string;
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

async function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string) {
  const [salt, encoded] = stored.split(":");
  if (!salt || !encoded) return false;
  const expected = Buffer.from(encoded, "hex");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function publicUser(user: typeof producerUsers.$inferSelect): ProducerUser {
  return { userId: user.userId, email: user.email, displayName: user.displayName };
}

export async function registerProducer(
  email: string,
  password: string,
  displayName: string,
) {
  const normalizedEmail = normalizeEmail(email);
  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(producerUsers)
    .values({
      userId: `producer_${randomUUID()}`,
      email: normalizedEmail,
      displayName: displayName.trim(),
      passwordHash,
    })
    .returning();
  return publicUser(user);
}

export async function authenticateProducer(email: string, password: string) {
  const [user] = await db
    .select()
    .from(producerUsers)
    .where(eq(producerUsers.email, normalizeEmail(email)))
    .limit(1);
  if (!user || !(await verifyPassword(password, user.passwordHash))) return null;
  return publicUser(user);
}

export async function startSession(userId: string, res: Response) {
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = (await scrypt(rawToken, sessionPepper, 32) as Buffer).toString("hex");
  const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000);
  await db.insert(producerSessions).values({
    sessionId: `session_${randomUUID()}`,
    userId,
    tokenHash,
    expiresAt,
  });
  res.cookie(sessionCookie, rawToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: sessionDays * 24 * 60 * 60 * 1000,
  });
}

export async function getAuthenticatedProducer(req: Request) {
  const rawToken = req.cookies?.[sessionCookie];
  if (!rawToken) return null;
  const tokenHash = (await scrypt(rawToken, sessionPepper, 32) as Buffer).toString("hex");
  const [row] = await db
    .select({ user: producerUsers })
    .from(producerSessions)
    .innerJoin(producerUsers, eq(producerUsers.userId, producerSessions.userId))
    .where(
      and(
        eq(producerSessions.tokenHash, tokenHash),
        gt(producerSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row?.user ? publicUser(row.user) : null;
}

export async function endSession(req: Request, res: Response) {
  const rawToken = req.cookies?.[sessionCookie];
  if (rawToken) {
    const tokenHash = (await scrypt(rawToken, sessionPepper, 32) as Buffer).toString("hex");
    await db.delete(producerSessions).where(eq(producerSessions.tokenHash, tokenHash));
  }
  res.clearCookie(sessionCookie);
}

export { normalizeEmail };