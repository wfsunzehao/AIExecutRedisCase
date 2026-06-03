---
name: redis-persistence
description: |
  Reusable Persistence (AOF + RDB) capability library for Azure Cache for Redis.
  Contains 8 atomic, composable capabilities (prereq / provision-caches /
  provision-storage / enable-nonssl / enable-persistence / populate /
  verify-blob / teardown). Storage account and Premium P1 cache provisioning
  are **in scope** here (unlike geo / import-export which delegate cache
  creation) because the test cases this library targets pin specific cache
  config (`disableAccessKeyAuthentication=false`, `aad-enabled=false`,
  `publicNetworkAccess=Enabled`, Premium P1, API `2024-03-01`). Test cases
  compose these capabilities — they do NOT embed Persistence workflow steps.
  Implementation lives in `create-persistence.js` (Node.js + Playwright);
  this file is the single source of truth for capability contracts (inputs,
  pre/post-conditions, pitfalls).
applyTo: "**"
---

# Redis Persistence Capability Library

> **What this is:** a library of 8 atomic Persistence capabilities. Each
> section below is a self-contained capability with declared inputs, helper
> invocation, pre-conditions, post-conditions / verification, and pitfalls.
>
> **What this is NOT:** an end-to-end test workflow. Test-case-specific flows
> (`Test_Case/Premium cache.csv` Step 5 / Step 6, …) live in their own test
> SKILL files and compose capabilities listed here — they do not re-implement
> steps.

---

## Capability Catalog

