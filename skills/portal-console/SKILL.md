---
name: portal-console
description: |
  Use when a test document or user request explicitly asks to open the Azure
  Cache for Redis Portal Console and run the Redis info command through the live
  Azure Portal resource blade. This skill is a standalone execution runbook for
  Portal Console validation through an Edge CDP browser session. It contains only
  step-by-step instructions and does not define automation code.
applyTo: "**"
---

# Azure Cache for Redis Portal Console Validation

## Purpose

Use this skill to verify that the Azure Cache for Redis Portal Console opens for
an existing cache resource and that the Redis `info` command can be submitted and
returns recognizable Redis server output. The agent should be able to execute this
validation by reading only this skill.

This skill does not create caches, delete caches, use redis-cli, use redis-benchmark,
run direct data-plane commands outside the Portal Console, or generate a reusable
automation script. All interaction must happen through the live Azure Portal page
attached through Edge CDP.

## Use When

Use this skill only when the test document or user request explicitly asks for one
of these outcomes:

- Open Redis Console from the Azure Portal.
- Verify Portal Redis Console works.
- Run `info` command in the Portal Console.
- Validate Redis Console access after cache creation.
- Capture screenshot evidence of the Console and `info` output.

## Do Not Use When

Do not use this skill for these tasks:

- Creating Azure Cache for Redis resources.
- General Portal blade validation. Use the portal-validation skill for blade/control
  validation.
- Running redis-cli, redis-benchmark, SET, GET, PING, INFO, or other Redis commands
  outside the Azure Portal Console.
- Verifying cache networking, keys, Entra, or management-plane settings without a
  Portal Console requirement.
- Running this as a routine post-creation step when the test document does not
  explicitly require Portal Console validation.

## Required Inputs

Confirm these values before starting. If any required value is missing, pause and
ask the user.

- CDP endpoint, usually `http://127.0.0.1:9222`.
- Subscription name or ID.
- Resource group name.
- Azure Cache for Redis resource name.
- Expected region.
- Expected SKU and size when available.
- Screenshot output folder.
- Result file path. Default to `d:\RedisAICode\skills\portal-console\resul.txt`
  unless the user specifies another `result.txt`.
- Whether to continue when Console output is inconclusive.

## Validation Outcomes

Use these statuses consistently:

- PASS: The Portal Console opened, the `info` command was submitted, and visible
  output contains recognizable Redis information such as `redis_version`, `# Server`,
  `used_memory`, or similar Redis INFO sections.
- FAIL: The Console could not be opened, the command could not be submitted, the
  page showed a blocking error, or the Console showed a clear execution failure.
- INCONCLUSIVE: The Console UI opened but no input or output could be confirmed,
  or the terminal iframe did not expose enough visible text to prove success.
- SKIPPED: The user explicitly excluded Portal Console validation or the test case
  does not apply.

## Phase 0 - Pre-Flight

1. Confirm Edge or Chrome is running with the requested CDP endpoint.
2. Connect to the live browser session through CDP.
3. Reuse an existing authenticated `ms.portal.azure.com` page when possible.
4. Confirm Azure Portal authentication. If the page is on a login, account picker,
   verification page, or only an Edge new tab, pause and ask the user to complete
   sign-in manually.
5. Confirm the target cache resource exists and has provisioning state Succeeded.
   If the cache is still Creating, Updating, Failed, or Deleted, pause and ask
   whether to wait or stop.
6. Confirm that the target cache uses a configuration where Portal Console should
   be available. If networking, firewall, authentication, or policy settings may
   block Console access, record those facts before proceeding.
7. Prepare the screenshot output folder and record its path.

## Phase 1 - Open the Cache Resource

1. Start from an existing resource Overview page when available.
2. If this validation follows cache creation, prefer the page reached by clicking
   Go to resource from the deployment blade.
3. If no resource page is open, navigate through the Azure Portal to the target
   cache resource. Direct resource URL navigation is acceptable only when the task
   starts from an already-created resource and no deployment blade handoff is being
   verified.
4. Confirm the resource page is correct before opening Console:
   - The URL or visible page route contains the target cache resource.
   - The heading or visible page text contains the cache name.
   - The page is under `ms.portal.azure.com`.
   - The page body is not only shell chrome or an empty loading state.
5. Capture a pre-console Overview screenshot if the current run needs evidence of
   the starting resource page.

## Phase 2 - Open Portal Console

1. Locate the Console entry point from the Redis resource page. It may appear as a
   top toolbar action, a command button, or a visible navigation/action labeled
   Console.
2. Use the visible Portal control named Console. Do not open redis-cli or any local
   terminal as a substitute.
3. Click Console with a real pointer action.
4. Wait for the Console experience to load. The Console may appear inside an iframe
   or terminal surface, so inspect both the main page and all child frames.
