import { Router, type IRouter, type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { ZipArchive } from "archiver";
import { db, productionRooms } from "@workspace/db";
import {
  ApplyChangeBody,
  IngestProductionTextBody,
  SimulateChangeBody,
  SaveScenarioBody,
} from "@workspace/api-zod";
import { getDemoProduction } from "../lib/demoData";
import {
  addDecision,
  commitSimulation,
  deleteScenario,
  ensureRoom,
  getDecisionLog,
  getGraph,
  getPending,
  getScenario,
  getScenarios,
  getAppliedChanges,
  listScenarios,
  loadScenario,
  resetState,
  saveScenario,
  setGraph,
  stageSimulation,
  persistRoom,
  type ProductionGraph,
} from "../lib/production";
import {
  advise,
  computeImpact,
  generatePlan,
  ingestProductionDocument,
  simulateCascade,
  newChange,
} from "../lib/agents";
import { generateText } from "../lib/gemini";
import { getAuthenticatedProducer } from "../lib/auth";
import { getRoom, getRoomAccess } from "../lib/rooms";

const router: IRouter = Router();
const rateWindowMs = 60_000;
const rateLimitMax = 20;
const rateBuckets = new Map<string, { startedAt: number; count: number }>();
const roomCookie = "the_line_room";
const roomPattern = /^[a-zA-Z0-9_-]{8,64}$/;

async function getRoomId(
  req: Parameters<RequestHandler>[0],
  res: Parameters<RequestHandler>[1],
  write = false,
): Promise<string | null> {
  const user = await getAuthenticatedProducer(req);
  const requested = req.get("x-production-room") || String(req.query.roomId || "") || req.cookies?.[roomCookie];
  const roomId = requested && roomPattern.test(requested) ? requested : `room_${randomUUID()}`;
  let room = await getRoom(roomId);
  if (!room) {
    const [created] = await db
      .insert(productionRooms)
      .values({ roomId, anonymous: true, visibility: "private" })
      .returning();
    room = created;
  }
  const access = await getRoomAccess(roomId, user?.userId);
  if (!access) {
    res.status(user ? 403 : 401).json({
      error: user
        ? "You are not a member of this production room."
        : "Sign in or use the room's private browser to access it.",
    });
    return null;
  }
  if (write && access.role === "viewer") {
    res.status(403).json({ error: "Your room role is read-only." });
    return null;
  }
  if (req.cookies?.[roomCookie] !== roomId) {
    res.cookie(roomCookie, roomId, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 365,
    });
  }
  return roomId;
}

const expensiveRateLimit: RequestHandler = (req, res, next) => {
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= rateWindowMs) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return next();
  }
  bucket.count += 1;
  if (bucket.count > rateLimitMax) {
    return res.status(429).json({ error: "Too many agent requests. Please wait a minute and try again." });
  }
  return next();
};

router.get("/sample", async (req, res) => {
  try {
    const roomId = await getRoomId(req, res, true);
    if (!roomId) return;
    await resetState(roomId);
    const graph = setGraph(roomId, getDemoProduction());
    addDecision(roomId, "Ingestion & Graph Agent", { source: "demo_seed" }, {
      productionName: graph.productionName,
      dayCount: graph.days.length,
    });
    await persistRoom(roomId);
    res.json({ productionName: graph.productionName, graph });
  } catch (err) {
    req.log.error({ err }, "sample production failed");
    res.status(500).json({ error: "Could not load the sample production." });
  }
});

router.get("/graph", async (req, res) => {
  const roomId = await getRoomId(req, res);
  if (!roomId) return;
  await ensureRoom(roomId);
  const graph = getGraph(roomId);
  if (!graph) return res.status(404).json({ error: "No production loaded yet." });
  return res.json(graph);
});

router.post("/ingest", expensiveRateLimit, async (req, res) => {
  try {
    const roomId = await getRoomId(req, res, true);
    if (!roomId) return;
    await ensureRoom(roomId);
    const parsed = IngestProductionTextBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "The ingestion payload is invalid." });
    }
    const body = parsed.data;
    const text = body.text?.trim() || null;
    const fileData = body.fileData?.trim() || null;
    const mimeType = body.mimeType?.trim().toLowerCase() || null;
    if (!text && !fileData) {
      return res.status(400).json({ error: "Provide document text or a PDF/image file." });
    }
    if (fileData && !mimeType) {
      return res.status(400).json({ error: "A MIME type is required for an uploaded file." });
    }
    const allowedInlineTypes = new Set([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
    ]);
    if (fileData && mimeType && !allowedInlineTypes.has(mimeType)) {
      return res.status(400).json({ error: "Only PDF, JPEG, PNG, WebP, and GIF files can be read as multimodal input." });
    }
    const graph = await ingestProductionDocument({
      text,
      inlineData: fileData && mimeType ? { data: fileData, mimeType } : undefined,
    });
    setGraph(roomId, graph);
    addDecision(roomId, "Ingestion & Graph Agent", {
      source: body.filename || "pasted_schedule",
      inputMode: fileData ? "multimodal_inline_data" : "text",
      mimeType,
      characterCount: text?.length || 0,
    }, { productionName: graph.productionName, dayCount: graph.days.length });
    await persistRoom(roomId);
    return res.json({ productionName: graph.productionName, graph });
  } catch (err) {
    req.log.error({ err }, "ingestion failed");
    return res.status(500).json({ error: err instanceof Error ? err.message : "Ingestion failed." });
  }
});

