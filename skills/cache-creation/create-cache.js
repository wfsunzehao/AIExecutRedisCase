/**
 * Azure Cache for Redis — Portal Helper Functions
 *
 * Reusable Playwright helpers referenced by skills/cache-creation/SKILL.md.
 * Import specific functions or call them inline via `node -e`.
 *
 * Requires Edge running with --remote-debugging-port=9222.
 */

"use strict";

// ── Helper: visible dropdowns ─────────────────────────────────────────────────
async function visibleDropdowns(page) {
  const all = await page.$$("div.azc-formControl[aria-haspopup='dialog']");
  const v = [];
  for (const d of all) { if (await d.isVisible().catch(() => false)) v.push(d); }
  return v;
}

// ── Helper: pick from dropdown (real mouse click on option) ───────────────────
// For dropdowns that support text filtering (Sub, Region, RG, CacheType).
// For Cache Size (non-filterable list), use pickDDNoType instead.
async function pickDD(page, dd, text, label) {
  for (let i = 1; i <= 3; i++) {
    console.log(`[create] ${label} attempt ${i}`);
    const rect = await dd.boundingBox();
    if (rect) await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
    else await dd.click();
    await page.waitForTimeout(800);
    await page.keyboard.type(text, { delay: 60 });
    await page.waitForTimeout(1000);

    // Find option by bounding-rect center (more reliable than Locator.click)
    const optInfo = await page.evaluate((searchText) => {
      const fn = el => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && r.width > 4 && r.height > 4; };
      const el = [...document.querySelectorAll(".fxc-dropdown-option,[role='option']")]
        .filter(fn)
        .find(o => (o.textContent || "").toLowerCase().includes(searchText.toLowerCase()));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, text);

    if (optInfo) {
      await page.mouse.click(optInfo.x, optInfo.y);
    } else {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(200);
      await page.keyboard.press("Enter");
    }
    await page.waitForTimeout(1000);

    const shown = ((await dd.innerText().catch(() => "")) || "").toLowerCase();
    if (shown.includes(text.toLowerCase()) ||
        (label.includes("CacheType") && shown.includes("premium"))) {
      console.log(`[create] ${label} committed`);
      return true;
    }
    await page.keyboard.press("Escape").catch(() => {});
  }
  return false;
}

// ── Helper: click Next button or fall back to tab click ───────────────────────
async function goNext(page, btnText, tabText) {
  const btn = page.locator(`button:has-text('${btnText}')`).first();
  if (await btn.count()) { await btn.click().catch(() => {}); }
  else { await page.locator(`.fxc-section-tab-item:has-text('${tabText}')`).first().click({ timeout: 8000 }).catch(() => {}); }
  await page.waitForTimeout(1700);
}

