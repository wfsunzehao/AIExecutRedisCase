---
name: redis-e2e-workflow
description: |
  Enterprise-grade Master Orchestrator skill for Azure Redis end-to-end
  testing. Unified entry point that decomposes a Test Case, discovers the
  Atomic Skills it actually needs, resolves Scenario Catalog matches via a
  priority system, detects missing skills, and constructs a minimal
  execution plan. Loads Atomic Skill implementations lazily (metadata-only
  during Discovery) and falls back to portal-console + playwright-cli only
  when no Atomic Skill covers a step. Designed to scale to 50+ Atomic
  Skills and 100+ Scenario Templates without changing orchestration logic.
applyTo: "**"
---

# Redis Test Orchestrator (Master Skill)

> 中文版见 [SKILL.zh-CN.md](SKILL.zh-CN.md)

## Purpose

This skill is **not** a fixed workflow. It is an orchestrator that:

1. Decomposes the Test Case into Preconditions / Steps / Expected Results /
   Validation Requirements.
2. Discovers which Redis features, modules and validations are involved.
3. Matches against a Scenario Catalog using a deterministic Priority System.
4. Detects functionality not covered by any Atomic Skill (Missing Skills).
5. Builds a minimal Execution Plan over Atomic Skills (lazy loading).
6. Falls back to manual UI simulation (portal-console + playwright-cli) only
   when no Atomic Skill covers a step.

Goal: be the single entry for all Azure Redis test scenarios while loading
**only the skills the current Test Case actually needs**.

---

## Architecture

```
Test Case Decomposition
   ↓
Skill Discovery (metadata-only)
   ↓
Scenario Recognition  ──► Scenario Catalog hit?  ── yes ──► Priority Resolution ──► reuse plan
   ↓ no                                                                              │
Workflow Construction (dynamic compose from Feature Mapping) ◄───────────────────────┘
   ↓
Missing Skill Detection
   ↓
Atomic Skill Loading (lazy, plan-only)
   ↓
Atomic Skill Execution (+ Manual UI Fallback if uncovered)
   ↓
Validation
```

---

## Phase 0 — Test Case Decomposition (MANDATORY preprocessing)

Before Skill Discovery the orchestrator MUST decompose the Test Case into
four explicit buckets. All four feed Discovery — not just keywords in the
title.

```
Decomposition:
  Preconditions:           [...]   # cache state, region pair, SKU, persistence on, etc.
  Test Steps:              [...]   # action verbs from the case body
  Expected Results:        [...]   # post-conditions, observable signals
  Validation Requirements: [...]   # explicit "verify / validate / assert" items
```

Decomposition rules:

- Source = Test Case title + body + any attached CSV / notes / linked work
  items.
- Each Expected Result and each Validation Requirement is a first-class
  Discovery input. Example: `Expected Result: "Notification appears"`
  MUST trigger `azure-portal-reliability` even if the word "notification"
  is absent from the steps.
- Never collapse Expected Results into Test Steps; they often surface
  validation-only skills.
- If decomposition is impossible (case body missing), stop and ask the user
  for the source artifact — do not guess.

---

## Phase 1 — Skill Discovery (MANDATORY, runs before any execution)

Hard rules:

- MUST consume the full Decomposition output (all four buckets).
- MUST NOT enter execution after matching only the first keyword.
- MUST enumerate **all** features, modules and validations referenced.
- MUST only read **Skill Metadata** (name + description + keywords) during
  Discovery. See Phase 8 (Atomic Skill Loading Rules).
- MUST emit the upgraded Discovery Summary (see Phase 9) before execution.

If discovery is ambiguous, ask the user once with a concrete shortlist; do
**not** silently expand the plan with "just in case" skills.

---

## Phase 2 — Feature → Skill Mapping

Each feature row drives discovery. Match is case-insensitive, against any
of the four Decomposition buckets.

