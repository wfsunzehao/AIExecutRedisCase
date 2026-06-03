---
name: redis-e2e-workflow
description: |
  企业级 Azure Redis 端到端测试主编排器（Master Orchestrator）。作为统一入口，
  对 Test Case 进行结构化拆解，发现真正需要的 Atomic Skills，通过优先级系统
  解析 Scenario Catalog 命中，检测缺失 Skill，并构建最小执行计划。Atomic Skill
  采用懒加载（Discovery 阶段仅读元数据）；仅当没有任何 Atomic Skill 覆盖某步骤
  时才回退到 portal-console + playwright-cli。设计目标：在不修改编排逻辑的前提
  下，可扩展至 50+ Atomic Skills 与 100+ Scenario 模板。
applyTo: "**"
---

# Redis 测试编排器（Master Skill）

> English version: [SKILL.md](SKILL.md)

## 目的

本 Skill **不是**固定 workflow，而是一个编排器：

1. 将 Test Case 拆解为「前置条件 / 测试步骤 / 预期结果 / 验证要求」四部分。
2. 发现涉及的 Redis 功能、模块与验证项。
3. 通过 Scenario Catalog + 优先级系统进行匹配。
4. 检测无任何 Atomic Skill 覆盖的功能（Missing Skill）。
5. 构建最小执行计划（Atomic Skill 懒加载）。
6. 仅在没有 Atomic Skill 覆盖时，回退到手动 UI 模拟（portal-console + playwright-cli）。

目标：成为 Azure Redis 所有测试场景的统一入口，**只加载当前 Test Case 真正需要的 Skill**。

---

## 总体架构

```
Test Case 拆解
   ↓
Skill Discovery（仅读元数据）
   ↓
Scenario 识别  ──► Scenario Catalog 命中？── 是 ──► 优先级解析 ──► 复用执行计划
   ↓ 否                                                            │
Workflow 动态组合（基于 Feature Mapping）  ◄──────────────────────┘
   ↓
Missing Skill 检测
   ↓
Atomic Skill 加载（懒加载，仅加载计划内）
   ↓
Atomic Skill 执行（未覆盖项走 Manual UI Fallback）
   ↓
Validation
```

---

## Phase 0 — Test Case 拆解（强制预处理）

在 Skill Discovery 之前，必须将 Test Case 拆解为以下四类，全部参与 Discovery，
而不是只看关键词。

```
Decomposition:
  Preconditions（前置条件）:        [...]   # cache 状态、region pair、SKU、持久化已开等
  Test Steps（测试步骤）:           [...]   # 用例正文中的动作动词
  Expected Results（预期结果）:     [...]   # 后置条件、可观测信号
  Validation Requirements（验证项）:[...]   # 明确的 verify / validate / assert
```

拆解规则：

- 来源 = Test Case 标题 + 正文 + 附带 CSV / 备注 / 关联工作项。
- 每条「预期结果」与「验证项」都是 Discovery 一等输入。例如：
  `Expected Result: "Notification appears"` 必须触发 `azure-portal-reliability`，
  即使「notification」未在 Steps 中出现。
- 不得把「预期结果」并进「测试步骤」——它们往往单独引出 validation-only skill。
- 如果无法拆解（用例正文缺失），停止并向用户索取来源资料，不要猜测。

---

## Phase 1 — Skill Discovery（强制，先于任何执行）

硬性规则：

- 必须消费 Phase 0 全部四类输出。
- 禁止匹配到第一个关键词就进入执行。
- 必须枚举**所有**涉及的功能、模块、验证项。
- Discovery 阶段**只能读 Skill 元数据**（name + description + 关键词），见 Phase 8。
- 必须在执行前输出升级版 Discovery Summary（见 Phase 9）。

若 Discovery 存在歧义，必须给出明确候选列表并向用户确认一次；**禁止**「以防万一」
地静默扩大计划。

---

