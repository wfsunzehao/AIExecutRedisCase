"use strict";

const { spawnSync } = require("child_process");

const DEFAULT_TENANT = "microsoft.onmicrosoft.com";
const DEFAULT_CDP_ENDPOINT = "http://127.0.0.1:9222";
const DEFAULT_VIEWPORT = { width: 1600, height: 900 };
const REDIS_RESOURCE_TYPE = "Microsoft.Cache/Redis";

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function powershell(command) {
  if (process.platform !== "win32") throw new Error("PowerShell clipboard helper is only supported on Windows");
  return spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8" });
}

function getClipboardText() {
  return (powershell("(Get-Clipboard -Raw)").stdout || "").trim();
}

function setClipboardText(value) {
  powershell(`Set-Clipboard -Value ${JSON.stringify(String(value))}`);
}

function portalResourceUrl({
  tenant = DEFAULT_TENANT,
  subscription,
  resourceGroup,
  resourceType,
  resourceName,
  blade = "overview",
}) {
  if (!subscription || !resourceGroup || !resourceType || !resourceName) {
    throw new Error("portalResourceUrl requires { subscription, resourceGroup, resourceType, resourceName }");
  }
  return `https://ms.portal.azure.com/#@${tenant}/resource/subscriptions/${subscription}/resourceGroups/${resourceGroup}/providers/${resourceType}/${resourceName}/${blade}`;
}

function portalRedisUrl({ tenant = DEFAULT_TENANT, sub, subscription, rg, resourceGroup, cache, blade = "overview" }) {
  return portalResourceUrl({
    tenant,
    subscription: subscription || sub,
    resourceGroup: resourceGroup || rg,
    resourceType: REDIS_RESOURCE_TYPE,
    resourceName: cache,
    blade,
  });
}

async function connectCdpPortalPage({
  cdpEndpoint = DEFAULT_CDP_ENDPOINT,
  viewport = DEFAULT_VIEWPORT,
  portalHost = "ms.portal.azure.com",
  pagePredicate,
} = {}) {
  const { chromium } = require("playwright");
  const browser = await chromium.connectOverCDP(cdpEndpoint);
  const context = browser.contexts()[0] || await browser.newContext();
  const predicate = pagePredicate || ((candidate) => {
    try { return new URL(candidate.url()).hostname === portalHost; }
    catch { return false; }
  });
  const page = context.pages().find(predicate) || await context.newPage();
  if (viewport) await page.setViewportSize(viewport).catch(() => { });
  return { browser, context, page };
}

async function openPortalResourceBlade({
  page,
  tenant = DEFAULT_TENANT,
  subscription,
  resourceGroup,
  resourceType,
  resourceName,
  blade = "overview",
  waitMs = 5000,
}) {
  if (!page) throw new Error("openPortalResourceBlade requires { page }");
  const url = portalResourceUrl({ tenant, subscription, resourceGroup, resourceType, resourceName, blade });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (waitMs) await page.waitForTimeout(waitMs);
  return page;
}

async function openRedisBlade({
  page,
  cache,
  subscription,
  resourceGroup,
  tenant = DEFAULT_TENANT,
  blade = "overview",
  waitMs = 5000,
}) {
  return openPortalResourceBlade({
    page,
    tenant,
    subscription,
    resourceGroup,
    resourceType: REDIS_RESOURCE_TYPE,
    resourceName: cache,
    blade,
    waitMs,
  });
}

async function visibleBodyText(page) {
  return (await page.locator("body").innerText({ timeout: 8000 }).catch(() => "")).replace(/\s+/g, " ");
}

async function clickVisibleTextElement(page, pattern, selector = "[role=treeitem],[role=option],button,[role=button]") {
  const source = pattern instanceof RegExp ? pattern.source : escapeRegExp(pattern);
  const flags = pattern instanceof RegExp ? pattern.flags : "i";
  return page.evaluate(
    ({ source: reSource, flags: reFlags, selectorText }) => {
      const re = new RegExp(reSource, reFlags);
      const candidates = [...document.querySelectorAll(selectorText)];
      const target = candidates.find((element) => {
        const text = (element.innerText || element.textContent || element.getAttribute("aria-label") || element.getAttribute("title") || "").trim().replace(/\s+/g, " ");
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && re.test(text);
      });
      if (!target) return false;
      target.click();
      return true;
    },
    { source, flags, selectorText: selector }
  );
}

async function clickByRole(page, role, options, { timeout = 8000, tolerate = false } = {}) {
  try {
    await page.getByRole(role, options).click({ timeout });
    return true;
  } catch (error) {
    if (tolerate) {
      console.log(`[portal] WARN clickByRole tolerated: ${role} ${JSON.stringify(options)} :: ${error.message}`);
      return false;
    }
    throw error;
  }
}