| Feature                  | Keywords                                                                                  | Required Skill               | Optional Skill(s)                              |
| ------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------- |
| Cache Provisioning       | create cache, new redis, provision, premium P1/P2/P3, basic, standard                     | cache-creation               | portal-validation                              |
| Persistence              | persistence, AOF, RDB, backup frequency, storage account for persistence                  | redis-persistence            | portal-validation                              |
| Import / Export          | import, export, RDB blob, restore, data migration                                         | redis-import-export          | portal-validation                              |
| Geo Replication          | geo, geo-replication, link, unlink, geo primary, geo secondary, failover, DNS, role flip  | geo-replication-setup        | portal-validation, azure-portal-reliability    |
| Scale                    | scale up, scale down, change SKU, P1→P2, scale tier                                       | scale-cache                  | portal-validation                              |
| Notification Validation  | notification, toast, activity log, concurrent notifications, "notification appears"       | azure-portal-reliability     | portal-validation                              |
| Portal State Validation  | portal blade, button state, status = Succeeded, UI shows, page signal                     | portal-validation            | —                                              |
| Firewall                 | firewall, firewall rule, IP rules, allow list, deny IP, start IP, end IP, 20 rules at once, quota banner, save/discard firewall, non-SSL port + firewall | firewall-rules-test          | portal-validation, cache-creation              |
| Access Policy            | access policy, RBAC, data access, assignment                                              | access-policy-validation     | portal-validation                              |
| Advanced Settings        | non-SSL port, min TLS, maxmemory policy, cluster shards, Entra auth toggle                | advanced-settings-validation | portal-validation                              |
| Reboot                   | reboot, restart node, reboot primary, reboot replica                                      | (covered by geo / atomic)    | portal-validation                              |

Rules:

- A skill enters the plan **iff** at least one keyword matches OR a matched
  Scenario explicitly lists it.
- Optional skills enter only if their own feature is also matched.
- `cache-creation` is required only when the Test Case explicitly provisions
  caches; pre-existing caches must skip it.

---

## Phase 3 — Scenario Catalog (preferred matcher)

Catalog match wins over dynamic compose. A scenario hits when its trigger
phrase OR its full required-feature set is present in the Decomposition.

### S1. Geo Failover Validation
Trigger: "Perform Geo Failover", "Initiate Geo failover", "validate failover notification"
Required Skills:
- geo-replication-setup
- portal-validation
- azure-portal-reliability

### S2. Geo DNS Validation
Trigger: "Geo DNS records", "DNS points to new Secondary", "DNS after failover"
Required Skills:
- geo-replication-setup
- portal-validation

### S3. Geo Reboot + Failover
Trigger: "reboot Geo Primary", "reboot then failover", "reboot replica then failover"
Required Skills:
- geo-replication-setup
- portal-validation
- azure-portal-reliability

### S4. Geo + Scale Validation
Trigger: "scale to P2 then link", "scale both caches then geo"
Required Skills:
- geo-replication-setup
- scale-cache
- portal-validation

### S5. Import + Geo
Trigger: "import then geo", "geo after import", "import RDB then link"
Required Skills:
- redis-import-export
- geo-replication-setup
- portal-validation

### S6. Disaster Recovery
Trigger: "disaster recovery", "DR drill", "recover from region loss"
Required Skills:
- redis-import-export
- geo-replication-setup
- portal-validation
- azure-portal-reliability

### S7. Persistence Validation
Trigger: "enable AOF", "enable RDB", "verify persistence blob"
Required Skills:
- redis-persistence
- portal-validation

### S8. Import / Export Roundtrip
Trigger: "export then import", "verify restored DBSIZE", "RDB roundtrip"
Required Skills:
- redis-import-export
- portal-validation

### S9. Full E2E (legacy fixed chain — opt-in only)
Trigger: explicit phrase "full e2e" or "redis end to end full"
Required Skills:
- cache-creation
- redis-persistence
- redis-import-export
- geo-replication-setup
- portal-validation
- azure-portal-reliability

### S10. Basic Cache Creation BVT
Trigger: "create premium cache", "BVT cache creation", "provision new cache"
Required Skills:
- cache-creation
- portal-validation

### S11. Advanced Settings Toggle
Trigger: "enable non-SSL port", "set min TLS", "toggle Entra auth"
Required Skills:
- advanced-settings-validation
- portal-validation

### S12. Firewall Rules
Trigger: "add firewall rule", "deny IP", "allow IP range", "verify firewall rules", "start/end IP saves", "invalid firewall input", "deleted rule won't show", "discard does not apply", "Firewall-Unified-Flow"
Required Skills:
- firewall-rules-test
- portal-validation
Notes: 7-stage capability library (validation, real-traffic block/allow, discard semantics, multi-row delete, 20-op quota, cleanup); chain `cache-creation` first only when the cache does not already exist in `Succeeded` state.

