---
name: portal-bvt-basic-cache-creation
description: Validate the first Portal BVT test case for Azure Cache for Redis basic cache creation and use it as a template for similar portal test cases.
allowed-tools: Bash(dotnet:*) Bash(git:*)
---

# Portal BVT Basic Cache Creation

Use this skill when the task is to inspect, restate, or turn the first `Portal BVT` Azure DevOps test case into a clearer manual test flow, a structured checklist, or a starting point for automation.

## Source case

- Plan: `Portal BVT` (`14347931`)
- Suite: `Portal BVT` (`14347933`)
- Work item id: `14349894`
- Title: `Validate Basic Cache Creation`
- Priority: `2`
- State: `Ready`
- Automation status: `Not Automated`

## When to use

- Need a normalized version of the first `Portal BVT` test case
- Need to convert this case into cleaner manual steps
- Need to derive a Playwright or UI automation draft from the case
- Need a stable template for similar Azure portal cache creation cases

## Ground truth workflow

1. Open `https://ms.portal.azure.com/` with valid credentials.
2. Select `Create a Resource`.
3. On the new page, select `Database`, then select `Azure Cache for Redis`.
4. On the `New Redis Cache` page, configure the required settings.
5. Select `Review + Create`.
6. Select `Create`.
7. Verify the screen moves to `Deployment is in Progress` and the cache creation eventually succeeds.

## Notes about the original case

- The original ADO test case references attachments several times with `Check the attachment`.
- Attachment contents are not available from the current MCP response, so this skill should treat them as external supporting material.
- This skill should prefer explicit observable UI checks over vague references to attachments.

## Recommended workflow

1. Keep the original work item id visible in the output.
2. Rewrite the case into clean user actions and expected results.
3. Separate setup, actions, and validations instead of mixing them in one sentence.
4. If converting to automation, identify selectors, data inputs, and wait conditions.
5. If information is missing because of attachments, call that out explicitly instead of inventing steps.

## Output expectations

- Include the original ADO work item id and title.
- Return steps in imperative language.
- Mark the expected result at the final verification step.
- If producing automation guidance, include likely checkpoints such as page transition, deployment status, and successful resource creation.

## Failure handling

- If the portal flow has changed, note the mismatch and keep the original intent.
- If a required UI element is renamed, preserve the business goal and flag the label drift.
- If attachments are required to disambiguate a step, state that the current MCP output does not include them.

## Example requests

- Restate the first `Portal BVT` case into cleaner manual test steps
- Convert `Validate Basic Cache Creation` into a Playwright test outline
- Extract preconditions, actions, and expected results from work item `14349894`
- Create a reusable template for cache creation portal test cases based on the first `Portal BVT` case
