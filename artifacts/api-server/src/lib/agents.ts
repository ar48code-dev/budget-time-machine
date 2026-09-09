import { randomUUID } from "node:crypto";
import { generateJson, generateText } from "./gemini";
import type {
  Cascade,
  Change,
  Impact,
  ProductionGraph,
  ShootDay,
} from "./production";

const RATE_CARD = {
  nightPremiumPct: 12,
  turnaroundPenalty: 4800,
  companyMoveCost: 2600,
  dayForNightSavingsPct: 10,
  dayForNightEquipmentCost: 1800,
  castKillFeePct: 15,
};

const INGESTION_SYSTEM =
  "You are the Ingestion & Graph Agent for a film production budgeting tool. Read a raw production schedule and/or budget document and extract a precise, structured JSON representation. You must not invent scenes, cast, or costs that are not supported by the document — if a field is genuinely not present, use null rather than guessing. Identify dependencies between days: two days share a dependency if they use the same location, the same cast member, or the same major equipment.";

const INGESTION_SPEC = `{
  "productionName": string,
  "days": [{
    "id": string, "date": "YYYY-MM-DD"|null, "type": "day"|"night",
    "scenes": string[], "location": string, "cast": string[],
    "crewSize": number, "baseCost": number, "callTime": string|null,
    "wrapTime": string|null, "dependencies": string[]
  }],
  "budgetSummary": {
    "totalBudget": number|null, "spentToDate": number|null,
    "remaining": number|null, "contingencyPct": number|null, "currency": "USD"
  }
}`;

function normalizeGraph(raw: Partial<ProductionGraph>): ProductionGraph {
  const days = Array.isArray(raw.days) ? raw.days : [];
  return {
    productionName: raw.productionName || "Untitled Production",
    days: days.map((day, index) => ({
      id: day.id || `day_${String(index + 1).padStart(2, "0")}`,
      date: day.date ?? null,
      type: day.type === "night" ? "night" : "day",
      scenes: Array.isArray(day.scenes) ? day.scenes : [],
      location: day.location || "Unspecified location",
      cast: Array.isArray(day.cast) ? day.cast : [],
      crewSize: Number(day.crewSize) || 0,
      baseCost: Number(day.baseCost) || 0,
      callTime: day.callTime ?? null,
      wrapTime: day.wrapTime ?? null,
      dependencies: Array.isArray(day.dependencies) ? day.dependencies : [],
    })),
    budgetSummary: {
      totalBudget: raw.budgetSummary?.totalBudget ?? null,
      spentToDate: raw.budgetSummary?.spentToDate ?? null,
      remaining: raw.budgetSummary?.remaining ?? null,
      contingencyPct: raw.budgetSummary?.contingencyPct ?? null,
      currency: raw.budgetSummary?.currency || "USD",
    },
  };
}

export async function ingestProductionDocument({
  text,
  inlineData,
}: {
  text?: string | null;
  inlineData?: { mimeType: string; data: string };
}) {
  const result = await generateJson<Partial<ProductionGraph>>({
    systemInstruction: INGESTION_SYSTEM,
    prompt: `Read the supplied production document and return exactly this JSON shape:
${INGESTION_SPEC}

Do not add commentary or markdown. Preserve the existing graph shape. Use the uploaded
document as the source of truth.${text?.trim() ? `\n\nADDITIONAL TEXT OR DOCUMENT CONTENT:\n${text}` : ""}`,
    inlineData,
  });
  return normalizeGraph(result);
}

export async function simulateCascade(
  graph: ProductionGraph,
  change: Change,
): Promise<Cascade> {
  const result = await generateJson<Cascade>({
    systemInstruction: `You are the Simulation Agent for a film production budget simulator.
Given a production graph and one proposed change, identify only other days affected by shared
locations, cast, equipment, or explicit dependencies. Do not calculate money.`,
    prompt: `CURRENT GRAPH:
${JSON.stringify(graph)}

PROPOSED CHANGE:
${JSON.stringify(change)}

Return exactly:
{"affectedDays":[{"dayId":"string","reason":"one sentence","severity":"low|medium|high"}],"summary":"one or two sentences"}`,
  });
  return {
    affectedDays: Array.isArray(result.affectedDays) ? result.affectedDays : [],
    summary: result.summary || "No cascading effects identified.",
  };
}