router.post("/simulate", expensiveRateLimit, async (req, res) => {
  try {
    const roomId = await getRoomId(req, res, true);
    if (!roomId) return;
    await ensureRoom(roomId);
    const body = SimulateChangeBody.parse(req.body);
    const graph = getGraph(roomId);
    if (!graph) return res.status(404).json({ error: "Load a production before simulating." });
    const change = newChange(body.dayId, body.changeType, body.details || {});
    const cascade = await simulateCascade(graph, change);
    addDecision(roomId, "Simulation Agent", change as unknown as Record<string, unknown>, cascade as unknown as Record<string, unknown>);
    const impact = await computeImpact(graph, change, cascade);
    addDecision(roomId, "Impact Agent", { change, cascade }, impact as unknown as Record<string, unknown>);
    const result = stageSimulation(roomId, { changeId: change.changeId, change, cascade, impact });
    await persistRoom(roomId);
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, "simulation failed");
    return res.status(500).json({ error: err instanceof Error ? err.message : "Simulation failed." });
  }
});

router.post("/apply", expensiveRateLimit, async (req, res) => {
  try {
    const roomId = await getRoomId(req, res, true);
    if (!roomId) return;
    await ensureRoom(roomId);
    const body = ApplyChangeBody.parse(req.body);
    const pending = getPending(roomId, body.changeId);
    const graph = getGraph(roomId);
    if (!pending || !graph) return res.status(404).json({ error: "That simulation is no longer available." });
    const { cascade, impact, change } = pending;
    const plan = await generatePlan(graph, change, cascade, impact, body.confirmed);
    addDecision(roomId, "Plan Agent", { changeId: body.changeId, confirmed: body.confirmed }, {
      revisedScheduleSummary: plan.revisedScheduleSummary,
      purchaseOrderDeltas: plan.purchaseOrderDeltas,
      producerMemo: plan.producerMemo,
    });
    const updatedGraph = commitSimulation(roomId, body.changeId, {
      revisedScheduleSummary: plan.revisedScheduleSummary,
      purchaseOrderDeltas: plan.purchaseOrderDeltas,
      producerMemo: plan.producerMemo,
    }, plan.updatedGraph);
    await persistRoom(roomId);
    return res.json({
      graph: updatedGraph,
      revisedScheduleSummary: plan.revisedScheduleSummary,
      purchaseOrderDeltas: plan.purchaseOrderDeltas,
      producerMemo: plan.producerMemo,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "ConfirmationRequiredError") {
      return res.status(403).json({ error: err.message });
    }
    req.log.error({ err }, "apply failed");
    return res.status(500).json({ error: err instanceof Error ? err.message : "Apply failed." });
  }
});

router.get("/advisor", expensiveRateLimit, async (req, res) => {
  try {
    const roomId = await getRoomId(req, res, true);
    if (!roomId) return;
    await ensureRoom(roomId);
    const graph = getGraph(roomId);
    if (!graph) return res.status(404).json({ error: "Load a production before asking the advisor." });
    const result = await advise(graph);
    addDecision(roomId, "Advisor Agent", { productionName: graph.productionName }, result as unknown as Record<string, unknown>);
    await persistRoom(roomId);
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, "advisor failed");
    return res.status(500).json({ error: err instanceof Error ? err.message : "Advisor failed." });
  }
});

router.get("/decision-log", async (req, res) => {
  const roomId = await getRoomId(req, res);
  if (!roomId) return;
  await ensureRoom(roomId);
  res.json(getDecisionLog(roomId));
});

router.get("/scenarios", async (req, res) => {
  const roomId = await getRoomId(req, res);
  if (!roomId) return;
  await ensureRoom(roomId);
  res.json(listScenarios(roomId));
});

router.post("/scenarios", async (req, res) => {
  try {
    const roomId = await getRoomId(req, res, true);
    if (!roomId) return;
    await ensureRoom(roomId);
    const body = SaveScenarioBody.parse(req.body);
    const scenario = saveScenario(roomId, body.name);
    if (!scenario) return res.status(404).json({ error: "Load a production before saving a scenario." });
    addDecision(roomId, "Scenario Library", { action: "save", name: scenario.name }, { id: scenario.id });
    await persistRoom(roomId);
    return res.status(201).json(scenario);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Invalid scenario." });
  }
});