## Phase 2 — Feature → Skill 映射

每行驱动 Discovery，大小写不敏感，匹配 Phase 0 任一类。

| 功能                    | 关键词                                                                                          | 必需 Skill                   | 可选 Skill                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------- |
| 创建缓存                | create cache, new redis, provision, premium P1/P2/P3, basic, standard                          | cache-creation               | portal-validation                               |
| 持久化                  | persistence, AOF, RDB, backup frequency, storage account for persistence                       | redis-persistence            | portal-validation                               |
| 导入 / 导出             | import, export, RDB blob, restore, data migration                                              | redis-import-export          | portal-validation                               |
| Geo 复制                | geo, geo-replication, link, unlink, geo primary, geo secondary, failover, DNS, role flip       | geo-replication-setup        | portal-validation, azure-portal-reliability     |
| 扩缩容                  | scale up, scale down, change SKU, P1→P2, scale tier                                            | scale-cache                  | portal-validation                               |
| 通知验证                | notification, toast, activity log, concurrent notifications, "notification appears"            | azure-portal-reliability     | portal-validation                               |
| Portal 状态验证         | portal blade, button state, status = Succeeded, UI shows, page signal                          | portal-validation            | —                                               |
| 防火墙                  | firewall, firewall rule, IP rules, allow list, deny IP, start IP, end IP, 20 rules at once, quota banner, save/discard firewall, non-SSL port + firewall | firewall-rules-test          | portal-validation, cache-creation               |
| 访问策略                | access policy, RBAC, data access, assignment                                                   | access-policy-validation     | portal-validation                               |
| 高级设置                | non-SSL port, min TLS, maxmemory policy, cluster shards, Entra auth toggle                     | advanced-settings-validation | portal-validation                               |
| 重启                    | reboot, restart node, reboot primary, reboot replica                                           | （由 geo / atomic 内建覆盖） | portal-validation                               |

规则：

- 某 Skill 进入计划，当且仅当：至少一个关键词命中 **或** 命中的 Scenario 显式列出该 Skill。
- 可选 Skill 仅在其对应功能也被命中时才加入。
- `cache-creation` 仅在用例**明确**要求新建缓存时加入；针对已有缓存的用例（多数
  Geo / Persistence / I-E 用例）必须跳过。

---

## Phase 3 — Scenario Catalog（优先匹配）

Catalog 命中优先于动态组合。Scenario 命中条件：触发词 **或** 全部必需功能在
Decomposition 中出现。

### S1. Geo Failover 验证
触发词：「Perform Geo Failover」「Initiate Geo failover」「validate failover notification」
必需 Skill：
- geo-replication-setup
- portal-validation
- azure-portal-reliability

### S2. Geo DNS 验证
触发词：「Geo DNS records」「DNS points to new Secondary」「DNS after failover」
必需 Skill：
- geo-replication-setup
- portal-validation

### S3. Geo 重启 + Failover
触发词：「reboot Geo Primary」「reboot then failover」「reboot replica then failover」
必需 Skill：
- geo-replication-setup
- portal-validation
- azure-portal-reliability

### S4. Geo + Scale 验证
触发词：「scale to P2 then link」「scale both caches then geo」
必需 Skill：
- geo-replication-setup
- scale-cache
- portal-validation

### S5. Import + Geo
触发词：「import then geo」「geo after import」「import RDB then link」
必需 Skill：
- redis-import-export
- geo-replication-setup
- portal-validation

### S6. 灾难恢复（DR）
触发词：「disaster recovery」「DR drill」「recover from region loss」
必需 Skill：
- redis-import-export
- geo-replication-setup
- portal-validation
- azure-portal-reliability

### S7. 持久化验证
触发词：「enable AOF」「enable RDB」「verify persistence blob」
必需 Skill：
- redis-persistence
- portal-validation

### S8. Import / Export 往返
触发词：「export then import」「verify restored DBSIZE」「RDB roundtrip」
必需 Skill：
- redis-import-export
- portal-validation

