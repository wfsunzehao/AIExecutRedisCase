/**
 * Azure Cache for Redis — Persistence (AOF + RDB) Helper Functions
 *
 * Node.js + Playwright reusable helpers referenced by skills/redis-persistence/SKILL.md.
 * Import specific functions, or call them inline via `node -e $js`.
 *
 * Requires:
 *   - Edge running with --remote-debugging-port=9222 (for Portal UI helpers)
 *   - `az` CLI on PATH or at C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd
 *   - redis-cli.exe / redis-benchmark.exe under D:\Claude-Redis\tools\redis\ (5.x build)
 *
 * Mapping from the legacy PowerShell scripts (Claude-Redis/scripts/*.ps1):
 *   Assert-PersistenceEnv.ps1        -> assertPersistenceEnv
 *   New-PersistenceCaches.ps1        -> invokePersistenceCacheProvision
 *   New-PersistenceStorage.ps1       -> invokePersistenceStorageProvision
 *   Enable-RedisNonSslPortUI.ps1     -> invokePersistenceEnableNonSslUI / Arm
 *   Enable-RedisPersistenceUI.ps1    -> invokePersistenceEnableUI
 *   Wait-CachePersistenceReady.ps1   -> waitPersistenceReady
 *   Invoke-RedisPopulate.ps1         -> invokePersistencePopulate
 *   Assert-PersistenceBlob.ps1       -> assertPersistenceBlob
 *   Invoke-PersistenceTeardown.ps1   -> invokePersistenceTeardown
 */

"use strict";

const { spawnSync } = require("child_process");
const https = require("https");
const net = require("net");
const fs = require("fs");
const path = require("path");

// ── Constants ────────────────────────────────────────────────────────────────
const AZ_CMD =
  process.env.AZ_CMD ||
  "C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd";
const REDIS_TOOLS_DIR =
  process.env.REDIS_TOOLS_DIR || "D:\\Claude-Redis\\tools\\redis";
const REDIS_CLI = path.join(REDIS_TOOLS_DIR, "redis-cli.exe");
const REDIS_BENCHMARK = path.join(REDIS_TOOLS_DIR, "redis-benchmark.exe");
const API_CACHE = "2024-03-01";
const ARM_HOST = "management.azure.com";
const PORTAL_HOST = "ms.portal.azure.com";

// ── Helper: az / redis-cli wrappers ──────────────────────────────────────────
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

function redisCli(host, port, password, args) {
  const r = spawnSync(REDIS_CLI, ["-h", host, "-p", String(port), "-a", password, ...args],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim() };
}

// ── Helper: ARM REST via management bearer token ─────────────────────────────
let _cachedToken = null;
function armToken() {
  if (_cachedToken && _cachedToken.expiresAt > Date.now() + 60_000) return _cachedToken.value;
  const t = az([
    "account", "get-access-token",
    "--resource", "https://management.azure.com/",
    "--query", "accessToken", "-o", "tsv",
  ]);
  _cachedToken = { value: t, expiresAt: Date.now() + 50 * 60_000 };
  return t;
}

function armRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = https.request(
      {
        host: ARM_HOST, method, path,
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

const cachePath = (sub, rg, cache) =>
  `/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.Cache/Redis/${cache}?api-version=${API_CACHE}`;

// ── Helper: misc ─────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowHHMMSS = () => new Date().toISOString().slice(11, 19);

function ensureDir(p) {
  if (p && !fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function portalUrl({ tenant = "microsoft.onmicrosoft.com", rid, blade }) {
  return `https://${PORTAL_HOST}/#@${tenant}/resource${rid}/${blade}`;
}

function ridOf({ subscription, resourceGroup, cache }) {
  return `/subscriptions/${subscription}/resourceGroups/${resourceGroup}/providers/Microsoft.Cache/Redis/${cache}`;
}

function persistenceContainer(cache) {
  return `${cache.toLowerCase()}-redis-persistence`;
}

function redisConfigValue(config, ...names) {
  if (!config) return undefined;
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(config, name)) return config[name];
  }
  return undefined;
}

// ── Helper: tolerant locator click ───────────────────────────────────────────
async function clickByRole(page, role, options, { timeout = 8000, tolerate = false } = {}) {
  try {
    await page.getByRole(role, options).click({ timeout });
    return true;
  } catch (e) {
    if (tolerate) {
      console.log(`[pers] WARN clickByRole tolerated: ${role} ${JSON.stringify(options)} :: ${e.message}`);
      return false;
    }
    throw e;
  }
}

async function clickAcrossFrames(page, selector, { timeout = 8000, tolerate = false } = {}) {
  // Advanced settings / Persistence Save / Yes confirmations live inside iframes.
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const f of page.frames()) {
      try {
        const loc = f.locator(selector).first();
        if (await loc.isVisible({ timeout: 500 }).catch(() => false)) {
          await loc.click({ timeout: 2000 });
          return true;
        }
      } catch { /* try next frame */ }
    }
    await sleep(300);
  }
  if (tolerate) {
    console.log(`[pers] WARN clickAcrossFrames tolerated: '${selector}' not found in any frame`);
    return false;
  }
  throw new Error(`clickAcrossFrames: '${selector}' not found in any frame within ${timeout}ms`);
}