### S14. Firewall 20-Operation Quota
Trigger: "20 operations at a time", "Maximum 20 rules can be edited at once", "quota banner", "no more than 20 operations"
Required Skills:
- firewall-rules-test
- portal-validation
Notes: Specialization of S12 covering ADO 17528619; assert banner + input/trash mass-disable + Save clears banner without refresh.

### S13. Access Policy Assignment
Trigger: "assign access policy", "RBAC data access"
Required Skills:
- access-policy-validation
- portal-validation

Catalog miss → Phase 5 (dynamic compose).

---

## Phase 4 — Scenario Priority

When more than one scenario hits, the orchestrator MUST resolve
deterministically.

### Priority Resolution Algorithm

1. **Priority value**: every scenario has a numeric priority (higher wins).
2. **Tie-break #1 — specificity**: if two scenarios share the same
   priority, choose the one whose required-feature set has more matched
   features in the Decomposition (largest matched subset wins).
3. **Tie-break #2 — merge**: if still tied, **merge** required skills from
   the tied scenarios (set union, deduplicated, tier-ordered per Phase 5).
4. **Document**: the Discovery Summary MUST list `Matched Scenarios` and
   the `Selected Scenario` (or `merged: S_x + S_y`) plus the reason
   (`priority` / `specificity` / `merge`).

### Priority Table

| Scenario | Description                       | Priority | Notes                                         |
| -------- | --------------------------------- | -------- | --------------------------------------------- |
| S6       | Disaster Recovery                 | 100      | Most specific multi-feature scenario          |
| S5       | Import + Geo                      | 90       |                                               |
| S4       | Geo + Scale Validation            | 90       |                                               |
| S3       | Geo Reboot + Failover             | 80       | More specific than plain failover             |
| S1       | Geo Failover Validation           | 70       |                                               |
| S2       | Geo DNS Validation                | 70       |                                               |
| S8       | Import / Export Roundtrip         | 60       |                                               |
| S7       | Persistence Validation            | 60       |                                               |
| S11      | Advanced Settings Toggle          | 50       |                                               |
| S12      | Firewall Rules                    | 50       |                                               |
| S14      | Firewall 20-Operation Quota       | 60       | More specific than plain S12                  |
| S13      | Access Policy Assignment          | 50       |                                               |
| S10      | Basic Cache Creation BVT          | 40       |                                               |
| S9       | Full E2E (legacy fixed chain)     | 10       | Opt-in only; never wins implicit ties         |

Example — Test Case: "Import RDB, link Geo, scale to P2, validate Portal"

- Hits: S5 (Import + Geo, prio 90), S4 (Geo + Scale, prio 90).
- Tie-break #1: both match 2 features → still tied.
- Tie-break #2: merge → `redis-import-export + geo-replication-setup +
  scale-cache + portal-validation`.
- Discovery Summary: `Selected Scenario: merged(S5 + S4) — reason: merge`.

---

## Phase 5 — Workflow Construction (dynamic, fallback only)

Used **only** when no Scenario hits (Workflow Reuse, Phase 6, requires
Scenario Catalog to be tried first).

Compose the plan from matched features using this ordering contract (skip
any tier with no matched skill):

1. Provisioning tier: `cache-creation`
2. Configuration tier: `advanced-settings-validation`, `firewall-rules-test`,
   `access-policy-validation`, `redis-persistence`
3. Data tier: `redis-import-export`
4. Topology tier: `scale-cache`, `geo-replication-setup`
5. Validation tier: `portal-validation`
6. Reliability tier: `azure-portal-reliability`
7. Teardown: provided by the tier-owning skill (geo / persistence / I-E /
   cache-creation); never invent a separate teardown step.

Construction rules:

- Order is fixed by tier; never reorder across tiers.
- Within a tier, order follows the Test Case step order.
- A skill appears **once** in the plan even if matched by multiple features.
- If a step has no matching skill, route it to Missing Skill Detection
  (Phase 7) and then Manual UI Fallback (Phase 11) — never silently drop it.

---

## Phase 6 — Workflow Reuse

Rules:

1. If a Scenario Catalog entry (or the merge result from Phase 4) yields a
   valid execution plan, **reuse it verbatim**.
2. Do not rebuild a workflow that the catalog already provides.
3. Preference order:
   1. Scenario Catalog (single hit)
   2. Scenario Catalog (priority-resolved or merged)
   3. Dynamic Composition (Phase 5)
4. Dynamic Composition is strictly the fallback path. The orchestrator MUST
   record in the Discovery Summary which of the three paths was taken.

---

## Phase 7 — Missing Skill Detection

Every Test Step, Expected Result and Validation Requirement MUST resolve to
either an Existing Skill (via Feature Mapping or Scenario Catalog) or be
flagged as a Missing Skill. Silent drops are forbidden.

For each unmapped item, emit a record:

```
Missing Skill:
  Item:    <decomposition item, verbatim>
  Reason:  <no Feature Mapping row + no Scenario Catalog entry covers this>
  Suggested Skill Name: <kebab-case proposal, e.g. diagnostic-log-validation>
  Fallback: Manual UI Fallback (Phase 11) | Cannot proceed