5. If a dialog, warning, or consent prompt appears, read it and decide whether it
   is safe to continue. If the prompt requires user approval or ambiguous action,
   pause and ask the user.
6. Capture a Console-opened screenshot once the terminal surface, command input, or
   loading state is visible.

## Phase 3 - Locate the Console Input

1. Search for a visible command input or terminal input surface in the main page
   and all frames.
2. Treat these as valid signs of an input target:
   - A visible text input intended for Console commands.
   - A visible textarea used by the terminal.
   - A terminal helper input.
   - A content-editable terminal area.
   - A visible textbox inside the Console iframe.
3. Exclude Portal search boxes, resource menu filters, and non-console inputs.
4. If no direct input is visible, click the visible terminal surface once and check
   whether keyboard focus moves into the Console.
5. If the Console iframe or terminal surface never appears, mark the result FAIL
   unless there is a clear transient loading state. For a transient loading state,
   retry once before failing.

## Phase 4 - Run the INFO Command

1. Focus the Console input or terminal surface.
2. Type the command `info` exactly.
3. Submit the command by pressing Enter.
4. Wait for command output to render.
5. Search the main page and all frames for Redis INFO output indicators:
   - `redis_version`
   - `# Server`
   - `used_memory`
   - `connected_clients`
   - `role:`
   - Other recognizable Redis INFO section names.
6. Capture an `info` output screenshot.
7. Do not run additional Redis commands unless the user explicitly asks.

## Phase 5 - Retry and Recovery

Use one structured retry before marking Console validation as FAIL or INCONCLUSIVE:

1. If the Console button click does not open the Console, return to the resource
   Overview and click Console once more.
2. If the terminal is visible but input is not found, click the terminal surface,
   then attempt to type `info` once.
3. If output is not visible after submission, wait for the terminal to stabilize
   and inspect all frames again.
4. If the command appears to submit but no recognizable INFO output appears, capture
   a screenshot and record INCONCLUSIVE unless the UI shows a clear error.
5. If a clear Portal or Console error appears, record FAIL with the exact visible
   error text.

Do not retry indefinitely. Do not switch to redis-cli or another data-plane path
as a fallback for this skill.

## Phase 6 - Error Detection

Check the main page and all frames for blocking errors, including:

- Something went wrong
- Failed to load
- failed to fetch
- An error occurred
- Console failed to load
- Terminal failed to load
- Connection failed
- Authentication failed
- AuthorizationFailed
- Forbidden
- Network unreachable
- Timeout
- InternalServerError
- GatewayTimeout

If an error appears, capture the visible text and screenshot before reporting the
status. If the text is historical or unrelated to the current Console surface,
record it as a note instead of a failure.

## Phase 7 - Result File Reporting

Append a Portal Console validation block to `result.txt`. Do not only print the
result in chat or terminal output. The file write is part of this skill's completion
criteria.

Use the requested result file path. If the user does not specify one, append to:

- `d:\RedisAICode\skills\portal-console\result.txt`

The appended block must include:

- Separator line `---`.
- Run date.
- Test case ID when available.
- Mode, such as Edge CDP Portal Console validation.
- Cache name.
- Subscription.
- Resource group.
- Region.
- SKU and size when available.
- Provisioning state.
- Console status: PASS, FAIL, INCONCLUSIVE, or SKIPPED.
- Console screenshot path.
- INFO output screenshot path.
- Key output evidence, such as `redis_version` or `# Server`, when visible.
- Notes for retries, prompts, frame issues, or limitations.
- Final `Overall Result` line.

After appending, immediately verify the write:

1. Re-read `result.txt`.
2. Confirm the cache name or test case ID appears in the newly appended tail.
3. Confirm the final `Overall Result` line for the Console validation block is
   present.
4. Confirm the line count increased by approximately the size of the appended
   block.

If verification fails, rebuild the result block and append it again before marking
this skill complete.

## Phase 8 - Handoff

After Console validation completes:

- If this is part of a larger cache creation workflow, return the Console status,
  screenshot paths, and INFO evidence to the caller after writing the result block.
- If the user requested only Portal Console validation, summarize the `result.txt`
  path, cache name, and overall status in chat after writing and verifying the file.
- If Console validation fails, stop and ask whether to investigate, retry manually,
  or file a bug using the captured evidence.
- Do not proceed to other Redis commands or data-plane validation unless the user
  explicitly asks.

## Execution Notes for Agents

- This skill is a runbook, not a code template.
- Do not create a new reusable automation script from this file.
- Execute through the live Edge CDP Portal session and keep interactions visible.
- Use existing workspace helpers or MCP tools only when they already cover the
  needed Portal action.
- For uncovered actions, perform the minimum necessary live CDP interaction for
  the current run.
- Keep artifacts and result entries tied to the test case ID or cache name.