// ============================================================================
// Capability 1 — assertPersistenceEnv  (legacy Assert-PersistenceEnv.ps1)
// ============================================================================
async function assertPersistenceEnv({
  subscription, resourceGroup, cdpPort = 9222,
  redisToolsDir = REDIS_TOOLS_DIR,
}) {
  if (!subscription) throw new Error("subscription is required");
  if (!resourceGroup) throw new Error("resourceGroup is required");
  const failures = [];

  const check = (name, fn) => {
    try { fn(); console.log(`[OK]   ${name}`); }
    catch (e) { console.log(`[FAIL] ${name} :: ${e.message}`); failures.push(name); }
  };

  check("az CLI", () => az(["--version"], { quiet: true }));
  check("playwright (node module)", () => require.resolve("playwright"));
  check("redis-cli.exe", () => { if (!fs.existsSync(path.join(redisToolsDir, "redis-cli.exe"))) throw new Error("missing"); });
  check("redis-benchmark.exe", () => { if (!fs.existsSync(path.join(redisToolsDir, "redis-benchmark.exe"))) throw new Error("missing"); });
  check("Subscription access", () => az(["account", "set", "--subscription", subscription]));
  check("Resource group", () => az(["group", "show", "-n", resourceGroup, "--subscription", subscription], { quiet: true }));

  await new Promise((resolve) => {
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
// Capability 2 — invokePersistenceCacheProvision  (legacy New-PersistenceCaches.ps1)
// PUTs Premium P1 caches with API 2024-03-01: aad=off, public+keys on,
// disableAccessKeyAuthentication=false. Polls until every cache is Succeeded.
// ============================================================================
async function invokePersistenceCacheProvision({
  subscription, resourceGroup,
  caches,                       // [{ name, location }]
  maxMinutes = 60, pollSec = 180,
}) {
  if (!subscription || !resourceGroup) throw new Error("subscription / resourceGroup required");
  if (!Array.isArray(caches) || !caches.length) throw new Error("caches must be a non-empty array of { name, location }");

  az(["account", "set", "--subscription", subscription]);

  for (const c of caches) {
    if (!c.name || !c.location) throw new Error("each cache requires { name, location }");
    const body = {
      location: c.location,
      properties: {
        sku: { name: "Premium", family: "P", capacity: 1 },
        redisVersion: "latest",
        enableNonSslPort: false,
        minimumTlsVersion: "1.2",
        publicNetworkAccess: "Enabled",
        disableAccessKeyAuthentication: false,
        redisConfiguration: { "aad-enabled": "false" },
      },
    };
    const r = await armRequest("PUT", cachePath(subscription, resourceGroup, c.name), body);
    const ps = r.body && r.body.properties && r.body.properties.provisioningState;
    console.log(`PUT ${c.name.padEnd(32)} ${r.status} ${ps || ""}`);
    if (r.status >= 400) throw new Error(`PUT ${c.name} HTTP=${r.status}: ${r.raw}`);
  }

  // Existence check via list
  const expected = caches.map(c => c.name);
  const all = az(["redis", "list", "-g", resourceGroup, "--subscription", subscription, "-o", "json"], { json: true });
  const listed = all.filter(x => expected.includes(x.name)).map(x => x.name);
  const missing = expected.filter(n => !listed.includes(n));
  if (missing.length) throw new Error(`FAIL: missing after PUT: ${missing.join(", ")}`);

  // Poll
  const deadline = Date.now() + maxMinutes * 60_000;
  let rows;
  while (true) {
    rows = az(["redis", "list", "-g", resourceGroup, "--subscription", subscription, "-o", "json"], { json: true })
      .filter(x => expected.includes(x.name));
    const pending = rows.filter(r => r.provisioningState !== "Succeeded");
    console.log(`[${nowHHMMSS()}] pending=${pending.length}/${rows.length} -> ${pending.map(p => p.name).join(", ")}`);
    if (!pending.length) break;
    if (Date.now() > deadline) throw new Error(`FAIL: timeout, pending=${pending.map(p => p.name).join(", ")}`);
    await sleep(pollSec * 1000);
  }

  for (const r of rows) {
    if (r.sku.name !== "Premium") throw new Error(`FAIL: ${r.name} sku=${r.sku.name}`);
    const aad = r.redisConfiguration && r.redisConfiguration["aad-enabled"];
    if (aad !== "false") throw new Error(`FAIL: ${r.name} aad-enabled=${aad}`);
    if (r.publicNetworkAccess !== "Enabled") throw new Error(`FAIL: ${r.name} publicNetworkAccess=${r.publicNetworkAccess}`);
    if (r.disableAccessKeyAuthentication !== false) throw new Error(`FAIL: ${r.name} disableAccessKeyAuthentication=${r.disableAccessKeyAuthentication}`);
  }
  console.log(`PASS: ${rows.length}/${expected.length} Premium caches Succeeded; Public+Keys=on, AAD=off`);
  return true;
}

// ============================================================================
// Capability 3 — invokePersistenceStorageProvision  (legacy New-PersistenceStorage.ps1)
// ============================================================================
async function invokePersistenceStorageProvision({
  subscription, resourceGroup, name, location = "centraluseuap",
}) {
  if (!subscription || !resourceGroup || !name) throw new Error("subscription / resourceGroup / name required");

  const existing = az(["storage", "account", "list", "-g", resourceGroup, "--subscription", subscription, "-o", "json"], { json: true })
    .find(x => x.name === name);
  if (existing) {
    console.log(`STORAGE ${name} already exists (provisioningState=${existing.provisioningState})`);
  } else {
    az([
      "storage", "account", "create",
      "-g", resourceGroup, "-n", name, "--subscription", subscription,
      "--location", location, "--sku", "Standard_LRS", "--kind", "StorageV2",
      "--allow-blob-public-access", "true", "--min-tls-version", "TLS1_2",
      "-o", "none",
    ]);
    console.log(`STORAGE ${name} created in ${location}`);
  }

  const j = az(["storage", "account", "show", "-g", resourceGroup, "-n", name, "--subscription", subscription, "-o", "json"], { json: true });
  if (j.provisioningState !== "Succeeded") throw new Error(`FAIL: ${name} provisioningState=${j.provisioningState}`);
  console.log(`PASS: ${name} Succeeded`);
  return true;
}

// ============================================================================
// Capability 4 — invokePersistenceEnableNonSslUI  (Advanced settings blade)
// Flip enableNonSslPort=true via Portal UI; ARM fallback below.
// ============================================================================
async function invokePersistenceEnableNonSslUI({
  page, subscription, resourceGroup, cache, tenant = "microsoft.onmicrosoft.com",
}) {
  if (!page) throw new Error("page (Playwright Page) is required");
  const rid = ridOf({ subscription, resourceGroup, cache });
  const url = portalUrl({ tenant, rid, blade: "redisConfig" });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  // Toggle: "Allow access only via SSL" -> Off (==> nonSslPort enabled)
  // The blade exposes a toggle / checkbox; iterate frames for the label.
  const toggleSelectors = [
    'div[role="switch"][aria-label*="Allow access only via SSL"]',
    'div[role="switch"][aria-label*="non-SSL"]',
    'input[type="checkbox"][aria-label*="Allow access only via SSL"]',
  ];
  let toggled = false;
  for (const sel of toggleSelectors) {
    if (await clickAcrossFrames(page, sel, { timeout: 4000, tolerate: true })) { toggled = true; break; }
  }
  if (!toggled) console.log("[pers] WARN: SSL-only toggle not located by aria-label; relying on Save+ARM verify.");

  await clickAcrossFrames(page, 'span:has-text("Save")', { timeout: 8000 });
  await clickAcrossFrames(page, 'button:has-text("Yes")', { timeout: 6000, tolerate: true });
  await page.waitForTimeout(3000);
  console.log(`UI: Save submitted on ${cache} redisConfig blade`);
  return true;
}

async function invokePersistenceEnableNonSslArm({ subscription, resourceGroup, cache }) {
  az(["redis", "update", "-g", resourceGroup, "-n", cache, "--subscription", subscription,
      "--set", "enableNonSslPort=true"]);
  console.log(`ARM: enableNonSslPort=true set on ${cache}`);
  return true;
}

async function assertPersistenceNonSslEnabled({
  subscription, resourceGroup, cache, maxSeconds = 60,
}) {
  const deadline = Date.now() + maxSeconds * 1000;
  while (true) {
    const v = az(["redis", "show", "-g", resourceGroup, "-n", cache,
                  "--subscription", subscription, "--query", "enableNonSslPort", "-o", "tsv"]);
    if (v === "true") { console.log(`[PASS] ${cache} enableNonSslPort=true`); return true; }
    if (Date.now() > deadline) throw new Error(`FAIL: enableNonSslPort=${v} after ${maxSeconds}s`);
    await sleep(5000);
  }
}

// ============================================================================
// Capability 5 — invokePersistenceEnableUI  (legacy Enable-RedisPersistenceUI.ps1)
// Open .../persistence blade, pick AOF or RDB radio, optionally pick RDB
// frequency, pick Storage Account, Save.
// ============================================================================
async function invokePersistenceEnableUI({
  page, subscription, resourceGroup, cache,
  mode,                        // "AOF" | "RDB"
  storageAccount,
  rdbFrequencyMin = 15,
  tenant = "microsoft.onmicrosoft.com",
  screenshotDir,
}) {
  if (!page) throw new Error("page (Playwright Page) is required");
  if (!subscription || !resourceGroup || !cache) throw new Error("subscription / resourceGroup / cache required");
  if (mode !== "AOF" && mode !== "RDB") throw new Error("mode must be 'AOF' or 'RDB'");
  if (!storageAccount) throw new Error("storageAccount is required");

  const shotDir = screenshotDir || `D:\\Claude-Redis\\screenshots\\${cache}`;
  ensureDir(shotDir);

  const rid = ridOf({ subscription, resourceGroup, cache });
  await page.goto(portalUrl({ tenant, rid, blade: "persistence" }), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);

  const radioLabel = mode === "AOF" ? "Append-only file (AOF)" : "Redis Database (RDB)";
  await page.getByRole("radio", { name: radioLabel }).click({ timeout: 8000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(shotDir, `pers-${cache}-${mode}-open.png`) }).catch(() => {});

  if (mode === "RDB") {
    const freqBox = page.getByRole("combobox", { name: /Backup Frequency/i }).first();
    try {
      await freqBox.click({ timeout: 6000 });
      await page.waitForTimeout(1500);
      // Frequency option list — items are typically treeitem, fall back to text
      const freqOption = page.getByRole("treeitem", { name: new RegExp(`${rdbFrequencyMin}\\s*Minutes`, "i") });
      if (await freqOption.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await freqOption.first().click({ timeout: 5000 });
      } else {
        await page.getByText(`${rdbFrequencyMin} Minutes`, { exact: false }).first().click({ timeout: 5000 });
      }
      await page.waitForTimeout(1500);
    } catch (e) {
      console.log(`[pers] WARN: backup-frequency picker not located: ${e.message}`);
    }
  }

  // Storage Account combobox (label varies: "Storage Account" / "First Storage Account")
  let saCombo = page.getByRole("combobox", { name: /Storage Account/i }).first();
  if (!(await saCombo.isVisible({ timeout: 4000 }).catch(() => false))) {
    saCombo = page.getByRole("combobox", { name: /First Storage Account/i }).first();
  }
  await saCombo.click({ timeout: 8000 });
  await page.waitForTimeout(2500);

  const saOption = page.getByRole("treeitem", { name: storageAccount });
  if (!(await saOption.first().isVisible({ timeout: 3000 }).catch(() => false))) {
    await page.getByText(storageAccount, { exact: true }).first().click({ timeout: 6000 });
  } else {
    await saOption.first().click({ timeout: 6000 });
  }
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(shotDir, `pers-${cache}-${mode}-sa.png`) }).catch(() => {});

  // Save (cross-frame)
  await clickAcrossFrames(page, 'span:has-text("Save")', { timeout: 8000 });
  await clickAcrossFrames(page, 'button:has-text("Yes")', { timeout: 6000, tolerate: true });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(shotDir, `pers-${cache}-${mode}-saved.png`) }).catch(() => {});

  console.log(`PERSISTENCE ${mode} SAVED on ${cache} (verify via waitPersistenceReady)`);
  return true;
}

