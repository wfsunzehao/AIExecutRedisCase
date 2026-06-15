---
name: redis-benchmark-azure
description: |
  End-to-end memtier_benchmark workflow against Redis caches on Azure VMs: create/select
  caches, start the test VMs, batch-write Parameters.txt, start and monitor the load test,
  pull results, generate a unified comparison report, and tear down (deallocate VMs / delete
  caches). Each capability has a corresponding PowerShell/Python implementation script
  (`../../scripts/`), wrapped by `benchmark.js` and exposed as callable MCP tools via
  `mcp/server.js`. USE FOR: orchestrating an end-to-end Redis performance test; batch-managing
  benchmark VMs; generating cross-SKU comparison reports. DO NOT USE FOR: creating/deleting
  benchmark VMs; modifying NSGs; resources outside MemtierbenchmarkTest / machine2e_group.
applyTo: "**"
---

# Redis Benchmark on Azure VMs

Run `memtier_benchmark` SSL load tests against the Redis caches in `machine2e_group`, under the `MemtierbenchmarkTest` resource group of the `CacheTeam - Redis Perf and Stress Resources` subscription, and produce a unified visual comparison report.

## 1. Overview

| Item | Value |
|---|---|
| Benchmark VM subscription | `fc2f20f5-602a-4ebd-97e6-4fae3f1f6424` (CacheTeam - Redis Perf and Stress Resources) |
| Benchmark VM resource group | `MemtierbenchmarkTest` |
| Cache subscription | `1e57c478-0901-4c02-8d35-49db234b78d2` (Cache Team - Vendor CTI Testing 2) |
| Cache resource group | `machine2e_group` |
| Cache region | `eastus2euap` (Zone 2) |
| VM username | `azureuser` |
| Default private key path | `%USERPROFILE%\.ssh\{VMName}_key.pem` |
| Test date placeholder | `{MMDD}`, e.g. `0507` |
| VM size | `Standard_D32ds_v5` (32 vCPU / 128 GiB / Ubuntu 22.04) |

> Private keys are not distributed with the skill; the VM owner must provide them separately.

### 1.1 memtier_benchmark baseline parameters

| Parameter | Premium / Basic / Standard C2–C6 | Standard C0 / C1 |
|---|---|---|
| `--threads` | 16 | 16 |
| `--clients` (per thread) | 32 | 16 |
| `--pipeline` | 100 | 100 |
| `--data-size` | 1024 bytes | 1024 bytes |
| `--ratio` | 1:1 | 1:1 |
| `--requests` (`-n`) | 1,000,000 / thread | 1,000,000 / thread |
| Rounds per cache | 10 | 10 |
| Transport | SSL/TLS 6380 | SSL/TLS 6380 |

### 1.2 Pass criteria

| Dimension | Threshold |
|---|---|
| Completed rounds | Single cache results array length = 10 |
| File integrity | size > 0; `jq length` = 10 |
| RPS stability | 10-round RPS spread / median ≤ 15% |
| p99 stability | 10-round p99 spread ≤ 1.5× median |
| Process cleanliness | Remote memtier process count = 0 |

### 1.3 Phase validation gates

The end-to-end flow (§4) can be validated phase by phase per the table below; each phase calls its corresponding script (also wrapped by `benchmark.js` / `mcp/`), and only proceeds to the next phase after the "pass condition" is met.

| Phase | Script | Pass condition | See |
|---|---|---|---|
| 0 Environment baseline | `Assert-BenchEnv.ps1` | All `[OK]`; all 8 `*_key.pem` exist; both subscriptions return `az account show` | §2 |
| 1 Create caches | `New-RedisCaches.ps1 -Date {MMDD}` | `provisioningState!='Succeeded'` query is empty (caches not ready after 30 min are auto-SKIPped) | §4.1 |
| 2 Start VMs | `Start-BenchVMs.ps1` | `powerState!='VM running'` query is empty; `vms-ips.tsv` has 8 rows | §4.2 |
| 3 Deploy runner | `Deploy-RunnerScripts.ps1` | `file` outputs `ASCII text`, **without** `with CRLF line terminators` | §4.3 |
| 4 Write Parameters | `Update-Parameters.ps1 -Date {MMDD}` | `cat -A ~/Parameters.txt` ends with a single `$`, **no** `^M` | §4.4 |
| 5 Start load test | `Restart-AllBench.ps1 -Date {MMDD}` | All 8 VMs `date_in_head=1` + `FIRST_LINE` contains the current date | §4.5 |
| 6 Monitor | `Watch-Bench.ps1 -Date {MMDD}` | Script exits with `=== ALL DONE ===` (`exit 0`) | §4.6 |
| 7 Pull results | `Pull-Results.ps1 -Date {MMDD}` | `Pull-Results.ps1 -VerifyOnly` outputs `OK: 19 results files, all > 0 bytes` | §4.7 |
| 8 Generate report | `generate-unified-report.py --date {MMDD}` | HTML 3 tabs × 19 caches in full; charts render correctly | §4.8 |
| 9 Teardown | `Invoke-Teardown.ps1 -Date {MMDD}` | VM/Cache leftover queries are all empty | §4.9 |

