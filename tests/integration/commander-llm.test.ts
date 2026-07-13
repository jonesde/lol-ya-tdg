import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommanderMemory } from "@/commanders/brain.js";
import { createLlmBrain } from "@/commanders/llm/brain.js";
import { DEFAULT_LLM_SYSTEM_PROMPT, type LlmCommanderConfig } from "@/commanders/llm/types.js";
import type { CommanderObservation } from "@/commanders/observation.js";
import type { CommanderToMainMessage } from "@/commanders/protocol.js";
import { GameState } from "@/sim/Constants.js";
import { GameEngine } from "@/sim/GameEngine.js";
import { buildSnapshot } from "@/sim/SnapshotSerializer.js";
import {
  createTestMapThemeStore,
  createTestPersistState,
  createTestThemeBundle,
  MockHostBindings,
} from "../helpers/mock-stores.js";

const FIXED_DT = 1 / 60;

interface CommanderWorkerScope {
  postMessage(message: CommanderToMainMessage): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

function makeConfig(): LlmCommanderConfig {
  return {
    id: "llm1",
    name: "LLM 1",
    endpointUrl: "http://localhost:1234/v1",
    token: "",
    modelName: "",
    contextLimit: 32768,
    commanderInstructions: "",
    systemPrompt: DEFAULT_LLM_SYSTEM_PROMPT,
  };
}

function makeObservation(): CommanderObservation {
  return {
    map: [
      [1, 2],
      [3, 1],
    ],
    enemies: [{ id: 1, tileX: 0, tileY: 0, level: 1, hp: 10, maxHp: 10 }],
    towers: [{ tileX: 1, tileY: 1, level: 1, hp: 20, maxHp: 20 }],
    wave: { currentWave: 1, pendingEnemyCount: 0, spawnStates: [], remainingScheduledSpawns: 0, active: false },
  };
}

function makeMemory(): CommanderMemory {
  return {
    phase: "idle",
    seenByWave: new Map<number, Set<number>>(),
    lastRushWaveNumber: null,
    lastRoutedTowerSignature: "",
    gridLayout: undefined,
    conversation: [],
    tokenCount: 0,
    lastObservation: null,
    commanderInstructions: "",
    pendingPlayerMessages: [],
    isCompressing: false,
  };
}

describe("Integration: LLM commander worker pause + relay", () => {
  const gw = globalThis as unknown as { self: CommanderWorkerScope | undefined; fetch: unknown };
  const originalSelf = gw.self;
  const originalFetch = gw.fetch;
  const posted: CommanderToMainMessage[] = [];
  const mockSelf: CommanderWorkerScope = {
    postMessage: (msg: CommanderToMainMessage) => posted.push(msg),
    onmessage: null,
  };
  let engine: GameEngine;
  let persistState: ReturnType<typeof createTestPersistState>;
  let mockHost: MockHostBindings;

  function snapshotWithState(state: string): ReturnType<typeof buildSnapshot> {
    const snapshot = buildSnapshot(engine, 0);
    snapshot.meta.state = state as typeof snapshot.meta.state;
    return snapshot;
  }

  afterEach(() => {
    gw.self = originalSelf;
    gw.fetch = originalFetch;
    vi.useRealTimers();
    posted.length = 0;
    mockSelf.onmessage?.({ data: { type: "stop" } });
  });

  function setup(): void {
    createTestMapThemeStore();
    persistState = createTestPersistState();
    mockHost = new MockHostBindings();
    engine = new GameEngine(persistState, createTestThemeBundle(), mockHost, 0);
    engine.loadMap(0);
    engine.waveManager?.startNextWave();
    for (let tick = 0; tick < 5; tick++) engine.update(FIXED_DT);
  }

  it("skips the API request while paused and issues exactly one after unpause", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: "[]" } }] }),
    })) as unknown as typeof fetch;
    gw.fetch = fetchFn;
    gw.self = mockSelf;

    await import("@/commanders/CommanderWorker.js");
    mockSelf.onmessage!({ data: { type: "start", kind: "llm", config: makeConfig() } });
    setup();

    // Several PAUSED observations: the worker must never call fetch.
    for (let i = 0; i < 3; i++) {
      mockSelf.onmessage!({ data: { type: "observation", slice: snapshotWithState(GameState.PAUSED) } });
      vi.advanceTimersByTime(200);
    }
    expect(fetchFn).toHaveBeenCalledTimes(0);

    // Advance past the 1 Hz cadence and post a non-paused observation.
    vi.advanceTimersByTime(1000);
    mockSelf.onmessage!({ data: { type: "observation", slice: snapshotWithState(GameState.PLAYING) } });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("Unit: LLM brain round-trip + malformed", () => {
  it("translates a valid routeGroup response into a Command", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify([{ type: "llm:routeGroup", enemyIds: [1], waypoints: [{ x: 5, y: 6 }] }]),
              },
            },
          ],
          usage: { prompt_tokens: 7 },
        }),
    })) as unknown as typeof fetch;
    const brain = createLlmBrain(makeConfig(), { fetchFn });
    const commands = await brain.decide(makeObservation(), makeMemory());
    const route = commands.find((c) => c.type === "llm:routeGroup");
    expect(route).toBeDefined();
    if (route && route.type === "llm:routeGroup") {
      expect(route.enemyIds).toEqual([1]);
      expect(route.waypoints).toEqual([{ x: 5, y: 6 }]);
    }
  });

  it("returns no commands and notifies on a malformed response", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "this is not json",
    })) as unknown as typeof fetch;
    const notify = vi.fn();
    const brain = createLlmBrain(makeConfig(), { fetchFn, onNotify: notify });
    const commands = await brain.decide(makeObservation(), makeMemory());
    expect(commands).toHaveLength(0);
    expect(notify).toHaveBeenCalled();
  });

  it("forwards a chat message when present", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ choices: [{ message: { content: JSON.stringify({ commands: [], chat: "greetings" }) } }] }),
    })) as unknown as typeof fetch;
    const chat = vi.fn();
    const brain = createLlmBrain(makeConfig(), { fetchFn, onChat: chat });
    await brain.decide(makeObservation(), makeMemory());
    expect(chat).toHaveBeenCalledWith("greetings");
  });
});