// ============================================================================
// Wait — waitPersistenceReady  (legacy Wait-CachePersistenceReady.ps1)
// Polls cache until provisioningState=Succeeded; reports rdb/aof flags.
// ============================================================================
async function waitPersistenceReady({
  subscription, resourceGroup, cache, mode,
  maxMinutes = 30, intervalSec = 60,
}) {
  const deadline = Date.now() + maxMinutes * 60_000;
  let last;
  while (true) {
    const j = az(["redis", "show", "-g", resourceGroup, "-n", cache,
                  "--subscription", subscription, "-o", "json"], { json: true });
    const ps = j.provisioningState;
    const config = j.redisConfiguration || {};
    const rdb = redisConfigValue(config, "rdb-backup-enabled", "rdbBackupEnabled");
    const aof = redisConfigValue(config, "aof-backup-enabled", "aofBackupEnabled");
    const rdbFrequency = redisConfigValue(config, "rdb-backup-frequency", "rdbBackupFrequency");
    last = { ps, rdb, aof, rdbFrequency };
    console.log(`[${nowHHMMSS()}] ${cache} provisioningState=${ps}  rdb=${rdb}  aof=${aof}  rdbFrequency=${rdbFrequency || ""}`);
    if (ps === "Succeeded") break;
    if (Date.now() > deadline) throw new Error(`FAIL: timeout, provisioningState=${ps}`);
    await sleep(intervalSec * 1000);
  }
  if (mode === "AOF" && last.aof !== "true") throw new Error(`FAIL: aof-backup-enabled=${last.aof}`);
  if (mode === "RDB" && last.rdb !== "true") throw new Error(`FAIL: rdb-backup-enabled=${last.rdb}`);
  console.log(`PASS: ${cache} provisioningState=Succeeded (rdb=${last.rdb}, aof=${last.aof}, rdbFrequency=${last.rdbFrequency || ""})`);
  return last;
}

