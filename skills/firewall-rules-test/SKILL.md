---
name: firewall-rules-test
description: |
  Reusable Firewall-Rules capability library for Azure Cache for Redis.
  Contains atomic, composable capabilities for the
  `Firewall and virtual network` (Networking) blade — environment prereq,
  baseline connectivity, blade UI primitives, rule add (dialog), rule edit
  (inline), discard-with-confirm, and persisted-row inspection. Cache
  **creation** is out of scope — use the `cache-creation` skill
  ([../cache-creation/SKILL.md](../cache-creation/SKILL.md)) to provision the
  Premium cache first; every helper here assumes the cache already exists in
  `Succeeded` provisioning state with Public endpoint + Non-TLS port +
  Access Keys enabled (and Entra disabled). Test cases compose these
  capabilities — they do NOT embed Portal-UI clicks. Implementation lives in
  [firewall-lib.js](firewall-lib.js); this file is the single source of truth
  for capability contracts (inputs, pre/post-conditions, pitfalls).
applyTo: "**"
---

# Firewall-Rules Capability Library

> **What this is:** a library of atomic Firewall capabilities for the Portal
> Networking → Firewall blade. Each section below is self-contained: declared
> inputs, helper API, pre-conditions, post-conditions / verification, pitfalls.
>
> **What this is NOT:** an end-to-end firewall test workflow. Test-case
> specific flows (e.g. `Test_Case/Firewall/Firewall-Unified-Flow.md`) live
> in their own test SKILL/MD files and compose capabilities listed here —
> they do not re-implement Portal-UI clicks.

---

## Capability Catalog