router.post("/scenarios/:id/load", async (req, res) => {
  const roomId = await getRoomId(req, res, true);
  if (!roomId) return;
  await ensureRoom(roomId);
  const graph = loadScenario(roomId, req.params.id);
  if (!graph) return res.status(404).json({ error: "Scenario not found." });
  addDecision(roomId, "Scenario Library", { action: "load", id: req.params.id }, { productionName: graph.productionName });
  await persistRoom(roomId);
  return res.json(graph);
});

router.delete("/scenarios/:id", async (req, res) => {
  const roomId = await getRoomId(req, res, true);
  if (!roomId) return;
  await ensureRoom(roomId);
  const deleted = deleteScenario(roomId, req.params.id);
  if (!deleted) return res.status(404).json({ error: "Scenario not found." });
  await persistRoom(roomId);
  return res.json({ deleted: true });
});

router.get("/scenarios/compare", expensiveRateLimit, async (req, res) => {
  const roomId = await getRoomId(req, res, true);
  if (!roomId) return;
  await ensureRoom(roomId);
  const a = String(req.query.a || "");
  const b = String(req.query.b || "");
  const scenarioA = getScenario(roomId, a);
  const scenarioB = getScenario(roomId, b);
  if (!a || !b) return res.status(400).json({ error: "Both scenario ids are required." });
  if (!scenarioA || !scenarioB) return res.status(404).json({ error: "One or both scenarios were not found." });

  const cost = (graph: ProductionGraph) => graph.days.reduce((sum, day) => sum + day.baseCost, 0);
  const diff = {
    scenarioAName: scenarioA.name,
    scenarioBName: scenarioB.name,
    dayCountA: scenarioA.graph.days.length,
    dayCountB: scenarioB.graph.days.length,
    dayCountDelta: scenarioB.graph.days.length - scenarioA.graph.days.length,
    totalScheduledCostA: cost(scenarioA.graph),
    totalScheduledCostB: cost(scenarioB.graph),
    costDelta: cost(scenarioB.graph) - cost(scenarioA.graph),
    remainingA: scenarioA.graph.budgetSummary.remaining,
    remainingB: scenarioB.graph.budgetSummary.remaining,
    remainingDelta:
      (scenarioB.graph.budgetSummary.remaining || 0) -
      (scenarioA.graph.budgetSummary.remaining || 0),
  };
  try {
    const summary = await generateText({
      systemInstruction: "You are a line producer comparing two film scenarios. Write 2-4 concise sentences using only the exact numbers provided. No headings.",
      prompt: JSON.stringify(diff),
    });
    addDecision(roomId, "Comparison Agent", { a, b }, { diff, summary: summary.trim() });
    await persistRoom(roomId);
    return res.json({ diff, summary: summary.trim() });
  } catch (err) {
    req.log.error({ err }, "comparison failed");
    return res.status(500).json({ error: err instanceof Error ? err.message : "Comparison failed." });
  }
});

router.get("/export", async (req, res) => {
  const roomId = await getRoomId(req, res);
  if (!roomId) return;
  await ensureRoom(roomId);
  const graph = getGraph(roomId);
  if (!graph) return res.status(404).json({ error: "Load a production before exporting." });
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const safeName = graph.productionName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  res.attachment(`${safeName || "production"}-control-room-pack.zip`);
  archive.on("error", (err: unknown) => {
    req.log.error({ err }, "export failed");
    if (!res.headersSent) res.status(500).json({ error: "Export failed." });
  });
  archive.pipe(res);
  archive.append(JSON.stringify(graph, null, 2), { name: "active-production-graph.json" });
  archive.append(JSON.stringify(getDecisionLog(roomId), null, 2), { name: "decision-log.json" });
  archive.append(JSON.stringify(getAppliedChanges(roomId), null, 2), { name: "applied-plans.json" });
  archive.append(JSON.stringify(getScenarios(roomId), null, 2), { name: "scenarios.json" });
  archive.append(
    [
      `# ${graph.productionName} — Control Room Export`,
      "",
      `- Shoot days: ${graph.days.length}`,
      `- Remaining budget: ${graph.budgetSummary.remaining ?? "unknown"} ${graph.budgetSummary.currency}`,
      "",
      "The JSON files in this pack contain the active graph and the agent decision trail.",
    ].join("\n"),
    { name: "README.md" },
  );
  void archive.finalize();
  return undefined;
});

router.post("/reset", async (req, res) => {
  const roomId = await getRoomId(req, res, true);
  if (!roomId) return;
  await resetState(roomId);
  res.json({ ok: true });
});

export default router;