# Plan: LLM Enemy Commander (via OpenAI-compatible API)

## Status
Reviewed and revised. Merges three resolved design decisions and corrects two
factual errors found during codebase research (see §13).

## Resolved decisions
1. **Async brain interface.** `CommanderBrain.decide()` becomes
   `Promise<Command[]>`. Stub brains resolve synchronously; the LLM brain awaits
   `fetch`. `CommanderWorker` awaits `decide()` and owns the in-flight guard +
   cadence throttle. **Signature/coupling change:** `createBrain(kind)` currently
   takes only `kind: "stubby" | "stubbs"`. It must become
   `createBrain(kind, config?)` and the protocol `CommanderKind` must gain
   `"llm"`, so `start` can carry `config` for the `"llm"` kind. The worker's
   `start` handler (`src/commanders/CommanderWorker.ts:49`) calls
   `createBrain(message.kind)` today with **no** config — update it to pass
   `message.config` when `kind === "llm"`.
2. **Persisted registry keyed by id.** `uiStore.enemyCommander` becomes
   `string | "none"`. Built-in ids `"stubby"`/`"stubbs"` are reserved constants
   (not stored in the registry). User LLM commanders live in a persisted
   `llmCommanders` registry keyed by id. Activation = `setEnemyCommander(id)`,
   whether from the `/commanders` screen "Activate" button or the in-game
   drop-down.
3. **New route `/commanders`.** A dedicated `CommandersScreen.vue` opened from a
   "Commanders" button on `MainMenu.vue`. Not reachable in-game.

## What already exists (reuse, do not rebuild)
- `src/commanders/` already has the full spine: `CommanderWorker.ts` (worker
  entry), `relay.ts` (~4 Hz `SnapshotStore` reader, `RELAY_INTERVAL_MS = 250`),
  `observation.ts` (projection `CommanderSnapshotSlice` → `CommanderObservation`),
  `brain.ts` (`CommanderBrain` interface + `createBrain(kind)` factory),
  `protocol.ts`, `index.ts` (`setEnemyCommander`/`stopEnemyCommander`), and the
  two stub brains `stubby/brain.ts`, `stubbs/brain.ts`.
- `llm:*` commands are already implemented in `src/sim/applyCommand.ts:91-137`:
  `llm:routeGroup` (hold / waypoint-to-base), `llm:setTargeting`, and the
  worker-internal `llm:gridLayoutToggle`. The LLM brain only ever emits
  `routeGroup` + `setTargeting`.
- Growl notifications: `uiStore.showNotification` (`src/stores/ui.ts:102`) →
  toast in `src/components/GameHud.vue:126`. **Important channel correction:**
  because the commander worker's relay runs on the **main thread**, the
  `notify`/`chat` messages the worker posts are forwarded by the *relay* directly
  to `uiStore.showNotification` — they do **not** travel through the sim's
  `HostBindings.notifyUi` (`src/sim/HostBindings.ts:54`,
  `src/sim/WorkerHostBindings.ts:24`, which is the *sim-worker* seam). The sim
  `HostBindings` is unrelated to the commander transport. `notify` is the channel
  for connect / error / disconnect messages.
- Pause is observable: `SnapshotMeta.state` ships every tick
  (`src/sim/SimulationSnapshot.ts:73`); `GameState.PAUSED` is the sentinel to
  skip requests.
- `CommanderMemory` (`src/commanders/brain.ts:10`) is the worker-owned scratch
  store; extend it for LLM state (conversation, token accounting, last
  observation for diffing).

## 1. OpenAPI client (`src/commanders/llm/apiClient.ts`)
- Framework-free native `fetch` wrapper. **No external libraries** (per plan; a
  worker already keeps the main thread free — see §13.2 on CORS).
- Constructed with an injected `fetchFn` (defaults to global `fetch`) so unit
  tests use a fake and never hit the network.
- Endpoint normalization (`normalizeEndpointUrl`):
  - Starts with `http://` or `https://` → used verbatim as the base.
  - Otherwise treated as `host[:port]` → `http://{host}/v1`.
