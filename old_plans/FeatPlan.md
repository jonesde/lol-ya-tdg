# Feature Plan

## Phase 1: Sell Confirmation Dialog

**Goal:** Add a confirmation dialog before selling a tower. Enter confirms, Escape cancels.

### Changes

| File | Change |
|------|--------|
| `src/game/GameEngine.js` | Split `sellSelected()` (line 557) into `showSellConfirm()` and `executeSell()`. `showSellConfirm()` calls `uiStore.showConfirm()` with tower name, sell value, and `onConfirm` that performs the actual sell. |
| `src/game/Input.js` | Add `Enter` key handler (after line 57): when `uiStore.confirmDialog` is active, call `uiStore.executeConfirm()`. |
| `src/stores/ui.js` | No changes needed — existing `showConfirm`/`executeConfirm`/`hideConfirm` API suffices. |
| `src/components/ConfirmDialog.vue` | No changes needed — renders dynamically from store state. |
| `src/components/TowerPanel.vue` | No changes — `handleSell()` delegates to `engine.sellSelected()` which now shows the dialog. |

### Details

- `showSellConfirm()` message: `"Sell {towerName} (Lv {level}) for {value}g?"`
- Confirm label: `"Sell"`, Cancel label: `"Keep"`
- Both the UI button click and `s` keyboard shortcut flow through the same `sellSelected()` entry point
- Escape already calls `uiStore.closeAllDialogs()` → `hideConfirm()` → `onCancel` (no-op for sell)
- Enter key is new — only triggers `executeConfirm()` when a confirm dialog is open

### Testing

- Click sell button → dialog appears with correct tower name, level, sell value
- Press Enter → tower sold, gold received, dialog closed
- Press Escape → dialog closed, tower remains, no gold change
- Press `s` key → same dialog flow as button click
- Verify discount sell mode still blocks selling (returns early before dialog)
- Update `tests/unit/game-engine.test.js` — test `showSellConfirm` and `executeSell` separately
- Update `tests/unit/input.test.js` — test Enter key with confirm dialog active
- Update `tests/unit/components/tower-panel.test.js` — verify sell button triggers dialog

---

## Phase 2: Tower Panel Display Updates

**Goal:** Show active specialization name on selected tower card. Add Current Wave Damage. Make Total Damage and Current Wave Damage dynamic/responsive.

### Changes

| File | Change |
|------|--------|
| `src/components/TowerPanel.vue` | Add specialization name display (visible when `tower.variant` is set). Add `waveDamage` display. Add reactive damage tracking via `setInterval`-driven ref. |

### Reactive Damage Approach

The Tower class instances are plain JS objects — Vue cannot observe mutations to `tower.totalDamageDealt` or `tower.waveDamage`.

Use a `setInterval`-driven ref (1-second interval) in `TowerPanel.vue`. A `ref` counter increments every second via `setInterval`, and a computed depends on both `tower` and the counter, reading `tower.totalDamageDealt` and `tower.waveDamage` fresh each second. The interval is cleaned up in `onUnmounted`. This avoids 60fps reactivity overhead for stats that don't need frame-level updates.

The reactive pattern in TowerPanel would look like:
```js
import { ref, onUnmounted, computed, onMounted } from "vue";

const damageTick = ref(0);
let intervalId = null;

onMounted(() => {
  intervalId = setInterval(() => { damageTick.value++; }, 1000);
});

onUnmounted(() => {
  if (intervalId) clearInterval(intervalId);
});

const damageStats = computed(() => {
  const t = tower.value;
  if (!t) return null;
  // damageTick dependency forces re-evaluation every second
  void damageTick.value;
  return { total: Math.round(t.totalDamageDealt), wave: Math.round(t.waveDamage) };
});
```

### Specialization Display

- When `tower.variant` is `"A"` or `"B"`, show the specialization name from `VARIANT_INFO[tower.type][tower.variant].name`
- Display as a badge or subtitle below the tower name
- Remove the specialization choice buttons once variant is set (already the current behavior)

### Testing

- Select a specialized tower → specialization name displays correctly
- Deal damage during a wave → Current Wave Damage updates in real-time
- Total Damage updates as projectiles hit enemies
- Wave transition resets Current Wave Damage display
- Non-specialized tower shows no specialization badge
- Update `tests/unit/components/tower-panel.test.js` — test specialization display, damage stats computed

---

