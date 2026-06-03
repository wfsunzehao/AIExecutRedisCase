"use strict";

const DEFAULT_CDP_ENDPOINT = process.env.CDP_ENDPOINT || "http://127.0.0.1:9222";
const PORTAL_ORIGIN = "https://ms.portal.azure.com";

let browser;
let context;
let chromium;

function getChromium() {
  if (chromium) return chromium;
  try {
    chromium = require("playwright").chromium;
    return chromium;
  } catch (err) {
    throw new Error("The 'playwright' package is required for browser-backed persistence MCP tools. Run 'npm install playwright' in the workspace first.");
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

async function connect(cdpEndpoint) {
  const endpoint = normalizeEndpoint(cdpEndpoint);
  if (browser && browser.isConnected()) return { browser, context, endpoint };
  browser = await getChromium().connectOverCDP(endpoint, { timeout: 120000 });
  context = browser.contexts()[0] || await browser.newContext();
  return { browser, context, endpoint };
}

async function getPortalPage(options = {}) {
  await connect(options.cdpEndpoint);
  const pages = context.pages();
  const preferred = options.pageUrlContains
    ? pages.find(p => p.url().includes(options.pageUrlContains))
    : undefined;
  const portalPage = preferred || pages.find(p => isPortalUrl(p.url())) || await context.newPage();
  portalPage.on("dialog", d => d.dismiss().catch(() => {}));
  return portalPage;
}

async function listPages(options = {}) {
  await connect(options.cdpEndpoint);
  return context.pages().map(p => ({ url: p.url(), title: p.url() }));
}

module.exports = { connect, getPortalPage, listPages, PORTAL_ORIGIN };
