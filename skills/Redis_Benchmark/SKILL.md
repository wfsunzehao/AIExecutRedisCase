---
name: redis-benchmark-azure
description: |
  在 Azure VM 上对 Redis cache 跑 memtier_benchmark 全流程：创建/选取 cache、
  启动测试 VM、批量写入 Parameters.txt、启动并监控压测、拉取结果、生成统一对比
  报告、关机/删 cache 收尾。每个能力都有对应的 PowerShell/Python 实现脚本
  （`../../scripts/`），并通过 `benchmark.js` 包装、由 `mcp/server.js` 暴露成可
  调用的 MCP 工具。USE FOR：端到端组织一次 Redis 性能测试；批量管理压测 VM；
  生成跨 SKU 对比报告。DO NOT USE FOR：创建/删除压测 VM；修改 NSG；非
  MemtierbenchmarkTest / machine2e_group 的资源。
applyTo: "**"
---

# Redis Benchmark on Azure VMs

在订阅 `CacheTeam - Redis Perf and Stress Resources` 的 `MemtierbenchmarkTest` 资源组下，对 `machine2e_group` 中的 Redis cache 执行 `memtier_benchmark` SSL 压测，并产出统一可视化对比报告。

## 1. 概览

| 项 | 值 |
|---|---|
| 压测 VM 订阅 | `fc2f20f5-602a-4ebd-97e6-4fae3f1f6424`（CacheTeam - Redis Perf and Stress Resources） |
| 压测 VM 资源组 | `MemtierbenchmarkTest` |
| Cache 订阅 | `1e57c478-0901-4c02-8d35-49db234b78d2`（Cache Team - Vendor CTI Testing 2） |
| Cache 资源组 | `machine2e_group` |
| Cache 区域 | `eastus2euap`（Zone 2） |
| VM 用户名 | `azureuser` |
| 私钥默认路径 | `%USERPROFILE%\.ssh\{VM名称}_key.pem` |
| 测试日期占位 | `{MMDD}`，例如 `0507` |
| VM 规格 | `Standard_D32ds_v5`（32 vCPU / 128 GiB / Ubuntu 22.04） |

> 私钥不随 skill 分发，需 VM 所有者单独提供。

### 1.1 memtier_benchmark 基线参数

| 参数 | Premium / Basic / Standard C2–C6 | Standard C0 / C1 |
|---|---|---|
| `--threads` | 16 | 16 |
| `--clients`（每线程） | 32 | 16 |
| `--pipeline` | 100 | 100 |
| `--data-size` | 1024 字节 | 1024 字节 |
| `--ratio` | 1:1 | 1:1 |
| `--requests` (`-n`) | 1,000,000 / 线程 | 1,000,000 / 线程 |
| 单 cache 轮次 | 10 | 10 |
| 传输 | SSL/TLS 6380 | SSL/TLS 6380 |

### 1.2 通过判定（Pass criteria）

| 维度 | 阈值 |
|---|---|
| 完成轮次 | 单 cache results 数组长度 = 10 |
| 文件完整性 | size > 0；`jq length` = 10 |
| RPS 稳定性 | 10 次 RPS 极差 / 中位 ≤ 15% |
| p99 稳定性 | 10 次 p99 极差 ≤ 1.5× 中位 |
| 进程清洁 | 远端 memtier 进程数 = 0 |

### 1.3 Phase 验收门（Validation gates）

端到端流程（§4）可按下表逐阶段验收；每个 Phase 调用对应脚本（亦被 `benchmark.js` / `mcp/` 包装），满足“通过条件”后再进入下一阶段。