> Recovery entry point for a single cache failure / 0 bytes / hang: `Invoke-CacheRetry.ps1 -Vm <VM short name> -Cache <cache suffix> -Date {MMDD}` (on the remote, first `pkill -9 -f memtier_benchmark`, `rm` the empty results, keep only that line in a temporary `Parameters.txt`, then rerun it alone — see §6.6).

## 2. Prerequisites

- Access to both Azure subscriptions (see §1).
- The SSH private keys `.pem` for the 8 test VMs (placed at the default path per the naming convention).
- Local software: Azure CLI (`az`), OpenSSH (`ssh` / `scp`), Python 3.10+, PowerShell 5.1+ or PowerShell 7+.
- All scripts under this repo's `scripts/` (see table below).

Bundled scripts (distributed alongside this SKILL.md):

| Script | Purpose |
|---|---|
| `scripts/update-parameters.ps1` | Pull cache hostname + key and write them into each VM's `Parameters.txt`, arg `-Date {MMDD}` |
| `scripts/Run_multiple_benchmarks_ssl.sh` | Batch benchmark on the VM (hardened for last-line/CRLF); must be scp'd to every VM |
| `scripts/Run_Benchmark_ssl.sh` | Run a single cache 10 times on the VM (built into the VM image; add it if missing) |
| `scripts/kill-and-clean.sh` | Kill memtier + clean up result files on the VM |
| `scripts/clean-restart.sh` | **Recommended**: one-stop kill→wait→clean→start→verify on the VM, arg `<MMDD>` (see §4.5) |
| `scripts/restart-benchmarks.ps1` | ⚠ **Known bugs** (pkill missing `-f`, verify falsely reports clean — see §6.7); not recommended, kept only for historical reference |
| `scripts/Invoke-CacheRetry.ps1` | Recovery entry point for a single cache failure / 0 bytes / hang, args `-Vm <VM short name> -Cache <cache suffix> -Date {MMDD}` (see §6.6) |
| `scripts/pull-results.ps1` | Pull the result JSONs from all VMs, arg `-Date {MMDD}` |
| `scripts/generate-unified-report.py` | Generate the unified comparison report, arg `--date {MMDD}` |

## 3. Resource mapping

### 3.1 VM ↔ Cache

Each VM's `~/Parameters.txt` holds the cache hostnames + keys corresponding to the numbers in the VM name. For example, `MemtierbenchmarkTest-P3P4P5` contains P3, P4, P5.

| VM prefix | Tier | Note |
|---|---|---|
| `P{n}` | Premium | `P1` = Premium 1 |
| `SC{n}` | Standard | `SC0` = Standard C0 |
| `BC{n}` | Basic | `BC0` = Basic C0 |

| VM name | Caches | Private key file |
|---|---|---|
| MemtierbenchmarkTest-BC0BC1 | Basic C0, C1 | `MemtierbenchmarkTest-BC0BC1_key.pem` |
| MemtierbenchmarkTest-BC2BC3 | Basic C2, C3 | `MemtierbenchmarkTest-BC2BC3_key.pem` |
| MemtierbenchmarkTest-BC4BC5BC6 | Basic C4, C5, C6 | `MemtierbenchmarkTest-BC4BC5BC6_key.pem` |
| MemtierbenchmarkTest-P1P2 | Premium P1, P2 | `MemtierbenchmarkTest-P1P2_key.pem` |
| MemtierbenchmarkTest-P3P4P5 | Premium P3, P4, P5 | `MemtierbenchmarkTest-P3P4P5_key.pem` |
| MemtierbenchmarkTest-SC0SC1 | Standard C0, C1 | `MemtierbenchmarkTest-SC0SC1_key.pem` |
| MemtierbenchmarkTest-SC2SC3 | Standard C2, C3 | `MemtierbenchmarkTest-SC2SC3_key.pem` |
| MemtierbenchmarkTest-SC4SC5SC6 | Standard C4, C5, C6 | `MemtierbenchmarkTest-SC4SC5SC6_key.pem` |

