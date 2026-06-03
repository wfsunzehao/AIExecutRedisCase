---
name: portal-validation
description: |
   Use only when a test document explicitly says "Visit each of the blade and
   verify all the controls" or otherwise asks to visit each resource blade and
   verify Portal controls after an Azure Cache for Redis resource has been created.
   This skill is the standalone execution runbook for Portal page validation
   through an Edge CDP browser session. It contains the full step-by-step procedure
   and does not define automation code.
applyTo: "**"
---

# Azure Portal Resource Validation

## Purpose

Use this skill only when the source test document explicitly requires visiting
resource blades and verifying controls, such as `Visit each of the blade and
verify all the controls`. It validates that an existing Azure Cache for Redis
resource opens correctly in the Azure Portal and that expected resource blades
can be reached without Portal load errors. This skill is intentionally
independent: an agent should be able to read only this file and execute Portal
validation from an already-created resource.

This skill does not create caches, delete caches, run Redis data-plane commands,
or generate a standalone automation script. It describes the execution steps the
agent must follow through the live Edge CDP Portal session.

## Use When

Use this skill only when the test document or user request asks for one of these
outcomes:

- A test document contains the exact instruction `Visit each of the blade and
   verify all the controls`.
- A test document asks to visit each blade, verify every blade, verify all Portal
   controls, or check Overview, Access keys, Advanced settings, Authentication,
   Properties, and similar resource blades after creation.
- The user explicitly asks to validate Azure Portal resource blades or controls
   for an already-created Azure Cache for Redis resource.
- The user explicitly asks for Portal evidence screenshots for resource blades.
- The user explicitly asks for a per-blade PASS, FAIL, or INCONCLUSIVE validation
   report.

## Do Not Use When

Do not use this skill for these tasks:

- Creating Azure Cache for Redis resources. Use the cache creation skill first.
- Routine post-creation verification when the test document does not explicitly
   require visiting each blade or validating Portal controls.
- Redis Console, redis-cli, redis-benchmark, SET, GET, INFO, or any data-plane
  validation unless the user explicitly asks for it.
- Azure CLI-only validation with no Portal evidence requirement.
- Portal form filling before resource creation.

## Required Inputs

Confirm these inputs before starting. If any required value is missing, pause and
ask the user.

- CDP endpoint, usually `http://127.0.0.1:9222`.
- Subscription name or ID.
- Resource group name.
- Azure Cache for Redis resource name.
- Resource type, expected to be Azure Cache for Redis.
- Expected region.
- Expected SKU and size when available.
- List of Portal blades to validate, or approval to use the default blade list.
- Screenshot output folder.
- Result file path. Default to `d:\RedisAICode\skills\portal-validation\result.txt`
   unless the user specifies another `result.txt`.
- Whether validation should continue after individual blade failures.

## Default Blade List

When the user does not provide a page list, validate these blades in order:

1. Overview
2. Activity log
3. Access control (IAM)
4. Tags
5. Diagnose and solve problems
6. Resource visualizer
7. Events
8. Authentication
9. Advanced settings
10. Data Access Configuration
11. Scale
12. Cluster size
13. Data persistence
14. Identity
15. Schedule updates
16. Geo-replication
17. Virtual Network
18. Private Endpoint
19. Firewall
20. Properties
21. Locks
22. Import data
23. Export data
24. Reboot
25. Flush data
26. Insights
27. Alerts
28. Metrics
29. Diagnostic settings
30. Advisor recommendations
31. Workbooks
32. Resource health
33. Support + Troubleshooting

If a blade is not available for the current SKU, region, or Portal experience,
record it as INCONCLUSIVE or SKIPPED with the visible reason. Do not silently
remove it from the report.

## Validation Outcomes

Use these statuses consistently:

- PASS: The blade was opened, the page reached a stable loaded state, and no
  blocking Portal error text was found.
- FAIL: The blade could not be opened after the required retry, the page never
  reached a stable loaded state, or a blocking Portal error appeared.
- INCONCLUSIVE: The blade is unavailable, redirects unexpectedly, is blocked by
  a Portal capability limitation, or does not expose enough content to determine
  pass/fail.
- SKIPPED: The user explicitly excluded the blade or the scenario does not apply.

## Phase 0 - Pre-Flight

1. Confirm Edge or Chrome is already running with the requested CDP endpoint.
2. Connect to the live browser session through CDP.
3. Reuse an existing `ms.portal.azure.com` page when possible. Do not create a
   new Portal page if a suitable authenticated page already exists.
