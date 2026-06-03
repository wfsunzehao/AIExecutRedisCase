"use strict";

const {
  visibleDropdowns,
  pickDD,
  pickDDNoType,
  goNext,
  choosePublicEndpoint,
  selectZones,
  setToggle,
  setNumberByFieldLabel,
} = require("../create-cache");

const DEFAULT_CDP_ENDPOINT = process.env.CDP_ENDPOINT || "http://127.0.0.1:9222";
const CREATE_HASH = "#create/Microsoft.Cache.redis";
const PORTAL_ORIGIN = "https://ms.portal.azure.com";

const DROPDOWN_INDEX = {
  subscription: 0,
  resourceGroup: 1,
  region: 2,
  cacheType: 3,
  cacheSize: 4,
};

let browser;
let context;
let currentPage;
let chromium;

function getChromium() {
  if (chromium) return chromium;
  try {
    chromium = require("playwright").chromium;
    return chromium;
  } catch (err) {
    throw new Error("The 'playwright' package is required for browser-backed cache creation MCP tools. Run 'npm install' in the workspace first.");
  }
}

function normalizeEndpoint(cdpEndpoint) {
  return cdpEndpoint || DEFAULT_CDP_ENDPOINT;
}

function isPortalUrl(url) {
  try {
    return new URL(url).hostname.endsWith("portal.azure.com");
  } catch {
    return false;
  }
}

function getCreateUrl(options = {}) {
  if (options.createUrl) return options.createUrl;
  if (options.vnetFeatureFlag) {
    return `${PORTAL_ORIGIN}/?feature.vnetInjectedCacheCreation=true${CREATE_HASH}`;
  }
  return `${PORTAL_ORIGIN}/${CREATE_HASH}`;
}

async function connect(cdpEndpoint) {
  const endpoint = normalizeEndpoint(cdpEndpoint);
  if (browser && browser.isConnected()) return { browser, context, endpoint };

  browser = await getChromium().connectOverCDP(endpoint, { timeout: 120000 });
  context = browser.contexts()[0] || await browser.newContext();
  currentPage = undefined;
  return { browser, context, endpoint };
}

async function getPortalPage(options = {}) {
  await connect(options.cdpEndpoint);

  const pages = context.pages();
  const preferred = options.pageUrlContains
    ? pages.find(page => page.url().includes(options.pageUrlContains))
    : undefined;
  const portalPage = preferred || pages.find(page => isPortalUrl(page.url()));

  currentPage = portalPage || currentPage || await context.newPage();
  currentPage.on("dialog", dialog => dialog.dismiss().catch(() => { }));
  return currentPage;
}

