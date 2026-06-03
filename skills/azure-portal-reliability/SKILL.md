---
name: azure-portal-reliability
description: "Use when: creating, modifying, or debugging Playwright automation for Azure Portal blades, deployments, iframes, custom controls, Redis cache creation, Portal navigation, or resource page validation."
---

# Azure Portal Reliability

Use this skill before writing or changing Azure Portal Playwright automation. It captures Portal-specific reliability patterns that should be reused across individual test cases.

## Selector Strategy

Prefer selectors in this order:

1. `aria-label` attributes for Portal controls and Web Components.
2. `aria-current` or `aria-selected` for active navigation and tabs.
3. Placeholder attributes for form inputs.
4. Text matching for tabs, buttons, and navigation labels.
5. Class wildcards only when they describe stable Portal shell concepts, such as `[class*="journey-layout-nav"]`.

Avoid brittle direct IDs, `nth-child` chains, pseudo-elements, and selectors that depend on transient generated class names.

## Portal Controls

For dropdowns, use a real Playwright click, type the filter text, wait for options, then click `.fxc-dropdown-option`. Keep a keyboard fallback with `ArrowDown` and `Enter`.

For toggles, read `aria-checked` before clicking. Portal toggles are often `div` elements, not native inputs.

For Web Component buttons and navigation, prefer pointer events. If locator clicks are unreliable, find the element with `evaluateHandle()`, get its bounding box, and click with `page.mouse.click(x, y)`.

## Navigation

Before clicking a resource blade navigation item:

1. Expand known sidebar groups such as `Settings`, `Administration`, `Monitoring`, `Automation`, and `Help`.
2. Scroll the target item into view inside the navigation container.
3. Click with a real pointer event.
4. Verify that the active nav, heading, URL hash, or content signature changed.
5. Retry once after re-expanding groups before marking the page failed.

## Waits

Do not treat DOM existence as page readiness. Wait for all three conditions when possible:

1. No visible Portal spinner or busy indicator.
2. Content length is above a small minimum.
3. A page fingerprint remains stable for a short period.

Common spinner selectors include `.msportalfx-busy`, `.fxs-blade-loading`, `[class*="loading-indicator"]`, `[class*="progress-indicator"]`, `.fxs-progress`, `[aria-label="Loading"]`, and `[aria-busy="true"]`.

Use a default page timeout around 15 seconds, with explicit slow-page exceptions for pages such as Private Endpoint, Virtual Network, and Geo-replication.

## Iframes

Azure Portal often renders deployment details and console experiences inside iframes. When checking for completion, errors, terminal output, or buttons, enumerate `page.frames()` in addition to the main frame.

For deployment completion, check for text such as `deployment is complete`, `your deployment is complete`, `deployment succeeded`, or a visible `Go to resource` action.

## Error Detection

Check all relevant frames for deployment failure patterns:

- `deployment failed`
- `provisioning failed`
- `operation failed`
- `operationnotallowed`
- `quotaexceeded`
- `authorizationfailed`
- `forbidden`
- `conflict`
- `canceled` or `cancelled`

For resource pages, flag common Portal errors such as `Something went wrong`, `Failed to load`, `failed to fetch`, and `An error occurred`.

## Failure Handling

Use soft recovery where possible:

- Retry navigation once before failing a page.
- Log and continue when optional toggles or screenshots fail.
- Keep screenshots best-effort so render timeouts do not crash the test.
- Use direct resource links as a fallback when `Go to resource` does not navigate.
- Mark console validation inconclusive if the input cannot be found but the resource deployment succeeded.

## Operational Defaults

Assume Portal tests may connect to an existing Edge or Chrome session through CDP, commonly `http://127.0.0.1:9222`.

Use a stable viewport such as `1600x900` for Portal resource blades unless the test specifically covers responsive behavior.

For long Azure deployments, use a soft timeout with periodic progress logging. A 60 minute timeout is reasonable for cache creation E2E tests.

## Checklist

Before finishing an Azure Portal Playwright script, confirm that it:

- Uses stable selectors first.
- Handles custom dropdowns and toggles through real interactions.
- Waits for content stability, not only fixed sleeps.
- Checks deployment and console content across frames.
- Captures screenshots safely.
- Reports pass, fail, and inconclusive states clearly.
- Keeps test-case-specific values out of this generic skill.
