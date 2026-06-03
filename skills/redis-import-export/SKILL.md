---
name: redis-import-export
description: |
  Reusable Import / Export capability library for Azure Cache for Redis.
  Contains 8 atomic, composable capabilities (prereq / provision-storage /
  enable-nonssl / populate / portal-export / flushall / portal-import /
  teardown). Cache **creation** is out of scope — use the
  [`portal-bvt-basic-cache-creation`](../portal-bvt-basic-cache-creation/SKILL.md)
  or [`geo-replication-setup`](../geo-replication-setup/SKILL.md) skills to
  provision the Premium (or AMR) cache first; every helper here assumes the
  cache already exists in `Succeeded` provisioning state. Test cases compose
  these capabilities — they do NOT embed Import/Export workflow steps.
  Implementation lives in `create-import-export.js` (Node.js + Playwright);
  this file is the single source of truth for capability contracts (inputs,
  pre/post-conditions, pitfalls).
applyTo: "**"
---

# Redis Import / Export Capability Library

> **What this is:** a library of 8 atomic Import/Export capabilities. Each
> section below is a self-contained capability with declared inputs, helper
> invocation, pre-conditions, post-conditions / verification, and pitfalls.
>
> **What this is NOT:** an end-to-end test workflow. Test-case-specific flows
> (ADO 15379484 step 10, 35857032, 35857777, …) live in their own test SKILL
> files and compose capabilities listed here — they do not re-implement steps.

---

## Capability Catalog