## Phase 3: Specialization + Level 5 Merge + Ice Splash Fix

**Goal:** Combine specialization selection with level 5 gold purchase. Specialization buttons show level 5 upgrade cost. After specializing, tower is at level 5 and normal upgrade goes to level 6. Fix ice splash radius.

### Current Flow
1. Skill tree: unlock level 4 (32 gems), unlock variant A/B tier 0 (64 gems)
2. In-game: upgrade to level 4 (gold), pick specialization (free), upgrade to level 5 (gold)

### New Flow
1. Skill tree: unlock level 4 (32 gems), unlock variant A/B tier 0 (64 gems) — **unchanged**
2. In-game: upgrade to level 4 (gold), pick specialization + pay level 5 gold cost (combined), next upgrade is level 6

### Changes

| File | Change |
|------|--------|
| `src/towers/Tower.js` | `canUpgrade()` (line 237): at level 4 with no variant, return `needVariant: true` (unchanged). `specialize()` (line 248): also increment level to 5 and add level 5 upgrade cost to `totalInvested`. Return `{ ok, cost }` so UI can deduct gold. |
| `src/game/GameEngine.js` | `specializeSelected()` (line 549): deduct level 5 upgrade cost from gold before calling `tower.specialize()`. |
| `src/components/TowerPanel.vue` | Specialization buttons show level 5 gold cost: `"{variantName} ({cost}g)"`. Buttons disabled if can't afford. `handleSpecialize()` checks affordability. Upgrade button at level 4 is hidden (replaced by spec buttons). After specializing to lv5, upgrade button shows lv6 cost. |
| `src/game/Constants.js` | Ice Permafrost splash array: change `[1, 1.5, 2]` to `[1, 1.25, 1.5]` (line 382). |
| `src/towers/SkillTree.js` | `maxLevelFor()` (line 252): variant tier 0 now grants access to level 5 (unchanged logic, but level 5 is now achieved via specialize, not separate upgrade). |

### Ice Splash Fix Details

Current: `splash: [1, 1.5, 2][t]` where `t = level - 4`
- Level 5 (t=1): splash = 1.5 ← **too big**
- Level 6 (t=2): splash = 2

New: `splash: [1, 1.25, 1.5][t]` where `t = level - 5` (since spec now happens at lv5)
- Level 5 (t=0): splash = 1
- Level 6 (t=1): splash = 1.25
- Level 7 (t=2): splash = 1.5

**Important:** The tier index `t` passed to `apply()` is `level - 4` in `Tower._computeStats()`. Since specialization now happens at level 5, change it to `t = level - 5`.

This means at level 5, `t = 0` (first tier of the variant). All variant `apply()` functions already use `t` as a tier index, so this is semantically correct.

**Impact on other variants:**
- **Lightning Overload** (`chain: s.chain + 2 * t`): chain bonuses will be 1 tier lower at each level. This reduction is acceptable and does not require rebalancing.
- **All other variants** (basic Rapid/Heavy, ice Shatter, sniper Marksman/Piercer, cannon Fragment/Napalm, railgun Knockback/Rail Lance): these use `_t` (ignore tier index), so they are unaffected.

### Testing

- At level 4 with variant unlocked → spec buttons show level 5 gold cost
- Click spec button → tower becomes level 5 with variant applied, gold deducted
- After specializing → upgrade button shows level 6 cost
- Cannot specialize without sufficient gold
- Ice Permafrost: verify splash = 1 at lv5, 1.25 at lv6, 1.5 at lv7
- Verify other variants still work correctly with new tier indexing
- Update `tests/unit/towers.test.js` — test specialize also upgrades to lv5
- Update `tests/unit/game-engine.test.js` — test gold deduction on specialize
- Update `tests/unit/projectile-manager.test.js` — ice splash radius values

---

## Phase 4: Cancel Build Refund

**Goal:** Allow full refund of a tower within 1 real clock minute of placement, if no upgrades have been done. Works even with Sell Flexibility - Discounted active.

### Changes