// ── Helper: select Public Endpoint via bounding-box real mouse click ──────────
// Scans for a visible [role="radio"]/[role="option"]/label whose trimmed text
// starts with "Public endpoint", then clicks at bounding-rect center.
// Does NOT use page.locator("text=Public endpoint") — that hits container divs.
async function choosePublicEndpoint(page) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    // Prefer [role="radio"] first to avoid hitting container divs
    const rect = await page.evaluate(() => {
      const fn = el => {
        const s = getComputedStyle(el), r = el.getBoundingClientRect();
        return s.display !== "none" && s.visibility !== "hidden" && r.width > 4 && r.height > 4;
      };
      // Try radio-role elements first, then fall back to label/button
      const radioFirst = [...document.querySelectorAll('[role="radio"],[role="option"]')]
        .find(n => fn(n) && /^public endpoint/i.test((n.textContent || "").replace(/\s+/g, " ").trim()));
      const cand = radioFirst ||
        [...document.querySelectorAll('label,button')]
          .find(n => fn(n) && /^public endpoint/i.test((n.textContent || "").replace(/\s+/g, " ").trim()));
      if (!cand) return null;
      cand.scrollIntoView({ block: "center", behavior: "instant" });
      const r = cand.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: cand.tagName, role: cand.getAttribute('role') || '' };
    });
    if (!rect) { console.log("[create] WARN public-endpoint element not found attempt=" + attempt); break; }
    await page.mouse.click(rect.x, rect.y);
    await page.waitForTimeout(1200);
    // Verify: check that no "Private endpoint" radio is aria-checked=true
    const verified = await page.evaluate(() => {
      const fn = el => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && r.width > 4 && r.height > 4; };
      const radios = [...document.querySelectorAll('[role="radio"],[role="option"]')].filter(fn);
      const pub = radios.find(r => /^public endpoint/i.test((r.textContent || "").replace(/\s+/g, " ").trim()));
      const priv = radios.find(r => /^private endpoint/i.test((r.textContent || "").replace(/\s+/g, " ").trim()));
      if (pub && pub.getAttribute('aria-checked') === 'true') return 'pub-confirmed';
      if (priv && priv.getAttribute('aria-checked') === 'true') return 'priv-selected';
      return 'unknown';
    });
    console.log("[create] public-endpoint attempt=" + attempt + " verified=" + verified + " at " + rect.x + "," + rect.y + " tag=" + rect.tag + " role=" + rect.role);
    if (verified === 'pub-confirmed') return true;
    await page.waitForTimeout(600);
  }
  console.log("[create] WARN public-endpoint could not confirm selection");
  return false;
}

// ── Helper: select Availability Zones via combobox (real mouse click) ─────────
// Opens the "Allocate zones automatically" combobox, reads dropdown options with
// their bounding rects, then clicks each target zone using page.mouse.click().
// After closing (Escape), reads back the combobox text to verify commitment.
async function selectZones(page, zones) {
  if (!zones || !zones.length) return { ok: true, note: "no-zones-required" };

  // Scroll Availability Zones label into viewport
  await page.evaluate(() => {
    const fn = el => {
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      return s.display !== "none" && s.visibility !== "hidden" && r.width > 4 && r.height > 4 && (el.textContent || "").trim().length < 40;
    };
    const lbl = [...document.querySelectorAll("label,span,div,h3,h4")]
      .find(el => fn(el) && /^availability zones$/i.test((el.textContent || "").trim()));
    if (lbl) lbl.scrollIntoView({ block: "center", behavior: "instant" });
  }).catch(() => {});
  await page.waitForTimeout(700);

  // Locate the zone combobox
  const comboLoc = page.locator('div[role="combobox"]').filter({ hasText: /allocate zones automatically/i }).first();
  const cnt = await comboLoc.count();
  console.log("[zones] combobox found:", cnt);

  if (!cnt) {
    const bodyText = await page.evaluate(() => (document.body?.innerText || "").slice(0, 3000));
    if (/zone enabled caches are not yet available/i.test(bodyText))
      return { ok: false, note: "region-capability-conflict" };
    const allCombos = await page.evaluate(() => {
      const fn = el => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && r.width > 4 && r.height > 4; };
      return [...document.querySelectorAll('div[role="combobox"]')].filter(fn).map(c => (c.textContent || "").trim().slice(0, 80));
    });
    return { ok: false, note: "combobox-not-found", debug: allCombos };
  }

  // Open combobox with real mouse click
  await comboLoc.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const cRect = await comboLoc.boundingBox();
  if (!cRect) return { ok: false, note: "combobox-no-bbox" };
  console.log("[zones] opening combobox at", cRect.x + cRect.width / 2, cRect.y + cRect.height / 2);
  await page.mouse.click(cRect.x + cRect.width / 2, cRect.y + cRect.height / 2);
  await page.waitForTimeout(1300);

  // Read all visible dropdown options with bounding-rect centers
  const opts = await page.evaluate(() => {
    const fn = el => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && r.width > 4 && r.height > 4; };
    return [...document.querySelectorAll('.fxc-dropdown-option,[role="option"],li.fxc-dropdown-option')].filter(fn)
      .map(o => { const r = o.getBoundingClientRect(); return { text: (o.textContent || "").replace(/\s+/g, " ").trim(), x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  });
  console.log("[zones] options:", JSON.stringify(opts));

  if (!opts.length) {
    await page.keyboard.press("Escape").catch(() => {});
    return { ok: false, note: "no-options-after-open" };
  }

  // Strategy 1 — combined option (e.g. "1, 2")
  const combined = opts.find(o => {
    const t = o.text.replace(/\s/g, "");
    return t === zones.join(",") || o.text === zones.join(", ");
  });
  if (combined) {
    console.log("[zones] clicking combined option:", combined.text);
    await page.mouse.click(combined.x, combined.y);
    await page.waitForTimeout(600);
    await page.keyboard.press("Escape").catch(() => {});
  } else {
    // Strategy 2 — click each zone individually (multi-select stays open)
    let clicked = 0;
    for (const z of zones) {
      const match = opts.find(o => o.text === z || o.text === `Zone ${z}` || (o.text.length <= 3 && o.text.trim() === z));
      if (match) {
        console.log("[zones] clicking zone", z, "at", match.x, match.y);
        await page.mouse.click(match.x, match.y);
        await page.waitForTimeout(500);
        clicked++;
      } else {
        console.log("[zones] no match for zone:", z, "| available:", opts.map(o => o.text).join("|"));
      }
    }
    await page.keyboard.press("Escape").catch(() => {});
    if (!clicked) return { ok: false, note: "no-zone-options-matched", available: opts.map(o => o.text) };
  }
  await page.waitForTimeout(800);

  // Verify: combobox text must no longer read "Allocate zones automatically"
  const afterText = await page.evaluate(() => {
    const fn = el => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && r.width > 4 && r.height > 4; };
    return [...document.querySelectorAll('div[role="combobox"]')].filter(fn).map(c => (c.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100));
  });
  console.log("[zones] after-selection combos:", JSON.stringify(afterText));

  const allText = afterText.join(" ");
  const stillDefault = /allocate zones automatically/i.test(allText) && zones.every(z => !allText.includes(z));
  return { ok: !stillDefault, note: stillDefault ? "still-showing-default" : "", afterText };
}

