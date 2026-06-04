# AIExecutRedisCase

A skill-driven repository for Azure Cache for Redis testing and automation.

This project brings Azure Portal UI operations, Redis data-plane validation,
Azure DevOps test asset extraction, and reusable orchestration patterns into
one workspace. It is designed for:

- Standardized manual test execution steps
- Playwright/CDP-based Azure Portal automation
- Redis end-to-end validation (creation, persistence, import/export, geo, etc.)
- Azure DevOps plan/suite/test-case discovery and integration

## Project Goals

- Provide composable Redis testing capabilities (Skill Library)
- Improve execution efficiency for complex scenarios through orchestration
- Support local MCP services so AI agents can invoke test capabilities directly
- Reduce flakiness in real Azure Portal automation workflows

## Repository Structure

```text
AIExecutRedisCase/
├─ package.json
├─ azure-devops-mcp-csharp/         # ADO MCP Server implemented in C#
├─ skills/
│  ├─ cache-creation/               # Create Redis cache through Azure Portal
│  ├─ cache-deletion/               # Delete Redis cache through Azure Portal
│  ├─ geo-replication-setup/        # Geo link/failover/unlink capabilities
│  ├─ redis-import-export/          # Import/export capabilities (Premium/AMR)
│  ├─ redis-persistence/            # AOF/RDB persistence capabilities
│  ├─ firewall-rules-test/          # Networking/Firewall rule capabilities
│  ├─ redis-client/                 # redis-cli/benchmark data-plane validation
│  ├─ portal-validation/            # Resource blade/control validation
│  ├─ portal-console/               # In-portal Redis Console validation
│  ├─ azure-portal-reliability/     # Reliability patterns for Portal automation
│  ├─ ado-testcase-extractor/       # ADO test asset extraction workflow
│  ├─ redis-e2e-workflow/           # Master orchestrator skill
│  ├─ playwright-cli/               # Playwright CLI usage guidance
│  ├─ portal-bvt-basic-cache-creation/
│  └─ senior-test-engineer/
└─ tools/
    └─ redis-client/                 # Bundled Redis client-related config
```

## Core Capability Matrix

- cache-creation: Creates Basic/Standard/Premium caches via Azure Portal,
   including form fill, deployment monitoring, and success validation.
- cache-deletion: Executes deletion from the resource Overview page and verifies
   submission/completion.
- geo-replication-setup: Provides atomic geo operations such as link, failover,
   reboot+failover, unlink, and DNS checks.
- redis-import-export: Provides end-to-end import/export validation, including
   storage preparation, data population, export/import execution, and checks.
- redis-persistence: Provides AOF/RDB persistence validation, including prereq
   checks, configuration, data fill, and blob evidence checks.
- firewall-rules-test: Provides atomic Firewall/Networking blade operations and
   rule editing capabilities.
- portal-validation: Visits and validates resource blades/controls with
   per-blade outcomes.
- portal-console: Runs commands like info inside Azure Portal Redis Console and
   validates output.
- redis-client: Runs redis-cli/redis-benchmark for data-plane command execution
   and assertion.
- azure-portal-reliability: Defines reliability patterns for selectors, waits,
   iframe handling, and failure recovery.
- ado-testcase-extractor: Retrieves plans, suites, cases, and results through
   the local C# MCP server.
- redis-e2e-workflow: Acts as orchestration entry, dynamically matching and
   loading required atomic skills from a test case.

## Tech Stack

- Node.js (scripts and MCP wrappers)
- Playwright (browser automation)
- C# / .NET 8 (Azure DevOps MCP server)
- Azure CLI (resource and management-plane validation)

## Prerequisites

Recommended environment:

- Windows (this repository primarily uses Windows paths and PowerShell)
- Node.js 18+
- .NET SDK 8+
- Azure CLI (logged in with access to target subscription)
- Microsoft Edge (for CDP attach, commonly port 9222)

For ADO MCP capabilities, also set:

- AZURE_DEVOPS_ORG
- AZURE_DEVOPS_PROJECT
- AZURE_DEVOPS_TOKEN

## Install Dependencies

From repository root:

```powershell
npm install
```

To build the C# MCP server:

```powershell
cd azure-devops-mcp-csharp
dotnet restore
dotnet build
```

## Quick Start

### 1) Start common local MCP services (Node)

Predefined scripts in package.json:

```powershell
npm run mcp:cache-creation
npm run mcp:geo-replication-setup
```

### 2) Run Redis CLI (repository tool entry)

```powershell
npm run redis:cli
```

### 3) Start Azure DevOps MCP server (C#)

```powershell
cd azure-devops-mcp-csharp
dotnet run
```

After startup, MCP-capable clients can call:

- get-test-plans
- get-test-suites
- get-test-cases
- get-test-plan-details
- get-test-results
- get-test-runs

## Recommended Workflow

1. Use redis-e2e-workflow to parse a test case and generate a minimal
    execution plan.
2. Load atomic skills by scenario, for example:
    cache-creation -> geo-replication-setup -> portal-validation.
3. Add redis-client when data-plane validation is required.
4. Use ado-testcase-extractor when ADO plan/case integration is needed
    (depends on the C# MCP server).
5. Reuse azure-portal-reliability patterns for all Portal automation work.

## Azure Portal Automation Best Practices

- Attach to an existing Edge CDP session whenever possible; avoid launching
   duplicate browser instances.
- Use stable readiness signals (spinner gone + content stable + fingerprint
   stable) instead of fixed sleeps.
- Validate key state changes (deployment complete, blade switched, failover
   result) with observable evidence.
- For long-running steps (deployment, import/export, persistence save), use
   generous timeouts and keep execution logs.

## FAQ

### Q1: When should I use redis-e2e-workflow vs. a single skill?

- Use redis-e2e-workflow for complex or variable test scenarios.
- Use a single atomic skill when scope is clear (for example, only import/export).

### Q2: What should I check if ADO MCP returns no data?

Check the following first:

- Whether PAT is expired
- Whether PAT includes Test Management read scope
- Whether AZURE_DEVOPS_ORG and AZURE_DEVOPS_PROJECT are correct

### Q3: What should I do if Portal automation is flaky?

Check the following first:

- Whether stable selectors and iframe enumeration are used
- Whether login/session drift occurred
- Whether fixed sleeps are used without stability checks

## Contribution Guidelines

- Prefer atomic + composable design when adding new capabilities.
- In each skill doc, clearly define Use When / Do Not Use When / Required Inputs
   / validation criteria.
- Keep scripts and SKILL.md aligned to avoid documentation/implementation drift.

## Disclaimer

This repository is intended for testing and automation engineering practice.
Before execution, always verify the target subscription, resource group, and
cache name to avoid accidental operations on production resources.