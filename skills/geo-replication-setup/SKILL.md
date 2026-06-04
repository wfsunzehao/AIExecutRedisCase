---
name: geo-replication-setup
description: |
  Reusable Geo-Replication capability library for Azure Cache for Redis.
  Contains 7 atomic, composable capabilities (prereq / link / failover /
  reboot-failover / unlink / dns-verify / teardown). Cache **creation** is
  out of scope — use the `cache-creation` skill
  ([skills/cache-creation/](../cache-creation/SKILL.md)) to provision the
  Premium, non-AAD caches first; every helper here assumes the caches already
  exist in `Succeeded` provisioning state. Test cases compose these
  capabilities — they do NOT embed Geo workflow steps. Implementation lives in
  `create-geo.js`; this file is the single source of truth for capability
  contracts (inputs, pre/post-conditions, pitfalls).
applyTo: "**"
---

# Geo-Replication Capability Library

> **What this is:** a library of 8 atomic Geo capabilities. Each section below
> is a self-contained capability with declared inputs, helper API, pre-conditions,
> post-conditions / verification, and pitfalls.
>
> **What this is NOT:** an end-to-end test workflow. Test-case-specific flows
> (ADO 16021226, 16021140, 16021106, 15320703, …) live in their own test SKILL
> files and compose capabilities listed here — they do not re-implement steps.

---

## Capability Catalog