async function clickByText(page, text, { exact = false, timeout = 8000, tolerate = false } = {}) {
  try {
    await page.getByText(text, { exact }).first().click({ timeout });
    return true;
  } catch (error) {
    if (tolerate) {
      console.log(`[portal] WARN clickByText tolerated: ${String(text)} :: ${error.message}`);
      return false;
    }
    throw error;
  }
}

async function waitForVisibleText(page, text, { exact = false, timeout = 8000 } = {}) {
  await page.getByText(text, { exact }).first().waitFor({ state: "visible", timeout });
  return true;
}

async function captureScreenshot(page, path, { fullPage = false } = {}) {
  if (!path) return false;
  await page.screenshot({ path, fullPage }).catch(() => { });
  return true;
}

async function closeNotificationsFlyout(page) {
  await clickByRole(
    page,
    "button",
    { name: "Close content 'Notifications'" },
    { timeout: 2000, tolerate: true }
  );
}

async function closeContentPane(page, title) {
  const pattern = title instanceof RegExp ? title : new RegExp(escapeRegExp(title), "i");
  const closed = await page.evaluate(({ source, flags }) => {
    const re = new RegExp(source, flags);
    const buttons = [...document.querySelectorAll('button,[role="button"]')];
    const target = buttons.find((button) => {
      const text = button.innerText || button.textContent || button.getAttribute("aria-label") || button.getAttribute("title") || "";
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && /close/i.test(text) && re.test(text);
    });
    if (!target) return false;
    target.click();
    return true;
  }, { source: pattern.source, flags: pattern.flags });
  if (closed) await page.waitForTimeout(1000);
  return closed;
}

async function copyRedisAccessKeyFromPortal({
  page,
  cache,
  subscription,
  resourceGroup,
  tenant = DEFAULT_TENANT,
  keyLabel = "Primary key",
  screenshotPrefix,
}) {
  if (!page || !cache || !subscription || !resourceGroup) {
    throw new Error("copyRedisAccessKeyFromPortal requires { page, cache, subscription, resourceGroup }");
  }

  await closeContentPane(page, /CacheKeys/i).catch(() => false);
  await openRedisBlade({ page, cache, subscription, resourceGroup, tenant, blade: "overview", waitMs: 7000 });

  const opened = await clickVisibleTextElement(page, /Show access keys/i, "button,[role=button],div");
  if (!opened) throw new Error(`Could not open access keys pane for ${cache}`);
  await page.waitForTimeout(6000);

  await clickVisibleTextElement(page, /Show keys/i, "button,[role=button]").catch(() => false);
  await page.waitForTimeout(1200);

  const marker = `redis-key-copy-${Date.now()}`;
  setClipboardText(marker);
  const copied = await page.evaluate(({ label }) => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const textOf = (element) => (element.innerText || element.textContent || element.getAttribute("aria-label") || element.getAttribute("title") || "").trim().replace(/\s+/g, " ");
    const labels = [...document.querySelectorAll("*")].filter((element) => visible(element) && textOf(element).toLowerCase().includes(label.toLowerCase()));
    for (const labelElement of labels) {
      let scope = labelElement;
      for (let depth = 0; scope && depth < 7; depth += 1, scope = scope.parentElement) {
        const copyButton = [...scope.querySelectorAll('button,[role="button"]')].find((button) => visible(button) && /copy/i.test(textOf(button)));
        if (copyButton) {
          copyButton.click();
          return true;
        }
      }
    }
    const copyButtons = [...document.querySelectorAll('button,[role="button"]')].filter((button) => visible(button) && /copy/i.test(textOf(button)));
    if (!copyButtons.length) return false;
    copyButtons[0].click();
    return true;
  }, { label: keyLabel });
  if (!copied) throw new Error(`Could not click copy button for ${keyLabel} on ${cache}`);

  await page.waitForTimeout(1000);
  const key = getClipboardText();
  if (key.length < 30 || key === marker) {
    throw new Error(`Copied key for ${cache} did not look valid; length=${key.length}`);
  }
  if (screenshotPrefix) await captureScreenshot(page, `${screenshotPrefix}-access-key-copied.png`, { fullPage: false });
  console.log(`[key] copied ${keyLabel} for ${cache} from Portal (length=${key.length})`);
  return key;
}

async function openRebootPortSelector(page) {
  await page.keyboard.press("Escape").catch(() => { });
  await page.waitForTimeout(300);

  const clicked = await page.evaluate(() => {
    const combos = [...document.querySelectorAll('[role="combobox"]')];
    const target = combos.find((element) => {
      const text = (element.innerText || element.textContent || "").trim();
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && /Primary|Replica|selected/i.test(text);
    });
    if (!target) return false;
    target.click();
    return true;
  });
  if (!clicked) {
    await page.getByRole("button", { name: /Port\(s\) to reboot|Toggle/i }).last().click({ timeout: 5000 });
  }
  await page.waitForTimeout(800);
}

