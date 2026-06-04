---
name: cache-creation
description: |
  Step-by-step execution instructions for creating an Azure Cache for Redis instance through
  the Azure Portal (ms.portal.azure.com). Covers all SKU tiers (Basic, Standard, Premium),
  tab-by-tab form filling, deployment monitoring, and creation success verification.
  Apply whenever an AI agent needs to create a Redis cache via browser automation.
applyTo: "**"
---

# Azure Cache for Redis — Portal Creation Skill

## Overview

This skill guides an AI agent through the end-to-end creation of an Azure Cache for Redis
instance via the Azure Portal. Follow each phase in order. **Do not skip phases.**
If a step is not applicable to the target configuration, mark it as skipped and continue.

Execution requirement: run the workflow with Playwright against the live Azure Portal session,
and keep actions visible in the browser while executing. Do not switch this workflow to CLI-only
creation when the request is to execute portal steps.

Scope guard for this repo workflow: this skill covers cache creation, creation verification,
and management-plane geo-replication link setup when the test case explicitly requires it.
Do not execute cache deletion flow and do not execute redis-cli data-plane validation as part of this skill run.

Execution mode for this repo: run directly against the live Azure Portal session through
Edge CDP (`--remote-debugging-port=9222`) without creating temp automation scripts in `%TEMP%`.
Use step-by-step interactive execution and validation aligned to this document.

**Entry URL:** `https://ms.portal.azure.com/#create/Microsoft.Cache.redis`
**Supported SKUs:** Basic (C series), Standard (C series), Premium (P series)

---

## Phase 0 — Pre-flight Checks

1. **Confirm browser session is active.** Verify the Edge browser with CDP is reachable at
   `http://127.0.0.1:9222`. If unreachable, stop and report the error.

   - Access policy: use CDP-attached Edge pages as the source of truth for navigation and
     interaction; do not switch to embedded browser-only execution for this workflow.

2. **Confirm Azure authentication.** Check that the current portal URL is under
   `ms.portal.azure.com`. If the page is on a login/AAD URL, stop and ask the user to
   sign in before proceeding.
    - If an account picker or any login verification page is shown, prompt the user to
       manually complete sign-in/verification in the browser.
      - Required prompt wording when auth drift is detected:
        "检测到页面跳转到登录态，请你点击登录并完成验证；完成后我会自动继续执行。"
    - Resume only after the page returns to `ms.portal.azure.com`.
      - CDP-specific check: if pages are only `edge://new-tab...` and/or
         `login.microsoftonline.com/...`, treat session as not ready. Do not continue to Basics
         until a real `https://ms.portal.azure.com/#create/Microsoft.Cache.redis` page is visible.
      - After user confirms portal is restored, restart from Phase 1 and continue the same run
         (do not mark as final failure unless login cannot be restored).

3. **Confirm input parameters are complete** before navigating. Required fields:
   - Subscription name or ID
   - Resource Group name (must exist, or confirm auto-create is intended)
   - Azure Region
   - Cache Type (Basic / Standard / Premium)
   - Cache Size (e.g. C0, C1, P1)
   - Network Access (Public / Private Endpoint)
   - Non-TLS Port enabled? (true/false)
   - Entra ID Authentication enabled? (true/false)
   - Access Keys Authentication enabled? (true/false)
   - Redis Version (4 / 6)
   - Minimum TLS Version (1.0 / 1.1 / 1.2)
   - Geo-replication topology when applicable: selected test cache region,
     selected geo pair / linked-cache region, primary/secondary direction, and
     one unique cache name per cache resource.

    **Cache Type inference rule (mandatory):** If the test document does not explicitly
    name `Cache Type` / SKU tier but uses a P-series size such as `P1`, `P2`, `P3`,
    `P4`, or `P5`, infer `Cache Type = Premium` and `Cache Size = <that P-size>`.
    If the test document asks for Premium-only capabilities such as availability zones,
    zone redundancy, replica count, clustering, or shard count but omits Cache Type,
    infer `Cache Type = Premium`. If the Premium-only capability is specified but no
    P-series size is provided, stop and ask for the intended Premium size instead of
    falling back to Standard or accepting the portal default.

4. **Ask before expanding geo-replication test topology.**
   When a test case says `geo-replicated`, `geo-primary`, `geo-secondary`, or
   `Create a geo-replication link`, pause before naming or creating caches and ask
   both geo topology questions below. Do not create either cache until both answers
   are explicit.
   - Required question 1: `Geo-replication 测试 cache 要创建在哪个测试地区？`
   - Required question 2: `Geo-replication pair/linked cache 要创建在哪个地区？`
   - Present known EUAP choices when applicable for each question: `Central US EUAP`,
     `East US 2 EUAP`, or `Both regions`.
   - The answer to question 1 selects the region(s) for the test cache resource(s).
     The answer to question 2 selects the region(s) for the linked cache resource(s).
     Never infer the linked-cache region solely from the test-cache region unless the
     user explicitly says to use the other region.
   - If the user selects one test region and one linked-cache region, create exactly
     one pair: one cache in the selected test region and one linked cache in the
     selected pair region with identical configuration before creating the link.
   - If the user selects `Both regions` for test caches, ask or confirm the linked-cache
     region for each selected test region. Example confirmed mapping:
     `Central US EUAP -> East US 2 EUAP` and `East US 2 EUAP -> Central US EUAP`
     means **four** caches total.
   - Do not infer `Both regions` or the linked-cache mapping from the CSV alone. The
     CSV may list multiple regions as available test coverage, but the agent must ask
     which test cache region(s) and which linked-cache region(s) to create for the
     current run.
   - All caches in a pair must match the requested SKU, size, shard count, auth,
     Redis version, network access, and other Premium settings before linking.
   - Record pair identity explicitly in logs and result.txt (for example:
     `central-test primary -> east-linked secondary`).

5. **Check for existing cache** with the same name using `az redis show`. If the cache
   already exists and is in `Succeeded` state, skip to Phase 8.

---

## Phase 1 — Navigate to Create Form

1. **Open/reuse the creation page through CDP** (reuse existing `ms.portal.azure.com` page first,
   open a new page only if no portal page exists), then navigate to:
   `https://ms.portal.azure.com/#create/Microsoft.Cache.redis`

2. **Wait for the Basics form to be ready.** The reliable anchor element is the
   Resource Group field labeled "Create new or use existing Resource group". Do not
   interact with any field until this element is visible on screen. Allow up to 60 seconds.

3. **After the anchor is visible, wait an additional 3 seconds** for the SPA shell to
   finish hydrating before starting input.

4. **Dismiss any dialog or popup** that appears (e.g. "You have unsaved changes"). Always
   dismiss automatically without user intervention.

---

## Phase 2 — Basics Tab

Fill fields in this exact order. **Order matters** — some fields reset others.

1. **Subscription** — If not already set to the target subscription, open the Subscription
   dropdown and select the correct subscription. Wait 1.2 seconds after selection.

2. **Region** — **Fill Region before Resource Group and DNS Name.** Open the Region/Location dropdown,
   type the region name to filter, then select the matching option. Wait 1.2 seconds.
   After typing/filtering, explicitly click the Region option in the dropdown list to
   commit the selection (do not rely on typed search text alone).
   > Known regions for EUAP testing: `Central US EUAP`, `East US 2 EUAP`

3. **Resource Group** — Open the Resource Group dropdown and select the target RG.
   If it does not exist, click "Create new" and type the name. Wait 1.2 seconds after selection.
   > Region changes can re-render Basics and clear RG. After Region is selected, always re-select RG, and
   > after typing/filtering the RG name, explicitly click the RG option in the dropdown list to commit it.

4. **Cache Name (DNS Name)** — Click the DNS name input field, then use `page.keyboard.type(name)` to type the cache name. Do **not** call `pressSequentially` on an ElementHandle — it does not exist; use the Locator API or `page.keyboard.type()` after clicking.
   - Do not use global `Control+A` on the page while editing Basics fields.

5. **Cache Type (SKU)** — Open the Cache Type dropdown and select the SKU
   (e.g. "Standard"). **After selecting Cache Type, wait 2 seconds** before touching
   Cache Size — the size options reload asynchronously.
   - **Mandatory inference before selection:** if the source test says `P1 cache`,
     `P2 cache`, etc., select `Premium` even if the phrase `Cache Type = Premium`
     does not appear. P-series cache sizes are Premium SKU sizes.
   - If the source test requires availability zones, zone redundancy, replica count,
     clustering, or shard count and does not explicitly specify Cache Type, select
     `Premium`; do not leave the portal default or any previous `Standard` value in place.

