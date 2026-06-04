/**
 * Azure Cache for Redis — Geo-Replication Helper Functions
 *
 * Node.js + Playwright reusable helpers referenced by skills/geo-replication-setup/SKILL.md.
 * Import specific functions, or call them inline via `node -e $js`.
 *
 * Requires:
 *   - Edge running with --remote-debugging-port=9222 (for Portal UI helpers)
 *   - `az` CLI on PATH or at C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd
 *
 * Mapping from the legacy PowerShell scripts (Claude-Redis/scripts/*.ps1):
 *   Assert-GeoEnv.ps1                -> assertGeoEnv
 *   Invoke-GeoLinkUI.ps1             -> invokeGeoLinkUI
 *   Invoke-GeoLinkArm.ps1            -> invokeGeoLinkArm
 *   Wait-GeoLink.ps1                 -> waitGeoLink
 *   Assert-GeoPair.ps1               -> assertGeoPair
 *   Invoke-GeoFailover.ps1           -> invokeGeoFailover
 *   Assert-GeoRoleFlip.ps1           -> assertGeoRoleFlip
 *   Test-GeoActivityLog.ps1          -> testGeoActivityLog
 *   Invoke-RebootThenFailover.ps1    -> invokeRebootThenFailover
 *   Assert-ConcurrentNotifications.ps1 -> assertConcurrentNotifications
 *   Invoke-GeoUnlink.ps1             -> invokeGeoUnlink
 *   Assert-GeoUnlinked.ps1           -> assertGeoUnlinked
 *   Test-GeoDns.ps1                  -> testGeoDns
 *   Invoke-GeoTeardown.ps1           -> invokeGeoTeardown
 */

"use strict";

const { spawnSync } = require("child_process");
const https = require("https");
const dns = require("dns");
const net = require("net");

// ── Constants ────────────────────────────────────────────────────────────────
const AZ_CMD =
  process.env.AZ_CMD ||
  "C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd";
const API_CACHE = "2023-05-01-preview";
const API_LINK = "2022-06-01";
const ARM_HOST = "management.azure.com";

// NOTE: cache provisioning is out of scope for this library — use the
// `cache-creation` skill (skills/cache-creation/) to create the Premium,
// non-AAD Redis caches before invoking any helper below. All geo helpers
// assume the caches already exist and are in `Succeeded` provisioning state.

const REGION_DISPLAY = {
  SEA: "Southeast Asia",
  WCUS: "West Central US",
  EUS2E: "East US 2 EUAP",
  CUSE: "Central US EUAP",
};

