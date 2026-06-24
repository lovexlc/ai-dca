// Exploratory UI audit driven by a real account login (no network mocking).
// Sweeps every primary tab at desktop + mobile widths and reports:
//  - occlusion: interactive controls whose center is covered by another element
//  - horizontal overflow (page wider than viewport)
//  - clipped / off-screen controls
//  - console errors / page errors
// Findings + full-page screenshots are written under test-results/ui-audit/.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const ACCOUNT = {
  username: process.env.AUDIT_USER || 'lovexl',
  password: process.env.AUDIT_PASS || 'QWer1234@@',
  securityPassword: process.env.AUDIT_SEC || 'QWer1234@@'
};

const OUT_DIR = path.resolve('ui-audit-report');
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

// Tabs reachable via ?tab= . lovexl is an admin so quant + adminData are visible.
const TABS = [
  { key: 'strategy', label: '策略指南' },
  { key: 'holdings', label: '持仓总览' },
  { key: 'tradePlans', label: '交易计划' },
  { key: 'fundSwitch', label: '基金切换' },
  { key: 'markets', label: '行情中心' },
  { key: 'premium', label: '高级版' },
  { key: 'notify', label: '通知' },
  { key: 'quant', label: '量化研究' },
  { key: 'adminData', label: '数据' }
];

const findings = [];
function record(f) {
  findings.push(f);
}

// Runs in the browser: find interactive controls whose visual center is covered
// by an unrelated element (genuine occlusion that would block a click/tap).
const OCCLUSION_FN = () => {
  const SEL = 'button,a[href],[role="button"],[role="tab"],[role="menuitem"],[role="link"],[role="switch"],[role="checkbox"],input:not([type="hidden"]),select,textarea';
  const out = [];
  const describe = (el) => {
    if (!el) return 'none';
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls = (typeof el.className === 'string' && el.className) ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    const txt = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return `${tag}${id}${cls}${txt ? ` "${txt}"` : ''}`;
  };
  for (const el of document.querySelectorAll(SEL)) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) continue;
    if (rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || st.pointerEvents === 'none' || Number(st.opacity) === 0) continue;
    if (el.disabled) continue;
    const cx = Math.min(Math.max(rect.left + rect.width / 2, 1), innerWidth - 1);
    const cy = Math.min(Math.max(rect.top + rect.height / 2, 1), innerHeight - 1);
    const top = document.elementFromPoint(cx, cy);
    if (!top || top === el || el.contains(top) || top.contains(el)) continue;
    // ignore overlays that intentionally cover everything (open modal/backdrop)
    out.push({ control: describe(el), coveredBy: describe(top), at: { x: Math.round(cx), y: Math.round(cy) } });
  }
  return out;
};

const OVERFLOW_FN = () => ({
  horizontal: Math.ceil(document.documentElement.scrollWidth - window.innerWidth),
  scrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth
});

// Controls that extend past the right/left edge (clipped, often a sign of layout break).
const CLIPPED_FN = () => {
  const SEL = 'button,a[href],[role="button"],[role="tab"],input,select';
  const out = [];
  for (const el of document.querySelectorAll(SEL)) {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    if (r.right > window.innerWidth + 2 || r.left < -2) {
      const txt = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      out.push({ control: `${el.tagName.toLowerCase()} "${txt}"`, left: Math.round(r.left), right: Math.round(r.right) });
    }
  }
  return out;
};

async function settle(page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
  await page.waitForTimeout(1200); // let charts/animations settle
}

async function dismissAnnouncement(page) {
  const known = page.getByRole('button', { name: '知道了' });
  if (await known.isVisible().catch(() => false)) {
    await known.click().catch(() => {});
    await page.waitForTimeout(300);
  }
}