6. **Cache Size** — Open the Cache Size dropdown and select the target size (e.g. "C0").
   **Use `pickDDNoType(page, dd, "P1", label)`** (not `pickDD`) — the size dropdown does not
   support text filtering; typing causes the option click to be skipped. `pickDDNoType` opens
   the dropdown, reads all visible option bounding rects via `page.evaluate()`, and clicks the
   matching option directly with `page.mouse.click(x, y)`. Wait 1.2 seconds after selection.

7. **Verify all Basics fields** before proceeding: read back each field's displayed value
   and confirm it matches the target. If any field is wrong, re-apply only that field.
   - Region verification is mandatory: if Region does not equal target value,
   re-open Region dropdown, type/filter, and click the Region option again.
   - RG verification is mandatory: if the value is empty or not equal to target RG,
   open RG dropdown again, type/filter RG, and click the RG option again.
    - Cache Type verification is mandatory: if a P-series size or Premium-only capability
       inferred `Premium`, the displayed Cache Type must contain `Premium` before leaving
       Basics. If it shows `Standard` or any other tier, re-open Cache Type and click
       `Premium` again.
   - Region/Size verification is mandatory: if Review later shows fallback values
     (for example `Location = East US` or `Cache size = C1`), treat this as
     "search typed but selection not committed" and re-open dropdowns to click the
     exact target options again.
   - Size verification is mandatory: ensure review value is exactly the target size (e.g. `C0`, `P1`).
    - **Fail-fast gate:** do not proceed to Networking or Advanced if Region, Resource Group,
       Cache Type, or Cache Size are empty or differ from the inferred target configuration.
       Premium-only controls missing on Advanced must be treated as a Basics misconfiguration
       until Cache Type and Cache Size have been re-read as `Premium` / the target P-size.

8. **Click the "Next: Networking >" button** (or the Networking tab) to advance.
   Wait 2 seconds for the tab to render.

---

## Phase 3 — Networking Tab

> **Rule:** If the test document does not explicitly specify a network type, **always
> explicitly select "Public endpoint"**. Do not rely on the default — always click the
> option to confirm the selection and avoid validation failures.

1. **Select Network Access type.**
   - If `Public` (or not specified): call `choosePublicEndpoint(page)` from
     [skills/cache-creation/create-cache.js](create-cache.js). The function scans all visible
     `[role="radio"]`, `[role="option"]`, `label`, and `button` elements for one whose trimmed
     text starts with `"Public endpoint"`, scrolls it into view, and clicks at the center of its
     bounding rect via `page.mouse.click(x, y)`. Wait 1 second after clicking.
   - **Do not** use `page.locator("text=Public endpoint")` — that selector matches container
     divs and has no effect on the actual selection state.
   - If `Private Endpoint`: select the "Private endpoint" radio using the same bounding-box
     click pattern. Wait 2 seconds for the Private Endpoint section to appear.

2. **If Private Endpoint is required:**
   a. Click "Add" to open the Create Private Endpoint side panel.
   b. In the panel, fill: Subscription, Resource Group, Location, Name, Target sub-resource.
      - **Private endpoint panel frame rule:** the form is rendered in a transient non-main
        React blade iframe. Its frame URL may be blank (`""`) or `sandbox-*.reactblade-ms.portal.azure.net`.
        Do not require a sandbox URL. Identify the active frame by body text containing
        `Configure virtual network` and `Private DNS integration`, and re-locate it before each
        operation because the portal can detach/recreate the frame between clicks.
      - **Resource Group and Region are not inherited reliably.** The panel can default to
        `Resource group = ak` and `Location = (US) East US` even when Basics is already set
        correctly. Always explicitly set Resource Group and Region inside the private endpoint
        panel before selecting VNet.
      - **Region option text includes geography prefixes.** For EUAP regions, click the visible
        option containing `(US) Central US EUAP` or `(US) East US 2 EUAP`. Matching only
        `Central US EUAP` / `East US 2 EUAP` as exact text can fail because the actual option
        text includes the `(US)` prefix.
   c. Fill VNet and Subnet (wait 2.5 seconds after VNet selection for Subnet list to load).
      - VNet dropdown options depend on the private endpoint panel's Resource Group and Region.
        If the target VNet is missing, first re-check the panel RG/Region rather than selecting
        an older similarly named VNet. Do not continue with stale values such as an unrelated
        VNet/subnet from a previous run.
   d. **Enable Private DNS Integration (mandatory).** The checkbox labeled
      `Enable Private DNS Integration` must be checked before clicking Add. After checking it,
      verify that the panel shows Private DNS zone `(new) privatelink.redis.cache.windows.net`
      or `privatelink.redis.cache.windows.net`. If a private endpoint row was added with DNS
      disabled or the table does not show the DNS zone, delete that row and re-create it; do not
      proceed to Advanced/Review with DNS missing.
   e. Click **Add** to close the panel. Wait 2 seconds, then verify the private endpoint table
      contains the PE name, correct RG, correct region, target subnet, and Private DNS Zone
      `privatelink.redis.cache.windows.net` before continuing.

3. **If VNet injection is required** (enabled by `?feature.vnetInjectedCacheCreation=true` feature flag):
   - **Pre-step — Query or create the VNet via CLI before filling the portal form:**
     Call `queryOrCreateVNet(resourceGroup, location, vnetName, subnetName)` from
     [skills/cache-creation/create-cache.js](create-cache.js). This function:
     1. Runs `az network vnet list --resource-group <RG> --query "[?name=='<name>']"` to check
        if the VNet already exists.
     2. If found, returns `{ vnetName, subnetName }` using the first available subnet.
     3. If not found, runs `az network vnet create` with address prefix `10.0.0.0/16` and
        subnet prefix `10.0.0.0/24`, then returns `{ vnetName, subnetName, created: true }`.
     - VNet naming convention: `vnet-{region-short}-euap-{MMDD}` (same format as cache name).
     - Subnet name: `default` unless specified.
     - Run this check for **each region** before navigating to its Networking tab.
     - If creation fails (e.g. missing permissions), stop and report the error; do not proceed.
   - The feature flag **must** appear in the URL query string **before** the `#`, e.g.
     `https://ms.portal.azure.com/?feature.vnetInjectedCacheCreation=true#create/Microsoft.Cache.redis`.
     Placing it after `#` makes it part of the hash fragment — the portal SPA does **not** read
     `window.location.search` from a hash and the third option will not appear.
   - Two-step navigation: define `BASE_URL = "https://ms.portal.azure.com/?feature.vnetInjectedCacheCreation=true"` and `FULL_URL = BASE_URL + "#create/Microsoft.Cache.redis"`. First `goto(BASE_URL)` (no hash) and wait for the portal homepage to load, then `goto(FULL_URL)` to navigate to the creation form. This ensures the SPA reads the feature flag from `window.location.search` before routing.
   - The third networking radio option text **starts with** `"Virtual network"` or
     `"Azure Virtual Network"`. Use a `startsWith` check — **never** `includes` — because
     the "Private Endpoint" option's full text also contains `"virtual networks"` as a
     substring and will cause a false match.
   - After clicking the VNet injection radio, wait 2 seconds for VNet/Subnet dropdowns to render.
   - Select the target VNet using the `azc-formControl[aria-haspopup='dialog']` dropdown
     whose nearest ancestor `label` or `.azc-formElementLabel` contains `"Virtual network"`.
   - After VNet selection, wait 2.5 seconds for the Subnet list to populate.
   - **Subnet must be explicitly expanded and clicked** — do not assume it is pre-selected even
     if the dropdown already shows a value (e.g. `"default (undefined)"`). Always:
     1. Identify the subnet dropdown (the 2nd `div.azc-formControl[aria-haspopup='dialog']` on
        the Networking tab, at index `[1]` among visible `aria-haspopup` controls).
     2. Click to open it via `page.mouse.click(x, y)` from its bounding rect.
     3. Wait 1.2 seconds for the option list to render.
     4. Find the option matching `"default"` (or `"default (10.0.0.0/24)"`), get its bounding
        rect, and click with `page.mouse.click(x, y)`.
     5. Verify the dropdown now shows the selected subnet (e.g. `"default (10.0.0.0/24)"`).
     - Skipping this step leaves the subnet unset and will cause validation failure.