| # | Capability | Anchor | Helper(s) in [firewall-lib.js](firewall-lib.js) |
|---|---|---|---|
| 1 | Prereq + connect | [#capability-1-fw-prereq](#capability-1-fw-prereq) | `connect`, `getFwFrame` |
| 2 | Blade reload | [#capability-2-fw-reload](#capability-2-fw-reload) | `reloadBlade` |
| 3 | Toolbar inspect / click | [#capability-3-fw-toolbar](#capability-3-fw-toolbar) | `getToolbarStates`, `clickToolbar`, `waitSaveDisabledAgain` |
| 4 | Add rule (dialog flow) | [#capability-4-fw-add](#capability-4-fw-add) | `fillNewRule`, `clickDialogOk`, `clickDialogCancel` |
| 5 | Inline edit (saved row) | [#capability-5-fw-inline-edit](#capability-5-fw-inline-edit) | `inlineEditByIndex` |
| 6 | Discard with confirm | [#capability-6-fw-discard](#capability-6-fw-discard) | `confirmUnsavedChanges`, `discardAndConfirm` |
| 7 | Persisted-row inspect | [#capability-7-fw-row-inspect](#capability-7-fw-row-inspect) | `visibleRuleNames`, `getRowCount`, `deleteLastRow` |
| 8 | ARM read/write fallback | [#capability-8-fw-arm](#capability-8-fw-arm) | `restList`, `restPut`, `restDelete`, `restDeleteAll` |
| 9 | Field validation read | [#capability-9-fw-errors](#capability-9-fw-errors) | `getFieldErrors` |
| 10 | Row trash + quota banner | [#capability-10-fw-trash-quota](#capability-10-fw-trash-quota) | `clickRowTrash`, `getBannerTexts` |

A capability is **atomic**: it advances exactly one piece of blade state,
returns a verifiable signal, and never assumes which capability comes next.

---

## Shared Conventions

### Execution model

- **Implementation lives in [firewall-lib.js](firewall-lib.js).** Capability
  sections are documentation; the Node module is the executable contract.
- **Invocation pattern (PowerShell here-string + `node -e`)**, identical to
  the `geo-replication-setup` skill:

  ```powershell
  $js = @'
  const lib = require("d:/junru/skills/firewall-rules-test/firewall-lib.js");
  (async () => {
    const { p } = await lib.connect();
    await lib.reloadBlade(p);
    const f = await lib.getFwFrame(p, 90000);
    console.log(JSON.stringify(await lib.getToolbarStates(f)));
  })().catch(e => { console.error(e.message); process.exit(1); });
  '@
  node -e $js
  ```

- **Never call** `browser.disconnect()` / `browser.close()` after
  `connectOverCDP` — that kills the real Edge. Let the Node process exit.

### CDP Edge

- Endpoint: `http://127.0.0.1:9222` (**literal IPv4** — `localhost` resolves
  to `::1` and CDP only listens on IPv4).
- User data dir: `%USERPROFILE%\edge-cdp-profile` (dedicated; the
  `--remote-debugging-port` flag is silently dropped if the default profile
  is reused while another Edge instance is running).
- Sign in to `https://ms.portal.azure.com` once; subsequent runs reuse it.

### Target cache (current run)

| Field | Value |
|---|---|
| Subscription | `Cache Team - Vendor CTI Testing 2` (`1e57c478-0901-4c02-8d35-49db234b78d2`) |
| Resource group | `test_song` |
| Cache | `fwtest-cuse-0602` |
| SKU | Premium P1 |
| Region | Central US EUAP |
| Public endpoint | enabled |
| Non-TLS port | enabled |
| Access keys | enabled |
| Entra (AAD) | disabled |

These are encoded as constants at the top of [firewall-lib.js](firewall-lib.js)
(`SUB`, `RG`, `CACHE`, `ARM_ID`, `FW_URL`). For a different cache, edit those
constants.

### ARM API version

- `firewallRules`: `2024-11-01`
- All ARM helpers go through `az rest` so they inherit the user's signed-in
  Azure CLI session.

### Portal hash-routing pitfall

Portal uses **hash-route URLs**. `page.goto(FW_URL)` is a **no-op** if the
page already lives at the same hash — React state from prior dirty edits will
remain visible. **Always go to `about:blank` first** (this is what
`reloadBlade` does internally).

### Long-wait commands

Most capabilities here are sub-30s. The only slow operation is the Save round
trip after a Save click — wait via `waitSaveDisabledAgain` (default 60 s).
Use `run_in_terminal` `mode=sync` with `timeout=300000` (5 min) for the full
2.x-style scripts.

### Hard requirements (not overridable)

| Constraint | Reason |
|---|---|
| Cache SKU = Premium | Required by the test plan; non-Premium hides some toolbar items. |
| `enableNonSslPort = true` | redis-cli baseline PING must work without TLS plumbing. |
| Access keys enabled, Entra (AAD) disabled | Auth-coupling assumed by every PING-based stage. |

---

## Capability 1: fw-prereq

**Purpose** — Attach to the CDP Edge browser, locate the Portal page, and
return both the page and the iframe that hosts the Firewall blade. Fails fast
if the blade isn't reachable.

**When to use**

- **Always**, as the first call of any firewall composition.

**When NOT to use**

- Inside an inner loop (one-shot gate).

**Inputs**

`connect()` — no params; reads `FW_URL` constant from the module.

`getFwFrame(page, timeoutMs = 60000)` — returns the iframe whose origin is
`sandbox-1.reactblade-ms.portal.azure.net` and whose body contains the
firewall blade markers.

**Pre-conditions**

- Edge launched with the right CDP flags + user-data-dir; signed into the
  Portal (see [Shared Conventions](#shared-conventions)).
- `playwright` available in Node's `require` resolution.

**Post-conditions / Verification**

- Returns `{ b: Browser, p: Page }`. `p.url()` includes `firewallRules`.
- `getFwFrame` returns a `Frame` whose `getToolbarStates` succeeds.

**Pitfalls**

- **Login redirect**: if the page is on `login.microsoftonline.com`, the user
  must first sign in inside the CDP Edge window — automation cannot bypass
  MFA.
- **Multiple iframes**: `getFwFrame` does its own structural probe; do NOT
  filter by `frame.name()` (it changes between Portal versions).

---

## Capability 2: fw-reload

**Purpose** — Force a true server reload so React drops any stale dirty state
and any open dialogs. This is the most important pitfall-fix in this library.

**When to use**

- Before every "fresh state" verification (start of stage, between scenarios).
- When a previous run left dirty state behind.

**Inputs**

`reloadBlade(page)` — no extra params.

**Behavior**

1. Best-effort: try `getFwFrame` for up to 8 s.
2. Press **Escape** twice (closes Add dialog, Confirm dialog, etc.).
3. If toolbar `Discard` is enabled, call `discardAndConfirm` to clear dirty.
4. Register a one-shot `dialog → accept` to swallow any `beforeunload`
   prompt.
5. `page.goto('about:blank')` → wait → `page.goto(FW_URL)` → wait 6 s for
   the blade to render.

**Post-conditions**

- Toolbar reads `Save: disabled, Discard: disabled, Add: enabled`.
- All dialogs closed.
- Persisted rules visible exactly as ARM reports them.

**Pitfalls**

- **Hash-routing bug**: skipping the `about:blank` step makes `goto(FW_URL)`
  a no-op, leaving stale dirty React state. `reloadBlade` always inserts
  `about:blank`.
- **`beforeunload` dialog**: appears if Portal still has dirty state when we
  navigate. The pre-emptive `Escape × 2` + auto-accept handles this.

---

## Capability 3: fw-toolbar

**Purpose** — Read and click the three command-bar buttons (`Save`, `Discard`,
`Add`) and wait for `Save` to disable again after a successful save.

**Inputs**

| Helper | Params | Returns |
|---|---|---|
| `getToolbarStates(frame)` | — | `{ Save:{disabled}, Discard:{disabled}, Add:{disabled} }` |
| `clickToolbar(frame, label)` | label = `Save` / `Discard` / `Add` | throws on disabled |
| `waitSaveDisabledAgain(frame, timeoutMs = 60000)` | — | `true` on clean, `false` on timeout |

**Pitfalls**

- The toolbar buttons have `role="menuitem"` (not `role="button"`) — text
  filter matches by `innerText`, not `aria-label`.
- After typing in inputs, give the toolbar **≥ 1 s** to update before reading
  state — React debounces dirtiness.

---

## Capability 4: fw-add (dialog flow)

**Purpose** — Open the Add Firewall Rule dialog, fill three text fields,
click `Ok` (which only enables when all fields validate), and return to the
blade with the new row queued for save.

**The Add UI is a modal dialog** — it is **not** an inline new row. The
dialog has three inputs + `Ok` / `Cancel` buttons. `Ok` is only enabled when
all three fields are valid.

**Helpers**

`fillNewRule(frame, { name, startIP, endIP })`

- Locates inputs by **`<label for>` text** (`Rule name` / `Start IP address` /
  `End IP address`), picks the **last** matching input (the dialog appears
  on top of any existing inline inputs).
- Uses **real keyboard input**: `el.click({ clickCount: 3 })` to select all,
  `Delete`, then `page.keyboard.type(value, { delay: 30 })`. **Do not** use
  `el.fill()` or direct `.value =` — Fluent UI `TextField` only registers
  React `onChange` for real key events.
- Trailing `Tab` triggers field-level validation.

`clickDialogOk(frame, timeoutMs = 8000)`

- Polls for the **literal `'Ok'`** text button (NOT `aria-label`); waits for
  it to become enabled, then clicks. Returns `'ok'` / `'timeout-disabled'`
  / `'timeout-not-found'`.

`clickDialogCancel(frame)` — symmetric Cancel button.

**Pitfalls**

- **`el.fill()` is silent**: Fluent's `TextField` does not pick up the change,
  `Ok` stays disabled even though the DOM `value` is set. Always use real
  keyboard.
- **Pre-filled phantom values**: after a previous dirty-state, the dialog can
  open with stale values *the React tree never registered*. Always
  `reloadBlade` first (Capability 2).
- **`Ok` disabled = real validation error**: name collision (rule already
  exists), IP malformed, or `End < Start`. Read field errors with
  `getFieldErrors` (Capability 9) before retrying.
- **Toolbar `Save` does not auto-enable** — it only enables once `Ok` is
  clicked successfully. If `Save` stays disabled after a fill, your `Ok`
  click did not land.

---

## Capability 5: fw-inline-edit

**Purpose** — Modify the IP fields of a **persisted** row in-place (no
dialog). The grid renders persisted rules with `Name` as plain text and
`Start IP` / `End IP` as `<input>` elements. Editing one input dirties the
toolbar (`Save` + `Discard` enable).

**Helper**

`inlineEditByIndex(page, frame, ruleName, colIndex, newValue)`

- `colIndex`: `0` = Start IP, `1` = End IP.
- Locates the target row by **leaf-text match** on the rule name (works for
  both persisted rows where the name is text, and unsaved rows where the
  name lives outside `<td>`).
- Uses real mouse click (`el.click({ clickCount: 3 })`) + `keyboard.type` so
  Fluent UI `TextField` `onChange` fires (the only way to dirty React).
- Trailing `Tab` triggers field-level validation.

**Composition recipe**

```js
const lib = require("d:/junru/skills/firewall-rules-test/firewall-lib.js");
const { p } = await lib.connect();
await lib.reloadBlade(p);
const f = await lib.getFwFrame(p, 90000);
// Widen 0.0.0.0/0.0.0.0 -> 0.0.0.0/255.255.255.255 (edit End first!)
await lib.inlineEditByIndex(p, f, "block_all", 1, "255.255.255.255");
await lib.clickToolbar(f, "Save");
await lib.waitSaveDisabledAgain(f, 60000);
```

**Pre-conditions**

- The rule has been persisted (`Save` clicked + `waitSaveDisabledAgain`
  returned `true`) and the blade has been reloaded so the row is in
  “persisted” mode.

**Post-conditions / Verification**

- `getToolbarStates` returns `{ Save:{disabled:false}, Discard:{disabled:false} }`.
- DOM `input.value` reflects the typed value.
- `restList()` (after Save) reflects the new IP.

**Pitfalls**

- **Validator forbids `End < Start` at every keystroke.** When **widening**
  a range, edit **End first**; when **narrowing**, edit **Start first**.
  Otherwise `Save` is silently disabled (toolbar shows Discard enabled but
  Save disabled) and `clickToolbar(f, 'Save')` will throw.
- **`input.focus()` does not dirty React** — only a real mouse click does.
  `inlineEditByIndex` uses `el.click({ clickCount: 3 })` for this reason.
- **The Name column is text-only on persisted rows** — there is no name
  `<input>`. This naturally enforces “name not editable after save”.
- **Matching by current value is fragile** when both Start and End share a
  value (e.g. both `0.0.0.0`) — always match by row + column index.

---

## Capability 6: fw-discard

**Purpose** — Clicking the toolbar `Discard` opens a modal **"Unsaved
Changes"** confirm dialog with `Yes` / `No`. The dirty state is only rolled
back after `Yes` is clicked.

**Helpers**

`confirmUnsavedChanges(frame, choice = 'Yes', timeoutMs = 5000)` — finds the
visible `[role="dialog"]` whose `innerText` matches `/unsaved/i`, clicks the
`Yes` or `No` button inside it, returns `'ok'` / `'btn-not-found'` /
`'not-found'` / `'timeout'`.

`discardAndConfirm(frame, timeoutMs = 15000)` — one-shot composition:

1. `clickToolbar(frame, 'Discard')`
2. `confirmUnsavedChanges(frame, 'Yes', 8000)`
3. Wait until `getToolbarStates` reports `Save: disabled, Discard: disabled`.

Returns `true` (toolbar clean) or `false` (timeout).

**Post-conditions**

- (Add+Ok-not-Save) — all unsaved new rows disappear; ARM unchanged.
- (Inline edit) — the IP input reverts to its persisted value; ARM unchanged.

**Pitfalls**

- **Forgetting the confirm dialog** — `clickToolbar('Discard')` alone leaves
  the blade in the "Unsaved Changes" modal; subsequent operations fail with
  `Save: disabled` because the modal is blocking interaction. Always use
  `discardAndConfirm`.
- **Timing** — give 800 ms after the Discard click before the modal renders.
  `discardAndConfirm` already does this.

---

## Capability 7: fw-row-inspect

**Purpose** — Enumerate persisted (and unsaved) rules from the rendered grid
without depending on DOM `td`/`role="cell"` structure (which is inconsistent
across Portal versions for unsaved rows).

**Recipe**

```js
const names = await lib.visibleRuleNames(f);
// or, if you only need a count:
const count = await lib.getRowCount(f);
```

`getRowCount(frame)` and `deleteLastRow(frame)` are convenience helpers for
classic table-driven flows. For unsaved rows whose name lives outside a
table cell, `visibleRuleNames` (which scans rows by `<input>` containment)
is the reliable choice.

**Pitfalls**

- **`td`-based scans miss unsaved rows** — the new-row name is rendered in a
  flex container, not inside `<td>`. Use the leaf-text scan above.
- **Multiple Discards / saves** can leave **phantom DOM nodes** for ~1 s
  while React reconciles. Sleep 500 ms after `discardAndConfirm` before
  re-scanning.

---

## Capability 8: fw-arm (ARM read/write fallback)

**Purpose** — Bypass the UI when seeding state (preconditions for a stage),
asserting the persisted truth (post-conditions), or recovering from a stuck
UI run.

**Helpers**

| Helper | Method | Returns / effect |
|---|---|---|
| `restList()` | GET `/firewallRules` | `[{ name, start, end }]`; `name` is auto-stripped of the `<cache>/` prefix |
| `restPut(name, start, end)` | PUT `/firewallRules/<name>` | throws on non-2xx |
| `restDelete(name)` | DELETE `/firewallRules/<name>` | throws on non-2xx |
| `restDeleteAll()` | enumerate then DELETE each | best-effort |

**ARM body quirk** — `az rest --body '<json>'` fails on PowerShell with
`Unsupported Media Type`. Always pass `--headers "Content-Type=application/json"`
and prefer a `--body @file.json` form for any ad-hoc PUT.

**Pitfalls**

- **`restList()` returns `<cache>/<rule>`** as `name` — `firewall-lib.js`
  strips the prefix; if you ever copy the helper elsewhere, retain the
  `.split('/').pop()` logic.
- **ARM and UI can disagree for ~1 s** — after Save, ARM is updated before
  the grid re-renders. Always `waitSaveDisabledAgain` before
  `restList`.

---

## Capability 9: fw-errors

**Purpose** — Read field-level validation errors for a stuck Add dialog.

**Helper**

`getFieldErrors(frame)` — returns `[{ tag, txt, invalid }]` for every visible
`[role="alert"]`, `.ms-TextField-errorMessage`, or `[aria-invalid="true"]`.

**Use it when** — `clickDialogOk` returns `'timeout-disabled'`. The error
text tells you which field is invalid (collision name / malformed IP /
`End < Start`).

---

## Capability 10: fw-trash-quota

**Purpose** — Drive per-row deletion via the inline trash button, and
detect the 20-operation quota banner that appears once the unsaved-edit
count reaches the limit.

**Helpers**

| Helper | Returns |
|---|---|
| `clickRowTrash(frame, ruleName)` | `'clicked'` / `'no-leaf'` / `'no-trash'` |
| `getBannerTexts(frame)` | `string[]` — visible banner strings (filters very long ones) |

**Quota signature** — once 20 unsaved edits accumulate, the blade does
**not** disable the toolbar `Add` button. Instead:

- every visible `<input>` becomes `disabled` / `readOnly`,
- every per-row trash button becomes disabled,
- a banner appears with the literal text:
  `Maximum 20 rules can be edited at once. Please save changes before making more edits.`

Detect quota by either condition (input/trash mass-disable **or** banner
match), not by `Add.disabled` alone.

**Multi-batch UI cleanup recipe** — delete > 20 rules through the UI by
respecting the quota:

```js
for (let pass = 1; pass <= 5; pass++) {
  let f = await lib.getFwFrame(p, 90000);
  const names = await lib.visibleRuleNames(f);
  if (names.length === 0) break;
  for (const nm of names.slice(0, 20)) {
    await lib.clickRowTrash(f, nm);
    await new Promise(r => setTimeout(r, 400));
  }
  await lib.clickToolbar(f, 'Save');
  await lib.waitSaveDisabledAgain(f, 180000);
  await new Promise(r => setTimeout(r, 3000)); // ARM-LRO buffer
  await lib.reloadBlade(p);
}
```

**Pitfalls**

- **Trash `aria-label` varies** — some Portal versions use
  `"Delete Firewall rule "` (with trailing space + name), others just
  `"Delete"`. `clickRowTrash` matches both via
  `aria-label*="Delete Firewall" i, aria-label*="elete" i`.
- **Successive trash clicks need ≥ 300–500 ms between them** — the row
  removal animation reorders sibling rows; clicking too fast finds a stale
  leaf reference.

---

## Test Case Composition

This skill was driven end-to-end by
[`Test_Case/Firewall/Firewall-Unified-Flow.md`](../../Test_Case/Firewall/Firewall-Unified-Flow.md)
against `fwtest-cuse-0602`. All seven stages PASS:

| Stage | Description | Status | Composition |
|---|---|---|---|
| 0 | Cache provision + baseline PING | ✓ PASS | `cache-creation` skill, then `connect` + redis-cli PING |
| 0.7 / 1.1 | Open Firewall blade, toolbar baseline disabled | ✓ PASS | `connect` → `reloadBlade` → `getToolbarStates` |
| 2.1 | Add with illegal IP → Ok stays disabled | ✓ PASS | `clickToolbar('Add')` → `fillNewRule` → `clickDialogOk` returns `timeout-disabled` |
| 2.2 | End < Start IP → Ok stays disabled | ✓ PASS | same composition with `endIP < startIP` |
| 2.3 | Illegal name characters → Ok stays disabled | ✓ PASS | same composition |
| 2.4 | Duplicate rule name → Ok stays disabled | ✓ PASS | seed via `restPut` → `clickToolbar('Add')` → fill same name |
| 2.5 | Edit existing rule → bad IP → Ok stays disabled | ✓ PASS | inline edit + `getFieldErrors` |
| 2.6 | Add legal rule + Save, then verify name lock & IP editable | ✓ PASS | `clickToolbar('Add')` → `fillNewRule` → `clickDialogOk` → `clickToolbar('Save')` → `waitSaveDisabledAgain` → `reloadBlade` → row-inspect (name is text, IPs are inputs) → inline edit dirties toolbar → `discardAndConfirm` |
| 2.7 | Discard removes unsaved adds; Discard restores edited IPs | ✓ PASS | `clickToolbar('Add')` × 2 + Ok (no Save) → `discardAndConfirm` → leaf-text scan; then inline edit `10.30.0.1` → `10.30.0.99` → `discardAndConfirm` → IP back to `10.30.0.1` |
| 3.1 | Add `block_all` 0.0.0.0–0.0.0.0 + Save → redis-cli BLOCKED | ✓ PASS | `Add` → `fillNewRule` → `clickDialogOk` → `Save` → wait ≥ 60 s → redis-cli PING (`spawnSync ETIMEDOUT`) |
| 3.2 | Edit `block_all` to 0.0.0.0–255.255.255.255 → redis-cli PONG | ✓ PASS | `inlineEditByIndex(p, f, 'block_all', 1, '255.255.255.255')` (End first!) → `Save` → wait → PING `PONG` |
| 3.3 | Edit `block_all` to my-public-IP / my-public-IP → redis-cli PONG | ✓ PASS | detect public IP (`api.ipify.org`) → `inlineEditByIndex` col 1 then col 0 → `Save` → PING `PONG` |
| 4.1 | Add unsaved → row visible | ✓ PASS | `clickToolbar('Add')` → `fillNewRule` → `clickDialogOk` → leaf-text scan |
| 4.2 | Discard → unsaved row rolled back | ✓ PASS | `discardAndConfirm` |
| 4.3 | Reload → rule never persisted | ✓ PASS | `reloadBlade` → leaf-text scan + `restList` |
| 4.4 | Click trash on saved rule (no Save) → Discard → reload → still exists | ✓ PASS | per-row trash click via `aria-label*="Delete Firewall"` → `discardAndConfirm` → `reloadBlade` → verify `restList` |
| 5.1 | Multi-row trash → rows removed + toolbar dirty | ✓ PASS | trash click × N → `getToolbarStates` |
| 5.2 | Save → ARM commits delete | ✓ PASS | `clickToolbar('Save')` → `waitSaveDisabledAgain` → (≥ 1.5 s buffer) → `restList` |
| 5.3 | Navigate to Overview blade & back → deletions stick | ✓ PASS | `goto('about:blank')` → `goto(<overview>)` → `reloadBlade` → leaf-text scan |
| 6.1 | 20 unsaved Add ops → quota banner + all editing UI disabled | ✓ PASS | loop `Add`/`fillNewRule`/`clickDialogOk` × 20 → scan `[role="status"]` for `Maximum 20 rules can be edited at once. Please save changes before making more edits.` + verify all `<input>` and trash buttons disabled |
| 6.2 | `Save` commits 20 + banner clears | ✓ PASS | `clickToolbar('Save')` → `waitSaveDisabledAgain(180000)` → sleep ≥ 2 s → `restList` (length 20) → banner re-scan empty |
| 6.3 | Continue editing without refresh | ✓ PASS | `clickToolbar('Add')` → dialog opens → `fillNewRule` → `clickDialogOk` returns `ok` (no `reloadBlade` in between) |
| 7.1 | Delete every rule via UI trash + Save (multi-batch on > 20) | ✓ PASS | loop `visibleRuleNames` → `clickRowTrash` × N → `clickToolbar('Save')` → `waitSaveDisabledAgain(180000)` → `reloadBlade` (Capability 10 recipe) → `restList()` returns `[]` |

Stages 7.2 (turn off Non-SSL port) and 7.3 (delete the cache resource) are
marked optional in the flow doc — omit when keeping the cache around for
regression. Cache deletion, when needed, is delegated to the
`cache-creation` skill’s teardown helpers.

---

## Pitfall Quick-Reference

Ten pitfalls that consumed the most diagnostic time during the end-to-end
run — in roughly the order you'll hit them:

1. **`page.goto(FW_URL)` is a no-op on hash-route same-page** → always
   `about:blank` first (Capability 2).
2. **`el.fill()` does not trigger Fluent UI `TextField` onChange** → use
   real `el.click({ clickCount: 3 })` + `keyboard.type` (Capability 4 / 5).
3. **`input.focus()` does not dirty React for inline edit** → use real
   mouse click (Capability 5).
4. **`Discard` opens a confirm dialog** — without `Yes`, dirty state
   persists (Capability 6).
5. **Persisted-row name is `<td>` text, not `<input>`** — that’s how
   “name not editable after save” is enforced (Capability 5/7).
6. **Validator forbids `End < Start` at every keystroke** when inline-editing
   IPs → widen-range: edit End first; narrow-range: edit Start first
   (Capability 5).
7. **redis-cli (v3.2.100) ignores `-t`** → enforce timeout via Node
   `cp.execSync({ timeout })`. A blocked connection appears as
   `spawnSync ... ETIMEDOUT` (firewall drops SYN, no RST).
8. **`waitSaveDisabledAgain` returns before ARM is consistent** — the
   toolbar disables ~1–2 s before the ARM PUT/DELETE LRO finishes. After
   Save, sleep ≥ 1.5 s (or retry `restList` once) before asserting on
   `restList()` results (Capability 8).
9. **At the 20-op quota the toolbar `Add` button is *not* disabled** — the
   blade instead disables every `<input>` and every per-row trash button,
   and renders banner text `Maximum 20 rules can be edited at once. Please
   save changes before making more edits.` Detect quota by either condition,
   not by `Add.disabled` alone.
10. **First `clickToolbar('Add')` after a successful Add can be ignored**
    — the toolbar re-renders while React commits the previous row. Use a
    retry loop (≤ 4 attempts × 1.5 s) probing for a visible `label[for]`
    matching `/rule name/i` to confirm the dialog actually opened.