| Phase | 脚本 | 通过条件 | 详见 |
|---|---|---|---|
| 0 环境基线 | `Assert-BenchEnv.ps1` | 全部 `[OK]`；8 个 `*_key.pem` 均存在；两订阅均可 `az account show` | §2 |
| 1 创建 cache | `New-RedisCaches.ps1 -Date {MMDD}` | `provisioningState!='Succeeded'` 查询为空（超 30 min 未就绪者自动 SKIP） | §4.1 |
| 2 启动 VM | `Start-BenchVMs.ps1` | `powerState!='VM running'` 查询为空；`vms-ips.tsv` 含 8 行 | §4.2 |
| 3 部署 runner | `Deploy-RunnerScripts.ps1` | `file` 输出 `ASCII text`，**不含** `with CRLF line terminators` | §4.3 |
| 4 写 Parameters | `Update-Parameters.ps1 -Date {MMDD}` | `cat -A ~/Parameters.txt` 末尾仅一个 `$`，**无** `^M` | §4.4 |
| 5 启动压测 | `Restart-AllBench.ps1 -Date {MMDD}` | 8 台全部 `date_in_head=1` + `FIRST_LINE` 含本轮日期 | §4.5 |
| 6 监控 | `Watch-Bench.ps1 -Date {MMDD}` | 脚本以 `=== ALL DONE ===` 退出（`exit 0`） | §4.6 |
| 7 拉取结果 | `Pull-Results.ps1 -Date {MMDD}` | `Pull-Results.ps1 -VerifyOnly` 输出 `OK: 19 results files, all > 0 bytes` | §4.7 |
| 8 生成报告 | `generate-unified-report.py --date {MMDD}` | HTML 三 Tab × 19 cache 全量；图表正常渲染 | §4.8 |
| 9 收尾 | `Invoke-Teardown.ps1 -Date {MMDD}` | VM/Cache 残留查询均为空 | §4.9 |

> 单 cache 失败 / 0 字节 / 卡死的恢复入口：`Invoke-CacheRetry.ps1 -Vm <VM短名> -Cache <cache后缀> -Date {MMDD}`（远端先 `pkill -9 -f memtier_benchmark`、`rm` 空 results、临时 `Parameters.txt` 只留该行后单独重跑，见 §6.6）。

## 2. 前置依赖

- Azure 两个订阅的访问权限（见 §1）。
- 8 台测试 VM 的 SSH 私钥 `.pem`（按命名规律放到默认路径）。
- 本机软件：Azure CLI（`az`）、OpenSSH（`ssh` / `scp`）、Python 3.10+、PowerShell 5.1+ 或 PowerShell 7+。
- 本仓库 `scripts/` 下的全部脚本（详见下表）。

随附脚本（与本 SKILL.md 一同分发）：

| 脚本 | 作用 |
|---|---|
| `scripts/update-parameters.ps1` | 拉 cache 主机名 + key 写入各 VM 的 `Parameters.txt`，参数 `-Date {MMDD}` |
| `scripts/Run_multiple_benchmarks_ssl.sh` | VM 上批量 benchmark（已加固末行/CRLF），需 scp 到每台 VM |
| `scripts/Run_Benchmark_ssl.sh` | VM 上单 cache 跑 10 次（VM 镜像内置；如缺需补） |
| `scripts/kill-and-clean.sh` | VM 上 kill memtier + 清理结果文件 |
| `scripts/clean-restart.sh` | **推荐**：VM 上 kill→wait→clean→start→verify 一站式，参数 `<MMDD>`（见 §4.5） |
| `scripts/restart-benchmarks.ps1` | ⚠ **已知有 bug**（pkill 缺 `-f`、verify 误报清洁，见 §6.7），不推荐；保留仅作历史参考 |
| `scripts/Invoke-CacheRetry.ps1` | 单 cache 失败 / 0 字节 / 卡死时的恢复入口，参数 `-Vm <VM短名> -Cache <cache后缀> -Date {MMDD}`（见 §6.6） |
| `scripts/pull-results.ps1` | 拉取所有 VM 上的结果 JSON，参数 `-Date {MMDD}` |
| `scripts/generate-unified-report.py` | 生成统一对比报告，参数 `--date {MMDD}` |

## 3. 资源映射

### 3.1 VM ↔ Cache

每台 VM 的 `~/Parameters.txt` 中存放 VM 名称对应编号的 cache 主机名 + key。例如 `MemtierbenchmarkTest-P3P4P5` 包含 P3、P4、P5。

| VM 前缀 | Tier | 说明 |
|---|---|---|
| `P{n}` | Premium | `P1` = Premium 1 |
| `SC{n}` | Standard | `SC0` = Standard C0 |
| `BC{n}` | Basic | `BC0` = Basic C0 |