4. If network access is Public, there are no further fields on this tab.

    - **Mandatory auth coupling for Public endpoint:** when `Public endpoint` is selected,
       the target authentication state must be treated as:
       - `Microsoft Entra Authentication` = `Disabled`
       - `Access Keys Authentication` = `Enabled`
       This is an explicit linked configuration for this workflow, not an optional default.
       Carry this requirement into Phase 4 even if the source test case does not restate it.

5. **Click the "Next: Advanced >" button** to advance. Wait 2 seconds.

---

## Phase 4 — Advanced Tab

> **Mandatory toggle procedure (applies to every aria-label checkbox in this phase: Non-TLS,
> Entra Auth, Access Keys, Clustering).** Use the `setToggle()` helper in `create-cache.js`,
> which already implements this. If writing inline DOM code, follow these six steps in order
> — skipping any one of them is what caused prior runs to leave Access Keys Disabled:
>
> 1. `querySelectorAll('[aria-label="..."]')` — never the singular `querySelector`.
> 2. Filter to the **visible-in-viewport** instance (`display!=none`, `visibility!=hidden`,
>    `width/height>4`, `0 < y < window.innerHeight`). Hidden duplicates report stale
>    `aria-checked` values and must be excluded from both reads and clicks.
> 3. `scrollIntoView({block:'center', behavior:'instant'})` on the visible instance, then
>    wait 200 ms and re-read `getBoundingClientRect()`.
> 4. If `0 < rect.y < innerHeight`, click via `page.mouse.click(rect.cx, rect.cy)`. If `y`
>    is still ≤ 0 after scroll, use `visibleEl.click()` inside `page.evaluate()` as last-
>    resort fallback — but still on the **visible** instance, not `querySelector(...)`.
> 5. Re-read `aria-checked` on the visible instance and confirm it matches the target.
> 6. Before clicking any footer/tab button (e.g. `Next : Tags >`, `Review + create`), call
>    `dismissOverlays()` (Escape×4) and use `clickFooterByText()` — never
>    `page.mouse.click(x,y)` for footer/tab navigation, because their `rect.y` is often
>    ≤ 0 when content is scrolled and a coordinate click hits the top header / waffle menu.
>
> **Auth toggle ORDER (mandatory when both Entra=ON and Keys=OFF initially):** enable
> `Access Keys Authentication` **first**, then disable `Microsoft Entra Authentication`.
> The portal blocks any change that would leave zero auth methods enabled, so disabling
> Entra before enabling Keys is silently rejected and the Advanced tab ends with Keys=OFF,
> Entra=ON — the exact failure mode seen in prior TC15319116 runs.
>
> **Re-ensure Advanced tab before any Advanced edit.** If the page may have navigated to
> Review or Tags (e.g. mid-run correction), call `ensureAdvancedTab(page)` first — it
> DOM-clicks the `[role=tab]` with text `"Advanced"`. Editing Advanced controls while
> another tab is active fails with "element is not visible".

1. **Redis Version** — **No action needed.** Redis 6 is the default for Premium caches in the
   current portal form. There is no visible version selector to interact with; skip this step.


2. **Non-TLS Port** — Read the current toggle state via `aria-checked`.
   - Target ON: if `aria-checked` is `"false"`, click the toggle. Wait 0.8 seconds.
   - Target OFF: if `aria-checked` is `"true"`, click the toggle. Wait 0.8 seconds.
   - Always verify the state after clicking before moving on.
   - **Exact `aria-label`**: `"Non-TLS port Enable"` — pass this string to `setToggle()`.
   - **Selector:** use `document.querySelector('[aria-label="Non-TLS port Enable"]')` to locate the element in the DOM regardless of scroll position. Do **not** use label-text DOM traversal as the primary approach — it silently returns empty when the element is off-screen.
   - **Scroll before click:** after finding the element via `aria-label`, call `element.scrollIntoView({ block: "center", behavior: "instant" })` inside `page.evaluate()`, wait 200 ms, then re-query bounding rect. If `rect.y ≤ 0` or `rect.y ≥ window.innerHeight`, scroll the nearest scrollable ancestor and retry. **Never** call `page.mouse.click(x, y)` when `y ≤ 0`.
   - **Default (when test case does not specify):** Enable Non-TLS port (`wantEnabled = true`). Always call `setToggle` regardless — do not skip.

3. **Entra ID Authentication** — Read `aria-checked` on the Entra auth toggle.
   Apply the same read → compare → click → verify pattern as Non-TLS Port.
   - **Exact `aria-label`**: `"Microsoft Entra Authentication Enable"`.
   - **Selector:** `document.querySelector('[aria-label="Microsoft Entra Authentication Enable"]')` — same scroll-before-click pattern as Non-TLS Port.
   - **Public endpoint coupling:** if Phase 3 selected `Public endpoint`, Entra Authentication
     must be forced to `Disabled` regardless of any unspecified/implicit test defaults.
   - **Default (when test case does not specify):** Disable Entra Authentication (`wantEnabled = false`).

4. **Access Keys Authentication** — Read `aria-checked` on the Access Keys toggle.
   Apply the same read → compare → click → verify pattern.
   - **Exact `aria-label`**: `"Access Keys Authentication Enable"` — note the **plural `Keys`** (with `s`).
     Using `"Access Key Authentication Enable"` (no `s`) will silently fail with WARN toggle not found,
     leaving Access Keys Disabled. Always use the plural form.
   - **Selector:** `document.querySelector('[aria-label="Access Keys Authentication Enable"]')` — same scroll-before-click pattern.
    - **Public endpoint coupling:** if Phase 3 selected `Public endpoint`, Access Keys Authentication
       must be forced to `Enabled` regardless of any unspecified/implicit test defaults.
    - **Off-screen fallback:** if the element is found in the DOM but its bounding rect still resolves to
       `y <= 0` after normal scroll recovery, the control may be mounted inside an internal portal layout that
       does not expose a usable viewport click target. In that case, use `document.querySelector(...).click()`
       inside `page.evaluate()` as a last-resort fallback, then re-read `aria-checked` immediately. Do not assume
       the toggle changed unless the post-click verification reads `"true"`.
      - **Duplicate-instance guard (mandatory):** the portal can render multiple elements with
         `aria-label="Access Keys Authentication Enable"` at once (hidden + visible copies).
         Never rely on a single `document.querySelector(...)` result for final state.
         Use `querySelectorAll(...)` and select the **visible in-viewport** instance first
         (`display != none`, `visibility != hidden`, `width/height > 4`, `0 < y < window.innerHeight`).
         If no in-viewport instance exists, scroll and retry before deciding the final value.
   > Note: Entra Auth and Access Keys Auth may be linked — disabling Entra Auth
   > may automatically re-enable Access Keys. Re-verify both after any change.
   - **Default (when test case does not specify):** Enable Access Keys Authentication (`wantEnabled = true`). Always call `setToggle` — never skip this step.

