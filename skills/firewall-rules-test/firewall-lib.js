// Helper for firewall blade tests.
// Source-of-truth implementation for the firewall-rules-test skill.
// Mirror of d:/junru/runs/firewall/lib.js — keep in sync.
const { chromium } = require('playwright');
const cp = require('child_process');

const SUB = '1e57c478-0901-4c02-8d35-49db234b78d2';
const RG = 'test_song';
const CACHE = 'fwtest-cuse-0602';
const ARM_ID = `/subscriptions/${SUB}/resourceGroups/${RG}/providers/Microsoft.Cache/Redis/${CACHE}`;
const FW_URL = `https://ms.portal.azure.com/?l=en.en-us#@microsoft.onmicrosoft.com/resource${ARM_ID}/firewallRules`;
const API = '2024-11-01';

async function connect() {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = b.contexts()[0];
  let p = ctx.pages().find(x => x.url().includes('ms.portal.azure.com'));
  if (!p) p = await ctx.newPage();
  await p.bringToFront();
  if (!p.url().toLowerCase().includes('firewallrules')) {
    await p.goto(FW_URL, { waitUntil: 'load' });
  }
  return { b, p };
}

async function reloadBlade(p) {
  // Force a true server reload — Portal hash-routing causes goto(FW_URL) to be a no-op
  // when already on the page, leaving stale React state visible.
  // First try to clean any dirty state so the browser's "leave page?" prompt doesn't block navigation.
  try {
    const f = await getFwFrame(p, 8000);
    // Close any open dialog (Add / Confirm) by pressing Escape twice.
    await p.keyboard.press('Escape').catch(() => {});
    await p.waitForTimeout(300);
    await p.keyboard.press('Escape').catch(() => {});
    await p.waitForTimeout(300);
    const s = await getToolbarStates(f);
    if (s.Discard && !s.Discard.disabled) {
      try { await discardAndConfirm(f, 8000); } catch { /* ignore */ }
    }
  } catch { /* not on blade yet */ }
  // Auto-accept any beforeunload prompt that may still pop.
  p.once('dialog', d => d.accept().catch(() => {}));
  await p.goto('about:blank').catch(() => {});
  await p.waitForTimeout(800);
  await p.goto(FW_URL, { waitUntil: 'load' });
  await p.waitForTimeout(6000);
}

async function getFwFrame(p, timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    for (const f of p.frames()) {
      const ok = await f.evaluate(() => {
        // Strip leading PUA icon glyph(s), then trim whitespace.
        const n = (s) => (s || '').replace(/^[\uE000-\uF8FF\s]+/, '').trim();
        const labels = [...document.querySelectorAll('button[role="menuitem"]')]
          .map(b => n(b.innerText));
        return ['Save', 'Discard', 'Add'].every(k => labels.includes(k));
      }).catch(() => false);
      if (ok) return f;
    }
    await p.waitForTimeout(800);
  }
  throw new Error('firewall blade frame not found');
}

async function getToolbarStates(frame) {
  return frame.evaluate(() => {
    const n = (s) => (s || '').replace(/^[\uE000-\uF8FF\s]+/, '').trim();
    const out = {};
    for (const lbl of ['Save', 'Discard', 'Add']) {
      const btn = [...document.querySelectorAll('button[role="menuitem"]')]
        .find(b => n(b.innerText) === lbl);
      out[lbl] = btn ? {
        disabled: btn.disabled || btn.getAttribute('aria-disabled') === 'true',
      } : null;
    }
    return out;
  });
}

async function clickToolbar(frame, label) {
  const ok = await frame.evaluate((lbl) => {
    const n = (s) => (s || '').replace(/^[\uE000-\uF8FF\s]+/, '').trim();
    const btn = [...document.querySelectorAll('button[role="menuitem"]')]
      .find(b => n(b.innerText) === lbl);
    if (!btn) return 'not-found';
    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return 'disabled';
    btn.scrollIntoView({ block: 'center' });
    btn.click();
    return 'ok';
  }, label);
  if (ok !== 'ok') throw new Error(`toolbar ${label}: ${ok}`);
}

// Fill the new row's three fields by selecting via field label, not by index.
// Existing rules also render IP inputs, so nth() can target the wrong row.
async function fillNewRule(frame, { name, startIP, endIP }) {
  // Use real keyboard to ensure React (Fluent UI TextField) onChange fires.
  const page = frame.page();
  const fillByLabel = async (re, value) => {
    if (value === undefined) return;
    const handle = await frame.evaluateHandle((reSrc) => {
      const r = new RegExp(reSrc, 'i');
      const labels = [...document.querySelectorAll('label[for]')].filter(l => l.offsetParent !== null);
      const matched = labels.filter(l => r.test((l.innerText || '').trim()));
      const inputs = matched.map(l => document.getElementById(l.getAttribute('for'))).filter(Boolean);
      return inputs[inputs.length - 1] || null;
    }, re.source);
    const el = handle.asElement();
    if (!el) throw new Error('fillNewRule: label not found ' + re);
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.click({ clickCount: 3, timeout: 5000 }); // triple click selects all
    await page.keyboard.press('Delete');
    if (value !== '') {
      await page.keyboard.type(String(value), { delay: 30 });
    }
    await page.keyboard.press('Tab');
    await frame.waitForTimeout(250);
  };
  await fillByLabel(/^rule name$/, name);
  await fillByLabel(/^start ip address$/, startIP);
  await fillByLabel(/^end ip address$/, endIP);
  await frame.waitForTimeout(300);
}

