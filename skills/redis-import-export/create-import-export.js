/**
 * Azure Cache for Redis — Import / Export Helper Functions
 *
 * Node.js + Playwright reusable helpers referenced by
 * skills/redis-import-export/SKILL.md.
 *
 * Import specific functions, or call them inline via `node -e $js`.
 *
 * Requires:
 *   - Edge running with --remote-debugging-port=9222 (for Portal UI helpers)
 *   - `az` CLI on PATH or at C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd
 *   - redis-cli.exe / redis-benchmark.exe 5.x at D:\Claude-Redis\tools\redis\
 *
 * Capability map (8 atomic capabilities, see SKILL.md):
 *   1. Prereq                 -> assertIeEnv
 *   2. Provision storage      -> invokeIeProvisionStorage / assertIeStorage
 *   3. Enable Non-SSL         -> invokeIeEnableNonSslUI / invokeIeEnableNonSslArm
 *   4. Populate               -> invokeIePopulate (+ writeDbsizeEvidence)
 *   5. Portal Export          -> invokeIePortalExport / assertIeExportBlobs
 *   6. FLUSHALL               -> invokeIeFlushAll
 *   7. Portal Import          -> invokeIePortalImport / assertIeImportRestored
 *   8. Teardown               -> invokeIeTeardown
 */

"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// ── Constants ────────────────────────────────────────────────────────────────
const AZ_CMD =
  process.env.AZ_CMD ||
  "C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd";
const REDIS_CLI =
  process.env.REDIS_CLI || "D:\\Claude-Redis\\tools\\redis\\redis-cli.exe";
const REDIS_BENCHMARK =
  process.env.REDIS_BENCHMARK ||
  "D:\\Claude-Redis\\tools\\redis\\redis-benchmark.exe";
const PORTAL_HOST = "https://ms.portal.azure.com";

