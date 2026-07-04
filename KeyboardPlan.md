# Keyboard Navigation Plan for Menus and Dialogs

## Current State

The app has keyboard support only for in-game actions (`src/game/Input.ts`). Menus and dialogs have **zero** keyboard navigation -- no focus tracking, no arrow key support, no Enter-to-activate. Interactive elements like map cards and skill nodes are `<div>`s with `@click` handlers, not `<button>`s.

---

## Design Principles

1. **Reactive `activeIndex`**: Each menu/dialog owns a single `ref(0)` field. This field drives **both** the visual focus ring **and** activation. No separate focus-tracking system.
2. **Unified nearest-button algorithm**: A single utility finds the next button in any direction using `getBoundingClientRect()` projection. Works for vertical stacks, horizontal bars, and 2D grids identically.
3. **Top-overlay priority**: When an overlay is open, only that overlay handles keys. Nothing underneath receives input. Each overlay governs its own buttons.
4. **Auto-focus on open**: The first button receives focus when a menu/dialog opens, using a `watch` on `activeIndex` + `nextTick` for DOM readiness.
5. **Uniform Enter behavior**: Enter activates whatever button is currently active. Replaces the existing "Enter = confirm dialog only" behavior. Left/Right on ConfirmDialog lets the user switch to Cancel, and Enter with Cancel active presses Cancel.

---

## Architecture

### Navigation Registry

A module-level registry in `src/composables/useMenuNav.ts` tracks all registered menus and determines which one is "active" (topmost).

```ts
// Module-level registry (not a Pinia store)
const registeredMenus: Map<string, MenuHandler> = new Map()

interface MenuHandler {
  context: string           // e.g. "mainMenu", "confirmDialog"
  isActive: () => boolean   // checks if this menu is currently visible
  handleKeydown: (event: KeyboardEvent) => void
  unmount: () => void
}

function getActiveMenu(): MenuHandler | null
function register(handler: MenuHandler): void
function unregister(context: string): void
```

**Priority order** for `getActiveMenu()` (highest to lowest):

1. `confirmDialog` -- modal always on top of everything
2. Route screens (`mapSelect`, `endScreen`, `history`) -- active when current route matches
3. `mainMenu` -- full-screen overlay
4. `skillTree` -- full-screen overlay
5. `statsPanel` -- overlay
6. `helpDialog` -- overlay
7. `randomMapPanel` -- overlay (if present)
8. Game overlays (`gameHud`, `gameShop`, `towerPanel`, `debugPanel`) -- only active during gameplay with no menu open

### Nearest-Button Utility

```ts
// src/composables/useMenuNav.ts
function findNearestInDirection(
  elements: HTMLElement[],
  currentIdx: number,
  direction: 'up' | 'down' | 'left' | 'right'
): number
```

**Algorithm:**

1. Compute `getBoundingClientRect()` for all elements
2. Get current element's center `(cx, cy)`
3. For direction `up`: score each element as `cy - by` (positive = above current). Select element with smallest positive score. If no element is above, wrap to element with largest `by` (bottommost).
4. For `down`: score as `by - cy`. Select smallest positive. Wrap to topmost.
5. For `left`: score as `cx - bx`. Select smallest positive. Wrap to rightmost.
6. For `right`: score as `bx - cx`. Select smallest positive. Wrap to leftmost.

**This handles all layouts uniformly:**
- **Vertical stacks** (all x aligned): Up/Down reduces to previous/next in list, wrapping at edges
- **Horizontal bars** (all y aligned): Left/Right reduces to previous/next, wrapping at edges
- **Grids** (MapSelect 6x6, SkillTree columns): 2D nearest search picks the button closest in the pressed direction, with edge wrapping

### Per-Menu Component Pattern

Each menu/dialog component follows this pattern:

```ts
// Reactive state
const activeIndex = ref(0)
const buttonElements = ref<HTMLElement[]>([])
const buttonActions = ref<(() => void)[]>([])

// Activation (generic, called by Enter)
function activate() {
  const idx = activeIndex.value
  if (idx >= 0 && idx < buttonActions.value.length) {
    buttonActions.value[idx]()
  }
}

// Keyboard handler (called by registry dispatch)
function handleKeydown(event: KeyboardEvent) {
  const dirMap: Record<string, 'up' | 'down' | 'left' | 'right'> = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  }
  const dir = dirMap[event.key]
  if (dir) {
    event.preventDefault()
    activeIndex.value = findNearestInDirection(buttonElements.value, activeIndex.value, dir)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    activate()
  }
}

// Auto-focus on mount
watch(activeIndex, (newIdx) => {
  const el = buttonElements.value[newIdx]
  if (el) el.focus()
})

onMounted(() => {
  nextTick(() => {
    const el = buttonElements.value[0]
    if (el) el.focus()
  })
  register({ context: 'menuName', isActive: () => visible, handleKeydown, unmount })
})

onUnmounted(() => {
  unregister('menuName')
})
```

**Template pattern:**

```html
<button
  v-for="(action, idx) in buttonActions"
  :key="idx"
  :class="{ focused: idx === activeIndex }"
  ref="(el) => { if (el) buttonElements[idx] = el }"
  @click="action()"
>
  Label
</button>
```

### Input.ts Changes

Input.ts becomes the **single dispatcher** for all keyboard events. It checks the registry for an active menu and dispatches to it, otherwise falls through to game actions.

```ts
// At the top of handle():
const activeMenu = getActiveMenu()
if (activeMenu && event.key !== 'Escape') {
  activeMenu.handleKeydown(event)
  return  // menu owns all keys except Escape
}

// Escape is handled by the active menu's handler via registry dispatch.
// When no menu is active, Escape falls through to existing handler.
// Game-specific keys (u, s, digits, Tab, Space) only apply when no menu is active
```

**Input.ts changes summary:**
- Add registry check at top of `handle()` for arrow keys and Enter
- **Remove or gate the existing `case "Escape"` block** -- when a menu is open, the registry handles Escape; when no menu is open, the existing Escape logic (close dialogs, cancel build, deselect, open menu) applies
- **Remove `case "Enter"` branch for `uiStore.confirmDialog`** -- the menu registry handles confirm dialog activation uniformly
- Skip game actions when a menu is active

**Key routing rules:**

| Key | Menu Open | No Menu Open |
|---|---|---|
| Arrow keys | Navigate menu buttons | Game actions (speed, upgrade) |
| Enter | Activate active menu button | Activate menu / build mode placement |
| Escape | Close menu (handled by registry dispatch) | Close menu / cancel / deselect / open menu |
| Tab | Ignored (menu uses arrow keys) | Cycle towers/build types (existing) |
| u / s | Ignored | Upgrade / sell (existing) |
| Digits 1-9 | Ignored | Select build type (existing) |
| Space | Ignored | Toggle pause (existing) |

**Escape handling**: The registry dispatches Escape to the active menu's `handleKeydown`. Each menu's handler closes itself (e.g. `uiStore.closeAllDialogs()`). **Input.ts must NOT double-handle Escape** -- the existing `case "Escape"` block that calls `uiStore.closeAllDialogs()` should be removed or gated so it only runs when no menu is registered. This avoids double-close behavior.

This means when a menu is open, arrow keys, Enter, and Escape go to the menu, and all other keys are ignored (the game is paused or the user is on a non-game screen).

---

## Per-Component Implementation

### MainMenu.vue -- Vertical Stack

**Buttons** (visible subset based on context):
1. Resume (only when `gameStore.isInGame`)
2. End Run (only when `gameStore.isInGame`)
3. New Game (only when NOT in game)
4. Upgrades! (always)
5. Run History (only when NOT in game)

**Changes:**
- Add `activeIndex`, `buttonElements`, `buttonActions`, `activate()`, `handleKeydown()`
- Build button arrays dynamically based on `gameStore.isInGame`
- Register with context `"mainMenu"`
- Auto-focus first visible button on mount

### EndScreen.vue -- Vertical Stack

**Buttons:**
1. Play Again
2. Select Map
3. Upgrades!
4. Main Menu

**Changes:** Same pattern as MainMenu. Register with context `"endScreen"`.

### ConfirmDialog.vue -- Horizontal Pair

**Buttons:**
1. Cancel
2. Confirm

**Changes:**
- Add `activeIndex`, `buttonElements`, `buttonActions`, `activate()`, `handleKeydown()`
- Register with context `"confirmDialog"` (highest priority)
- Default `activeIndex = 1` (Confirm) on mount
- Left/Right switches between Cancel and Confirm
- Enter presses whichever is active (uniform logic, replaces existing "Enter = confirm only")
- **Input.ts change required**: Remove the `case "Enter"` branch that checks `uiStore.confirmDialog` and calls `uiStore.executeConfirm()` -- the menu registry handles this now

