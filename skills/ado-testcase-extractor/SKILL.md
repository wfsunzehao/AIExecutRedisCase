---
name: ado-testcase-extractor
description: Extract Azure DevOps test plans, test suites, and test cases through the local azure-devops-mcp-csharp server.
allowed-tools: Bash(dotnet:*) Bash(git:*)
---

# ADO Test Case Extractor

Use this skill when the task is to inspect Azure DevOps test assets through the local MCP server instead of browsing Azure DevOps manually.

## When to use

- Need to list test plans in an Azure DevOps project
- Need to find suites under a specific test plan
- Need to fetch test cases for a whole plan or a single suite
- Need to search test cases by keyword before turning them into automation work

## Required context

- `AZURE_DEVOPS_ORG`
- `AZURE_DEVOPS_PROJECT`
- `AZURE_DEVOPS_TOKEN`
- The local MCP server must point to `azure-devops-mcp-csharp`

## Available MCP tools

- `get-test-plans`
- `get-test-suites`
- `get-test-cases`
- `get-test-plan-details`
- `get-test-results`

## Recommended workflow

1. If the plan is not known, call `get-test-plans` first.
2. If a user asks for suites, call `get-test-suites` with `planId`.
3. If a user asks for all cases in a plan, call `get-test-cases` with `planId` only.
4. If a user asks for cases in one suite, call `get-test-cases` with both `planId` and `suiteId`.
5. If a user gives a keyword, pass it through `search` instead of filtering only in prose.
6. Summarize the returned assets with IDs and names so the next step can reference them directly.

## Output expectations

- For plans: return `planId`, name, state, and root suite
- For suites: return `suiteId`, name, `parentSuite`, and `suiteType`
- For cases: return work item id, title, suite, state, priority, and automation status when available

## Failure handling

- If MCP returns auth failures, check token scope and expiration first
- If `planId` is missing, do not guess; list plans and ask the user to pick one
- If `suiteId` is missing but the user mentions a suite name, list suites first and resolve the ID
- If a plan returns no cases, clarify whether the result should be limited to a specific suite

## Example requests

- List all test plans for the current project
- Show all suites under plan `14347931`
- Get all test cases for plan `14347931`
- Search for `redis enterprise` test cases in plan `14790189`
- Get test cases for suite `14630751` in plan `14347931`