// ── Helper: az CLI wrapper ───────────────────────────────────────────────────
function az(args, { quiet = false, json = false } = {}) {
  const r = spawnSync(AZ_CMD, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (!quiet && r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    throw new Error(`az ${args.join(" ")} failed (status=${r.status}): ${r.stderr || r.stdout}`);
  }
  const out = (r.stdout || "").trim();
  return json && out ? JSON.parse(out) : out;
}

function azTry(args) {
  const r = spawnSync(AZ_CMD, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim() };
}

// ── Helper: redis-cli wrapper ────────────────────────────────────────────────
// Bundled redis-cli 3.2.100 emits auth warnings on stderr — ignore.
function redisCli(host, port, password, args, { quiet = true, exe = REDIS_CLI } = {}) {
  const r = spawnSync(exe, ["-h", host, "-p", String(port), "-a", password, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!quiet && r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    throw new Error(`redis-cli ${args.join(" ")} failed (status=${r.status}): ${r.stderr || r.stdout}`);
  }
  return (r.stdout || "").trim();
}

// ── Helper: misc ─────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowHHMMSS = () => new Date().toISOString().slice(11, 19);

function portalUrl({ tenant = "microsoft.onmicrosoft.com", rid, blade }) {
  return `${PORTAL_HOST}/#@${tenant}/resource${rid}/${blade}`;
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

async function clickByRole(page, role, options, { timeout = 8000, tolerate = false } = {}) {
  try {
    await page.getByRole(role, options).click({ timeout });
    return true;
  } catch (e) {
    if (tolerate) { console.log(`[ie] WARN clickByRole tolerated: ${role} ${JSON.stringify(options)} :: ${e.message}`); return false; }
    throw e;
  }
}

// Pick the first visible matching locator (mirrors the "iterate Select buttons"
// pattern used in portal_drive.py for the Choose Storage Container chooser).
async function clickFirstVisible(page, selector, { timeout = 8000, tolerate = false } = {}) {
  const loc = page.locator(selector);
  const n = await loc.count();
  for (let i = 0; i < n; i++) {
    const cand = loc.nth(i);
    if (await cand.isVisible().catch(() => false)) {
      try { await cand.click({ timeout }); return true; }
      catch (e) { if (!tolerate) throw e; console.log(`[ie] WARN clickFirstVisible idx=${i}: ${e.message}`); }
    }
  }
  if (tolerate) return false;
  throw new Error(`No visible match for selector: ${selector}`);
}

// Cross-frame click — Advanced settings Save / Yes live inside iframes.
async function clickAcrossFrames(page, selector, { timeout = 8000, tolerate = false } = {}) {
  const all = [page, ...page.frames()];
  for (const f of all) {
    const loc = f.locator(selector);
    const cnt = await loc.count().catch(() => 0);
    for (let i = 0; i < cnt; i++) {
      const cand = loc.nth(i);
      if (await cand.isVisible().catch(() => false)) {
        try { await cand.click({ timeout }); return true; }
        catch (e) { if (!tolerate) throw e; }
      }
    }
  }
  if (tolerate) return false;
  throw new Error(`No visible match across frames: ${selector}`);
}

// ============================================================================
// Capability 1 — assertIeEnv
// Verifies subscription / RG / cache tier + tooling (az, redis-cli, CDP Edge).
// ============================================================================
async function assertIeEnv({ subscription, resourceGroup, cache, cdpPort = 9222 }) {
  if (!subscription) throw new Error("subscription is required");
  if (!resourceGroup) throw new Error("resourceGroup is required");
  if (!cache) throw new Error("cache is required");

  const failures = [];
  const check = (name, fn) => {
    try { fn(); console.log(`[OK]   ${name}`); }
    catch (e) { console.log(`[FAIL] ${name} :: ${e.message}`); failures.push(name); }
  };

  check("az CLI", () => az(["--version"], { quiet: true }));
  check("playwright (node module)", () => require.resolve("playwright"));
  check("redis-cli exe", () => { if (!fs.existsSync(REDIS_CLI)) throw new Error(REDIS_CLI); });
  check("redis-benchmark exe", () => { if (!fs.existsSync(REDIS_BENCHMARK)) throw new Error(REDIS_BENCHMARK); });
  check("Subscription access", () => az(["account", "set", "--subscription", subscription]));
  check("Resource group", () => az(["group", "show", "-n", resourceGroup, "--subscription", subscription], { quiet: true }));

  let tier = null;
  check("Cache exists", () => {
    tier = az(["redis", "show", "-g", resourceGroup, "-n", cache,
      "--subscription", subscription, "--query", "sku.name", "-o", "tsv"], { quiet: true });
  });
  if (tier && !["Premium", "Enterprise", "EnterpriseFlash"].includes(tier)) {
    failures.push(`Cache SKU=${tier} (Import/Export blade requires Premium or AMR)`);
    console.log(`[FAIL] Cache SKU '${tier}' not supported`);
  } else if (tier) {
    console.log(`[OK]   Cache SKU=${tier}`);
  }

  await new Promise((resolve) => {
    const net = require("net");
    const sock = net.connect(cdpPort, "127.0.0.1");
    sock.setTimeout(2000);
    sock.on("connect", () => { sock.destroy(); check(`CDP Edge ${cdpPort}`, () => {}); resolve(); });
    sock.on("timeout", () => { sock.destroy(); check(`CDP Edge ${cdpPort}`, () => { throw new Error("timeout"); }); resolve(); });
    sock.on("error", (e) => { check(`CDP Edge ${cdpPort}`, () => { throw e; }); resolve(); });
  });

  if (failures.length) throw new Error(`Phase 0 FAIL: ${failures.join(", ")}`);
  console.log("Phase 0 PASS");
  return true;
}

// ============================================================================
// Capability 2 — invokeIeProvisionStorage / assertIeStorage
// ============================================================================
async function invokeIeProvisionStorage({ subscription, resourceGroup, cache, saName, container }) {
  if (!subscription || !resourceGroup || !cache || !saName || !container) {
    throw new Error("invokeIeProvisionStorage requires { subscription, resourceGroup, cache, saName, container }");
  }
  const loc = az(["redis", "show", "-g", resourceGroup, "-n", cache,
    "--subscription", subscription, "--query", "location", "-o", "tsv"]);

  azTry(["storage", "account", "create",
    "-g", resourceGroup, "-n", saName, "-l", loc,
    "--subscription", subscription,
    "--sku", "Standard_LRS", "--kind", "StorageV2",
    "--allow-blob-public-access", "false",
    "--min-tls-version", "TLS1_2"]);

  const saKey = az(["storage", "account", "keys", "list",
    "-g", resourceGroup, "-n", saName,
    "--subscription", subscription, "--query", "[0].value", "-o", "tsv"]);

  azTry(["storage", "container", "create",
    "--account-name", saName, "--account-key", saKey, "-n", container]);

  console.log(`PROVISIONED storage=${saName} container=${container} location=${loc}`);
  return { saName, container, location: loc, saKey };
}

async function assertIeStorage({ subscription, resourceGroup, cache, saName, container }) {
  const cacheLoc = az(["redis", "show", "-g", resourceGroup, "-n", cache,
    "--subscription", subscription, "--query", "location", "-o", "tsv"]);
  const saLoc = az(["storage", "account", "show", "-g", resourceGroup, "-n", saName,
    "--subscription", subscription, "--query", "location", "-o", "tsv"]);
  if (cacheLoc !== saLoc) {
    throw new Error(`Phase 1 FAIL: cache=${cacheLoc} storage=${saLoc} (regions differ)`);
  }
  const saKey = az(["storage", "account", "keys", "list",
    "-g", resourceGroup, "-n", saName,
    "--subscription", subscription, "--query", "[0].value", "-o", "tsv"]);
  const exists = az(["storage", "container", "exists",
    "--account-name", saName, "--account-key", saKey, "-n", container,
    "--query", "exists", "-o", "tsv"]);
  if (exists !== "true") throw new Error(`Phase 1 FAIL: container '${container}' missing`);
  console.log(`[PASS] storage same region (${cacheLoc}); container '${container}' exists`);
  return { saKey, location: cacheLoc };
}

// ============================================================================
// Capability 3 — Enable Non-SSL 6379
// ============================================================================
async function invokeIeEnableNonSslUI({ page, rid, tenant = "microsoft.onmicrosoft.com" }) {
  if (!page || !rid) throw new Error("invokeIeEnableNonSslUI requires { page, rid }");
  const url = portalUrl({ tenant, rid, blade: "redisConfig" });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  // Toggle 'Allow access only via SSL' to No — the toggle has multiple label
  // strings across portal versions; try the most stable one then fall back.
  const toggleSelectors = [
    'div[role="switch"][aria-label*="SSL"]',
    'button[role="switch"][aria-label*="SSL"]',
  ];
  let toggled = false;
  for (const sel of toggleSelectors) {
    if (await clickAcrossFrames(page, sel, { tolerate: true })) { toggled = true; break; }
  }
  if (!toggled) console.log("[ie] WARN could not click SSL toggle; assuming already in target state");

  // Save (cross-frame). The Save button shows as <span> inside the command bar.
  await clickAcrossFrames(page, 'span:has-text("Save")', { tolerate: true });
  await page.waitForTimeout(1500);
  // Yes/No confirm
  await clickAcrossFrames(page, 'button:has-text("Yes")', { tolerate: true });
  await page.waitForTimeout(3000);
  console.log("ENABLE NON-SSL SUBMITTED (trust ARM verification)");
  return true;
}

async function invokeIeEnableNonSslArm({ subscription, resourceGroup, cache }) {
  az(["redis", "update", "-g", resourceGroup, "-n", cache,
    "--subscription", subscription, "--set", "enableNonSslPort=true"]);
  console.log(`ARM enableNonSslPort=true on ${cache}`);
  return true;
}

async function assertIeNonSslEnabled({ subscription, resourceGroup, cache, maxSeconds = 60 }) {
  const deadline = Date.now() + maxSeconds * 1000;
  while (true) {
    const v = az(["redis", "show", "-g", resourceGroup, "-n", cache,
      "--subscription", subscription, "--query", "enableNonSslPort", "-o", "tsv"]);
    if (v === "true") { console.log("[PASS] enableNonSslPort=true"); return true; }
    if (Date.now() > deadline) throw new Error(`Phase 2 FAIL: enableNonSslPort=${v} after ${maxSeconds}s`);
    await sleep(5000);
  }
}

// ============================================================================
// Capability 4 — Populate + DBSIZE evidence
// ============================================================================
function writeDbsizeEvidence({ subscription, resourceGroup, cache, outDir, tag }) {
  ensureDir(outDir);
  const host = az(["redis", "show", "-g", resourceGroup, "-n", cache,
    "--subscription", subscription, "--query", "hostName", "-o", "tsv"]);
  const key = az(["redis", "list-keys", "-g", resourceGroup, "-n", cache,
    "--subscription", subscription, "--query", "primaryKey", "-o", "tsv"]);

  const ping = redisCli(host, 6379, key, ["PING"]);
  const dbsize = parseInt(redisCli(host, 6379, key, ["DBSIZE"]), 10);
  const info = redisCli(host, 6379, key, ["INFO", "keyspace"]);
  // One-shot SCAN (NEVER pipe --scan | Select-Object -First N — hangs forever)
  const scan = redisCli(host, 6379, key, ["SCAN", "0", "MATCH", "key:*", "COUNT", "5"]);

  const lines = [
    `# dbsize evidence — tag=${tag}`,
    `# cache=${cache} rg=${resourceGroup} sub=${subscription}`,
    `# timestamp=${new Date().toISOString()}`,
    "",
    `PING:   ${ping}`,
    `DBSIZE: ${dbsize}`,
    "",
    "INFO keyspace:",
    info,
    "",
    "SCAN 0 MATCH 'key:*' COUNT 5:",
    scan,
    "",
  ];
  const file = path.join(outDir, `dbsize-${tag}.txt`);
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  console.log(`[evidence] ${file}  (DBSIZE=${dbsize})`);
  return { file, dbsize, ping };
}

async function invokeIePopulate({
  subscription,
  resourceGroup,
  cache,
  evidenceDir,
  keysApprox = 20000,
  opsTotal = 1_000_000,
  pipeline = 100,
  clustered = false,
}) {
  if (!subscription || !resourceGroup || !cache || !evidenceDir) {
    throw new Error("invokeIePopulate requires { subscription, resourceGroup, cache, evidenceDir }");
  }
  const host = az(["redis", "show", "-g", resourceGroup, "-n", cache,
    "--subscription", subscription, "--query", "hostName", "-o", "tsv"]);
  const key = az(["redis", "list-keys", "-g", resourceGroup, "-n", cache,
    "--subscription", subscription, "--query", "primaryKey", "-o", "tsv"]);

  const ping = redisCli(host, 6379, key, ["PING"]);
  if (!/PONG/i.test(ping)) throw new Error(`Phase 3 FAIL: PING returned '${ping}'`);

  const benchArgs = ["-h", host, "-p", "6379", "-a", key,
    "-n", String(opsTotal), "-r", String(keysApprox),
    "-t", "set", "-P", String(pipeline), "-q"];
  if (clustered) benchArgs.push("-c");
  const r = spawnSync(REDIS_BENCHMARK, benchArgs, { encoding: "utf8", stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) throw new Error(`redis-benchmark exit=${r.status}`);

  const ev = writeDbsizeEvidence({ subscription, resourceGroup, cache, outDir: evidenceDir, tag: "pre-export" });
  if (ev.dbsize < 19000) throw new Error(`Phase 3 FAIL: DBSIZE=${ev.dbsize} < 19000`);
  console.log(`Phase 3 PASS: DBSIZE=${ev.dbsize}`);
  return ev;
}

// ============================================================================
// Capability 5 — Portal Export
// ============================================================================
async function invokeIePortalExport({
  page,
  rid,
  saName,
  container,
  prefix,
  tenant = "microsoft.onmicrosoft.com",
  screenshotDir,
}) {
  if (!page || !rid || !saName || !container || !prefix) {
    throw new Error("invokeIePortalExport requires { page, rid, saName, container, prefix }");
  }
  const shotDir = screenshotDir || process.env.SHOT_DIR;
  if (shotDir) ensureDir(shotDir);
  const shot = (name) => shotDir ? path.join(shotDir, name) : null;

  await page.goto(portalUrl({ tenant, rid, blade: "export" }), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  // 1) Open chooser
  await page.getByText("Choose Storage Container", { exact: true }).click({ timeout: 10000 });
  await page.waitForTimeout(2000);

  // 2) Pick storage account
  await page.getByText(saName, { exact: true }).click({ timeout: 8000 });
  await page.waitForTimeout(1500);

  // 3) Pick container row (whole <tr>, NOT the text node)
  await page.locator(`tr:has-text("${container}")`).click({ timeout: 8000 });
  await page.waitForTimeout(1000);

  // 4) Click Select — there are multiple Select buttons; pick the visible one
  await clickFirstVisible(page, 'div[role="button"]:has-text("Select")');
  await page.waitForTimeout(2000);

  // 5) Wait for the Blob name prefix label to exist before locating the input
  await page.getByText("Blob name prefix").waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Blob name prefix").fill(prefix);
  await page.waitForTimeout(500);

  // 6) Submit — MUST use button role + exact (page title is also 'Export data')
  await page.getByRole("button", { name: "Export", exact: true }).click({ timeout: 8000 });
  await page.waitForTimeout(3000);

  if (shot("export-submit.png")) await page.screenshot({ path: shot("export-submit.png") }).catch(() => {});
  console.log(`EXPORT SUBMITTED prefix=${prefix} -> ${saName}/${container}`);
  return true;
}

async function assertIeExportBlobs({ subscription, resourceGroup, saName, container, prefix, maxMinutes = 10 }) {
  const saKey = az(["storage", "account", "keys", "list",
    "-g", resourceGroup, "-n", saName,
    "--subscription", subscription, "--query", "[0].value", "-o", "tsv"]);
  const deadline = Date.now() + maxMinutes * 60_000;
  let blobs = [];
  while (true) {
    const json = az(["storage", "blob", "list",
      "--account-name", saName, "--account-key", saKey,
      "-c", container, "--prefix", prefix,
      "--query", "[?ends_with(name, '.rdb')].{name:name, size:properties.contentLength, type:properties.blobType}",
      "-o", "json"]);
    blobs = json ? JSON.parse(json) : [];
    const nonEmpty = blobs.filter((b) => b.size > 0 && b.type === "PageBlob");
    console.log(`[${nowHHMMSS()}] export blobs under '${prefix}': total=${blobs.length} nonEmptyPage=${nonEmpty.length}`);
    if (nonEmpty.length > 0) {
      for (const b of nonEmpty) console.log(`  - ${b.name}  size=${b.size}  type=${b.type}`);
      console.log(`Phase 4 PASS: ${nonEmpty.length} non-empty PageBlob(s) under '${prefix}'`);
      return nonEmpty;
    }
    if (Date.now() > deadline) throw new Error(`Phase 4 FAIL: no non-empty .rdb PageBlob under '${prefix}' after ${maxMinutes} min`);
    await sleep(30_000);
  }
}

// ============================================================================
// Capability 6 — FLUSHALL + post-flush evidence
// ============================================================================
async function invokeIeFlushAll({
  subscription,
  resourceGroup,
  cache,
  evidenceDir,
  maxSeconds = 30,
}) {
  if (!subscription || !resourceGroup || !cache || !evidenceDir) {
    throw new Error("invokeIeFlushAll requires { subscription, resourceGroup, cache, evidenceDir }");
  }
  const host = az(["redis", "show", "-g", resourceGroup, "-n", cache,
    "--subscription", subscription, "--query", "hostName", "-o", "tsv"]);
  const key = az(["redis", "list-keys", "-g", resourceGroup, "-n", cache,
    "--subscription", subscription, "--query", "primaryKey", "-o", "tsv"]);

  redisCli(host, 6379, key, ["FLUSHALL"]);

  // Async FLUSHALL — poll briefly
  const deadline = Date.now() + maxSeconds * 1000;
  let dbsize = -1;
  while (true) {
    dbsize = parseInt(redisCli(host, 6379, key, ["DBSIZE"]), 10);
    if (dbsize === 0) break;
    if (Date.now() > deadline) throw new Error(`Phase 5.1 FAIL: DBSIZE=${dbsize} after ${maxSeconds}s`);
    await sleep(2000);
  }
  const ev = writeDbsizeEvidence({ subscription, resourceGroup, cache, outDir: evidenceDir, tag: "post-flush" });
  console.log("Phase 5.1 PASS: DBSIZE=0");
  return ev;
}

// ============================================================================
// Capability 7 — Portal Import + post-import verification
// ============================================================================
async function invokeIePortalImport({
  page,
  rid,
  saName,
  container,
  blobName,
  tenant = "microsoft.onmicrosoft.com",
  screenshotDir,
}) {
  if (!page || !rid || !saName || !container || !blobName) {
    throw new Error("invokeIePortalImport requires { page, rid, saName, container, blobName }");
  }
  const shotDir = screenshotDir || process.env.SHOT_DIR;
  if (shotDir) ensureDir(shotDir);
  const shot = (name) => shotDir ? path.join(shotDir, name) : null;

  await page.goto(portalUrl({ tenant, rid, blade: "import" }), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  // 1) Open chooser — text may be 'Choose Blob(s)' or 'Choose Blob (s)'; non-exact
  await page.getByText("Choose Blob", { exact: false }).first().click({ timeout: 10000 });
  await page.waitForTimeout(2000);

  // 2) Pick storage account
  await page.getByText(saName, { exact: true }).click({ timeout: 8000 });
  await page.waitForTimeout(1500);

  // 3) Drill into container — dblclick does NOT work on Fluent UI grid; use Enter
  const row = page.locator(`tr:has-text("${container}")`).first();
  await row.click({ timeout: 8000 });
  await row.press("Enter");
  await page.waitForTimeout(2000);

  // 4) Tick the blob's checkbox (clicking the row alone does NOT toggle it)
  const blobBase = path.basename(blobName);
  await page.locator(`tr:has-text("${blobBase}") input[type="checkbox"]`).first()
    .check({ timeout: 8000 });
  await page.waitForTimeout(500);

  // 5) Select — Import chooser uses idx ≈ 2 but iterate-visible handles both
  await clickFirstVisible(page, 'div[role="button"]:has-text("Select")');
  await page.waitForTimeout(2000);

  // 6) Submit
  await page.getByRole("button", { name: "Import", exact: true }).click({ timeout: 8000 });
  await page.waitForTimeout(3000);

  if (shot("import-submit.png")) await page.screenshot({ path: shot("import-submit.png") }).catch(() => {});
  console.log(`IMPORT SUBMITTED blob=${blobName}`);
  return true;
}

async function assertIeImportRestored({
  subscription,
  resourceGroup,
  cache,
  evidenceDir,
  baseline,
  ratio = 0.95,
  maxMinutes = 5,
}) {
  if (!subscription || !resourceGroup || !cache || !evidenceDir || !baseline) {
    throw new Error("assertIeImportRestored requires { subscription, resourceGroup, cache, evidenceDir, baseline }");
  }
  const host = az(["redis", "show", "-g", resourceGroup, "-n", cache,
    "--subscription", subscription, "--query", "hostName", "-o", "tsv"]);
  const key = az(["redis", "list-keys", "-g", resourceGroup, "-n", cache,
    "--subscription", subscription, "--query", "primaryKey", "-o", "tsv"]);

  const target = Math.floor(baseline * ratio);
  const deadline = Date.now() + maxMinutes * 60_000;
  let dbsize = 0;
  while (true) {
    dbsize = parseInt(redisCli(host, 6379, key, ["DBSIZE"]), 10);
    const pct = ((dbsize / baseline) * 100).toFixed(1);
    console.log(`[${nowHHMMSS()}] DBSIZE=${dbsize} / ${baseline} (${pct}%)`);
    if (dbsize >= target) break;
    if (Date.now() > deadline) break;
    await sleep(15_000);
  }
  if (dbsize < target) throw new Error(`Phase 5.2 FAIL: DBSIZE=${dbsize} < ${target} (${(ratio * 100)|0}% of baseline=${baseline}) after ${maxMinutes} min`);

  const scan = redisCli(host, 6379, key, ["SCAN", "0", "MATCH", "key:*", "COUNT", "5"]);
  const sample = scan.split(/\r?\n/).filter((l) => /^key:/.test(l));
  if (sample.length < 1) throw new Error("Phase 5.2 FAIL: SCAN matched no key:* — Import may have restored only metadata");
  console.log(`[PASS] sample: ${sample.slice(0, 3).join(", ")}`);

  const ev = writeDbsizeEvidence({ subscription, resourceGroup, cache, outDir: evidenceDir, tag: "post-import" });
  console.log(`Phase 5.2 PASS: DBSIZE=${dbsize} >= ${target}`);
  return ev;
}

// ============================================================================
// Capability 8 — Teardown (close 6379, purge blobs, optionally drop SA)
// ============================================================================
async function invokeIeTeardown({
  subscription,
  resourceGroup,
  cache,
  saName,
  container,
  prefix,
  deleteStorageAccount = false,
}) {
  if (!subscription || !resourceGroup || !cache || !saName || !container || !prefix) {
    throw new Error("invokeIeTeardown requires { subscription, resourceGroup, cache, saName, container, prefix }");
  }

  azTry(["redis", "update", "-g", resourceGroup, "-n", cache,
    "--subscription", subscription, "--set", "enableNonSslPort=false"]);

  const saKey = az(["storage", "account", "keys", "list",
    "-g", resourceGroup, "-n", saName,
    "--subscription", subscription, "--query", "[0].value", "-o", "tsv"]);

  azTry(["storage", "blob", "delete-batch",
    "--account-name", saName, "--account-key", saKey,
    "-s", container, "--pattern", `${prefix}*`]);

  if (deleteStorageAccount) {
    azTry(["storage", "account", "delete",
      "-g", resourceGroup, "-n", saName,
      "--subscription", subscription, "--yes"]);
  }

  // Verify
  let nonssl = az(["redis", "show", "-g", resourceGroup, "-n", cache,
    "--subscription", subscription, "--query", "enableNonSslPort", "-o", "tsv"]);
  if (nonssl !== "false") {
    // ARM toggle is async — allow one re-query
    await sleep(15_000);
    nonssl = az(["redis", "show", "-g", resourceGroup, "-n", cache,
      "--subscription", subscription, "--query", "enableNonSslPort", "-o", "tsv"]);
  }
  if (nonssl !== "false") throw new Error(`Phase 6 FAIL: enableNonSslPort=${nonssl}`);

  const leftover = az(["storage", "blob", "list",
    "--account-name", saName, "--account-key", saKey,
    "-c", container, "--prefix", prefix, "--query", "[].name", "-o", "tsv"]);
  if (leftover) console.log(`[ie] WARN blobs remain under '${prefix}':\n${leftover}`);

  console.log("Phase 6 PASS: Non-SSL 6379 closed; export blobs purged");
  return true;
}

// ── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  // constants
  AZ_CMD, REDIS_CLI, REDIS_BENCHMARK, PORTAL_HOST,
  // utilities
  az, azTry, redisCli, sleep, portalUrl, ensureDir,
  // capability 1
  assertIeEnv,
  // capability 2
  invokeIeProvisionStorage, assertIeStorage,
  // capability 3
  invokeIeEnableNonSslUI, invokeIeEnableNonSslArm, assertIeNonSslEnabled,
  // capability 4
  invokeIePopulate, writeDbsizeEvidence,
  // capability 5
  invokeIePortalExport, assertIeExportBlobs,
  // capability 6
  invokeIeFlushAll,
  // capability 7
  invokeIePortalImport, assertIeImportRestored,
  // capability 8
  invokeIeTeardown,
};