> Public IPs change on every VM restart; fetch them fresh each time: `az vm show ... --query "publicIps"`.

### 3.2 Cache naming convention

| Type | Naming format | Example ({MMDD}=0507) |
|---|---|---|
| Premium | `Verifyperformance-P{n}-EUS2E-{MMDD}` | `Verifyperformance-P1-EUS2E-0507` |
| Standard | `Verifyperformance-C{n}-EUS2E-Standard-{MMDD}` | `Verifyperformance-C0-EUS2E-Standard-0507` |
| Basic | `Verifyperformance-C{n}-EUS2E-Basic-{MMDD}` | `Verifyperformance-C0-EUS2E-Basic-0507` |

### 3.3 Parameters.txt format

One cache per line:

```
<cache hostname> <access key>
```

> Keep **only** a single trailing `\n` at the end of the file, with no extra blank lines (see pitfall §6.1).

## 4. End-to-end flow

> Examples below use the date placeholder `0507`; replace it with the current date each run.

### 4.1 Create the current round's caches (only when machine2e_group has none for this round)

Required cache configuration:

- Region: `eastus2euap`
- Endpoint: Public Endpoint
- Non-TLS port: Enable (6379)
- Microsoft Entra Authentication: Disable
- Access Keys Authentication: Enable

Example (Premium P1):

```bash
az redis create \
  --resource-group machine2e_group \
  --subscription 1e57c478-0901-4c02-8d35-49db234b78d2 \
  --name Verifyperformance-P1-EUS2E-0507 \
  --location eastus2euap \
  --sku Premium --vm-size P1 \
  --enable-non-ssl-port \
  --redis-configuration "{\"aad-enabled\":\"false\"}"
```

For Standard/Basic, replace `--sku ... --vm-size ...` with `--sku Standard --vm-size C{n}` or `--sku Basic --vm-size C{n}`.

> **Two pitfalls in the PowerShell environment** (verified 2026-05-20):
> 1. `az redis create` does **not** support `--no-wait` (unlike `az vm start`). For batch submission, don't wait for a synchronous return → use `Start-Process az.cmd -NoNewWindow -PassThru -RedirectStandardOutput ... -RedirectStandardError ...` to fire-and-forget 19 background processes, then poll `provisioningState` with `az redis list`.
> 2. `--redis-configuration` is easy to trip over under PS in both forms:
>    - shorthand `aad-enabled=false`: az parses it as JSON and reports `Failed to parse string as JSON / Expecting value: line 1 column 1 (char 0)`.
>    - JSON `"{\"aad-enabled\":\"false\"}"`: PS's double-quote escaping often gets swallowed.
>    AAD is disabled by default, so **just omit `--redis-configuration`** — most reliable, and still satisfies "Microsoft Entra Authentication: Disable".
> 3. After `Start-Process`, ARM takes ~30s to register before it appears in `az redis list`; don't treat a 0 count right after spawning as failure.
> 4. **PS 5.1 array concatenation precedence pitfall**: `@('a' + $Date, 'b' + $Date)` is NOT a two-element array! It parses as `'a' + ($Date, 'b') + $Date` → a single-element string `"a 0520 b 0520"`. You must parenthesize each element: `@(("a$Date"),("b$Date"))` or use the `"$prefix$Date"` string interpolation.
> 5. **ssh under Windows PowerShell will always trip over CRLF with here-strings**: PS here-strings default to `\r\n` line endings, and when ssh passes them straight to the remote bash, every line carries a `\r`, so `set -u\r` is treated as `set -` and reports `invalid option`, and `2>/dev/null\r` is treated as `/dev/null\r` and reports Permission denied. **Fix**: write the script to a local `.sh` file and `-replace "`r`n","`n"`, scp it to the VM, then run `ssh ... "bash xxx.sh"`; do not `ssh ... "$herestring"` directly.
> 6. **`Tee-Object -FilePath` writes a UTF-16-LE BOM by default in PS 5.1**, so a later `Select-String` or `Get-Content` reading as ASCII will be garbled. Either `Get-Content -Encoding Unicode`, or switch to `... 2>&1 | Out-File -Encoding ascii` (Tee does not support the -Encoding parameter).

Confirm all caches are in state `Succeeded`:

```bash
az redis list -g machine2e_group --subscription 1e57c478-0901-4c02-8d35-49db234b78d2 \
  --query "[?ends_with(name,'-0507')].{name:name,state:provisioningState}" -o table
```

