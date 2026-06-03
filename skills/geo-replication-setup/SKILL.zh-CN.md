---
name: geo-replication-setup
description: |
  Azure Cache for Redis 异地复制（Geo-Replication）的可复用 Capability 库。
  本文件包含 7 个原子、可组合的 capability（prereq / link / failover /
  reboot-failover / unlink / dns-verify / teardown）。缓存**创建**不在本库
  范围内，应使用 `cache-creation` skill
  （[skills/cache-creation/](../cache-creation/SKILL.md)）先创建好 Premium 、
  非 AAD 的缓存；本库所有 helper 均假设缓存已处于 `Succeeded` 状态。
  测试用例**组合**这些 capability，不应内嵌 Geo 工作流步骤。实现位于
  `create-geo.js`；本文件是 capability 契约（输入、前置/后置条件、踩坑）
  的唯一权威说明。
applyTo: "**"
---

# Geo-Replication Capability 库

> **本文件是什么：** 一份包含 8 个原子 Geo capability 的库。下面每一节都是
> 一个自洽的 capability，独立声明其输入、helper API、前置条件、后置条件 / 验证、
> 以及踩坑。
>
> **本文件不是什么：** 一份端到端测试流程。具体测试用例（ADO 16021226、
> 16021140、16021106、15320703 …）应放在自己的测试 SKILL 中，**引用**下面列出的
> capability，而不是重新实现这些步骤。

---

## Capability 目录