// ── Helper: read/set toggle by aria-label ─────────────────────────────────────
async function setToggle(page, ariaLabel, wantEnabled) {
  if (wantEnabled === null || wantEnabled === undefined) return;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const state = await page.evaluate((label) => {
      const all = [...document.querySelectorAll(`[aria-label="${label}"]`)];
      if (!all.length) return { found: false };

      const inView = (el) => {
        const s = getComputedStyle(el), r = el.getBoundingClientRect();
        return s.display !== "none" && s.visibility !== "hidden" && r.width > 4 && r.height > 4 && r.y > 0 && r.y < window.innerHeight;
      };
      const hasArea = (el) => {
        const s = getComputedStyle(el), r = el.getBoundingClientRect();
        return s.display !== "none" && s.visibility !== "hidden" && r.width > 4 && r.height > 4;
      };

      // Azure portal may render hidden duplicate toggles with the same aria-label.
      // Prefer the currently visible instance, then a non-zero-area instance.
      let toggle = all.find(inView) || all.find(hasArea) || all[0];
      toggle.scrollIntoView({ block: "center", behavior: "instant" });
      const rect = toggle.getBoundingClientRect();
      return {
        found: true,
        on: toggle.getAttribute("aria-checked") === "true",
        clickViaMouse: rect.width > 4 && rect.height > 4 && rect.y > 0,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    }, ariaLabel);

    if (!state.found) {
      console.log(`[create] WARN toggle not found: ${ariaLabel}`);
      return false;
    }

    if (state.on === wantEnabled) {
      console.log(`[create] ${ariaLabel} already ${wantEnabled ? "enabled" : "disabled"}`);
      return true;
    }

    if (state.clickViaMouse) {
      await page.mouse.click(state.x, state.y);
    } else {
      // DOM-click fallback: must target the VISIBLE instance, not querySelector single.
      // querySelector returns DOM order; a hidden duplicate (e.g. AccessKeys at y=0
      // with aria-checked stale) would be clicked and leave the visible toggle
      // unchanged, causing Review to show the wrong state.
      await page.evaluate((label) => {
        const all = [...document.querySelectorAll(`[aria-label="${label}"]`)];
        const hasArea = (el) => {
          const s = getComputedStyle(el), r = el.getBoundingClientRect();
          return s.display !== "none" && s.visibility !== "hidden" && r.width > 4 && r.height > 4;
        };
        const inView = (el) => {
          const s = getComputedStyle(el), r = el.getBoundingClientRect();
          return hasArea(el) && r.y > 0 && r.y < window.innerHeight;
        };
        const toggle = all.find(inView) || all.find(hasArea) || all[0];
        if (toggle) toggle.click();
      }, ariaLabel);
    }
    await page.waitForTimeout(900);

    const verified = await page.evaluate((label) => {
      const all = [...document.querySelectorAll(`[aria-label="${label}"]`)];
      if (!all.length) return null;
      const inView = (el) => {
        const s = getComputedStyle(el), r = el.getBoundingClientRect();
        return s.display !== "none" && s.visibility !== "hidden" && r.width > 4 && r.height > 4 && r.y > 0 && r.y < window.innerHeight;
      };
      const hasArea = (el) => {
        const s = getComputedStyle(el), r = el.getBoundingClientRect();
        return s.display !== "none" && s.visibility !== "hidden" && r.width > 4 && r.height > 4;
      };
      const toggle = all.find(inView) || all.find(hasArea) || all[0];
      return toggle.getAttribute("aria-checked") === "true";
    }, ariaLabel);
    if (verified === wantEnabled) {
      console.log(`[create] ${ariaLabel} committed=${verified}`);
      return true;
    }
  }
  console.log(`[create] WARN toggle did not reach requested state: ${ariaLabel} => ${wantEnabled}`);
  return false;
}