4. Confirm the current browser is authenticated to Azure Portal. If the visible
   page is a login page, account picker, verification page, or only an Edge new
   tab, pause and ask the user to sign in manually.
5. Confirm the target resource already exists and is expected to be validated.
   If provisioning is not Succeeded, pause and ask whether to wait or stop.
6. Set or confirm a stable viewport such as 1600 by 900 unless the test is about
   responsive layout.
7. Prepare an artifact folder for screenshots and record its path in the run log.

## Phase 1 - Open the Resource Overview

1. Prefer reaching the resource by clicking Go to resource from the deployment
   blade when this validation follows a creation workflow.
2. If the validation starts from an existing resource and no deployment blade is
   involved, open the resource Overview blade from the Portal resource URL or by
   navigating through the Portal resource group/resource list.
3. Confirm all of these before continuing:
   - The URL contains the target resource provider path for Microsoft Cache Redis.
   - The URL or visible blade route indicates Overview.
   - The page heading or body text contains the target cache name.
   - The body text is not only shell chrome or an empty loading state.
4. Capture an Overview screenshot.
5. Record Overview as PASS only after the cache name is visible and no blocking
   Portal error text is present.

## Phase 2 - Navigation Preparation

Before validating each blade, prepare the left Portal navigation:

1. Locate the resource navigation area on the left side of the blade.
2. Expand known navigation groups if they are collapsed. The common groups are
   Quick Access, Settings, Administration, Monitoring, Automation, and Help.
3. If the target item is below the visible area, scroll the navigation container,
   not the main page body, until the item is visible.
4. Use the exact visible blade name first. If the exact item cannot be found,
   allow a starts-with match only when the visible text clearly belongs to the
   target blade.
5. Use a real pointer click on the visible navigation item. Synthetic DOM clicks
   are unreliable in Azure Portal and should be a last-resort recovery only.

## Phase 3 - Open and Validate One Blade

For each blade in the selected blade list, execute this sequence:

1. Record the current page signature before clicking. The signature should include
   the current URL hash and a short sample of visible blade content.
2. Expand the navigation groups again before clicking the next blade. Azure Portal
   may collapse or re-render the sidebar between navigations.
3. Scroll the target navigation item into view.
4. Click the target navigation item with a real pointer event.
5. Wait for a navigation effect. At least one of these should change or confirm:
   - Active navigation state.
   - Blade heading.
   - URL hash or route.
   - Visible page content signature.
6. Wait for page readiness:
   - No visible Portal loading spinner or busy indicator remains.
   - The main blade content has non-trivial text.
   - The content fingerprint stays stable for a short interval.
7. Search the main page and all frames for blocking Portal errors.
8. Capture a screenshot for the blade unless screenshot capture fails after one
   retry. Screenshot failure alone should be recorded as evidence failure, not as
   a blade functional failure, unless the page is also unreadable.
9. Record the blade result with status, elapsed time if available, screenshot
   path, and any error text.

## Phase 4 - Retry and Recovery Rules

Apply these recovery rules before marking a blade as FAIL:

1. If the navigation item was not found, expand groups again and retry once.
2. If the item is still not found, scroll the navigation container from top to
   bottom once and retry the exact item match.
3. If the click appears to do nothing, click the same visible item once more after
   re-reading its bounding box.
4. If the page remains busy past the default timeout, refresh only that blade or
   re-click the navigation item once, then wait again.
5. If the resource blade redirects to another page, record the resulting URL and
   determine whether it is expected for the blade.
6. If Azure Portal shows a capability limitation, permission warning, or unsupported
   feature message, record INCONCLUSIVE unless the test specifically requires that
   blade to work.

Do not retry indefinitely. One structured retry per blade is enough unless the
user explicitly asks to keep investigating.

## Phase 5 - Error Detection

Check the main document and all frames for these blocking error patterns:

- Something went wrong
- Failed to load
- failed to fetch
- An error occurred
- Extension failed to load
- Blade failed
- Resource not found
- AuthorizationFailed
- Forbidden
- InternalServerError
- GatewayTimeout
- Conflict
- Canceled or Cancelled

When an error is found, capture the full visible text around the error when
possible and include it in the result. If the text appears in a historical log or
collapsed section while the current blade is visibly healthy, record it as a note
instead of a failure.

## Phase 6 - Slow Blade Policy

Use a normal blade timeout of about 15 seconds after click. Use a longer timeout
for these known slow blades:

- Private Endpoint: about 30 seconds.
- Virtual Network: about 25 seconds.
- Geo-replication: about 25 seconds.
- Metrics, Insights, and Workbooks may also need extra time in slow Portal sessions.

If a slow blade eventually stabilizes and has no blocking error, mark it PASS and
record that the slow timeout policy was used.

## Phase 7 - Authentication Blade Verification

When the selected blade list includes Authentication, apply these additional
checks:

1. Navigate through the left sidebar item named Authentication under Settings.
2. Confirm the blade title includes the target cache name and Authentication.
3. Capture an Authentication screenshot.
4. If the test expects Microsoft Entra Authentication disabled, confirm the blade
   does not show Entra as enabled. Cross-check through management-plane data if
   available.
5. If the test expects access keys enabled, confirm the Access keys experience is
   reachable or that management-plane data reports access key authentication is
   not disabled.
6. If the URL route shows the keys blade while the title says Authentication, use
   the visible title and page content as the source of truth and record the route
   quirk in notes.

## Phase 8 - Management-Plane Cross-Check

When Azure CLI or an equivalent management-plane tool is available, cross-check
these fields for Azure Cache for Redis:

- provisioningState is Succeeded.
- location matches the expected region.
- sku.name and sku.capacity match the expected SKU and size.
- redisVersion matches the expected version when specified.
- enableNonSslPort matches the expected Non-TLS state.
- disableAccessKeyAuthentication is false when Access Keys should be enabled.
- redisConfiguration.aadEnabled is null or false when Entra authentication should
  be disabled.

This cross-check supplements Portal validation. It does not replace the Portal
navigation and screenshot evidence when the user requested Portal validation.

## Phase 9 - Result File Reporting

For every validated resource, append a validation result block to `result.txt`.
Do not only print the result in chat. Do not leave the result only in terminal
output. The file write is part of this skill's completion criteria.

Use the requested result file path. If the user does not specify one, append to:

- `d:\RedisAICode\skills\portal-validation\result.txt`

The appended block must include this information:

- Cache name.
- Subscription.
- Resource group.
- Region.
- Expected SKU and size.
- Run date and test case ID when available.
- Portal Overview URL.
- Overview screenshot path.
- Authentication screenshot path when applicable.
- Per-blade table with status, screenshot path, and notes.
- Management-plane cross-check summary when performed.
- Overall result.

Use the same result style as existing entries in `result.txt`:

- Start with a separator line `---`.
- Include `Run Date`, `Test Case`, and `Mode` when known.
- Include one resource section per cache.
- Include a `Portal Validation` section with per-blade results.
- Include a `Management-Plane Cross-Check` section when CLI or equivalent data
   was used.
- Include `Notes` for skipped, inconclusive, capability-limited, or retried
   blades.
- End with `Overall Result: PASS`, `Overall Result: FAIL`, or
   `Overall Result: INCONCLUSIVE` and a brief reason.

The overall result is PASS only when all required blades are PASS and required
management-plane checks match expectations. If optional blades are INCONCLUSIVE,
the overall result may still be PASS with notes only when the user or test plan
allows optional exclusions.

After appending, immediately verify the write:

1. Re-read `result.txt`.
2. Confirm the newly appended test case ID or cache name appears in the tail of
    the file, not only somewhere earlier.
3. Confirm the final `Overall Result` line for this validation block is present.
4. Confirm the line count increased by approximately the size of the appended
    block.

If post-write verification fails, rebuild the result block and append it again
before marking this skill complete.

## Phase 10 - Handoff

After Portal validation completes:

- If this validation is part of a cache creation workflow, append the Portal
   validation block to `result.txt` before returning the blade results, screenshot
   paths, and management-plane cross-checks to the caller.
- If the user requested only Portal validation, still write the validation result
   to the requested `result.txt` file, then summarize the file path and overall
   status in chat.
- If any required blade failed, stop and ask whether to investigate, retry, or
  file a bug with the captured evidence.
- Do not proceed to Redis data-plane checks unless the user explicitly asks.

## Execution Notes for Agents

- This skill is a runbook, not a code template. Do not create a new reusable
  automation script from this file.
- Use existing workspace helpers or MCP tools when they already cover an action.
- For uncovered actions, execute the minimum necessary live CDP interaction for
  the current run and keep the browser visible.
- Avoid direct Overview URL shortcuts when the upstream workflow requires clicking
  Go to resource from a deployment blade.
- Keep artifacts and final results tied to the test case ID or cache name.