async function listVisibleRebootPortOptions(page) {
  return page.locator('[role="treeitem"],[role="option"]').evaluateAll((elements) => {
    return elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const text = (element.innerText || element.textContent || element.getAttribute("aria-label") || element.getAttribute("title") || "").trim().replace(/\s+/g, " ");
        return { text, visible: rect.width > 0 && rect.height > 0 };
      })
      .filter((option) => option.visible && /^(Primary|Replica) - \d+$/i.test(option.text))
      .map((option) => option.text);
  });
}

async function selectRebootPorts({ page, ports, allPorts = false, screenshotPath } = {}) {
  if (!page) throw new Error("selectRebootPorts requires { page }");

  await openRebootPortSelector(page);
  const visibleOptions = [...new Set(await listVisibleRebootPortOptions(page))];
  if (!visibleOptions.length) throw new Error("No visible reboot port options found");

  const expectedPorts = allPorts ? visibleOptions : ports;
  if (!Array.isArray(expectedPorts) || !expectedPorts.length) {
    throw new Error("selectRebootPorts requires non-empty { ports } or allPorts=true");
  }

  await page.keyboard.press("Escape").catch(() => { });
  await page.waitForTimeout(300);

  for (const port of expectedPorts) {
    let body = await visibleBodyText(page);
    if (body.includes(port)) continue;

    await openRebootPortSelector(page);
    const clicked = await clickVisibleTextElement(page, new RegExp(`^${escapeRegExp(port)}$`, "i"));
    if (!clicked) throw new Error(`Reboot port option not found: ${port}`);
    await page.waitForTimeout(700);
    await page.keyboard.press("Escape").catch(() => { });
    await page.waitForTimeout(300);
  }

  const finalText = await visibleBodyText(page);
  const missing = expectedPorts.filter((port) => !finalText.includes(port));
  if (missing.length) throw new Error(`Reboot ports not selected: ${missing.join(", ")}`);
  if (expectedPorts.length > 1 && !finalText.includes(`${expectedPorts.length} selected`)) {
    throw new Error(`Expected ${expectedPorts.length} selected reboot ports, but blade text did not confirm it`);
  }

  if (screenshotPath) await captureScreenshot(page, screenshotPath, { fullPage: false });
  console.log(`[PASS] reboot ports selected: ${expectedPorts.join(", ")}`);
  return expectedPorts;
}

async function invokeRedisReboot({
  page,
  cache,
  subscription,
  resourceGroup,
  tenant = DEFAULT_TENANT,
  ports,
  allPorts = true,
  screenshotPrefix,
}) {
  if (!page || !cache || !subscription || !resourceGroup) {
    throw new Error("invokeRedisReboot requires { page, cache, subscription, resourceGroup }");
  }

  const prefix = screenshotPrefix || `reboot-${cache}`;
  await openRedisBlade({ page, cache, subscription, resourceGroup, tenant, blade: "reboot", waitMs: 5000 });
  const selectedPorts = await selectRebootPorts({ page, ports, allPorts, screenshotPath: `${prefix}-ports.png` });

  await page.getByRole("button", { name: "Reboot", exact: true }).click({ timeout: 8000 });
  await page.getByRole("button", { name: "OK", exact: true }).click({ timeout: 8000 });
  const submittedAt = Date.now();
  console.log(`REBOOT SUBMITTED on ${cache} ports=${selectedPorts.join("|")} @ ${new Date(submittedAt).toISOString()}`);

  await page.waitForTimeout(3000);
  await clickByRole(page, "button", { name: "Notifications" }, { tolerate: true });
  await captureScreenshot(page, `${prefix}-notifications.png`, { fullPage: false });
  return { cache, ports: selectedPorts, submittedAt };
}

module.exports = {
  DEFAULT_TENANT,
  DEFAULT_CDP_ENDPOINT,
  DEFAULT_VIEWPORT,
  REDIS_RESOURCE_TYPE,
  escapeRegExp,
  powershell,
  getClipboardText,
  setClipboardText,
  portalResourceUrl,
  portalRedisUrl,
  connectCdpPortalPage,
  openPortalResourceBlade,
  openRedisBlade,
  visibleBodyText,
  clickVisibleTextElement,
  clickByRole,
  clickByText,
  waitForVisibleText,
  captureScreenshot,
  closeNotificationsFlyout,
  closeContentPane,
  copyRedisAccessKeyFromPortal,
  openRebootPortSelector,
  listVisibleRebootPortOptions,
  selectRebootPorts,
  invokeRedisReboot,
};