> Any cache whose state is not `Succeeded` must be removed from the corresponding VM's `Parameters.txt` (see §6.1), otherwise that VM's entire test queue will stall.

> **Wait for cache creation to complete**: after creating caches in this step, wait about **30 minutes**, then run the status query command above; for caches still not `Succeeded` once 30 minutes elapse, stop waiting and remove that line from the corresponding VM's `Parameters.txt` per §6.1 so subsequent tests skip that cache. If this round's caches were already created and ready earlier, skip the wait and go directly to §4.2.

### 4.2 Start the 8 benchmark VMs

The VMs default to `VM deallocated` and must be batch-started first:

```powershell
$vms = 'BC0BC1','BC2BC3','BC4BC5BC6','P1P2','P3P4P5','SC0SC1','SC2SC3','SC4SC5SC6'
foreach ($v in $vms) {
  az vm start -g MemtierbenchmarkTest -n "MemtierbenchmarkTest-$v" `
    --subscription fc2f20f5-602a-4ebd-97e6-4fae3f1f6424 --no-wait | Out-Null
}
```

After 1–2 minutes, confirm all are `VM running`:

```powershell
az vm list -g MemtierbenchmarkTest -d --query "[].{n:name,p:powerState}" -o table
```

### 4.3 Deploy / update the execution scripts on the VMs (first time only, or after script changes)

```powershell
foreach ($v in $vms) {
  $key = "$env:USERPROFILE\.ssh\MemtierbenchmarkTest-$($v)_key.pem"
  $ip  = az vm show -g MemtierbenchmarkTest -n "MemtierbenchmarkTest-$v" `
           --subscription fc2f20f5-602a-4ebd-97e6-4fae3f1f6424 `
           --show-details --query "publicIps" -o tsv
  scp -i $key Claude-Redis/scripts/Run_multiple_benchmarks_ssl.sh `
    "azureuser@$($ip):Run_multiple_benchmarks_ssl.sh"
  ssh -i $key "azureuser@$($ip)" 'chmod +x ~/Run_multiple_benchmarks_ssl.sh'
}
```

### 4.4 Write Parameters.txt

```powershell
powershell -ExecutionPolicy Bypass -File scripts/update-parameters.ps1 -Date 0507
```

> **You must pass `-Date` explicitly.** Auto-inference only takes the first `-(\d{4})` match, so old-date caches get wrongly matched.

### 4.5 Start the load test (recommended: SSH each VM and run `clean-restart.sh`)

> ⚠ **Do not use `scripts/restart-benchmarks.ps1` anymore** — see §6.7. Instead scp `clean-restart.sh` to each VM and run it over ssh, verifying per VM that FIRST_LINE contains the current date.

The 5 stages of `scripts/clean-restart.sh`:

1. **kill**: in order, `sudo pkill -9 -f` runner → Run_Benchmark → memtier_benchmark (order per §6.5)
2. **wait**: loop `pgrep -f memtier_benchmark | wc -l` until 0 (max 30s)
3. **clean**: `rm -f run.log out.json out.tmp results-*-${DATE}.json output-${DATE}.txt`
4. **verify+abort**: if remaining memtier ≠ 0, exit immediately (don't recklessly start)
5. **start+verify**: `nohup ./Run_multiple_benchmarks_ssl.sh > run.log 2>&1 < /dev/null & disown`, then after sleep 3 assert `head -1 run.log` contains the current `{MMDD}`

Outputs three lines: `CLEANED ...`, `STARTED pid=... runner_pid=... date_in_head=1`, `FIRST_LINE: Running benchmark with name: Verifyperformance-...-{MMDD}...`.

Deploy + run (PowerShell):

```powershell
$Date = '0507'
$vms = 'BC0BC1','BC2BC3','BC4BC5BC6','P1P2','P3P4P5','SC0SC1','SC2SC3','SC4SC5SC6'
foreach ($v in $vms) {
  $ip  = az vm show -g MemtierbenchmarkTest -n "MemtierbenchmarkTest-$v" `
           --subscription fc2f20f5-602a-4ebd-97e6-4fae3f1f6424 --show-details --query publicIps -o tsv
  $key = "$env:USERPROFILE\.ssh\MemtierbenchmarkTest-$($v)_key.pem"
  Write-Host "===== $v ($ip) ====="
  scp -i $key -o StrictHostKeyChecking=no Claude-Redis/scripts/clean-restart.sh `
    "azureuser@${ip}:clean-restart.sh" | Out-Null
  # strip CRLF (scripts uploaded by Windows scp may carry \r), then run
  ssh -i $key -o StrictHostKeyChecking=no "azureuser@$ip" `
    "tr -d '\r' < clean-restart.sh > t && mv t clean-restart.sh && chmod +x clean-restart.sh && ./clean-restart.sh $Date"
}
```

**Mandatory verification**: each VM's output must satisfy `date_in_head=1` and `FIRST_LINE` containing the current date. If any fails, rerun on that VM individually — **do not** trust secondhand signals like "pid was generated" (§6.8).

To manually start a single VM (without the clean step):

```bash
nohup ./Run_multiple_benchmarks_ssl.sh > run.log 2>&1 < /dev/null &
disown
echo "PID: $!"
sleep 3 && head -1 run.log   # must show Verifyperformance-...-{MMDD}
```

### 4.6 Monitor progress

> **Measured durations** (full 19-cache run on 2026-05-20):
> - **Premium** single cache ~10–20 min (350–450 K RPS, 10 rounds × ~1–2 min/round)
> - **Standard / Basic** single cache ~**2 hours** (20–80 K RPS, 10 rounds × **~13 min/round**, because memtier `--threads 16 --clients 1 -n 1000000` is actually 16 M requests/round)
> - Single-VM total = cache count × per-cache duration: 3-cache Basic/Standard VMs like BC4BC5BC6 / SC4SC5SC6 take **~6 hours**
> - The monitoring script's timeout must be set to at least **6 h**, don't estimate by 1 h
> - `R=expected` does not mean done: the results file is created when each cache **starts**, so it only counts as finished when `m=0` (0 memtier processes)

Poll all VMs every 5–15 minutes, exit when all are idle (fetch `{IP_X}` fresh with `az vm show`):

```powershell
$DATE = '0507'
$vms = @(
  @{n='MemtierbenchmarkTest-BC0BC1';     ip='{IP_1}'},
  @{n='MemtierbenchmarkTest-BC2BC3';     ip='{IP_2}'},
  @{n='MemtierbenchmarkTest-BC4BC5BC6';  ip='{IP_3}'},
  @{n='MemtierbenchmarkTest-P1P2';       ip='{IP_4}'},
  @{n='MemtierbenchmarkTest-P3P4P5';     ip='{IP_5}'},
  @{n='MemtierbenchmarkTest-SC0SC1';     ip='{IP_6}'},
  @{n='MemtierbenchmarkTest-SC2SC3';     ip='{IP_7}'},
  @{n='MemtierbenchmarkTest-SC4SC5SC6';  ip='{IP_8}'}
)
$i = 0
while ($true) {
  $i++; $ts = Get-Date -Format 'HH:mm:ss'
  Write-Host "[$ts] Check #$i"
  $allDone = $true
  foreach ($v in $vms) {
    $k = "$env:USERPROFILE\.ssh\$($v.n)_key.pem"
    $r = ssh -i $k -o StrictHostKeyChecking=no "azureuser@$($v.ip)" `
      "echo m=`$(pgrep -f memtier_benchmark | wc -l) results=`$(ls results-*-$DATE.json 2>/dev/null | wc -l)" 2>&1
    Write-Host "  [$($v.n)] $r"
    if ($r -notmatch 'm=0 ') { $allDone = $false }
  }
  if ($allDone) { Write-Host '=== ALL DONE ==='; break }
  Start-Sleep -Seconds 900
}
```

How to interpret the `m=` value: see §6.4. You can also follow a single VM with `tail -f run.log`.

### 4.7 Collect results locally

```powershell
powershell -ExecutionPolicy Bypass -File scripts/pull-results.ps1 -Date 0507
```

Optional parameters: `-OutDir`, `-KeyDir` (default `$env:USERPROFILE\.ssh`).

### 4.8 Generate the unified comparison report

```powershell
python scripts/generate-unified-report.py --date 0507
```

| Parameter | Required | Default |
|---|---|---|
| `--date` | Yes | — |
| `--results-dir` | No | `<scripts>/results-<date>` |
| `--out` | No | `<scripts>/cache-comparison-<date>.html` |

See §5 for the report output format.

### 4.9 Teardown after the test (mandatory)

After the report is produced, two teardown actions run by default:

1. Stop this round's 8 benchmark VMs to `VM deallocated`.
2. Delete this round's caches (filter by date suffix).

Execution principles:

- If the user has explicitly done it manually → just record it, don't repeat.
- Otherwise run the default flow and report status.

## 5. Unified report spec (default output format)

- Output: `scripts/cache-comparison-{MMDD}.html`, single file, clickable tier switching.
- Required elements:

| Element | Requirement |
|---|---|
| Tab switching | Three buttons `Premium / Standard / Basic`, default `Premium`, switching shows only the corresponding panel |
| Parameter block + parameter columns | Table columns include `Clients`, `Threads`, `Requests`, `Size (bytes)`, `Pipeline`; Standard special case: C0/C1 `Clients=16`, C2-C6 `Clients=32` |
| All cache rows | Show all of Premium `P1-P5`, Standard/Basic `C0-C6`, not just completed items |
| Status column | `Complete(10/10)` / `Incomplete(n/10)` / `Skipped/Missing`; performance columns of non-complete items filled with `-` |
| Performance metrics | `Gets RPS`, `p50/p99/p99.9/p99.99 (ms)`; compared only among completed items; highlight max RPS and min latency, optional `BEST RPS` label |
| Charts (Chart.js) | At least 4 charts per tier: RPS comparison, latency comparison, per-cache 10-round RPS variation, per-cache 10-round p99 variation |
| Statistics basis | Sort the 10 results by `Gets RPS` and take the 6th (1-based) as the median; note in the text that "only items with 10 completed rounds participate in the median statistics" |

## 6. Pitfalls and troubleshooting

### 6.1 Parameters.txt last line / newline / skipping a cache

The end of the file must keep **exactly** one `\n`:

- Missing newline → bash `while read` drops the last line (the last cache isn't tested).
- Extra newline → an empty host/key is read in, and `Run_Benchmark_ssl.sh` reports an SSL error.

The PowerShell pipeline `... | ssh ... "cat > Parameters.txt"` appends `\r\n`; you must switch to `WriteAllText` + `scp` (`update-parameters.ps1` already does this).

`Run_multiple_benchmarks_ssl.sh` is already hardened:

- `while IFS= read -r line || [[ -n "$line" ]]` tolerates a missing trailing newline.
- `line="${line%$'\r'}"` strips the `\r` from CRLF.

Skip a cache whose state is not `Succeeded`:

```bash
ssh -i "<key.pem>" azureuser@<IP> \
  "grep -v '<cache name fragment>' ~/Parameters.txt > ~/Parameters.tmp && mv ~/Parameters.tmp ~/Parameters.txt"
```

### 6.2 PowerShell can't find az / ssh

```powershell
$env:PATH += ";C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin"
```

PowerShell 5 has no built-in `pwsh`; run scripts uniformly with `powershell -ExecutionPolicy Bypass -File <ps1>`.

### 6.3 Escaping when running SSH commands in PowerShell

```powershell
# ✅ Wrap the remote command in single quotes so bash variables aren't expanded by PS
ssh -i "key.pem" azureuser@IP 'ls results-P*.json && pgrep -f memtier_benchmark | wc -l'

# ❌ Inside double quotes, $f is expanded by PS to empty
ssh -i "key.pem" azureuser@IP "echo $f"
```

Always write complex remote commands as a local script → `scp` → `ssh ... 'bash /tmp/script.sh'` to avoid escaping hell (see `scripts/kill-and-clean.sh`).

### 6.4 `pkill` / `pgrep` silent failure and self-matching

The `memtier_benchmark` process name is 17 chars > the 15-char limit of Linux `/proc/PID/comm`, so matching by comm **fails silently**. Always add `-f`:

| ❌ Wrong | ✅ Right |
|---|---|
| `pkill memtier_benchmark` | `pkill -f memtier_benchmark` |
| `pgrep memtier_benchmark \| wc -l` | `pgrep -f memtier_benchmark \| wc -l` |
| `pidof memtier_benchmark` | `pgrep -f memtier_benchmark` |

`pgrep -f memtier_benchmark | wc -l` will **self-match** the outer `bash -c` and `$(...)` child processes:

| Source | Matches? |
|---|---|
| The real `memtier_benchmark` process (1, serial 10-round loop) | ✅ |
| Outer `bash -c "echo m=..."` (cmdline contains the literal) | ✅ |
| Transient `pgrep`/`wc` child processes inside `$(...)` | ✅ (momentary) |

Interpretation: `m=2` or `m=3` means running; `m=0` means finished.

> **2026-05-20 watcher misjudgment**: when writing `ssh ... "m=$(pgrep -f memtier_benchmark | wc -l)..."` in PowerShell, **this ssh remote's `bash -c` cmdline itself contains the literal `memtier_benchmark`**, and `pgrep -f memtier_benchmark` self-matches too, so the baseline is `m=2` (even when the real process count = 0). Consequence: the watcher never reaches `m=0`, and 5 VMs that had actually finished were still reported as RUNNING. **Fix**: change the remote command to `ps -eo comm | grep -c memtier_benc` (match by the `comm` field = first 15 chars of the process name, which doesn't self-match the cmdline), so the baseline truly drops to zero. A fully reliable done check: `m_real=0` AND `runner_real=0` (where `runner_real = pgrep -f Run_multiple | wc -l - 2`, with 2 being the ssh+grep self-match baseline).

### 6.5 Kill order: runner first, then memtier

`Run_multiple_benchmarks_ssl.sh` is memtier's parent process, looping `for i in 1..10; do memtier_benchmark ...`. Killing memtier without killing the runner first immediately forks a new memtier. Correct order (already implemented in `scripts/kill-and-clean.sh`):

1. `pkill -9 -f Run_multiple_benchmarks_ssl.sh`
2. `pkill -9 -f Run_Benchmark_ssl.sh`
3. `pkill -9 -f memtier_benchmark`
4. Recheck in a loop `pgrep -f memtier_benchmark` until it's 0

### 6.6 Single-point timeout / failure handling

- A single cache not done after > 1h: `ssh ... 'sudo pkill -9 -f memtier_benchmark'` to manually skip it.
- Process exited unexpectedly but results incomplete: `ssh ... './Run_Benchmark_ssl.sh <host> <key>'` to rerun that cache.
- Full rerun: per §4.5, scp+ssh `clean-restart.sh` to all 8 VMs; **do not** use `restart-benchmarks.ps1`.

> **2026-05-20 measured: jq parse blowup causes the runner to die early**: SC2SC3's second cache (C3) was halfway through when `run.log` showed:
> ```
> jq: error (at out.json:21601): object ({"configura...) and array ([null]) cannot be added
> ./Run_Benchmark_ssl.sh: line 48: [: -lt: unary operator expected
> ```
> Cause: one round's memtier wrote an `out.json` in an unmergeable object + array form, so when `Run_Benchmark_ssl.sh` used jq to merge / count it got an empty string, and the integer comparison `[ $count -lt 10 ]` on line 48 failed on the empty string → the whole script `set -u`/implicitly exited, **leaving `results-C3-0520.json` as a 0-byte empty file**. Detection: when probing, don't just look at `jq length`, also check the byte count from `ls -la`; 0 bytes means failure. Remedy: `rm` the empty file → keep only that line in Parameters.txt → rerun `./Run_multiple_benchmarks_ssl.sh`.

### 6.7 Known bugs in `restart-benchmarks.ps1` (measured 0513)

The entire 0513 round ran empty because of it:

- Phase 1 used `sudo pkill -9 memtier_benchmark` (missing `-f`) + a `pidof memtier_benchmark` check — the `memtier_benchmark` process name is 17 chars, exceeding the comm limit of 15, so the match fails silently.
- Phase 2 verify therefore always output `memtier_left=0 results_left=0`, masking the old processes that weren't actually killed.
- Phase 3, after `nohup` started the new runner, didn't assert that `head -1 run.log` contained the current date — it just checked whether the pid was non-empty and reported "started". Result: the old runner was still running old-date caches, the new runner never truly started (or exited immediately because the old runner held the cache), and all 8 VMs went silent for hours.

Until it's fixed, use the `clean-restart.sh` path in §4.5 directly.

### 6.8 Don't trust indirect signals like "pid was generated"

To judge whether a restart actually succeeded, the **only trustworthy** signal:

```bash
head -1 run.log    # must contain this round's {MMDD} cache hostname
```

None of the following count as proof of success:

- The pid printed by `nohup ./script &; echo $!` — the script may exit 0.1s later.
- `pgrep -f Run_multiple_benchmarks_ssl.sh | wc -l ≥ 1` — self-matches the ssh remote `bash -c` cmdline (§6.4).
- `ls results-*.json` having files — may be leftovers from the previous round.

First action when investigating an empty run: directly `ssh ... 'head -1 run.log; ls -lt results-*.json | head -5; ps -eo pid,etime,cmd | grep -v grep | grep -E "memtier|Run_"'`.

### 6.9 Subagents are untrustworthy for ops confirmation

In the 0513 round, subagents repeatedly fabricated IPs (e.g. `20.245.x.x`), fabricated 2024 timestamps, and falsely reported "started successfully". For any judgment of "is it actually running", always go through `run_in_terminal` with direct ssh, write the output to a local file and `read_file` it — **do not** let a subagent relay results.

## 7. Reference commands (consult as needed)

### 7.1 List all VMs in the resource group

```bash
az vm list -g MemtierbenchmarkTest --subscription fc2f20f5-602a-4ebd-97e6-4fae3f1f6424 -o table
```

### 7.2 Get a single VM's public IP / state

```bash
az vm show -g MemtierbenchmarkTest -n <VM name> \
  --subscription fc2f20f5-602a-4ebd-97e6-4fae3f1f6424 --show-details \
  --query "{publicIps:publicIps, powerState:powerState}" -o table
```

### 7.3 SSH connection

```bash
ssh -i "$env:USERPROFILE/.ssh/<VM name>_key.pem" azureuser@<public IP>
```

The first time prompts for host key verification; enter `yes` or add `-o StrictHostKeyChecking=no`.

### 7.4 Get a single cache's primary key

```bash
az redis list-keys -g machine2e_group -n <cache name> \
  --subscription 1e57c478-0901-4c02-8d35-49db234b78d2 \
  --query "primaryKey" -o tsv
```

### 7.5 Analyze a single cache's 10 results on the VM

```bash
# All 10 rounds
jq '[.[] | {
  rps:    .["ALL STATS"].Gets["Ops/sec"],
  p50:    .["ALL STATS"].Gets["Percentile Latencies"]["p50.00"],
  p99:    .["ALL STATS"].Gets["Percentile Latencies"]["p99.00"],
  p999:   .["ALL STATS"].Gets["Percentile Latencies"]["p99.90"],
  p9999:  .["ALL STATS"].Gets["Percentile Latencies"]["p99.99"]
}] | sort_by(.rps)' results-P1-0507.json

# Median (6th by RPS)
jq '[.[] | {rps:.["ALL STATS"].Gets["Ops/sec"]}] | sort_by(.rps) | .[5]' results-P1-0507.json
```

### 7.6 Test output file conventions

| File | Content |
|---|---|
| `results-{KEY}-{MMDD}.json` | A single cache's full raw results for 10 rounds |
| `output-{MMDD}.txt` | Median-result summary across all caches |

## 8. Appendix: pitfall quick reference

The table below is an index of §6; see the corresponding subsection for detailed causes and fixes.

| # | Scenario | Key fix | Hardened in |
|---|---|---|---|
| P-1 | PowerShell 5.1 can't find `az` | `$env:PATH += ";C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin"` | `Assert-BenchEnv.ps1` preflight (§6.2) |
| P-2 | PS array concat `@('a'+$D,'b'+$D)` degenerates | Parenthesize each element or use `"$prefix$D"` interpolation | `New-RedisCaches.ps1` / `Update-Parameters.ps1` (§4.1 pitfall 4) |
| P-3 | here-string via ssh remote reports `set -u\r: invalid option` | Write a local `.sh`, `-replace "`r`n","`n"`, scp then run | `Invoke-CacheRetry.ps1` (§4.1 pitfall 5 / §6.3) |
| P-4 | `Tee-Object` defaults to UTF-16 BOM | Switch to `Out-File -Encoding ascii` | `Start-BenchVMs.ps1` (§4.1 pitfall 6) |
| P-5 | `Parameters.txt` PS pipeline writes CRLF to remote | `[IO.File]::WriteAllText` + `scp` | `Update-Parameters.ps1` (§6.1) |
| P-6 | `pkill memtier_benchmark` silently fails (name 17 > comm limit 15) | Must use `pkill -f memtier_benchmark` | `clean-restart.sh` (§6.4 / §6.5) |
| P-7 | `pgrep -f memtier_benchmark` self-matches ssh cmdline, always `m≥2` | Switch to `ps -eo comm \| grep -c memtier_benc` | `Watch-Bench.ps1` / `clean-restart.sh` (§6.4) |
| P-8 | False success (only checks pid, not `head -1 run.log`) | Force-assert the first line contains the current date | `clean-restart.sh` + `Restart-AllBench.ps1` (§6.8) |
| P-9 | `results-*.json` 0 bytes | `rm` the empty file → single-line `Parameters.txt` rerun alone | `Invoke-CacheRetry.ps1` + `Pull-Results.ps1 -VerifyOnly` (§6.6) |
| P-10 | Monitoring timeout estimated at 1 h, 6 h runs misjudged | Standardize timeout to 6 h | `Watch-Bench.ps1` default `-MaxHours 6` (§4.6) |
| P-11 | Subagent fabricates IPs / timestamps | Ops confirmation reads stdout directly via scripts, not relayed | All scripts output stdout directly (§6.9) |