```

Rules:

1. Continue execution for covered portions when the missing item is
   non-blocking (e.g. an extra validation). Skip the missing item and mark
   the overall test result `PARTIAL` with the missing item listed.
2. If the missing item is a blocking precondition or a primary action,
   stop and report `BLOCKED — missing skill: <name>`.
3. Missing skills MUST appear in the Discovery Summary `Missing Skills`
   section so they can later become real Atomic Skills.

Example: Test Case asks `Validate Diagnostic Logs` but no
`diagnostic-log-validation` skill exists. Emit a Missing Skill record;
continue the rest of the plan; mark result `PARTIAL`.

---

## Phase 8 — Atomic Skill Loading Rules (Lazy Loading)

This is the critical context-economy rule.

1. During **Decomposition + Discovery + Scenario Resolution + Missing Skill
   Detection**, the orchestrator MUST only read **Skill Metadata**: the
   skill's `name`, `description`, applyTo, and routing keywords.
2. The orchestrator MUST NOT load full Skill content (SKILL.md body,
   sub-scripts, prompts) during Discovery.
3. Load each Atomic Skill's implementation **only when execution reaches
   that skill** in the plan.
4. Load only skills that appear in the **final Execution Plan**. Never load
   skills listed in `Skipped`.
5. Discovery Phase MUST remain lightweight — measured by context tokens
   used before the first execution tool call.
6. If a skill load fails at execution time, do not silently substitute a
   different skill; stop, report `LOAD-FAIL: <skill>`, and consult the user.

Goal: predictable context budget, accurate routing, scalability to 50+
Atomic Skills.

---

## Phase 9 — Discovery Summary (mandatory output, upgraded format)

The orchestrator MUST emit this block **before any execution tool call**:

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
  [skillC, skillD, ...]   # explicitly excluded with reason "feature not matched"

Missing Skills:
  [{item, reason, suggested-name, fallback}, ...]   # empty list if none

Execution Plan:
  skillA → skillB → skillC

Validation Plan:
  [built-in asserts per skill] + [portal-validation: ...] + [azure-portal-reliability: ...]
```

This format is non-negotiable; do not collapse, abbreviate, or skip
sections — emit empty arrays where applicable.

---

## Phase 10 — Execution Rules

- Execute strictly in the constructed plan order. No skill outside the plan
  may run.
- Stop on the first hard failure; report the failed skill + the dependency
  it blocks.
- UI path is preferred for every skill that exposes one (per repo default:
  CDP Edge on `127.0.0.1:9222` + `playwright-cli attach`).
- ARM/CLI fallback is allowed **inside** an Atomic Skill, but the
  orchestrator does not swap a skill for raw ARM calls.
- Long-running waits MUST follow the repo default: `sync` + large timeout
  + Wait-script that emits progress every 60–180s. Never `mode=async` for
  LROs.

---

## Phase 11 — Manual UI Fallback

Use **only** for items flagged by Missing Skill Detection (Phase 7) with
fallback = Manual UI, or when an Atomic Skill's UI path is provably broken.

Tooling: `portal-console` + `playwright-cli` (CDP attach on
`http://127.0.0.1:9222`, independent `--user-data-dir`, literal
`127.0.0.1` — never `localhost`).

Contract: the fallback step MUST preserve the same pass/fail signal as the
original Test Case step (role, DBSIZE, blade state, notification text).

