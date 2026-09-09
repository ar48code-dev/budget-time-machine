import { Router, type IRouter } from "express";
import {
  authenticateProducer,
  endSession,
  getAuthenticatedProducer,
  registerProducer,
  startSession,
} from "../lib/auth";

const router: IRouter = Router();
const isEmail = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length <= 255 && value.includes("@");
const credentials = (value: unknown): value is { email: string; password: string } => {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return isEmail(body.email) && typeof body.password === "string" &&
    body.password.length >= 8 && body.password.length <= 200;
};

router.get("/auth/me", async (req, res): Promise<void> => {
  const user = await getAuthenticatedProducer(req);
  res.json({ user });
});

router.post("/auth/signup", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const displayName = typeof body.displayName === "string" ? body.displayName : "";
  if (!credentials(body) || displayName.trim().length < 1 || displayName.trim().length > 80) {
    res.status(400).json({ error: "Use a valid name, email, and password of at least 8 characters." });
    return;
  }
  try {
    const signup = body as { email: string; password: string };
    const user = await registerProducer(signup.email, signup.password, displayName);
    await startSession(user.userId, res);
    res.status(201).json({ user });
  } catch (error) {
    if (String(error).includes("producer_users_email_unique")) {
      res.status(409).json({ error: "An account with that email already exists." });
      return;
    }
    throw error;
  }
});

router.post("/auth/signin", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!credentials(body)) {
    res.status(400).json({ error: "Use a valid email and password." });
    return;
  }
  const signin = body as { email: string; password: string };
  const user = await authenticateProducer(signin.email, signin.password);
  if (!user) {
    res.status(401).json({ error: "Email or password is incorrect." });
    return;
  }
  await startSession(user.userId, res);
  res.json({ user });
});

router.post("/auth/signout", async (req, res): Promise<void> => {
  await endSession(req, res);
  res.status(204).send();
});

export default router;