| File | Change |
|------|--------|
| `src/game/Constants.js` | Add `CANCEL_BUILD_WINDOW_MS = 60000` |
| `src/towers/Tower.js` | Constructor: add `this.placedAt = Date.now()`. Add `canCancel()` method: returns true if `Date.now() - this.placedAt < CANCEL_BUILD_WINDOW_MS` and `this.level === 1` (no upgrades). |
| `src/towers/TowerManager.js` | Add `cancelBuild(tower)` method: removes tower from grid and array, spawns particles, returns `tower.totalInvested` (full refund). |
| `src/game/GameEngine.js` | Add `cancelSelected()` method: checks `tower.canCancel()`, calls `towerManager.cancelBuild()`, refunds full gold, deselects tower. |
| `src/components/TowerPanel.vue` | Add "Cancel Build (Full Refund)" button, visible when `tower.canCancel()` is true. Show remaining time countdown. Wire to `engine.cancelSelected()`. |

### UI Details

- Button label: `"Cancel Build — {refund}g ({remaining}s)"`
- Countdown updates via the same `setInterval`-driven ref pattern as Phase 2 (1-second interval)
- Button disappears after 60s or after any upgrade
- Placed in TowerPanel below the upgrade/sell buttons
- Works regardless of `sellActive` mode (bypasses discount sell block)

### Testing

- Place tower → cancel button appears with 60s countdown
- Click cancel within 60s → full gold refund, tower removed, button gone
- Wait 60s → cancel button disappears
- Upgrade tower → cancel button disappears immediately
- Verify cancel works with Sell Flexibility - Discounted active
- Verify cancel works with Sell Flexibility - Full Refund active
- Verify cancel works with no sell option active
- Update `tests/unit/tower-manager.test.js` — test `cancelBuild` method
- Update `tests/unit/game-engine.test.js` — test `cancelSelected` flow
- Update `tests/unit/components/tower-panel.test.js` — test cancel button visibility

---

## Phase 5: Elevation Range Bonus (Damage Category Upgrade)

**Goal:** Add a new 3-tier general add-on in the Damage category: extra range per terrain height level, parallel to Elevation Advantage (which is damage per height).

### Changes

| File | Change |
|------|--------|
| `src/game/Constants.js` | Add `TERRAIN_HEIGHT_RANGE_BONUS = [0.25, 0.5, 1.0]` (tiles per height level per tier). Add to `GENERAL_ADDON_GEM_COSTS`: `terrainHeightRangeBonus: [50, 100, 200]`. |
| `src/towers/SkillTree.js` | Add `terrainHeightRangeBonus` to `GENERAL_ADDON_DEFS`. Add to `GENERAL_ADDON_CATEGORIES.damage.addons`. Tiers: `+0.25/lvl`, `+0.5/lvl`, `+1.0/lvl` range per terrain height. |
| `src/towers/Tower.js` | In `_computeStats()` (after line 195): apply range bonus from terrain height, similar to damage bonus. |
| `src/components/SkillTree.vue` | No changes needed — renders from `GENERAL_ADDON_DEFS` dynamically. |

### Stats Calculation

```js
// In Tower._computeStats(), after existing terrain height damage bonus:
const rangeTier = getGeneralAddonValue(this.save, "terrainHeightRangeBonus");
if (rangeTier !== null && rangeTier !== undefined) {
  const bonusPerHeight = TERRAIN_HEIGHT_RANGE_BONUS[rangeTier] || 0;
  range += bonusPerHeight * this.terrainHeight;
}
```

Max bonus at height 4, tier 2: `1.0 * 4 = 4` extra tiles range.

### Testing

- Unlock each tier → verify range increases correctly for towers at different heights
- Height 1, tier 0: +0.25 range; Height 4, tier 2: +4 range
- Range circle visualization updates (reads from `tower.stats.range`)
- Verify existing Elevation Advantage (damage) still works independently
- Update `tests/unit/towers.test.js` — test range with terrain height bonus
- Update `tests/unit/skill-tree.test.js` — test unlock/refund for new add-on

---

## Phase 6: Targeting Options

**Goal:** Add "Furthest" targeting mode (all towers). Add fixed-direction aiming (N/E/S/W dots) for Rail Cannon only, controlled by a flag in tower config.

### 6A: Furthest Enemy Targeting

| File | Change |
|------|--------|
| `src/towers/Tower.js` | Add `"furthest"` case to `selectTarget()` (line 285): max Euclidean distance from tower. |
| `src/components/TowerPanel.vue` | Add `<option value="furthest">Furthest</option>` to targeting dropdown. |
| `src/game/GameEngine.js` | No changes — `setTargeting()` already accepts any string value. |

### 6B: Fixed Direction Aiming (Rail Cannon Only)