| # | Capability | Anchor | Helper(s) |
|---|---|---|---|
| 1 | Prereq | [#capability-1-ie-prereq](#capability-1-ie-prereq) | `az` / `playwright-cli` health checks |
| 2 | Provision storage | [#capability-2-ie-provision-storage](#capability-2-ie-provision-storage) | `az storage account create`, `az storage container create` |
| 3 | Enable Non-SSL | [#capability-3-ie-enable-nonssl](#capability-3-ie-enable-nonssl) | `portal_drive.py enable_nonssl` |
| 4 | Populate | [#capability-4-ie-populate](#capability-4-ie-populate) | `redis-benchmark`, `dbsize_evidence.ps1` |
| 5 | Portal Export | [#capability-5-ie-portal-export](#capability-5-ie-portal-export) | `portal_drive.py export_run` |
| 6 | FLUSHALL | [#capability-6-ie-flushall](#capability-6-ie-flushall) | `redis-cli FLUSHALL`, `dbsize_evidence.ps1` |
| 7 | Portal Import | [#capability-7-ie-portal-import](#capability-7-ie-portal-import) | `portal_drive.py import_run`, `dbsize_evidence.ps1` |
| 8 | Teardown | [#capability-8-ie-teardown](#capability-8-ie-teardown) | `az redis update`, `az storage blob delete-batch` |

A capability is **atomic**: it advances exactly one piece of import/export
state, returns a verifiable signal (exit code + ARM/blob/DBSIZE evidence), and
never assumes which capability comes next.

---

## Shared Conventions

These apply to every capability below. Capability sections reference this
section instead of restating its content.

### Execution model

- **Implementation lives in [create-import-export.js](create-import-export.js).** Capability sections are documentation; the Node module is the executable contract.
- **Invocation pattern (PowerShell here-string + `node -e`):**

  ```powershell
  $js = @'
  const ie = require("d:/junru/skills/redis-import-export/create-import-export.js");
  const { chromium } = require("playwright");
  (async () => {
    // ARM-only capabilities (Prereq, Provision-Storage, Populate, FLUSHALL, Teardown, …):
    await ie.assertIeEnv({ subscription, resourceGroup, cache });

    // UI capabilities — attach to CDP Edge, never close it:
    const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
    const ctx = browser.contexts()[0];
    const page = ctx.pages().find(p => new URL(p.url()).hostname === "ms.portal.azure.com")
              || await ctx.newPage();
    await ie.invokeIePortalExport({ page, rid, saName, container, prefix });
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

Capabilities that wait (Export submit → blob written, Import submit → DBSIZE
restored) can take 1–10 min. Invoke them through `run_in_terminal` with
`mode=sync` + a generous `timeout` (≥ 600,000 ms), and rely on the VS Code
exit notification. Do **not** use `mode=async`; do **not** wrap with
`Start-Sleep` polling loops.

### Naming

| Resource | Pattern | Notes |
|---|---|---|
| Cache | reuse an existing Premium P1 / AMR cache | **Must already exist** — use `portal-bvt-basic-cache-creation` or `geo-replication-setup`. |
| Storage account | `<cacheNameLower>sa` or `manualioe<MMDD>sa` | Lowercase, 3–24 chars, alphanumeric; **must be same region as cache**. |
| Container | `redisexports` or `exports-<MMDD>` | — |
| Export prefix | `<cache>-portal-<MMDD>` | Makes reverse-lookup from blob list trivial. |
| Evidence dir | `D:\Claude-Redis\screenshots\<cache>\` | Holds `dbsize-<tag>.txt` triplet + Portal screenshots. |

All concrete cache / storage / container / prefix values are caller-owned —
every helper takes them as explicit arguments; nothing in this library is
computed from a date stamp implicitly.

### Hard requirements (not overridable)

| Constraint | Reason |
|---|---|
| Cache SKU = `Premium` (or AMR) | Basic / Standard tier has no Import/Export blade. |
| Cache region == Storage account region | Portal `Choose Storage Container` chooser silently filters cross-region storage; UI shows an empty list. |
| `enableNonSslPort = true` (during run) | Bundled `redis-cli` 3.2.100 has no `--tls` flag; all data-plane evidence (PING / DBSIZE / FLUSHALL / SCAN) goes over port 6379. Capability 8 (Teardown) flips it back to `false`. |
| Cache has write access to storage | Either shared-key (default in this library) or MI + `Storage Blob Data Contributor` on the storage account. |

### ARM / API versions

- `Microsoft.Cache/Redis` ops: `2023-05-01-preview`
- `Microsoft.Storage/storageAccounts` ops: as Azure CLI defaults.

### Reading semantics (very common error)

- **`serverRole` does not apply here** — this is the import/export library, not geo. There is no peer-relative reading semantics; `az redis show --query enableNonSslPort` etc. all describe the queried cache directly.
- **`redis-benchmark -r 20000` produces ~19,000–19,900 unique keys**, not 20,000 (hash collisions). DBSIZE assertions must use `>= 19000`, not `== 20000`.
- **`redis-cli --scan | Select-Object -First N` hangs** under PowerShell — the pipeline does not close stdin after N items. Always use the one-shot form: `SCAN 0 MATCH 'key:*' COUNT 5`.

### Result recording

Result recording is **not** a capability of this library. The calling test
SKILL owns the `result.txt` write (or any equivalent reporting). Capabilities
log `Phase N PASS / FAIL`-style lines to stdout and emit DBSIZE evidence
files; the test SKILL aggregates and persists.

---

## Capability 1: ie-prereq

**Purpose** — Fail fast before any Import/Export capability runs. Verifies
environmental dependencies that every downstream capability assumes already
true.

**When to use**

- **Always**, as the first step of any Import/Export composition.
- After a chat reset, restart, or VM reboot — CDP Edge port and Azure CLI auth are the two most common silent regressions.

**When NOT to use**

- Inside an inner loop (it's a one-shot gate, not a watchdog).
- To diagnose a specific Portal flake — use Playwright page state instead.

**Inputs**

| Field | Required | Notes |
|---|---|---|
| `subscription` | yes | Target subscription ID. |
| `resourceGroup` | yes | Must already exist; this capability does NOT create it. |
| `cache` | yes | Pre-existing Premium / AMR cache name. |
| `cdpPort` | no | Default `9222`. |

**Helper invocation**

```powershell
$js = @'
const ie = require("d:/junru/skills/redis-import-export/create-import-export.js");
(async () => {
  await ie.assertIeEnv({
    subscription: "<sub>",
    resourceGroup: "<rg>",
    cache:         "<cache>",
  });
})().catch(e => { console.error(e.message); process.exit(1); });
'@
node -e $js
```

**Pre-conditions**

- Azure CLI installed and previously signed in (`az account show` works).
- Edge launched with `--remote-debugging-port=9222 --user-data-dir=%USERPROFILE%\edge-cdp-profile` and signed into `https://ms.portal.azure.com`.
- `redis-cli.exe` and `redis-benchmark.exe` present in `D:\Claude-Redis\tools\redis\` (the 5.x build — bundled `3.2.100` does not support `--no-auth-warning` or `--tls`).
- `playwright` available in Node's `require` resolution path.

**Post-conditions / Verification**

- All of: `az --version`, `az account set`, `az group show`, `az redis show` succeed.
- Cache SKU is `Premium` / `Enterprise` / `EnterpriseFlash`.
- `playwright-cli attach --cdp=http://127.0.0.1:9222` reports attached.

**Pitfalls**

- **CDP port silently failing**: Edge was launched in the wrong user-data dir; the `--remote-debugging-port` flag is then ignored. Verify with `netstat -ano | findstr :9222` — must show exactly one LISTENING line.
- **`localhost` ↔ `127.0.0.1`**: do not change to `localhost` — Windows resolves it to `::1` and CDP only listens on IPv4.
- **PowerShell 5.1 non-interactive may not resolve `az`** — fall back to the absolute path `C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd`.
- **`playwright-cli` not on PATH** in non-interactive PS — prepend `$env:Path = "$env:APPDATA\npm;$env:Path"`.

---

## Capability 2: ie-provision-storage

**Purpose** — Create a `StorageV2 / Standard_LRS` storage account in the
cache's region and a container for export blobs. Same-region constraint is
load-bearing: cross-region storage is silently filtered out of the Portal
`Choose Storage Container` chooser.

**When to use**

- Once per test run / cache; storage can be reused across many Export/Import cycles on the same cache.
- After the cache is moved (e.g. recreated in a different region) — old storage no longer satisfies same-region.

**When NOT to use**

- To reuse a pre-existing storage account that is already same-region — skip this capability and only assert location equality.

**Inputs**

| Field | Required | Notes |
|---|---|---|
| `subscription`, `resourceGroup`, `cache` | yes | Same as Prereq. |
| `saName` | yes | Lowercase, 3–24, alphanumeric only. |
| `container` | yes | e.g. `redisexports`. |

**Helper invocation**

```powershell
$js = @'
const ie = require("d:/junru/skills/redis-import-export/create-import-export.js");
(async () => {
  const args = { subscription: "<sub>", resourceGroup: "<rg>",
                 cache: "<cache>", saName: "<saName>", container: "redisexports" };
  await ie.invokeIeProvisionStorage(args);
  await ie.assertIeStorage(args);
})().catch(e => { console.error(e.message); process.exit(1); });
'@
node -e $js
```

**Pre-conditions**

- Prereq PASS.
- Subscription / resource group has quota for a new storage account.

**Post-conditions / Verification**

- `assertIeStorage` PASS — storage account location matches cache location and container exists.
- Helper logs `[PASS] storage same region (<loc>); container '<name>' exists`.

**Pitfalls**

- **Cross-region storage** is the #1 cause of empty `Choose Storage Container` chooser in Phase 5. Always assert location equality before moving on.
- **Storage account name collisions** are global. If `az storage account create` returns `AccountNameAlreadyTaken` and the name does not appear under your subscription, pick another suffix.
- **`--allow-blob-public-access false`** is required by tenant policy on most subscriptions; omitting it can fail at create time.
- **Cache MI + RBAC path**: if the test scenario requires MI rather than shared-key, grant `Storage Blob Data Contributor` on the storage account to the cache's system-assigned identity; otherwise Export will fail with `AuthorizationFailed`.

---

## Capability 3: ie-enable-nonssl

**Purpose** — Flip `enableNonSslPort = true` so port 6379 is reachable for the
bundled `redis-cli` 3.2.100 (no `--tls` support). Demonstrates the Premium
step 10.2 toggle in **Advanced settings**.

**When to use**

- Before Populate / FLUSHALL / DBSIZE evidence on any cache whose redis-cli build cannot do TLS.
- Whenever a test case explicitly validates the Advanced settings toggle (e.g. ADO 15379484 step 10.2).

**When NOT to use**

- When the test client has a TLS-capable `redis-cli` (e.g. 5.x+ from `Claude-Redis\tools\redis\`) **and** the test does not require the UI toggle as evidence. In that case, talk to 6380 directly.

**Inputs**

| Field | Required | Notes |
|---|---|---|
| `rid` | yes | Cache full ARM resource ID. |
| `tenant` | no | Default `microsoft.onmicrosoft.com`. |

**Helper invocation**

```powershell
$js = @'
const ie = require("d:/junru/skills/redis-import-export/create-import-export.js");
const { chromium } = require("playwright");
(async () => {
  const sub = "<sub>", rg = "<rg>", cache = "<cache>";
  const rid = `/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.Cache/Redis/${cache}`;

  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => new URL(p.url()).hostname === "ms.portal.azure.com")
            || await ctx.newPage();

  try { await ie.invokeIeEnableNonSslUI({ page, rid }); }
  catch (e) { console.log("UI path failed, falling back to ARM:", e.message);
              await ie.invokeIeEnableNonSslArm({ subscription: sub, resourceGroup: rg, cache }); }
  await ie.assertIeNonSslEnabled({ subscription: sub, resourceGroup: rg, cache });
})().catch(e => { console.error(e.message); process.exit(1); });
'@
node -e $js
```

**Pre-conditions**

- Prereq PASS.
- CDP Edge attached and signed into the Portal tenant that owns the cache.

**Post-conditions / Verification**

- `assertIeNonSslEnabled` PASS — polls `az redis show ... --query enableNonSslPort` up to 60 s for `true`.

**Pitfalls**

- **"Advanced settings" lives inside the collapsed Settings group** in the left blade nav and is hidden by default. The helper navigates via deep-link `.../resource{rid}/redisConfig` instead of clicking the menu — do not change that.
- **The blade is inside an iframe.** Save / Yes confirmations must be located across frames (`page.frames`).
- **The save dialog is "Yes / No", not "OK / Cancel".** Different from reboot dialogs.
- **A successful UI Save returns control fast** — the ARM mutation may still take 5–30 s to reflect in `az redis show`. Poll up to 60 s before declaring FAIL.

---

## Capability 4: ie-populate

**Purpose** — Load the cache with ~20k unique keys via `redis-benchmark` and
emit the `dbsize-pre-export.txt` evidence file that Phase 7 (Portal Import)
will compare against.

**When to use**

- Right after Enable Non-SSL, before Portal Export.
- Any time you need a known-state baseline for an Import round-trip.

**When NOT to use**

- When the cache already holds real test data you want preserved — Populate is additive (`SET`-only) but uses key names `key:*` that may collide.
- For perf benchmarking — use the `Redis_Benchmark` skill.

**Inputs**

| Field | Required | Notes |
|---|---|---|
| `cache`, `resourceGroup` | yes | — |
| `keysApprox` | no | Default 20000 (passed as `-r`). |
| `evidenceDir` | yes | e.g. `D:\Claude-Redis\screenshots\<cache>\`. |

**Helper invocation**

```powershell
$js = @'
const ie = require("d:/junru/skills/redis-import-export/create-import-export.js");
(async () => {
  const ev = await ie.invokeIePopulate({
    subscription: "<sub>", resourceGroup: "<rg>", cache: "<cache>",
    evidenceDir: `D:\\Claude-Redis\\screenshots\\<cache>`,
  });
  console.log("DbsizePreExport=" + ev.dbsize);   // record baseline for Capability 7
})().catch(e => { console.error(e.message); process.exit(1); });
'@
node -e $js
```

**Pre-conditions**

- Enable Non-SSL PASS (6379 reachable).
- `redis-cli.exe` / `redis-benchmark.exe` 5.x present at `D:\Claude-Redis\tools\redis\`.

**Post-conditions / Verification**

- `PING -> PONG`.
- `DBSIZE >= 19000` (benchmark `-r 20000` random keys yield ~5% hash collisions).
- Evidence file `<evidenceDir>\dbsize-pre-export.txt` exists and is non-empty.
- Caller stores DBSIZE as baseline for Portal Import verification (e.g. `$Global:DbsizePreExport = $dbsize`).

**Pitfalls**

- **`redis-cli 3.2.100` warnings on stderr are noise**, not failures (`--no-auth-warning` unsupported).
- **Clustered cache + `redis-benchmark`** without `-c` surfaces `MOVED` lines — harmless for SET counting but reduces effective key spread. Add `-c` for clustered.
- **TTL-bearing populate scripts** make the Import assertion flaky — restrict Populate to plain `SET` without expirations.
- **Clustered DBSIZE** is per-master; sum across all shards manually, do not trust the first connection's count.

---

## Capability 5: ie-portal-export

**Purpose** — Drive the Portal **Export data** blade end-to-end (`Choose
Storage Container` → select SA → select container → fill prefix → submit
Export) and verify the storage account holds at least one non-empty
`.rdb` PageBlob under the prefix. Covers ADO 35857032 and Premium step 10.5.

**When to use**

- Whenever the test case validates Portal Export UI **or** needs an RDB
  baseline for a subsequent Portal Import.

**When NOT to use**

- For programmatic round-trips that don't need UI evidence — call `az redis export` directly.

**Inputs**

| Field | Required | Notes |
|---|---|---|
| `rid` | yes | Cache ARM ID. |
| `saName`, `container` | yes | Created by Capability 2. |
| `prefix` | yes | e.g. `<cache>-portal-<MMDD>`. |
| `screenshotDir` | no | `SHOT_DIR` env var; defaults to `D:\Claude-Redis\screenshots\<cache>\`. |

**Helper invocation**

```powershell
$js = @'
const ie = require("d:/junru/skills/redis-import-export/create-import-export.js");
const { chromium } = require("playwright");
(async () => {
  const sub = "<sub>", rg = "<rg>", cache = "<cache>";
  const rid = `/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.Cache/Redis/${cache}`;
  const saName = "<sa>", container = "redisexports";
  const d = new Date(); const mmdd = String(d.getMonth()+1).padStart(2,"0") + String(d.getDate()).padStart(2,"0");
  const prefix = `${cache}-portal-${mmdd}`;

  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => new URL(p.url()).hostname === "ms.portal.azure.com")
            || await ctx.newPage();

  await ie.invokeIePortalExport({ page, rid, saName, container, prefix,
                                  screenshotDir: `D:\\Claude-Redis\\screenshots\\${cache}` });
  await ie.assertIeExportBlobs({ subscription: sub, resourceGroup: rg, saName, container, prefix });
})().catch(e => { console.error(e.message); process.exit(1); });
'@
node -e $js
```

ARM fallback:

```powershell
az redis export -g $rg -n $cache `
    --container "https://$saName.blob.core.windows.net/$container" `
    --prefix $prefix --file-format RDB
```

**Pre-conditions**

- Capabilities 1 / 2 PASS.
- Cache has write access to the storage account (shared-key or MI + `Storage Blob Data Contributor`).

**Post-conditions / Verification**

```powershell
$saKey = az storage account keys list -g $rg -n $saName --query "[0].value" -o tsv
$blobs = az storage blob list --account-name $saName --account-key $saKey -c $container --prefix $prefix `
    --query "[?ends_with(name, '.rdb')].{name:name, size:properties.contentLength, type:properties.blobType}" -o json | ConvertFrom-Json
if (-not $blobs -or $blobs.Count -eq 0) { throw "Phase 4 FAIL: no .rdb blob under prefix '$prefix'." }
foreach ($b in $blobs) {
    if ($b.size -le 0)          { throw "Phase 4 FAIL: $($b.name) size=0." }
    if ($b.type -ne 'PageBlob') { throw "Phase 4 FAIL: $($b.name) blobType=$($b.type)." }
}
```

UI evidence (Portal notifications): `Export started` → `Succeeded` toast in
the top-right within 5–10 min for ~20k keys; clustered caches produce one
`.rdb` per shard.

**Pitfalls**

- **`Choose Storage Container` chooser is empty** → storage / cache region mismatch. Re-run Capability 2 same-region.
- **Strict-mode collision on `Export` button** — there are two `Export`-labeled controls on the blade (page title + footer command). Helper uses `get_by_role("button", name="Export", exact=True)`.
- **Storage row vs Select button** — clicking the text node alone does not enable Select. Helper clicks the whole `<tr>:has-text("<sa>")` and then iterates `div[role="button"]:has-text("Select")` looking for the visible one (Export blade: idx ≈ 1).
- **`AuthorizationFailed` writing the blob** — cache MI lacks `Storage Blob Data Contributor`. Switch to shared-key path or grant the role.
- **`az redis export` may stay `InProgress` past CLI timeout** on clustered caches — use `--no-wait` and poll with `az storage blob list`.

---

## Capability 6: ie-flushall

**Purpose** — Wipe the cache between Export and Import so the post-Import
DBSIZE assertion is meaningful (DBSIZE going from `N` → `0` → `N`). Emits the
`dbsize-post-flush.txt` evidence file.

**When to use**

- Always between Portal Export PASS and Portal Import — otherwise the Import
  is asserting "nothing changed".

**When NOT to use**

- When the test scenario explicitly validates Import-on-non-empty-cache
  semantics (merge / overwrite behaviour) — call only Portal Import without
  FLUSHALL.

**Inputs**

| Field | Required | Notes |
|---|---|---|
| `cache`, `resourceGroup`, `evidenceDir` | yes | — |

**Helper invocation**

```powershell
$js = @'
const ie = require("d:/junru/skills/redis-import-export/create-import-export.js");
(async () => {
  await ie.invokeIeFlushAll({
    subscription: "<sub>", resourceGroup: "<rg>", cache: "<cache>",
    evidenceDir: `D:\\Claude-Redis\\screenshots\\<cache>`,
  });
})().catch(e => { console.error(e.message); process.exit(1); });
'@
node -e $js
```

**Pre-conditions**

- Capability 4 (Populate) PASS — there is something meaningful to flush.
- Capability 5 (Portal Export) PASS — exported blob is the only surviving copy of the data.

**Post-conditions / Verification**

```powershell
$dbsize = [int](& $cli -h $h -p 6379 -a $key DBSIZE)
if ($dbsize -ne 0) { throw "Phase 5.1 FAIL: DBSIZE=$dbsize after FLUSHALL." }
Test-Path "$shotDir\dbsize-post-flush.txt" | Out-Null
```

**Pitfalls**

- **Clustered cache `FLUSHALL`** only flushes the connected master. Iterate all masters or use `redis-cli --cluster call <host>:<port> FLUSHALL`.
- **Asynchronous FLUSHALL** on huge datasets may return before the dataset is truly empty — call DBSIZE on a short loop (max 30 s) before declaring FAIL.

---

## Capability 7: ie-portal-import

**Purpose** — Drive the Portal **Import data** blade end-to-end (`Choose
Blob(s)` → select SA → drill into container with **Enter key** → tick blob
checkbox → submit Import) and verify DBSIZE recovers to ≥ 95% of the
pre-export baseline within 5 min. Covers ADO 35857777 and Premium step
10.6–10.8.

**When to use**

- Whenever the test case validates Portal Import UI **or** needs to assert a
  full round-trip Export → Import.

**When NOT to use**

- For programmatic round-trips without UI evidence — call `az redis import`
  directly with the blob URI list.

**Inputs**

| Field | Required | Notes |
|---|---|---|
| `rid` | yes | Cache ARM ID. |
| `saName`, `container` | yes | — |
| `blobName` | yes | Full blob name (resolve via `az storage blob list --prefix`). |
| `baseline` | yes | Phase 4's pre-export DBSIZE; used by the verification assertion. |
| `evidenceDir` | yes | — |

**Helper invocation**

```powershell
$js = @'
const ie = require("d:/junru/skills/redis-import-export/create-import-export.js");
const { chromium } = require("playwright");
(async () => {
  const sub = "<sub>", rg = "<rg>", cache = "<cache>";
  const rid = `/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.Cache/Redis/${cache}`;
  const saName = "<sa>", container = "redisexports", prefix = "<prefix>";
  const baseline = <DbsizePreExport>;   // from Capability 4

  // Resolve first blob under prefix
  const saKey = ie.az(["storage","account","keys","list","-g",rg,"-n",saName,
                       "--subscription",sub,"--query","[0].value","-o","tsv"]);
  const blobName = ie.az(["storage","blob","list","--account-name",saName,"--account-key",saKey,
                          "-c",container,"--prefix",prefix,"--query","[0].name","-o","tsv"]);

  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => new URL(p.url()).hostname === "ms.portal.azure.com")
            || await ctx.newPage();

  await ie.invokeIePortalImport({ page, rid, saName, container, blobName,
                                  screenshotDir: `D:\\Claude-Redis\\screenshots\\${cache}` });
  await ie.assertIeImportRestored({ subscription: sub, resourceGroup: rg, cache,
                                    evidenceDir: `D:\\Claude-Redis\\screenshots\\${cache}`,
                                    baseline });
})().catch(e => { console.error(e.message); process.exit(1); });
'@
node -e $js
```

ARM fallback (clustered: include every shard's blob):

```powershell
$blobs   = az storage blob list --account-name $saName --account-key $saKey -c $container --prefix $prefix --query "[].name" -o tsv
$blobUris = $blobs | ForEach-Object { "https://$saName.blob.core.windows.net/$container/$_" }
az redis import -g $rg -n $cache --files $blobUris --file-format RDB
```

**Pre-conditions**

- Capability 6 (FLUSHALL) PASS (DBSIZE == 0).
- Capability 5 produced a non-empty `.rdb` PageBlob at `<container>/<blobName>`.

**Post-conditions / Verification**

```powershell
$deadline = (Get-Date).AddMinutes(5)
do {
    $dbsize = [int](& $cli -h $h -p 6379 -a $key DBSIZE)
    if ($dbsize -ge $baseline * 0.95) { break }
    if ((Get-Date) -gt $deadline)     { break }
    Start-Sleep -Seconds 15
} while ($true)
if ($dbsize -lt $baseline * 0.95) { throw "Phase 5.2 FAIL: DBSIZE=$dbsize < 95% of baseline=$baseline after 5 min." }

$scanOut = & $cli -h $h -p 6379 -a $key SCAN 0 MATCH 'key:*' COUNT 5
$sample  = ($scanOut -split "`n") | Where-Object { $_ -match '^key:' } | Select-Object -First 3
if ($sample.Count -lt 1) { throw "Phase 5.2 FAIL: SCAN matched no key:* — Import may have restored only metadata." }

Test-Path "$shotDir\dbsize-post-import.txt" | Out-Null
```

Final three-file evidence chain in `<evidenceDir>`:
`dbsize-pre-export.txt` (=N) → `dbsize-post-flush.txt` (=0) → `dbsize-post-import.txt` (=N).

**Pitfalls**

- **Container row `dblclick` does NOT drill in** — Azure Fluent UI grid only
  honours `Enter` for drill-in. Helper uses `row.click()` then `row.press("Enter")`.
- **Blob selection requires the row checkbox** — clicking the row text only
  highlights it. Use `tr:has-text("<blob>") input[type=checkbox]` → `check()`.
- **`Select` button collision** — same root cause as Export, but on Import the
  visible Select is typically idx ≈ 2 (the chooser layout differs).
- **`Blob name prefix` input collision with chooser search box** — after Select,
  always wait for the label `Blob name prefix` to appear before locating the
  input; otherwise you'll type into the chooser's filter box.
- **`Import` button vs blade title** — title also says `Import data`. Helper
  uses `get_by_role("button", name="Import", exact=True)`.
- **Notification stuck spinning** → RDB engine-version mismatch (cache was
  upgraded across a major version). Re-export and re-import.
- **DBSIZE recovers but `SCAN` finds nothing** → Import restored only
  metadata, or your populate keys had TTLs that already expired. Re-run
  Populate without TTLs.
- **Clustered caches**: pass **every** shard's blob URI to `--files`; missing
  one will silently restore only part of the data.

---

## Capability 8: ie-teardown

**Purpose** — Restore the cache's security baseline (`enableNonSslPort =
false`) and purge the export blobs. Storage account itself is optional to
delete depending on whether it's a per-test or shared resource.

**When to use**

- At the end of every Import/Export test run, regardless of pass / fail.
- Whenever a security-baseline scan is about to run against the subscription.

**When NOT to use**

- Mid-test error recovery — Teardown closes 6379, which kills your remaining
  diagnostic surface. Use Capability 6 / 7 surgically instead.

**Inputs**

| Field | Required | Notes |
|---|---|---|
| `subscription`, `resourceGroup`, `cache` | yes | — |
| `saName`, `container`, `prefix` | yes | Blob cleanup scope. |
| `deleteStorageAccount` | no | Default `false` — flip to `true` only if the SA was created exclusively for this run. |

**Helper invocation**

```powershell
$js = @'
const ie = require("d:/junru/skills/redis-import-export/create-import-export.js");
(async () => {
  await ie.invokeIeTeardown({
    subscription: "<sub>", resourceGroup: "<rg>", cache: "<cache>",
    saName: "<sa>", container: "redisexports", prefix: "<prefix>",
    deleteStorageAccount: false,
  });
})().catch(e => { console.error(e.message); process.exit(1); });
'@
node -e $js
```

**Pre-conditions**

- All in-flight Portal-UI operations have settled (no pending Import dialog,
  no half-opened Export blade).

**Post-conditions / Verification**

```powershell
$nonssl = az redis show -g $rg -n $cache --query enableNonSslPort -o tsv
if ($nonssl -ne 'false') { throw "Phase 6 FAIL: enableNonSslPort=$nonssl (security baseline violated)." }
$leftover = az storage blob list --account-name $saName --account-key $saKey -c $container --prefix $prefix --query "[].name" -o tsv
if ($leftover) { Write-Warning "Phase 6 WARN: blobs remain under prefix '$prefix':`n$leftover" }
```

**Pitfalls**

- **`az redis update` is asynchronous on the control plane** — the toggle may
  take 5–60 s to reflect in a follow-up `az redis show`. Allow one re-query.
- **`delete-batch --pattern`** uses glob semantics, not regex. `$prefix*` is
  correct; do not use `^$prefix`.
- **Deleting the storage account** is soft-delete + reservation (~1 h). Reusing
  the same `saName` in a follow-up run within the cooldown surfaces 409
  `NameAlreadyReserved`. Pick a fresh suffix or wait.

---

## Composition Recipes

Reference recipes. Each test case lives in its own SKILL and composes
capabilities below; it is **not** the responsibility of this library to
enumerate them.

| Scenario | Recommended chain |
|---|---|
| ADO 15379484 Premium cache step 10 (full Import/Export sub-flow) | Prereq → Provision-Storage → Enable-NonSSL → Populate → Portal-Export → FLUSHALL → Portal-Import → Teardown |
| ADO 35857032 Export Data Blade Test (AMR or Premium) | Prereq → Provision-Storage → Enable-NonSSL → Populate → Portal-Export → Teardown |
| ADO 35857777 Import Data Blade Test (AMR or Premium) | Prereq → Provision-Storage → Enable-NonSSL → Populate → Portal-Export → FLUSHALL → Portal-Import → Teardown |
| Re-stage on existing cache + storage (skip Prov/Enable) | Prereq → Populate → Portal-Export → FLUSHALL → Portal-Import → Teardown |
| CLI-only round trip (no UI evidence) | Prereq → Provision-Storage → Populate → `az redis export` → FLUSHALL → `az redis import` → Teardown |

**Composition rules** (applied by the calling test SKILL, not by this library):

- Each capability returns a verifiable signal (exit code + ARM/blob/DBSIZE
  evidence) — propagate failures upward, do not silently swallow.
- Verification belongs to the capability that produced the state. Do not
  duplicate the DBSIZE assertion after a freshly-returned Populate PASS;
  **do** call it again if state may have drifted (long pause, parallel run,
  recovery from a chat reset).
- A test SKILL must not inline Playwright orchestration, redis-cli loops, or
  ARM bodies — extend the relevant capability in `create-import-export.js`
  instead.
- The three-file evidence chain (`dbsize-pre-export.txt` /
  `dbsize-post-flush.txt` / `dbsize-post-import.txt`) is the **only**
  artefact the round-trip recipes are required to produce.

---

## Phase Gate checklist (must-pass for ADO compositions)

- [ ] Storage and cache **same region** (Capability 2).
- [ ] Cache has write access to storage (shared-key or MI + `Storage Blob Data Contributor`).
- [ ] `enableNonSslPort = true` during the run (Capability 3); flipped back to `false` at Teardown.
- [ ] Populate produced DBSIZE ≥ 19,000 (Capability 4).
- [ ] Export produced ≥ 1 non-empty `.rdb` PageBlob under the prefix (Capability 5).
- [ ] FLUSHALL produced DBSIZE == 0 across every shard (Capability 6).
- [ ] Import restored DBSIZE ≥ 95% of baseline within 5 min, with at least one `key:*` SCAN sample (Capability 7).
- [ ] Three-file evidence chain present in `<evidenceDir>` (Capabilities 4 / 6 / 7).
- [ ] Portal Export blade: `Export` button disabled before container picked, enabled after, notification toast observed.
- [ ] Portal Import blade: `Import` button disabled before blob picked, enabled after, notification toast observed.

---

## Reusable scripts

| Module | Purpose | Used by |
|---|---|---|
| [create-import-export.js](create-import-export.js) | Single executable contract — all 8 capabilities (ARM + CDP Playwright UI + redis-cli evidence). | Capabilities 1–8 |
| [mcp/server.js](mcp/server.js) + [mcp/tools.js](mcp/tools.js) | MCP wrapper exposing every capability as a JSON-callable tool. | AI agents |
| `Claude-Redis/scripts/portal_drive.py` *(legacy)* | Original Python implementation; kept for historical reference. Superseded by `create-import-export.js`. | — |
| `Claude-Redis/scripts/dbsize_evidence.ps1` *(legacy)* | Original PowerShell evidence writer; superseded by `writeDbsizeEvidence`. | — |

---

## Verified Playwright selectors

(All confirmed against the Portal blades as of `ManualTestingGeo-CUSE-0512`.
Live source: [create-import-export.js](create-import-export.js).)

| Element | Recommended selector |
|---|---|
| Advanced settings blade (direct jump) | `page.goto(".../resource{rid}/redisConfig")` |
| Export data blade (direct jump) | `page.goto(".../resource{rid}/export")` |
| Import data blade (direct jump) | `page.goto(".../resource{rid}/import")` |
| `Choose Storage Container` link | `page.get_by_text("Choose Storage Container", exact=True)` |
| `Choose Blob(s)` link | `page.get_by_text("Choose Blob(s)", exact=False)` |
| Storage account row | `page.get_by_text("<sa_name>", exact=True)` |
| Container row (selection) | `page.locator('tr:has-text("<container>")')` |
| Container row drill-in (Import only) | `row.click()` → `row.press("Enter")` |
| Blob checkbox | `page.locator('tr:has-text("<blob>") input[type="checkbox"]').check()` |
| `Select` button (chooser footer) | iterate `div[role="button"]:has-text("Select")` and take the visible one (Export idx≈1, Import idx≈2) |
| `Blob name prefix` input | `page.get_by_label("Blob name prefix")` |
| Export submit button | `page.get_by_role("button", name="Export", exact=True)` |
| Import submit button | `page.get_by_role("button", name="Import", exact=True)` |
| Advanced settings `Save` | cross-frame `span:has-text("Save")` |
| Confirm `Yes` | cross-frame `button:has-text("Yes")` |

---

## Failure mode index

### Playwright automation (CDP-driven Portal)

| Symptom | Root cause | Resolution |
|---|---|---|
| `Advanced settings` / `Export data` / `Import data` missing from left nav | Items live under collapsed groups (Settings / Administration); DOM exists but `aria-hidden`. | Use deep-link `.../resource{rid}/{redisConfig\|export\|import}`. |
| Container row picked but `Select` stays disabled | `getByText("redisexports")` hit the text node, not the row. | Use `locator('tr:has-text("<container>")')` to select the whole row. |
| `Select` click has no effect | Two `Select`-labelled `div[role=button]` exist; the one next to the chooser is hidden. | `clickFirstVisible(page, 'div[role="button"]:has-text("Select")')`. |
| `Blob name prefix` typed into chooser search box | Chooser hadn't closed; `locator("input").first` hit the chooser filter. | After `Select`, `page.getByText("Blob name prefix").waitFor()` before locating the input. |
| `Export` button click navigates to the `Export data` title | `button:has-text("Export")` matches the page title too. | `page.getByRole("button", { name: "Export", exact: true })`. |
| Container row `dblclick` does not drill in (Import) | Azure Fluent UI grid binds drill-in to `Enter`, not double-click. | `row.click()` → `row.press("Enter")`. |
| Blob checkbox click selects row but doesn't tick | Row click ≠ checkbox click. | `tr:has-text("<blob>") input[type=checkbox]` → `check()`. |
| PowerShell shell wedged (`Remove-Item` etc. unknown) | Prior async kill polluted the PSReadLine buffer. | Open a fresh terminal. |
| `node -e $js` exits with `SyntaxError` near a backtick | Backticks inside template literals must be escaped or the here-string must use single-quote form `@'…'@`. | Use the `@'…'@` form shown in **Execution model**; backticks survive verbatim. |
| `Cannot find module 'playwright'` | Playwright isn't installed in Node's `require` resolution path. | `npm install playwright` (workspace root). |
| `redis-cli --scan \| Select-Object -First N` hangs | `--scan` stream; PowerShell pipeline doesn't close stdin after N items. The JS helper uses one-shot `SCAN 0 MATCH 'key:*' COUNT 5` instead. | Use `redisCli(host,6379,key,["SCAN","0","MATCH","key:*","COUNT","5"])`. |
| `redis-cli` reports `unknown option --tls` | Bundled 3.2.100 too old. | Talk to 6379 instead (Capability 3 enabled it). |

### Business / environment

| Symptom | Root cause | Resolution |
|---|---|---|
| `Choose Storage Container` chooser empty | Storage not same region as cache. | Recreate storage in `az redis show … --query location`. |
| Export → `AuthorizationFailed` writing blob | Cache MI lacks `Storage Blob Data Contributor`. | Grant the role on the storage account. |
| Import completes but DBSIZE far below baseline | Populate keys had TTLs / a shard's blob was missing from `--files`. | Re-populate without TTLs; clustered: pass all shard blobs. |
| `redis-benchmark` reports `MOVED` lines | Clustered cache without `-c`. | Add `-c`; or ignore for plain `-t set` counting. |
| Portal Import notification spins forever | RDB engine-version incompatible (cache was upgraded across a major version). | Re-export and re-import. |
| `az redis export` stuck `InProgress` past CLI timeout | Sync SDK timed out but the operation still runs. | Kill the CLI, use Portal; or pass `--no-wait`. |
| 6379 left open at end of run | Teardown skipped. | Always call Capability 8. |

---

## Related skills

- [`portal-bvt-basic-cache-creation`](../portal-bvt-basic-cache-creation/SKILL.md) — Premium / Basic cache provisioning (run before Capability 1).
- [`geo-replication-setup`](../geo-replication-setup/SKILL.md) — Geo Premium cache creation + Link / Failover / Unlink (same Workflow / Script split).
- [`redis-persistence`](../redis-persistence/SKILL.md) — AOF / RDB persistence (same Workflow / Script split).
- [`ado-testcase-extractor`](../ado-testcase-extractor/SKILL.md) — pull latest ADO test-case fields.

---

## Out of scope

- Cache **creation** — compose with `portal-bvt-basic-cache-creation` or `geo-replication-setup`.
- Performance benchmarking — use the `Redis_Benchmark` skill.
- Storage RBAC / firewall validation as a standalone scenario.
- AAD-only caches (no Import/Export blade).
- Redis data-plane functional validation beyond DBSIZE / SCAN sampling — use a dedicated validation skill.