// ============================================================================
// Capability 6 — invokePersistencePopulate  (legacy Invoke-RedisPopulate.ps1)
// Hammers redis-benchmark on port 6379 (cap-3 must have run).
// ============================================================================
async function invokePersistencePopulate({
  subscription, resourceGroup, cache,
  keysApprox = 20000, opsTotal = 1_000_000, pipeline = 100,
  clustered = false,
}) {
  const host = az(["redis", "show", "-g", resourceGroup, "-n", cache,
                   "--subscription", subscription, "--query", "hostName", "-o", "tsv"]);
  const key = az(["redis", "list-keys", "-g", resourceGroup, "-n", cache,
                  "--subscription", subscription, "--query", "primaryKey", "-o", "tsv"]);

  const ping = redisCli(host, 6379, key, ["PING"]);
  if (!ping.stdout.includes("PONG")) throw new Error(`PING failed: ${ping.stdout || ping.stderr}`);
  console.log(`PING -> PONG on ${host}:6379`);

  const benchArgs = ["-h", host, "-p", "6379", "-a", key,
                     "-n", String(opsTotal), "-r", String(keysApprox),
                     "-t", "set", "-P", String(pipeline), "-q"];
  if (clustered) benchArgs.unshift("-c");
  const r = spawnSync(REDIS_BENCHMARK, benchArgs, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`redis-benchmark failed status=${r.status}`);

  const dbsize = parseInt(redisCli(host, 6379, key, ["DBSIZE"]).stdout, 10);
  console.log(`DBSIZE=${dbsize}`);
  if (dbsize < 19000) throw new Error(`FAIL: DBSIZE=${dbsize} < 19000 (benchmark -r ${keysApprox} expected ~19k unique)`);
  return { host, dbsize };
}