### GameHud.vue -- Horizontal Bar

**Buttons:**
1. Pause/Resume
2. Speed
3. Statistics
4. Help
5. Menu

**Changes:**
- Add `activeIndex`, `buttonElements`, `buttonActions`, `activate()`, `handleKeydown()`
- Register with context `"gameHud"` (lowest priority, only active during gameplay with no menu)
- Left/Right cycles through 5 buttons
- Enter activates current button
- Registers unconditionally; registry priority bypasses this when a menu overlay is open

### GameShop.vue -- Horizontal Bar

**Buttons** (6 tower selectors):
1. Tower 1 through Tower 6

**Changes:**
- Convert `<div class="shop-tower">` to `<button>` elements
- Add `activeIndex`, `buttonElements`, `buttonActions`, `activate()`, `handleKeydown()`
- Register with context `"gameShop"`
- Left/Right cycles through 6 towers
- Enter activates current tower (same as click)
- Registers unconditionally; registry priority bypasses this when a menu overlay is open

### TowerPanel.vue -- Vertical Stack

**Buttons** (visible subset, 8+ total):
1. Aim direction N (conditional)
2. Aim direction W (conditional)
3. Aim direction Auto (conditional)
4. Aim direction E (conditional)
5. Aim direction S (conditional)
6. Specialization A (conditional)
7. Specialization B (conditional)
8. Upgrade (conditional)
9. Cancel Build (conditional)
10. Sell (always when tower selected)
11. Targeting mode `<select>` dropdown (native keyboard accessible)

**Changes:**
- Add `activeIndex`, `buttonElements`, `buttonActions`, `activate()`, `handleKeydown()`
- Register with context `"towerPanel"`
- Up/Down cycles through visible buttons
- Enter activates current button
- **Existing u/s/ArrowUp shortcuts preserved**: These call engine methods directly and are handled by Input.ts when no menu is open. The new arrow-key navigation is an alternative path.

### DebugPanel.vue -- Vertical Stack

**Buttons:**
1. +1000 Gold
2. +100 Gems
3. +10 Lives
4. Skip Wave
5. Kill All
6. Set Wave 50
7. Unlock All Maps
8. Toggle 8x Speed

**Changes:**
- Add `activeIndex`, `buttonElements`, `buttonActions`, `activate()`, `handleKeydown()`
- Register with context `"debugPanel"`
- Up/Down cycles through 8 buttons
- Enter activates current button

### MapSelect.vue -- 6x6 Grid

**Buttons:**
1. Back (header)
2. 36 Map Cards

**Changes:**
- Convert `<div class="map-card">` to `<button>` elements
- Add `activeIndex`, `buttonElements`, `buttonActions`, `activate()`, `handleKeydown()`
- Register with context `"mapSelect"` (priority: route screen)
- Back button included in navigation pool (Up from top row can reach it)
- Arrow keys use nearest-button algorithm (2D grid navigation with wrapping)
- Enter activates selected map or Back button

### SkillTree.vue -- Mixed Layout (Unified Pool)

**Buttons:**
1. Back
2. General addon tier buttons (already `<button>` elements)
3. Skill nodes (currently `<div>` with `@click`: level nodes, specialization nodes, add-on nodes)
4. Reset Profile (already `<button>`)

**Changes:**
- Convert `<div class="skill-node">` to `<button>` elements
- All interactive elements participate in **one unified navigation pool** (addon buttons, skill nodes, Back, Reset all in same list)
- Note: addon tier buttons and Reset Profile are already `<button>` elements; only skill nodes need conversion
- Add `activeIndex`, `buttonElements`, `buttonActions`, `activate()`, `handleKeydown()`
- Register with context `"skillTree"`
- Arrow keys use nearest-button algorithm across all elements
- Enter activates current element
- Unified pool may jump between columns and addon bars, but this is predictable and simpler to implement

### StatsPanel.vue -- Read-Only

**No changes needed.** Single close button, no navigation required.

### HelpDialog.vue -- Read-Only

**No changes needed.** Single close button, no navigation required.

### HistoryScreen.vue -- Vertical List

**Buttons:**
1. Back
2. Play Again (per history card)

