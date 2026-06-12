# AIExecutRedisCase

AIExecutRedisCase is a skill-driven testing and automation repository for Azure Cache for Redis. It breaks Azure Portal UI automation, Redis data-plane validation, Azure DevOps test asset extraction, performance benchmarking, and report generation into composable Skills that AI agents or test engineers can orchestrate from test cases.

## Project Purpose

- Use `redis-e2e-workflow` as the master entry point to parse test cases and generate a minimal execution plan.
- Cover Redis creation, deletion, geo-replication, persistence, import/export, firewall, Portal validation, Console validation, and benchmark scenarios through atomic Skills.
- Use Playwright/CDP to connect to a real authenticated Azure Portal browser session and perform observable, verifiable Portal operations.
- Expose callable capabilities through local MCP servers, including Node.js scenario MCP servers and the C# Azure DevOps MCP server.
- Use the bundled Redis Windows client tools for local data-plane command validation.

## Repository Structure

```text
AIExecutRedisCase/
├─ README.md
├─ package.json
├─ azure-devops-mcp-csharp/          # Azure DevOps MCP Server implemented in C#/.NET 8
├─ skills/
│  ├─ ado-testcase-extractor/        # Read plans, suites, cases, and results through ADO MCP
│  ├─ azure-portal-reliability/      # Azure Portal automation reliability patterns
│  ├─ cache-creation/                # Create Azure Cache for Redis through Azure Portal
│  ├─ cache-deletion/                # Delete Azure Cache for Redis through Azure Portal
│  ├─ firewall-rules-test/           # Atomic Networking / Firewall capability library
│  ├─ geo-replication-setup/         # Geo link / failover / unlink / DNS validation
│  ├─ playwright-cli/                # Playwright CLI usage guidance
│  ├─ portal-bvt-basic-cache-creation/ # Portal BVT cache creation template
│  ├─ portal-console/                # Azure Portal Redis Console validation
│  ├─ portal-validation/             # Portal blade / control / state validation
│  ├─ Redis_Benchmark/               # memtier_benchmark workflow on Azure VMs
│  ├─ redis-benchmark-report-xlsx/   # Convert performance txt results to weekly xlsx reports
│  ├─ redis-client/                  # redis-cli / redis-benchmark data-plane validation
│  ├─ redis-e2e-workflow/            # Master orchestration Skill
│  ├─ redis-import-export/           # RDB import/export validation
│  ├─ redis-persistence/             # AOF / RDB persistence validation
│  └─ redis-portal/                  # Shared Redis Portal helper library
└─ tools/
   └─ redis-client/                  # redis-cli.exe, redis-benchmark.exe, and Windows configs
```

## Core Skill Matrix

| Skill | Main purpose |
|---|---|
| `redis-e2e-workflow` | Master orchestrator. Decomposes test case preconditions, steps, expected results, and validation requirements, then matches the scenario catalog and lazily loads only the required atomic Skills. |
| `cache-creation` | Creates Basic / Standard / Premium Redis caches through Azure Portal and validates deployment success. |
| `cache-deletion` | Deletes a cache from the resource Overview page and validates submission and completion state. |
| `geo-replication-setup` | Covers geo link, failover, reboot + failover, unlink, DNS checks, and role switch validation. |
| `redis-import-export` | Covers RDB export/import, Storage preparation, data population, and post-import validation. |
| `redis-persistence` | Covers AOF / RDB persistence configuration, data writes, save triggers, and Blob evidence validation. |
| `firewall-rules-test` | Atomic capability library for the Networking / Firewall blade, including rule add, edit, delete, discard, quota banner, and ARM fallback operations. |
| `portal-validation` | Validates Portal resource blades, control states, text signals, button availability, and resource status. |
| `portal-console` | Executes commands in Azure Portal Redis Console and validates output, such as `info`. |
| `redis-client` | Uses the bundled `redis-cli.exe` / `redis-benchmark.exe` for data-plane command execution and assertions. |
| `redis-portal` | Reuses Edge CDP connection, Redis blade navigation, visible-text click fallbacks, notification cleanup, Access Key copy, Reboot, and other Portal helpers. |
| `azure-portal-reliability` | Defines Portal automation reliability rules for selectors, iframes, waits, login drift, and failure recovery. |
| `ado-testcase-extractor` | Reads Azure DevOps test plans, suites, cases, runs, and results through the local C# MCP server. |
| `Redis_Benchmark` | Orchestrates end-to-end memtier_benchmark performance tests on a specified Azure VM/cache environment. This Skill depends on the external PowerShell/Python companion scripts and permissions described in its own documentation. |
| `redis-benchmark-report-xlsx` | Converts Memtier performance result txt files into weekly xlsx reports while preserving the existing 0515-style layout, trend blocks, and charts. |
| `portal-bvt-basic-cache-creation` | Template Skill for the Azure Cache for Redis Portal BVT basic cache creation case. |
| `playwright-cli` | Guidance for browser automation, page snapshots, element interaction, session management, and Playwright debugging. |

## Tech Stack