| # | Capability | 锚点 | 对应 [create-geo.js](create-geo.js) helper |
|---|---|---|---|
| 1 | 前置检查 (Prereq) | [#capability-1-geo-prereq](#capability-1-geo-prereq) | `assertGeoEnv` |
| 3 | 建立链接 (Link) | [#capability-3-geo-link](#capability-3-geo-link) | `invokeGeoLinkUI`、`invokeGeoLinkArm`、`waitGeoLink`、`assertGeoPair` |
| 4 | 切换主备 (Failover) | [#capability-4-geo-failover](#capability-4-geo-failover) | `invokeGeoFailover`、`assertGeoRoleFlip`、`testGeoActivityLog` |
| 5 | 重启后切换 (Reboot-then-failover) | [#capability-5-geo-reboot-failover](#capability-5-geo-reboot-failover) | `invokeRebootThenFailover`、`assertConcurrentNotifications` |
| 6 | 解除链接 (Unlink) | [#capability-6-geo-unlink](#capability-6-geo-unlink) | `invokeGeoUnlink`、`assertGeoUnlinked` |
| 7 | DNS 校验 (DNS verify) | [#capability-7-geo-dns-verify](#capability-7-geo-dns-verify) | `testGeoDns` |
| 8 | 资源清理 (Teardown) | [#capability-8-geo-teardown](#capability-8-geo-teardown) | `invokeGeoTeardown` |

> 编号 2 (Provision) 故意留空。缓存创建现在由 [`cache-creation`](../cache-creation/SKILL.md)
> skill 负责；保留原有锚点编号是为了不破坏下游测试 SKILL 里的引用。

每个 capability 都是**原子**的：只推进一项 Geo 状态、返回一个可验证的信号、
不假设下一步是哪个 capability。

---

## 共享约定

下面 7 个 capability 都遵循本节约定。Capability 节中只引用此节，不重复展开。

### 执行模型

- **实现位于 [create-geo.js](create-geo.js)。** Capability 节是文档；Node 模块是可执行契约。
- **调用模式（PowerShell here-string + `node -e`）：**

  ```powershell
  $js = @'
  const geo = require("d:/junru/skills/geo-replication-setup/create-geo.js");
  const { chromium } = require("playwright");
  (async () => {
    // 仅 ARM 的 capability（Prereq、Teardown，以及 Link/Unlink 的部分场景）：
    await geo.assertGeoEnv({ subscription, resourceGroup });

    // 走 UI 的 capability —— 通过 CDP 连接到 Edge，永远不要关闭它：
    const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
    const ctx = browser.contexts()[0];
    const page = ctx.pages().find(p => new URL(p.url()).hostname === "ms.portal.azure.com")
              || await ctx.newPage();
    await geo.invokeGeoLinkUI({ page, primary, secondary, subscription, resourceGroup });
  })().catch(e => { console.error(e.message); process.exit(1); });
  '@
  node -e $js
  ```

- **禁止**为某个 capability 临时创建 `.js` 文件（`%TEMP%` 或工作区均不可）。统一用 `$js = @'…'@; node -e $js` here-string 模式。
- **禁止**在 `connectOverCDP` 之后调用 `browser.disconnect()` 或 `browser.close()` —— 那会把真实 Edge 一起杀掉。直接让 Node 进程退出即可。

### CDP Edge

- 端点：`http://127.0.0.1:9222`（**必须使用字面量 IPv4** —— Windows 上 `localhost` 解析到 `::1`，而 CDP 只监听 IPv4）。
- User-data 目录：`%USERPROFILE%\edge-cdp-profile`（专用目录；若复用默认 profile 且已有 Edge 实例在跑，`--remote-debugging-port` 会被静默忽略）。
- 在该 profile 里登录一次 `https://ms.portal.azure.com`，后续运行直接复用。

### 长耗时命令

会等待的 capability（Link、Failover、Unlink）通常需要 10–30 分钟。
使用 `run_in_terminal` 的 `mode=sync` 并配合较大的 `timeout`
（Link/Failover ≥ 1,200,000 ms），依赖 VS Code 的退出通知。
**不要**用 `mode=async`；**不要**用 `Start-Sleep` 之类的轮询循环包装。

### 命名

- 推荐的缓存名模式（与旧有测试运行及 DNS helper 保持一致）：
  `ManualTestingGeo-<region-short>-<MMDD>`。`<MMDD>` 是运行日期，避免并发跑相互冲突。
- Portal-UI helper 区域选择器使用的简写映射：
  `EUS2E` → `East US 2 EUAP`、`SEA` → `Southeast Asia`、
  `CUSE` → `Central US EUAP`、`WCUS` → `West Central US`。
- 所有具体缓存名都由调用方提供 —— 本库每个 helper 都要求显式传入缓存名，
  不再从日期后缀推导任何缓存名。

### 硬性要求（不可覆盖）

| 约束 | 原因 |
|---|---|
| SKU = `Premium` | Basic/Standard 不支持 geo-link。 |
| `aad-enabled = false` | AAD-only 缓存无法参与 geo-replication。 |
| `enableNonSslPort = false`、`minimumTlsVersion = 1.2` | 本库所针对的所有测试用例都要求这两个设置；请在 cache-creation 流程里设好（仅在测试用例明确要求时才覆盖）。 |

### ARM / API 版本

- Cache PUT：`2023-05-01-preview`
- `linkedServers`：`2022-06-01`

### 读语义（最常见的错误）

`linkedServers` 条目里的 **`serverRole` 描述的是 PEER（对端）**，不是被查询的缓存。
也就是说 `GET /Redis/<X>/linkedServers` 返回 `serverRole = Primary` 表示 **X 本身是 Secondary**。
`assertGeoPair` 和 `assertGeoRoleFlip` 已经强制按这个语义判断，调用方要原样向上传播失败，不要自己反推。

### 结果记录

结果记录**不是**本库的职责。调用方测试 SKILL 负责写 `result.txt`（或其他报表）。
Capability 只往 stdout 打 `Phase N PASS / FAIL` 风格的日志；测试 SKILL 负责汇总和持久化。

---

## Capability 1: geo-prereq

**用途** —— 任何 Geo capability 跑之前的快速失败网关。校验环境依赖，下游
capability 都假设这些已经满足。

**何时使用**

- **始终**作为任何 Geo 组合的第一步。
- 聊天重置 / 重启 / VM 重启之后 —— CDP Edge 端口和 Azure CLI 登录是两个最常见的静默回归。

**何时不要用**

- 在内层循环里（这是一次性闸门，不是看门狗）。
- 用来诊断某个特定 Portal flake —— 用 Playwright 自身的 page 状态更合适。

**输入** —— `assertGeoEnv({ subscription, resourceGroup, cdpPort })`

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `subscription` | string (GUID) | 是 | — | 目标订阅 ID。 |
| `resourceGroup` | string | 是 | — | 必须已存在；本 capability 不创建 RG。 |
| `cdpPort` | number | 否 | `9222` | `chromium.connectOverCDP` 的 TCP 端口，需和 Edge 启动参数一致。 |

**Helper 调用**

```powershell
$js = @'
const geo = require("d:/junru/skills/geo-replication-setup/create-geo.js");
(async () => {
  await geo.assertGeoEnv({ subscription: "<sub>", resourceGroup: "<rg>" });
})().catch(e => { console.error(e.message); process.exit(1); });
'@
node -e $js
```

**前置条件**

- Azure CLI 已安装且已登录（`az account show` 正常返回）。
- Edge 用 `--remote-debugging-port=9222 --user-data-dir=%USERPROFILE%\edge-cdp-profile` 启动，并已登录 `https://ms.portal.azure.com`。
- `playwright` 可被 Node `require` 解析。

**后置条件 / 验证**

- 全部通过时返回 `true` 且退出码 0：`az --version`、`require.resolve("playwright")`、`az account set`、`az group show`、2 秒内 TCP 连上 `127.0.0.1:<cdpPort>`。
- 任一失败抛出 `Error("Phase 0 FAIL: <逗号分隔列表>")`。Stdout 每项打一行 `[OK]` / `[FAIL]`，用于排错。

**踩坑**

- **CDP 端口静默失败**：Edge 在错误的 user-data dir 启动，`--remote-debugging-port` 被忽略。用 `netstat -ano | findstr :9222` 确认有且仅有一行 LISTENING。
- **`localhost` ↔ `127.0.0.1`**：不要改成 `localhost` —— Windows 上解析到 `::1`，CDP 只监听 IPv4。
- **CLI 登录到了错的租户**：`az account set` 可能用一个旧的 device-code token 静默成功。组合前先跑一次 `az account show -o jsonc` 确认。

---

<!-- Capability 2 (geo-provision) 已删除。
     缓存创建请使用 cache-creation skill（../cache-creation/SKILL.md）。 -->

## Capability 3: geo-link

**用途** —— 把一对缓存从"两个无关缓存"变成"`Primary` ↔ `Secondary` 链接对"。
分三步：

1. **发起** —— 默认走 Portal UI（`invokeGeoLinkUI`）；UI 不可用或不稳定时回退到 ARM（`invokeGeoLinkArm`）。
2. **收敛** —— `waitGeoLink` 轮询每个缓存的 `GET .../linkedServers`，直到所有条目都 `provisioningState = Succeeded`。
3. **校验** —— `assertGeoPair` 强制每边 1 个条目且 peer `serverRole` 正确。

**何时使用**

- 缓存创建之后（由 cache-creation skill 负责），任何 failover / unlink / DNS 测试之前。
- 多轮 link/unlink 测试中前一轮 Unlink 之后的重新建链。

**何时不要用**

- 反向已有链接 —— 用 Failover。
- 三方 / 网状拓扑（不在本库范围）。

**输入**

`invokeGeoLinkUI({ page, primary, secondary, subscription, resourceGroup, tenant?, screenshotPrefix? })`

| 字段 | 必填 | 说明 |
|---|---|---|
| `page` | 是 | 已通过 CDP 连接到 Edge 且停在 `ms.portal.azure.com` 的 Playwright `Page`。 |
| `primary` | 是 | 发起方缓存（成为 Primary）。 |
| `secondary` | 是 | 对端缓存（成为 Secondary）。 |
| `subscription`、`resourceGroup` | 是 | — |
| `tenant` | 否 | 默认 `microsoft.onmicrosoft.com`。 |
| `screenshotPrefix` | 否 | 用于 `*-submit.png`、`*-copied.png`。 |

`invokeGeoLinkArm({ primary, secondary, secondaryLocation, subscription, resourceGroup })` —— `secondaryLocation` 是 ARM 形式的 location（如 `southeastasia`）。首次 `PUT` 400 时会自动反转 primary/secondary 重试。

`waitGeoLink({ caches, subscription, resourceGroup, maxMinutes?, pollSec?, expectEmpty? })` —— 建链时：传本次运行涉及的全部缓存，保持 `expectEmpty = false`（默认），`maxMinutes = 60` 通常够用。

`assertGeoPair({ primary, secondary, subscription, resourceGroup })` —— 返回 `true` 或抛错。**`linkedServers` 条目上的 `serverRole` 描述的是 PEER。**

**Helper 调用**

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

  try {
    await geo.invokeGeoLinkUI({ page, primary, secondary, subscription: sub, resourceGroup: rg });
  } catch (e) {
    console.log("UI link 失败，回退 ARM：", e.message);
    await geo.invokeGeoLinkArm({ primary, secondary, secondaryLocation: "southeastasia", subscription: sub, resourceGroup: rg });
  }
  await geo.waitGeoLink({ caches: [primary, secondary], subscription: sub, resourceGroup: rg });
  await geo.assertGeoPair({ primary, secondary, subscription: sub, resourceGroup: rg });
})().catch(e => { console.error(e.message); process.exit(1); });
'@
node -e $js
```

**前置条件**

- 两侧缓存都是 `Premium` 且 `aad-enabled = false`（用 `az redis show` 确认）。
- Prereq 已确认 CDP Edge 端口（走 UI 时）。
- 该对**当前未建链**（UI 上显示的是 "Add cache replication link" 而非 "Unlink"）—— 在已有链接上重复建链行为未定义。

**后置条件 / 验证**

- 两个缓存各暴露 1 个 `linkedServers` 条目，`provisioningState = Succeeded`。
- 在 primary 上 peer `serverRole = Secondary`；在 secondary 上 peer `serverRole = Primary`。
- 走 UI 时会在工作目录产出 `*-submit.png`、`*-copied.png` 证据。

**踩坑**

- **"Add cache replication link" 是 command-bar 项，不是 menuitem。** 用 text 点，不要 `getByRole("menuitem", …)`。
- **点 secondary 行之前必须先点左侧区域过滤。** 否则右侧表格会同时呈现多区域，`getByRole("gridcell", { name })` 会跟 Notifications 撞 strict-mode。
- **Picker 里的行是 `gridcell`，不是普通文本。** `getByText(secondary)` 会跟 Notifications 飞出层冲突。
- **`Link` 按钮必须用 `exact: true`。** 整个 blade 上有多个含 "Link" 的控件。
- **Copy-to-clipboard 的 tooltip 是 link 字符串的唯一可靠证据** —— 在 Playwright 里通过 `navigator.clipboard.readText()` 取值会因 Edge 焦点规则而不可靠。
- **`serverRole` 描述对端。** 在 `<primary>` 上查到 `serverRole = Secondary` 是对的（对端就是 Secondary）。
- **ARM 回退可能需要反转 pair** —— `invokeGeoLinkArm` 已经在 400 时自动反转重试。

---

## Capability 4: geo-failover

**用途** —— 在已建链的 Geo-Primary 上从 Portal UI 发起一次干净的 failover；
通过 ARM 校验角色翻转；并验证 Activity Log 中 `Add Redis Cache Linked Server / Succeeded`
事件落在新 primary 的 `/linkedservers/` 资源上（ADO 16021226 第 9 步）。

**何时使用**

- 标准的 "点 Failover → 确认" Portal 流程。
- 在 feature 操作（Import、Scale Up …）之后验证 failover 仍可正常进行。

**何时不要用**

- Reboot-then-failover 场景 —— 用 Reboot-then-failover capability。
- 反复 flap 角色的压力循环（不在本库范围）。

**输入**

`invokeGeoFailover({ page, cache, subscription, resourceGroup, tenant?, screenshotPrefix? })`

| 字段 | 必填 | 说明 |
|---|---|---|
| `page` | 是 | CDP Edge 上的 Playwright `Page`。 |
| `cache` | 是 | **当前** Geo-Primary —— failover 是从这块 blade 发起的。 |
| `subscription`、`resourceGroup` | 是 | — |
| `screenshotPrefix` | 否 | 用于 `*-submit.png`。 |

`assertGeoRoleFlip({ oldPrimary, oldSecondary, subscription, resourceGroup })` —— failover 后：`oldPrimary` 的 peer `serverRole = Primary`（对端已是 primary → 自身变 Geo-Secondary）；`oldSecondary` 的 peer `serverRole = Secondary`。

`testGeoActivityLog({ newPrimary, resourceGroup, subscription?, offsetMin? })` —— 默认 `offsetMin = 30`；查不到匹配条目时抛错。

**Helper 调用**

```powershell
$js = @'
const geo = require("d:/junru/skills/geo-replication-setup/create-geo.js");
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => new URL(p.url()).hostname === "ms.portal.azure.com")
            || await ctx.newPage();

  const oldPrimary   = "ManualTestingGeo-EUS2E-1118";   // 当前 Primary
  const oldSecondary = "ManualTestingGeo-SEA-1118";     // 当前 Secondary
  const sub = "<sub>", rg = "<rg>";

  await geo.invokeGeoFailover({ page, cache: oldPrimary, subscription: sub, resourceGroup: rg });
  await new Promise(r => setTimeout(r, 120_000));   // 等待控制面收敛
  await geo.assertGeoRoleFlip({ oldPrimary, oldSecondary, subscription: sub, resourceGroup: rg });
  await geo.testGeoActivityLog({ newPrimary: oldSecondary, resourceGroup: rg, subscription: sub });
})().catch(e => { console.error(e.message); process.exit(1); });
'@
node -e $js
```

**前置条件**

- Link（或 `assertGeoPair`）已确认链接对。
- 调用方知道**当前哪边是 Primary** —— failover 从 Primary blade 发起。

**后置条件 / 验证**

- `assertGeoRoleFlip` PASS → ARM 控制面报告角色翻转，两边都 `Succeeded`。
- `testGeoActivityLog` PASS → 在 offset 窗口内，新 primary 的资源 ID 下至少有 1 条 `linkedservers` + `Succeeded` 的记录。

**踩坑**

- **Notifications 飞出层打开时会拦截点击。** Helper 第一步就 `closeNotificationsFlyout`；不要跳过。
- **"Failover" 在 blade 上出现两次** —— command-bar 按钮 + footer best-practices 链接。必须用 `getByRole("button", { name: "Failover", exact: true })`。
- **确认弹窗是 Yes/No，不是 OK/Cancel。** Reboot 用 OK/Cancel；failover 用 Yes/No。
- **以 blade 状态为准，不要看点击的退出码。** 弹窗成功关闭后，Yes 按钮的点击可能依然返回 `strict-mode violation` 或 `target closed`；helper 已经用 `tolerate: true` 包住。
- **`serverRole` 描述对端。** failover 后在 old primary 上 `GET .../linkedServers` 读到 `serverRole = Primary`，意味着对端（old secondary）变成了 primary，即 old primary 自身是 Geo-Secondary。
- **Activity Log 延迟** 30–90 秒。至少等 60 秒再查 —— 太早查会返回 0 条。

---

## Capability 5: geo-reboot-failover

**用途** —— ADO 16021140：制造"在 Primary 上提交 Reboot，并在 ≤ 2 秒内于
Secondary 上提交 Failover"的并发场景。截图保留 Notifications 飞出层中两个操作
同时在飞的证据。

**何时使用** —— 专门用于 ADO 16021140 以及类似的"并发 reboot + failover"变种。

**何时不要用**

- 干净的 failover —— 用 Failover capability。
- 单独测试 reboot（不在本库范围）。

**输入**

`invokeRebootThenFailover({ page, primary, secondary, subscription, resourceGroup, tenant? })`

| 字段 | 必填 | 说明 |
|---|---|---|
| `page` | 是 | CDP Edge 上的 Playwright `Page`。 |
| `primary` | 是 | 当前 Geo-Primary —— 接收 reboot。 |
| `secondary` | 是 | 当前 Geo-Secondary —— 接收 failover。 |
| `subscription`、`resourceGroup` | 是 | — |

返回 `{ rebootAt, failoverAt, deltaSec }`。**`deltaSec ≤ 2` 是规范。**

`assertConcurrentNotifications({ page, screenshotPath? })` —— 打开 Notifications 飞出层并等待 `Rebooting cache` 与 `Submitting failover request` 同时可见（各 5 秒超时）。写截图到 `screenshotPath`（不传则自动命名）。

**Helper 调用**

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

**前置条件**

- Link 已确认链接对。
- 调用方知道当前哪边是 Primary。
- CDP Edge 已登录 `ms.portal.azure.com`。

**后置条件 / 验证**

- `deltaSec ≤ 2`。
- Notifications 飞出层中同时出现 `Rebooting cache` 与 `Submitting failover request`。
- 截图证据已写盘。
- 后续 `assertGeoRoleFlip` 确认角色已翻转。

**踩坑**

- **Port combobox 的选项 role 是 `treeitem`，不是 `option`。** 用 `getByRole("option", …)` 会一直 timeout。
- **Reboot 确认弹窗是 OK/Cancel；failover 是 Yes/No。** 这两个操作在同一脚本里 —— 不要混用。
- **Reboot OK 和 Failover Yes 之间不要加人工等待。** 加 `waitForTimeout` 或 `closeNotificationsFlyout` 都会爆 ≤ 2 秒的预算。
- **从一个全新的 Portal 会话开跑。** 残留的 Notifications 飞出层可能拦截 secondary 上的 Failover 按钮；helper 关一次，但额外噪声还是会增加延迟。
- **`primary` 接收 reboot，`secondary` 接收 failover。** 反过来跑出来的就是无意义的测试。
- **`assertConcurrentNotifications` 必须立刻调用** —— Rebooting cache 的 toast 在 60–180 秒后就会消失。

---

## Capability 6: geo-unlink

**用途** —— 反向 Link。提交解链（默认 Portal "Unlink caches"，回退 ARM `DELETE`）
并等待**两边都收敛** —— 接收方一侧通常在发起方完成后 30–60 秒才进入 `Deleting`，
提交后立即查 ARM 是不够的。

**何时使用**

- Teardown 之前，需要一条干净的 unlink 记录（Activity Log + 截图）。
- 多轮 link / failover / unlink 循环之间。
- 测试场景显式要验证 unlink 工作流。

**何时不要用**

- 仅做整片销毁不需要校验 —— Teardown 已经在内部做了 best-effort ARM unlink。
- 半建链状态下做错误恢复（先让 `Deleting` / `Creating` 自然收敛）。

**输入**

`invokeGeoUnlink({ page?, caches, subscription, resourceGroup, mode?, tenant? })`

| 字段 | 必填 | 说明 |
|---|---|---|
| `caches` | 是 | 必须**恰好 2 个**缓存名：`[primary, secondary]`。Helper 校验 `length === 2`。 |
| `subscription`、`resourceGroup` | 是 | — |
| `mode` | 否 | `"UI" \| "Arm" \| "Auto"`（默认 `Auto` —— UI 先，UI 失败回退 ARM）。 |
| `page` | 条件 | `mode = UI` 或 `Auto` 时必填。 |

`assertGeoUnlinked({ caches, subscription, resourceGroup, maxMinutes? })` —— 默认 `maxMinutes = 15`。内部走 `waitGeoLink({ expectEmpty: true })`。把本次运行涉及的全部缓存都传进去。

**Helper 调用**

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

**前置条件**

- 该对当前已建链（`linkedServers` 每边返回 1 个 `Succeeded` 条目）。
- 没有 in-flight 的 failover。若刚提交过 failover，等 ~120 秒并 `assertGeoPair` / `assertGeoRoleFlip` PASS 后再 unlink。

**后置条件 / 验证**

- 每个缓存的 `GET .../linkedServers` 返回 `value: []`。
- 这对缓存变回两个独立缓存，可重新建链 / 扩缩 / 删除。

**踩坑**

- **两阶段异步**：点 A 端的 "Unlink" 先把 A 端的条目去掉；B 端的条目要等控制面传播完才进入 `Deleting`。预算 ≥ 15 分钟。
- **"Unlink" 在 blade 上有两个**：command-bar 的 `Unlink caches` 按钮 + footer best-practices 的 "Unlink" 链接。必须用 `getByRole("button", { name: "Unlink caches", exact: true })`。
- **确认弹窗是 Yes/No**（同 failover；reboot 用的是 OK/Cancel）。
- **Auto 模式 UI 失败时会静默回退到 ARM** —— 这是设计如此，但 `[geo] UI unlink failed, falling back to ARM: …` 是唯一信号。如果测试必须有 UI 截图证据，强制 `mode: "UI"`。
- **删除前的清理闸门**：Teardown 内部已经 `waitGeoLink({ expectEmpty: true })`，但若手工先 `invokeGeoUnlink` 后立刻调 Teardown 而不走 `assertGeoUnlinked`，`redis delete --no-wait` 可能撞上仍在 `Deleting` 的 `linkedServers` 条目（409）。

---

## Capability 7: geo-dns-verify

**用途** —— ADO 16021106：failover 之后，两个 `.geo.` CNAME（geo-Primary 的和
geo-Secondary 的）都应解析到**当前** Geo-Primary 的 `*.redis.cache.windows.net`
主机名。使用外部 DNS resolver（默认 `8.8.8.8`）绕开本地 OS / 浏览器 DNS 缓存。

**何时使用**

- Failover 或 Reboot-then-failover 之后，测试覆盖 DNS 行为时。
- 长时间 soak 测试中周期性检测，捕获静默的 DNS 回归。

**何时不要用**

- 用来代替 `assertGeoRoleFlip` —— DNS flip 可能滞后控制面 flip 几分钟。
- 用来测试 Redis 数据面连通性 —— DNS 解析是必要但不充分条件。

**输入** —— `testGeoDns({ newPrimary, newSecondary, dnsServer })`

| 字段 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `newPrimary` | 是 | — | **当前** Geo-Primary（failover 后这是旧的 secondary）。 |
| `newSecondary` | 是 | — | 当前 Geo-Secondary。 |
| `dnsServer` | 否 | `"8.8.8.8"` | 外部 resolver，绕过本地缓存。内部企业 resolver 可能返回过期 CNAME。 |

期望 CNAME 目标：`<newPrimary>.redis.cache.windows.net`。`<newPrimary>.geo.redis.cache.windows.net` 和 `<newSecondary>.geo.redis.cache.windows.net` 都必须指向它。

**Helper 调用**

```powershell
$js = @'
const geo = require("d:/junru/skills/geo-replication-setup/create-geo.js");
(async () => {
  await geo.testGeoDns({
    newPrimary:   "ManualTestingGeo-SEA-1118",     // 旧 secondary，现在是 primary
    newSecondary: "ManualTestingGeo-EUS2E-1118",
  });
})().catch(e => { console.error(e.message); process.exit(1); });
'@
node -e $js
```

**前置条件**

- Failover / Reboot-then-failover 已通过 `assertGeoRoleFlip` PASS。
- failover 之后至少等 60–120 秒（DNS TTL ~ 60 秒；不同 resolver 全量传播 5–15 分钟）。

**后置条件 / 验证**

- 仅当**两个** `.geo.` 记录都解析到 `<newPrimary>.redis.cache.windows.net` 时返回 `true`。
- 否则抛 `Phase 5 FAIL (ADO 16021106): …`，并附上不匹配的记录。

**踩坑**

- **不要用裸的 `nslookup`。** Windows 的 `nslookup` 会受本地 DNS 客户端缓存影响，几分钟内一直返回旧值。Helper 用 Node 的 `dns.Resolver` 指向 `8.8.8.8` 就是为了绕过它。
- **Edge / Portal 页面有自己的激进 DNS 缓存。** Helper 完全不碰 Edge，只用 Node resolver。
- **CNAME 归一化**：返回值通常带尾点且大小写不一致。Helper 已经统一小写做字符串比较；不要自己再加匹配逻辑。
- **TTL 窗口**：failover 后 30 秒内查询，两条记录可能都还指向旧 primary。预留 60–120 秒。
- **企业 DNS 可能屏蔽 `8.8.8.8`。** 必要时把 `dnsServer` 改成 `1.1.1.1` —— 但**不要**改成企业内部 resolver（它的缓存可能比 Azure TTL 还长）。

---

## Capability 8: geo-teardown

**用途** —— 把传入的所有缓存销毁。Best-effort ARM unlink + 并行
`az redis delete --no-wait` + 残留校验。

Helper 内部步骤：

1. ARM 模式 unlink 每一对连续缓存（`caches[0]/caches[1]`、`caches[2]/caches[3]` …），失败容忍。
2. `waitGeoLink({ expectEmpty: true, maxMinutes: 15 })`。
3. 对每个缓存并行 `az redis delete --no-wait`。
4. 等 60 秒，再对每个缓存走 `az redis show` 检查残留。

**何时使用**

- 任何 Geo 测试运行的最后一步，不论 pass / fail。
- 多轮 link / unlink 循环之后，归还一个干净的订阅。

**何时不要用**

- 用作测试中途的错误恢复 —— 它会全部删掉，丢失诊断状态。用 Unlink 做精准恢复。
- 在 pair 形状以外删某个单独缓存 —— 直接调 `az redis delete`。

**输入** —— `invokeGeoTeardown({ subscription, resourceGroup, caches })`

| 字段 | 必填 | 说明 |
|---|---|---|
| `subscription` | 是 | — |
| `resourceGroup` | 是 | — |
| `caches` | 是 | **完整**缓存名数组（不再隐式拼接 date 后缀）。长度为偶数（连续两两作为一对进行 unlink）。 |

**Helper 调用**

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

**前置条件**

- 所有 in-flight 的 Portal-UI 操作都已收敛（没有挂着的 Failover 弹窗、没有开了一半的 reboot blade）—— 否则 ARM `DELETE` 会跟 Portal 状态打架。

**后置条件 / 验证**

- `caches` 中的每个名字要么已删除，要么处于 `Deleting`（`--no-wait` 下 60 秒后仍存在最多约 5 分钟属于正常；以后续单独的 `az redis show` 为最终判据）—— helper 若发现残留会打 `[geo] WARN TEARDOWN PARTIAL: remaining=…`。
- 仅当每个名字都完全消失时返回 `true`。

**踩坑**

- **必须先 Unlink 再 Delete。** 在已建链的缓存上 `az redis delete` 会返回 409 "Cache is currently linked"。Helper 内部就是用 ARM unlink + `waitGeoLink({ expectEmpty: true })` 来防这个的。
- **`--no-wait` 不等于一定异步落实。** 它立刻返回，但资源真正进入 `Deleting` 可能要等编排器调度 5–60 秒。60 秒 settle 是下限。
- **内部 unlink 阶段出现 WARN 是正常的**（`[geo] WARN unlink step: …`）。Helper 会继续走 delete 循环，不要把 WARN 当作硬失败。
- **软删命名冷却**：删除后的名字会进入约 1 小时的预留窗口。后续运行复用同名可能撞到 409 `NameAlreadyReserved`，请换后缀或等过去。

---

## 组合配方（Composition Recipes）

下面是参考配方。每个测试用例应当放在自己的 SKILL 中，**组合**下面的 capability；
具体配方不由本库维护。

| 场景 | 推荐链 |
|---|---|
| 标准 Portal failover | Prereq → **cache-creation skill** → Link → Failover → Unlink |
| Reboot-then-failover（ADO 16021140） | Prereq → **cache-creation skill** → Link → Reboot-then-failover → Unlink |
| `.geo.` DNS flip（ADO 16021106） | Prereq → **cache-creation skill** → Link → Failover → DNS-verify → Unlink |
| Geo + Import / Benchmark / Upgrade / Scale / Persistence | 先 Prereq → **cache-creation skill** → Link 把环境搭起来，再调用 feature 自己的 capability（不在本库），可选 Failover，最后 Unlink 和/或 Teardown。 |
| 已有缓存上重新 stage（跳过创建） | 用 `az redis show` 确认是 `Succeeded` + `aad-enabled=false` 后，Prereq → Link 直接进。 |
| 运行末尾完整清理 | Unlink → 等待 → Teardown。Teardown 内部会再 ARM unlink 一次，但前置一次干净的 Unlink 会缩短整体时间。 |

**组合规则**（由调用方测试 SKILL 负责，不在本库内强制）：

- 每个 capability 都返回一个可验证信号 —— 失败要往上传播，不能静默吞掉。
- 校验由产出该状态的 capability 自己负责。刚刚 PASS 的 Link 之后不要重复 `assertGeoPair`；但若中间有较长停顿 / 并发跑 / 聊天重置恢复，**应当**再校验一次。
- 测试 SKILL 不要内嵌 ARM body、轮询循环或 Playwright 编排 —— 该扩展的 capability 是哪个就扩展哪个。

---

## 不在本库范围（Out of scope）

- 端到端测试编排（什么时候调哪个 capability）—— 由测试 SKILL 负责。
- 反复反向 failover 的压力循环 / link-unlink 压力模式。
- AAD-only 形态的 Geo 配置（设计层面就阻塞）。
- Persistence / VNet-injected / AZ-enabled 缓存形态 —— 需配合单独的 cache-creation skill 起好缓存，再调 Link。
- Redis 数据面校验（`SET / GET / INFO / redis-cli`）—— 用单独的校验 skill。
