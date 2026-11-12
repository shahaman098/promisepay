import { chromium } from "/opt/homebrew/lib/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
import fs from "node:fs";
const S = process.cwd();
const BASE = "http://localhost:8799";
const N = Object.fromEntries(JSON.parse(fs.readFileSync("narration.json")).map((s) => [s.id, s]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: "/Users/efi/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 4 / 3 });
const OVERLAY = `(() => { if (document.getElementById('__cap')) return;
  const c = document.createElement('div'); c.id='__cap';
  c.style.cssText='position:fixed;left:50%;bottom:26px;transform:translateX(-50%);max-width:1100px;width:max-content;background:rgba(0,16,60,.88);color:#fff;font:600 21px/1.4 Inter Variable,system-ui,sans-serif;padding:10px 20px;border-radius:12px;z-index:99999;text-align:center;pointer-events:none;box-shadow:0 6px 24px rgba(0,0,0,.25)';
  const m = document.createElement('div'); m.id='__cur';
  m.style.cssText='position:fixed;left:720px;top:420px;width:22px;height:22px;border-radius:50%;background:rgba(255,196,57,.9);border:2px solid #001c64;z-index:100000;pointer-events:none;transition:left .6s ease,top .6s ease,transform .15s;transform:translate(-50%,-50%)';
  document.body.appendChild(c); document.body.appendChild(m); })()`;
await ctx.addInitScript(`document.addEventListener('DOMContentLoaded', () => ${OVERLAY})`);
const page = await ctx.newPage();
fs.rmSync(`${S}/frames`, { recursive: true, force: true }); fs.mkdirSync(`${S}/frames`);
const frames = [];
const cdp = await ctx.newCDPSession(page);
cdp.on('Page.screencastFrame', async (f) => {
  const name = `f${String(frames.length).padStart(6, '0')}.jpg`;
  fs.writeFileSync(`${S}/frames/${name}`, Buffer.from(f.data, 'base64'));
  frames.push({ name, ts: f.metadata.timestamp });
  cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
const t0 = Date.now();
const marks = [];

async function overlay() { await page.evaluate(OVERLAY); }
async function cap(text) { await overlay(); await page.evaluate((t) => { const c = document.getElementById('__cap'); c.textContent = t; c.style.display = t ? 'block' : 'none'; }, text); }
async function move(sel) {
  const el = page.locator(sel).first();
  await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox();
  await page.evaluate(([x, y]) => { const m = document.getElementById('__cur'); m.style.left = x + 'px'; m.style.top = y + 'px'; }, [b.x + b.width / 2, b.y + b.height / 2]);
  await sleep(700);
  return el;
}
async function click(sel) {
  const el = await move(sel);
  await page.evaluate(() => { const m = document.getElementById('__cur'); m.style.transform = 'translate(-50%,-50%) scale(.7)'; setTimeout(() => m.style.transform = 'translate(-50%,-50%)', 160); });
  await el.click();
  await sleep(400);
}
async function typeInto(sel, text) { const el = await move(sel); await el.fill(''); await el.type(text, { delay: 28 }); await sleep(300); }
async function scene(id, caption, fn) {
  const start = Date.now();
  marks.push({ id, at: (start - t0) / 1000 });
  await cap(caption);
  await fn();
  const remain = N[id].dur * 1000 + 600 - (Date.now() - start);
  if (remain > 0) await sleep(remain);
}
async function lastId() { const r = await page.request.get(`${BASE}/api/guarantees`, { headers: { 'x-api-key': 'dev-key-change-me' } }); const l = await r.json(); return l[l.length - 1].id; }

// prep: clean demo state (not part of the cut — trimmed by the 'start' mark)
await page.request.post(`${BASE}/api/demo/seed`, { headers: { 'x-api-key': 'dev-key-change-me', 'content-type': 'application/json' }, data: '{}' });
await page.goto(BASE); await page.waitForTimeout(1500); await overlay();
marks.push({ id: 'start', at: (Date.now() - t0) / 1000 });

await scene('hook', 'Nobody filed a claim. The $5 refund already moved, through PayPal.', async () => {
  await move('#buyer-result .badge');
  await sleep(1500);
  await page.mouse.wheel(0, 380); await sleep(600);
});
await scene('problem', 'Guarantees are marketing copy. PromisePay makes them execute themselves.', async () => {
  await page.mouse.wheel(0, -2000); await sleep(800);
  await move('.hero-note'); await sleep(3000);
  await move('.hero-note .pill-pay');
});
await scene('refuse', 'Llama 3.3 (Cloudflare Workers AI) reads the prose. Vague promise → refused.', async () => {
  await click('#tab-merchant');
  await sleep(500);
  await move('#modechip'); await sleep(900);
  await typeInto('#np-text', "If your order arrives after Friday we'll credit you something nice");
  await click('#np-preview');
  await page.waitForFunction(() => document.getElementById('np-out').textContent.includes('refusal'), null, { timeout: 30000 });
  await move('#np-out');
});
await scene('sla', 'Real promise → structured contract: 2-day window, carrier evidence, $5 remedy.', async () => {
  await typeInto('#np-text', '2-day delivery or $5 back');
  await click('#np-preview');
  await page.waitForFunction(() => document.getElementById('np-out').textContent.includes('delivery_by'), null, { timeout: 30000 });
  await move('#np-out'); await sleep(1800);
  await typeInto('#np-order', 'OFFLINE-ORDER-9');
  await typeInto('#np-capture', 'OFFLINE-CAPTURE-9');
  await click('#np-create');
  await sleep(800);
});
let gid;
await scene('evidence', 'Carrier event: lost in transit → verifier returns BREACH.', async () => {
  gid = await lastId();
  await page.evaluate(() => window.scrollTo(0, 0));
  await click(`button[data-act=ev-exception][data-id=${gid}]`);
  await sleep(600);
  await click(`button[data-act=evaluate][data-id=${gid}]`);
  await page.waitForFunction(() => document.getElementById('np-out').textContent.includes('verdict'), null, { timeout: 30000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await move('#np-out');
});
await scene('refund', 'Refund via PayPal Refund API · idempotency key · provenance: fixture (no real money in this demo)', async () => {
  await click(`button[data-act=execute][data-id=${gid}]`);
  await page.waitForFunction(() => document.getElementById('np-out').textContent.includes('execute-remedy'), null, { timeout: 30000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await move('#np-out'); await sleep(2500);
  await page.evaluate(() => { const o = document.getElementById('np-out'); o.scrollTop = 0; });
});
await scene('arch', 'The model decides what was promised. Code decides whether money moves.', async () => {
  await page.goto(`${BASE}/architecture.html`); await overlay(); await cap('The model decides what was promised. Code decides whether money moves.');
  await sleep(4000); await move('svg rect:nth-of-type(4)'); await sleep(3500); await move('svg rect:nth-of-type(7)'); await sleep(4000); await move('svg rect:nth-of-type(9)');
});
await scene('replay', 'Execute again → refused, and written to the enforcement record.', async () => {
  await page.goto(BASE); await overlay(); await cap('Execute again → refused, and written to the enforcement record.');
  await click('#tab-merchant'); await sleep(400);
  await click(`button[data-act=execute][data-id=${gid}]`);
  await page.waitForFunction(() => document.getElementById('np-out').textContent.includes('transition_not_permitted'), null, { timeout: 30000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await move('#np-out'); await sleep(1500);
  await click('#tab-audit'); await sleep(500);
  await move('tr.obl-refused');
});
await scene('numbers', 'Measured: 23/24 correct · 11/11 unsafe refused · 0 false guarantees · 20/20 tests', async () => {
  await page.goto(`file://${S}/terminal.html`); await overlay(); await cap('Measured: 23/24 correct · 11/11 unsafe refused · 0 false guarantees · 20/20 tests');
});
await scene('close', '', async () => {
  await page.goto(`file://${S}/close.html`); await overlay(); await cap(''); await page.evaluate(() => document.getElementById('__cur').style.display = 'none');
});
marks.push({ id: 'end', at: (Date.now() - t0) / 1000 });
await sleep(500);
await cdp.send('Page.stopScreencast').catch(() => {});
await ctx.close(); await browser.close();
fs.writeFileSync('marks.json', JSON.stringify({ t0: t0 / 1000, frames, marks }, null, 1));
console.log(JSON.stringify(marks));