async function login(page) {
  await page.goto('./index.html?tab=holdings');
  await settle(page);
  await dismissAnnouncement(page);
  // Open the account auth dialog.
  await page.getByRole('button', { name: '登录账户' }).click();
  const dialog = page.getByRole('dialog', { name: '账户登录' });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByLabel('用户名').fill(ACCOUNT.username);
  await dialog.getByLabel('登录密码').fill(ACCOUNT.password);
  await dialog.getByLabel('安全密码').fill(ACCOUNT.securityPassword);
  await dialog.getByRole('button', { name: /^登录$/ }).last().click();
  // Logged-in state: account button now shows the username.
  await expect(page.getByRole('button', { name: new RegExp(`账户：${ACCOUNT.username}`) }))
    .toBeVisible({ timeout: 30_000 });
}

async function auditView(page, name, viewport) {
  await settle(page);
  const slug = `${name}-${viewport}`.replace(/[^a-z0-9-]/gi, '_');
  const shot = path.join(OUT_DIR, `${slug}.png`);
  await page.screenshot({ path: shot, fullPage: true }).catch(() => {});

  const occ = await page.evaluate(OCCLUSION_FN).catch(() => []);
  const overflow = await page.evaluate(OVERFLOW_FN).catch(() => null);
  const clipped = await page.evaluate(CLIPPED_FN).catch(() => []);

  if (occ.length) record({ view: name, viewport, type: 'occlusion', count: occ.length, items: occ.slice(0, 15) });
  if (overflow && overflow.horizontal > 1) record({ view: name, viewport, type: 'h-overflow', ...overflow });
  if (clipped.length) record({ view: name, viewport, type: 'clipped', count: clipped.length, items: clipped.slice(0, 10) });
  return { occ: occ.length, overflow: overflow?.horizontal ?? 0, clipped: clipped.length };
}