function deterministicImpact(
  graph: ProductionGraph,
  change: Change,
  rules: Impact["appliedRules"],
) {
  const day = graph.days.find((entry) => entry.id === change.dayId);
  const baseCost = day?.baseCost || 0;
  let costDelta = 0;
  let daysDelta = 0;
  const riskFlags: string[] = [];
  const breakdown: Impact["breakdown"] = [];

  if (change.changeType === "cut_scene" || change.changeType === "cut_cast_day") {
    const amount = -Math.round(baseCost * 0.2);
    costDelta += amount;
    breakdown.push({ label: "Reduced scope on day", amount });
  }
  if (change.changeType === "cut_location") {
    costDelta -= baseCost;
    daysDelta = -1;
    breakdown.push({ label: "Location and shoot day removed", amount: -baseCost });
  }
  if (change.changeType === "convert_to_day_for_night") {
    const savings = -Math.round(baseCost * (RATE_CARD.dayForNightSavingsPct / 100));
    costDelta += savings + RATE_CARD.dayForNightEquipmentCost;
    breakdown.push({ label: "Night premium removed", amount: savings });
    breakdown.push({
      label: "Day-for-night equipment and color timing",
      amount: RATE_CARD.dayForNightEquipmentCost,
    });
  }

  for (const rule of rules) {
    if (rule.rule === "nightPremium") {
      const amount = Math.round(baseCost * (RATE_CARD.nightPremiumPct / 100));
      costDelta += amount;
      breakdown.push({ label: "Night premium", amount });
    }
    if (rule.rule === "companyMoveCost") {
      costDelta += RATE_CARD.companyMoveCost;
      breakdown.push({ label: "Unplanned company move", amount: RATE_CARD.companyMoveCost });
    }
    if (rule.rule === "turnaroundPenalty") {
      costDelta += RATE_CARD.turnaroundPenalty;
      riskFlags.push("Turnaround risk: less than 10 hours between calls");
      breakdown.push({ label: "Turnaround penalty", amount: RATE_CARD.turnaroundPenalty });
    }
    if (rule.rule === "castDayRate") {
      const amount = Math.round(baseCost * (RATE_CARD.castKillFeePct / 100));
      costDelta += amount;
      riskFlags.push("Review cast minimum-guarantee language before locking.");
      breakdown.push({ label: "Possible cast kill fee", amount });
    }
  }

  return {
    costDelta,
    daysDelta,
    riskFlags,
    breakdown,
    projectedRemaining: (graph.budgetSummary.remaining || 0) - costDelta,
    overBudget: (graph.budgetSummary.remaining || 0) - costDelta < 0,
  };
}

export async function computeImpact(
  graph: ProductionGraph,
  change: Change,
  cascade: Cascade,
): Promise<Impact> {
  const result = await generateJson<{
    applicableRules?: Impact["appliedRules"];
  }>({
    systemInstruction: `You are the Impact Agent. Match the schedule change to the provided
rate-card rules. Return only the rule ids that genuinely apply. Never calculate money.`,
    prompt: `RATE CARD:
${JSON.stringify(RATE_CARD)}

GRAPH:
${JSON.stringify(graph)}

CHANGE:
${JSON.stringify(change)}

CASCADE:
${JSON.stringify(cascade)}

Return {"applicableRules":[{"rule":"nightPremium|turnaroundPenalty|companyMoveCost|castDayRate","justification":"string","estimatedHoursOver":null,"estimatedHoursBetweenShoots":null}]}`,
  });
  const rules = Array.isArray(result.applicableRules) ? result.applicableRules : [];
  return {
    appliedRules: rules,
    ...deterministicImpact(graph, change, rules),
  };
}