async function getFieldErrors(frame) {
  return frame.evaluate(() => {
    const errs = [];
    document.querySelectorAll('[role="alert"], .ms-TextField-errorMessage, [aria-invalid="true"]')
      .forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width < 5 || r.height < 5) return;
        const t = (el.innerText || el.getAttribute('aria-label') || '').trim();
        errs.push({ tag: el.tagName, txt: t.slice(0, 200), invalid: el.getAttribute('aria-invalid') === 'true' });
      });
    return errs.filter(e => e.txt || e.invalid);
  });
}

async function getRowCount(frame) {
  return frame.evaluate(() => {
    return [...document.querySelectorAll('tr, [role="row"]')].filter(r => {
      const cells = r.querySelectorAll('td, [role="cell"], [role="gridcell"]');
      return cells.length >= 2;
    }).length;
  });
}

async function deleteLastRow(frame) {
  const ok = await frame.evaluate(() => {
    const rows = [...document.querySelectorAll('tr, [role="row"]')]
      .filter(r => r.querySelectorAll('td, [role="cell"], [role="gridcell"]').length >= 2);
    if (!rows.length) return 'no-rows';
    const last = rows[rows.length - 1];
    const btn = last.querySelector('button[aria-label*="elete" i], [role="button"][aria-label*="elete" i], button[title*="elete" i]')
              || last.querySelector('button.ms-Button[aria-label]');
    if (!btn) return 'no-delete-btn';
    btn.click();
    return 'ok';
  });
  if (ok !== 'ok') throw new Error('deleteLastRow: ' + ok);
}

async function waitSaveDisabledAgain(frame, timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await getToolbarStates(frame);
    if (s.Save && s.Save.disabled) return true;
    await frame.page().waitForTimeout(1000);
  }
  return false;
}

async function clickDialogOk(frame, timeoutMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await frame.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null);
      const okBtn = buttons.find(b => (b.innerText || '').trim() === 'Ok');
      if (!okBtn) return 'not-found';
      if (okBtn.disabled || okBtn.getAttribute('aria-disabled') === 'true') return 'disabled';
      okBtn.scrollIntoView({ block: 'center' });
      okBtn.click();
      return 'ok';
    });
    if (r === 'ok') return r;
    await frame.page().waitForTimeout(300);
  }
  // Final state for caller diagnostics.
  return frame.evaluate(() => {
    const okBtn = [...document.querySelectorAll('button')].find(b => (b.innerText || '').trim() === 'Ok');
    if (!okBtn) return 'timeout-not-found';
    return okBtn.disabled ? 'timeout-disabled' : 'timeout-enabled-but-failed';
  });
}

async function clickDialogCancel(frame) {
  return frame.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null);
    const btn = buttons.find(b => (b.innerText || '').trim() === 'Cancel');
    if (!btn) return 'not-found';
    btn.click();
    return 'ok';
  });
}

// Click 'Yes' / 'No' on the "Unsaved Changes" confirm dialog that appears
// after pressing the toolbar Discard button.
async function confirmUnsavedChanges(frame, choice = 'Yes', timeoutMs = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await frame.evaluate((label) => {
      const dlgs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')]
        .filter(d => d.offsetParent !== null && /unsaved/i.test(d.innerText || ''));
      if (!dlgs.length) return 'not-found';
      const dlg = dlgs[0];
      const btn = [...dlg.querySelectorAll('button')].find(b => b.offsetParent !== null && (b.innerText || '').trim().toLowerCase() === label.toLowerCase());
      if (!btn) return 'btn-not-found';
      btn.click();
      return 'ok';
    }, choice);
    if (r === 'ok') return r;
    await frame.page().waitForTimeout(300);
  }
  return 'timeout';
}

// Convenience: click toolbar Discard, then confirm Yes, and wait until toolbar
// Save/Discard go disabled (clean state).
async function discardAndConfirm(frame, timeoutMs = 15000) {
  await clickToolbar(frame, 'Discard');
  await frame.page().waitForTimeout(800);
  const r = await confirmUnsavedChanges(frame, 'Yes', 8000);
  if (r !== 'ok') throw new Error('discardAndConfirm: confirm Yes failed (' + r + ')');
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await getToolbarStates(frame);
    if (s.Save && s.Save.disabled && s.Discard && s.Discard.disabled) return true;
    await frame.page().waitForTimeout(500);
  }
  return false;
}