### S9. 完整 E2E（旧固定链路，仅显式 opt-in）
触发词：明确包含「full e2e」或「redis end to end full」
必需 Skill：
- cache-creation
- redis-persistence
- redis-import-export
- geo-replication-setup
- portal-validation
- azure-portal-reliability

### S10. 基础创建缓存 BVT
触发词：「create premium cache」「BVT cache creation」「provision new cache」
必需 Skill：
- cache-creation
- portal-validation

### S11. 高级设置切换
触发词：「enable non-SSL port」「set min TLS」「toggle Entra auth」
必需 Skill：
- advanced-settings-validation
- portal-validation

### S12. 防火墙规则
触发词：「add firewall rule」「deny IP」「allow IP range」「verify firewall rules」「start/end IP saves」「invalid firewall input」「deleted rule won't show」「discard does not apply」「Firewall-Unified-Flow」
必需 Skill：
- firewall-rules-test
- portal-validation
备注：7 阶段能力库（校验、真实流量 block/allow、Discard 语义、多行删除、5 20操作额度、清理）；仅在缓存未处于 `Succeeded` 状态时才在其之前串 `cache-creation`。

### S14. 防火墙 20 次操作配额
触发词：「20 operations at a time」「Maximum 20 rules can be edited at once」「quota banner」「no more than 20 operations」
必需 Skill：
- firewall-rules-test
- portal-validation
备注：S12 的专项化（ADO 17528619）；需验证 banner、输入框/trash 集体 disable、Save 后 banner 消失且不需刷新。

### S13. 访问策略分配
触发词：「assign access policy」「RBAC data access」
必需 Skill：
- access-policy-validation
- portal-validation

Catalog 未命中 → 进入 Phase 5（动态组合）。

---

## Phase 4 — Scenario 优先级

当多个 Scenario 同时命中，必须按下列算法**确定性**解析。

### 优先级解析算法

1. **优先级数值**：每个 Scenario 都有数值优先级，**数值越大越优先**。
2. **平级判定 #1 — 特异性**：若优先级相同，选择必需功能集中被 Decomposition
   命中数最多的那个（最大匹配子集胜出）。
3. **平级判定 #2 — 合并**：若仍平级，**合并**两 Scenario 的必需 Skill（集合并集，
   去重，按 Phase 5 的 tier 顺序排列）。
4. **必须记录**：Discovery Summary 中必须列出 `Matched Scenarios` 与
   `Selected Scenario`（或 `merged: S_x + S_y`），并给出原因
   （`priority` / `specificity` / `merge`）。

### 优先级表

| Scenario | 描述                          | 优先级 | 说明                                  |
| -------- | ----------------------------- | ------ | ------------------------------------- |
| S6       | 灾难恢复（DR）                | 100    | 最具特异性的多功能场景                |
| S5       | Import + Geo                  | 90     |                                       |
| S4       | Geo + Scale 验证              | 90     |                                       |
| S3       | Geo 重启 + Failover           | 80     | 比单纯 failover 更具特异性            |
| S1       | Geo Failover 验证             | 70     |                                       |
| S2       | Geo DNS 验证                  | 70     |                                       |
| S8       | Import / Export 往返          | 60     |                                       |
| S7       | 持久化验证                    | 60     |                                       |
| S11      | 高级设置切换                  | 50     |                                       |
| S12      | 防火墙规则                    | 50     |                                       |
| S14      | 防火墙 20 次操作配额          | 60     | 比 S12 更精确                          |
| S13      | 访问策略分配                  | 50     |                                       |
| S10      | 基础创建缓存 BVT              | 40     |                                       |
| S9       | 完整 E2E（旧固定链路）        | 10     | 仅 opt-in；不会隐式胜出               |

示例 —— 用例：「Import RDB，建 Geo 链接，扩到 P2，并在 Portal 验证」