| File | Change |
|------|--------|
| `src/game/Constants.js` | Add `fixedAim: false` to `TOWER_BASE.railgun`. Set to `true` to enable. Add `RAILGUN_FIXED_AIM_DIRS = ["N", "E", "S", "W"]`. |
| `src/towers/Tower.js` | Add `this.fixedAimDir = null` property. When `this.base.fixedAim` and `fixedAimDir` is set, `update()` fires in that direction instead of targeting a specific enemy. Direction vectors: N=(0,-1), E=(1,0), S=(0,1), W=(-1,0). `selectTarget()` is skipped; instead check if any enemy is in the firing cone/line in that direction within range. |
| `src/components/TowerPanel.vue` | Conditional UI: only for railgun with `fixedAim` flag. Show 4 directional dots (N/E/S/W) below targeting dropdown. Clicking a dot sets `fixedAimDir`. Active dot highlighted. "Auto" option to return to normal targeting. |
| `src/game/GameEngine.js` | Add `setFixedAimDir(dir)` method. Wire to UI. |
| `src/render/Renderer.js` | Draw directional indicator on railgun tower when in fixed aim mode (small arrow or line in the aim direction). |

### Fixed Aim Firing Logic

When `fixedAimDir` is set:
1. Compute direction vector from the cardinal direction
2. Check if any enemy exists within range along that direction (cone of ~30 degrees)
3. If yes, create a dummy target point along the direction vector at range distance and call `fire()` with it — minimal changes to `fire()` since it already accepts a target object with `.x` and `.y`
4. If no enemy in direction, do not fire (cooldown still decrements)

### Testing

- Furthest mode: verify tower targets enemy farthest from tower (not farthest along path)
- Fixed aim N/E/S/W: verify railgun fires in correct direction
- Fixed aim with no enemy in direction: tower does not fire
- Switching between auto and fixed aim modes works correctly
- Fixed aim UI only visible for railgun towers
- Directional indicator renders on canvas
- Update `tests/unit/towers.test.js` — test furthest targeting, fixed aim direction
- Update `tests/unit/components/tower-panel.test.js` — test targeting dropdown with furthest option

---

## Phase 7: Gem Rewards Rework

**Goal:** Reduce gem rewards significantly. Target: ~100 gems for wave 100 on levels 1-4. Replace region-based multipliers with per-map scaling.

### New Per-Map Multipliers

| Maps | Level Range | Multiplier |
|------|-------------|------------|
| 1-4 | 1-4 | x1 |
| 5-8 | 5-8 | x2 |
| 9-12 | 9-12 | x3 |
| 13-16 | 1-4 (R1) | x4 |
| 17-20 | 5-8 (R1) | x5 |
| 21-24 | 9-12 (R1) | x6 |
| 25-28 | 1-4 (R2) | x7 |
| 29-32 | 5-8 (R2) | x8 |
| 33-36 | 9-12 (R2) | x10 |

### Changes

| File | Change |
|------|--------|
| `src/game/Constants.js` | Change `BONUS_GEM_BASE` from `1.2` to `1.12` (reduces exponential growth). Replace `REGION_GEM_REWARDS` with `MAP_GEM_MULTIPLIERS` array of 36 values. Reduce `MILESTONE_GEMS` base amounts. |
| `src/grid/Map.js` | Remove `gemReward` from map objects (derived from map index now). |
| `src/game/GameEngine.js` | `applyGemMultipliers()`: use `MAP_GEM_MULTIPLIERS[mapIndex]` instead of `map.gemReward`. |

### New Gem Formula

Targeting ~100 gems at wave 100 on maps 1-4 (x1 multiplier):

**Wave completion:** `floor((wave * floor(1.1 ^ floor(wave/10))) / 10)`
- Wave 100: `floor((100 * floor(1.1^10)) / 10)` = `floor((100 * 2) / 10)` = `floor(20)` = 20 base gems
- With x1: 20 gems from wave completion

**Boss kills:** 1 gem per boss × multiplier
- ~13 bosses at wave 100 × 1 = 13 base gems
- With x1: 13 gems

**Milestones:** Reduce to `{15: 1, 30: 2, 50: 4}` = 7 base gems
- With x1: 7 gems

**Subtotal at wave 100, map 1-4:** ~40 gems (before first-time bonuses)
**With first clear bonus (2x):** ~80 gems