5. **Minimum TLS Version** — There is **no separate "Minimum TLS Version" dropdown** on the
   current portal creation form. The TLS-related control is the **Non-TLS Port** toggle
   (item #2 above). Ensure Non-TLS port is set per test requirements and skip any search
   for a standalone TLS version dropdown.

6. **Premium-only settings** (skip for Basic/Standard):
   - Clustering: if required, enable and set shard count.
         - **Premium Persistence AOF/RDB test convention:** for ADO-style
            clustered + non-clustered persistence cases, create the clustered cache
            as `Premium / P1` with `Clustering Enable = true` and `Shard count = 2`;
            create the default/non-clustered cache as `Premium / P1` with
            `Clustering Disabled`. Both caches must use `Public endpoint`,
            `Non-TLS port Enabled`, `Microsoft Entra Authentication Disabled`, and
            `Access Keys Authentication Enabled` so `redis-benchmark.exe` and
            `redis-cli.exe` can validate port 6379 with access keys.
   - Replication: if required, set replica count. Fill shard count before replica count.
    - Geo-replication: if required, first ensure the user-confirmed topology from
       Phase 0 exists, including both the test cache region and the geo pair / linked-cache
       region for every pair. Do not attempt to create a geo-replication link until both
       caches in the pair have reached `Succeeded`, are Premium, have identical
       configuration, and have the requested cluster shard count committed. For
       multi-region geo-replication tests, create all user-selected pair caches first;
       create four cache resources only when the user selected or confirmed two test
       regions and a linked-cache region for each one.
    - Persistence (RDB / AOF): configure if required.
       - **Prerequisite:** do not attempt to enable `Redis Database (RDB)` or `Append-only file (AOF)` unless the
          required storage account information is explicitly available for the run. At minimum, confirm the target
          storage account selection before proceeding.
       - If the test/request says `RDB 15 min` (or similar) but no storage account is provided, stop and ask the
          user which storage account should be used. Do not guess and do not continue to Review with persistence left
          partially configured.
       - **Storage Account exact-selection rule (mandatory):**
         1. Click the **Storage Account** dropdown itself (do not rely on typed filter text only).
         2. Type/filter the target account name.
         3. Explicitly click the matching option row in the dropdown list to commit selection.
         4. Re-read the Storage Account dropdown value on Advanced and confirm exact match.
         5. After navigating to Review, verify the summary still shows the same target Storage Account.
         If either Advanced or Review does not match, return to Advanced and re-apply.
          - **Storage Account locator guard (mandatory):**
             - Storage Account dropdown must be located by its field label only:
                nearest `label` / `.azc-formElementLabel` text must match
                `Storage Account` or `First Storage Account`.
             - Do not infer Storage Account dropdown by value-pattern matching.
             - Explicitly exclude helper/status text (for example:
                `Zone enabled caches are not yet available in the region`) from dropdown
                candidate detection. That text is not a field value and must never be used
                as a selection anchor.
             - If the labeled Storage Account dropdown is not found, stop and report
                `Storage Account control not found` instead of falling back to heuristic picks.
   - **Availability Zones** — exact interaction sequence (learned from manual execution):
     1. Locate the `div[role="combobox"]` whose visible text is "Allocate zones automatically"
        inside the Advanced tab panel. Use `getBoundingClientRect()` to get its center `(x, y)`.
     2. Call `await page.mouse.click(x, y)` — **never** `element.click()` or `evaluate().click()`
        — to open the zone dropdown. Wait 800 ms.
     3. For each target zone number (e.g. `"1"`, `"2"`): locate the visible dropdown option
        whose trimmed text equals the zone number or "Zone N". Get its bounding-box center
        and call `await page.mouse.click(x, y)`. Wait 400 ms between each zone click.
     4. Close the dropdown with `await page.keyboard.press("Escape")`.
     5. Read back the combobox text to confirm the selection is committed
        (e.g. contains "1, 2" or the zone numbers). If not committed, retry from step 1.
     6. Capability conflict rule: if the page text contains
        "Zone enabled caches are not yet available in the region", stop immediately
        and ask the user to confirm next action. Do not guess or silently continue.
    - **Replica count / Shard count slider inputs** — when the blade shows "Replica count" or `Shard count`:
       1. **Input type guard (mandatory):** Azure slider numeric inputs are `<input type="text">` with class `azc-input azc-formControl azc-validation-border`, **not** `type="number"` and **not** `role="spinbutton"`. Querying only `input[type="number"]` or `[role="spinbutton"]` returns nothing and the helper silently no-ops, leaving the slider at its default.
       2. **aria-label match (mandatory):** the aria-label has a **leading space** and the form `" slider value Type a number between <min> and <max> for the slider"`. Match by regex on the substring `"between <min> and <max> for the slider"`, not by exact equality.
       3. **Field-label disambiguation is mandatory:** `Shard count` and `Replica count` can both be visible, and `Replica count` often has aria range `between 1 and 3`. Do **not** set shard count by the generic range regex alone; doing so can set replicas to `2` while leaving `shardCount=1`.
       4. Selection strategy: use `setNumberByFieldLabel(page, "Shard count", value)` for shard count and `setNumberByFieldLabel(page, "Replica count", value)` for replica count. The helper locates the visible field label first, then chooses the nearby slider input.
       5. If using `setNumberByAriaRange()`, use it only after field-label scoped selection is impossible and record why; never include `between 1 and 3` in a shard-count regex because that matches replica count.
       6. Commit value via the native setter: `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(target, String(value))` followed by dispatching `input`, `change`, and `blur` events. A plain `target.value = ...` assignment is dropped by the React-backed control and the slider does not move.
       7. Read back the displayed value and verify before proceeding. Use `setNumberByFieldLabel()` from `create-cache.js` for both shard and replica sliders. It encodes the label lookup, native setter, and event dispatch.
       8. After Review/Create, CLI verification must confirm the intended values, especially `shardCount` for clustered geo-replication tests. If `replicasPerPrimary=2` but `shardCount=1`, the run is misconfigured and must not proceed to geo-link creation.

7. **Final Advanced-tab invariant check (mandatory before leaving the tab).**
   Do not treat auth toggles as a one-time early setup only. After **all** Advanced-tab edits are done
   (including clustering, replica/shard count, persistence, storage-account selection, and any portal refresh
   or re-render), re-read the final state of these four controls before proceeding:
   - `Non-TLS port`
   - `Microsoft Entra Authentication`
   - `Access Keys Authentication`
   - `Clustering` (when clustering is part of the target config)

   If `Public endpoint` was selected in Phase 3, the final required auth state is:
   - `Non-TLS port` = `Enabled` when required by the test case
   - `Microsoft Entra Authentication` = `Disabled`
   - `Access Keys Authentication` = `Enabled`

   **Why this extra check is mandatory:** later Advanced-tab actions can cause the portal to re-render,
   silently revert, or partially desynchronize these toggles. In particular, persistence-related changes and
   storage-account configuration may leave the earlier auth coupling no longer reflected in the final UI state.
   Do not leave the Advanced tab until the post-edit verification confirms the final target state.

   **Review cross-check (required):** after moving to `Review + create`, confirm the summary text shows:
   - `Non-TLS port` = `Enabled` (when required)
   - `Microsoft Entra Authentication` = `Disabled`
   - `Access Keys Authentication` = `Enabled`
    - `Clustering` = `Enabled` and `Shard count` = requested value for clustered
       persistence tests, or `Clustering Disabled` for default/non-clustered
       persistence tests
   If Review still shows `Access Keys Authentication Disabled`, return to Advanced and re-apply the toggle
   using the duplicate-instance guard above.

8. **Click the "Next: Tags >" button** to advance. Wait 2 seconds.

---

## Phase 5 — Tags Tab (Optional)

1. If tags are required, click the Name input and type the tag key, press Tab, type the value.
   Repeat for each tag.

2. If no tags are required, proceed immediately.

3. **Click the "Next: Review + create >" button** to advance. Wait 2 seconds.

---

## Phase 6 — Review + Create

1. **Capture a Review snapshot immediately after entering this page** (before any Create click).
   - Required snapshot content: full Review viewport including summary fields and validation area.
   - Required metadata in log/filename: cache name, region, timestamp.
   - If snapshot capture fails, retry once; if still failing, mark run as FAIL and stop.

2. **Wait for validation to complete.** The "Create" button becomes active only after
   Azure validates the configuration. Wait up to 30 seconds for the green "Validation passed"
   banner or for the "Create" button to become enabled.

3. **If validation fails:** read the error message, report it, and stop. Do not click Create.

4. **Verify the summary** by reading the key fields shown on the Review page:
   - Cache name, Subscription, Resource Group, Location, SKU, Size, Redis version.
   If any field differs from the target configuration, go back and correct it.

5. **Click "Create"** to start deployment. Note the timestamp.

   **Portal Create command fallback (mandatory):** the Review page's `Create`
   command is not always exposed as a normal `button:has-text("Create")`.
   If the regular button locator does not become clickable after validation
   passes, do not switch to CLI/ARM creation. Instead:
   1. Confirm the page text shows `Validation passed.` and the Review summary
      still matches the target configuration.
   2. Find a visible Portal command/text node whose normalized text is exactly
      `Create` or whose accessible label is `Create`.
   3. Scroll that visible element into view, read its bounding box, and click
      the center point with `page.mouse.click(x, y)`.
   4. Verify submission by visible Portal evidence such as
      `Submitting deployment...`, `Deployment in progress`, or navigation to a
      `DeploymentDetails` blade.
   5. If the fallback click cannot find or submit the visible command, pause and
      ask the user to click **Create** manually in the Portal, then resume only
      after deployment evidence is visible.

---

## Phase 7 — Deployment Monitoring

> **Parallel creation:** When creating multiple caches (e.g., two regions), submit each cache
> on a **separate browser page** via `ctx.newPage()`. Start the second creation *while the first
> is already deploying*. Each page operates independently — keyboard/click events are page-scoped.
> Do NOT share a single page across two concurrent form fills.
>
> For multi-region test cases: run each target cache resource in parallel, one page per cache.
> If a cache resource is already `Succeeded`, continue only the remaining caches and record
> that the parallel target was partially pre-completed.
>
> For geo-replication test cases, first ask both: where the test cache should be created,
> and where the geo pair / linked cache should be created. Expand only the user-confirmed
> mapping into cache resources. If the user confirms one mapping, create one pair (two
> cache resources). If the user confirms mappings for both regions, create two pairs
> (commonly four cache resources). Allocate one page per cache resource and track every
> cache independently.

### Parallel Execution Guard

Apply this guard whenever a test case requires creating multiple cache resources in the same run, to prevent "only one region/cache executed":

1. Create/assign one dedicated page per target cache resource before filling any forms:
   - e.g. `Page-A` for region A primary, `Page-B` for region B linked cache,
     `Page-C` for region B primary, `Page-D` for region A linked cache.
2. Maintain independent status for each cache resource:
   - `NotStarted` -> `BasicsDone` -> `ReviewReady` -> `CreateClicked` -> `Deploying` -> `Succeeded/Failed`
3. Do not reuse one page for multiple cache resources during the same run.
4. Do not stop after the first cache reaches `CreateClicked`; every remaining cache must also reach
   at least `CreateClicked` unless there is a global blocker (auth/CDP/subscription outage).
5. End-of-run check is mandatory:
   - If any cache remains `NotStarted/BasicsDone/ReviewReady`, mark overall run as FAIL.
   - Report every cache resource's status explicitly.
6. **Use `Promise.all()` — never a sequential `for` loop.** Wrap each target's task in
   `Promise.all([runOne(pageA, targetA), runOne(pageB, targetB), ...])`. A `for` loop over targets
   processes each cache one by one and eliminates all parallelism. This rule applies to both
   cache creation and any other per-page operation (e.g. navigating to the deployment blade,
   clicking "Go to resource"). Exception: sequential `for` is acceptable only when the Skill
   explicitly requires ordering (e.g. the Sequential multi-cache rule for Overview confirmation).

1. **Wait for the deployment blade to appear.** It typically shows within 5 seconds of
   clicking Create. The page title should contain "Deployment" or show a progress spinner.

2. **Poll for completion every 30 seconds.** Check for these success signals across all
   page frames:
   - Text: "Deployment is complete" or "Your deployment is complete"
   - A clickable "Go to resource" button or link

   Polling rules (mandatory):
   - **Target page lock:** identify the deployment blade once by URL pattern
     `#view/Microsoft_Azure_Resources/DeploymentDetails.MenuView` and keep polling that
     exact `Page` object. Do **not** re-resolve the page each tick with a loose substring
     like `/deployment/i.test(url)` and `Array.pop()` — the create blade and other tabs
     also contain the word "deployment" and `pop()` will silently return the wrong tab,
     producing an endless "in-progress" stream while the real blade already shows
     "Your deployment is complete".
   - **Scan all frames, not just the top page:** the deployment-complete banner and the
     "Go to resource" button are rendered **inside a child iframe** of the
     DeploymentDetails blade. The top `page.evaluate(() => document.body.innerText)`
     typically returns only ~300 chars of shell chrome and does **not** contain the
     completion text. Always iterate `page.frames()` and run the body-text probe per
     frame; locator clicks for "Go to resource" must also target the matching frame
     (`frame.locator(...)`), not `page.locator(...)`.
   - **Full-text match, no truncation:** read the entire `document.body.innerText` of
     each frame and run the regex against the full string. Never `.slice(0, N)` before
     matching — the completion banner sits below the deployment summary and is often
     beyond the first 400–800 chars.
   - **Cross-check before declaring failure/timeout:** when no success signal is detected,
     also verify the page is still on the locked DeploymentDetails URL. If the URL drifted
     (e.g. user clicked Go to resource manually), re-locate by scanning all pages for the
     completion text on full body innerText, not by URL substring.

3. **Check for failure signals** on every poll:
   - Text containing: "Deployment failed", "Provisioning failed", "QuotaExceeded",
     "AuthorizationFailed", "Forbidden", "Conflict", "InternalServerError"
   - If any failure text is found, stop and report the full error message.

4. **Maximum wait time: 60 minutes** for Standard/Basic SKUs, 90 minutes for Premium.
   If the deadline is exceeded, stop and report a timeout.

   > **CLI monitoring handoff rule:** For Premium SKUs (typical deployment 20–40 min), it is acceptable
   > to exit the Playwright process after `CreateClicked` is confirmed and switch to `az redis show`
   > polling for the provisioning state. However, once the CLI confirms `provisioningState: Succeeded`,
   > the agent **must** reconnect via Playwright, navigate to the **deployment blade**, and click
   > "Go to resource" from there — **not** by navigating directly to the Overview URL.
   > Direct URL navigation to the Overview blade is **prohibited** as a substitute for clicking
   > the "Go to resource" button.
   > Do not use `az redis wait`; this command may be unavailable in the installed Azure CLI.
   > If a blocking wait is needed, get the Redis resource id with `az redis show --query id -o tsv`
   > and use `az resource wait --ids <id> --custom "properties.provisioningState=='Succeeded'"`
   > with an interval/timeout appropriate for Premium deployments. Otherwise poll
   > `az redis show --query provisioningState` explicitly.
   >
   > To locate the deployment blade after CLI monitoring:
   > 1. Run `az deployment group list --resource-group {rg} --query "[?contains(name, '{cacheName}')]" -o json`
   >    to retrieve the exact deployment name.
   > 2. Navigate to the Resource Group Deployments list:
   >    `https://ms.portal.azure.com/#@microsoft.onmicrosoft.com/resource/subscriptions/{sub}/resourceGroups/{rg}/deployments`
   >    and click the deployment row whose name contains the cache name.
   > 3. On the deployment detail page, expand "Next steps" if collapsed, then click "Go to resource".
   > Do not skip Phase 7 step 5 or Phase 8 simply because CLI polling was used.

5. **Click "Go to resource" from the deployment blade** after deployment completes, and
    verify the resource Overview blade opens successfully. This step is **mandatory** —
    direct URL navigation to the Overview blade is **not** a valid substitute.
    - If the button is available: click it, wait for navigation, and confirm **all three**:
       1) URL contains `/providers/Microsoft.Cache/Redis/` and `/overview`
       2) page heading shows the target cache name
       3) the Overview page is **visibly rendered in the browser window** (confirmed via URL + body text, not screenshot alone)
   - Frame rule: when main-document locators cannot find "Go to resource", scan all
     `page.frames()` and click inside the frame where the control is rendered before
     concluding it is missing.
    - If click succeeds but Overview does not load within 60 seconds, record a bug and
       mark the run as FAIL.
   - **Sequential multi-cache rule:** when performing this step for multiple caches one after
     another, each cache's Overview must be fully visible and confirmed in the browser before
     proceeding to the next cache. URL + body text must both match the current cache name.
     Do not proceed to the next cache if either check fails.
   If the button is not available, record a bug immediately with deployment context
   (subscription, resource group, cache name, region, timestamp, and blade screenshot)
   and mark the run as FAIL.

   > **Mandatory transition:** Completion of Phase 7 Step 5 does NOT end the workflow.
   > Proceed **immediately** to Phase 8 — do not stop here, do not mark the run complete,
   > and do not post a result summary in chat until Phase 8 Step 4 is finished.
   > Seeing the Overview blade in the browser is **not** equivalent to a completed run.