// ── Helper: pick from dropdown WITHOUT typing (for non-filterable lists like Cache Size) ──
// Opens the dropdown via real mouse click, then finds and clicks the matching option
// by bounding-box center. Falls back to ArrowDown+Enter if option not found in DOM.
async function pickDDNoType(page, dd, text, label) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`[create] ${label} noType attempt ${attempt}`);
    const rect = await dd.boundingBox();
    if (rect) await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
    else await dd.click();
    await page.waitForTimeout(1200);

    // Find matching option by text (no typing — click directly)
    const opts = await page.evaluate((searchText) => {
      const fn = el => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && r.width > 4 && r.height > 4; };
      return [...document.querySelectorAll(".fxc-dropdown-option,[role='option']")]
        .filter(fn)
        .map(o => { const r = o.getBoundingClientRect(); return { text: (o.textContent || "").replace(/\s+/g, " ").trim(), x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    }, text);

    const match = opts.find(o => o.text.toLowerCase().includes(text.toLowerCase()));
    if (match) {
      await page.mouse.click(match.x, match.y);
    } else {
      console.log(`[create] ${label} option not found, using ArrowDown+Enter. Available: ${opts.slice(0,5).map(o=>o.text).join("|")}`);
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(200);
      await page.keyboard.press("Enter");
    }
    await page.waitForTimeout(1000);

    const shown = ((await dd.innerText().catch(() => "")) || "").toLowerCase();
    if (shown.includes(text.toLowerCase())) {
      console.log(`[create] ${label} noType committed`);
      return true;
    }
    await page.keyboard.press("Escape").catch(() => {});
  }
  console.log(`[create] WARN ${label} noType failed after 3 attempts`);
  return false;
}

