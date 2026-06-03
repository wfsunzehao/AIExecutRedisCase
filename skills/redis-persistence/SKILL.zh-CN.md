---
name: redis-persistence
description: Azure Cache for Redis Premium 持久化（AOF + RDB）端到端 Portal-UI 自动化流程。创建 Premium P1 cache（Public Endpoint、启用 Access Keys、关闭 Microsoft Entra）+ Standard LRS storage account；启用 Non-SSL 6379；启用 AOF 持久化、用 redis-benchmark 写数据、验证 AOF blob 落地；再切到 RDB 15-min interval 并验证 RDB blob。覆盖 Test_Case/Premium cache.csv 的 Step 5（AOF）与 Step 6（RDB）。
allowed-tools: Bash(az:*) Bash(pwsh:*) Bash(playwright-cli:*)
---

# Redis 持久化（AOF + RDB）（中文版）

> 这是 [SKILL.md](SKILL.md) 的中文翻译版本。两份文档内容保持同步；以英文版为权威。

通过 **Azure Portal UI** 端到端演练 Premium tier 的 AOF 与 RDB 持久化测试，ARM 侧 ground-truth 校验贯穿全程。

阶段：

1. **Phase 0** — 环境基线（az / playwright-cli / redis-cli / redis-benchmark / CDP Edge）。
2. **Phase 1** — ARM PUT 创建 2 个 Premium P1 cache + 1 个 Standard LRS storage account。
3. **Phase 2** — 在 Advanced settings 上启用 Non-SSL 6379（Portal UI）。
4. **Phase 3** — 启用 AOF 持久化，绑定 storage account（Portal UI）。
5. **Phase 4** — 用 `redis-benchmark` 写入数据。
6. **Phase 5** — Portal UI + ARM 双重验证 AOF blob 落地。
7. **Phase 6** — 切到 RDB 15-min interval（Portal UI）。
8. **Phase 7** — Portal UI + ARM 双重验证 RDB blob 落地。
9. **Phase 8** — Teardown。

完整执行步骤、Validation 与 Failure mode 请参考 [SKILL-SOP.md](SKILL-SOP.md)。

## 关联测试用例

- [Test_Case/Premium cache.csv](../../../Test_Case/Premium%20cache.csv) — Step 5（AOF）与 Step 6（RDB）。

## 默认资源布局

| 资源 | 名称 | Region |
|---|---|---|
| Cache 1 | `ManualTest-9484-CUSE-<MMDD>` | `centraluseuap` |
| Cache 2 | `ManualTest-9484-EUS2E-<MMDD>` | `eastus2euap` |
| Storage Account | `manualtest9484sa<MMDD>` | `centraluseuap` |

历史 subscription `1e57c478-0901-4c02-8d35-49db234b78d2`，resource group `test_song`，tenant `microsoft.onmicrosoft.com`。`<MMDD>` 为运行日期。

Cache 配置（依测试用例）：Public Endpoint、启用 Access Keys 认证、关闭 Microsoft Entra 认证、P1 Premium、`aad-enabled=false`、`publicNetworkAccess=Enabled`、`disableAccessKeyAuthentication=false`。

## 起跑准备

1. `az account show` — 确认 tenant + subscription；用 `az account set --subscription <id>` 切换。
2. `az group show -n <rg>` — 确认 RG 存在。
3. Cache PUT **必须用 API 版本 `2024-03-01`**（`disableAccessKeyAuthentication` 字段在旧版本会被拒绝 400）。本 skill 的所有脚本已硬编码。
4. `redis-cli.exe` 与 `redis-benchmark.exe` 放在 `D:\Claude-Redis\tools\redis\`（自带的 3.2.100 不支持 `--no-auth-warning`，脚本统一抑制 stderr）。
5. Windows PowerShell 5.1 非交互式下 `az` 可能无法解析，全脚本统一用绝对路径 `C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd`。
6. Portal UI 自动化：独立 user-data-dir 启动 CDP Edge（**不要**复用默认 profile）：

   ```powershell
   & "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
     --remote-debugging-port=9222 `
     --user-data-dir="$env:USERPROFILE\edge-cdp-profile"
   ```

   首次启动后在该窗口登录 Azure portal，然后 attach：

   ```bash
   playwright-cli attach --cdp=http://127.0.0.1:9222
   ```

   必须字面 `127.0.0.1`——`localhost` 会被解析到 `::1`，CDP 只在 IPv4 上监听。

---

详细 phase-by-phase Runbook 见 [SKILL-SOP.md](SKILL-SOP.md)。英文版见 [SKILL.md](SKILL.md)。