---

## Phase 8 — Verify Creation Success (MANDATORY — do not skip)

> This phase is non-optional. Begin immediately after Phase 7 Step 5 is confirmed.
> The workflow is **not complete** until Step 4 of this phase (file write to `result.txt`) is done.
> If CLI monitoring was used during Phase 7 and `provisioningState: Succeeded` was already
> confirmed there, **skip Step 1 of this phase** but still execute Steps 2, 3, and 4 in full.

1. **Verify provisioning state via CLI:**
   Run `az redis show --name <name> --resource-group <rg> --query provisioningState`.
   Expected value: `"Succeeded"`. If not Succeeded, wait 2 minutes and retry once.

2. **Confirm the resource Overview blade loads** in the portal. The page must show the
   cache name as the heading and display status as "Running" or "Succeeded".

3. **Verify key settings match the target configuration:**
   - SKU/tier shown in Properties matches the requested Cache Type and Size.
   - Non-TLS port: check "Non-SSL port" field in Properties.
   - Redis version: shown in Properties.
   - **Authentication settings (mandatory when Entra Auth or Access Keys were toggled on the Advanced tab):**
     1. **CLI verification (primary):** run `az redis show --name <name> --resource-group <rg> --query "{disableAccessKeyAuthentication:disableAccessKeyAuthentication,aadEnabled:redisConfiguration.aadEnabled}"`. Interpret as: `disableAccessKeyAuthentication=false` → Access Keys **ON**; `aadEnabled=null` or `aadEnabled="false"` → Entra Auth **OFF**.
     2. **Portal Authentication blade (secondary — for screenshot evidence):** navigate via the left sidebar: expand **Settings**, then click **Authentication**. Do **not** use `page.goto(authUrl)` — the portal SPA does not route to sub-blades via hash navigation and always lands on Overview instead. Use sidebar click only:
        - Find the "Authentication" nav item with `querySelectorAll` or TreeWalker, filtered to elements whose trimmed text equals `"Authentication"`.
        - Apply `y > 0 && y < window.innerHeight` guard before clicking — if `y ≤ 0`, the item is off-screen; scroll the sidebar's scrollable container and re-query.
        - Click via `page.mouse.click(x, y)` (not `element.click()`).
        - After the blade loads, capture a screenshot for the run artifact.
     3. Confirm "Enable Microsoft Entra Authentication" checkbox = **unchecked** (Entra OFF) and the Access keys tab is accessible (Access Keys ON).