// Occlusion check scoped to the topmost open dialog: a control inside the dialog
// whose center is covered by something that is NOT part of that dialog (or by a
// dialog element sitting over a field, e.g. a sticky footer over an input).
const DIALOG_OCCLUSION_FN = () => {
  const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter((d) => {
    const r = d.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  const dialog = dialogs[dialogs.length - 1];
  if (!dialog) return { noDialog: true, items: [] };
  const SEL = 'button,a[href],[role="button"],[role="tab"],input:not([type="hidden"]),select,textarea';
  const describe = (el) => {
    if (!el) return 'none';
    const txt = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return `${el.tagName.toLowerCase()}${txt ? ` "${txt}"` : ''}`;
  };
  const items = [];
  for (const el of dialog.querySelectorAll(SEL)) {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.pointerEvents === 'none' || Number(st.opacity) === 0 || el.disabled) continue;
    const cx = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
    const cy = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
    const top = document.elementFromPoint(cx, cy);
    if (!top || top === el || el.contains(top) || top.contains(el)) continue;
    items.push({ control: describe(el), coveredBy: describe(top) });
  }
  // Does the dialog itself overflow the viewport (clipped / unscrollable)?
  const dr = dialog.getBoundingClientRect();
  const overflow = { top: Math.round(dr.top), bottom: Math.round(dr.bottom - innerHeight), right: Math.round(dr.right - innerWidth), left: Math.round(dr.left) };
  return { items, overflow };
};

async function auditOverlay(page, name, viewport) {
  await page.waitForTimeout(600);
  const slug = `overlay-${name}-${viewport}`.replace(/[^a-z0-9-]/gi, '_');
  await page.screenshot({ path: path.join(OUT_DIR, `${slug}.png`), fullPage: false }).catch(() => {});
  // Floating (non-modal) panels can cover other controls — full-page detector applies.
  const full = await page.evaluate(OCCLUSION_FN).catch(() => []);
  if (full.length) record({ view: name, viewport, type: 'overlay-occlusion', count: full.length, items: full.slice(0, 15) });
  // Modal dialogs: check interior controls + whether the dialog is clipped.
  const dlg = await page.evaluate(DIALOG_OCCLUSION_FN).catch(() => ({ noDialog: true }));
  if (dlg && !dlg.noDialog) {
    if (dlg.items?.length) record({ view: name, viewport, type: 'dialog-occlusion', count: dlg.items.length, items: dlg.items.slice(0, 15) });
    const o = dlg.overflow || {};
    if (o.top < -2 || o.bottom > 2 || o.right > 2 || o.left < -2) record({ view: name, viewport, type: 'dialog-clipped', overflow: o });
  }
}

test.describe.serial('full UI audit (real account)', () => {
  test('login + sweep all tabs (desktop & mobile)', async ({ browser }) => {
    test.setTimeout(600_000);
    fs.mkdirSync(OUT_DIR, { recursive: true });

    for (const viewport of ['desktop', 'mobile']) {
      const context = await browser.newContext({ viewport: viewport === 'desktop' ? DESKTOP : MOBILE });
      // Suppress the release-announcement modal so it doesn't block interaction.
      await context.addInitScript(() => { window.__AI_DCA_RELEASE_ANNOUNCEMENT__ = { enabled: false }; });
      const page = await context.newPage();
      const consoleErrors = [];
      page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
      page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

      await login(page);

      for (const tab of TABS) {
        const before = consoleErrors.length;
        await page.goto(`./index.html?tab=${tab.key}`);
        const res = await auditView(page, tab.key, viewport);
        const newErrors = consoleErrors.slice(before);
        if (newErrors.length) record({ view: tab.key, viewport, type: 'console', count: newErrors.length, items: [...new Set(newErrors)].slice(0, 8) });
        // eslint-disable-next-line no-console
        console.log(`[${viewport}] ${tab.key.padEnd(12)} occlusion=${res.occ} overflow=${res.overflow} clipped=${res.clipped} console=${newErrors.length}`);
      }

      // --- Interactive overlays (classic occlusion sources) ---
      // 1) AI chat floating widget
      await page.goto('./index.html?tab=holdings');
      await settle(page);
      const aiBtn = page.getByRole('button', { name: '打开 AI 问答' }).first();
      if (await aiBtn.isVisible().catch(() => false)) {
        await aiBtn.click().catch(() => {});
        await auditOverlay(page, 'ai-chat', viewport);
        await page.keyboard.press('Escape').catch(() => {});
      }

      // 2) Account dropdown / menu
      const acctBtn = page.getByRole('button', { name: new RegExp(`账户：${ACCOUNT.username}`) }).first();
      if (await acctBtn.isVisible().catch(() => false)) {
        await acctBtn.click().catch(() => {});
        await auditOverlay(page, 'account-menu', viewport);
        await page.keyboard.press('Escape').catch(() => {});
      }

      // 3) New trade plan modal
      await page.goto('./index.html?tab=tradePlans');
      await settle(page);
      const newPlan = page.getByRole('button', { name: /新建计划/ }).first();
      if (await newPlan.isVisible().catch(() => false)) {
        await newPlan.click().catch(() => {});
        await page.waitForTimeout(600);
        await auditOverlay(page, 'new-plan', viewport);
        await page.keyboard.press('Escape').catch(() => {});
      }

      // 4) Holdings "新增单笔" modal
      await page.goto('./index.html?tab=holdings');
      await settle(page);
      const addLot = page.getByRole('button', { name: /新增单笔/ }).first();
      if (await addLot.isVisible().catch(() => false)) {
        await addLot.click().catch(() => {});
        await page.waitForTimeout(600);
        await auditOverlay(page, 'add-lot', viewport);
        await page.keyboard.press('Escape').catch(() => {});
      }

      await context.close();
    }

    fs.writeFileSync(path.join(OUT_DIR, 'findings.json'), JSON.stringify(findings, null, 2));
    // eslint-disable-next-line no-console
    console.log(`\n=== UI AUDIT: ${findings.length} finding group(s) — see ${OUT_DIR}/findings.json ===`);
    for (const f of findings) {
      // eslint-disable-next-line no-console
      console.log(`- [${f.viewport}] ${f.view} :: ${f.type}${f.count ? ` (${f.count})` : ''}`);
    }
  });
});
