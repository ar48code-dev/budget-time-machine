import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, productionRooms } from "@workspace/db";

export type ShootDay = {
  id: string;
  date: string | null;
  type: "day" | "night";
  scenes: string[];
  location: string;
  cast: string[];
  crewSize: number;
  baseCost: number;
  callTime: string | null;
  wrapTime: string | null;
  dependencies: string[];
};

export type ProductionGraph = {
  productionName: string;
  days: ShootDay[];
  budgetSummary: {
    totalBudget: number | null;
    spentToDate: number | null;
    remaining: number | null;
    contingencyPct: number | null;
    currency: string;
  };
};

export type Change = {
  changeId: string;
  dayId: string;
  changeType:
    | "cut_scene"
    | "cut_cast_day"
    | "cut_location"
    | "convert_to_day_for_night"
    | "move_day";
  details: {
    sceneToCut?: string | null;
    castMemberToCut?: string | null;
    newDate?: string | null;
  };
};

export type Cascade = {
  affectedDays: Array<{
    dayId: string;
    reason: string;
    severity: "low" | "medium" | "high";
  }>;
  summary: string;
};

export type Impact = {
  appliedRules: Array<{
    rule: string;
    justification: string;
    estimatedHoursOver: number | null;
    estimatedHoursBetweenShoots: number | null;
  }>;
  costDelta: number;
  daysDelta: number;
  riskFlags: string[];
  breakdown: Array<{ label: string; amount: number }>;
  projectedRemaining: number;
  overBudget: boolean;
};

export type Simulation = {
  changeId: string;
  change: Change;
  cascade: Cascade;
  impact: Impact;
};

export type DecisionLogEntry = {
  id: string;
  agent: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  timestamp: string;
};

export type Scenario = {
  id: string;
  name: string;
  createdAt: string;
  graph: ProductionGraph;
};

export type AppliedChange = {
  changeId: string;
  change: Change;
  planOutput: {
    revisedScheduleSummary: string;
    purchaseOrderDeltas: Array<{
      vendor: string;
      description: string;
      amountDelta: number;
    }>;
    producerMemo: string;
  };
  appliedAt: string;
};