4. **Record the result — mandatory file write to `result.txt`.**
   After all verifications above are complete, **append** a result block to
   `d:\RedisAICode\skills\cache-creation\result.txt` using `replace_string_in_file`
   (appending after the last line of the existing file). Posting a Markdown table
   in chat alone is **not** a valid substitute.

   The block must follow the exact format used by previous entries in `result.txt`:
   - Separator line: `---`
   - `Run Date:` — today's date (YYYY-MM-DD)
   - `Test Case:` — TC ID and short title
   - `Mode:` — execution method (e.g. "Edge CDP, portal automation")
   - One numbered sub-section per cache containing: Cache Name, Resource Group,
     Subscription, Region, SKU, Redis Version, Non-TLS Port status, Entra Auth,
     Access Keys Auth, Network, Provisioning State, Portal Status,
     Auth Blade Snapshot path, Overview Snapshot path
   - `Portal Verification` paragraph describing how "Go to resource" was clicked
     and what URL / blade heading was confirmed
   - `Authentication Blade Verification` paragraph (CLI result + portal blade result)
    - For geo-replication tests: a `Geo-replication Verification` paragraph listing
       each pair, link direction, linked-cache name, link creation method, and final link status
   - `Notes` paragraph for any deviations or manual steps
   - `Overall Result: PASS` or `Overall Result: FAIL` line with brief reason

   **Do not skip this step.** If the file write fails, report the error immediately
   and retry before marking the run complete.

   **Post-write verification (mandatory).** Immediately after the append, **re-read**
   `result.txt` and confirm the new run block is actually present:
   - Run `Select-String -Path result.txt -Pattern "<TC ID>"` (or equivalent) and confirm
     at least one match in the **newly appended** range (not just anywhere in the file).
   - Run `(Get-Content result.txt | Measure-Object -Line).Lines` and confirm the line
     count increased by approximately the size of the appended block.
   - **Never** trust the line count or content reported in a prior session, a compaction
     summary, or a tool result from before the current append — long-running sessions and
     PowerShell here-string variables (`$block` in `@'...'@`) can silently lose state across
     command boundaries, causing `Add-Content -Value $block` to append empty content with
     no error. If post-write verification shows the marker is missing, re-build the block
     and append again in the same command (do not assume earlier appends succeeded).

---

## General Rules