- 命中：S5（Import + Geo，prio 90）、S4（Geo + Scale，prio 90）。
- 平级 #1：双方都匹配 2 个功能 → 仍平级。
- 平级 #2：合并 → `redis-import-export + geo-replication-setup + scale-cache + portal-validation`。
- Discovery Summary：`Selected Scenario: merged(S5 + S4) — reason: merge`。

---

## Phase 5 — Workflow 动态组合（仅在 Catalog 未命中时使用）

仅在 Scenario Catalog 完全未命中时启用（Workflow Reuse 要求 Catalog 必须先尝试）。

按以下 tier 顺序从已命中功能组合（无命中的 tier 直接跳过）：

1. 创建层（Provisioning）：`cache-creation`
2. 配置层（Configuration）：`advanced-settings-validation`、`firewall-rules-test`、
   `access-policy-validation`、`redis-persistence`
3. 数据层（Data）：`redis-import-export`
4. 拓扑层（Topology）：`scale-cache`、`geo-replication-setup`
5. 验证层（Validation）：`portal-validation`
6. 可靠性层（Reliability）：`azure-portal-reliability`
7. 清理（Teardown）：由所属 tier 的 Skill 负责（geo / persistence / I-E /
   cache-creation），**不要**新建独立 teardown 步骤。

组合规则：

- tier 顺序固定，**跨 tier 严禁重排**。
- 同 tier 内按用例步骤的出现顺序排列。
- 即使被多个功能匹配，每个 Skill 在计划中**仅出现一次**。
- 若某步骤没有任何 Skill 匹配，进入 Phase 7（Missing Skill 检测）并最终走
  Phase 11（Manual UI Fallback）—— **严禁静默丢弃**。

---

## Phase 6 — Workflow 复用

规则：

1. 若 Scenario Catalog 条目（或 Phase 4 合并结果）已给出可用执行计划，
   **逐字复用**，不要重建。
2. 不得对 Catalog 已提供的 workflow 进行二次构建。
3. 优先级顺序：
   1. Scenario Catalog（单一命中）
   2. Scenario Catalog（优先级解析或合并）
   3. 动态组合（Phase 5）
4. 动态组合严格作为回退路径。Discovery Summary 必须记录最终走的是上述哪条路径。

---

## Phase 7 — Missing Skill 检测

每一条「测试步骤 / 预期结果 / 验证要求」都必须解析为：**已存在 Skill**（来自
Feature Mapping 或 Scenario Catalog） **或** 标记为 **Missing Skill**。
**严禁静默丢弃**。

每条未映射项必须产出如下记录：

```
Missing Skill:
  Item:    <Decomposition 中原文>
  Reason:  <无任何 Feature Mapping 行且无 Scenario Catalog 覆盖>
  Suggested Skill Name: <kebab-case 命名建议，如 diagnostic-log-validation>
  Fallback: Manual UI Fallback (Phase 11) | Cannot proceed
```

规则：

1. 当缺失项**非阻塞**（如额外的 validation）时，继续执行已覆盖部分，跳过缺失项，
   并将整体结果标记为 `PARTIAL`，缺失项列在报告中。
2. 当缺失项是**阻塞性前置条件或主操作**时，停止执行并报告
   `BLOCKED — missing skill: <name>`。
3. 缺失 Skill 必须出现在 Discovery Summary 的 `Missing Skills` 区，作为后续
   新 Atomic Skill 的需求积压。

示例：用例要求 `Validate Diagnostic Logs`，但不存在 `diagnostic-log-validation`
Skill。生成 Missing Skill 记录；其余计划照常执行；最终结果标记 `PARTIAL`。

---

## Phase 8 — Atomic Skill 加载规则（懒加载）

这是上下文经济性的核心规则。

1. 在「拆解 + Discovery + Scenario 解析 + Missing Skill 检测」阶段，编排器
   **只能读 Skill 元数据**：`name`、`description`、`applyTo`、routing keywords。
