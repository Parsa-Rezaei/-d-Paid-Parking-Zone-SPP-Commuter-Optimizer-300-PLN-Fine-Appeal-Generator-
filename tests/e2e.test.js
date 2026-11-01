// Testy end-to-end (Playwright + Chromium + pdftotext) – kalkulator, PDF i bezpieczeństwo płatności.
// Uruchom: node tests/e2e.test.js   (wymaga: playwright z przeglądarką Chromium, poppler-utils)
// /api/verify jest mockowane przez page.route – serwer testowy serwuje wyłącznie katalog public/.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const SITE = path.join(REPO, 'public'); // katalog publikowany (Cloudflare Pages: output directory = public)
const OUT = path.join(REPO, 'test-output');
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  PASS', name);
  else { failures++; console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ''); }
}

/* ---------- nagłówki z pliku _headers (blok "/*") ---------- */
const HEADERS = {};
{
  let inBlock = false;
  for (const line of fs.readFileSync(path.join(SITE, '_headers'), 'utf8').split('\n')) {
    if (/^\S/.test(line)) inBlock = line.trim() === '/*';
    else if (inBlock && line.includes(':')) { const i = line.indexOf(':'); HEADERS[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  }
}

/* ---------- statyczny serwer katalogu public/ ---------- */
const MODE = { paymentUrl: '' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain', '.xml': 'application/xml' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html');
  const p = path.join(SITE, rel);
  if (!p.startsWith(SITE + path.sep) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  let body = fs.readFileSync(p);
  if (rel === '/assets/config.js' && MODE.paymentUrl) body = Buffer.from(body.toString('utf8').replace("paymentUrl: '',", `paymentUrl: '${MODE.paymentUrl}',`));
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store', ...HEADERS });
  res.end(body);
});

/* ---------- mock /api/verify (page.route): paid:true tylko dla pary session_id + ref z „opłaconej” sesji ---------- */
const VERIFY = { ready: true, paid: new Map(), calls: [] };
async function mockVerify(page) {
  await page.route('**/api/verify*', route => {
    const u = new URL(route.request().url());
    VERIFY.calls.push(u.search);
    let body;
    if (u.searchParams.has('ping')) body = { ready: VERIFY.ready };
    else {
      const sid = u.searchParams.get('session_id'), ref = u.searchParams.get('ref');
      body = { paid: !!sid && VERIFY.paid.get(sid) === ref };
    }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function newPage(browser, opts = {}) {
  const context = await browser.newContext({ locale: 'pl-PL', timezoneId: 'Europe/Warsaw', acceptDownloads: true, viewport: { width: 1280, height: 900 }, ...opts });
  await context.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const page = await context.newPage();
  page.errors = [];
  page.external = [];
  page.on('pageerror', e => page.errors.push(String(e)));
  // Chrome ignoruje nagłówek COOP na testowym hoście http (na produkcji jest HTTPS) – to nie jest błąd aplikacji.
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('Cross-Origin-Opener-Policy header has been ignored')) page.errors.push(m.text()); });
  page.on('request', r => { const u = r.url(); if (!/^(http:\/\/(127\.0\.0\.1|spp\.test)(:\d+)?\/|data:|blob:|https:\/\/buy\.stripe\.com\/)/.test(u)) page.external.push(u); });
  await mockVerify(page);
  return { context, page };
}
async function pdfText(download, name) {
  const f = path.join(OUT, name);
  await download.saveAs(f);
  return execFileSync('pdftotext', ['-layout', f, '-']).toString();
}
async function fillAppeal(page) {
  for (const [s, v] of [
    ['#a-name', 'Łukasz Żółkiewski'], ['#a-street', 'ul. Źródlana 5/12'], ['#a-city', '90-001 Łódź'], ['#a-email', 'anna@example.com'],
    ['#a-reportNo', 'ZDiT-123-2026'], ['#a-plate', 'el 12345'], ['#a-controlDate', '2026-03-02'], ['#a-place', 'ul. Piotrkowska 100'],
    ['#a-app', 'AnyPark'], ['#a-payDate', '2026-03-02'], ['#a-wrongPlate', 'el 1234o']
  ]) await page.fill(s, v);
}
const isUnlocked = page => page.evaluate(() => !document.getElementById('lockedPreview') && /opłacony|demonstracyjny/.test(document.getElementById('getPdf').textContent));
const PAY_KEY = 'spp_pay_v1';

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const LOCAL = `http://127.0.0.1:${port}`;
  const PROD = `http://spp.test:${port}`; // „prawdziwa” domena (nie-lokalna) – tryb demo musi być wyłączony
  const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP spp.test 127.0.0.1`] });

  /* ======================= 1. Kalkulator (bezpłatny) ======================= */
  console.log('CALCULATOR');
  let { context, page } = await newPage(browser);
  await page.goto(PROD + '/');
  await page.fill('#parkDate', '2026-03-02'); // poniedziałek
  await page.fill('#tStart', '08:00');
  await page.fill('#tEnd', '11:00');
  check('A / Łodzianin / 3 h = 6,00 + 7,20 + 8,60 = 21,80 zł', (await page.textContent('#stayTotal')).replace(/\s/g, ' ') === '21,80 zł', await page.textContent('#stayTotal'));
  await page.click('label.seg:has(input[name=status][value=przyjezdny])');
  check('A / przyjezdny / 3 h = 24,90 zł', (await page.textContent('#stayTotal')).includes('24,90'), await page.textContent('#stayTotal'));
  await page.fill('#tEnd', '16:00');
  await page.click('label.seg:has(input[name=zone][value=B])');
  check('B / przyjezdny / 8 h = 6,00+7,20+8,60+5×6,00 = 51,80 zł', (await page.textContent('#stayTotal')).includes('51,80'), await page.textContent('#stayTotal'));
  await page.fill('#parkDate', '2026-03-07'); // sobota
  check('Saturday is free', (await page.textContent('#stayTotal')).includes('0,00') && (await page.textContent('#dayBadge')).includes('sobota'));
  await page.fill('#parkDate', '2026-12-24');
  check('Wigilia 2026 is free', (await page.textContent('#dayBadge')).includes('Wigilia'));
  await page.fill('#parkDate', '2026-03-02');
  await page.click('label.seg:has(input[name=engine][value=bev])');
  check('BEV is free', (await page.textContent('#stayTotal')).includes('0,00'));
  check('rate table rendered (4 rows)', (await page.$$('#rateTable tr')).length === 4);
  check('partner slot: neutral box, no invented business', (await page.textContent('#partnerEmpty')).includes('Miejsce dla partnera – kontakt') && await page.$eval('#partnerBox', e => e.hidden));
  check('SECURITY: no letter/PDF/payment functions reachable from console',
    await page.evaluate(() => ['buildLetter', 'buildPdf', 'downloadPdf', 'onPay', 'PAID', 'CONFIG', 'isUnlocked'].filter(k => typeof window[k] !== 'undefined').length === 0));
  check('no JS errors (calculator)', page.errors.length === 0, page.errors);
  await context.close();

  /* ======================= 2. Tryb demo – tylko localhost bez linku płatności ======================= */
  console.log('LOCAL DEMO');
  MODE.paymentUrl = '';
  ({ context, page } = await newPage(browser));
  await page.goto(LOCAL + '/');
  await fillAppeal(page);
  check('demo: preview fully visible on 127.0.0.1', await isUnlocked(page));
  await page.click('#getPdf');
  check('demo: note visible in checkout', await page.$eval('#coDemo', e => !e.hidden));
  await page.check('#coTerms'); await page.check('#coWithdraw');
  let [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#coPay')]);
  let txt = await pdfText(dl, 'demo.pdf');
  check('demo PDF: Polish diacritics', txt.includes('Łukasz Żółkiewski') && txt.includes('Źródlana') && txt.includes('90-001 Łódź') && txt.includes('wyjaśnienie'), txt.slice(0, 400));
  check('SECURITY: zero CSP violations (demo incl. PDF)', (await page.evaluate(() => window.__csp)).length === 0, await page.evaluate(() => window.__csp));
  check('SECURITY: no third-party requests', page.external.length === 0, page.external);
  check('no JS errors (demo)', page.errors.length === 0, page.errors);
  await context.close();

  /* ======================= 3. Produkcja bez linku płatności ======================= */
  console.log('PRODUCTION – payments not configured');
  ({ context, page } = await newPage(browser));
  await page.goto(PROD + '/');
  await fillAppeal(page);
  check('locked on real domain without payment link (no free demo)', !(await isUnlocked(page)));
  await page.click('#getPdf');
  check('"Sprzedaż chwilowo niedostępna" shown, pay button disabled', await page.$eval('#coUnavailable', e => !e.hidden && e.textContent.includes('nie pobraliśmy żadnych środków')) && await page.$eval('#coPay', b => b.disabled));
  let downloaded = false;
  page.on('download', () => { downloaded = true; });
  await page.check('#coTerms'); await page.check('#coWithdraw');
  await page.click('#coPay', { force: true }).catch(() => {});
  await page.waitForTimeout(500);
  check('no PDF delivered without payment', !downloaded);
  await context.close();

  /* ======================= 4. Produkcja: próby obejścia i pełny przepływ płatności ======================= */
  console.log('PRODUCTION – payment flow');
  MODE.paymentUrl = 'https://buy.stripe.com/test_e2e';
  ({ context, page } = await newPage(browser));
  const captured = [];
  let paidSid = '';
  await page.route('https://buy.stripe.com/**', route => {
    const u = new URL(route.request().url());
    captured.push(u.href);
    paidSid = 'cs_live_' + crypto.randomBytes(12).toString('hex');
    VERIFY.paid.set(paidSid, u.searchParams.get('client_reference_id'));
    route.fulfill({ status: 302, headers: { location: `${PROD}/?platnosc=sukces&session_id=${paidSid}` } });
  });
  downloaded = false;
  page.on('download', () => { downloaded = true; });
  await page.goto(PROD + '/');
  await fillAppeal(page);
  const lockedHtml = await page.$eval('#preview', e => e.innerHTML);
  check('locked preview shows grey bars', lockedHtml.includes('lockedPreview') && lockedHtml.includes('bg-slate-300'));
  check('SECURITY: paid letter text is NOT in the page', !lockedHtml.includes('Uzasadnienie') && !lockedHtml.includes('Mając powyższe') && !lockedHtml.includes('art. 13f') && !lockedHtml.includes('omyłki pisarskiej'));

  // Obejście 1: ręcznie dopisane ?platnosc=sukces
  await page.goto(PROD + '/?platnosc=sukces');
  await page.waitForTimeout(600);
  check('SECURITY: ?platnosc=sukces alone does not unlock', !(await isUnlocked(page)));
  check('URL cleaned', !page.url().includes('platnosc'));
  await page.goto(PROD + '/?platnosc=sukces&session_id=cs_live_fakefakefake12345');
  await page.waitForTimeout(600);
  check('SECURITY: ?platnosc=sukces + invented session_id does not unlock', !(await isUnlocked(page)));
  check('form data kept in this tab across navigations', (await page.inputValue('#a-name')) === 'Łukasz Żółkiewski');
  await page.click('#getPdf');
  await page.waitForTimeout(300);
  check('clicking PDF while locked opens checkout, no download', await page.$eval('#dlgCheckout', d => d.open) && !downloaded);
  await page.click('#dlgCheckout [data-close]');

  // Obejście 2: podrobiony localStorage
  await page.evaluate(k => {
    localStorage.setItem(k, JSON.stringify({ ref: 'w' + 'a'.repeat(32), sid: 'cs_live_forgedforged1234', ts: Date.now() }));
    localStorage.setItem('paid', 'true'); localStorage.setItem('unlocked', '1'); localStorage.setItem('spp_unlock', '1');
  }, PAY_KEY);
  VERIFY.calls.length = 0;
  await page.reload();
  await page.waitForTimeout(800);
  check('SECURITY: faked localStorage does not unlock', !(await isUnlocked(page)));
  check('forged record was checked by the server and removed', VERIFY.calls.some(q => q.includes('cs_live_forgedforged1234')) && await page.evaluate(k => localStorage.getItem(k) === null, PAY_KEY));
  check('no PDF downloaded by any bypass attempt', !downloaded);

  // Zgody są obowiązkowe
  await page.click('#getPdf');
  await page.click('#coPay');
  await page.waitForTimeout(200);
  check('consents required before redirect', captured.length === 0 && await page.$eval('#coError', e => !e.hidden && e.textContent.includes('obie zgody')));

  // Prawdziwa płatność: redirect z client_reference_id → powrót → weryfikacja → automatyczne pobranie PDF
  await page.check('#coTerms'); await page.check('#coWithdraw');
  const dlP = page.waitForEvent('download', { timeout: 25000 });
  await page.click('#coPay');
  const d2 = await dlP;
  txt = await pdfText(d2, 'paid.pdf');
  check('redirect to paymentUrl carries random client_reference_id + email', captured.length === 1 && captured[0].startsWith('https://buy.stripe.com/test_e2e?') && /client_reference_id=w[0-9a-f]{32}/.test(captured[0]) && captured[0].includes('prefilled_email=anna%40example.com'), captured);
  check('after verified payment: full PDF downloaded automatically', txt.includes('Uzasadnienie') && txt.includes('Mając powyższe na uwadze') && txt.includes('ZDiT-123-2026'), txt.slice(0, 400));
  check('PDF has Polish diacritics (form survived Stripe round-trip)', txt.includes('Łukasz Żółkiewski') && txt.includes('Źródlana') && txt.includes('Łódź') && /wyjaśnienie|opłaty dodatkowej/.test(txt));
  check('PDF keeps statutory amount 300,00 zł and ZDiT address', txt.includes('300,00 zł') && txt.includes('ul. J. Tuwima 36'));
  check('after verified payment: preview unlocked', await isUnlocked(page));
  check('URL cleaned after return', !page.url().includes('session_id'));
  await page.reload();
  await page.waitForTimeout(800);
  check('re-download works after reload (server re-verifies)', await isUnlocked(page));
  check('SECURITY: zero CSP violations (payment flow)', (await page.evaluate(() => window.__csp)).length === 0, await page.evaluate(() => window.__csp));
  check('SECURITY: no third-party requests (payment flow)', page.external.length === 0, page.external);
  check('no JS errors (payment flow)', page.errors.length === 0, page.errors);
  const stores = await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage)));
  check('PRIVACY: personal data NOT in localStorage', !stores.includes('Żółkiewski') && !stores.includes('Źródlana'), stores);
  await context.close();

  // Obejście 3: udostępniony link z opłaconym session_id w innej przeglądarce
  ({ context, page } = await newPage(browser));
  await page.goto(`${PROD}/?platnosc=sukces&session_id=${paidSid}`);
  await page.waitForTimeout(800);
  check('SECURITY: shared paid link does not unlock another browser', !(await isUnlocked(page)));
  await page.evaluate(([k, sid]) => localStorage.setItem(k, JSON.stringify({ ref: 'w' + 'b'.repeat(32), sid, ts: Date.now() })), [PAY_KEY, paidSid]);
  await page.reload();
  await page.waitForTimeout(800);
  check('SECURITY: stolen session_id with guessed ref does not unlock', !(await isUnlocked(page)));
  await context.close();

  /* ======================= 5. Serwer weryfikacji nie działa → brak przekierowania ======================= */
  console.log('PRODUCTION – verifier not ready');
  VERIFY.ready = false;
  const captured2 = [];
  ({ context, page } = await newPage(browser));
  await page.route('https://buy.stripe.com/**', route => { captured2.push(route.request().url()); route.abort(); });
  await page.goto(PROD + '/');
  await fillAppeal(page);
  await page.click('#getPdf');
  await page.check('#coTerms'); await page.check('#coWithdraw');
  await page.click('#coPay');
  await page.waitForTimeout(800);
  check('BUYER PROTECTION: not ready → "Sprzedaż chwilowo niedostępna – nie pobraliśmy żadnych środków", no redirect',
    captured2.length === 0 && await page.$eval('#coError', e => !e.hidden && e.textContent.includes('Sprzedaż chwilowo niedostępna – nie pobraliśmy żadnych środków')), captured2);
  VERIFY.ready = true;
  await context.close();

  /* ======================= 6. Mobile ======================= */
  console.log('MOBILE');
  MODE.paymentUrl = '';
  ({ context, page } = await newPage(browser, { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }));
  await page.goto(PROD + '/');
  const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  check('mobile: no horizontal page scroll', ov.sw <= ov.w, ov);
  check('no JS errors (mobile)', page.errors.length === 0, page.errors);
  await context.close();

  await browser.close();
  server.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL E2E TESTS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