// ── Helper: query existing VNet or create a new one via Azure CLI ────────────
// Runs az CLI commands synchronously. Checks if VNet with vnetName exists in
// the given resource group; if found, returns its first subnet name.
// If not found, creates the VNet with a /16 address space and a /24 default subnet.
// Returns { vnetName, subnetName, created: bool, error?: string }.
function queryOrCreateVNet(resourceGroup, location, vnetName, subnetName) {
  const { execSync } = require("child_process");
  subnetName = subnetName || "default";
  try {
    const listOut = execSync(
      `az network vnet list --resource-group "${resourceGroup}" --query "[?name=='${vnetName}']" -o json`,
      { encoding: "utf8", timeout: 30000 }
    );
    const vnets = JSON.parse(listOut || "[]");
    if (vnets.length > 0) {
      const subs = vnets[0].subnets || [];
      const sub = subs.find(s => s.name === subnetName) || subs[0];
      const foundSubnet = sub ? sub.name : subnetName;
      console.log(`[vnet] Existing VNet found: ${vnetName} / subnet: ${foundSubnet}`);
      return { vnetName, subnetName: foundSubnet, created: false };
    }
  } catch (e) {
    console.log("[vnet] Query error: " + e.message);
  }
  // VNet not found — create it
  console.log(`[vnet] Creating VNet ${vnetName} in ${location} / ${resourceGroup} ...`);
  try {
    execSync(
      `az network vnet create --name "${vnetName}" --resource-group "${resourceGroup}" --location "${location}" --address-prefix "10.0.0.0/16" --subnet-name "${subnetName}" --subnet-prefix "10.0.0.0/24" -o none`,
      { encoding: "utf8", timeout: 120000 }
    );
    console.log(`[vnet] Created: ${vnetName} / ${subnetName}`);
    return { vnetName, subnetName, created: true };
  } catch (e) {
    console.error("[vnet] Create error: " + e.message);
    return { vnetName, subnetName, created: false, error: e.message };
  }
}

// ── Helper: dismiss overlays/popups with Escape ───────────────────────────
async function dismissOverlays(page) {
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(120);
  }
}

// ── Helper: ensure Advanced tab is selected (DOM click, no mouse coords) ──
async function ensureAdvancedTab(page) {
  await dismissOverlays(page);
  const result = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const adv = tabs.find(t => (t.textContent || "").replace(/\s+/g, " ").trim() === "Advanced");
    if (!adv) return { ok: false, reason: "no_advanced_tab" };
    if (adv.getAttribute("aria-selected") === "true") return { ok: true, already: true };
    adv.click();
    return { ok: true, clicked: true };
  });
  await page.waitForTimeout(1500);
  return result;
}

// ── Helper: set a numeric slider input by aria-label regex source ─────────
// Targets Azure portal sliders rendered as <input type="text"> with aria-label
// like " slider value Type a number between 1 and 3 for the slider".
async function setNumberByAriaRange(page, regexSrc, value) {
  return await page.evaluate(({ regexSrc, value }) => {
    const rx = new RegExp(regexSrc, "i");
    const vis = (el) => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && r.width > 2 && r.height > 2; };
    const inputs = [...document.querySelectorAll("input")].filter(vis);
    const target = inputs.find(el => rx.test(el.getAttribute("aria-label") || ""));
    if (!target) return { ok: false, reason: "no_input" };
    target.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(target, String(value));
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    target.blur();
    return { ok: true, value: target.value, aria: target.getAttribute("aria-label") };
  }, { regexSrc, value });
}