2. Discovery 阶段**严禁**加载 Skill 完整内容（SKILL.md 正文、子脚本、prompt）。
3. 每个 Atomic Skill 的实现**仅在执行流到达它时**才加载。
4. 只加载出现在**最终 Execution Plan** 中的 Skill；`Skipped` 列表中的 Skill
   永远不加载。
5. Discovery 阶段必须保持**轻量**——以首次执行类工具调用前所用 context tokens 衡量。
6. 若某 Skill 在执行期加载失败，不要静默替换其它 Skill；停止并报告
   `LOAD-FAIL: <skill>`，等待用户裁决。

目标：可预测的 context 预算、准确的路由、可扩展至 50+ Atomic Skills。

---

## Phase 9 — Discovery Summary（强制输出，升级格式）

编排器必须在**任何执行类工具调用之前**输出下列块：

```
Discovery Summary
─────────────────
Features:
  [...]

Matched Scenarios:
  [S_x (prio N, matched F features), S_y (prio M, matched K features), ...]

Selected Scenario:
  <S_x | merged(S_x + S_y) | dynamic>
  Reason: <priority | specificity | merge | catalog-miss>

Required Skills:
  [skillA, skillB, ...]

Skipped Skills:
  [skillC, skillD, ...]   # 显式排除，附原因「feature not matched」

Missing Skills:
  [{item, reason, suggested-name, fallback}, ...]   # 无则空数组

Execution Plan:
  skillA → skillB → skillC

Validation Plan:
  [各 Skill 内建 asserts] + [portal-validation: ...] + [azure-portal-reliability: ...]
```

格式不可妥协；不得折叠、缩写或省略任何区块——无内容则输出空数组。

---

## Phase 10 — 执行规则

- 严格按构建的 Plan 顺序执行；**Plan 之外的 Skill 一律不得运行**。
- 首个硬失败即停止；报告失败 Skill 与被阻塞的下游依赖。
- 凡有 UI 路径的 Skill 优先走 UI（按仓库默认：CDP Edge `127.0.0.1:9222` +
  `playwright-cli attach`）。
- ARM/CLI 回退允许在 Atomic Skill **内部**进行，编排器不得用裸 ARM 替换整个 Skill。
- 长时等待必须遵守仓库默认：`sync` + 大 timeout + 内部每 60–180s emit 一行的
  Wait 脚本。**LRO 严禁 `mode=async`**。

---

## Phase 11 — Manual UI Fallback

**仅**用于 Phase 7 标记为 `fallback = Manual UI` 的 Missing Skill 项，或某
Atomic Skill 的 UI 路径已被证实不可用时。

工具：`portal-console` + `playwright-cli`（CDP attach 到
`http://127.0.0.1:9222`，独立 `--user-data-dir`，字面 `127.0.0.1`——**禁止**
写 `localhost`）。

契约：fallback 步骤必须保留与原用例步骤相同的 pass/fail 信号（role、DBSIZE、
blade 状态、通知文本）。

优先级总览：
1. Atomic Skill（UI 路径）
2. Atomic Skill 内部的 ARM/CLI 回退
3. Manual UI Fallback（portal-console + playwright-cli）

**严禁**自创第 4 条路径（如编排器直接调 REST）。

---

## Validation 规则

- Validation **必须最后**执行；前置检查不能替代最终验证。
- 各 Atomic Skill 内建 assert 照常运行（如 `geo-replication-setup` 的 role-flip /
  unlinked、`redis-persistence` 的 blob、`redis-import-export` 的 DBSIZE /
  key-sample 等）。
- `portal-validation` 覆盖 blade 状态与按钮状态信号。
- `azure-portal-reliability` 覆盖通知 / 活动日志 / 并发通知信号——**仅**在
  Decomposition（Steps 或 Expected Results 或 Validation Requirements）要求时加入。