// ============================================================================
// Capability 7 — assertPersistenceBlob  (legacy Assert-PersistenceBlob.ps1)
// Poll storage container for blobs matching the AOF/RDB pattern.
// ============================================================================
async function assertPersistenceBlob({
  subscription, resourceGroup, storageAccount,
  container, pattern,            // pattern e.g. "aof" or "rdb"
  cache,                         // optional, used to derive default container
  timeoutMin = 20, intervalSec = 60,
}) {
  if (!container && cache) container = persistenceContainer(cache);
  if (!container) throw new Error("container or cache is required");
  if (!pattern) throw new Error("pattern is required (e.g. 'aof' or 'rdb')");

  const key = az(["storage", "account", "keys", "list",
                  "-g", resourceGroup, "-n", storageAccount,
                  "--subscription", subscription, "--query", "[0].value", "-o", "tsv"]);

  const deadline = Date.now() + timeoutMin * 60_000;
  while (true) {
    const r = azTry(["storage", "blob", "list",
                     "--account-name", storageAccount, "--account-key", key,
                     "--container-name", container, "-o", "json"]);
    const blobs = r.status === 0 && r.stdout ? JSON.parse(r.stdout) : [];
    const hit = blobs.filter(b => b.name && b.name.toLowerCase().includes(pattern.toLowerCase()));
    console.log(`[${nowHHMMSS()}] container=${container} total=${blobs.length} match-${pattern}=${hit.length}`);
    if (hit.length) {
      for (const b of hit.sort((a, b) => a.name.localeCompare(b.name))) {
        console.log(`  - ${b.name}  size=${b.properties && b.properties.contentLength}  modified=${b.properties && b.properties.lastModified}`);
      }
      console.log(`PASS: blob(s) matched '*${pattern}*' present in ${storageAccount}/${container}`);
      return hit;
    }
    if (Date.now() > deadline) throw new Error(`FAIL: no blob matched '*${pattern}*' in ${container} within ${timeoutMin} min`);
    await sleep(intervalSec * 1000);
  }
}