| VM 名称 | 对应 Cache | 私钥文件 |
|---|---|---|
| MemtierbenchmarkTest-BC0BC1 | Basic C0, C1 | `MemtierbenchmarkTest-BC0BC1_key.pem` |
| MemtierbenchmarkTest-BC2BC3 | Basic C2, C3 | `MemtierbenchmarkTest-BC2BC3_key.pem` |
| MemtierbenchmarkTest-BC4BC5BC6 | Basic C4, C5, C6 | `MemtierbenchmarkTest-BC4BC5BC6_key.pem` |
| MemtierbenchmarkTest-P1P2 | Premium P1, P2 | `MemtierbenchmarkTest-P1P2_key.pem` |
| MemtierbenchmarkTest-P3P4P5 | Premium P3, P4, P5 | `MemtierbenchmarkTest-P3P4P5_key.pem` |
| MemtierbenchmarkTest-SC0SC1 | Standard C0, C1 | `MemtierbenchmarkTest-SC0SC1_key.pem` |
| MemtierbenchmarkTest-SC2SC3 | Standard C2, C3 | `MemtierbenchmarkTest-SC2SC3_key.pem` |
| MemtierbenchmarkTest-SC4SC5SC6 | Standard C4, C5, C6 | `MemtierbenchmarkTest-SC4SC5SC6_key.pem` |

> 公网 IP 会随 VM 重启变化，每次现取：`az vm show ... --query "publicIps"`。

### 3.2 Cache 命名规律

| 类型 | 命名格式 | 示例（{MMDD}=0507） |
|---|---|---|
| Premium | `Verifyperformance-P{n}-EUS2E-{MMDD}` | `Verifyperformance-P1-EUS2E-0507` |
| Standard | `Verifyperformance-C{n}-EUS2E-Standard-{MMDD}` | `Verifyperformance-C0-EUS2E-Standard-0507` |
| Basic | `Verifyperformance-C{n}-EUS2E-Basic-{MMDD}` | `Verifyperformance-C0-EUS2E-Basic-0507` |

### 3.3 Parameters.txt 格式

每行一个 cache：

```
<cache主机名> <访问密钥>
```

> 文件末尾**只**保留一个 `\n`，不能有多余空行（陷阱见 §6.1）。

## 4. 端到端流程

> 下文示例日期占位用 `0507`，每次替换成本轮日期。

### 4.1 创建本轮 cache（仅当 machine2e_group 中无本轮 cache 时）

Cache 必备配置：

- Region：`eastus2euap`
- Endpoint：Public Endpoint
- Non-TLS port：Enable（6379）
- Microsoft Entra Authentication：Disable
- Access Keys Authentication：Enable

示例（Premium P1）：

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

Standard/Basic 把 `--sku ... --vm-size ...` 替换为 `--sku Standard --vm-size C{n}` 或 `--sku Basic --vm-size C{n}`。

> **PowerShell 环境的两个坑**（2026-05-20 实测）：
> 1. `az redis create` **不支持** `--no-wait`（与 `az vm start` 不同）。批量提交不要等同步返回 → 用 `Start-Process az.cmd -NoNewWindow -PassThru -RedirectStandardOutput ... -RedirectStandardError ...` 后台 fire-and-forget 19 个进程，再用 `az redis list` 拿 `provisioningState` 轮询。
> 2. `--redis-configuration` 在 PS 下两种写法都易踩：
>    - shorthand `aad-enabled=false`：az 会当成 JSON 解析报 `Failed to parse string as JSON / Expecting value: line 1 column 1 (char 0)`。
>    - JSON `"{\"aad-enabled\":\"false\"}"`：PS 的双引号转义经常被吞。
>    AAD 默认就是 disabled，**直接省略 `--redis-configuration`** 最稳，照样满足"Microsoft Entra Authentication: Disable"。
> 3. 用 `Start-Process` 后 ARM 入库需要 ~30s 才能在 `az redis list` 中看到，不要 spawn 后立刻查 0 就当失败。
> 4. **PS 5.1 数组拼接的优先级坑**：`@('a' + $Date, 'b' + $Date)` 不是两元素数组！会被解析成 `'a' + ($Date, 'b') + $Date` → 单元素字符串 `"a 0520 b 0520"`。必须给每个元素加括号：`@(("a$Date"),("b$Date"))` 或用 `"$prefix$Date"` 字符串插值。
> 5. **ssh 在 Windows PowerShell 下传 here-string 必然踩 CRLF**：PS here-string 默认 `\r\n` 行尾，ssh 直接传给远端 bash 时每行带 `\r`，导致 `set -u\r` 被当成 `set -` 报 `invalid option`、`2>/dev/null\r` 被当成 `/dev/null\r` 报 Permission denied。**修法**：把脚本写本地 `.sh` 文件并 `-replace "`r`n","`n"`，scp 到 VM 后 `ssh ... "bash xxx.sh"` 执行；不要直接 `ssh ... "$herestring"`。
> 6. **`Tee-Object -FilePath` 在 PS 5.1 默认写 UTF-16-LE BOM**，后续 `Select-String`、`Get-Content` 默认按 ASCII 读会乱码。要么 `Get-Content -Encoding Unicode`，要么改用 `... 2>&1 | Out-File -Encoding ascii`（Tee 不支持 -Encoding 参数）。

