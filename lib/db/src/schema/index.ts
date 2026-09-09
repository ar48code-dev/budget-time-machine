import {
  boolean,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const producerUsers = pgTable(
  "producer_users",
  {
    userId: text("user_id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    emailUnique: uniqueIndex("producer_users_email_unique").on(table.email),
  }),
);

export const producerSessions = pgTable(
  "producer_sessions",
  {
    sessionId: text("session_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => producerUsers.userId, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tokenUnique: uniqueIndex("producer_sessions_token_unique").on(
      table.tokenHash,
    ),
  }),
);

export const productionRooms = pgTable("production_rooms", {
  roomId: text("room_id").primaryKey(),
  ownerUserId: text("owner_user_id").references(() => producerUsers.userId, {
    onDelete: "set null",
  }),
  name: text("name").notNull().default("Untitled production"),
  visibility: text("visibility").notNull().default("private"),
  anonymous: boolean("anonymous").notNull().default(true),
  graph: jsonb("graph"),
  decisionLog: jsonb("decision_log").notNull().default([]),
  pending: jsonb("pending").notNull().default([]),
  applied: jsonb("applied").notNull().default([]),
  scenarios: jsonb("scenarios").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const productionRoomMembers = pgTable(
  "production_room_members",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => productionRooms.roomId, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => producerUsers.userId, { onDelete: "cascade" }),
    role: text("role").notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    roomMemberPk: primaryKey({ columns: [table.roomId, table.userId] }),
  }),
);

export const productionRoomInvites = pgTable(
  "production_room_invites",
  {
    inviteId: text("invite_id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => productionRooms.roomId, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull().default("editor"),
    tokenHash: text("token_hash").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => producerUsers.userId, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tokenUnique: uniqueIndex("production_room_invites_token_unique").on(
      table.tokenHash,
    ),
  }),
);