// ============================================================================
// Capability 8 — invokePersistenceTeardown  (legacy Invoke-PersistenceTeardown.ps1)
// ============================================================================
async function invokePersistenceTeardown({
  subscription, resourceGroup,
  caches,                       // string[] of full cache names
  storageAccount,
  deleteStorageAccount = true,
}) {
  if (!subscription || !resourceGroup) throw new Error("subscription / resourceGroup required");
  if (!Array.isArray(caches) || !caches.length) throw new Error("caches must be a non-empty string array");

  for (const n of caches) {
    console.log(`DELETE redis ${n}`);
    azTry(["redis", "delete", "-g", resourceGroup, "-n", n,
           "--subscription", subscription, "--yes", "--no-wait"]);
  }
  if (deleteStorageAccount && storageAccount) {
    console.log(`DELETE storage ${storageAccount}`);
    azTry(["storage", "account", "delete", "-g", resourceGroup, "-n", storageAccount,
           "--subscription", subscription, "--yes"]);
  }

  await sleep(60_000);
  const remaining = az(["redis", "list", "-g", resourceGroup,
                        "--subscription", subscription, "-o", "json"], { json: true })
    .filter(x => caches.includes(x.name)).map(x => x.name);
  let saLeft = "";
  if (deleteStorageAccount && storageAccount) {
    const sa = az(["storage", "account", "list", "-g", resourceGroup,
                   "--subscription", subscription, "-o", "json"], { json: true })
      .find(x => x.name === storageAccount);
    if (sa) saLeft = sa.name;
  }
  if (!remaining.length && !saLeft) { console.log("TEARDOWN OK"); return true; }
  console.log(`[pers] WARN TEARDOWN PARTIAL: redisLeft=${remaining.join(",")} saLeft=${saLeft}`);
  return false;
}

// ── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  // internals reused by callers
  az, azTry, redisCli, armRequest, ridOf, portalUrl, persistenceContainer,
  // capabilities
  assertPersistenceEnv,
  invokePersistenceCacheProvision,
  invokePersistenceStorageProvision,
  invokePersistenceEnableNonSslUI,
  invokePersistenceEnableNonSslArm,
  assertPersistenceNonSslEnabled,
  invokePersistenceEnableUI,
  waitPersistenceReady,
  invokePersistencePopulate,
  assertPersistenceBlob,
  invokePersistenceTeardown,
};