| Topic | Rule |
|---|---|
| Visibility check | For **interaction and click decisions**, use `getBoundingClientRect()` to confirm the element is on-screen (width > 0, height > 0, x ≥ 0) — never `offsetParent`. The portal pre-positions elements at x = −10000 where `offsetParent` is still non-null, causing false positives. For **form-ready waiting**, `page.waitForSelector(selector)` (DOM presence) is acceptable as a gate, but must be followed by a `getBoundingClientRect()` check before interacting. |
| Toggle aria-label selector | Advanced-tab toggles (Non-TLS, Entra Auth, Access Keys) must be located via their exact `aria-label` attribute: `"Non-TLS port Enable"`, `"Microsoft Entra Authentication Enable"`, `"Access Keys Authentication Enable"` (note plural `Keys`). Use `document.querySelectorAll('[aria-label="..."]')` and pick the **visible in-viewport** instance first. Do **not** rely on a single `document.querySelector(...)`, because hidden duplicate elements can report stale states and cause false "already enabled" decisions. |
| Hidden duplicate toggle guard | If both hidden and visible elements share the same toggle `aria-label`, state readback and click target must use the visible instance only. A hidden instance at `y=0` or out-of-viewport can incorrectly report `true` while the visible control remains `false`, which causes Review to show `Access Keys Authentication Disabled`. |
| Toggle six-step procedure | Every aria-label checkbox interaction on the Advanced tab (Non-TLS, Entra Auth, Access Keys, Clustering) must follow this exact order: (1) `querySelectorAll` not `querySelector`; (2) filter to visible-in-viewport instance; (3) `scrollIntoView({block:'center'})` + 200 ms + re-read rect; (4) `page.mouse.click(cx, cy)` if `0 < y < innerHeight`, else `visibleEl.click()` via `evaluate` on the **visible** instance; (5) re-read `aria-checked` on the visible instance; (6) `dismissOverlays` (Escape×4) before navigating away. Use `setToggle()` from `create-cache.js` — it encodes all six steps. |
| Auth toggle activation order | When initial state is `Entra=ON` and `Access Keys=OFF` and the target state is `Entra=OFF` and `Access Keys=ON`, enable Access Keys **first**, then disable Entra. The portal blocks any transition that would leave zero auth methods enabled; reversing this order silently no-ops on the Entra click and the Advanced tab ends with `Keys=OFF, Entra=ON`. |
| Footer / tab navigation click | Footer and tab buttons (`Next : Tags >`, `Next : Review + create >`, `Advanced`, `Review + create`) must be clicked via DOM `.click()` through `clickFooterByText()` — never `page.mouse.click(x, y)`. When the create blade is scrolled, these buttons frequently have `rect.y ≤ 0` and a coordinate click hits the top header / waffle menu instead. Always call `dismissOverlays(page)` (Escape×4) immediately before the click to clear any open dropdown or notification overlay. The Review page `Create` command is the exception; use the dedicated row below. |
| Review Create command | After `Validation passed.`, the `Create` command may be rendered as Portal command text rather than a standard button. If `button:has-text("Create")` hangs or is absent, locate the visible element with exact normalized text or aria-label `Create`, click its bounding-box center, and verify `Submitting deployment...`, `Deployment in progress`, or `DeploymentDetails`. Do not use CLI/ARM creation as fallback; pause for manual Portal click if needed. |
| Re-ensure Advanced before edit | Any Advanced-tab edit performed after a correction loop (e.g. the page may be on Review or Tags) must be preceded by `ensureAdvancedTab(page)`, which DOM-clicks the `[role=tab]` with text `"Advanced"`. Calling Playwright locator clicks on Advanced controls while another tab is active throws "element is not visible". |
| Bounding rect y=0 guard | Before calling `page.mouse.click(x, y)`, always verify `rect.y > 0 && rect.y < window.innerHeight`. A `y` value of 0 (or very small) means the element exists in the DOM but is scrolled out of the viewport — clicking at y=0 hits the browser chrome (e.g. the hamburger/portal menu) instead of the intended element. Recovery: inside `page.evaluate()` call `element.scrollIntoView({ block: "center", behavior: "instant" })`, wait 200 ms, then re-query `getBoundingClientRect()`. If still out of range, find and scroll the nearest `overflowY: auto/scroll` ancestor container explicitly. |
| Auth blade sidebar navigation | The Authentication sub-blade of a cache resource must be reached by clicking the **"Authentication" nav item in the left sidebar** (Settings group) — **not** by `page.goto(authUrl)`. The portal SPA does not process sub-blade hash fragments from `goto()`; navigating to an auth-blade URL always renders the Overview blade instead. Sidebar click sequence: (1) find nav item with trimmed text `"Authentication"` via `querySelectorAll` or TreeWalker, (2) apply `y > 0 && y < window.innerHeight` guard — scroll sidebar if out of range, (3) click via `page.mouse.click(x, y)`. **CLI fallback** when sidebar navigation fails: `az redis show --query "{dak:disableAccessKeyAuthentication,aad:redisConfiguration.aadEnabled}"` — `dak=false` → Access Keys ON; `aad=null` → Entra OFF. |
| Private endpoint DNS rule | For Private Endpoint cache creation, `Enable Private DNS Integration` is mandatory. Before clicking Add in the private endpoint panel, verify the checkbox is checked and the panel shows `(new) privatelink.redis.cache.windows.net` or `privatelink.redis.cache.windows.net`. After Add, verify the private endpoint table includes the DNS zone. If a row was added while DNS was unchecked or the DNS zone is missing, delete the row and re-create it; do not proceed to Advanced/Review. |
| Private endpoint panel frame | The Create private endpoint panel is hosted in a transient non-main React blade iframe. The active iframe URL may be blank or `sandbox-*.reactblade-ms.portal.azure.net`; identify it by body text (`Configure virtual network` + `Private DNS integration`) and re-locate it before each operation because the portal may detach/recreate the frame between clicks. |
| Private endpoint RG/Region | The private endpoint side panel does not reliably inherit Basics values. Always explicitly set Resource Group and Region in the panel before selecting VNet. EUAP region options include a visible `(US)` prefix, e.g. `(US) Central US EUAP` and `(US) East US 2 EUAP`; match by containment, not exact unprefixed text. |
| Public endpoint auth coupling | If Phase 3 selects `Public endpoint`, then Phase 4 must enforce `Microsoft Entra Authentication = Disabled` and `Access Keys Authentication = Enabled`. Treat this as a mandatory linked configuration, not a soft default. Do not leave either toggle unchanged just because the test case omits the auth settings explicitly. |
| Public endpoint final invariant | The Public-endpoint auth coupling is not satisfied by setting the toggles once near the start of the Advanced tab. It must be re-verified after all later Advanced-tab edits, because portal re-renders or persistence/storage-account changes can leave the final UI state inconsistent with the earlier toggle operations. |
| Access Keys DOM-click fallback | In some portal layouts, `Access Keys Authentication Enable` remains mounted in the DOM but its bounding rect stays at `y=0` even after scroll attempts. When this happens, real mouse click is impossible. Use `document.querySelector('[aria-label="Access Keys Authentication Enable"]').click()` as a last-resort fallback, then verify that `aria-checked` actually changed to `true`. |
| Data persistence prerequisite | `RDB` / `AOF` persistence is not self-contained. Before enabling it, confirm the required storage account selection for the run. If the test case requests persistence but does not provide a storage account, stop and ask the user instead of leaving persistence half-configured or guessing a storage account. |
| Storage Account commit rule | In Advanced persistence settings, Storage Account must be committed by explicit option click from the dropdown list after filtering. Typing/searching without clicking the option is invalid and can leave Review showing a stale account (for example `jwmwxaugfunctionaltest`). |
| Storage Account identification rule | Identify Storage Account dropdown by field label (`Storage Account` / `First Storage Account`) only. Never infer by current text content pattern. Status/help text such as `Zone enabled caches are not yet available in the region` is explicitly non-selectable and must be excluded from candidate detection. |
| Dropdown selector | Azure Portal dropdowns are `div.azc-formControl[aria-haspopup="dialog"]`. Select by visibility index: `[0]`=Sub, `[1]`=RG, `[2]`=Region, `[3]`=CacheType, `[4]`=CacheSize. Do **not** use `button[aria-label]` or `div[aria-label*='...'] button` — those don't exist. |
| Dropdown interaction | `click()` → wait 1800ms → `page.keyboard.type(text, {delay:70})` → wait 1800ms → click `.fxc-dropdown-option` filtered by text. Fallback: `ArrowDown` + `Enter`. |
| Region commit rule | Region must be committed by explicit option click after search. Searching text without clicking option is invalid and can silently revert to `East US` at Review. |
| Resource Group field | Selector: `div[aria-label="Create new or use existing Resource group"]` — has stable aria-label. Use as ElementHandle from `page.$()`. |
| DNS Name input | Selector: `input[placeholder="enter a name"]` — use `ElementHandle.fill(name)`, or click the input first then send **field-scoped** `Control+A` (clears only the input value) and type. Set AFTER Region to prevent typing landing in the Region filter box. Do NOT send a page-level `Control+A` (i.e. without first clicking the input) — that selects all page text and destabilises subsequent interactions. |
| Toggle state | Always read `aria-checked` before clicking — skip click if already in target state |
| Parallel runs | Use `locator.pressSequentially()` (Locator API only) or `page.keyboard.type()` — **never call `pressSequentially` on an ElementHandle** (returned by `page.$$`), it does not exist |
| Dialog handling | Always attach auto-dismiss for dialogs immediately after opening a new page |
| Error containment | Catch all interaction errors; log as WARN and continue unless the field is critical |
| Go to resource locator | Deployment "Go to resource" can be rendered in a child iframe; always search across `page.frames()`. Use `f.locator(...).isVisible()` — not `.count()` — to confirm the button is actually clickable. `.count()` returns elements inside collapsed/hidden sections (e.g. a collapsed "Next steps") and gives false positives. |
| Deployment page lock | The deployment blade must be locked by URL pattern `#view/Microsoft_Azure_Resources/DeploymentDetails.MenuView` and the same `Page` object reused for every poll. Do **not** re-resolve with substring matches like `/deployment/i` plus `Array.pop()` — multiple tabs contain the word "deployment" and pop() will land on the wrong (stale) tab, causing the monitor to report endless "in-progress" while the real blade already shows completion. |
| Deployment completion text match | Always run completion / failure regexes against the **full** `document.body.innerText` of every frame returned by `page.frames()`. Never `.slice(0, N)` before matching — "Your deployment is complete" is rendered below the deployment summary and is often beyond the first 400–800 chars, so truncated matching silently misses success. |
| Deployment frame scan | The deployment-complete banner and the "Go to resource" button live in a **child iframe** of the DeploymentDetails blade, not the top document. `page.evaluate(() => document.body.innerText)` on the top frame typically returns only ~300 chars of shell chrome and will never match. Always iterate `page.frames()` to detect completion, and click "Go to resource" via the matching `frame.locator(...)`. |
| Go to resource expand guard | Before clicking "Next steps" to expand it, first check if the "Go to resource" button is already visible via `isVisible()`. If it is, do NOT click "Next steps" — doing so will collapse the section and hide the button. Only click the expand toggle when the button is confirmed not visible. |
| Go to resource click strategy | 1) `f.locator("button:has-text('Go to resource'),a:has-text('Go to resource')").first()` with `isVisible()` guard. 2) `scrollIntoViewIfNeeded()`, then get bounding rect from inside the frame. 3) Get frame offset via `f.frameElement().boundingBox()`. 4) Click with `page.mouse.click(frameX + btnCx, frameY + btnCy)`. If the frame IS the main frame, `frameElement()` returns null — use the rect coords directly. |
| Go to resource blade refresh | If the "Go to resource" button remains unfindable after expand attempts (e.g. due to state inconsistency from previous toggle clicks), navigate the deployment page to its own URL fresh via `page.goto(deploymentBladeUrl, {waitUntil:"domcontentloaded"})`. The deployment blade URL pattern: `https://ms.portal.azure.com/#view/Microsoft_Azure_Resources/DeploymentDetails.MenuView/~/overview/id/{url-encoded-deployment-id}`. After reload, wait for "Your deployment is complete" text in any frame before searching for the button. |
| Portal feature flag URL | Feature flags (e.g. `?feature.vnetInjectedCacheCreation=true`) **must** be placed as query parameters **before** the `#` in the URL. The portal SPA reads `window.location.search` at startup — parameters after `#` are part of the hash fragment and are ignored. Correct: `https://ms.portal.azure.com/?feature.xxx=true#create/...`. Wrong: `https://ms.portal.azure.com/#create/...?feature.xxx=true`. |
| VNet option startsWith | When selecting the VNet injection radio on the Networking tab, use `.startsWith("virtual network")` or `.startsWith("azure virtual network")` — **never** `.includes("virtual network")`. The "Private Endpoint" option's full text ends with `"...from virtual networks"`, which contains `"virtual network"` as a substring and causes a false match. |
| Goto `waitUntil` | Always use `domcontentloaded` — never `networkidle` on Azure Portal (may never resolve) |
| CDP disconnect | **Do not call `browser.disconnect()` or `browser.close()`** after `chromium.connectOverCDP()` — this closes the real Edge browser. Simply let the Node.js process exit; the CDP session is released automatically. |
| Page access mode | Use Edge CDP as the only execution channel for this skill. Embedded browser pages are for observation only, not the authoritative run path. |
| ElementHandle vs Locator | `page.$$()` returns `ElementHandle[]` — supports `.click()`, `.evaluate()`, `.isVisible()` but **not** `.pressSequentially()`, `.fill()`, or `.locator()`. For text input use `page.keyboard.type()` after clicking the handle. Use `page.locator()` when Locator methods are needed. |
| node -e execution pattern | **Never** create `.js` files for execution (neither in `%TEMP%` nor in the workspace). Use the PowerShell here-string pattern: `$js = @'\n// code\n'@; node -e $js`. Single-quote here-strings (`@'...'@`) require zero escaping. This is the only permitted execution method for inline Playwright scripts. |
| Playwright require path | In inline `node -e $js` scripts, always use the absolute path: `require("d:/RedisAICode/node_modules/playwright")`. Helper functions from `create-cache.js` must be required as `require("d:/RedisAICode/skills/cache-creation/create-cache.js")`. Do NOT use bare `require("playwright")` — it resolves relative to a nonexistent file location. |
| IIFE async syntax | In Node.js, `(async(){})()` is **invalid** — `async` followed by `(){}` is not valid JS. Use `(async function(){...})()` or `(async () => {...})()`. Node.js in TypeScript mode will fail with "Unexpected token '{'" on the invalid form. |
| Reuse existing pages | Before creating a new page via `ctx.newPage()`, scan `ctx.pages()` first. If a page already on `ms.portal.azure.com` (not login) exists, reuse it. Creating a new page in a browser context may trigger re-authentication. |
| Login detection | Do NOT check `url.includes("portal.azure.com")` — the login redirect URL contains `portal.azure.com` in the `redirect_uri` query param, making this always true. Check `new URL(url).hostname === "ms.portal.azure.com"` instead. |
| Auth drift handling | If redirected to login during execution, immediately prompt user to click login and complete verification, then resume from Phase 1 after portal recovery. |
| New page re-auth | Even if the browser is authenticated, opening a new portal page can trigger MSAL redirect to account picker (`login.microsoftonline.com`). When this happens, pause automation and ask user to complete login manually, then continue only after URL returns to `ms.portal.azure.com`. |
| Account picker handling | Do not auto-click account tiles in this repo workflow. Prompt user to manually confirm the correct account (`v-junruma@microsoft.com`) and complete verification. |
| Script policy for this repo | **Do not create any `.js` files** — not in `%TEMP%`, not in the workspace, not anywhere — for execution purposes. All Playwright execution must use `$js = @'...'@; node -e $js` inline. Any `.js` file created during a run (e.g. `vnet-phase1-basics.js`, `cdp-check.js`) must be deleted immediately after creation is confirmed as a mistake. |
| No per-test execution scripts | Do **not** create named per-test-case execution scripts (e.g. `run-tc15318673.js`, `vnet-phase1-basics.js`). Execute all creation steps via `$js = @'...'@; node -e $js` following this SKILL phase by phase. Helper functions live in `skills/cache-creation/create-cache.js` and are loaded with `require("d:/RedisAICode/skills/cache-creation/create-cache.js")` from inline code. |
| No inline code in SKILL.md | Do **not** add code blocks to this document. All helper function implementations belong in `skills/cache-creation/create-cache.js`. Reference the function name and describe its behaviour in plain text only. |
| Option click reliability | For dropdown/radio selections that must persist (Region, RG, Size, Public Endpoint, Availability Zones), always use `getBoundingClientRect()` center + `page.mouse.click(x, y)`. **Never** use `element.click()`, `evaluate().click()`, or `dispatchEvent(new MouseEvent(...))` for these controls — they produce synthetic events that the Azure Portal SPA silently ignores without committing the selection. |
| Region capability guard | `Central US EUAP` does not support Availability Zones for this workflow. If a test requires zone redundancy, use `East US 2 EUAP` and do not attempt zone configuration in `Central US EUAP`. `East US 2 EUAP` supports Availability Zones for Premium SKU. |
| Zone combobox selector | Availability zones control is `div[role="combobox"]` with visible text "Allocate zones automatically". It is **not** a set of pill/checkbox elements — it is a single combobox. Open it with a real mouse click, then click each zone option with a real mouse click using `getBoundingClientRect()` center coordinates. |
| Zone selection verification | After clicking zone options and pressing Escape to close, read back the combobox innerText. It must contain the selected zone numbers (e.g. "1, 2"). If the text still reads "Allocate zones automatically", the click did not commit — retry with `page.mouse.click(x, y)`. |
| Playwright visibility | When user requests portal execution, perform actions through Playwright on live portal pages so field edits/clicks are visible during run. |
| No-guess rule | If portal UI capability conflicts with requested config (for example zone control unavailable), pause and ask user for instruction instead of inferring alternatives. |
| Review fallback symptom | If Review shows `Resource group` empty or values unexpectedly revert to `Location: East US` / `Cache size: C1`, the dropdown choice was not committed. Re-run Basics with explicit option click for Region, RG, and Size before creating. |
| Blue highlighted page text on Basics | If most page text turns blue (selected), a global keyboard select-all (`Control+A`) was sent to the document instead of the target input. This can interfere with subsequent typing/clicking and make behavior unstable. |
| Selection-highlight recovery | Recovery sequence: click target input/dropdown first, send `Escape` once to clear selection state, then continue with field-scoped clear/type. Avoid page-level `Control+A` shortcuts in Basics workflow. |
| Review evidence | Entering Review must produce one snapshot artifact before Create is attempted. Missing snapshot means the attempt is incomplete. |
| Geo-replication topology confirmation | For geo-replication tests, ask two separate questions before naming or creating caches: where to create the test cache, and where to create the geo pair / linked cache. Do not infer the linked-cache region from the test-cache region unless the user explicitly says to use the other region. If the user confirms one mapping, create one pair (two caches). If the user confirms mappings for both `Central US EUAP` and `East US 2 EUAP`, create four caches total. |
| Multi-region parallel guard | For any test case requiring parallel multi-region or geo-replication creation, always allocate one fixed page per cache resource and track all cache states until every cache reaches `CreateClicked` (or terminal failure). A run that executes fewer cache resources than the expanded topology requires is incomplete. |
| Multi-page async execution | When multiple independent pages each need the same operation (cache creation, deployment blade navigation, "Go to resource" click), **always use `Promise.all([op(pageA, targetA), op(pageB, targetB)])`**. A sequential `for` loop over pages eliminates all parallelism and doubles execution time. Use sequential processing only when ordering is mandatory (e.g. Overview confirmation of cache 1 before cache 2, per the Sequential multi-cache rule). |
| Phase 8 mandatory | Phase 8 (Verify Creation Success) is **always required** regardless of whether browser-based or CLI-based monitoring was used. If CLI monitoring was used, reconnect via Playwright, navigate to the deployment blade (via the RG Deployments list), and click "Go to resource" to complete Phase 7 step 5 — then proceed with Phase 8. **Direct URL navigation to the Overview blade is prohibited.** Reporting only `provisioningState: Succeeded` from CLI is insufficient to mark a run as complete. |
| Go to resource — button only | "Go to resource" navigation must always be performed by clicking the button on the deployment blade. URL-based shortcut to the Overview blade (e.g. `/providers/Microsoft.Cache/Redis/{name}/overview`) is **not** an acceptable substitute and must not be used. |