Priority recap:
1. Atomic Skill (UI path)
2. Atomic Skill (ARM/CLI fallback inside the skill)
3. Manual UI Fallback (portal-console + playwright-cli)

Never invent a 4th path (e.g. ad-hoc REST calls from the orchestrator).

---

## Validation Rules

- Validation runs **last** in the plan; pre-step checks do not replace final
  validation.
- Each Atomic Skill's built-in asserts still run (e.g.
  `geo-replication-setup` role-flip / unlinked asserts, `redis-persistence`
  blob asserts, `redis-import-export` DBSIZE / key-sample asserts).
- `portal-validation` covers blade state and button-state signals.
- `azure-portal-reliability` covers notification / activity-log /
  concurrent-notification signals — included only when the Decomposition
  (Steps OR Expected Results OR Validation Requirements) asks for it.
- A Test Case passes only if every plan step passes AND every required
  validation passes. Missing-skill items downgrade the overall result to
  `PARTIAL` rather than `PASS`.

---

## Future Expansion Rules

The orchestrator must remain scalable to 50+ Atomic Skills and 100+
Scenario Templates without touching execution logic.

Rules:

1. Adding a new Atomic Skill requires **only**:
   - A new row in **Phase 2 Feature → Skill Mapping**.
   - (Optional) one or more new entries in the **Phase 3 Scenario Catalog**
     with a priority value in **Phase 4**.
2. Existing orchestration phases (Decomposition, Discovery, Priority
   Resolution, Missing Skill Detection, Lazy Loading, Execution, Manual UI
   Fallback, Validation) MUST remain unchanged.
3. New scenarios MUST declare a numeric priority and slot into the existing
   Priority Table; never invent ad-hoc tie-break rules.
4. Tier ordering in Phase 5 is the contract for dynamic compose; new skills
   must be assigned to one of the existing tiers (Provisioning,
   Configuration, Data, Topology, Validation, Reliability, Teardown). If a
   genuinely new tier is needed, add it explicitly with a documented
   position — do not silently extend dynamic compose.
5. Naming convention: new Atomic Skills use kebab-case and end in a
   capability noun (`-validation`, `-setup`, `-cache`, etc.) to keep
   routing keywords predictable.
6. Backward compatibility: never remove a Scenario; deprecate by lowering
   its priority and noting `deprecated` in the Priority Table.

---

## Dependency Graph (logical, not a fixed chain)

```
                cache-creation
                      │
        ┌─────────────┼──────────────┬─────────────────────────────┐
        ▼             ▼              ▼                             ▼
 advanced-settings  firewall-rules-test  access-policy           redis-persistence
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
              Manual UI Fallback (only if UNCOVERED / Missing Skill)
                             │
                             ▼
                    Teardown (owned by tier skill)
```

Edges are dependency hints, not mandatory steps. The orchestrator walks
only the nodes selected in Phase 3 / 4 / 5.

---

## Skill Routing Keywords

- redis test orchestrator
- azure redis master skill
- discover skills from test case
- scenario catalog redis
- scenario priority redis
- missing skill detection redis
- test case decomposition redis
- dynamic workflow construction redis
- lazy skill loading redis
- workflow reuse redis
- geo failover only
- import only / persistence only / scale only
- portal click fallback
- manual UI simulation redis
- Azure Redis 测试编排器
- 按 Test Case 动态组合 Skills
- 只跑 Geo 不要 Persistence
- 场景目录命中
- 场景优先级
- 缺失 Skill 检测
- 懒加载 Atomic Skill

---

## Notes

- This skill is the Master Orchestrator. It never duplicates Atomic Skill
  implementations; it only routes.
- The previous fixed `cache-creation → persistence → import/export → geo →
  validation` chain is replaced. Loading unrelated skills for a Geo-only
  Test Case is a regression.
- When Atomic Skills are added or upgraded, update **Feature Mapping**,
  **Scenario Catalog**, and the **Priority Table** only — keep Execution /
  Validation / Lazy Loading / Fallback rules stable.
- Scenario Catalog (priority-resolved) is the fast path; dynamic compose is
  the safety net; Manual UI is the last resort; Missing Skill records feed
  the backlog for new Atomic Skills.
- When in doubt about scope, prefer the **smaller** plan and ask the user
  to opt-in to extra skills, rather than silently widening the plan.