function applyChange(graph: ProductionGraph, change: Change, impact: Impact) {
  const updated = JSON.parse(JSON.stringify(graph)) as ProductionGraph;
  const index = updated.days.findIndex((day) => day.id === change.dayId);
  if (index < 0) return updated;
  const day = updated.days[index];

  if (change.changeType === "cut_location") {
    updated.days.splice(index, 1);
  } else if (
    change.changeType === "cut_scene" &&
    change.details.sceneToCut
  ) {
    day.scenes = day.scenes.filter((scene) => scene !== change.details.sceneToCut);
  } else if (
    change.changeType === "cut_cast_day" &&
    change.details.castMemberToCut
  ) {
    day.cast = day.cast.filter((cast) => cast !== change.details.castMemberToCut);
  } else if (
    change.changeType === "convert_to_day_for_night"
  ) {
    day.type = "day";
  } else if (change.changeType === "move_day" && change.details.newDate) {
    day.date = change.details.newDate;
  }

  const updatedDay = updated.days.find((entry) => entry.id === change.dayId);
  if (updatedDay) updatedDay.baseCost = Math.max(0, updatedDay.baseCost + impact.costDelta);
  updated.budgetSummary.remaining = impact.projectedRemaining;
  return updated;
}

export async function generatePlan(
  graph: ProductionGraph,
  change: Change,
  cascade: Cascade,
  impact: Impact,
  confirmed: boolean,
) {
  if (!confirmed) {
    const error = new Error("Plan Agent refused to run: explicit confirmation is required.");
    error.name = "ConfirmationRequiredError";
    throw error;
  }

  const schedule = await generateJson<{
    revisedScheduleSummary?: string;
    purchaseOrderDeltas?: Array<{
      vendor: string;
      description: string;
      amountDelta: number;
    }>;
  }>({
    systemInstruction: `You are the Plan Agent for a film production. Produce a concise revised
schedule summary and vendor purchase-order deltas from the confirmed change. Use only supplied numbers.`,
    prompt: `CHANGE: ${JSON.stringify(change)}
CASCADE: ${JSON.stringify(cascade)}
IMPACT: ${JSON.stringify(impact)}
Return {"revisedScheduleSummary":"markdown","purchaseOrderDeltas":[{"vendor":"string","description":"string","amountDelta":0}]}`,
  });
  const producerMemo = await generateText({
    systemInstruction: `You are a line producer drafting a short internal memo. Write 3-5
professional sentences explaining what changed, why, and the exact financial impact. No headings.`,
    prompt: `Change: ${JSON.stringify(change)}
Cost delta: ${impact.costDelta}
Days delta: ${impact.daysDelta}
Risk flags: ${impact.riskFlags.join("; ") || "none"}
Projected remaining budget: ${impact.projectedRemaining}`,
  });

  return {
    revisedScheduleSummary: schedule.revisedScheduleSummary || "Revised schedule generated.",
    purchaseOrderDeltas: Array.isArray(schedule.purchaseOrderDeltas)
      ? schedule.purchaseOrderDeltas
      : [],
    producerMemo: producerMemo.trim(),
    updatedGraph: applyChange(graph, change, impact),
  };
}

export async function advise(graph: ProductionGraph) {
  return generateJson<{
    headline: string;
    recommendations: Array<{
      rank: number;
      title: string;
      action: string;
      dayId: string;
      estimatedSavings: number;
      creativeRisk: "low" | "medium" | "high";
      rationale: string;
    }>;
  }>({
    systemInstruction: `You are the Advisor Agent for an independent film line producer.
Rank the highest-leverage budget interventions. Balance savings against creative damage.
Use exact day ids and conservative estimates from the graph. Return JSON only.`,
    prompt: `GRAPH:
${JSON.stringify(graph)}

Return {"headline":"one sentence","recommendations":[{"rank":1,"title":"short title","action":"specific intervention","dayId":"day_id","estimatedSavings":0,"creativeRisk":"low|medium|high","rationale":"plain English"}]} with 3 recommendations.`,
  });
}

export function newChange(
  dayId: string,
  changeType: Change["changeType"],
  details: Change["details"],
): Change {
  return { changeId: randomUUID().slice(0, 10), dayId, changeType, details };
}