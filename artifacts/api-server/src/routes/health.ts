import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({
    status: "ok",
    geminiConfigured: Boolean(
      process.env.GOOGLE_CLOUD_PROJECT &&
        process.env.GOOGLE_CLOUD_LOCATION &&
        process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON,
    ),
  });
  res.json(data);
});

export default router;