确认全部 cache 状态为 `Succeeded`：

```bash
az redis list -g machine2e_group --subscription 1e57c478-0901-4c02-8d35-49db234b78d2 \
  --query "[?ends_with(name,'-0507')].{name:name,state:provisioningState}" -o table
```

> 任何状态非 `Succeeded` 的 cache 必须从对应 VM 的 `Parameters.txt` 中删除（见 §6.1），否则该 VM 的整个测试队列会卡住。

> **等待 cache 创建完成**：本步骤新建 cache 后等待约 **30 分钟**，然后执行上面的状态查询命令；30 分钟到点后状态仍不是 `Succeeded` 的 cache 不再继续等，按 §6.1 从对应 VM 的 `Parameters.txt` 中删除该行，使后续测试跳过这个 cache。若本轮 cache 已在更早时间提前创建并就绪，则无需等待，直接进入 §4.2。

### 4.2 启动 8 台压测 VM

VM 默认是 `VM deallocated`，需先批量启动：

```powershell
$vms = 'BC0BC1','BC2BC3','BC4BC5BC6','P1P2','P3P4P5','SC0SC1','SC2SC3','SC4SC5SC6'
foreach ($v in $vms) {
  az vm start -g MemtierbenchmarkTest -n "MemtierbenchmarkTest-$v" `
    --subscription fc2f20f5-602a-4ebd-97e6-4fae3f1f6424 --no-wait | Out-Null
}
```

等 1–2 分钟后确认全部 `VM running`：

```powershell
az vm list -g MemtierbenchmarkTest -d --query "[].{n:name,p:powerState}" -o table
```

### 4.3 部署 / 更新 VM 上的执行脚本（仅首次或脚本改动后）

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

### 4.4 写入 Parameters.txt

```powershell
powershell -ExecutionPolicy Bypass -File scripts/update-parameters.ps1 -Date 0507
```

> **必须显式传 `-Date`**。自动推断只取第一个 `-(\d{4})` 匹配，旧日期 cache 会被错误命中。

### 4.5 启动测试（推荐：直接 SSH 每台 VM 跑 `clean-restart.sh`）

> ⚠ **不要再用 `scripts/restart-benchmarks.ps1`**——见 §6.7。改为把 `clean-restart.sh` scp 到每台 VM 然后 ssh 执行，每台单独验证 FIRST_LINE 含本轮日期。

`scripts/clean-restart.sh` 的 5 个阶段：

1. **kill**：依次 `sudo pkill -9 -f` runner → Run_Benchmark → memtier_benchmark（顺序见 §6.5）
2. **wait**：循环 `pgrep -f memtier_benchmark | wc -l` 直到 0（最多 30s）
3. **clean**：`rm -f run.log out.json out.tmp results-*-${DATE}.json output-${DATE}.txt`
4. **verify+abort**：剩余 memtier ≠ 0 直接退出（不冒进启动）
5. **start+verify**：`nohup ./Run_multiple_benchmarks_ssl.sh > run.log 2>&1 < /dev/null & disown`，sleep 3 后断言 `head -1 run.log` 包含本轮 `{MMDD}`

输出三行：`CLEANED ...`、`STARTED pid=... runner_pid=... date_in_head=1`、`FIRST_LINE: Running benchmark with name: Verifyperformance-...-{MMDD}...`。

部署 + 执行（PowerShell）：

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
  # 去 CRLF（Windows scp 上去的脚本可能带 \r），再执行
  ssh -i $key -o StrictHostKeyChecking=no "azureuser@$ip" `
    "tr -d '\r' < clean-restart.sh > t && mv t clean-restart.sh && chmod +x clean-restart.sh && ./clean-restart.sh $Date"
}
```

**强制验证**：每台 VM 的输出必须满足 `date_in_head=1` 且 `FIRST_LINE` 包含本轮日期。任一不满足就在该台 VM 上单独重跑，**不要**信任 "pid 已生成" 这种二手信号（§6.8）。

如需对单台 VM 手工启动（不走清洗）：

```bash
nohup ./Run_multiple_benchmarks_ssl.sh > run.log 2>&1 < /dev/null &
disown
echo "PID: $!"
sleep 3 && head -1 run.log   # 必须看到 Verifyperformance-...-{MMDD}
```

### 4.6 监控进度

> **实测耗时**（2026-05-20 全 19 cache 实跑）：
> - **Premium** 单 cache ~10–20 min（350–450 K RPS，10 轮 × ~1–2 min/轮）
> - **Standard / Basic** 单 cache ~**2 小时**（20–80 K RPS，10 轮 × **~13 min/轮**，因为 memtier `--threads 16 --clients 1 -n 1000000` 实际是 16 M 请求/轮）
> - 单 VM 总耗时 = cache 数 × 单 cache 耗时：BC4BC5BC6 / SC4SC5SC6 这类 3-cache Basic/Standard VM 要 **~6 小时**
> - 监控脚本的 timeout 至少要设 **6 h**，不要按 1 h 估
> - `R=expected` 不等于 done：results 文件在每个 cache **开始时**创建，必须 `m=0`（memtier 进程 0）才算结束

每 5–15 分钟轮询所有 VM，全部空闲时退出（`{IP_X}` 用 `az vm show` 现取）：

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

`m=` 数值的判读见 §6.4。也可在单台 VM 上用 `tail -f run.log` 跟进。

### 4.7 收集结果到本地

```powershell
powershell -ExecutionPolicy Bypass -File scripts/pull-results.ps1 -Date 0507
```

可选参数：`-OutDir`、`-KeyDir`（默认 `$env:USERPROFILE\.ssh`）。

### 4.8 生成统一对比报告

```powershell
python scripts/generate-unified-report.py --date 0507
```

| 参数 | 必选 | 默认 |
|---|---|---|
| `--date` | 是 | — |
| `--results-dir` | 否 | `<scripts>/results-<date>` |
| `--out` | 否 | `<scripts>/cache-comparison-<date>.html` |

报告输出格式见 §5。

### 4.9 测试结束收尾（必须执行）

报告产出后默认两个收尾动作：

1. 关闭本轮 8 台压测 VM 到 `VM deallocated`。
2. 删除本轮 cache（按日期后缀筛选）。

执行原则：

- 用户已明确手动完成 → 仅记录，不重复执行。
- 否则按默认流程执行并回报状态。

## 5. 统一报告规范（默认输出格式）

- 输出：`scripts/cache-comparison-{MMDD}.html`，单文件、可点击切换 tier。
- 必要元素：

| 元素 | 要求 |
|---|---|
| Tab 切换 | 三个按钮 `Premium / Standard / Basic`，默认 `Premium`，切换时仅显示对应 panel |
| 参数块 + 参数列 | 表格列含 `Clients`、`Threads`、`Requests`、`Size (bytes)`、`Pipeline`；Standard 特殊：C0/C1 `Clients=16`，C2-C6 `Clients=32` |
| 全量 cache 行 | Premium `P1-P5`、Standard/Basic `C0-C6` 全部展示，不能只列已完成项 |
| 状态列 | `完成(10/10)` / `未完成(n/10)` / `跳过/缺失`；非完成项性能列填 `-` |
| 性能指标 | `Gets RPS`、`p50/p99/p99.9/p99.99 (ms)`；仅在完成项中比较；RPS 取最大、延迟取最小高亮，可选 `BEST RPS` 标签 |
| 图表（Chart.js） | 每个 tier 至少 4 张图：RPS 对比、延迟对比、各 cache 10 次 RPS 波动、各 cache 10 次 p99 波动 |
| 统计口径 | 10 次结果按 `Gets RPS` 排序取第 6 名（1-based）作为中位；说明文字写明“仅完成 10 次项参与中位统计” |

## 6. 陷阱与排错

### 6.1 Parameters.txt 末行 / 换行 / 跳过 cache

文件末尾必须**且仅**保留一个 `\n`：

- 缺失换行 → bash `while read` 漏掉最后一行（最后一个 cache 不测）。
- 多余换行 → 读入空 host/key，`Run_Benchmark_ssl.sh` SSL 报错。

PowerShell 管道 `... | ssh ... "cat > Parameters.txt"` 会附加 `\r\n`，必须改用 `WriteAllText` + `scp`（`update-parameters.ps1` 已采用）。

`Run_multiple_benchmarks_ssl.sh` 已加固：

- `while IFS= read -r line || [[ -n "$line" ]]` 兼容末行无换行。
- `line="${line%$'\r'}"` 去掉 CRLF 中的 `\r`。

跳过状态非 `Succeeded` 的 cache：

```bash
ssh -i "<key.pem>" azureuser@<IP> \
  "grep -v '<cache名片段>' ~/Parameters.txt > ~/Parameters.tmp && mv ~/Parameters.tmp ~/Parameters.txt"
