---
name: cache-deletion
description: |
  Step-by-step execution instructions for deleting an existing Azure Cache for Redis
  resource through the Azure Portal by clicking the Delete button on the cache
  Overview page. Use this when a test case or user request requires Portal-based
  cache deletion evidence through Playwright and Edge CDP.
applyTo: "**"
---

# Azure Cache for Redis - Portal Deletion Skill

## Purpose

Use this skill to delete an existing Azure Cache for Redis resource from the live
Azure Portal resource Overview page. The required deletion path is:

1. Open or confirm the target cache resource Overview page.
2. Click the visible **Delete** command on that Overview page.
3. Complete the Portal delete confirmation dialog.
4. Verify that the resource is deleted or no longer found.

This skill is intentionally focused on Portal deletion. It does not create caches,
run redis-cli, validate Portal blades, or perform Azure CLI-only deletion.

## Use When

Use this skill when the user or test document asks for one of these outcomes:

- Delete an Azure Cache for Redis resource from the Azure Portal.
- Use Playwright to delete a cache.
- Click the Delete button on the cache Overview page.
- Capture evidence that Portal-based deletion was initiated and completed.
- Clean up a cache after a Portal creation test when the cleanup path must be
  browser-based.

## Do Not Use When

Do not use this skill for these tasks:

- Creating Azure Cache for Redis resources. Use the cache-creation skill.
- CLI-only cleanup where Portal interaction is not required.
- Deleting a resource group, private endpoint, virtual network, DNS zone, or any
  non-Redis resource.
- Deleting a cache when the target resource name, subscription, or resource group
  is ambiguous.
- Bypassing the Portal Overview page by calling `az redis delete` as the primary
  deletion mechanism.

## Required Inputs

Confirm these values before starting. If any required value is missing, pause and
ask the user.

- CDP endpoint, usually `http://127.0.0.1:9222`.
- Subscription name or ID.
- Resource group name.
- Azure Cache for Redis resource name.
- Expected resource type: `Microsoft.Cache/Redis`.
- Expected region and SKU when available.
- Screenshot output folder.
- Result file path. Default to `d:\RedisAICode\skills\cache-deletion\result.txt`
  unless the user specifies another `result.txt`.
- Whether to wait for deletion completion or only verify that deletion was
  successfully submitted.

## Safety Rules

Follow these rules without exception:

1. Do not delete unless the visible Portal page, resource name, resource group,
   subscription, and provider path all match the requested target.
2. The primary delete action must be the Azure Portal **Delete** button on the
   target cache resource Overview page.
3. Do not use Azure CLI, REST, ARM, or direct management-plane calls to initiate
   deletion unless the user explicitly changes the requirement.
4. Azure CLI is allowed only after the Portal deletion is submitted, and only for
   verification that the target cache is deleted or no longer found.
5. Never hardcode credentials, keys, tokens, or account secrets in run notes or logs.
6. Use the live Edge CDP session as the source of truth. Do not switch to an
   embedded browser-only execution path.
7. Do not close or disconnect the real CDP browser session while performing the
   Portal action.
8. Do not create separate executable artifacts for this skill. The skill itself
   is the only execution guide.

## Validation Outcomes

Use these statuses consistently:

- PASS: The target Overview page was confirmed, the Delete button was clicked,
  the confirmation dialog was completed, and the resource was deleted or no
  longer found.
- FAIL: The target page could not be confirmed, Delete could not be clicked, the
  confirmation dialog failed, deletion reached a terminal failure, or the resource
  remained in a non-deleting terminal state.
- INCONCLUSIVE: Deletion was submitted through Portal but completion could not be
  confirmed within the requested wait window.
- SKIPPED: The user explicitly excluded deletion or the target resource was
  already deleted before Portal deletion could be performed.

## Phase 0 - Pre-Flight

1. Confirm Edge or Chrome is running with the requested CDP endpoint.
2. Connect to the live browser session through CDP.
3. Reuse an existing authenticated `ms.portal.azure.com` page when possible.
4. Confirm Azure Portal authentication. If the page is on a login page, account
   picker, verification page, or only an Edge new tab, pause and ask the user to
   complete sign-in manually.
   - Required prompt wording when auth drift is detected:
     `检测到页面跳转到登录态，请你点击登录并完成验证；完成后我会自动继续执行。`
5. Confirm the target cache exists and is not already deleted.
   - If the resource is already not found, record SKIPPED or PASS cleanup based
     on the test expectation.
   - If the resource is Creating or Updating, ask whether to wait or stop unless
     the test explicitly says to delete during that state.
6. Prepare the screenshot output folder and record its path.

## Phase 1 - Open Or Confirm Target Overview Page

1. Start from an existing cache resource Overview page when available.
2. If deletion follows cache creation, prefer the Overview page reached by clicking
   **Go to resource** from the deployment blade.
3. If no target Overview page is open and no upstream handoff is being verified,
   navigate to the target resource through the Azure Portal resource list or a
   target resource URL. Direct navigation is acceptable only to reach the target
   Overview page before clicking the Portal Delete button.