function restList() {
  const out = cp.execSync(
    `az rest --method get --uri "https://management.azure.com${ARM_ID}/firewallRules?api-version=${API}" --query "value[].{name:name,start:properties.startIP,end:properties.endIP}" -o json`,
    { encoding: 'utf8' });
  const arr = JSON.parse(out);
  // Names come back as "<cache>/<rule>" — strip the prefix.
  return arr.map(r => ({ ...r, name: r.name.includes('/') ? r.name.split('/').pop() : r.name }));
}
function restPut(name, startIP, endIP) {
  const body = `{\\"properties\\":{\\"startIP\\":\\"${startIP}\\",\\"endIP\\":\\"${endIP}\\"}}`;
  cp.execSync(
    `az rest --method put --uri "https://management.azure.com${ARM_ID}/firewallRules/${name}?api-version=${API}" --body "${body}"`,
    { stdio: 'pipe' });
}
function restDelete(name) {
  cp.execSync(
    `az rest --method delete --uri "https://management.azure.com${ARM_ID}/firewallRules/${name}?api-version=${API}"`,
    { stdio: 'pipe' });
}
function restDeleteAll() {
  for (const r of restList()) restDelete(r.name);
}

// Inline-edit one IP cell of a persisted row by column index.
// colIndex: 0 = Start IP, 1 = End IP. Uses real mouse click + keyboard
// so Fluent UI TextField onChange fires (required to dirty the toolbar).
//
// Pitfall: the validator forbids End < Start at any keystroke. When widening
// the range, edit End first; when narrowing, edit Start first.
async function inlineEditByIndex(page, frame, ruleName, colIndex, newValue) {
  const handle = await frame.evaluateHandle(({ nm, idx }) => {
    const leaf = [...document.querySelectorAll('*')].find(el =>
      el.children.length === 0 && (el.textContent || '').trim() === nm && el.offsetParent !== null);
    if (!leaf) return null;
    let row = leaf;
    for (let i = 0; i < 15 && row.parentElement; i++) {
      row = row.parentElement;
      const inps = [...row.querySelectorAll('input')].filter(x => x.offsetParent !== null);
      if (inps.length >= 2) return inps[idx] || null;
    }
    return null;
  }, { nm: ruleName, idx: colIndex });
  const el = handle.asElement();
  if (!el) throw new Error(`inlineEditByIndex: row=${ruleName} col=${colIndex} not found`);
  await el.scrollIntoViewIfNeeded();
  await el.click({ clickCount: 3 });
  await page.keyboard.press('Delete');
  await page.keyboard.type(String(newValue), { delay: 30 });
  await page.keyboard.press('Tab');
  await frame.waitForTimeout(800);
}

// Click the per-row trash button on the row whose leaf-text equals `ruleName`.
// Returns 'clicked' / 'no-leaf' / 'no-trash'.
async function clickRowTrash(frame, ruleName) {
  return frame.evaluate((nm) => {
    const leaf = [...document.querySelectorAll('*')].find(el =>
      el.children.length === 0 && (el.textContent || '').trim() === nm && el.offsetParent !== null);
    if (!leaf) return 'no-leaf';
    let row = leaf;
    for (let i = 0; i < 15 && row.parentElement; i++) {
      row = row.parentElement;
      const btn = row.querySelector('button[aria-label*="Delete Firewall" i], button[aria-label*="elete" i]');
      if (btn && btn.offsetParent !== null) { btn.click(); return 'clicked'; }
    }
    return 'no-trash';
  }, ruleName);
}

// Enumerate visible rule names by scanning rows that contain ≥ 2 inputs and
// extracting their leaf text. Works for both persisted (name = <td>) and
// unsaved (name = leaf div) rows.
async function visibleRuleNames(frame) {
  return frame.evaluate(() => {
    const out = new Set();
    const inps = [...document.querySelectorAll('input')].filter(i => i.offsetParent !== null);
    const rows = new Set();
    inps.forEach(inp => {
      let row = inp;
      for (let i = 0; i < 12 && row.parentElement; i++) {
        row = row.parentElement;
        if (row.querySelectorAll('input').length >= 2) { rows.add(row); break; }
      }
    });
    rows.forEach(r => {
      [...r.querySelectorAll('*')].forEach(el => {
        if (el.children.length === 0) {
          const t = (el.textContent || '').trim();
          if (/^[A-Za-z0-9_]{1,40}$/.test(t) && !/^\d+\.\d+\.\d+\.\d+$/.test(t)) out.add(t);
        }
      });
    });
    return [...out];
  });
}

// Read the visible quota / save-required banner texts (filters out long
// recommendation banners). Returns the raw banner strings.
async function getBannerTexts(frame) {
  return frame.evaluate(() => {
    return [...document.querySelectorAll('[role="status"], [role="alert"], .ms-MessageBar')]
      .filter(el => el.offsetParent !== null)
      .map(b => (b.innerText || '').trim())
      .filter(t => t.length > 0 && t.length < 400);
  });
}

module.exports = {
  SUB, RG, CACHE, ARM_ID, FW_URL,
  connect, reloadBlade, getFwFrame, getToolbarStates, clickToolbar,
  fillNewRule, getFieldErrors, getRowCount, deleteLastRow, waitSaveDisabledAgain,
  clickDialogOk, clickDialogCancel, confirmUnsavedChanges, discardAndConfirm,
  inlineEditByIndex, clickRowTrash, visibleRuleNames, getBannerTexts,
  restList, restPut, restDelete, restDeleteAll,
};