- Request body: OpenAI-compatible chat-completions shape
  (`messages`, `model` only when a model name is configured — omit `model` when
  empty so the server's default is used, `temperature`, `stream: false`).
  `Authorization: Bearer {token}` only when a token is configured.
- **Timeout 3 s** (`AbortController` + `setTimeout`): on timeout, log + retry on
  next iteration (escalating back-off, see below).
- **Escalating back-off**: base 3 s, double each failure, cap **30 s**. Reset to
  base after any successful response. Back-off delays the *next* request; it does
  not stack on top of the relay interval (avoid double-penalizing cadence).
- **Empty / error / malformed handling**: on non-2xx, empty body, or
  unparseable/non-JSON, log + retry next iteration (respecting back-off).
- **Token accounting**: read `usage.prompt_tokens` from the response (when
  present) to track running context size for compression (§7).

## 2. LLM commander config + persistence
- `LlmCommanderConfig` type (`src/commanders/llm/types.ts`):
  - `id: string` (uuid/genId, stable key)
  - `name: string`
  - `endpointUrl: string` (required)
  - `token: string` (optional)
  - `modelName: string` (optional)
  - `contextLimit: number` (tokens; default 32768)
  - `commanderInstructions: string` (optional, blank default)
  - `systemPrompt: string` (required; defaulted from a const at create time)
- Persist slice: add `llmCommanders: LlmCommanderConfig[]` to **both** the
  serialized shape in `persist.ts` (`PersistStateShape`, `src/stores/persist.ts:30`,
  `load` / `save` / `migrateToCurrent`) **and** sim `PersistState`
  (`src/sim/PersistState.ts`, `createDefaultPersistState` default `[]`) plus its
  `createDefaultPersistState` default. Built-ins (`stubby`/`stubbs`) are NOT in
  this array. `llmCommanders` is UI-only (the engine never reads it), so on sim
  `PersistState` it is a harmless pass-through. **Schema migration:** bump
  `CURRENT_SAVE_VERSION` from `2` to `3` in both `persist.ts` and
  `PersistState.ts`, add a `migrateV2ToV3` that backfills `llmCommanders: []`,
  and wire it into `migrateToCurrent`. Key remains `lol_ya_tdg_save_1`.
- Built-in id constants: `BUILTIN_STUBBY = "stubby"`, `BUILTIN_STUBBS = "stubbs"`
  in `src/commanders/index.ts`.

## 3. Selection / activation (`src/commanders/index.ts`, `src/stores/ui.ts`)
- `uiStore.enemyCommander: string | "none"` (`src/stores/ui.ts:20,59,188`).
- `setEnemyCommander(id: string | "none")`:
  - `"none"` → `stopEnemyCommander()`.
  - `"stubby"` / `"stubbs"` → resolve to built-in kind; `startRelay(kind)` with
    no config (existing behavior).
  - any other id → look up `LlmCommanderConfig` from `persistStore.llmCommanders`;
    `startRelay("llm", config)`.
- `startRelay(kind, config?)` (`src/commanders/relay.ts:23`) receives the config
  for the `"llm"` kind; `MainToCommanderMessage.start` carries it.

## 4. Protocol extensions (`src/commanders/protocol.ts`)
- `MainToCommanderMessage`:
  - `start` gains optional `config?: LlmCommanderConfig` (only for `"llm"`).
  - add `{ type: "chat"; text: string }` (player → LLM).
  - add `{ type: "updateInstructions"; text: string }` (live Commander
    Instructions rewrite).
- `CommanderToMainMessage`:
  - existing `{ type: "commands"; commands: Command[] }`.
  - add `{ type: "notify"; message: string }` (error / connect / disconnect →
    relay forwards to `uiStore.showNotification`, the growl toast).
  - add `{ type: "chat"; text: string; from: "commander" }` (LLM → player).
- `CommanderSnapshotSlice` unchanged (relay still ships full `enemies`/`towers`/
  `spawnStates`/`meta` + cached `gridLayout`; the LLM brain diffs in the worker).

## 5. LLM brain (`src/commanders/llm/brain.ts`)
- `createBrain("llm", config)` returns a `CommanderBrain` whose `decide()` is
  `async` and returns `Promise<Command[]>`.
- `decide(observation, memory)`:
  - If `memory.isCompressing` or building the first prompt, assemble the full
    prompt (system + instructions + snapshot, §6) and clear delta history.
  - Otherwise append a delta block (§7) + any queued player chat messages.
  - Call the API client (§1). On success, parse + validate the JSON command
    response (§12), translate to `llm:routeGroup` / `llm:setTargeting` commands.
  - Update `memory` token count from `usage.prompt_tokens`; if
    `tokenCount + estimatedNext >= config.contextLimit`, set a compress flag so
    the next `decide` rebuilds the full prompt.
  - Return the commands (may be empty on malformed/empty response; client already
    retried per §1).
- **In-flight guard + cadence** (`src/commanders/CommanderWorker.ts`): track
  `deciding` boolean; when a new `observation` arrives while `deciding`, skip
  issuing a new `decide` (drop the tick). Use a timestamp throttle targeting
  ~1 Hz (`LLM_DECISION_INTERVAL_MS = 1000`) so even at 4 Hz relay polling we
  only call the API ~once per second. Both the stub path (now async-resolved) and
  the LLM path go through the same guard.
- `updateInstructions` message updates `memory.commanderInstructions` and forces
  a prompt rewrite on the next `decide` (re-emit system + instructions prefix).
- `chat` (player) message is enqueued in `memory.pendingPlayerMessages` and
  appended on the next `decide`.

## 6. System prompt + Commander Instructions
- `src/commanders/llm/systemPrompt.ts`: `buildSystemPrompt(config)` assembles a
  template filled at **runtime** from real constants so values can't drift:
  - Game objective: destroy the defender base by routing enemies to it.
  - Map/grid: grid is tile-based with `meta.tileSize` (default 36,
    `SimulationSnapshot.ts:95`); `gridLayout` semantics (`0=terrain,1=path,2=base,3=spawn`,
    `protocol.ts:10`); spawn + base tiles; pathing/blocking via
    `src/sim/grid/Pathfinding.ts` BFS with dynamic tower avoidance.
  - Enemy types + stats from `ENEMY_TYPES` (`src/sim/ConstantsEnemy.ts:21`,
    with `ENEMY_LEVEL_HP_MULT`/`ENEMY_WAVE_DAMAGE_MULT` formulas).
  - Tower types + stats from `ConstantsTower.ts`.
  - Waves: inter-wave countdown (`BETWEEN_WAVES_TIMER`) and preemptive next-wave
    timer `PRE_EMPTIVE_WAVE_TIMER = 90` game-seconds
    (`src/sim/Constants.ts:118`); victory wave; spawning from a queue
    (`src/sim/waves/WaveManager.ts`). **NOTE: there is NO "max active enemies"
    cap** — concurrency is implicitly bounded by spawn pacing, not a hard limit;
    describe it that way (see §13.1).
  - Data stream description: what each `decide` delta contains (§7).
  - Command syntax + allowlist (`routeGroup`, `setTargeting` only — §12).
  - Default `systemPrompt` const used to populate new configs' required field.
- Commander Instructions: user-provided, appended after the system prompt;
  blank by default; editable live (§5 `updateInstructions`).

## 7. Deltas (worker-side diff)
- Keep `memory.lastObservation` (previous `CommanderObservation`). On each
  `decide` (after the initial snapshot), build a compact delta:
  - Enemies: new ids (full entry: type, level, tile, hp/maxHp, first position);
    for known ids, only position (tile) + hp/maxHp **if changed** (most enemies
    move every tick, so position usually ships — keep small by sending tile
    coords, not world coords).
  - Towers: new ids (full: type, tile, level, hp/maxHp); for known ids, only
    hp/maxHp if changed.
  - Wave summary: `currentWave`, `pendingEnemyCount`, `remainingScheduledSpawns`,
    `active` (from `observation.ts:21`).
  - Timestamp (`meta` frame id / wall clock).
- To preserve context-cache reuse, **never** mutate the initial snapshot block;
  only append deltas. On compression (§5 / §7 token limit), rewrite the full
  prompt (same system + instructions text, then a fresh full snapshot) and clear
  `memory.lastObservation`/delta history.
- Diffing is pure worker-side using `CommanderMemory`; no sim/`SnapshotStore`
  change. Concept mirrors `plans/SnapshotDelta.md` but lives in the LLM brain.

## 8. In-game chat (`src/components/EnemyChat.vue`)
- Floating, draggable dialog on the game screen, shown **only** when an LLM-type
  commander is active (`uiStore.enemyCommander` resolves to an LLM config). No
  close button; visibility follows activation.
- Layout:
  - Top: 3-line `Commander Instructions` textarea (editing sends
    `updateInstructions` → prompt rewrite; §5).
  - Middle: scrolling message log (last ~20, kept in a `chatLog` slice on
    `uiStore`).
  - Bottom: message input + Send button. Send posts `chat` to the worker and
    logs the player message locally.
- Messages from the LLM arrive via `notify`/`chat` worker messages (§4),
  forwarded by the relay into `uiStore.chatLog`.
- New `chatLog` slice in `src/stores/ui.ts` (array of `{ from: "player"|"commander"; text: string }`,
  capped at 20). Cleared on commander change/stop.

## 9. Configuration screen (route `/commanders`)
- `src/components/CommandersScreen.vue` + router entry in
  `src/router/index.ts` (guarded like other screens; **not** linked from in-game
  menus).
- Main menu: add a "Commanders" button to `src/components/MainMenu.vue` that
  routes to `/commanders`.
- Screen contents:
  - **List of Enemy Commanders**:
    - Sergeant Stubby + Commander Stubbs: shown, **not editable** (may gain
      parameter forms later). "Activate" button = `setEnemyCommander(builtinId)`.
    - User LLM commanders: Name, **Edit** (same form, pre-populated),
      **Activate** (`setEnemyCommander(id)`), **Delete**.
  - **New LLM Commander** button → popup dialog (reuse `ConfirmDialog`-style
    modal pattern) with the form:
    - endpoint URL (required; normalized per §1).
    - token/key (optional).
    - model name (optional; omitted from requests when blank).
    - context limit (tokens; default 32768).
    - Commander Instructions (large textarea, optional, blank default).
    - System Prompt (large textarea, required, defaulted from const).
   - Persist on save via `persistStore` (§2).
   - **In-game Commander select (§3/§9):** `src/components/PauseMenu.vue:47-90`
     currently hardcodes a 3-option `<select>` (none/stubby/stubbs) and casts the
     value to `"none" | "stubby" | "stubbs"`. Make it **dynamic**: render
     `none` + the two built-ins + one `<option>` per `persistStore.llmCommanders`
     id, and widen the cast (in `handleCommanderChange`) to `string` so LLM ids
     flow through `uiStore.setEnemyCommander(id)`.

## 10. Pause handling + test (important)
- In `src/commanders/CommanderWorker.ts`, before issuing `decide` for an LLM
  brain: if `slice.meta.state === GameState.PAUSED`, **skip** the API request
  (and skip advancing cadence). Let any in-flight request finish, then idle until
  unpaused. Stub brains are cheap and remain pause-agnostic.
- **Test** (`tests/integration/commander-llm.test.ts` or extend
  `tests/integration/commander.test.ts`): with a fake fetch, drive the worker
  with `meta.state === PAUSED` and assert **zero** `fetch` calls; unpause and
  assert the next tick issues exactly one request.

## 11. Notifications (growl)
- On API connect attempt, first success, error, and back-off exhaustion, the LLM
  brain posts `{ type: "notify"; message }` (§4). The relay forwards to
  `uiStore.showNotification` (`src/stores/ui.ts:102`) → `GameHud.vue:126` toast.
- Same channel used for worker/relay connect/disconnect lifecycle notes.

## 12. Response processing + command schema
- `src/commanders/llm/schema.ts`: define the JSON command schema and a validator.
  - Allowed command types: `llm:routeGroup` and `llm:setTargeting` ONLY.
    `llm:gridLayoutToggle` is worker-internal and must NOT be accepted from the
    LLM.
  - `routeGroup`: `{ enemyIds: number[]; hold?: boolean; holdTile?: {x,y};
    waypoints: {x,y}[] }`. **Coordinate space (corrected):** waypoints and
    `holdTile` are **tile** coords. The LLM works in the tile space described in
    the system prompt, and the brain emits tile coords directly — there is **no**
    tile→world conversion anywhere. `applyCommand.ts` passes `command.waypoints`
    straight into `enemy.grid.computeRoute(...)` alongside `enemy.currentTile()`
    (both tile coords; `Grid.computeRoute` takes tiles, `Enemy.currentTile()`
    returns tiles). So emit tile coords from the brain and do not convert to world.
  - `setTargeting`: `{ enemyIds: number[]; mode: string }`.
- Malformed/validated-rejected responses: the client layer logs + the brain
  returns no commands (retry handled by §1). The schema is also embedded in the
  system prompt so the model knows the exact syntax.

## 13. Corrections from review (must reflect in implementation)
### 13.1 "max active enemies" does not exist
`WaveManager.ts` has no active-enemy cap. Only `PRE_EMPTIVE_WAVE_TIMER = 90`
(`Constants.ts:118`) governs wave timing. The system prompt must describe wave
spawning as a queue with inter-wave + preemptive timers, **not** a max-concurrent
figure.

### 13.2 CORS is not solved by the worker
Running `fetch` in the commander worker does **not** bypass CORS — a worker is
still subject to CORS for cross-origin requests. The benefit of the worker is
keeping the main thread free and impervious to main-thread jank. The user must
run an LLM server that sends permissive CORS headers (common for localhost Ollama
/ LM Studio / llama.cpp). No library is needed; document this requirement in the
config screen help text.

## 14. Conventions (AGENTS.md)
- Descriptive variable names (no single letters); ~100-char lines; avoid comments
  except for cross-boundary side effects. Framework-free client (native `fetch`).

## 15. Build order (keeps ~1000 existing tests green)
1. Protocol types: `notify`, `chat`, `updateInstructions`, `start`-with-config
   (`src/commanders/protocol.ts`).
   2. `LlmCommanderConfig` + `llmCommanders` persist slice (sim `PersistState`
      `createDefaultPersistState`, `persist.ts` `PersistStateShape`) + v2→v3
      migration (`CURRENT_SAVE_VERSION` 2→3 in both files, backfill `[]`).
3. `setEnemyCommander(id)` resolution + `startRelay(kind, config?)` + built-in id
   constants (`index.ts`, `relay.ts`).
4. `apiClient.ts` (injectable `fetch`) + timeout/retry/back-off/parse unit tests.
5. `systemPrompt.ts` (runtime-filled template) + `schema.ts` (allowlist +
   validator).
   6. LLM brain (async `decide`) + `CommanderWorker` await + in-flight guard +
      cadence + delta diff + compression; `CommanderMemory` extended. Also flip
      `createBrain(kind)` → `createBrain(kind, config?)` (`CommanderKind` gains
      `"llm"`) and update the worker `start` handler (§1) to pass `message.config`
      when `kind === "llm"`.
7. Pause skip in worker + pause test (§10).
8. `EnemyChat.vue` + `chatLog` slice + `notify`/chat relay wiring (§8, §11).
   9. `/commanders` route + `CommandersScreen.vue` + MainMenu button + dynamic
      `PauseMenu` select (widen cast to `string`, render LLM ids from
      `persistStore.llmCommanders`; §3, §9).
10. Integration test: LLM brain round-trip with fake fetch (mirror
    `tests/integration/commander.test.ts`), pause test (§10), malformed-response
    test.

## 16. Open items (deferred, not blocking)
- Streaming responses: out of scope initially (short messages, no thinking).
- Editing Sergeant Stubby / Commander Stubbs parameters: future form.
- Multi-LLM / A-B comparison: out of scope.
- Per-model token-limit auto-detect: rely on user-supplied `contextLimit` for now.