4. Confirm all of these before proceeding:
   - The page is under `ms.portal.azure.com`.
   - The visible page is a resource Overview blade.
   - The URL or visible route contains `/providers/Microsoft.Cache/Redis/`.
   - The visible page body or heading contains the exact target cache name.
   - The visible page body or resource metadata contains the expected resource
     group and subscription when available.
   - The page is not only shell chrome, a blank loading state, or an error blade.
5. Capture a pre-delete Overview screenshot.

## Phase 2 - Click The Overview Delete Button

1. Keep the browser window visible and on the target Overview page.
2. Dismiss transient overlays with Escape before searching for the Delete button.
3. Find the visible Overview command named exactly `Delete`. It must be the top
   command bar action on the cache resource Overview page.
4. Click the visible `Delete` button on the Overview command bar. This click is
   mandatory and must happen before any confirmation action.
5. Wait for the confirmation dialog titled `Delete Cache` to appear.
6. If the `Delete Cache` dialog does not appear, do not click any `OK`, `Delete`,
   or other confirmation-like button. Re-confirm that the page still shows the
   exact target cache Overview, then retry the Overview `Delete` click once.

## Phase 3 - Complete The Delete Confirmation

1. Confirm the visible dialog title is `Delete Cache`.
2. Read the dialog text and verify it says the target cache name will be deleted.
3. Leave the optional deletion survey at its default value unless the test case or
   user explicitly asks for a survey answer.
4. Do not type the cache name into the optional feedback text box. That text box
   is not a deletion confirmation field.
5. If a future Portal version explicitly asks for the resource name or a typed
   confirmation phrase, type only the exact value requested by that visible
   instruction. Do not infer a typed confirmation from the presence of a text box.
6. Click the dialog footer button named `OK`. For this Portal flow, `OK` is the
   destructive confirmation after the Overview `Delete` click.
7. Capture a screenshot after submitting the confirmation.
8. Record the visible notification text, operation status, or Portal activity
   message if one appears.

## Phase 4 - Wait For Deletion Completion

1. Watch the Portal notification or resource blade for deletion progress.
2. If the Portal returns to the resource group or shows a not-found blade, record
   that as deletion evidence.
3. Use Azure CLI only as a post-submit verification mechanism. Query the target
   cache by resource group and cache name. If the command returns not found,
   record `deleted-or-not-found`; otherwise record the returned provisioning
   state.

4. If the CLI still returns a resource, record the provisioning state:
   - `Deleting`: continue waiting if within the agreed wait window.
   - `Succeeded`: deletion was submitted but not completed; mark INCONCLUSIVE or
     FAIL based on Portal evidence and timeout.
   - `Failed`: mark FAIL and capture the visible Portal error or CLI state.
5. Do not start another deletion mechanism unless the user explicitly approves it.

## Phase 5 - Result Logging

Append a result block to the selected result file. Include:

- Run date and time.
- Mode: Edge CDP + Playwright Portal deletion from Overview.
- Subscription.
- Resource group.
- Cache name.
- Portal Overview URL.
- Pre-delete Overview screenshot path.
- Confirmation screenshot path.
- Delete submission evidence.
- Final deletion verification result.
- Overall status: PASS, FAIL, INCONCLUSIVE, or SKIPPED.

Use a result block with these fields: run date, test or task name, mode, target
subscription, resource group, cache name, resource type, Overview URL, Overview
snapshot, confirmation snapshot, Portal delete submission status, final
verification result, and overall status with a short reason.

## Execution Rule

Execute this deletion flow by following the phases in this skill directly. Keep
the document limited to procedural guidance. If a step needs browser interaction,
perform the minimum necessary live Portal interaction described by the step and
keep the browser visible.

## Common Pitfalls

| Pitfall | Required handling |
| --- | --- |
| Wrong resource page | Stop immediately. Do not click Delete until the cache name, provider path, resource group, and subscription are confirmed. |
| Delete button appears in a non-Overview context | Return to the cache Overview blade first. The required path is Overview Delete button only. |
| Confirmation dialog does not appear | Do not click OK. Re-confirm the target Overview page and click the Overview Delete button first. |
| Delete Cache dialog footer shows OK | Click OK, not another Delete button. The sequence is Overview Delete, then Delete Cache OK. |
| Optional survey feedback text box is visible | Leave it blank unless explicitly requested. It is not a cache-name confirmation field. |
| Confirmation dialog asks for typed resource name | Type the exact cache name only when the dialog explicitly asks for it. Do not type into survey or feedback fields. |
| Confirmation dialog text does not include the target cache | Stop and mark FAIL or ask the user. |
| Portal deletion is slow | Mark INCONCLUSIVE only after the agreed wait window; include the latest provisioning state. |
| CDP page list only shows login or new tab | Ask the user to sign in manually, then resume. |
| Azure CLI wait is cancelled | Run an independent not-found check for the target cache; cancellation alone is not proof of delete failure. |