To reach ~100, adjust `BONUS_GEM_BASE` to `1.12`:
- `floor(1.12^10)` = `floor(3.10)` = 3
- Wave completion: `floor((100 * 3) / 10)` = 30
- Subtotal: 30 + 13 + 7 = 50
- With first clear 2x: 100

**Final `BONUS_GEM_BASE = 1.12`**

### MAP_GEM_MULTIPLIERS Array

```js
export const MAP_GEM_MULTIPLIERS = [
  // Region 0: maps 1-12
  1, 1, 1, 1,   // maps 1-4
  2, 2, 2, 2,   // maps 5-8
  3, 3, 3, 3,   // maps 9-12
  // Region 1: maps 13-24
  4, 4, 4, 4,   // maps 13-16
  5, 5, 5, 5,   // maps 17-20
  6, 6, 6, 6,   // maps 21-24
  // Region 2: maps 25-36
  7, 7, 7, 7,   // maps 25-28
  8, 8, 8, 8,   // maps 29-32
  10, 10, 10, 10, // maps 33-36
];
```

### Testing

- Wave 100 on map 1 → ~50 gems (non-first-clear), ~100 with first clear
- Wave 100 on map 5 (x2) → ~100 gems, ~200 with first clear
- Wave 100 on map 33 (x10) → ~500 gems, ~1000 with first clear
- Boss kill gems scale correctly with map multiplier
- Milestone gems scale correctly
- First-time milestone bonus (2x) still works
- First full clear bonus (2x) still works
- Difficulty multiplier still stacks on top
- Update `tests/unit/game-engine.test.js` — test gem calculations with new formula
- Update `tests/unit/map.test.js` — verify map gem multipliers assigned correctly

### Pre-existing Issue (Not Blocking)

`gemBreakdown.waveCompletion.afterDiff` is never populated (always 0) in `GameEngine.js:352-355`. The end screen displays this field but it has no value. This is not introduced by Phase 7 but is worth noting for eventual cleanup.

---

## Phase 8: Railgun Rebalance

**Goal:** Reduce fire rate, reduce knockback, add directional knockback logic, scale knockback by enemy health.

### 8A: Fire Rate Reduction

| File | Change |
|------|--------|
| `src/game/Constants.js` | Change `TOWER_BASE.railgun.fireRate` from `0.7` to `0.35`. |

New fire rate at level 5: `0.35 * 1.4^4` = `0.35 * 3.8416` ≈ `1.34/s`. Still a bit high for "1/s at level 5". Try `0.28`:
- Level 5: `0.28 * 3.8416` ≈ `1.08/s` ≈ **1/s** ✓

**Set `TOWER_BASE.railgun.fireRate = 0.28`**

### 8B: Knockback Reduction + Directional Logic

| File | Change |
|------|--------|
| `src/game/Constants.js` | Add `RAILGUN_KNOCKBASE = 0.3` (base knockback), `RAILGUN_KNOCK_SCALE = 0.2` (per-level increment), `RAILGUN_KNOCK_HP_DIVISOR = 64` (health scaling divisor). |
| `src/render/ProjectileManager.js` | Rewrite knockback logic in `handleLineHit()` (line 187): directional check, health scaling, reduced amounts. |

### New Knockback Formula

```js
if (p.knockback) {
  // Base knockback scales with tower level
  const kbRaw = Math.max(0.3, 0.3 + (p.level - 3) * 0.2);
  // Scale by enemy health (proxy for mass): lower HP = more knockback
  const massFactor = RAILGUN_KNOCK_HP_DIVISOR / e.maxHp;
  const kb = kbRaw * Math.max(0.1, Math.min(2, massFactor));

  // Directional check: only push enemy away from the railgun
  const dx = e.x - p.tower.x;
  const dy = e.y - p.tower.y;
  const projDirX = p.dx; // projectile direction
  const projDirY = p.dy;

  // Dot product: positive = enemy is in front of projectile direction
  const dot = dx * projDirX + dy * projDirY;

  if (dot > 0) {
    // Enemy is in front of the railgun beam — apply knockback
    if (e.pathIdx > 0) {
      e.pathIdx = Math.max(0, e.pathIdx - Math.ceil(kb));
    }
  }
  // If dot <= 0, enemy is behind or to the side — no knockback, damage still applies
}
```

### Knockback Values (with health scaling)