export type RoomState = {
  graph: ProductionGraph | null;
  decisionLog: DecisionLogEntry[];
  pending: Simulation[];
  applied: AppliedChange[];
  scenarios: Scenario[];
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const emptyState = (): RoomState => ({
  graph: null,
  decisionLog: [],
  pending: [],
  applied: [],
  scenarios: [],
});

const roomCache = new Map<string, RoomState>();
const roomLoads = new Map<string, Promise<RoomState>>();

const asArray = <T>(value: unknown): T[] =>
  Array.isArray(value) ? clone(value as T[]) : [];

export async function ensureRoom(roomId: string): Promise<RoomState> {
  const cached = roomCache.get(roomId);
  if (cached) return cached;
  const inFlight = roomLoads.get(roomId);
  if (inFlight) return inFlight;

  const load = (async () => {
    const [row] = await db
      .select()
      .from(productionRooms)
      .where(eq(productionRooms.roomId, roomId))
      .limit(1);
    const state: RoomState = row
      ? {
          graph: (row.graph as ProductionGraph | null) ?? null,
          decisionLog: asArray<DecisionLogEntry>(row.decisionLog),
          pending: asArray<Simulation>(row.pending),
          applied: asArray<AppliedChange>(row.applied),
          scenarios: asArray<Scenario>(row.scenarios),
        }
      : emptyState();
    roomCache.set(roomId, state);
    if (!row) await persistRoom(roomId);
    return state;
  })();

  roomLoads.set(roomId, load);
  try {
    return await load;
  } finally {
    roomLoads.delete(roomId);
  }
}

export async function persistRoom(roomId: string) {
  const state = roomCache.get(roomId);
  if (!state) return;
  await db
    .insert(productionRooms)
    .values({
      roomId,
      graph: state.graph,
      decisionLog: state.decisionLog,
      pending: state.pending,
      applied: state.applied,
      scenarios: state.scenarios,
    })
    .onConflictDoUpdate({
      target: productionRooms.roomId,
      set: {
        graph: state.graph,
        decisionLog: state.decisionLog,
        pending: state.pending,
        applied: state.applied,
        scenarios: state.scenarios,
        updatedAt: new Date(),
      },
    });
}

export function getGraph(roomId: string) {
  const state = roomCache.get(roomId);
  return state?.graph ? clone(state.graph) : null;
}

export function setGraph(roomId: string, graph: ProductionGraph) {
  const state = roomCache.get(roomId);
  if (!state) throw new Error(`Room ${roomId} has not been loaded.`);
  state.graph = clone(graph);
  return getGraph(roomId)!;
}

export async function resetState(roomId: string) {
  await ensureRoom(roomId);
  const state = roomCache.get(roomId)!;
  state.graph = null;
  state.decisionLog = [];
  state.pending = [];
  state.applied = [];
  state.scenarios = [];
  await persistRoom(roomId);
}

export function addDecision(
  roomId: string,
  agent: string,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
) {
  const state = roomCache.get(roomId);
  if (!state) throw new Error(`Room ${roomId} has not been loaded.`);
  const entry: DecisionLogEntry = {
    id: randomUUID().slice(0, 8),
    agent,
    input,
    output,
    timestamp: new Date().toISOString(),
  };
  state.decisionLog.push(entry);
  return entry;
}

export function getDecisionLog(roomId: string) {
  return clone(roomCache.get(roomId)?.decisionLog ?? []);
}

export function stageSimulation(roomId: string, simulation: Simulation) {
  const state = roomCache.get(roomId);
  if (!state) throw new Error(`Room ${roomId} has not been loaded.`);
  state.pending = state.pending.filter(
    (entry) => entry.changeId !== simulation.changeId,
  );
  state.pending.push(clone(simulation));
  return clone(simulation);
}

export function getPending(roomId: string, changeId: string) {
  const found = roomCache.get(roomId)?.pending.find((entry) => entry.changeId === changeId);
  return found ? clone(found) : null;
}

export function commitSimulation(
  roomId: string,
  changeId: string,
  planOutput: AppliedChange["planOutput"],
  updatedGraph: ProductionGraph,
) {
  const state = roomCache.get(roomId);
  if (!state) throw new Error(`Room ${roomId} has not been loaded.`);
  const pendingIndex = state.pending.findIndex(
    (entry) => entry.changeId === changeId,
  );
  const pending = pendingIndex >= 0 ? state.pending[pendingIndex] : null;
  if (pendingIndex >= 0) state.pending.splice(pendingIndex, 1);
  if (pending) {
    state.applied.push({
      changeId,
      change: pending.change,
      planOutput: clone(planOutput),
      appliedAt: new Date().toISOString(),
    });
  }
  state.graph = clone(updatedGraph);
  return getGraph(roomId)!;
}

export function saveScenario(roomId: string, name: string) {
  const state = roomCache.get(roomId);
  if (!state) throw new Error(`Room ${roomId} has not been loaded.`);
  if (!state.graph) return null;
  const scenario: Scenario = {
    id: `scenario_${randomUUID().slice(0, 8)}`,
    name: name.trim() || `Scenario ${state.scenarios.length + 1}`,
    createdAt: new Date().toISOString(),
    graph: clone(state.graph),
  };
  state.scenarios.push(scenario);
  return clone(scenario);
}

export function listScenarios(roomId: string) {
  return (roomCache.get(roomId)?.scenarios ?? []).map((scenario) => ({
    id: scenario.id,
    name: scenario.name,
    createdAt: scenario.createdAt,
    dayCount: scenario.graph.days.length,
    remaining: scenario.graph.budgetSummary.remaining,
  }));
}

export function getScenarios(roomId: string) {
  return clone(roomCache.get(roomId)?.scenarios ?? []);
}

export function getScenario(roomId: string, id: string) {
  const scenario = roomCache.get(roomId)?.scenarios.find((entry) => entry.id === id);
  return scenario ? clone(scenario) : null;
}

export function loadScenario(roomId: string, id: string) {
  const state = roomCache.get(roomId);
  if (!state) throw new Error(`Room ${roomId} has not been loaded.`);
  const scenario = state.scenarios.find((entry) => entry.id === id);
  if (!scenario) return null;
  state.graph = clone(scenario.graph);
  return getGraph(roomId)!;
}

export function deleteScenario(roomId: string, id: string) {
  const state = roomCache.get(roomId);
  if (!state) throw new Error(`Room ${roomId} has not been loaded.`);
  const before = state.scenarios.length;
  state.scenarios = state.scenarios.filter((entry) => entry.id !== id);
  return state.scenarios.length < before;
}

export function getAppliedChanges(roomId: string) {
  return clone(roomCache.get(roomId)?.applied ?? []);
}