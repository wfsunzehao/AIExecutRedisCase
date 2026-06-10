---
name: redis-portal
description: |
  Shared Azure Cache for Redis Portal automation helpers. Use when a test case
  needs reusable Edge CDP connection, Redis resource blade navigation, Portal
  access-key copy, visible-text click fallbacks, notification handling, or Redis
  reboot automation. This is a helper library, not an end-to-end workflow.
applyTo: "**"
---

# Redis Portal Helper Library

## Purpose

This skill provides small, composable helpers for Azure Cache for Redis Portal
operations that appear across many tests: geo-replication, import/export,
persistence, firewall, portal validation, console validation, and reboot checks.
It keeps generic Portal mechanics separate from scenario-specific workflows.

Implementation: [portal-redis-helpers.js](portal-redis-helpers.js)

Geo workflows may still import these helpers through
[../geo-replication-setup/create-geo.js](../geo-replication-setup/create-geo.js)
for backward compatibility, but new cross-test snippets should prefer this
module directly.

## Use When

Use this helper library when a test needs one or more of these reusable actions:

- Attach to an authenticated Azure Portal tab through Edge/Chrome CDP.
- Open an existing Azure Cache for Redis resource blade by direct Portal URL.
- Read visible page text or click a visible Portal element when ARIA roles are unstable.
- Close Portal notification or right-side context panes that intercept clicks.
- Copy Redis access keys from the Portal UI for data-plane setup.
- Select Redis Reboot blade ports and submit a Portal reboot.

## Do Not Use When

Do not use this library as the owner of scenario logic:

- Geo link, failover, unlink, DNS, or activity-log assertions belong to the geo skill.
- Import/export blade flows belong to the import/export skill.
- Persistence configuration flows belong to the persistence skill.
- Cache creation and deletion belong to their owning skills.
- Redis data-plane assertions belong to Redis client/data-plane helpers.

## CDP Rules

- Default endpoint: `http://127.0.0.1:9222`.
- Prefer a fresh Edge CDP profile for each execution; Chrome is fallback only when Edge cannot be used.
- Use literal `127.0.0.1`, not `localhost`.
- Do not call `browser.close()` or `browser.disconnect()` on a live CDP browser opened by the user or test harness.

## Helper Catalog

| Helper | Purpose |
|---|---|
| `connectCdpPortalPage({ cdpEndpoint?, viewport?, portalHost?, pagePredicate? })` | Connect to CDP, reuse an existing Portal page, set stable viewport. |
| `portalResourceUrl({ tenant?, subscription, resourceGroup, resourceType, resourceName, blade? })` | Build a direct Azure Portal resource blade URL for any provider resource. |
| `portalRedisUrl({ tenant?, subscription/sub, resourceGroup/rg, cache, blade? })` | Build a Redis resource blade URL. |
| `openPortalResourceBlade(...)` | Navigate a Playwright page to any Azure resource blade. |
| `openRedisBlade(...)` | Navigate a Playwright page to a Redis resource blade. |
| `visibleBodyText(page)` | Return normalized body text for lightweight assertions. |
| `clickVisibleTextElement(page, pattern, selector?)` | DOM fallback for visible text clicks when role selectors are unreliable. |
| `clickByRole(page, role, options, clickOptions?)` | Shared tolerant Playwright role click wrapper. |
| `clickByText(page, text, clickOptions?)` | Shared Playwright text click wrapper with first-match behavior. |
| `waitForVisibleText(page, text, waitOptions?)` | Wait for visible text in the Portal page. |
| `captureScreenshot(page, path, options?)` | Shared screenshot wrapper used by Portal workflows. |
| `closeNotificationsFlyout(page)` | Close the Portal Notifications flyout if it is open. |
| `closeContentPane(page, title)` | Close a right-side Portal context pane, such as `CacheKeys`. |
| `copyRedisAccessKeyFromPortal(...)` | Open Access Keys from Portal, copy a named key, and return it in memory without printing it. |
| `selectRebootPorts({ page, allPorts?, ports?, screenshotPath? })` | Select Redis Reboot blade ports and verify the visible selected count. |
| `invokeRedisReboot(...)` | Submit a Redis Reboot through visible Portal clicks. |

## Basic Invocation

```powershell
$js = @'
const portal = require("./skills/redis-portal/portal-redis-helpers.js");
(async () => {
  const { page } = await portal.connectCdpPortalPage();
  await portal.openRedisBlade({
    page,
    cache: "<cache-name>",
    subscription: "<subscription-id>",
    resourceGroup: "<resource-group>",
    blade: "overview"
  });
  console.log((await portal.visibleBodyText(page)).slice(0, 500));
})().catch(e => { console.error(e.message); process.exit(1); });
'@
node -e $js
```

## Access Keys

Use `copyRedisAccessKeyFromPortal` only when a test needs a Redis key for
subsequent data-plane validation and the key was not already provided by the
user or test harness.

```js
const key = await portal.copyRedisAccessKeyFromPortal({
  page,
  cache: "<cache-name>",
  subscription: "<subscription-id>",
  resourceGroup: "<resource-group>",
  keyLabel: "Primary key"
});
console.log(`[key] length=${key.length}`);
```

Rules:

- The helper resets the Windows clipboard to a marker before clicking Copy.
- It returns the copied key in memory and logs only key length.
- Do not print, persist, or paste the key into chat output.
- Close stale `CacheKeys` panes before navigating; the helper does this by default.

## Redis Reboot

Use `invokeRedisReboot` for tests that explicitly validate Redis reboot behavior.
It is intentionally generic and does not assume geo-replication.

```js
await portal.invokeRedisReboot({
  page,
  cache: "<cache-name>",
  subscription: "<subscription-id>",
  resourceGroup: "<resource-group>",
  allPorts: true
});
```

Rules:

- Reboot must be submitted through visible Portal clicks.
- `Port(s) to reboot` is a multi-select; options may render as `treeitem`.
- For all-port reboot, verify the page visibly shows every selected port and the selected count before clicking `Reboot`.
- Reboot confirmation uses `OK`; do not reuse failover's `Yes` confirmation logic.

## Scenario Boundary

This helper library should make workflows faster, but it should not decide what a
scenario means. The calling test skill remains responsible for sequencing,
preconditions, expected results, evidence naming, and PASS/FAIL reporting.

When adding a new Portal UI flow, put reusable Playwright primitives here first
and let scenario helpers call them. Avoid scattering raw `page.goto`,
`page.getByRole`, `page.getByText`, and `page.screenshot` calls across feature
skills unless the operation is truly scenario-specific and cannot be generalized.