async function navigateToCreateForm(options = {}) {
  const page = await getPortalPage(options);
  const createUrl = getCreateUrl(options);

  if (options.vnetFeatureFlag) {
    await page.goto(`${PORTAL_ORIGIN}/?feature.vnetInjectedCacheCreation=true`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
  }

  await page.goto(createUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('div[aria-label="Create new or use existing Resource group"]', { timeout: 60000 });
  await page.waitForTimeout(3000);

  return {
    ok: true,
    url: page.url(),
    title: await page.title().catch(() => ""),
  };
}

async function listPages(options = {}) {
  await connect(options.cdpEndpoint);
  return context.pages().map((page, index) => ({
    index,
    url: page.url(),
    isPortal: isPortalUrl(page.url()),
  }));
}

async function summarizeVisibleDropdowns(options = {}) {
  const page = await getPortalPage(options);
  const dropdowns = await visibleDropdowns(page);
  const summaries = [];
  for (let index = 0; index < dropdowns.length; index++) {
    const text = await dropdowns[index].innerText().catch(() => "");
    summaries.push({ index, text: text.replace(/\s+/g, " ").trim().slice(0, 200) });
  }
  return summaries;
}

function resolveDropdownIndex(dropdown) {
  if (typeof dropdown === "number") return dropdown;
  if (typeof dropdown === "string" && /^\d+$/.test(dropdown)) return Number(dropdown);
  if (typeof dropdown === "string" && Object.prototype.hasOwnProperty.call(DROPDOWN_INDEX, dropdown)) {
    return DROPDOWN_INDEX[dropdown];
  }
  throw new Error(`Unknown dropdown '${dropdown}'. Use one of: ${Object.keys(DROPDOWN_INDEX).join(", ")} or a visible index.`);
}

async function selectDropdown(options = {}) {
  const page = await getPortalPage(options);
  const index = resolveDropdownIndex(options.dropdown);
  const dropdowns = await visibleDropdowns(page);
  const dropdown = dropdowns[index];
  if (!dropdown) {
    throw new Error(`Dropdown index ${index} not found. Visible dropdown count: ${dropdowns.length}`);
  }

  const label = options.label || String(options.dropdown || index);
  const noType = options.noType === true || options.dropdown === "cacheSize";
  const ok = noType
    ? await pickDDNoType(page, dropdown, options.text, label)
    : await pickDD(page, dropdown, options.text, label);
  const shown = await dropdown.innerText().catch(() => "");

  return { ok, dropdownIndex: index, text: options.text, shown: shown.replace(/\s+/g, " ").trim() };
}

async function choosePublic(options = {}) {
  const page = await getPortalPage(options);
  return { ok: await choosePublicEndpoint(page), url: page.url() };
}

async function chooseZones(options = {}) {
  const page = await getPortalPage(options);
  return await selectZones(page, options.zones || []);
}

async function updateToggle(options = {}) {
  const page = await getPortalPage(options);
  const ok = await setToggle(page, options.ariaLabel, options.wantEnabled);
  return { ok, ariaLabel: options.ariaLabel, wantEnabled: options.wantEnabled };
}

async function setNumberField(options = {}) {
  if (!options.fieldLabel) throw new Error("fieldLabel is required");
  if (options.value === undefined || options.value === null) throw new Error("value is required");
  const page = await getPortalPage(options);
  return await setNumberByFieldLabel(page, options.fieldLabel, options.value);
}

async function next(options = {}) {
  const page = await getPortalPage(options);
  await goNext(page, options.buttonText, options.tabText);
  return { ok: true, url: page.url() };
}

async function fillCacheName(options = {}) {
  if (!options.cacheName) throw new Error("cacheName is required");
  const page = await getPortalPage(options);
  const input = page.locator('input[placeholder="enter a name"]').first();
  await input.waitFor({ state: "visible", timeout: 15000 });
  await input.click();
  await input.fill(options.cacheName);
  const value = await input.inputValue().catch(() => "");
  return { ok: value === options.cacheName, cacheName: options.cacheName, value };
}

async function readPageText(options = {}) {
  const page = await getPortalPage(options);
  const maxChars = Number(options.maxChars || 6000);
  const frames = [];
  for (const frame of page.frames()) {
    const text = await frame.evaluate(() => document.body?.innerText || "").catch(() => "");
    if (text.trim()) frames.push({ url: frame.url(), text });
  }
  const combined = frames.map(frame => frame.text).join("\n\n--- frame ---\n\n");
  return {
    url: page.url(),
    text: combined.slice(0, maxChars),
    truncated: combined.length > maxChars,
    frames: frames.map(frame => ({ url: frame.url(), textLength: frame.text.length })),
  };
}

async function captureScreenshot(options = {}) {
  if (!options.path) throw new Error("path is required");
  const page = await getPortalPage(options);
  await page.screenshot({ path: options.path, fullPage: options.fullPage === true, timeout: 15000 });
  return { ok: true, path: options.path, url: page.url() };
}

async function clickCreate(options = {}) {
  const page = await getPortalPage(options);
  const create = page.locator('button:has-text("Create")').first();
  await create.waitFor({ state: "visible", timeout: Number(options.timeoutMs || 30000) });
  const disabled = await create.isDisabled().catch(() => false);
  if (disabled) return { ok: false, note: "create-button-disabled", url: page.url() };
  await create.click();
  await page.waitForTimeout(2000);
  return { ok: true, url: page.url() };
}

async function clickGoToResource(options = {}) {
  const page = await getPortalPage(options);
  const timeoutMs = Number(options.timeoutMs || 60000);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const loc = frame.locator('button:has-text("Go to resource"),a:has-text("Go to resource"),[role="button"]:has-text("Go to resource")').first();
      if (await loc.isVisible({ timeout: 1000 }).catch(() => false)) {
        await loc.scrollIntoViewIfNeeded().catch(() => { });
        await loc.click({ timeout: 10000 });
        await page.waitForTimeout(3000);
        return { ok: true, url: page.url() };
      }
    }
    await page.waitForTimeout(2000);
  }

  return { ok: false, note: "go-to-resource-not-found", url: page.url() };
}

module.exports = {
  connect,
  getPortalPage,
  navigateToCreateForm,
  listPages,
  summarizeVisibleDropdowns,
  selectDropdown,
  choosePublic,
  chooseZones,
  updateToggle,
  setNumberField,
  next,
  fillCacheName,
  readPageText,
  captureScreenshot,
  clickCreate,
  clickGoToResource,
};