**Changes:**
- Ensure all interactive elements are `<button>` tags (verify Back and Play Again are already buttons)
- Add `activeIndex`, `buttonElements`, `buttonActions`, `activate()`, `handleKeydown()`
- Register with context `"history"` (priority: route screen)
- Arrow keys use nearest-button algorithm (vertical list)
- Enter activates current button
- Tab/Shift+Tab also works for native browser traversal

---

## CSS Changes

Add focus ring style to `src/App.vue`:

```css
.focused {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
```

Each component applies `:class="{ focused: idx === activeIndex }"` to its buttons. The reactive field keeps the class in sync with keyboard navigation.

---

## File Changes Summary

| File | Change Type | Description |
|---|---|---|
| `src/composables/useMenuNav.ts` | **New** | `findNearestInDirection()` utility + navigation registry (register/unregister/getActive) |
| `src/game/Input.ts` | **Modify** | Add registry check at top of handler; dispatch to active menu for arrow keys/Enter; remove or gate existing Escape handler so registry handles it when menu is open; remove Enter case for confirmDialog; skip game actions when menu is active |
| `src/App.vue` | **Modify** | Add `.focused` CSS class |
| `src/components/MainMenu.vue` | **Modify** | Add keyboard nav pattern (activeIndex, buttonRefs, @keydown, activate, register) |
| `src/components/EndScreen.vue` | **Modify** | Same pattern |
| `src/components/ConfirmDialog.vue` | **Modify** | Same pattern (horizontal, default focus on Confirm idx=1) |
| `src/components/GameHud.vue` | **Modify** | Same pattern (horizontal, unconditional registration) |
| `src/components/GameShop.vue` | **Modify** | Same pattern + convert divs to buttons |
| `src/components/TowerPanel.vue` | **Modify** | Same pattern (vertical, keep u/s shortcuts in Input.ts) |
| `src/components/DebugPanel.vue` | **Modify** | Same pattern |
| `src/components/MapSelect.vue` | **Modify** | Same pattern + convert divs to buttons + Back in navigation pool |
| `src/components/SkillTree.vue` | **Modify** | Same pattern + convert divs to buttons + unified navigation pool |
| `src/components/HistoryScreen.vue` | **Modify** | Same pattern (verify button elements) |

---

## Implementation Order

1. **Infrastructure**: `useMenuNav.ts` (utility + registry), CSS in `App.vue`, Input.ts guard/dispatch
2. **Simple vertical menus**: ConfirmDialog, MainMenu, EndScreen (most common pattern, fewest buttons)
3. **Horizontal bars**: GameHud, GameShop (convert divs to buttons)
4. **Game-internal overlays**: TowerPanel, DebugPanel
5. **Grid layouts**: MapSelect, SkillTree (convert divs, verify nearest-button algorithm for 2D)
6. **Route screens**: HistoryScreen (lightweight)
7. **Verify**: Run `npm run lint`, `npm run typecheck`, `npm run test`

---

## Open Considerations

- **DOM timing for grid layouts**: The nearest-button algorithm relies on `getBoundingClientRect()`. For MapSelect and SkillTree, the grid may not be fully laid out when the component mounts (virtual scrolling, lazy rendering). The algorithm should compute positions on each keypress, not cache them.
- **SkillTree scroll behavior**: When arrow keys navigate to a button outside the visible viewport, the container should auto-scroll to bring it into view. This can be done via `el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })` in the `watch(activeIndex)` handler.
- **GameHud/GameShop registration**: These components can register unconditionally. The registry's `getActive()` priority order handles bypassing (menu overlays > game overlays), so no conditional logic is needed in the components.
- **Escape key conflict**: `Input.ts` currently handles Escape by calling `uiStore.closeAllDialogs()`. With the registry-based approach, Escape is dispatched to the active menu's handler. Input.ts must not double-handle Escape -- either remove the existing `case "Escape"` block entirely (let the registry handle it) or gate it to only run when `getActiveMenu()` returns null.
- **`randomMapPanelVisible` in uiStore**: The uiStore has a `randomMapPanelVisible` flag but no corresponding component file exists yet. If this panel is implemented, it should be registered with the menu navigation system and added to the priority list between `helpDialog` and game overlays.
- **Test coverage**: Component tests for keyboard navigation should be added for each menu/dialog. The existing `tests/unit/components/` directory should get new test files or additions to existing ones.