// ── Helper: set slider input by nearby field label ───────────────────────
// Use this for controls such as "Shard count" and "Replica count", where the
// aria-label range may overlap or appear in a different order than expected.
async function setNumberByFieldLabel(page, fieldLabel, value) {
  return await page.evaluate(({ fieldLabel, value }) => {
    const labelRx = new RegExp(`^${fieldLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    const vis = (el) => {
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      return s.display !== "none" && s.visibility !== "hidden" && r.width > 2 && r.height > 2;
    };
    const textOf = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();
    const labels = [...document.querySelectorAll("label,.azc-formElementLabel,span,div")]
      .filter(vis)
      .filter(el => labelRx.test(textOf(el)));
    if (!labels.length) return { ok: false, reason: "label_not_found", fieldLabel };

    const inputs = [...document.querySelectorAll("input")].filter(vis);
    let best = null;
    for (const label of labels) {
      const labelRect = label.getBoundingClientRect();
      const candidates = inputs
        .map(input => ({ input, rect: input.getBoundingClientRect() }))
        .filter(x => x.rect.top >= labelRect.top - 8 && x.rect.top <= labelRect.top + 140)
        .map(x => ({ ...x, distance: Math.abs(x.rect.top - labelRect.top) + Math.max(0, labelRect.left - x.rect.left) }));
      candidates.sort((a, b) => a.distance - b.distance);
      if (candidates[0] && (!best || candidates[0].distance < best.distance)) best = candidates[0];
    }
    if (!best) return { ok: false, reason: "input_not_found", fieldLabel };

    const target = best.input;
    target.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(target, String(value));
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    target.blur();
    return { ok: true, fieldLabel, value: target.value, aria: target.getAttribute("aria-label") };
  }, { fieldLabel, value });
}

// ── Helper: click a footer/nav button by visible text (DOM click) ─────────
async function clickFooterByText(page, text) {
  await dismissOverlays(page);
  const ok = await page.evaluate((t) => {
    const vis = (el) => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && r.width > 4 && r.height > 4; };
    const btns = [...document.querySelectorAll('button, [role="button"]')].filter(vis);
    const btn = btns.find(b => {
      const x = (b.textContent || "").replace(/\s+/g, " ").trim();
      return x === t || x.startsWith(t);
    });
    if (!btn) return false;
    btn.scrollIntoView({ block: "center", behavior: "instant" });
    btn.click();
    return true;
  }, text);
  await page.waitForTimeout(1500);
  return ok;
}

// ── Helper: read visible toggle states for invariant check ────────────────
async function verifyAdvancedInvariant(page, wantMap) {
  const states = await page.evaluate((labels) => {
    const vis = (el) => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && r.width > 4 && r.height > 4 && r.y > 0 && r.y < window.innerHeight; };
    const out = {};
    for (const label of labels) {
      const nodes = [...document.querySelectorAll(`[aria-label="${label}"]`)].filter(vis);
      out[label] = nodes.length ? nodes[0].getAttribute("aria-checked") : null;
    }
    return out;
  }, Object.keys(wantMap));
  let ok = true;
  for (const [k, v] of Object.entries(wantMap)) {
    if (states[k] !== String(v)) ok = false;
  }
  return { ok, states };
}

module.exports = { visibleDropdowns, pickDD, pickDDNoType, queryOrCreateVNet, goNext, choosePublicEndpoint, selectZones, setToggle, ensureAdvancedTab, setNumberByAriaRange, setNumberByFieldLabel, clickFooterByText, dismissOverlays, verifyAdvancedInvariant };

// ── REMOVED: cfg block, CREATE_URL, and main execution IIFE ──────────────────
// The full creation flow is documented and executed via skills/cache-creation/SKILL.md.
// Run the skill directly instead of invoking this file as a standalone script.

// ── Placeholder to prevent accidental direct execution ───────────────────────
if (require.main === module) {
  console.error("This file exports helper functions only. Execute the creation flow via the cache-creation skill (SKILL.md).");
  process.exit(1);
}

// End of helpers. Full creation flow is in skills/cache-creation/SKILL.md.