```

### 6.2 PowerShell 找不到 az / ssh

```powershell
$env:PATH += ";C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin"
```

PowerShell 5 没有内建 `pwsh`；运行脚本统一用 `powershell -ExecutionPolicy Bypass -File <ps1>`。

### 6.3 PowerShell 中执行 SSH 命令的转义

```powershell
# ✅ 单引号包裹 remote command，bash 变量不被 PS 展开
ssh -i "key.pem" azureuser@IP 'ls results-P*.json && pgrep -f memtier_benchmark | wc -l'

# ❌ 双引号中 $f 被 PS 展开为空
ssh -i "key.pem" azureuser@IP "echo $f"
```

复杂远程命令一律写成本地脚本 → `scp` → `ssh ... 'bash /tmp/script.sh'`，避免转义地狱（参考 `scripts/kill-and-clean.sh`）。

### 6.4 `pkill` / `pgrep` 静默失败和自匹配

`memtier_benchmark` 进程名 17 字符 > Linux `/proc/PID/comm` 的 15 字符上限，按 comm 匹配会**失败但不报错**。一律加 `-f`：

| ❌ 错 | ✅ 对 |
|---|---|
| `pkill memtier_benchmark` | `pkill -f memtier_benchmark` |
| `pgrep memtier_benchmark \| wc -l` | `pgrep -f memtier_benchmark \| wc -l` |
| `pidof memtier_benchmark` | `pgrep -f memtier_benchmark` |

`pgrep -f memtier_benchmark | wc -l` 会**自匹配**外层 `bash -c` 和 `$(...)` 子进程：

| 来源 | 是否匹配 |
|---|---|
| 真正的 `memtier_benchmark` 进程（1 个，串行 10 次循环） | ✅ |
| 外层 `bash -c "echo m=..."`（cmdline 含字面量） | ✅ |
| `$(...)` 中的 `pgrep`/`wc` 临时子进程 | ✅（瞬时） |

判读：`m=2` 或 `m=3` 表示运行中；`m=0` 表示已结束。

> **2026-05-20 watcher 误判**：在 PowerShell 里写 `ssh ... "m=$(pgrep -f memtier_benchmark | wc -l)..."` 时，**这个 ssh 远端的 `bash -c` 自身 cmdline 含字面量 `memtier_benchmark`**，再加上 `pgrep -f memtier_benchmark` 自身也被自匹配，所以 baseline `m=2`（哪怕真实进程数=0）。后果：watcher 永远等不到 `m=0`，5 台 VM 实际已完成却仍被报为 RUNNING。**修法**：远端命令改用 `ps -eo comm | grep -c memtier_benc`（按 `comm` 字段 = 进程名前 15 字符，不会自匹配 cmdline），baseline 真正归零。完整可靠 done 判定：`m_real=0` AND `runner_real=0`（其中 `runner_real = pgrep -f Run_multiple | wc -l - 2`，2 是 ssh+grep 自匹配 baseline）。

### 6.5 kill 顺序：先 runner 再 memtier

`Run_multiple_benchmarks_ssl.sh` 是 memtier 的父进程，循环 `for i in 1..10; do memtier_benchmark ...`。先 kill memtier 不 kill runner 会立刻 fork 出新 memtier。正确顺序（`scripts/kill-and-clean.sh` 已实现）：

1. `pkill -9 -f Run_multiple_benchmarks_ssl.sh`
2. `pkill -9 -f Run_Benchmark_ssl.sh`
3. `pkill -9 -f memtier_benchmark`
4. 循环复检 `pgrep -f memtier_benchmark` 直到为 0

### 6.6 单点超时 / 失败处理

- 单 cache > 1h 未完成：`ssh ... 'sudo pkill -9 -f memtier_benchmark'` 手动跳过。
- 进程意外退出但结果不全：`ssh ... './Run_Benchmark_ssl.sh <host> <key>'` 重跑该 cache。
- 整体重跑：按 §4.5 把 `clean-restart.sh` scp+ssh 到 8 台 VM；**不要**用 `restart-benchmarks.ps1`。

> **2026-05-20 实测 jq 解析爆炸导致 runner 提前死**：SC2SC3 第二个 cache（C3）跑到一半，`run.log` 出现：
> ```
> jq: error (at out.json:21601): object ({"configura...) and array ([null]) cannot be added
> ./Run_Benchmark_ssl.sh: line 48: [: -lt: unary operator expected
> ```
> 原因：某一轮 memtier 写出的 `out.json` 出现 object + array 不可合并的形态，`Run_Benchmark_ssl.sh` 用 jq 合并 / 取条数时拿到空字符串，line 48 的 `[ $count -lt 10 ]` 整数比较因空字符串失败 → 整脚本 `set -u`/隐式退出，**`results-C3-0520.json` 留下 0 字节空文件**。判定方法：probe 时不仅看 `jq length`，还要看 `ls -la` 的字节数；0 字节即失败。补救：`rm` 空文件 → Parameters.txt 只留这一行 → 重新 `./Run_multiple_benchmarks_ssl.sh`。

### 6.7 `restart-benchmarks.ps1` 的已知 bug（0513 实测）

0513 这轮整轮空跑就是被它坑的：

- Phase 1 用 `sudo pkill -9 memtier_benchmark`（缺 `-f`）+ `pidof memtier_benchmark` 检查——`memtier_benchmark` 进程名 17 字符超过 comm 上限 15，匹配静默失败。
- Phase 2 verify 因此始终输出 `memtier_left=0 results_left=0`，掩盖了真正没杀掉的旧进程。
- Phase 3 `nohup` 启动新 runner 后没有断言 `head -1 run.log` 含本轮日期，只看 pid 是否非空就报 "started"。结果：旧 runner 还在跑旧日期的 cache，新 runner 没真正启动（或被旧 runner 占用 cache 立刻退出），8 台 VM 全部沉默几小时。

修复前请直接用 §4.5 的 `clean-restart.sh` 路径。

### 6.8 不要相信 "pid 已生成" 这种间接信号

判断一次 restart 是否真的成功，**唯一可信**信号：

```bash
head -1 run.log    # 必须包含本轮 {MMDD} 的 cache 域名
```

以下都**不**作为成功证据：

- `nohup ./script &; echo $!` 打印的 pid——脚本可能 0.1s 后立刻 exit。
- `pgrep -f Run_multiple_benchmarks_ssl.sh | wc -l ≥ 1`——会自匹配 ssh 远端 `bash -c` 的 cmdline（§6.4）。
- `ls results-*.json` 有文件——可能是上一轮残留。

排查空跑时第一动作：直接 `ssh ... 'head -1 run.log; ls -lt results-*.json | head -5; ps -eo pid,etime,cmd | grep -v grep | grep -E "memtier|Run_"'`。

### 6.9 Subagent 不可信于运维确认

0513 那轮多次出现 subagent 编造 IP（如 `20.245.x.x`）、编造 2024 时间戳，谎报 "已成功启动"。涉及 "是否真的在跑" 的判定一律走 `run_in_terminal` 直接 ssh，把输出落到本地文件再 `read_file`，**不要**让 subagent 转述结果。

## 7. 参考命令（按需查阅）

### 7.1 列出资源组中所有 VM

```bash
az vm list -g MemtierbenchmarkTest --subscription fc2f20f5-602a-4ebd-97e6-4fae3f1f6424 -o table
```

### 7.2 取单台 VM 的公网 IP / 状态

```bash
az vm show -g MemtierbenchmarkTest -n <VM名称> \
  --subscription fc2f20f5-602a-4ebd-97e6-4fae3f1f6424 --show-details \
  --query "{publicIps:publicIps, powerState:powerState}" -o table
```

### 7.3 SSH 连接

```bash
ssh -i "$env:USERPROFILE/.ssh/<VM名称>_key.pem" azureuser@<公网IP>
```

首次会提示 host key 验证，输入 `yes` 或加 `-o StrictHostKeyChecking=no`。

### 7.4 取单个 cache 的 primary key

```bash
az redis list-keys -g machine2e_group -n <cache名称> \
  --subscription 1e57c478-0901-4c02-8d35-49db234b78d2 \
  --query "primaryKey" -o tsv
```

### 7.5 VM 上分析单 cache 的 10 次结果

```bash
# 全部 10 次
jq '[.[] | {
  rps:    .["ALL STATS"].Gets["Ops/sec"],
  p50:    .["ALL STATS"].Gets["Percentile Latencies"]["p50.00"],
  p99:    .["ALL STATS"].Gets["Percentile Latencies"]["p99.00"],
  p999:   .["ALL STATS"].Gets["Percentile Latencies"]["p99.90"],
  p9999:  .["ALL STATS"].Gets["Percentile Latencies"]["p99.99"]
}] | sort_by(.rps)' results-P1-0507.json

# 中位（按 RPS 第 6 名）
jq '[.[] | {rps:.["ALL STATS"].Gets["Ops/sec"]}] | sort_by(.rps) | .[5]' results-P1-0507.json
```

### 7.6 测试输出文件约定

| 文件 | 内容 |
|---|---|
| `results-{KEY}-{MMDD}.json` | 单 cache 的 10 次完整原始结果 |
| `output-{MMDD}.txt` | 所有 cache 的中位数结果汇总 |

## 8. 附录：陷阱速查表

下表为 §6 的索引；详细成因与修法见对应小节。

| # | 场景 | 关键修法 | 已固化于 |
|---|---|---|---|
| P-1 | PowerShell 5.1 找不到 `az` | `$env:PATH += ";C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin"` | `Assert-BenchEnv.ps1` 预检（§6.2） |
| P-2 | PS 数组拼接 `@('a'+$D,'b'+$D)` 退化 | 每元素加括号或用 `"$prefix$D"` 插值 | `New-RedisCaches.ps1` / `Update-Parameters.ps1`（§4.1 坑 4） |
| P-3 | here-string 经 ssh 远端报 `set -u\r: invalid option` | 写本地 `.sh`、`-replace "`r`n","`n"`，scp 后执行 | `Invoke-CacheRetry.ps1`（§4.1 坑 5 / §6.3） |
| P-4 | `Tee-Object` 默认 UTF-16 BOM | 改 `Out-File -Encoding ascii` | `Start-BenchVMs.ps1`（§4.1 坑 6） |
| P-5 | `Parameters.txt` PS 管道写远端带 CRLF | `[IO.File]::WriteAllText` + `scp` | `Update-Parameters.ps1`（§6.1） |
| P-6 | `pkill memtier_benchmark` 静默失败（进程名 17 > comm 上限 15） | 必须 `pkill -f memtier_benchmark` | `clean-restart.sh`（§6.4 / §6.5） |
| P-7 | `pgrep -f memtier_benchmark` 自匹配 ssh cmdline，永远 `m≥2` | 改 `ps -eo comm \| grep -c memtier_benc` | `Watch-Bench.ps1` / `clean-restart.sh`（§6.4） |
| P-8 | 假成功（只看 pid 不看 `head -1 run.log`） | 强制断言首行含本轮日期 | `clean-restart.sh` + `Restart-AllBench.ps1`（§6.8） |
| P-9 | `results-*.json` 0 字节 | `rm` 空文件 → 单行 `Parameters.txt` 单独重跑 | `Invoke-CacheRetry.ps1` + `Pull-Results.ps1 -VerifyOnly`（§6.6） |
| P-10 | 监控 timeout 按 1 h 估，6 h 跑被误判 | timeout 统一 6 h | `Watch-Bench.ps1` 默认 `-MaxHours 6`（§4.6） |
| P-11 | Subagent 编造 IP / 时间戳 | 运维确认走脚本直读 stdout，不依赖转述 | 全部脚本均直输 stdout（§6.9） |