| Level | Raw KB | Minion (HP ~8) | Tank (HP ~32) | Boss (HP ~256) |
|-------|--------|---------------|---------------|----------------|
| 5 | 0.7 | ×8 → 5.6 | ×2 → 1.4 | ×0.25 → 0.18 |
| 6 | 0.9 | ×8 → 7.2 | ×2.25 → 2.0 | ×0.25 → 0.23 |
| 7 | 1.1 | ×8 → 8.8 | ×2.75 → 3.0 | ×0.25 → 0.28 |

(Capped by `Math.min(2, massFactor)` and `Math.max(0.1, massFactor)`)

### 8C: Side-Knockback Prevention

The dot product check (`dot > 0`) handles the "only push from front" requirement:
- If the railgun beam hits an enemy from behind (enemy between tower and path direction), `dot > 0` and knockback applies (pushes enemy back along path)
- If the beam hits from the side or front (enemy is "in front" of the beam direction), `dot` may be negative or small — knockback is reduced or skipped
- This encourages positioning the railgun so enemies walk into the beam for maximum knockback

### Testing

- Level 5 railgun fires at ~1/s (verify cooldown ≈ 1s)
- Knockback on minion: significant path steps back
- Knockback on boss: minimal path steps back (0-1)
- Side hit: no knockback applied, damage still dealt
- Frontal hit (enemy walking into beam): maximum knockback
- Verify `Math.ceil(kb)` produces reasonable step counts
- Update `tests/unit/projectile-manager.test.js` — comprehensive knockback tests with directional and health scaling
- Update `tests/unit/towers.test.js` — verify new fire rate at all levels

---

## Phase 9: Stun Gun Stormcall Visual Effect

**Goal:** Add lightning flash visual effects for Stormcall chain hops. Currently only the initial tower→target bolt is drawn; chain hops to random enemies have no visual.

### Changes

| File | Change |
|------|--------|
| `src/render/ProjectileManager.js` | In `applyStormcall()` (line 256): after each chain hop `applyHit()`, call `this.spawnLightningFlash(prevTarget.x, prevTarget.y, next.x, next.y, p.color)` to draw a lightning bolt between chain targets. |

### Implementation

```js
applyStormcall(p, firstTarget, onBossKilled) {
  let dmg = p.damage;
  let chain = p.chain;
  const hit = new Set();
  hit.add(firstTarget.id);
  this.applyHit({ ...p, damage: dmg }, firstTarget, onBossKilled);

  let lastTarget = firstTarget;
  while (chain > 0) {
    // ... find next target (random in range) ...
    if (!inRange.length) break;
    const next = inRange[Math.floor(Math.random() * inRange.length)];
    hit.add(next.id);
    dmg *= CHAIN_DAMAGE_FALLOFF;

    // Visual: lightning flash from previous target to next
    this.spawnLightningFlash(lastTarget.x, lastTarget.y, next.x, next.y, p.color);

    this.applyHit({ ...p, damage: dmg }, next, onBossKilled);
    lastTarget = next;
    chain--;
  }
}
```

### Testing

- Stormcall chain hops show lightning bolts between targets
- Visual matches existing lightning flash style (jagged path, glow, fade)
- Number of flashes matches chain count
- Regular lightning chain (non-Stormcall) unaffected
- Update `tests/unit/projectile-manager.test.js` — verify `spawnLightningFlash` called for each Stormcall hop

---

## Execution Order & Dependencies

```
Phase 1 (Sell Confirm)     — independent
Phase 2 (Panel Display)    — independent; recommended before Phase 3
Phase 3 (Spec+Lv5 Merge)   — depends on Phase 2 (panel changes)
Phase 4 (Cancel Build)     — depends on Phase 2 (setInterval reactive pattern for countdown)
Phase 5 (Elevation Range)  — independent
Phase 6 (Targeting)        — independent
Phase 7 (Gem Rewards)      — independent; test early to validate economy
Phase 8 (Railgun Balance)  — depends on Phase 6 (if fixed aim affects knockback)
Phase 9 (Stormcall Visual) — independent; quick fix
```

---

## Global Test Commands

After each phase:
```bash
npm run test          # Full test suite
npm run lint          # Lint check
```

Per-phase targeted tests:
```bash
npm run test -- tests/unit/towers.test.js
npm run test -- tests/unit/game-engine.test.js
npm run test -- tests/unit/projectile-manager.test.js
npm run test -- tests/unit/components/tower-panel.test.js
npm run test -- tests/unit/skill-tree.test.js
npm run test -- tests/unit/tower-manager.test.js
```