| # | Capability | Anchor | Helper(s) in [create-geo.js](create-geo.js) |
|---|---|---|---|
| 1 | Prereq | [#capability-1-geo-prereq](#capability-1-geo-prereq) | `assertGeoEnv` |
| 3 | Link | [#capability-3-geo-link](#capability-3-geo-link) | `invokeGeoLinkUI`, Portal list-blade polling, Portal row verification |
| 4 | Failover | [#capability-4-geo-failover](#capability-4-geo-failover) | `invokeGeoFailover`, `assertGeoRoleFlip`, `testGeoActivityLog` |
| 5 | Reboot-then-failover | [#capability-5-geo-reboot-failover](#capability-5-geo-reboot-failover) | `invokeRebootThenFailover`, `assertConcurrentNotifications` |
| 6 | Unlink | [#capability-6-geo-unlink](#capability-6-geo-unlink) | `invokeGeoUnlink`, `assertGeoUnlinked` |
| 7 | DNS verify | [#capability-7-geo-dns-verify](#capability-7-geo-dns-verify) | `testGeoDns` |
| 8 | Teardown | [#capability-8-geo-teardown](#capability-8-geo-teardown) | `invokeGeoTeardown` |

> Slot 2 (Provision) is intentionally vacant. Cache creation now lives in the
> [`cache-creation`](../cache-creation/SKILL.md) skill; existing anchors are
> kept stable so downstream test SKILLs do not need to be re-linked.

A capability is **atomic**: it advances exactly one piece of geo state, returns
a verifiable signal, and never assumes which capability comes next.

---

## Shared Conventions

These apply to every capability below. Capability sections reference this
section instead of restating its content.

### Execution model

- **Implementation lives in [create-geo.js](create-geo.js).** Capability sections are documentation; the Node module is the executable contract.
- **Invocation pattern (PowerShell here-string + `node -e`):**

  ```powershell
  $js = @'
  const geo = require("d:/junru/skills/geo-replication-setup/create-geo.js");
  const { chromium } = require("playwright");
  (async () => {
    // Environment checks only; do not use ARM/CLI for Geo operations.
    await geo.assertGeoEnv({ subscription, resourceGroup });

    // Geo operations must be completed through visible Portal UI clicks.
    const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
    const ctx = browser.contexts()[0];
    const page = ctx.pages().find(p => new URL(p.url()).hostname === "ms.portal.azure.com")
              || await ctx.newPage();
    await geo.invokeGeoLinkUI({ page, primary, secondary, subscription, resourceGroup });
  })().catch(e => { console.error(e.message); process.exit(1); });
  '@
  node -e $js
  ```

- **Never create per-capability `.js` files** in `%TEMP%` or the workspace. Use the `$js = @'…'@; node -e $js` here-string pattern.
- **Never call** `browser.disconnect()` or `browser.close()` after `connectOverCDP` — that would kill the real Edge. Let the Node process exit.
- **Portal page-click only for Geo operations.** Link, unlink, failover,
  reboot, teardown, and any equivalent management-plane action MUST be
  initiated by visible Azure Portal clicks in the live CDP browser session.
  Do not use ARM, Azure CLI, REST, SDK calls, or `invokeGeoLinkArm` /
  management-plane fallback paths to perform the operation. If the Portal UI
  cannot be clicked reliably, pause and ask the user to complete the exact
  Portal action manually, then resume from page-visible evidence.

### CDP Edge

- Endpoint: `http://127.0.0.1:9222` (**literal IPv4** — `localhost` resolves to `::1` and CDP only listens on IPv4).
- User data dir: `%USERPROFILE%\edge-cdp-profile` (dedicated; the `--remote-debugging-port` flag is silently dropped if reusing the default profile while another Edge instance is running).
- Sign in to `https://ms.portal.azure.com` once in that profile; subsequent runs reuse it.

### Long-wait commands

Capabilities that wait (Link, Failover, Unlink) can take 10–30 min.
Invoke them through `run_in_terminal` with `mode=sync` + a generous `timeout`
(≥ 1,200,000 ms for Link/Failover), and rely on
the VS Code exit notification. Do **not** use `mode=async`; do **not** wrap
with `Start-Sleep` polling loops.

### Naming

- Recommended cache-name pattern (matches legacy test runs and DNS helpers):
  `ManualTestingGeo-<region-short>-<MMDD>`. `<MMDD>` is the run date so
  concurrent runs don't collide.
- Region-short hints used by Portal-UI helpers' region picker:
  `EUS2E` → `East US 2 EUAP`, `SEA` → `Southeast Asia`,
  `CUSE` → `Central US EUAP`, `WCUS` → `West Central US`.
- All concrete cache names are caller-owned — every helper here takes explicit
  cache names; nothing in this library is computed from a date stamp anymore.

### Hard requirements (not overridable)

| Constraint | Reason |
|---|---|
| SKU = `Premium` | Basic/Standard cannot geo-link. |
| `aad-enabled = false` | AAD-only caches cannot participate in geo-replication. |
| `enableNonSslPort = false`, `minimumTlsVersion = 1.2` | Required by every test case this library targets; ensure your cache-creation flow sets these (or override only with explicit test-case justification). |

### ARM / API versions

- Cache PUT: `2023-05-01-preview`
- `linkedServers`: `2022-06-01`

### Reading semantics (very common error)

On a `linkedServers` entry, **`serverRole` describes the PEER**, not the queried cache.
So `GET /Redis/<X>/linkedServers` returning `serverRole = Primary` means **X
itself is the Secondary**. `assertGeoPair` and `assertGeoRoleFlip` enforce this
and capabilities calling them must propagate the failure without re-interpreting.

### Result recording

Result recording is **not** a capability of this library. The calling test SKILL
owns the `result.txt` write (or any equivalent reporting). Capabilities log
`Phase N PASS / FAIL`-style lines to stdout; the test SKILL aggregates and persists.

---

## Capability 1: geo-prereq

**Purpose** — Fail fast before any Geo capability runs. Verifies environmental
dependencies that every downstream capability assumes already true.

**When to use**

- **Always**, as the first step of any Geo composition.
- After a chat reset, restart, or VM reboot — CDP Edge port and Azure CLI auth are the two most common silent regressions.

**When NOT to use**

- Inside an inner loop (it's a one-shot gate, not a watchdog).
- To diagnose a specific Portal flake — use Playwright page state instead.

**Inputs** — `assertGeoEnv({ subscription, resourceGroup, cdpPort })`

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `subscription` | string (GUID) | yes | — | Target subscription ID. |
| `resourceGroup` | string | yes | — | Must already exist; this capability does NOT create it. |
| `cdpPort` | number | no | `9222` | TCP port for `chromium.connectOverCDP`. |

**Helper invocation**

```powershell
$js = @'
const geo = require("d:/junru/skills/geo-replication-setup/create-geo.js");
(async () => {
  await geo.assertGeoEnv({ subscription: "<sub>", resourceGroup: "<rg>" });
})().catch(e => { console.error(e.message); process.exit(1); });
'@
node -e $js
```

**Pre-conditions**

- Azure CLI installed and previously signed in (`az account show` works).
- Edge launched with `--remote-debugging-port=9222 --user-data-dir=%USERPROFILE%\edge-cdp-profile` and signed into `https://ms.portal.azure.com`.
- `playwright` available in Node's `require` resolution path.

**Post-conditions / Verification**

- Returns `true` and exits 0 when all of: `az --version`, `require.resolve("playwright")`, `az account set`, `az group show`, TCP connect to `127.0.0.1:<cdpPort>` within 2 s.
- Throws `Error("Phase 0 FAIL: <comma-list>")` on any failure. Stdout prints one `[OK]` / `[FAIL]` line per check.

**Pitfalls**

- **CDP port silently failing**: Edge was launched in the wrong user-data dir; the `--remote-debugging-port` flag is then ignored. Verify with `netstat -ano | findstr :9222` — must show exactly one LISTENING line.
- **`localhost` ↔ `127.0.0.1`**: do not change to `localhost` — Windows resolves it to `::1` and CDP only listens on IPv4.
- **CLI signed into wrong tenant**: `az account set` may succeed silently against a stale token. Run `az account show -o jsonc` once before composing.

---

<!-- Capability 2 (geo-provision) intentionally removed.
     Use the cache-creation skill (../cache-creation/SKILL.md) to create the
     Premium, non-AAD caches that downstream capabilities consume. -->

## Capability 3: geo-link

**Purpose** — Move one pair of caches from "two unrelated caches" to
"`Primary` ↔ `Secondary` linked pair". Combines:

1. **Initiation** — Portal UI clicks only (`invokeGeoLinkUI` or equivalent
  page-click sequence). Do not use ARM/CLI fallback to create the link.
2. **Submission evidence** — after clicking the Portal flow, treat either of
  these as a successful submission signal:
  - the page navigates to `GeoReplicationLinkProperties`; or
  - the primary cache Geo-replication blade lists the secondary cache with
    `Link provisioning status` = `Creating` or `Syncing`.
3. **Convergence** — poll the primary cache's Portal Geo-replication blade
  list, not ARM, until the linked row shows `Succeeded`.
4. **Verification** — verify the Portal list row shows the expected linked
  cache, peer role, linked cache location, and final `Succeeded` status.

**When to use**

- Right after the caches are created (by the cache-creation skill or any equivalent flow), before any failover / unlink / DNS test.
- To re-link after a previous Unlink in multi-cycle tests.

**When NOT to use**

- To reverse an existing link — use Failover.
- For 3-way / mesh topologies (out of scope).

**Inputs**

`invokeGeoLinkUI({ page, primary, secondary, subscription, resourceGroup, tenant?, screenshotPrefix? })`

| Field | Required | Notes |
|---|---|---|
| `page` | yes | Playwright `Page` attached to CDP Edge on `ms.portal.azure.com`. |
| `primary` | yes | Cache that initiates the link (becomes Primary). |
| `secondary` | yes | Peer (becomes Secondary). |
| `subscription`, `resourceGroup` | yes | — |
| `tenant` | no | Default `microsoft.onmicrosoft.com`. |
| `screenshotPrefix` | no | Used for `*-submit.png`, `*-copied.png`. |

`waitGeoLink({ ... })` and `assertGeoPair({ ... })` may exist in helper code
for diagnostics, but they must not replace Portal page-visible convergence and
verification when the test requires page-click execution.

**Helper invocation**

```powershell
$js = @'
const geo = require("d:/junru/skills/geo-replication-setup/create-geo.js");
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => new URL(p.url()).hostname === "ms.portal.azure.com")
            || await ctx.newPage();

  const primary   = "ManualTestingGeo-EUS2E-1118";
  const secondary = "ManualTestingGeo-SEA-1118";
  const sub = "<sub>", rg = "<rg>";

  await geo.invokeGeoLinkUI({ page, primary, secondary, subscription: sub, resourceGroup: rg });
  // Then poll the primary cache Geo-replication blade through Portal UI until
  // the linked row shows Link provisioning status = Succeeded.
})().catch(e => { console.error(e.message); process.exit(1); });
'@
node -e $js
```

**Observed Portal behavior to preserve**

- The final `Link` button may not be discoverable by a stable role selector in
  every Portal build. If the helper reports a timeout on the `Link` selector,
  do not immediately fail. First inspect the live page:
  - if the URL contains `GeoReplicationLinkProperties`, the link submission has
    likely succeeded;
  - if the primary Geo-replication blade lists the secondary cache with status
    `Creating` or `Syncing`, continue polling the Portal list page;
  - fail only when no linked-cache evidence appears or the Portal shows an
    explicit failure.
- The most reliable convergence page is the primary cache Geo-replication list
  blade. Reopen that blade and read the linked row instead of repeatedly
  reloading the link detail page, which may temporarily omit the status text.

**Pre-conditions**

- Caches exist with `Premium` SKU + `aad-enabled = false` on both sides (verify via `az redis show`).
- Prereq confirmed CDP Edge port (UI path).
- Pair must not already be linked (UI shows "Unlink" instead of "Add cache replication link") — re-linking on top of an existing link is undefined.

**Post-conditions / Verification**

- Both caches expose exactly one `linkedServers` entry, `provisioningState = Succeeded`.
- On primary, peer's `serverRole = Secondary`; on secondary, peer's `serverRole = Primary`.
- UI evidence (`*-submit.png`, `*-copied.png`) emitted when UI path used.

**Pitfalls**

- **"Add cache replication link" is a command-bar item, not a menu item.** Click by text, not `getByRole("menuitem", …)`.
- **Region pre-filter is mandatory before clicking the secondary row.** Without it, multiple regions render and `getByRole("gridcell", { name })` triggers Playwright strict-mode collision with notifications.
- **The picker row is a `gridcell`, not plain text.** `getByText(secondary)` collides with the Notifications flyout.
- **`Link` button must use `exact: true`.** Multiple `Link`-labeled controls exist on the blade.
- **Copy-to-clipboard tooltip is the only reliable evidence** of the link string — `navigator.clipboard.readText()` from Playwright is unreliable under Edge focus rules.
- **`serverRole` describes the peer.** Portal row role on the primary side should show the linked cache as `Secondary`; on the secondary side it should show the linked cache as `Primary`.
- **No ARM fallback for link creation.** If the Portal UI link flow is unstable, inspect page-visible submission evidence (`GeoReplicationLinkProperties`, `Creating`, `Syncing`) and continue from the Portal list blade. If there is no page-visible evidence, pause for manual Portal completion.

---

## Capability 4: geo-failover

**Purpose** — Initiate a single clean failover from the Portal UI on a linked
Geo-Primary, verify roles flipped via ARM, and confirm the Activity Log
`Add Redis Cache Linked Server / Succeeded` event on the new primary's
`/linkedservers/` resource (ADO 16021226 step 9).

**When to use**

- Standard "click Failover → confirm" Portal flow.
- After any feature operation that should still allow failover (Import, Scale Up, …).

**When NOT to use**

- Reboot-then-failover variant — use Reboot-then-failover instead.
- Stress flap loops (out of scope).

**Inputs**

`invokeGeoFailover({ page, cache, subscription, resourceGroup, tenant?, screenshotPrefix? })`

| Field | Required | Notes |
|---|---|---|
| `page` | yes | Playwright `Page` on CDP Edge. |
| `cache` | yes | The **current Geo-Primary** — failover is initiated from its blade. |
| `subscription`, `resourceGroup` | yes | — |
| `screenshotPrefix` | no | Used for `*-submit.png`. |

`assertGeoRoleFlip({ oldPrimary, oldSecondary, subscription, resourceGroup })` — after failover, `oldPrimary` exposes peer `serverRole = Primary` (peer is now primary → self is Geo-Secondary). `oldSecondary` exposes peer `serverRole = Secondary`.

`testGeoActivityLog({ newPrimary, resourceGroup, subscription?, offsetMin? })` — default `offsetMin = 30`; throws if no matching entry found.

**Helper invocation**

```powershell
$js = @'
const geo = require("d:/junru/skills/geo-replication-setup/create-geo.js");
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => new URL(p.url()).hostname === "ms.portal.azure.com")
            || await ctx.newPage();

  const oldPrimary   = "ManualTestingGeo-EUS2E-1118";   // currently Primary
  const oldSecondary = "ManualTestingGeo-SEA-1118";     // currently Secondary
  const sub = "<sub>", rg = "<rg>";

  await geo.invokeGeoFailover({ page, cache: oldPrimary, subscription: sub, resourceGroup: rg });
  await new Promise(r => setTimeout(r, 120_000));   // settle control plane
  await geo.assertGeoRoleFlip({ oldPrimary, oldSecondary, subscription: sub, resourceGroup: rg });
  await geo.testGeoActivityLog({ newPrimary: oldSecondary, resourceGroup: rg, subscription: sub });
})().catch(e => { console.error(e.message); process.exit(1); });
'@
node -e $js
```

**Pre-conditions**

- Linked pair confirmed by Link (or `assertGeoPair`).
- Caller knows **which side is currently Primary** — failover is initiated from the Primary blade.

**Post-conditions / Verification**

- `assertGeoRoleFlip` PASS → ARM control plane reports flipped pair, both sides `Succeeded`.
- `testGeoActivityLog` PASS → ≥ 1 `linkedservers` + `Succeeded` row on the new primary's resource ID within the offset window.

**Pitfalls**

- **Notifications flyout intercepts clicks** if open. Helper calls `closeNotificationsFlyout` first; do not skip.
- **"Failover" appears twice on the blade** — command-bar button + footer best-practices link. Use `getByRole("button", { name: "Failover", exact: true })`.
- **Confirm dialog is Yes/No, not OK/Cancel.** Reboot uses OK/Cancel; failover uses Yes/No.
- **Trust blade state, not click exit code.** Yes-button click may surface `strict-mode violation` or `target closed` after dialog dismisses successfully — wrap with `tolerate: true` (already in helper).
- **`serverRole` reads describe the PEER.** Post-failover, `GET .../linkedServers` on old primary returning `serverRole = Primary` means peer (old secondary) is now primary, i.e. old primary itself is Geo-Secondary.
- **Activity Log latency** 30–90 s. Poll only after ≥ 60 s — querying too early returns 0 matches.

---

## Capability 5: geo-reboot-failover

**Purpose** — ADO 16021140: exercise the race where a Reboot is submitted on
the Primary and a Failover is submitted on the Secondary within ≤ 2 s. Capture
the Notifications flyout showing both operations in flight.

**When to use** — specifically for ADO 16021140 and variants requiring concurrent reboot + failover.

**When NOT to use**

- Clean failover — use Failover.
- Reboot in isolation (out of scope).

**Inputs**

`invokeRebootThenFailover({ page, primary, secondary, subscription, resourceGroup, tenant? })`

| Field | Required | Notes |
|---|---|---|
| `page` | yes | Playwright `Page` attached to CDP Edge. |
| `primary` | yes | Current Geo-Primary — receives the reboot. |
| `secondary` | yes | Current Geo-Secondary — receives the failover. |
| `subscription`, `resourceGroup` | yes | — |

Returns `{ rebootAt, failoverAt, deltaSec }`. **`deltaSec ≤ 2` is the spec.**

`assertConcurrentNotifications({ page, screenshotPath? })` — opens the Notifications flyout and waits for both `Rebooting cache` and `Submitting failover request` to be visible (5 s each). Writes screenshot at `screenshotPath` (auto-named if omitted).

**Helper invocation**

```powershell
$js = @'
const geo = require("d:/junru/skills/geo-replication-setup/create-geo.js");
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => new URL(p.url()).hostname === "ms.portal.azure.com")
            || await ctx.newPage();

  const primary   = "ManualTestingGeo-CUSE-1118";
  const secondary = "ManualTestingGeo-WCUS-1118";
  const sub = "<sub>", rg = "<rg>";

  const r = await geo.invokeRebootThenFailover({ page, primary, secondary, subscription: sub, resourceGroup: rg });
  if (r.deltaSec > 2) throw new Error(`ADO 16021140 FAIL: deltaSec=${r.deltaSec}>2`);
  await geo.assertConcurrentNotifications({ page, screenshotPath: "reboot-failover-evidence.png" });

  await new Promise(r => setTimeout(r, 120_000));
  await geo.assertGeoRoleFlip({ oldPrimary: primary, oldSecondary: secondary, subscription: sub, resourceGroup: rg });
})().catch(e => { console.error(e.message); process.exit(1); });
'@
node -e $js
```

**Pre-conditions**

- Linked pair confirmed by Link.
- Caller knows which side is currently Primary.
- CDP Edge on `ms.portal.azure.com` already authenticated.

**Post-conditions / Verification**

- `deltaSec ≤ 2`.
- Both `Rebooting cache` and `Submitting failover request` visible in Notifications flyout at the same time.
- Screenshot evidence file written.
- Subsequent role check (`assertGeoRoleFlip`) confirms roles flipped.

**Pitfalls**

- **Port combobox options are `treeitem`, NOT `option`.** `getByRole("option", …)` will time out.
- **Reboot confirm dialog uses OK/Cancel; failover uses Yes/No.** Both happen in the same script — do not generalize.
- **No artificial waits between Reboot OK and Failover Yes.** Adding `waitForTimeout` or `closeNotificationsFlyout` between them blows the ≤ 2 s budget.
- **Run from a freshly-loaded Portal session.** A cluttered pre-existing Notifications flyout can intercept the Failover button on the secondary; helper closes it once but extra noise still adds latency.
- **`primary` receives reboot, `secondary` receives failover.** Swapping them produces a meaningless test.
- **Run `assertConcurrentNotifications` immediately** after `invokeRebootThenFailover` returns — the Rebooting cache toast disappears in ~60–180 s.

---

## Capability 6: geo-unlink

**Purpose** — Reverse a Link. Submit the unlink (Portal "Unlink caches" by
default, ARM `DELETE` fallback) and wait for **both sides** to drain — the
receiving side enters `Deleting` ~30–60 s after the initiating side finishes,
so a single ARM check immediately after submission is insufficient.

**When to use**

- Before Teardown for a clean unlink record (Activity Log + screenshot).
- Between cycles of link / failover / unlink in multi-iteration tests.
- When the scenario explicitly validates the unlink workflow.

**When NOT to use**

- For complete fleet destruction without verification — Teardown already runs a best-effort ARM unlink.
- As error-recovery sledgehammer for a half-linked pair (let `Deleting`/`Creating` settle first).

**Inputs**

`invokeGeoUnlink({ page?, caches, subscription, resourceGroup, mode?, tenant? })`

| Field | Required | Notes |
|---|---|---|
| `caches` | yes | Exactly **2** cache names: `[primary, secondary]`. Helper validates `length === 2`. |
| `subscription`, `resourceGroup` | yes | — |
| `mode` | no | `"UI" \| "Arm" \| "Auto"` (default `Auto` — UI first, ARM on UI failure). |
| `page` | conditional | Required when `mode = UI` or `Auto`. |

`assertGeoUnlinked({ caches, subscription, resourceGroup, maxMinutes? })` — default `maxMinutes = 15`. Delegates to `waitGeoLink({ expectEmpty: true })`. Pass all caches in the run.

**Helper invocation**

```powershell
$js = @'
const geo = require("d:/junru/skills/geo-replication-setup/create-geo.js");
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => new URL(p.url()).hostname === "ms.portal.azure.com")
            || await ctx.newPage();

  const primary   = "ManualTestingGeo-EUS2E-1118";
  const secondary = "ManualTestingGeo-SEA-1118";
  const sub = "<sub>", rg = "<rg>";

  await geo.invokeGeoUnlink({ page, caches: [primary, secondary], subscription: sub, resourceGroup: rg });
  await geo.assertGeoUnlinked({ caches: [primary, secondary], subscription: sub, resourceGroup: rg });
})().catch(e => { console.error(e.message); process.exit(1); });
'@
node -e $js
```

**Pre-conditions**

- Pair currently linked (`linkedServers` returns 1 entry per side with `Succeeded`).
- No in-flight failover. If one was just submitted, wait ~120 s and confirm `assertGeoPair` / `assertGeoRoleFlip` PASS before unlinking.

**Post-conditions / Verification**

- Every cache's `GET .../linkedServers` returns `value: []`.
- Pair is now two independent caches that can be re-linked, scaled, or deleted.

**Pitfalls**

- **Two-phase asynchrony**: clicking "Unlink" on side A drops A's entry first; B's entry transitions to `Deleting` only after control plane propagates. Budget ≥ 15 min.
- **"Unlink" appears twice on the blade**: command-bar `Unlink caches` button + footer "Unlink" best-practices link. Use `getByRole("button", { name: "Unlink caches", exact: true })`.
- **Confirm dialog is Yes/No** (same as failover; different from reboot).
- **No ARM fallback for unlink.** If the Portal `Unlink caches` flow is unstable, pause for manual Portal completion and resume only after the Geo-replication blade shows no linked cache entry.
- **Cleanup gate before delete**: Teardown calls `waitGeoLink({ expectEmpty: true })` internally, but calling Teardown immediately after a manual `invokeGeoUnlink` without `assertGeoUnlinked` may race `redis delete --no-wait` against a still-pending `linkedServers` entry (409).

---

## Capability 7: geo-dns-verify

**Purpose** — ADO 16021106: after a failover, both `.geo.` CNAME records (the
geo-Primary's and the geo-Secondary's) resolve to the **current** Geo-Primary's
`*.redis.cache.windows.net` host. Uses an external DNS resolver (default
`8.8.8.8`) to bypass local OS / browser DNS cache.

**When to use**

- Right after Failover or Reboot-then-failover when the test covers DNS.
- Periodically in long-soak tests to detect silent DNS regression.

**When NOT to use**

- As a substitute for `assertGeoRoleFlip` — DNS flip can lag the control-plane flip by minutes.
- For Redis data-plane connectivity testing — DNS resolution is necessary but not sufficient for `redis-cli`.

**Inputs** — `testGeoDns({ newPrimary, newSecondary, dnsServer })`

| Field | Required | Default | Notes |
|---|---|---|---|
| `newPrimary` | yes | — | **Currently** Geo-Primary (after failover, this is the old secondary). |
| `newSecondary` | yes | — | Currently Geo-Secondary. |
| `dnsServer` | no | `"8.8.8.8"` | External resolver; bypasses local cache. Internal corp resolvers may serve stale CNAMEs. |

Expected CNAME target: `<newPrimary>.redis.cache.windows.net`. Both `<newPrimary>.geo.redis.cache.windows.net` and `<newSecondary>.geo.redis.cache.windows.net` must resolve to it.

**Helper invocation**

```powershell
$js = @'
const geo = require("d:/junru/skills/geo-replication-setup/create-geo.js");
(async () => {
  await geo.testGeoDns({
    newPrimary:   "ManualTestingGeo-SEA-1118",     // was secondary, now primary
    newSecondary: "ManualTestingGeo-EUS2E-1118",
  });
})().catch(e => { console.error(e.message); process.exit(1); });
'@
node -e $js
```

**Pre-conditions**

- Failover / Reboot-then-failover reported PASS via `assertGeoRoleFlip`.
- 60–120 s settle since failover (DNS TTL ~ 60 s; propagation 5–15 min depending on resolver).

**Post-conditions / Verification**

- Returns `true` only if **both** `.geo.` records resolve to `<newPrimary>.redis.cache.windows.net`.
- Throws `Phase 5 FAIL (ADO 16021106): …` with offending records on mismatch.

**Pitfalls**

- **Never use bare `nslookup`.** Windows `nslookup` honors the local DNS client cache and returns stale answers for minutes. The helper uses Node's `dns.Resolver` against `8.8.8.8`.
- **Edge / Portal pages cache DNS aggressively** in their own resolver. Helper doesn't touch Edge — only Node's resolver.
- **CNAME normalization**: records come back with trailing dot and varying case. Helper lower-cases and string-compares; do not introduce manual matching.
- **TTL window**: query within 30 s of failover and both records may still point at old primary. Build in 60–120 s settle.
- **Corporate DNS may block `8.8.8.8`.** Override `dnsServer` to `1.1.1.1` if needed — but **not** a corp internal resolver that may cache longer than Azure's TTL.

---

## Capability 8: geo-teardown

**Purpose** — Drop every cache passed in. Best-effort ARM unlink + parallel
`az redis delete --no-wait` + remnant verification.

Steps the helper performs:

1. ARM-mode unlink of each consecutive pair (`caches[0]/caches[1]`, `caches[2]/caches[3]`, …), tolerating failures.
2. `waitGeoLink({ expectEmpty: true, maxMinutes: 15 })`.
3. Parallel `az redis delete --no-wait` for every cache.
4. 60 s settle, then per-cache `az redis show` to detect remnants.

**When to use**

- At the end of every Geo test run, regardless of pass / fail.
- After repeated link/unlink cycles to leave the subscription clean.

**When NOT to use**

- Mid-test error recovery — it deletes everything; you'll lose diagnostic state. Use Unlink for surgical recovery.
- Arbitrary single-cache cleanup outside the pair shape — for one-offs, call `az redis delete` directly.

**Inputs** — `invokeGeoTeardown({ subscription, resourceGroup, caches })`

| Field | Required | Notes |
|---|---|---|
| `subscription` | yes | — |
| `resourceGroup` | yes | — |
| `caches` | yes | Array of **full** cache names (no implicit date suffix). Length should be even (consecutive pairs are unlinked together). |

**Helper invocation**

```powershell
$js = @'
const geo = require("d:/junru/skills/geo-replication-setup/create-geo.js");
(async () => {
  await geo.invokeGeoTeardown({
    subscription: "<sub>",
    resourceGroup: "<rg>",
    caches: [
      "ManualTestingGeo-EUS2E-1118",
      "ManualTestingGeo-SEA-1118",
      "ManualTestingGeo-CUSE-1118",
      "ManualTestingGeo-WCUS-1118",
    ],
  });
})().catch(e => { console.error(e.message); process.exit(1); });
'@
node -e $js
```

**Pre-conditions**

- All in-flight Portal-UI operations have settled (no pending Failover dialog, no half-opened reboot blade) — otherwise ARM `DELETE` may race against Portal state.

**Post-conditions / Verification**

- Every name in `caches` either gone or `Deleting` (helper logs `[geo] WARN TEARDOWN PARTIAL: remaining=…` if any survived the 60 s settle — `--no-wait` makes this expected for ~5 min; confirm via a separate `az redis show` later).
- Returns `true` only when every name is fully gone.

**Pitfalls**

- **Unlink-then-delete ordering matters.** `az redis delete` against a still-linked cache surfaces 409 / "Cache is currently linked". Helper performs internal ARM unlink + `waitGeoLink({ expectEmpty: true })` for exactly this reason.
- **`--no-wait` does NOT mean fire-and-forget guaranteed.** It returns immediately but the resource may transition to `Deleting` only after the orchestrator picks it up (5–60 s). 60 s settle is the bare minimum.
- **WARN-level failures are normal during internal unlink step** (`[geo] WARN unlink step: …`). Helper continues to delete loop even on warning.
- **Soft-delete cooldown**: deleted names enter a reservation window (~1 h). Re-using the same name in a follow-up run may surface 409 `NameAlreadyReserved`. Pick a fresh suffix or wait.

---

## Composition Recipes

Reference recipes. Each test case lives in its own SKILL and composes
capabilities below; it is **not** the responsibility of this library to
enumerate them.

| Scenario | Recommended chain |
|---|---|
| Standard portal failover | Prereq → **cache-creation skill** → Link → Failover → Unlink |
| Reboot-then-failover (ADO 16021140) | Prereq → **cache-creation skill** → Link → Reboot-then-failover → Unlink |
| `.geo.` DNS flip (ADO 16021106) | Prereq → **cache-creation skill** → Link → Failover → DNS-verify → Unlink |
| Geo + Import / Benchmark / Upgrade / Scale / Persistence | Stage with Prereq → **cache-creation skill** → Link, invoke the feature-specific capability (out of this library), optionally Failover, finally Unlink and/or Teardown. |
| Re-stage on existing caches (skip cache creation) | Prereq → Link directly if `az redis show` already reports `Succeeded` + `aad-enabled=false`. |
| Full cleanup at end of run | Unlink → wait → Teardown. Teardown retries unlink in ARM mode but a clean preceding Unlink shortens it. |

**Composition rules** (applied by the calling test SKILL, not by this library):

- Each capability returns a verifiable signal — propagate failures upward, do not silently swallow.
- Verification belongs to the capability that produced the state. Do not duplicate `assertGeoPair` after a freshly-returned Link PASS; **do** call it again if state may have drifted (long pause, parallel run, recovery from a chat reset).
- A test SKILL must not inline ARM bodies, polling loops, or Playwright orchestration — extend the relevant capability instead.

---

## Out of scope

- End-to-end test orchestration (which capability to call when) — owned by the test SKILL.
- Reverse-failover stress loops and link/unlink stress patterns.
- AAD-only Geo configurations (blocked by design).
- Persistence / VNet-injected / AZ-enabled cache shapes — compose with a separate cache-creation skill, then invoke Link.
- Redis data-plane validation (`SET / GET / INFO / redis-cli`) — use a separate validation skill.