- Node.js: Skill helpers, MCP wrappers, and command entry points.
- Playwright: Azure Portal browser automation, usually through Edge CDP attached to a real signed-in session.
- C# / .NET 8: Azure DevOps MCP Server.
- Azure CLI: Resource state checks, management-plane validation, and auxiliary verification.
- Redis Windows tools: Bundled `redis-cli.exe` and `redis-benchmark.exe`.

## Prerequisites

Windows + PowerShell is the recommended execution environment.

- Node.js 18+
- .NET SDK 8+
- Azure CLI, signed in with access to the target subscription
- Microsoft Edge, preferably launched with a CDP debugging port such as `9222`
- Playwright browser dependencies
- Access to the target Azure subscription, resource group, and cache resources

Azure DevOps MCP also requires these environment variables:

```powershell
$env:AZURE_DEVOPS_ORG="https://dev.azure.com/<org>"
$env:AZURE_DEVOPS_PROJECT="<project>"
$env:AZURE_DEVOPS_TOKEN="<pat>"
```

The PAT needs at least Test Management read permission. Do not commit tokens to the repository.

## Installation

Install Node dependencies from the repository root:

```powershell
npm install
```

Build the Azure DevOps MCP Server:

```powershell
Set-Location .\azure-devops-mcp-csharp
dotnet restore
dotnet build
```

## Common Commands

All test cases can be provided to the AI chat and executed through natural language instructions. However, a model with strong comprehension capabilities (e.g., GPT‑5.5) is required.

`package.json` currently provides these command entries:

```powershell
# Open the bundled redis-cli.exe
npm run redis:cli

# Run the geo data-plane helper script
npm run geo:data-plane

# Start the cache creation MCP Server
npm run mcp:cache-creation

# Start the geo replication MCP Server
npm run mcp:geo-replication-setup
```

Other Skills that contain `mcp/server.js` can also be started directly, for example:

```powershell
node .\skills\firewall-rules-test\mcp\server.js
node .\skills\redis-import-export\mcp\server.js
node .\skills\redis-persistence\mcp\server.js
node .\skills\Redis_Benchmark\mcp\server.js
node .\skills\redis-benchmark-report-xlsx\mcp\server.js
```

Start the Azure DevOps MCP Server:

```powershell
Set-Location .\azure-devops-mcp-csharp
dotnet run
```

After startup, MCP-capable clients can call:

- `get-test-plans`
- `get-test-suites`
- `get-test-cases`
- `get-test-plan-details`
- `get-test-results`
- `get-test-runs`



## Recommended Workflow

1. If the task comes from an Azure DevOps test case, use `ado-testcase-extractor` to read the plan, suite, and case first.
2. Use `redis-e2e-workflow` to decompose the test case and emit a Discovery Summary plus the minimal Skill execution plan.
3. Load atomic Skills by scenario, for example `cache-creation` -> `geo-replication-setup` -> `portal-validation`.
4. Add `redis-client` when data-plane validation is required; add `portal-console` when Portal Console validation is required.
5. For Portal automation reliability, follow `azure-portal-reliability` and the CDP rules from the `redis-portal` helpers.
6. For long-running workflows, keep logs, screenshots, or other observable evidence instead of relying only on verbal results.

## Azure Portal Automation Conventions

- Prefer attaching to the user's existing signed-in Edge CDP session. The default endpoint is `http://127.0.0.1:9222`.
- If the login state drifts, stop execution and ask the user to complete sign-in or verification in the browser before continuing.
- Use stable readiness signals such as spinner disappearance, stable content, target text visibility, and button state changes.
- Use generous timeouts for deployments, import/export, persistence saves, geo failover, benchmark watch phases, and other long-running steps.
- Leave verifiable evidence for every important state change, such as Portal text, activity log entries, DNS queries, Redis command output, or file size checks.

## Notes

- This repository can create, delete, fail over, reboot, import/export, and benchmark real Azure resources. Always confirm the subscription, resource group, cache name, and SKU before execution.
- The `Redis_Benchmark` Skill describes fixed performance test subscriptions, resource groups, VMs, SSH keys, and external script requirements. The current repository root does not contain a `scripts/` directory, so confirm the companion scripts and permissions before running it.
- `redis-benchmark-report-xlsx` requires a correctly formatted Memtier performance result txt input and should generate the xlsx according to the Skill documentation. Do not copy an old report as a substitute for a new generated result.
- Sensitive values such as Azure DevOps PATs, Redis access keys, and SSH private keys should only live in local environment variables, MCP client configuration, or secure credential storage.

## Maintenance Guidelines

- Prefer atomic and composable design when adding new capabilities: one Skill should own one clear capability boundary.
- Each `SKILL.md` should define Use When, Do Not Use When, Required Inputs, execution steps, validation criteria, and failure handling.
- If you add an MCP wrapper or a commonly used command, update `package.json` and this README together.
- If a helper API changes, update the corresponding Skill documentation so the docs and implementation do not drift.

## References

- See `azure-devops-mcp-csharp/README.md` for Azure DevOps MCP Server details.
- Scenario-specific execution details live in each `skills/<skill-name>/SKILL.md` file.