| # | Capability | Anchor | Helper(s) in [create-persistence.js](create-persistence.js) |
|---|---|---|---|
| 1 | Prereq | [#capability-1-pers-prereq](#capability-1-pers-prereq) | `assertPersistenceEnv` |
| 2 | Provision caches | [#capability-2-pers-provision-caches](#capability-2-pers-provision-caches) | `invokePersistenceCacheProvision` |
| 3 | Provision storage | [#capability-3-pers-provision-storage](#capability-3-pers-provision-storage) | `invokePersistenceStorageProvision` |
| 4 | Enable Non-SSL | [#capability-4-pers-enable-nonssl](#capability-4-pers-enable-nonssl) | `invokePersistenceEnableNonSslUI`, `invokePersistenceEnableNonSslArm`, `assertPersistenceNonSslEnabled` |
| 5 | Enable persistence | [#capability-5-pers-enable-persistence](#capability-5-pers-enable-persistence) | `invokePersistenceEnableUI`, `waitPersistenceReady` |
| 6 | Populate | [#capability-6-pers-populate](#capability-6-pers-populate) | `invokePersistencePopulate` |
| 7 | Verify blob | [#capability-7-pers-verify-blob](#capability-7-pers-verify-blob) | `assertPersistenceBlob` |
| 8 | Teardown | [#capability-8-pers-teardown](#capability-8-pers-teardown) | `invokePersistenceTeardown` |

A capability is **atomic**: it advances exactly one piece of persistence
state, returns a verifiable signal (exit code + ARM/blob/DBSIZE evidence), and
never assumes which capability comes next. Capability 5 + 7 are invoked
**twice** in the AOF → RDB compositions: once with `mode="AOF"`, once with
`mode="RDB"`.

---

## Shared Conventions

These apply to every capability below. Capability sections reference this
section instead of restating its content.

### Execution model

- **Implementation lives in [create-persistence.js](create-persistence.js).** Capability sections are documentation; the Node module is the executable contract.
- **Invocation pattern (PowerShell here-string + `node -e`):**

  ```powershell
  $js = @'
  const pers = require("d:/junru/skills/redis-persistence/create-persistence.js");
  const { chromium } = require("playwright");
  (async () => {
    // ARM-only capabilities (Prereq, Provision-*, Populate, Verify-Blob, Teardown):
    await pers.assertPersistenceEnv({ subscription, resourceGroup });

    // UI capabilities (Enable-NonSSL, Enable-Persistence) — attach to CDP Edge, never close it:
    const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
    const ctx = browser.contexts()[0];
    const page = ctx.pages().find(p => new URL(p.url()).hostname === "ms.portal.azure.com")
              || await ctx.newPage();
    await pers.invokePersistenceEnableUI({ page, subscription, resourceGroup, cache,
                                           mode: "AOF", storageAccount });
  })().catch(e => { console.error(e.message); process.exit(1); });
  '@
  node -e $js
  ```

- **Never create per-capability `.js` files** in `%TEMP%` or the workspace. Use the `$js = @'…'@; node -e $js` here-string pattern.
- **Never call** `browser.disconnect()` or `browser.close()` after `connectOverCDP` — that would kill the real Edge. Let the Node process exit.
- **Never spawn a new Edge** if port 9222 already has one listening — attach.

### MCP

A thin MCP wrapper exposes every capability as a JSON-callable tool — see
[mcp/README.md](mcp/README.md). Use it when an AI agent should drive the
flow without shelling out `node -e` itself.

### CDP Edge

- Endpoint: `http://127.0.0.1:9222` (**literal IPv4** — `localhost` resolves to `::1` and CDP only listens on IPv4).
- User data dir: `%USERPROFILE%\edge-cdp-profile` (dedicated; the `--remote-debugging-port` flag is silently dropped if reusing the default profile while another Edge instance is running).
- Sign in to `https://ms.portal.azure.com` once in that profile; subsequent runs reuse it.
- Launch (one-time):

  ```powershell
  & "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
    --remote-debugging-port=9222 `
    --user-data-dir="$env:USERPROFILE\edge-cdp-profile"
  ```

### Long-wait commands

Capabilities that wait (cache provision → all `Succeeded`, persistence save →
`provisioningState=Succeeded`, blob write polling) can take 10–60 min. Invoke
them through `run_in_terminal` with `mode=sync` + a generous `timeout`
(≥ 1,200,000 ms for cache provisioning), and rely on the VS Code exit
notification. Do **not** use `mode=async`; do **not** wrap with `Start-Sleep`
polling loops.

### Naming

| Resource | Pattern | Notes |
|---|---|---|
| Cache 1 | `ManualTest-9484-CUSE-<MMDD>` | `centraluseuap` |
| Cache 2 | `ManualTest-9484-EUS2E-<MMDD>` | `eastus2euap` |
| Storage Account | `manualtest9484sa<MMDD>` | Lowercase 3–24 chars; same region as primary cache. |
| Persistence container | `<cacheLower>-redis-persistence` | Auto-created by the Redis service on first Save. |
| Screenshot dir | `D:\Claude-Redis\screenshots\<cache>\` | Holds `pers-<cache>-<mode>-{open,sa,saved}.png`. |

All concrete cache / storage / container values are caller-owned — every
helper takes them as explicit arguments; nothing in this library is computed
from a date stamp implicitly. `<MMDD>` in the table above is just the
reference convention from ADO 15379484 run history.

### Hard requirements (not overridable)

| Constraint | Reason |
|---|---|
| Cache PUT API `2024-03-01` | `disableAccessKeyAuthentication` is rejected on older versions; the helper hard-codes this version. |
| Cache SKU = `Premium` (P1+) | Basic / Standard tier has no Persistence blade. |
| `aad-enabled = false`, `disableAccessKeyAuthentication = false` | The Persistence UI Save uses shared-key against the storage account; AAD-only caches fail validation. |
| `publicNetworkAccess = Enabled` | The test cases this library targets pin public endpoint. |
| `enableNonSslPort = true` (during run) | Bundled `redis-cli` 3.2.100 has no `--tls` flag; all data-plane evidence (PING / DBSIZE) goes over port 6379. The 5.x build at `D:\Claude-Redis\tools\redis\` supports `--tls`, but Capability 4 still flips Non-SSL on for ADO compliance. |
| Cache has write access to storage | Either shared-key (default in this library) or MI + `Storage Blob Data Contributor` on the storage account. |

### ARM / API versions

- `Microsoft.Cache/Redis` PUT (cache provision): `2024-03-01`
- `Microsoft.Cache/Redis` show / list / update: Azure CLI defaults.
- `Microsoft.Storage/storageAccounts` ops: Azure CLI defaults.

### Reading semantics (very common error)

- **`redisConfiguration.aof-backup-enabled` / `rdb-backup-enabled` are strings** (`"true"`/`"false"`), not booleans. `waitPersistenceReady` already compares against `"true"`.
- **`redis-benchmark -r 20000` produces ~19,000–19,900 unique keys**, not 20,000 (hash collisions). DBSIZE assertions must use `>= 19000`, not `== 20000`.
- **Persistence Save returns control before the cache transitions to `Succeeded`.** The control plane may report `Updating` for 5–30 min. Always chain `waitPersistenceReady` after `invokePersistenceEnableUI`.
- **AOF blob name contains `aof`; RDB blob name contains `rdb`.** Pattern matching is case-insensitive in `assertPersistenceBlob` (uses `String#toLowerCase`).

### Result recording

Result recording is **not** a capability of this library. The calling test
SKILL owns the `result.txt` write (or any equivalent reporting). Capabilities
log `PASS / FAIL`-style lines to stdout and emit Portal screenshots; the test
SKILL aggregates and persists.

---

## Capability 1: pers-prereq

**Purpose** — Fail fast before any Persistence capability runs. Verifies
environmental dependencies that every downstream capability assumes already
true.

**When to use**

- **Always**, as the first step of any Persistence composition.
- After a chat reset, restart, or VM reboot — CDP Edge port and Azure CLI auth are the two most common silent regressions.

**When NOT to use**

- Inside an inner loop (it's a one-shot gate, not a watchdog).
- To diagnose a specific Portal flake — use Playwright page state instead.

**Inputs**

| Field | Required | Notes |
|---|---|---|
| `subscription` | yes | Target subscription ID. |
| `resourceGroup` | yes | Must already exist; this capability does NOT create it. |
| `cdpPort` | no | Default `9222`. |
| `redisToolsDir` | no | Default `D:\Claude-Redis\tools\redis`. |

**Helper invocation**

```powershell
$js = @'
const pers = require("d:/junru/skills/redis-persistence/create-persistence.js");
(async () => {
  await pers.assertPersistenceEnv({
    subscription:  "<sub>",
    resourceGroup: "<rg>",
  });
})().catch(e => { console.error(e.message); process.exit(1); });
'@
node -e $js
```

**Pre-conditions**

- Azure CLI installed and previously signed in (`az account show` works).
- Edge launched with `--remote-debugging-port=9222 --user-data-dir=%USERPROFILE%\edge-cdp-profile` and signed into `https://ms.portal.azure.com`.
- `redis-cli.exe` and `redis-benchmark.exe` 5.x present at `D:\Claude-Redis\tools\redis\` (bundled `3.2.100` lacks `--tls` / `--no-auth-warning`).
- `playwright` available in Node's `require` resolution path.

**Post-conditions / Verification**

- All of: `az --version`, `az account set`, `az group show`, both Redis exes present, TCP connect to `127.0.0.1:9222` within 2 s.
- Throws `Phase 0 FAIL: <comma-list>` on any failure. Stdout prints one `[OK]` / `[FAIL]` line per check.

**Pitfalls**

- **CDP port silently failing**: Edge was launched in the wrong user-data dir; the `--remote-debugging-port` flag is then ignored. Verify with `netstat -ano | findstr :9222` — must show exactly one LISTENING line.
- **`localhost` ↔ `127.0.0.1`**: do not change to `localhost` — Windows resolves it to `::1` and CDP only listens on IPv4.
- **PowerShell 5.1 non-interactive may not resolve `az`** — fall back to the absolute path `C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd` (the helper does this).
- **`redis-cli` resolution**: helper looks under `D:\Claude-Redis\tools\redis\` by default. Override via `REDIS_TOOLS_DIR` env or the `redisToolsDir` argument.

---

## Capability 2: pers-provision-caches

**Purpose** — PUT one or more Premium P1 caches with the exact config the
test cases require: `aad-enabled = false`, `disableAccessKeyAuthentication =
false`, `publicNetworkAccess = Enabled`, `minimumTlsVersion = 1.2`,
`enableNonSslPort = false` (flipped on later by Capability 4),
`redisVersion = latest`. Poll until every cache is `Succeeded` and verify the
config matches.

**When to use**

- Once per test run — provisions the Premium caches this library targets.
- After teardown — to re-stage caches under fresh names (soft-delete cooldown applies to the OLD names).

**When NOT to use**

- For reusing pre-existing Premium caches that already match the config — skip this capability.
- For non-Premium SKUs, AMR (Enterprise), VNet-injected, or AAD-only caches — those need a different provisioning skill ([`cache-creation`](../cache-creation/SKILL.md), [`geo-replication-setup`](../geo-replication-setup/SKILL.md)).

**Inputs**

| Field | Required | Notes |
|---|---|---|
| `subscription`, `resourceGroup` | yes | — |
| `caches` | yes | Array of `{ name, location }`. Location is ARM-form (e.g. `centraluseuap`). |
| `maxMinutes` | no | Polling deadline. Default `60`. |
| `pollSec` | no | Poll interval. Default `180`. |

**Helper invocation**

```powershell
$js = @'
const pers = require("d:/junru/skills/redis-persistence/create-persistence.js");
(async () => {
  await pers.invokePersistenceCacheProvision({
    subscription:  "<sub>",
    resourceGroup: "<rg>",
    caches: [
      { name: "ManualTest-9484-CUSE-0527",  location: "centraluseuap" },
      { name: "ManualTest-9484-EUS2E-0527", location: "eastus2euap"   },
    ],
  });
})().catch(e => { console.error(e.message); process.exit(1); });
'@
node -e $js
```

**Pre-conditions**

- Prereq PASS.
- Subscription / RG has Premium quota in each target region.
- Cache names are not in the soft-delete cooldown window (~1 h).

**Post-conditions / Verification**

- Every cache exists with `provisioningState = Succeeded`.
- For every cache: `sku.name == "Premium"`, `aad-enabled == "false"`, `publicNetworkAccess == "Enabled"`, `disableAccessKeyAuthentication == false`. Throws on mismatch.

**Pitfalls**

- **`disableAccessKeyAuthentication` rejected by older API versions** — helper hard-codes `api-version=2024-03-01`. Do not downgrade.
- **EUAP regions are slow** — `centraluseuap` / `eastus2euap` provisioning routinely takes 8–12 min. Keep `maxMinutes ≥ 60`.
- **Soft-delete reservation** (~1 h) blocks re-using a freshly-deleted name — pick a new `<MMDD>` suffix or wait.
- **Tenant quota errors** surface as HTTP 400 / 409 from the PUT — read `r.raw` from the thrown error; do not retry blindly.

---

## Capability 3: pers-provision-storage

**Purpose** — Create a `StorageV2 / Standard_LRS` storage account used as the
persistence target. The Persistence service auto-creates the
`<cacheLower>-redis-persistence` container on first Save; this capability
only stages the account.

**When to use**

- Once per test run, alongside Capability 2.
- After teardown of a prior run — same name within soft-delete cooldown will surface 409.

**When NOT to use**

- For reusing a pre-existing storage account in the same region — skip this capability.

**Inputs**

| Field | Required | Notes |
|---|---|---|
| `subscription`, `resourceGroup` | yes | — |
| `name` | yes | Lowercase, 3–24, alphanumeric only. |
| `location` | no | Default `centraluseuap`. Should match (or co-locate with) the primary cache for lowest persistence latency. |

**Helper invocation**

```powershell
$js = @'
const pers = require("d:/junru/skills/redis-persistence/create-persistence.js");
(async () => {
  await pers.invokePersistenceStorageProvision({
    subscription:  "<sub>",
    resourceGroup: "<rg>",
    name:          "manualtest9484sa0527",
    location:      "centraluseuap",
  });
})().catch(e => { console.error(e.message); process.exit(1); });
'@
node -e $js
```

**Pre-conditions**

- Prereq PASS.
- Subscription / RG has quota for a new storage account.

**Post-conditions / Verification**

- Account exists with `provisioningState = Succeeded`. Throws otherwise.
- Idempotent: if the account already exists, helper logs `STORAGE <name> already exists` and re-verifies state.

**Pitfalls**

- **Storage account names are globally unique.** `AccountNameAlreadyTaken` means somebody else owns it — pick a new suffix.
- **`--allow-blob-public-access true`** is what the Persistence service expects for the auto-created container; restrictive tenant policies may override and force `false`, which still works but may surface odd ACL errors at Save time.
- **Cross-region storage** adds Persistence latency. Keep storage in (or near) the cache region.

---

## Capability 4: pers-enable-nonssl

**Purpose** — Flip `enableNonSslPort = true` via Advanced settings blade so
port 6379 is reachable for `redis-cli` / `redis-benchmark` data-plane
evidence. ARM fallback when UI is unavailable; UI path is preferred so the
test case demonstrates the toggle.

**When to use**

- Right after Capability 2 (caches `Succeeded`).
- Whenever a test case explicitly validates the Advanced settings toggle.

**When NOT to use**

- When the test client has a TLS-capable `redis-cli` (e.g. 5.x at `Claude-Redis\tools\redis\`) **and** the test does not require the UI toggle as evidence. In that case talk to 6380 directly.

**Inputs**

| Field | Required | Notes |
|---|---|---|
| `subscription`, `resourceGroup`, `cache` | yes | — |
| `tenant` | no | Default `microsoft.onmicrosoft.com`. |

**Helper invocation**

```powershell
$js = @'
const pers = require("d:/junru/skills/redis-persistence/create-persistence.js");
const { chromium } = require("playwright");
(async () => {
  const sub = "<sub>", rg = "<rg>", cache = "<cache>";

  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => new URL(p.url()).hostname === "ms.portal.azure.com")
            || await ctx.newPage();

  try { await pers.invokePersistenceEnableNonSslUI({ page, subscription: sub, resourceGroup: rg, cache }); }
  catch (e) { console.log("UI path failed, falling back to ARM:", e.message);
              await pers.invokePersistenceEnableNonSslArm({ subscription: sub, resourceGroup: rg, cache }); }
  await pers.assertPersistenceNonSslEnabled({ subscription: sub, resourceGroup: rg, cache });
})().catch(e => { console.error(e.message); process.exit(1); });
'@
node -e $js
```

**Pre-conditions**

- Cache `Succeeded` (Capability 2 PASS).
- CDP Edge attached and signed into the Portal tenant that owns the cache.

**Post-conditions / Verification**

- `assertPersistenceNonSslEnabled` PASS — polls `az redis show ... --query enableNonSslPort` up to 60 s for `true`.

**Pitfalls**

- **"Advanced settings" lives inside the collapsed Settings group** in the left blade nav. Helper deep-links to `.../redisConfig` instead of clicking the menu — do not change that.
- **The blade is inside an iframe.** Save / Yes confirmations must be located across frames (helper's `clickAcrossFrames`).
- **The save dialog is "Yes / No", not "OK / Cancel".** Different from reboot dialogs.
- **A successful UI Save returns control fast** — the ARM mutation may still take 5–30 s to reflect in `az redis show`. Poll up to 60 s before declaring FAIL.

---

## Capability 5: pers-enable-persistence

**Purpose** — Drive the Portal **Persistence** blade end-to-end: pick `AOF`
or `RDB` radio, optionally pick RDB Backup Frequency, pick Storage Account
from the combobox, Save. Then poll until the cache returns to
`provisioningState = Succeeded` with the right `aof-backup-enabled` /
`rdb-backup-enabled` flag.

**When to use**

- Once per `mode` per cache. The standard AOF→RDB recipe (Premium step 5→6) calls this twice: first with `mode="AOF"`, then with `mode="RDB"`.

**When NOT to use**

- For programmatic-only persistence toggles without UI evidence — call `az redis update --set redisConfiguration.aof-backup-enabled=true` directly (but you lose the screenshot evidence the test case usually requires).
- To disable persistence — use `az redis update` to set both flags to `false`, this library doesn't expose a UI-disable helper.

**Inputs**

| Field | Required | Notes |
|---|---|---|
| `subscription`, `resourceGroup`, `cache` | yes | — |
| `mode` | yes | `"AOF"` or `"RDB"`. |
| `storageAccount` | yes | Created by Capability 3. |
| `rdbFrequencyMin` | no | Default `15`. Ignored for AOF. |
| `tenant` | no | Default `microsoft.onmicrosoft.com`. |
| `screenshotDir` | no | Default `D:\Claude-Redis\screenshots\<cache>\`. |

`waitPersistenceReady({ subscription, resourceGroup, cache, mode, maxMinutes?, intervalSec? })` — defaults `maxMinutes = 30`, `intervalSec = 60`.

**Helper invocation**

```powershell
$js = @'
const pers = require("d:/junru/skills/redis-persistence/create-persistence.js");
const { chromium } = require("playwright");
(async () => {
  const sub = "<sub>", rg = "<rg>", cache = "<cache>", sa = "<sa>";

  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => new URL(p.url()).hostname === "ms.portal.azure.com")
            || await ctx.newPage();

  await pers.invokePersistenceEnableUI({
    page, subscription: sub, resourceGroup: rg, cache,
    mode: "AOF", storageAccount: sa,
  });
  await pers.waitPersistenceReady({
    subscription: sub, resourceGroup: rg, cache, mode: "AOF",
  });
})().catch(e => { console.error(e.message); process.exit(1); });
'@
node -e $js
```

For RDB, swap `mode: "AOF"` for `mode: "RDB"` and (optionally) pass `rdbFrequencyMin`.

**Pre-conditions**

- Caches `Succeeded` (Capability 2).
- Storage account exists and is in the same RG (Capability 3).
- Cache has write access to storage (shared-key by default; flips to MI requires `Storage Blob Data Contributor` grant).
- CDP Edge attached and authenticated.

**Post-conditions / Verification**

- Cache `provisioningState = Succeeded` and the matching flag (`aof-backup-enabled` or `rdb-backup-enabled`) is `"true"`.
- Three screenshots in `<screenshotDir>`: `pers-<cache>-<mode>-{open,sa,saved}.png`.

**Pitfalls**

- **Radio label is the full text** — `Append-only file (AOF)` / `Redis Database (RDB)`, not just `AOF` / `RDB`. Helper uses the full string.
- **Backup Frequency combobox name varies** across blade revisions — helper uses `/Backup Frequency/i` regex and tolerates missing combobox (AOF mode doesn't have one).
- **Storage Account combobox label varies** — `Storage Account` vs `First Storage Account`. Helper tries both.
- **Storage Account options are `treeitem`**, not plain text or `option` — helper prefers `getByRole("treeitem", ...)`.
- **Save / Yes are cross-frame.** Helper iterates `page.frames()` (`clickAcrossFrames`).
- **Save returns fast; the cache transitions to `Updating` for 5–30 min.** Always chain `waitPersistenceReady`. Skipping it leaks failures into Capability 6 / 7.
- **RDB blob doesn't appear until the first backup interval elapses** — Capability 7 with `pattern="rdb"` may need to wait `rdbFrequencyMin + 5 min`. Default `timeoutMin = 20` covers the 15-min default.

---

## Capability 6: pers-populate

**Purpose** — Load the cache with ~20 k unique keys via `redis-benchmark`
over port 6379 so subsequent AOF / RDB backups have something to persist.

**When to use**

- Right after Capability 5 (AOF enabled) and before Capability 7 verification.
- Whenever a test scenario needs a known-state dataset.

**When NOT to use**

- When the cache already holds real test data you want preserved — Populate is additive (`SET`-only) but uses key names `key:*` that may collide.
- For perf benchmarking — use the dedicated benchmark skill.

**Inputs**

| Field | Required | Notes |
|---|---|---|
| `subscription`, `resourceGroup`, `cache` | yes | — |
| `keysApprox` | no | Default `20000` (`-r`). |
| `opsTotal` | no | Default `1_000_000` (`-n`). |
| `pipeline` | no | Default `100` (`-P`). |
| `clustered` | no | Pass `-c` to `redis-benchmark`. Default `false`. |

**Helper invocation**

```powershell
$js = @'
const pers = require("d:/junru/skills/redis-persistence/create-persistence.js");
(async () => {
  await pers.invokePersistencePopulate({
    subscription:  "<sub>",
    resourceGroup: "<rg>",
    cache:         "<cache>",
  });
})().catch(e => { console.error(e.message); process.exit(1); });
'@
node -e $js
```

**Pre-conditions**

- Enable Non-SSL PASS (6379 reachable).
- Enable persistence in target mode PASS (so writes actually flush to storage).
- `redis-cli.exe` / `redis-benchmark.exe` 5.x present at `D:\Claude-Redis\tools\redis\`.

**Post-conditions / Verification**

- `PING -> PONG`.
- `DBSIZE >= 19000` (benchmark `-r 20000` random keys yield ~5 % hash collisions). Throws otherwise.
- Returns `{ host, dbsize }` for the caller to record.

**Pitfalls**

- **`redis-cli 3.2.100` warnings on stderr are noise**, not failures (`--no-auth-warning` unsupported). Use the 5.x build.
- **Clustered cache + `redis-benchmark`** without `-c` surfaces `MOVED` lines — harmless for SET counting but reduces effective key spread. Set `clustered: true` for clustered.
- **TTL-bearing populate scripts** make later assertions flaky — this helper uses plain `SET` without expirations.
- **AOF flushes are durable**; RDB flushes happen every `rdbFrequencyMin` minutes. If you populate then verify RDB blob within 1–2 min, the blob may not exist yet — give Capability 7 enough timeout.

---

## Capability 7: pers-verify-blob

**Purpose** — Poll the storage container until at least one blob whose name
contains the AOF / RDB pattern shows up. Container defaults to
`<cacheLower>-redis-persistence` (the name the Redis service auto-creates).

**When to use**

- After Capability 6, separately for `pattern="aof"` and `pattern="rdb"`.
- Any time you need to assert backups are landing on storage.

**When NOT to use**

- To validate blob *contents* — this only validates presence + size on the
  storage account. Restore-and-DBSIZE-compare lives in a separate import/export skill.

**Inputs**

| Field | Required | Notes |
|---|---|---|
| `subscription`, `resourceGroup`, `storageAccount` | yes | — |
| `pattern` | yes | Substring match, e.g. `"aof"` / `"rdb"` (case-insensitive). |
| `container` | conditional | Omit when `cache` is given — defaults to `<cacheLower>-redis-persistence`. |
| `cache` | conditional | Used to derive default container. |
| `timeoutMin` | no | Default `20`. RDB at 15-min interval needs ≥ 20. |
| `intervalSec` | no | Default `60`. |

**Helper invocation**

```powershell
$js = @'
const pers = require("d:/junru/skills/redis-persistence/create-persistence.js");
(async () => {
  await pers.assertPersistenceBlob({
    subscription:   "<sub>",
    resourceGroup:  "<rg>",
    storageAccount: "<sa>",
    cache:          "<cache>",
    pattern:        "aof",          // or "rdb"
  });
})().catch(e => { console.error(e.message); process.exit(1); });
'@
node -e $js
```

**Pre-conditions**

- Capability 5 PASS for the matching mode.
- Capability 6 PASS (cache has data to persist).
- Cache has write access to storage account.

**Post-conditions / Verification**

- Returns the array of matched blobs (`name`, `size`, `lastModified`). Throws if no match within `timeoutMin`.

**Pitfalls**

- **RDB blob appears only after first interval** (`rdbFrequencyMin`, default 15 min). Keep `timeoutMin ≥ rdbFrequencyMin + 5`.
- **Container auto-created lazily** — the first poll may surface an empty container (`total=0`). Helper keeps polling; do not throw early.
- **Pattern is a substring**, not a regex. `aof.rdb-12345` matches both `"aof"` and `"rdb"` — choose distinct patterns when sharing storage across modes.
- **`AuthorizationFailed` listing blobs** — cache MI lacks `Storage Blob Data Contributor` and the helper falls back to shared-key. If shared-key is disabled tenant-wide, grant the role explicitly.

---

## Capability 8: pers-teardown

**Purpose** — Delete the caches (`--no-wait`) and (optionally) the storage
account. Returns `true` only when nothing remains after a 60 s settle.

**When to use**

- At the end of every Persistence test run, regardless of pass / fail.
- Whenever the subscription needs to look clean before the next composition.

**When NOT to use**

- Mid-test error recovery — Teardown deletes everything, you lose the diagnostic surface. Use `az redis delete` surgically for a single cache instead.

**Inputs**

| Field | Required | Notes |
|---|---|---|
| `subscription`, `resourceGroup` | yes | — |
| `caches` | yes | Full cache names. |
| `storageAccount` | conditional | Required when `deleteStorageAccount` is `true`. |
| `deleteStorageAccount` | no | Default `true` (matches legacy `Invoke-PersistenceTeardown.ps1`). Flip to `false` to keep the SA for follow-up runs. |

**Helper invocation**

```powershell
$js = @'
const pers = require("d:/junru/skills/redis-persistence/create-persistence.js");
(async () => {
  await pers.invokePersistenceTeardown({
    subscription:   "<sub>",
    resourceGroup:  "<rg>",
    caches:         ["ManualTest-9484-CUSE-0527", "ManualTest-9484-EUS2E-0527"],
    storageAccount: "manualtest9484sa0527",
  });
})().catch(e => { console.error(e.message); process.exit(1); });
'@
node -e $js
```

**Pre-conditions**

- All in-flight Portal-UI operations have settled (no pending Save dialog).

**Post-conditions / Verification**

- Every name in `caches` either gone or `Deleting` after the 60 s settle; storage account either gone or in `Deleting`.
- Returns `true` only when both checks come back empty. Otherwise logs `WARN TEARDOWN PARTIAL: redisLeft=… saLeft=…` and returns `false` — `--no-wait` makes partial-after-60s expected; confirm later with `az redis show` if needed.

**Pitfalls**

- **`--no-wait` does NOT mean fire-and-forget guaranteed.** The resource transitions to `Deleting` only after the orchestrator picks it up (5–60 s).
- **Soft-delete cooldown** (~1 h) blocks re-using cache and storage names. Pick a fresh `<MMDD>` or wait.
- **Storage account delete with persistence blobs is allowed** but the underlying soft-deleted blobs survive the cooldown — they don't block the account being re-created elsewhere, but they do count against your storage quota for the cooldown window.

---

## Composition Recipes

Reference recipes. Each test case lives in its own SKILL and composes
capabilities below; it is **not** the responsibility of this library to
enumerate them.

| Scenario | Recommended chain |
|---|---|
| Premium cache CSV Step 5 + 6 (AOF then RDB on the same cache) | Prereq → Provision-Caches → Provision-Storage → Enable-NonSSL → Enable-Persistence (AOF) → Populate → Verify-Blob (AOF) → Enable-Persistence (RDB) → Verify-Blob (RDB) → Teardown |
| Premium cache CSV Step 5 only (AOF) | Prereq → Provision-Caches → Provision-Storage → Enable-NonSSL → Enable-Persistence (AOF) → Populate → Verify-Blob (AOF) → Teardown |
| Premium cache CSV Step 6 only (RDB, fresh cache) | Prereq → Provision-Caches → Provision-Storage → Enable-NonSSL → Enable-Persistence (RDB) → Populate → Verify-Blob (RDB) → Teardown |
| Re-run on existing cache + storage (skip provisioning) | Prereq → Enable-NonSSL → Enable-Persistence (mode) → Populate → Verify-Blob (mode) → Teardown |
| ARM-only round-trip (no UI evidence) | Prereq → Provision-Caches → Provision-Storage → `az redis update --set redisConfiguration.aof-backup-enabled=true ...` → Populate → Verify-Blob → Teardown |

**Composition rules** (applied by the calling test SKILL, not by this library):

- Each capability returns a verifiable signal (exit code + ARM/blob/DBSIZE
  evidence) — propagate failures upward, do not silently swallow.
- Verification belongs to the capability that produced the state. Do not
  duplicate the `waitPersistenceReady` check after a freshly-returned
  `invokePersistenceEnableUI` PASS; **do** call it again if state may have
  drifted (long pause, parallel run, recovery from a chat reset).
- A test SKILL must not inline Playwright orchestration, redis-cli loops, or
  ARM bodies — extend the relevant capability in `create-persistence.js`
  instead.
- The screenshot triplet (`pers-<cache>-<mode>-{open,sa,saved}.png`) plus the
  matching blob list is the **only** artefact the recipes are required to
  produce.

---

## Phase Gate checklist (must-pass for Premium-cache compositions)

- [ ] Caches PUT with API `2024-03-01`, all `Succeeded`, all `aad=false` / `daka=false` / `pna=Enabled` (Capability 2).
- [ ] Storage account `Succeeded` (Capability 3).
- [ ] `enableNonSslPort = true` during the run (Capability 4).
- [ ] Persistence Save submitted via Portal UI with mode-correct radio (Capability 5).
- [ ] Cache returned to `Succeeded` with `aof-backup-enabled` / `rdb-backup-enabled = "true"` (Capability 5 wait step).
- [ ] DBSIZE ≥ 19 000 after populate (Capability 6).
- [ ] At least one blob matching `*aof*` (and/or `*rdb*`) in `<cacheLower>-redis-persistence` (Capability 7).
- [ ] Three-file screenshot triplet `pers-<cache>-<mode>-{open,sa,saved}.png` per mode.
- [ ] Teardown returned clean (Capability 8).

---

## Reusable scripts

| Module | Purpose | Used by |
|---|---|---|
| [create-persistence.js](create-persistence.js) | Single executable contract — all 8 capabilities (ARM + CDP Playwright UI + redis-cli evidence). | Capabilities 1–8 |
| [mcp/server.js](mcp/server.js) + [mcp/tools.js](mcp/tools.js) | MCP wrapper exposing every capability as a JSON-callable tool. | AI agents |
| `Claude-Redis/scripts/Assert-PersistenceEnv.ps1` *(legacy)* | Original PowerShell prereq check; superseded by `assertPersistenceEnv`. | — |
| `Claude-Redis/scripts/New-PersistenceCaches.ps1` *(legacy)* | Original ARM PUT loop; superseded by `invokePersistenceCacheProvision`. | — |
| `Claude-Redis/scripts/New-PersistenceStorage.ps1` *(legacy)* | Original storage-account provisioner; superseded by `invokePersistenceStorageProvision`. | — |
| `Claude-Redis/scripts/Enable-RedisPersistenceUI.ps1` *(legacy)* | Original `playwright-cli` Persistence-blade driver; superseded by `invokePersistenceEnableUI`. | — |
| `Claude-Redis/scripts/Wait-CachePersistenceReady.ps1` *(legacy)* | Original poller; superseded by `waitPersistenceReady`. | — |
| `Claude-Redis/scripts/Assert-PersistenceBlob.ps1` *(legacy)* | Original blob polling; superseded by `assertPersistenceBlob`. | — |
| `Claude-Redis/scripts/Invoke-PersistenceTeardown.ps1` *(legacy)* | Original teardown; superseded by `invokePersistenceTeardown`. | — |

---

## Verified Playwright selectors

(All confirmed against the Portal Persistence + Advanced settings blades
during ADO 15379484 runs. Live source: [create-persistence.js](create-persistence.js).)

| Element | Recommended selector |
|---|---|
| Advanced settings blade (direct jump) | `page.goto(".../resource{rid}/redisConfig")` |
| Persistence blade (direct jump) | `page.goto(".../resource{rid}/persistence")` |
| SSL-only toggle | `div[role="switch"][aria-label*="Allow access only via SSL"]` (helper iterates a fallback list) |
| AOF radio | `page.getByRole("radio", { name: "Append-only file (AOF)" })` |
| RDB radio | `page.getByRole("radio", { name: "Redis Database (RDB)" })` |
| Backup Frequency combobox | `page.getByRole("combobox", { name: /Backup Frequency/i })` |
| Frequency option (15-min default) | `page.getByRole("treeitem", { name: /15\s*Minutes/i })` |
| Storage Account combobox | `page.getByRole("combobox", { name: /Storage Account/i })` (helper falls back to `/First Storage Account/i`) |
| Storage Account option | `page.getByRole("treeitem", { name: "<saName>" })` |
| Persistence `Save` | cross-frame `span:has-text("Save")` |
| Confirm `Yes` | cross-frame `button:has-text("Yes")` |

---

## Failure mode index

### Playwright automation (CDP-driven Portal)

| Symptom | Root cause | Resolution |
|---|---|---|
| `Persistence` / `Advanced settings` missing from left nav | Items live under collapsed groups; DOM exists but `aria-hidden`. | Use deep-link `.../resource{rid}/{persistence\|redisConfig}`. |
| `getByRole("radio", { name: "AOF" })` times out | Radio label is the full `Append-only file (AOF)` string. | Use the full label, as the helper does. |
| Storage Account combobox click does nothing | Wrong label — newer blade uses `First Storage Account`. | Helper retries with that label. |
| Storage option click selects nothing | Options render as `treeitem`, not text. | `page.getByRole("treeitem", { name: "<saName>" })`. |
| `Save` click has no effect | Save lives in an iframe child of the blade. | `clickAcrossFrames(page, 'span:has-text("Save")')`. |
| `Yes` click has no effect | Same iframe issue as Save. | `clickAcrossFrames(page, 'button:has-text("Yes")')`. |
| `node -e $js` exits with `SyntaxError` near a backtick | Backticks inside template literals must be escaped or the here-string must use single-quote form `@'…'@`. | Use the `@'…'@` form shown in **Execution model**. |
| `Cannot find module 'playwright'` | Playwright isn't installed in Node's `require` resolution path. | `npm install playwright` (workspace root). |

### Business / environment

| Symptom | Root cause | Resolution |
|---|---|---|
| PUT cache returns `BadRequest: Unknown property disableAccessKeyAuthentication` | API version < `2024-03-01`. | Helper hard-codes the right version; do not downgrade. |
| Cache stays in `Updating` for > 30 min after Save | Storage account in a different region / shared-key disabled on tenant. | Re-create storage in the same region; or grant the cache MI `Storage Blob Data Contributor` and re-trigger Save. |
| `pers_assert_blob` times out with `pattern="rdb"` | Capability 7 was called before the first RDB interval elapsed. | Wait `rdbFrequencyMin + 5 min` or pass `timeoutMin >= rdbFrequencyMin + 5`. |
| `pers_assert_blob` returns `aof` blobs only — no `rdb` | Persistence Save for RDB never returned `Succeeded`; the cache only ever wrote AOF. | Re-run Capability 5 with `mode="RDB"` and `waitPersistenceReady`. |
| `redis-benchmark` reports `MOVED` lines | Clustered cache without `-c`. | Pass `clustered: true`. |
| 6379 left open at end of run | Teardown skipped or only the storage account was dropped. | Always call Capability 8 with the full cache list. |
| `409 NameAlreadyReserved` on re-provision | Soft-delete cooldown (~1 h) on cache or storage name. | Pick a new `<MMDD>` suffix or wait. |

---

## Related skills

- [`portal-bvt-basic-cache-creation`](../portal-bvt-basic-cache-creation/SKILL.md) — Premium / Basic cache provisioning (alternative source of Capability 2).
- [`geo-replication-setup`](../geo-replication-setup/SKILL.md) — Geo Premium cache creation + Link / Failover / Unlink (same capability-library shape).
- [`redis-import-export`](../redis-import-export/SKILL.md) — Premium Import / Export round-trip (same capability-library shape).
- [`ado-testcase-extractor`](../ado-testcase-extractor/SKILL.md) — pull latest ADO test-case fields.

---

## Out of scope

- End-to-end test orchestration (which capability to call when) — owned by the test SKILL.
- Non-Premium SKUs, AMR (Enterprise), VNet-injected, or AAD-only caches — those need a different provisioning skill.
- AOF + RDB **disable** flow (`az redis update --set ...-backup-enabled=false`) — trivial to do via raw `az`; not worth a capability.
- UI verification of blob contents inside the Portal Storage Container blade — `Verify-PersistenceBlobUI.ps1` is intentionally not ported; ARM blob list is the authoritative ground truth.
- Restore / Import of AOF / RDB blobs — covered by [`redis-import-export`](../redis-import-export/SKILL.md).
- Redis data-plane validation beyond PING / DBSIZE (`SET / GET / INFO / SCAN`) — use a separate validation skill.