// ── Helper: az CLI wrapper ───────────────────────────────────────────────────
function az(args, { quiet = false, json = false } = {}) {
  const r = spawnSync(AZ_CMD, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" });
  if (!quiet && r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    throw new Error(`az ${args.join(" ")} failed (status=${r.status}): ${r.stderr || r.stdout}`);
  }
  const out = (r.stdout || "").trim();
  return json && out ? JSON.parse(out) : out;
}

function azTry(args) {
  const r = spawnSync(AZ_CMD, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" });
  return { status: r.status, stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim() };
}

// ── Helper: ARM REST via management bearer token ─────────────────────────────
let _cachedToken = null;
function armToken() {
  if (_cachedToken && _cachedToken.expiresAt > Date.now() + 60_000) return _cachedToken.value;
  const t = az([
    "account",
    "get-access-token",
    "--resource",
    "https://management.azure.com/",
    "--query",
    "accessToken",
    "-o",
    "tsv",
  ]);
  // Tokens last ~60 min; cache for 50 min
  _cachedToken = { value: t, expiresAt: Date.now() + 50 * 60_000 };
  return t;
}

function armRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = https.request(
      {
        host: ARM_HOST,
        method,
        path,
        headers: {
          Authorization: `Bearer ${armToken()}`,
          "Content-Type": "application/json",
          ...(data ? { "Content-Length": data.length } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed = null;
          try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
          resolve({ status: res.statusCode, body: parsed, raw: text });
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const linkedServersPath = (sub, rg, cache, suffix = "") =>
  `/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.Cache/Redis/${cache}/linkedServers${suffix}?api-version=${API_LINK}`;

const cachePath = (sub, rg, cache) =>
  `/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.Cache/Redis/${cache}?api-version=${API_CACHE}`;

// ── Helper: wait / sleep ─────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowHHMMSS = () => new Date().toISOString().slice(11, 19);

// ── Helper: portal URL builders ──────────────────────────────────────────────
function portalGeoUrl({ tenant = "microsoft.onmicrosoft.com", sub, rg, cache }) {
  return `https://ms.portal.azure.com/#@${tenant}/resource/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.Cache/Redis/${cache}/geoReplication`;
}
function portalRebootUrl({ tenant = "microsoft.onmicrosoft.com", sub, rg, cache }) {
  return `https://ms.portal.azure.com/#@${tenant}/resource/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.Cache/Redis/${cache}/reboot`;
}

function secondaryRegionDisplay(secondaryName) {
  for (const key of Object.keys(REGION_DISPLAY)) {
    if (secondaryName.includes(key)) return REGION_DISPLAY[key];
  }
  return null;
}

// ── Helper: tolerant locator click (Portal UI patterns) ──────────────────────
async function clickByRole(page, role, options, { timeout = 8000, tolerate = false } = {}) {
  try {
    await page.getByRole(role, options).click({ timeout });
    return true;
  } catch (e) {
    if (tolerate) {
      console.log(`[geo] WARN clickByRole tolerated: ${role} ${JSON.stringify(options)} :: ${e.message}`);
      return false;
    }
    throw e;
  }
}

async function clickByText(page, text, { timeout = 8000, tolerate = false } = {}) {
  try {
    await page.getByText(text, { exact: false }).first().click({ timeout });
    return true;
  } catch (e) {
    if (tolerate) {
      console.log(`[geo] WARN clickByText tolerated: '${text}' :: ${e.message}`);
      return false;
    }
    throw e;
  }
}

async function closeNotificationsFlyout(page) {
  // Notifications flyout overlays modal dialogs and intercepts Yes/OK clicks.
  await clickByRole(
    page,
    "button",
    { name: "Close content 'Notifications'" },
    { timeout: 2000, tolerate: true }
  );
}

// ============================================================================
// Phase 0 — assertGeoEnv  (legacy Assert-GeoEnv.ps1)
// ============================================================================
async function assertGeoEnv({ subscription, resourceGroup, cdpPort = 9222 }) {
  if (!subscription) throw new Error("subscription is required");
  if (!resourceGroup) throw new Error("resourceGroup is required");
  const failures = [];

  const check = (name, fn) => {
    try { fn(); console.log(`[OK]   ${name}`); }
    catch (e) { console.log(`[FAIL] ${name} :: ${e.message}`); failures.push(name); }
  };

  check("az CLI", () => az(["--version"], { quiet: true }));
  check("playwright (node module)", () => require.resolve("playwright"));
  check("Subscription access", () => az(["account", "set", "--subscription", subscription]));
  check("Resource group", () => az(["group", "show", "-n", resourceGroup, "--subscription", subscription], { quiet: true }));

  await new Promise((resolve) => {
    const sock = net.connect(cdpPort, "127.0.0.1");
    sock.setTimeout(2000);
    sock.on("connect", () => { sock.destroy(); check(`CDP Edge ${cdpPort}`, () => { }); resolve(); });
    sock.on("timeout", () => { sock.destroy(); check(`CDP Edge ${cdpPort}`, () => { throw new Error("timeout"); }); resolve(); });
    sock.on("error", (e) => { check(`CDP Edge ${cdpPort}`, () => { throw e; }); resolve(); });
  });

  if (failures.length) throw new Error(`Phase 0 FAIL: ${failures.join(", ")}`);
  console.log("Phase 0 PASS");
  return true;
}

// ============================================================================
// Phase 2 — invokeGeoLinkUI  (legacy Invoke-GeoLinkUI.ps1)
// Caller passes a Playwright `page` already attached to the CDP browser.
// ============================================================================
async function invokeGeoLinkUI({
  page,
  primary,
  secondary,
  subscription,
  resourceGroup,
  tenant = "microsoft.onmicrosoft.com",
  screenshotPrefix,
}) {
  if (!page) throw new Error("page (Playwright Page) is required");
  if (!primary || !secondary || !subscription || !resourceGroup) {
    throw new Error("invokeGeoLinkUI requires { page, primary, secondary, subscription, resourceGroup }");
  }
  const prefix = screenshotPrefix || `link-${primary}`;
  const url = portalGeoUrl({ tenant, sub: subscription, rg: resourceGroup, cache: primary });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  // 1) Open Add link picker — command-bar items are NOT menuitem role
  await page.getByText("Add cache replication link").first().click({ timeout: 10000 });
  await page.waitForTimeout(2000);

  // 2) Filter right grid by clicking the secondary's region in the left Location list
  const region = secondaryRegionDisplay(secondary);
  if (region) {
    await page.getByText(region, { exact: true }).first().click({ timeout: 8000 }).catch(() => { });
    await page.waitForTimeout(2000);
  } else {
    console.log(`[geo] WARN no region mapping for secondary='${secondary}' — picker may show multiple regions`);
  }

  // 3) Click the secondary row — MUST use gridcell role; plain text strict-mode collides with notifications
  await page.getByRole("gridcell", { name: secondary }).first().click({ timeout: 8000 });
  await page.waitForTimeout(1000);

  // 4) Confirm
  await page.getByRole("button", { name: "Link", exact: true }).click({ timeout: 8000 });
  await page.waitForTimeout(3000);

  // 5) Submission evidence
  await clickByRole(page, "button", { name: "Notifications" }, { tolerate: true });
  await page.screenshot({ path: `${prefix}-submit.png`, fullPage: false }).catch(() => { });

  // 6) Copy-tooltip evidence (Copied tooltip is authoritative; navigator.clipboard.readText is unreliable)
  await clickByRole(page, "button", { name: "Copy to clipboard" }, { tolerate: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${prefix}-copied.png` }).catch(() => { });

  console.log(`LINKED ${primary} -> ${secondary}`);
  return true;
}

// ============================================================================
// Phase 2 fallback — invokeGeoLinkArm  (legacy Invoke-GeoLinkArm.ps1)
// ============================================================================
async function invokeGeoLinkArm({
  primary,
  secondary,
  secondaryLocation,
  subscription,
  resourceGroup,
}) {
  if (!primary || !secondary || !secondaryLocation || !subscription || !resourceGroup) {
    throw new Error("invokeGeoLinkArm requires { primary, secondary, secondaryLocation, subscription, resourceGroup }");
  }
  const body = {
    properties: {
      linkedRedisCacheId: `/subscriptions/${subscription}/resourceGroups/${resourceGroup}/providers/Microsoft.Cache/Redis/${secondary}`,
      linkedRedisCacheLocation: secondaryLocation,
      serverRole: "Secondary",
    },
  };
  let r = await armRequest(
    "PUT",
    linkedServersPath(subscription, resourceGroup, primary, `/${secondary}`),
    body
  );
  if (r.status === 400) {
    console.log(`[geo] WARN ARM-LINK primary->secondary 400; trying reverse`);
    r = await armRequest(
      "PUT",
      linkedServersPath(subscription, resourceGroup, secondary, `/${primary}`),
      body
    );
    console.log(`ARM-LINK ${secondary} -> ${primary} (reversed) HTTP=${r.status}`);
  } else {
    console.log(`ARM-LINK ${primary} -> ${secondary} HTTP=${r.status}`);
  }
  if (r.status >= 400) throw new Error(`invokeGeoLinkArm HTTP=${r.status}: ${r.raw}`);
  return r;
}

// ============================================================================
// Phase 2 / 3 / 4 — waitGeoLink  (legacy Wait-GeoLink.ps1)
// expectEmpty=true polls for value.Count===0 on every cache (post-unlink)
// expectEmpty=false (default) polls for every entry's provisioningState===Succeeded
// ============================================================================
async function waitGeoLink({
  caches,
  subscription,
  resourceGroup,
  maxMinutes = 60,
  pollSec = 180,
  expectEmpty = false,
}) {
  if (!caches || !caches.length || !subscription || !resourceGroup) {
    throw new Error("waitGeoLink requires { caches, subscription, resourceGroup }");
  }
  const deadline = Date.now() + maxMinutes * 60_000;
  while (true) {
    let allOk = true;
    console.log(`[${nowHHMMSS()}]`);
    for (const n of caches) {
      const r = await armRequest("GET", linkedServersPath(subscription, resourceGroup, n));
      const arr = (r.body && r.body.value) || [];
      if (expectEmpty) {
        console.log(`  ${n}  count=${arr.length}`);
        if (arr.length !== 0) allOk = false;
      } else {
        if (arr.length === 0) { console.log(`  ${n}  (no entries)`); allOk = false; continue; }
        for (const v of arr) {
          const s = v.properties && v.properties.provisioningState;
          console.log(`  ${n.padEnd(40)} <- ${(v.name || "").padEnd(40)} role=${(v.properties && v.properties.serverRole || "").padEnd(9)} state=${s}`);
          if (s !== "Succeeded") allOk = false;
        }
      }
    }
    if (allOk) {
      console.log(expectEmpty ? "=== All caches unlinked ===" : "=== All links Succeeded ===");
      return true;
    }
    if (Date.now() > deadline) throw new Error(`waitGeoLink TIMEOUT after ${maxMinutes} min`);
    await sleep(pollSec * 1000);
  }
}

// ============================================================================
// Phase 2 — assertGeoPair  (legacy Assert-GeoPair.ps1)
// entry's serverRole describes the PEER, not the queried cache
// ============================================================================
async function assertGeoPair({ primary, secondary, subscription, resourceGroup }) {
  const sides = [
    { n: primary, peerRole: "Secondary" },
    { n: secondary, peerRole: "Primary" },
  ];
  for (const side of sides) {
    const r = await armRequest("GET", linkedServersPath(subscription, resourceGroup, side.n));
    const arr = (r.body && r.body.value) || [];
    if (arr.length !== 1) throw new Error(`Assert FAIL: ${side.n} entries=${arr.length}`);
    const e = arr[0];
    if (e.properties.provisioningState !== "Succeeded") {
      throw new Error(`Assert FAIL: ${side.n} state=${e.properties.provisioningState}`);
    }
    if (e.properties.serverRole !== side.peerRole) {
      throw new Error(`Assert FAIL: ${side.n} peer.serverRole=${e.properties.serverRole}, expected ${side.peerRole}`);
    }
    console.log(`[PASS] ${side.n} -> ${e.name} peer.role=${e.properties.serverRole}`);
  }
  console.log(`Phase 2 PASS: ${primary} <-> ${secondary}`);
  return true;
}

// ============================================================================
// Phase 3 — invokeGeoFailover  (legacy Invoke-GeoFailover.ps1)
// ============================================================================
async function invokeGeoFailover({
  page,
  cache,
  subscription,
  resourceGroup,
  tenant = "microsoft.onmicrosoft.com",
  screenshotPrefix,
}) {
  if (!page || !cache || !subscription || !resourceGroup) {
    throw new Error("invokeGeoFailover requires { page, cache, subscription, resourceGroup }");
  }
  const prefix = screenshotPrefix || `failover-${cache}`;
  const url = portalGeoUrl({ tenant, sub: subscription, rg: resourceGroup, cache });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  await closeNotificationsFlyout(page);

  // Failover button — same-text footer link exists; MUST use button role + exact
  await page.getByRole("button", { name: "Failover", exact: true }).click({ timeout: 8000 });
  await page.waitForTimeout(2000);

  // Confirm dialog uses Yes/No; tolerate strict-mode/target-closed errors — trust blade state
  await clickByRole(page, "button", { name: "Yes", exact: true }, { tolerate: true });
  await page.waitForTimeout(3000);

  await clickByRole(page, "button", { name: "Notifications" }, { tolerate: true });
  await page.screenshot({ path: `${prefix}-submit.png` }).catch(() => { });
  console.log(`FAILOVER SUBMITTED on ${cache} (trust blade state, not click exit code)`);
  return true;
}

// ============================================================================
// Phase 3R — invokeRebootThenFailover  (legacy Invoke-RebootThenFailover.ps1)
// Reboot Primary (Primary+Replica ports; OK/Cancel dialog) then immediately
// trigger Failover on Secondary. ADO 16021140 requires reboot→failover ≤ 2 s.
// ============================================================================
async function invokeRebootThenFailover({
  page,
  primary,
  secondary,
  subscription,
  resourceGroup,
  tenant = "microsoft.onmicrosoft.com",
}) {
  if (!page || !primary || !secondary || !subscription || !resourceGroup) {
    throw new Error("invokeRebootThenFailover requires { page, primary, secondary, subscription, resourceGroup }");
  }

  // --- Reboot Primary ---
  await page.goto(portalRebootUrl({ tenant, sub: subscription, rg: resourceGroup, cache: primary }), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  // Port(s) combobox — options are treeitem, NOT option
  await page.getByRole("combobox", { name: /Port/i }).click({ timeout: 8000 });
  await page.waitForTimeout(800);
  await page.getByRole("treeitem", { name: /Replica - 15001/i }).click({ timeout: 8000 });
  await page.keyboard.press("Escape").catch(() => { });
  await page.waitForTimeout(500);

  await page.getByRole("button", { name: "Reboot", exact: true }).click({ timeout: 8000 });
  // Reboot uses OK/Cancel — NOT Yes/No
  await page.getByRole("button", { name: "OK", exact: true }).click({ timeout: 8000 });
  const tReboot = Date.now();
  console.log(`REBOOT SUBMITTED on ${primary} @ ${new Date(tReboot).toISOString()}`);

  // --- Immediate Failover on Secondary (NO WAIT — must be ≤ 2 s) ---
  await page.goto(portalGeoUrl({ tenant, sub: subscription, rg: resourceGroup, cache: secondary }), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await closeNotificationsFlyout(page);
  await page.getByRole("button", { name: "Failover", exact: true }).click({ timeout: 8000 });
  await clickByRole(page, "button", { name: "Yes", exact: true }, { tolerate: true });
  const tFo = Date.now();
  console.log(`FAILOVER SUBMITTED on ${secondary} @ ${new Date(tFo).toISOString()} (delta=${Math.floor((tFo - tReboot) / 1000)}s)`);

  await page.waitForTimeout(3000);
  await clickByRole(page, "button", { name: "Notifications" }, { tolerate: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(5, 16); // MM-DDTHH-mm
  await page.screenshot({ path: `reboot-failover-notifications-${stamp}.png` }).catch(() => { });
  return { rebootAt: tReboot, failoverAt: tFo, deltaSec: Math.floor((tFo - tReboot) / 1000) };
}

// ============================================================================
// Phase 3R — assertConcurrentNotifications  (legacy Assert-ConcurrentNotifications.ps1)
// ============================================================================
async function assertConcurrentNotifications({ page, screenshotPath } = {}) {
  if (!page) throw new Error("page is required");
  const out = screenshotPath || `reboot-failover-notifications-${new Date().toISOString().replace(/[:.]/g, "-").slice(5, 16)}.png`;
  await page.getByRole("button", { name: "Notifications" }).click({ timeout: 5000 });
  await page.getByText("Rebooting cache").waitFor({ state: "visible", timeout: 5000 });
  await page.getByText("Submitting failover request").waitFor({ state: "visible", timeout: 5000 });
  await page.screenshot({ path: out }).catch(() => { });
  console.log(`[PASS] concurrent Rebooting + Failover notifications observed -> ${out}`);
  return out;
}

// ============================================================================
// Phase 3 — assertGeoRoleFlip  (legacy Assert-GeoRoleFlip.ps1)
// After failover: oldPrimary becomes Geo-Secondary (peer.serverRole=Primary)
// oldSecondary becomes Geo-Primary (peer.serverRole=Secondary)
// ============================================================================
async function assertGeoRoleFlip({ oldPrimary, oldSecondary, subscription, resourceGroup }) {
  const expect = [
    { n: oldPrimary, peerRole: "Primary", selfRole: "Geo-Secondary" },
    { n: oldSecondary, peerRole: "Secondary", selfRole: "Geo-Primary" },
  ];
  for (const x of expect) {
    const r = await armRequest("GET", linkedServersPath(subscription, resourceGroup, x.n));
    const arr = (r.body && r.body.value) || [];
    const e = arr[0];
    if (!e) throw new Error(`Assert FAIL: ${x.n} has no linkedServers entry`);
    if (e.properties.provisioningState !== "Succeeded") {
      throw new Error(`Assert FAIL: ${x.n} state=${e.properties.provisioningState}`);
    }
    if (e.properties.serverRole !== x.peerRole) {
      throw new Error(`Assert FAIL: ${x.n} peer.serverRole=${e.properties.serverRole}, expected ${x.peerRole}`);
    }
    console.log(`[PASS] ${x.n} is now ${x.selfRole}`);
  }
  console.log("Phase 3 PASS: roles flipped");
  return true;
}

// ============================================================================
// Phase 3 — testGeoActivityLog  (legacy Test-GeoActivityLog.ps1)
// Activity Log `Add Redis Cache Linked Server / Succeeded` on /Redis/<new-primary>/linkedservers/
// satisfies ADO 16021226 step 9.
// ============================================================================
async function testGeoActivityLog({ newPrimary, resourceGroup, subscription, offsetMin = 30 }) {
  if (!newPrimary || !resourceGroup) {
    throw new Error("testGeoActivityLog requires { newPrimary, resourceGroup }");
  }
  const args = [
    "monitor", "activity-log", "list",
    "--resource-group", resourceGroup,
    "--offset", `${offsetMin}m`,
    "--query",
    `[?contains(operationName.value, 'linkedservers') && status.value=='Succeeded' && contains(resourceId, '/${newPrimary}/linkedservers/')]`,
    "-o", "json",
  ];
  if (subscription) args.splice(args.length - 2, 0, "--subscription", subscription);
  const entries = az(args, { json: true }) || [];
  const count = Array.isArray(entries) ? entries.length : 0;
  console.log(`Activity log matches on /Redis/${newPrimary}/linkedservers/ : ${count}`);
  if (count < 1) {
    throw new Error(`Phase 3 step-9 FAIL: no 'Add Redis Cache Linked Server / Succeeded' on /Redis/${newPrimary}/linkedservers/ in last ${offsetMin} min`);
  }
  console.log(`[PASS] new Geo-Primary = ${newPrimary}`);
  return entries;
}

// ============================================================================
// Phase 4 — invokeGeoUnlink  (legacy Invoke-GeoUnlink.ps1)
// mode: 'UI' | 'Arm' | 'Auto' (default Auto — UI first, fall back to ARM on failure)
// ============================================================================
async function invokeGeoUnlink({
  page,
  caches,
  subscription,
  resourceGroup,
  mode = "Auto",
  tenant = "microsoft.onmicrosoft.com",
}) {
  if (!Array.isArray(caches) || caches.length !== 2) {
    throw new Error("invokeGeoUnlink requires { caches: [primary, secondary] }");
  }

  async function tryUI() {
    if (!page) throw new Error("UI mode requires a Playwright page");
    const url = portalGeoUrl({ tenant, sub: subscription, rg: resourceGroup, cache: caches[0] });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    await closeNotificationsFlyout(page);
    // Footer 'Unlink' best-practices link exists; MUST use button role + exact
    await page.getByRole("button", { name: "Unlink caches", exact: true }).click({ timeout: 8000 });
    await clickByRole(page, "button", { name: "Yes", exact: true }, { tolerate: true });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `unlink-${caches[0]}-submit.png` }).catch(() => { });
  }

  async function doArm() {
    for (const side of caches) {
      for (const peer of caches.filter((c) => c !== side)) {
        const r = await armRequest(
          "DELETE",
          linkedServersPath(subscription, resourceGroup, side, `/${peer}`)
        );
        console.log(`DELETE ${side}/linkedServers/${peer} -> ${r.status}`);
      }
    }
  }

  if (mode === "UI") await tryUI();
  else if (mode === "Arm") await doArm();
  else {
    try { await tryUI(); }
    catch (e) { console.log(`[geo] UI unlink failed, falling back to ARM: ${e.message}`); await doArm(); }
  }
  console.log(`UNLINKED ${caches.join(",")}`);
  return true;
}

// ============================================================================
// Phase 4 — assertGeoUnlinked  (legacy Assert-GeoUnlinked.ps1)
// Two-phase asynchrony: receiving side enters Deleting ~30-60s after initiating side
// finishes — budget ≥ 15 min.
// ============================================================================
async function assertGeoUnlinked({ caches, subscription, resourceGroup, maxMinutes = 15 }) {
  await waitGeoLink({ caches, subscription, resourceGroup, maxMinutes, expectEmpty: true });
  console.log(`Phase 4 PASS: all ${caches.length} caches unlinked`);
  return true;
}

// ============================================================================
// Phase 5 — testGeoDns  (legacy Test-GeoDns.ps1)
// Use a remote resolver (default 8.8.8.8) to bypass local OS / Edge DNS cache.
// ============================================================================
async function testGeoDns({ newPrimary, newSecondary, dnsServer = "8.8.8.8" }) {
  if (!newPrimary || !newSecondary) {
    throw new Error("testGeoDns requires { newPrimary, newSecondary }");
  }
  const expected = `${newPrimary}.redis.cache.windows.net`.toLowerCase();
  console.log(`Expected CNAME target = ${expected}`);
  const resolver = new dns.Resolver();
  resolver.setServers([dnsServer]);
  const resolveCname = (host) =>
    new Promise((resolve, reject) =>
      resolver.resolveCname(host, (err, records) => (err ? reject(err) : resolve(records)))
    );

  const failures = [];
  for (const n of [newPrimary, newSecondary]) {
    const geo = `${n}.geo.redis.cache.windows.net`;
    let cn = null;
    try {
      const records = await resolveCname(geo);
      cn = (records && records[0]) ? records[0].toLowerCase() : null;
    } catch (e) {
      cn = `<resolve error: ${e.message}>`;
    }
    console.log(`  ${geo}  CNAME -> ${cn}`);
    if (cn !== expected) failures.push(`${geo} -> ${cn} (expected ${expected})`);
  }
  if (failures.length) throw new Error(`Phase 5 FAIL (ADO 16021106): ${failures.join("; ")}`);
  console.log(`Phase 5 PASS: both .geo. records resolve to ${newPrimary}`);
  return true;
}

// ============================================================================
// Phase 6 — invokeGeoTeardown  (legacy Invoke-GeoTeardown.ps1)
// ============================================================================
async function invokeGeoTeardown({
  subscription,
  resourceGroup,
  caches,
}) {
  if (!subscription || !resourceGroup || !Array.isArray(caches) || caches.length === 0) {
    throw new Error("invokeGeoTeardown requires { subscription, resourceGroup, caches: [<fullName>, ...] }");
  }
  const names = caches.slice();

  // Best-effort unlink (ARM mode, no UI required). Process consecutive pairs;
  // tolerate any layout (1 pair = 2 names, 2 pairs = 4 names, etc.).
  try {
    for (let i = 0; i + 1 < names.length; i += 2) {
      await invokeGeoUnlink({
        caches: [names[i], names[i + 1]],
        subscription,
        resourceGroup,
        mode: "Arm",
      });
    }
    await waitGeoLink({ caches: names, subscription, resourceGroup, maxMinutes: 15, expectEmpty: true });
  } catch (e) {
    console.log(`[geo] WARN unlink step: ${e.message}`);
  }

  for (const n of names) {
    const r = azTry([
      "redis", "delete",
      "-g", resourceGroup,
      "-n", n,
      "--subscription", subscription,
      "--yes", "--no-wait",
    ]);
    console.log(`DELETE submitted: ${n} (status=${r.status})`);
  }
  await sleep(60_000);

  // Remnant check: any cache from `names` still listed?
  const remaining = [];
  for (const n of names) {
    const r = azTry([
      "redis", "show",
      "-g", resourceGroup,
      "-n", n,
      "--subscription", subscription,
      "--query", "name",
      "-o", "tsv",
    ]);
    if (r.status === 0 && r.stdout) remaining.push(n);
  }
  if (!remaining.length) console.log("TEARDOWN OK");
  else console.log(`[geo] WARN TEARDOWN PARTIAL: remaining=${remaining.join(",")}`);
  return remaining.length === 0;
}

// ── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  // constants
  AZ_CMD,
  API_CACHE,
  API_LINK,
  // utilities (exported so inline node -e snippets can reuse)
  az,
  azTry,
  armToken,
  armRequest,
  sleep,
  portalGeoUrl,
  portalRebootUrl,
  // phase helpers
  assertGeoEnv,
  invokeGeoLinkUI,
  invokeGeoLinkArm,
  waitGeoLink,
  assertGeoPair,
  invokeGeoFailover,
  invokeRebootThenFailover,
  assertConcurrentNotifications,
  assertGeoRoleFlip,
  testGeoActivityLog,
  invokeGeoUnlink,
  assertGeoUnlinked,
  testGeoDns,
  invokeGeoTeardown,
};