- 一个 Test Case 通过的充要条件：Plan 中每一步通过 **且** 每一项 validation 通过。
  存在 Missing Skill 项时，整体结果降级为 `PARTIAL` 而非 `PASS`。

---

## 未来扩展规则（Future Expansion）

编排器必须在不动核心逻辑的前提下扩展到 50+ Atomic Skills 与 100+ Scenario 模板。

规则：

1. 新增 Atomic Skill **只需**：
   - 在 **Phase 2 Feature → Skill 映射**中新增一行。
   - （可选）在 **Phase 3 Scenario Catalog** 中新增条目，并在 **Phase 4 优先级表**
     中赋一个数值优先级。
2. 现有编排阶段（拆解、Discovery、优先级解析、Missing Skill 检测、懒加载、
   执行、Manual UI Fallback、Validation）**保持不变**。
3. 新 Scenario 必须声明数值优先级并接入现有 Priority Table；**不得自创**
   平级判定规则。
4. Phase 5 的 tier 顺序是动态组合的契约；新 Skill 必须归入现有某一 tier
   （Provisioning / Configuration / Data / Topology / Validation / Reliability /
   Teardown）。若确实需要新 tier，必须显式新增并标注位置，**不得**静默扩展。
5. 命名规范：新 Atomic Skill 使用 kebab-case，以能力性名词结尾
   （`-validation`、`-setup`、`-cache` 等），保持 routing keywords 可预测。
6. 向后兼容：**永不删除** Scenario；废弃时降低其优先级并在 Priority Table 中
   标注 `deprecated`。

---

## 依赖图（逻辑图，非固定链路）

```
                cache-creation
                      │
        ┌─────────────┼──────────────┬─────────────────────────────┐
        ▼             ▼              ▼                             ▼
 advanced-settings  firewall    access-policy              redis-persistence
        │             │              │                             │
        └─────────────┴──────┬───────┘                             │
                             ▼                                     ▼
                      redis-import-export ◄──────────────── (data prereq)
                             │
                             ▼
                        scale-cache
                             │
                             ▼
                   geo-replication-setup
                             │
                             ▼
                      portal-validation
                             │
                             ▼
                  azure-portal-reliability
                             │
                             ▼
              Manual UI Fallback（仅 UNCOVERED / Missing Skill）
                             │
                             ▼
                    Teardown（由 tier 所属 Skill 负责）
```

边为依赖提示而非必经步骤。编排器只走 Phase 3 / 4 / 5 选中的节点。

---

## Skill Routing Keywords

- redis 测试编排器
- azure redis master skill
- 按 test case 发现 skill
- redis scenario catalog
- redis scenario 优先级
- redis missing skill 检测
- redis test case 拆解
- redis 动态 workflow 组合
- redis 懒加载 skill
- redis workflow 复用
- 只跑 geo 不要 persistence
- 只 import / 只 persistence / 只 scale
- portal 点击兜底
- redis 手动 UI 模拟
- Azure Redis 测试编排器
- 按 Test Case 动态组合 Skills
- 场景目录命中
- 场景优先级
- 缺失 Skill 检测
- 懒加载 Atomic Skill

---

## 备注

- 本 Skill 是 Master Orchestrator，**不重复** Atomic Skill 实现，只做路由。
- 旧的固定链路 `cache-creation → persistence → import/export → geo →
  validation` 已被替代。Geo-only 用例加载无关 Skill 视为回归。
- Atomic Skill 升级时，仅更新 **Feature Mapping**、**Scenario Catalog**、
  **Priority Table**；保持 Execution / Validation / 懒加载 / Fallback 规则稳定。
- 优先级解析后的 Scenario Catalog 是快路径；动态组合是安全网；Manual UI 是
  最后兜底；Missing Skill 记录则沉淀为新 Atomic Skill 的需求积压。
- 范围不确定时，倾向**更小**的计划并请用户 opt-in 额外 Skill，而非静默扩大。
