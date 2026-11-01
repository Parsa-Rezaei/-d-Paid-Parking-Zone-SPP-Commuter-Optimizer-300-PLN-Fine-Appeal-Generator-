/* Kalkulator SPP Łódź – logika aplikacji.
   Konfiguracja: public/assets/config.js. Cały kod działa w zamkniętym zakresie (IIFE) –
   żadna funkcja generująca pismo ani PDF nie jest dostępna z konsoli przeglądarki. */
(function () {
'use strict';

/* ---------- konfiguracja (walidowana – błędne wartości są ignorowane) ---------- */
const RAW = (window.SPP_CONFIG && typeof window.SPP_CONFIG === 'object') ? window.SPP_CONFIG : {};
const str = (v, d) => (typeof v === 'string' && v.trim() ? v : d);
function httpsUrl(v) { try { const x = new URL(String(v || '')); return x.protocol === 'https:' ? x.href : ''; } catch (e) { return ''; } }
const SELLER = RAW.seller && typeof RAW.seller === 'object' ? RAW.seller : {};
const PARTNER = RAW.partner && typeof RAW.partner === 'object' ? RAW.partner : {};
const CONFIG = Object.freeze({
  siteName: str(RAW.siteName, 'Kalkulator SPP Łódź'),
  siteUrl: str(RAW.siteUrl, ''),
  price: Number.isFinite(RAW.price) && RAW.price > 0 && RAW.price < 1000 ? RAW.price : 9.99,
  paymentUrl: httpsUrl(RAW.paymentUrl),
  verifyEndpoint: /^\/[A-Za-z0-9/_-]{1,100}$/.test(RAW.verifyEndpoint || '') ? RAW.verifyEndpoint : '',
  partner: Object.freeze({ name: str(PARTNER.name, ''), text: str(PARTNER.text, ''), url: httpsUrl(PARTNER.url) }),
  adContactUrl: str(RAW.adContactUrl, ''),
  seller: Object.freeze({ name: str(SELLER.name, ''), address: str(SELLER.address, ''), email: str(SELLER.email, ''), nip: str(SELLER.nip, '') })
});
// Tryb demonstracyjny (PDF bez opłaty) działa WYŁĄCZNIE na localhost / 127.0.0.1 i tylko bez skonfigurowanej płatności.
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const DEMO = !CONFIG.paymentUrl && IS_LOCAL;
const SALES_CONFIGURED = !!CONFIG.paymentUrl && !!CONFIG.verifyEndpoint;
let PAID = false;

// Dane SPP Łódź 2026. Kwoty w groszach.
const SPP = {
  startMin: 7 * 60,
  endMin: 19 * 60,
  // [1. godzina, 2. godzina, 3. godzina, 4. i każda kolejna]
  rates: {
    A: { lodzianin: [600, 720, 860, 600], przyjezdny: [690, 820, 980, 690] },
    B: { lodzianin: [500, 600, 720, 500], przyjezdny: [600, 720, 860, 600] },
    C: { lodzianin: [500, 600, 720, 500], przyjezdny: [600, 720, 860, 600] }
  },
  zones: {
    A: 'Ścisłe centrum: ul. Piotrkowska, Park Moniuszki, Galeria Łódzka.',
    B: 'Pozostałe Śródmieście, Radiostacja, okolice Orientarium ZOO i Aquaparku Fala.',
    C: 'Bałucki Rynek.'
  },
  statusLabel: { lodzianin: 'Łodzianin (EL / ZDiT)', przyjezdny: 'Przyjezdny' },
  residentPermitYear: 36500,
  surcharge: 30000,
  surchargeDays: 14,
  paymentWindowMin: 5,
  zdit: ['Zarząd Dróg i Transportu w Łodzi', 'ul. J. Tuwima 36', '90-002 Łódź']
};

const ROADS_ACT = 'ustawy z dnia 21 marca 1985 r. o drogach publicznych';

/* ---------- utils ---------- */
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function parseIso(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
function fmtDate(s) {
  const d = typeof s === 'string' ? parseIso(s) : s;
  return d ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}` : '';
}
function toMin(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
  return m ? +m[1] * 60 + +m[2] : null;
}
const fmtTime = min => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
function fmtPLN(grosze) {
  return (grosze / 100).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł';
}
function fmtDuration(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}
function minuteWord(n) {
  if (n === 1) return 'minutę';
  const l = n % 10, l2 = n % 100;
  return l >= 2 && l <= 4 && (l2 < 12 || l2 > 14) ? 'minuty' : 'minut';
}
function dayWord(n) {
  return Math.abs(n) === 1 ? 'dzień' : 'dni';
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function sentence(s) {
  s = (s || '').trim();
  return !s || /[.!?…]$/.test(s) ? s : s + '.';
}
function money(s) {
  s = (s || '').trim().replace(/\s*(zł|pln)$/i, '');
  if (!s) return '';
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? fmtPLN(Math.round(n * 100)).replace(' ', ' ') : s + ' zł';
}
const plate = s => (s || '').trim().toUpperCase().replace(/\s+/g, '\u00a0');

/* ---------- kalendarz: weekendy i święta ustawowe ---------- */
function easterSunday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return new Date(y, Math.floor(n / 31) - 1, (n % 31) + 1);
}
const holidayCache = {};
function polishHolidays(y) {
  if (holidayCache[y]) return holidayCache[y];
  const map = new Map();
  const add = (d, name) => map.set(isoDate(d), name);
  [[1, 1, 'Nowy Rok'], [1, 6, 'Święto Trzech Króli'], [5, 1, 'Święto Pracy'], [5, 3, 'Święto Narodowe Trzeciego Maja'],
   [8, 15, 'Wniebowzięcie Najświętszej Maryi Panny'], [11, 1, 'Wszystkich Świętych'], [11, 11, 'Narodowe Święto Niepodległości'],
   [12, 25, 'Boże Narodzenie'], [12, 26, 'drugi dzień Bożego Narodzenia']]
    .forEach(([m, d, name]) => add(new Date(y, m - 1, d), name));
  // Wigilia jest dniem wolnym od pracy od 2025 r.
  if (y >= 2025) add(new Date(y, 11, 24), 'Wigilia Bożego Narodzenia');
  const e = easterSunday(y);
  const shift = n => new Date(y, e.getMonth(), e.getDate() + n);
  add(e, 'Wielkanoc');
  add(shift(1), 'Poniedziałek Wielkanocny');
  add(shift(49), 'Zielone Świątki');
  add(shift(60), 'Boże Ciało');
  holidayCache[y] = map;
  return map;
}
function dayStatus(iso) {
  const d = parseIso(iso);
  if (!d) return null;
  const dow = d.getDay();
  if (dow === 6) return { free: true, reason: 'sobota' };
  if (dow === 0) return { free: true, reason: 'niedziela' };
  const hol = polishHolidays(d.getFullYear()).get(iso);
  if (hol) return { free: true, reason: `święto: ${hol}` };
  return { free: false, reason: 'dzień roboczy' };
}
function nextWorkingDay(from) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  while (dayStatus(isoDate(d)).free) d.setDate(d.getDate() + 1);
  return d;
}

/* ---------- silnik taryfy ---------- */
function calcStay(zone, status, startMin, endMin) {
  const rates = SPP.rates[zone][status];
  const from = Math.max(startMin, SPP.startMin);
  const to = Math.min(endMin, SPP.endMin);
  const minutes = Math.max(0, to - from);
  const segments = [];
  let total = 0;
  for (let k = 0; k * 60 < minutes; k++) {
    const mins = Math.min(60, minutes - k * 60);
    const rate = rates[Math.min(k, 3)];
    const cost = rate * mins / 60;
    segments.push({ index: k + 1, from: from + k * 60, to: from + k * 60 + mins, mins, rate, cost: Math.round(cost) });
    total += cost;
  }
  return { from, to, minutes, segments, total: Math.round(total) };
}

/* ---------- Funkcja 1: kalkulator ---------- */
function radio(name) {
  const r = document.querySelector(`input[name="${name}"]:checked`);
  return r ? r.value : null;
}

function updateCalc() {
  const zone = radio('zone'), status = radio('status'), engine = radio('engine');
  const date = $('parkDate').value;
  const start = toMin($('tStart').value), end = toMin($('tEnd').value);
  const days = +$('days').value;
  $('daysOut').textContent = days;
  $('daysOut2').textContent = days;
  $('zoneDesc').textContent = SPP.zones[zone];

  const err = $('calcError');
  if (start == null || end == null || end <= start) {
    err.textContent = 'Godzina zakończenia musi być późniejsza niż godzina rozpoczęcia (postój w obrębie jednego dnia).';
    err.classList.remove('hidden');
    return;
  }
  err.classList.add('hidden');

  const bev = engine === 'bev';
  const day = dayStatus(date);
  const stay = calcStay(zone, status, start, end);
  const freeDay = day && day.free;

  // Pojedynczy postój
  const badge = $('dayBadge');
  if (bev) {
    badge.textContent = 'BEV: zwolnienie';
    badge.className = 'rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800';
  } else if (freeDay) {
    badge.textContent = `Bezpłatnie: ${day.reason}`;
    badge.className = 'rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800';
  } else {
    badge.textContent = day ? 'Dzień roboczy: płatny' : 'Wybierz dzień';
    badge.className = 'rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-800';
  }

  const stayCost = bev || freeDay ? 0 : stay.total;
  $('stayTotal').textContent = fmtPLN(stayCost);
  const paidWindow = stay.minutes ? `Płatny czas: ${fmtTime(stay.from)}–${fmtTime(stay.to)} (${fmtDuration(stay.minutes)})` : 'Brak płatnego czasu w godzinach 7:00–19:00';
  $('stayMeta').textContent = `${paidWindow} · podstrefa ${zone} · ${SPP.statusLabel[status]}`;

  const tbody = $('breakdown');
  if (bev) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-3 text-slate-600">Pojazdy elektryczne są zwolnione z opłat za postój w SPP (art. 13 ust. 3 ${esc(ROADS_ACT)}).</td></tr>`;
  } else if (freeDay) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-3 text-slate-600">${esc(fmtDate(date))} to ${esc(day.reason)}: postój w SPP jest bezpłatny.</td></tr>`;
  } else if (!stay.segments.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="py-3 text-slate-600">Postój poza godzinami płatnymi 7:00–19:00.</td></tr>';
  } else {
    tbody.innerHTML = stay.segments.map(s => `<tr>
      <td class="py-2 pr-3">${s.index}.</td>
      <td class="py-2 pr-3">${fmtTime(s.from)}–${fmtTime(s.to)}</td>
      <td class="py-2 pr-3 text-right">${s.mins}</td>
      <td class="hidden py-2 pr-3 text-right sm:table-cell">${fmtPLN(s.rate)}/h</td>
      <td class="py-2 text-right font-medium">${fmtPLN(s.cost)}</td></tr>`).join('') +
      `<tr class="font-bold"><td class="py-2 pr-3" colspan="4">Razem</td><td class="py-2 text-right">${fmtPLN(stay.total)}</td></tr>`;
  }

  // Prognoza dla dnia roboczego z tymi samymi godzinami
  const perDay = bev ? 0 : stay.total;
  const monthly = perDay * days, annual = monthly * 12;
  $('perDay').textContent = fmtPLN(perDay);
  $('monthly').textContent = fmtPLN(monthly);
  $('annual').textContent = fmtPLN(annual);

  // Łodzianin vs przyjezdny
  const lodz = calcStay(zone, 'lodzianin', start, end).total;
  const przy = calcStay(zone, 'przyjezdny', start, end).total;
  const diff = bev ? 0 : przy - lodz;
  $('lossDay').textContent = fmtPLN(diff);
  $('lossMonth').textContent = fmtPLN(diff * days);
  $('lossYear').textContent = fmtPLN(diff * days * 12);
  $('lossLead').textContent = bev
    ? 'Pojazd elektryczny nie płaci w SPP, więc status kierowcy nie wpływa na koszt.'
    : status === 'przyjezdny'
      ? `Płacąc stawkę przyjezdnego w podstrefie ${zone}, wydajesz więcej niż Łodzianin przy tych samych godzinach postoju:`
      : `Status Łodzianina oszczędza Ci w podstrefie ${zone} względem stawki przyjezdnego:`;

  // Abonament mieszkańca
  const permit = SPP.residentPermitYear;
  $('aboTickets').textContent = fmtPLN(annual);
  const aboDiff = annual - permit;
  $('aboDiff').textContent = fmtPLN(Math.max(0, aboDiff));
  $('aboDiff').className = `tnum text-lg font-bold ${aboDiff > 0 ? 'text-emerald-700' : 'text-slate-700'}`;
  $('aboLead').textContent = `Bilety przy obecnych ustawieniach (${SPP.statusLabel[status]}, ${days} dni w miesiącu) w porównaniu z abonamentem mieszkańca.`;
  const brk = $('aboBreak');
  if (perDay === 0) {
    brk.textContent = 'Przy zerowym koszcie dziennym abonament się nie opłaca.';
    brk.className = 'mt-3 text-sm font-medium text-slate-700';
  } else {
    const breakEven = Math.ceil(permit / perDay);
    const daysYear = days * 12;
    brk.textContent = aboDiff > 0
      ? `Abonament mieszkańca oszczędza ${fmtPLN(aboDiff)} rocznie. Opłaca się od ${breakEven}. dnia parkowania w roku (Ty parkujesz ${daysYear} dni).`
      : `Abonament mieszkańca zacznie się opłacać od ${breakEven}. dnia parkowania w roku przy tych godzinach (Ty parkujesz ${daysYear} dni).`;
    brk.className = `mt-3 text-sm font-medium ${aboDiff > 0 ? 'text-emerald-700' : 'text-slate-700'}`;
  }
}

function renderRateTable() {
  const rows = [];
  for (const [zones, key] of [['A', 'A'], ['B i C', 'B']]) {
    for (const status of ['lodzianin', 'przyjezdny']) {
      const r = SPP.rates[key][status];
      const sum3 = r[0] + r[1] + r[2];
      const full = calcStay(key, status, SPP.startMin, SPP.endMin).total;
      rows.push(`<tr>
        <td class="px-4 py-3 font-semibold">${zones}</td><td class="px-4 py-3">${SPP.statusLabel[status]}</td>
        <td class="px-4 py-3 text-right">${fmtPLN(r[0])}</td><td class="px-4 py-3 text-right">${fmtPLN(r[1])}</td><td class="px-4 py-3 text-right">${fmtPLN(r[2])}</td>
        <td class="px-4 py-3 text-right font-semibold">${fmtPLN(sum3)}</td><td class="px-4 py-3 text-right">${fmtPLN(r[3])}</td>
        <td class="px-4 py-3 text-right">${fmtPLN(full)}</td></tr>`);
    }
  }
  $('rateTable').innerHTML = rows.join('');
}

/* ---------- Funkcja 2: generator wniosku ---------- */
const attOverrides = {};
const customAtt = [];

function readAppeal() {
  const v = id => ($(id).value || '').trim();
  return {
    gender: v('a-gender'), name: v('a-name'), street: v('a-street'), city: v('a-city'), email: v('a-email'), phone: v('a-phone'),
    reportNo: v('a-reportNo'), plate: plate(v('a-plate')), controlDate: v('a-controlDate'), controlTime: v('a-controlTime'),
    place: v('a-place'), zone: v('a-zone'),
    reason: radio('reason'),
    app: v('a-app'), tx: v('a-tx'), payDate: v('a-payDate'), payTime: v('a-payTime'), paidFrom: v('a-paidFrom'), paidTo: v('a-paidTo'),
    amount: money(v('a-amount')), wrongPlate: plate(v('a-wrongPlate')), typoKind: v('a-typoKind'), otherNotParked: $('a-otherNotParked').checked,
    sApp: v('a-sApp'), sTx: v('a-sTx'), parkTime: v('a-parkTime'), sPayTime: v('a-sPayTime'), sAmount: money(v('a-sAmount')),
    exemptType: radio('exemptType'), permitNo: v('a-permitNo'), permitFrom: v('a-permitFrom'), permitTo: v('a-permitTo'), cardNo: v('a-cardNo'),
    meterLoc: v('a-meterLoc'), meterTime: v('a-meterTime'), meterIssue: v('a-meterIssue'), meterReported: v('a-meterReported'), meterAlt: v('a-meterAlt'),
    extra: v('a-extra'), letterPlace: v('a-letterPlace') || 'Łódź', letterDate: v('a-letterDate')
  };
}

function syncDelay(d) {
  const p = toMin(d.parkTime), t = toMin(d.sPayTime);
  return p == null || t == null ? null : t - p;
}

function defaultAttachments(d) {
  const L = [{ key: 'report', label: `Kopia raportu z kontroli nr ${d.reportNo || '…'}`, on: true }];
  if (d.reason === 'typo') {
    L.push({ key: 'typo-proof', label: `Potwierdzenie płatności z aplikacji ${d.app || '…'}${d.tx ? ` (nr transakcji ${d.tx})` : ''}`, on: true });
    L.push({ key: 'typo-reg', label: `Kopia dowodu rejestracyjnego pojazdu ${d.plate || '…'}`, on: true });
    if (d.typoKind === 'vehicle') L.push({ key: 'typo-reg2', label: `Kopia dowodu rejestracyjnego pojazdu ${d.wrongPlate || '…'}`, on: false });
    L.push({ key: 'typo-bank', label: 'Potwierdzenie obciążenia rachunku bankowego lub karty', on: false });
  } else if (d.reason === 'sync') {
    L.push({ key: 'sync-proof', label: `Potwierdzenie transakcji z aplikacji ${d.sApp || '…'} z godziną rozpoczęcia postoju`, on: true });
    L.push({ key: 'sync-hist', label: 'Zrzut ekranu historii postojów z aplikacji', on: true });
  } else if (d.reason === 'exempt') {
    if (d.exemptType === 'bev') L.push({ key: 'ex-bev', label: 'Kopia dowodu rejestracyjnego (rodzaj paliwa: energia elektryczna)', on: true });
    if (d.exemptType === 'permit') L.push({ key: 'ex-permit', label: `Kopia lub potwierdzenie abonamentu nr ${d.permitNo || '…'}`, on: true });
    if (d.exemptType === 'card') L.push({ key: 'ex-card', label: `Kopia karty parkingowej nr ${d.cardNo || '…'} (obie strony)`, on: true });
  } else if (d.reason === 'meter') {
    L.push({ key: 'meter-photo', label: 'Zdjęcia niesprawnego parkomatu z widocznym numerem lub lokalizacją', on: true });
    L.push({ key: 'meter-report', label: 'Potwierdzenie zgłoszenia awarii', on: !!d.meterReported });
  }
  return L;
}

function attachments(d) {
  const defs = defaultAttachments(d).map(a => ({ ...a, on: a.key in attOverrides ? attOverrides[a.key] : a.on }));
  return { defs, list: [...defs.filter(a => a.on).map(a => a.label), ...customAtt.filter(a => a.on).map(a => a.label)] };
}

function reasonParagraphs(d) {
  const g = (m, f) => (d.gender === 'f' ? f : m);
  const P = [];
  if (d.reason === 'typo') {
    const det = [d.tx && `nr transakcji: ${d.tx}`, d.amount && `kwota: ${d.amount}`, d.paidFrom && d.paidTo && `opłacony czas postoju: ${d.paidFrom}–${d.paidTo}`].filter(Boolean);
    const kind = d.typoKind === 'vehicle' ? ' – w aplikacji omyłkowo wybrano inny pojazd zapisany na koncie użytkownika'
      : d.typoKind === 'chars' ? ' – przy wpisywaniu numeru doszło do zamiany podobnych znaków (np. „0” i „O”)' : '';
    P.push(`W dniu ${fmtDate(d.payDate)}${d.payTime ? ` o godz. ${d.payTime}` : ''} ${g('uiściłem', 'uiściłam')} opłatę za postój w Strefie Płatnego Parkowania w Łodzi za pośrednictwem aplikacji ${d.app}${det.length ? ` (${det.join('; ')})` : ''}. Wskutek omyłki pisarskiej opłata została przypisana do numeru rejestracyjnego ${d.wrongPlate} zamiast ${d.plate}${kind}.`);
    if (d.otherNotParked) P.push(`Pojazd o numerze rejestracyjnym ${d.wrongPlate} nie był w tym czasie zaparkowany w Strefie Płatnego Parkowania, zatem wniesiona opłata dotyczyła w rzeczywistości postoju pojazdu ${d.plate}.`);
    P.push(`Opłata za postój w miejscu i czasie objętym kontrolą została więc faktycznie wniesiona na rzecz Miasta Łodzi. Zgodnie z art. 13f ust. 1 ${ROADS_ACT} opłatę dodatkową pobiera się za nieuiszczenie opłaty za postój w strefie płatnego parkowania. W niniejszej sprawie opłata została uiszczona, a rozbieżność dotyczy wyłącznie oczywistej omyłki w oznaczeniu pojazdu, którą można jednoznacznie zweryfikować na podstawie danych operatora płatności.`);
    P.push('Obciążenie mnie opłatą dodatkową w wysokości 300,00 zł mimo faktycznego wniesienia opłaty za postój byłoby niewspółmierne do charakteru uchybienia i pozostawałoby w sprzeczności z zasadą proporcjonalności oraz zasadą zaufania obywateli do organów władzy publicznej (por. art. 2 Konstytucji Rzeczypospolitej Polskiej oraz art. 8 § 1 Kodeksu postępowania administracyjnego).');
  } else if (d.reason === 'sync') {
    const det = [d.sTx && `nr transakcji: ${d.sTx}`, d.sAmount && `kwota: ${d.sAmount}`].filter(Boolean);
    const delay = syncDelay(d);
    P.push(`W dniu ${fmtDate(d.controlDate)} o godz. ${d.parkTime} ${g('zaparkowałem', 'zaparkowałam')} pojazd o numerze rejestracyjnym ${d.plate} w miejscu: ${d.place}, a o godz. ${d.sPayTime} ${g('uruchomiłem', 'uruchomiłam')} płatny postój w aplikacji ${d.sApp}${det.length ? ` (${det.join('; ')})` : ''}.`);
    const onTime = delay != null && delay >= 0 && delay <= SPP.paymentWindowMin;
    if (onTime) P.push(`Opłata została zatem wniesiona ${delay === 0 ? 'bezpośrednio po zaparkowaniu' : `${delay} ${minuteWord(delay)} po zaparkowaniu`}, tj. w terminie wynikającym z uchwały Rady Miejskiej w Łodzi w sprawie Strefy Płatnego Parkowania, zgodnie z którą opłatę wnosi się niezwłocznie, nie później niż w ciągu 5 minut od zaparkowania pojazdu.`);
    P.push(`${d.controlTime ? `Kontrola została odnotowana o godz. ${d.controlTime}. ` : ''}Rozbieżność między stanem faktycznym a wynikiem kontroli mogła wynikać z opóźnienia w przekazaniu informacji o rozpoczętym postoju pomiędzy systemem operatora płatności mobilnych a systemem kontroli. Wnoszę o zweryfikowanie danych operatora aplikacji ${d.sApp} oraz zapisów systemu kontroli dla wskazanego pojazdu i godziny.`);
    if (onTime) P.push(`Skoro opłata za postój została wniesiona w terminie, nie zaistniała przesłanka nieuiszczenia opłaty, o której mowa w art. 13f ust. 1 ${ROADS_ACT}.`);
  } else if (d.reason === 'exempt') {
    if (d.exemptType === 'bev') {
      P.push(`Pojazd o numerze rejestracyjnym ${d.plate} jest pojazdem elektrycznym w rozumieniu art. 2 pkt 12 ustawy z dnia 11 stycznia 2018 r. o elektromobilności i paliwach alternatywnych, co potwierdza dowód rejestracyjny (rodzaj paliwa: energia elektryczna).`);
      P.push(`Na podstawie art. 13 ust. 3 ${ROADS_ACT} pojazdy elektryczne są zwolnione z opłat za postój w strefie płatnego parkowania. Obowiązek wniesienia opłaty za postój nie powstał, a w konsekwencji nie mogła powstać opłata dodatkowa, o której mowa w art. 13f ust. 1 tej ustawy.`);
    } else if (d.exemptType === 'permit') {
      const valid = d.permitFrom && d.permitTo ? ` (okres ważności: ${fmtDate(d.permitFrom)}–${fmtDate(d.permitTo)})` : '';
      P.push(`W dniu kontroli ${g('posiadałem', 'posiadałam')} ważny abonament nr ${d.permitNo}${valid}, uprawniający do postoju pojazdu o numerze rejestracyjnym ${d.plate} w Strefie Płatnego Parkowania w Łodzi.`);
      P.push(`Postój był więc opłacony w formie abonamentu, co wyklucza powstanie opłaty dodatkowej przewidzianej w art. 13f ust. 1 ${ROADS_ACT} za nieuiszczenie opłaty za postój.`);
    } else {
      P.push(`W chwili kontroli pojazd o numerze rejestracyjnym ${d.plate} był oznaczony ważną kartą parkingową nr ${d.cardNo}, umieszczoną w widocznym miejscu za przednią szybą, a postój odbywał się w ramach uprawnień przysługujących posiadaczowi karty parkingowej w Strefie Płatnego Parkowania w Łodzi.`);
      P.push('Wnoszę o uwzględnienie tego uprawnienia przy wyjaśnianiu sprawy.');
    }
  } else if (d.reason === 'meter') {
    P.push(`W dniu ${fmtDate(d.controlDate)}${d.meterTime ? ` około godz. ${d.meterTime}` : ''} ${g('próbowałem', 'próbowałam')} wnieść opłatę za postój pojazdu o numerze rejestracyjnym ${d.plate} w parkomacie ${d.meterLoc}, jednak urządzenie było niesprawne: ${sentence(d.meterIssue)}`);
    const more = [sentence(d.meterReported), sentence(d.meterAlt)].filter(Boolean).join(' ');
    if (more) P.push(more);
    P.push('Niewniesienie opłaty nie wynikało zatem z mojej woli, lecz z przyczyn technicznych leżących po stronie infrastruktury Strefy Płatnego Parkowania. Wnoszę o uwzględnienie tych okoliczności oraz o sprawdzenie, czy w ewidencji Zarządu Dróg i Transportu odnotowano awarię wskazanego parkomatu w tym czasie.');
  }
  if (d.extra) P.push(sentence(d.extra));
  return P;
}

function buildLetter(d) {
  const sender = [d.name, d.street, d.city, d.email && `e-mail: ${d.email}`, d.phone && `tel. ${d.phone}`].filter(Boolean);
  const ref = `raport z kontroli nr ${d.reportNo} z dnia ${fmtDate(d.controlDate)}${d.controlTime ? `, godz. ${d.controlTime}` : ''}; opłata dodatkowa 300,00 zł; pojazd nr rej. ${d.plate}; miejsce postoju: ${d.place}${d.zone ? ` (podstrefa ${d.zone})` : ''}.`;
  const intro = `Działając we własnym imieniu, wnoszę o wyjaśnienie okoliczności powstania opłaty dodatkowej w wysokości 300,00 zł wskazanej w raporcie z kontroli nr ${d.reportNo} oraz o jej anulowanie.`;
  const strong = d.reason !== 'meter';
  const petitum = [
    `wyjaśnienie okoliczności powstania opłaty dodatkowej wskazanej w raporcie z kontroli nr ${d.reportNo};`,
    strong ? 'uznanie, że w opisanym stanie faktycznym opłata dodatkowa nie powstała, i jej anulowanie;' : 'uwzględnienie opisanych okoliczności i anulowanie opłaty dodatkowej;',
    `przesłanie informacji o sposobie załatwienia wniosku ${d.email ? `na adres e-mail ${d.email} lub ` : ''}na adres korespondencyjny wskazany powyżej.`
  ];
  return {
    header: `${d.letterPlace}, dnia ${fmtDate(d.letterDate)} r.`,
    sender, addressee: SPP.zdit.slice(), ref, intro,
    paragraphs: reasonParagraphs(d), petitum,
    attachments: attachments(d).list
  };
}

function validateAppeal(d) {
  const errs = [];
  const need = (id, msg) => { if (!$(id).value.trim()) errs.push([id, msg]); };
  need('a-name', 'Imię i nazwisko');
  need('a-street', 'Ulica i numer');
  need('a-city', 'Kod pocztowy i miejscowość');
  need('a-reportNo', 'Numer raportu z kontroli');
  need('a-plate', 'Numer rejestracyjny pojazdu');
  need('a-controlDate', 'Data kontroli');
  need('a-place', 'Miejsce postoju');
  if (d.reason === 'typo') { need('a-app', 'Aplikacja'); need('a-payDate', 'Data płatności'); need('a-wrongPlate', 'Numer wpisany przy płatności'); }
  if (d.reason === 'sync') { need('a-sApp', 'Aplikacja'); need('a-parkTime', 'Godzina zaparkowania'); need('a-sPayTime', 'Godzina uruchomienia biletu'); }
  if (d.reason === 'exempt' && d.exemptType === 'permit') need('a-permitNo', 'Numer abonamentu');
  if (d.reason === 'exempt' && d.exemptType === 'card') need('a-cardNo', 'Numer karty parkingowej');
  if (d.reason === 'meter') { need('a-meterLoc', 'Parkomat'); need('a-meterIssue', 'Opis awarii'); }
  if (d.reason === 'typo' && d.wrongPlate && d.wrongPlate === d.plate) errs.push(['a-wrongPlate', 'Numer wpisany przy płatności jest taki sam jak numer z raportu']);
  return errs;
}

function renderAttachments(d) {
  const { defs } = attachments(d);
  const row = (id, label, on, attr) => `<li><label class="flex items-start gap-2"><input type="checkbox" class="mt-1 accent-brand-700" ${attr}="${esc(id)}" ${on ? 'checked' : ''}><span>${esc(label)}</span></label></li>`;
  $('attList').innerHTML = defs.map(a => row(a.key, a.label, a.on, 'data-att')).join('') +
    customAtt.map((a, i) => row(i, a.label, a.on, 'data-custom')).join('');
}

function renderTracker(d) {
  const text = $('trackerText'), bar = $('trackerBar');
  const base = parseIso(d.controlDate);
  if (!base) {
    text.textContent = 'Podaj datę kontroli, aby zobaczyć termin zapłaty opłaty dodatkowej.';
    bar.style.width = '0%';
    return;
  }
  const deadline = new Date(base.getFullYear(), base.getMonth(), base.getDate() + SPP.surchargeDays);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const left = Math.round((deadline - today) / 86400000);
  const elapsed = Math.min(SPP.surchargeDays, Math.max(0, SPP.surchargeDays - left));
  bar.style.width = `${(elapsed / SPP.surchargeDays) * 100}%`;
  bar.className = `h-2 rounded-full ${left < 0 ? 'bg-red-600' : left <= 3 ? 'bg-amber-500' : 'bg-brand-700'}`;
  text.innerHTML = left < 0
    ? `Termin zapłaty: <strong>${fmtDate(deadline)}</strong>, <span class="font-semibold text-red-700">minął ${-left} ${dayWord(left)} temu</span>.`
    : `Termin zapłaty: <strong>${fmtDate(deadline)}</strong>, <span class="font-semibold ${left <= 3 ? 'text-amber-700' : 'text-brand-800'}">${left === 0 ? 'mija dziś' : `pozostało ${left} ${dayWord(left)}`}</span>.`;
}

function renderPreview(d) {
  const L = buildLetter(d);
  const blank = s => s || '<span class="text-slate-400">…</span>';
  const p = s => `<p class="mb-2 text-justify">${esc(s)}</p>`;
  $('preview').innerHTML = `
    <p class="text-right">${esc(L.header)}</p>
    <div class="mt-3">${L.sender.length ? L.sender.map(esc).join('<br>') : blank('')}</div>
    <div class="ml-auto mt-3 w-fit font-bold">${L.addressee.map(esc).join('<br>')}</div>
    <p class="mt-4 text-center font-bold tracking-wide">WNIOSEK</p>
    <p class="text-center font-bold">o wyjaśnienie powstania opłaty dodatkowej i jej anulowanie</p>
    <p class="mt-3 mb-2"><strong>Dotyczy:</strong> ${esc(L.ref)}</p>
    ${isUnlocked() ? `${p(L.intro)}
      <p class="mt-3 mb-1 font-bold">Uzasadnienie</p>
      ${L.paragraphs.map(p).join('')}
      <p class="mb-1">Mając powyższe na uwadze, wnoszę o:</p>
      <ol class="mb-2 list-decimal pl-6">${L.petitum.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      <p class="font-bold">Załączniki:</p>
      <ol class="list-decimal pl-6">${L.attachments.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : lockedBars(L)}`;
  $('getPdf').textContent = isUnlocked()
    ? (DEMO && !PAID ? 'Pobierz wniosek PDF (tryb demonstracyjny)' : 'Pobierz wniosek PDF (opłacony)')
    : `Pobierz wniosek PDF – ${fmtPrice()} (BLIK)`;
}

/* Zablokowana część podglądu: same szare paski – prawdziwy tekst pisma NIE trafia do strony przed płatnością */
function lockedBars(L) {
  const lines = Math.min(40, Math.max(10, 4 + L.paragraphs.length * 4 + L.petitum.length * 2 + L.attachments.length));
  let h = '';
  for (let i = 0; i < lines; i++) h += `<div class="mb-2 h-3 rounded bg-slate-300 ${i % 5 === 4 ? 'w-2/3' : 'w-full'}"></div>`;
  return `<div id="lockedPreview" class="mt-3" aria-hidden="true">${h}</div>
    <div class="pointer-events-none absolute inset-x-0 bottom-0 flex h-28 items-end justify-center bg-linear-to-t from-white via-white/90 to-transparent pb-4">
      <span class="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">Pełna treść w pliku PDF</span>
    </div>`;
}

function updateAppeal() {
  const reason = radio('reason');
  document.querySelectorAll('[data-reason]').forEach(el => el.classList.toggle('hidden', el.dataset.reason !== reason));
  const ex = radio('exemptType');
  document.querySelectorAll('[data-exempt]').forEach(el => el.classList.toggle('hidden', el.dataset.exempt !== ex));

  const d = readAppeal();
  const warn = $('syncWarn');
  const delay = syncDelay(d);
  if (reason === 'sync' && delay != null && (delay < 0 || delay > SPP.paymentWindowMin)) {
    warn.textContent = delay < 0
      ? 'Godzina uruchomienia biletu jest wcześniejsza niż godzina zaparkowania. Sprawdź wpisane godziny.'
      : `Bilet uruchomiono ${delay} ${minuteWord(delay)} po zaparkowaniu, czyli po upływie 5 minut. Wniosek pominie argument o terminowej płatności.`;
    warn.classList.remove('hidden');
  } else {
    warn.classList.add('hidden');
  }
  renderAttachments(d);
  renderTracker(d);
  renderPreview(d);
}

/* ---------- PDF (pdfmake) ---------- */
function buildPdf(d) {
  const L = buildLetter(d);
  const base = parseIso(d.controlDate);
  const deadline = new Date(base.getFullYear(), base.getMonth(), base.getDate() + SPP.surchargeDays);
  const box = text => ({
    columns: [
      { width: 16, canvas: [{ type: 'rect', x: 0, y: 2, w: 9, h: 9, lineWidth: 0.8 }] },
      { width: '*', text }
    ],
    margin: [0, 0, 0, 5]
  });
  const checklist = [
    `Termin zapłaty opłaty dodatkowej (14 dni od daty kontroli ${fmtDate(base)}): ${fmtDate(deadline)}. Sprawdź termin wskazany w raporcie.`,
    'Wniosek wydrukowany i własnoręcznie podpisany albo podpisany elektronicznie (podpis zaufany, osobisty lub kwalifikowany).',
    ...L.attachments.map(a => `Załącznik: ${a}`),
    'Kopia wniosku i dowód nadania zachowane w dokumentacji.'
  ];
  return {
    pageSize: 'A4',
    pageMargins: [60, 56, 60, 56],
    info: { title: `Wniosek do ZDiT – raport nr ${d.reportNo}`, author: d.name, subject: 'Wniosek o wyjaśnienie powstania opłaty dodatkowej' },
    defaultStyle: { font: 'Roboto', fontSize: 10.5, lineHeight: 1.25 },
    content: [
      { text: L.header, alignment: 'right' },
      { stack: L.sender, margin: [0, 18, 0, 0] },
      { stack: L.addressee, bold: true, margin: [280, 20, 0, 0] },
      { text: 'WNIOSEK', alignment: 'center', bold: true, fontSize: 14, characterSpacing: 1, margin: [0, 26, 0, 2] },
      { text: 'o wyjaśnienie powstania opłaty dodatkowej i jej anulowanie', alignment: 'center', bold: true },
      { text: [{ text: 'Dotyczy: ', bold: true }, L.ref], margin: [0, 16, 0, 10] },
      { text: L.intro, alignment: 'justify', margin: [0, 0, 0, 6] },
      { text: 'Uzasadnienie', bold: true, margin: [0, 8, 0, 6] },
      ...L.paragraphs.map(t => ({ text: t, alignment: 'justify', margin: [0, 0, 0, 6] })),
      { text: 'Mając powyższe na uwadze, wnoszę o:', margin: [0, 4, 0, 4] },
      { ol: L.petitum, margin: [10, 0, 0, 10] },
      { text: 'Załączniki:', bold: true, margin: [0, 4, 0, 4] },
      { ol: L.attachments, fontSize: 10, margin: [10, 0, 0, 0] },
      {
        columns: [{ width: '*', text: '' }, {
          width: 200,
          stack: [{ text: '.........................................................', alignment: 'center' }, { text: '(podpis)', alignment: 'center', fontSize: 8, color: '#555' }]
        }],
        margin: [0, 40, 0, 0]
      },

      { text: 'LISTA KONTROLNA – NIE DOŁĄCZAJ TEJ STRONY DO WNIOSKU', pageBreak: 'before', bold: true, fontSize: 12, margin: [0, 0, 0, 12] },
      ...checklist.map(box),
      { text: 'Gdzie złożyć wniosek', bold: true, margin: [0, 14, 0, 6] },
      { ul: [
        `Listem poleconym: ${SPP.zdit.join(', ')}.`,
        'Osobiście w kancelarii ZDiT przy ul. J. Tuwima 36 w Łodzi.',
        'Elektronicznie na adres do e-Doręczeń ZDiT (aktualny adres w BIP ZDiT).'
      ], margin: [0, 0, 0, 10] },
      { text: 'Ważne', bold: true, margin: [0, 8, 0, 6] },
      { text: 'Według Urzędu Miasta Łodzi wniosek o wyjaśnienie powstania opłaty dodatkowej nie jest trybem odwoławczym i od odpowiedzi ZDiT nie przysługuje dalsza droga odwoławcza. Zarzuty w sprawie prowadzenia egzekucji administracyjnej można wnieść po doręczeniu odpisu tytułu wykonawczego. Dokument jest wzorem pisma i nie stanowi porady prawnej.', alignment: 'justify', fontSize: 9.5, color: '#333' }
    ]
  };
}

function downloadPdf() {
  if (!isUnlocked()) return; // PDF wyłącznie po potwierdzeniu płatności przez serwer (lub w trybie demo lokalnie)
  if (!window.pdfMake || typeof pdfMake.createPdf !== 'function') {
    toast('Biblioteka PDF jeszcze się nie załadowała. Spróbuj ponownie za chwilę.');
    return;
  }
  const d = readAppeal();
  const file = `wniosek-ZDiT-${(d.reportNo || 'raport').replace(/[^\w-]+/g, '_')}.pdf`;
  pdfMake.createPdf(buildPdf(d)).download(file);
  toast('Plik PDF został wygenerowany.');
}

/* ---------- pamięć formularza (tylko bieżąca karta: sessionStorage) ---------- */
const STORE_KEY = 'spp_form_v1', PAY_KEY = 'spp_pay_v1';
const SID_RE = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;
const REF_RE = /^[A-Za-z0-9_-]{16,64}$/;
const isPlainObject = o => !!o && typeof o === 'object' && !Array.isArray(o);
function storageGet(store, key) { try { return JSON.parse(store.getItem(key) || 'null'); } catch (e) { return null; } }
function storageSet(store, key, val) { try { store.setItem(key, JSON.stringify(val)); } catch (e) { /* tryb prywatny / brak miejsca */ } }
function storageDel(store, key) { try { store.removeItem(key); } catch (e) { /* ignore */ } }
function isUnlocked() { return DEMO || PAID; }

function saveStateNow() {
  const fields = {};
  document.querySelectorAll('#appealForm input, #appealForm select, #appealForm textarea').forEach(el => {
    if (el.dataset.att != null || el.dataset.custom != null) return;
    if (el.type === 'radio') { if (el.checked) fields['radio:' + el.name] = el.value; }
    else if (el.type === 'checkbox') { if (el.id) fields[el.id] = el.checked; }
    else if (el.id) fields[el.id] = el.value;
  });
  storageSet(sessionStorage, STORE_KEY, { fields, attOverrides: { ...attOverrides }, customAtt: customAtt.slice() });
}
let saveTimer = null;
function saveState() { clearTimeout(saveTimer); saveTimer = setTimeout(saveStateNow, 300); }
function loadState() {
  const s = storageGet(sessionStorage, STORE_KEY);
  if (!isPlainObject(s) || !isPlainObject(s.fields)) return;
  for (const [k, v] of Object.entries(s.fields)) {
    if (k.startsWith('radio:')) {
      const name = k.slice(6);
      document.querySelectorAll('#appealForm input[type="radio"]').forEach(r => { if (r.name === name) r.checked = r.value === v; });
      continue;
    }
    const el = document.getElementById(k);
    if (!el || !el.closest('#appealForm')) continue;
    if (el.type === 'checkbox') el.checked = v === true;
    else if (typeof v === 'string') el.value = v.slice(0, 2000);
  }
  if (isPlainObject(s.attOverrides)) for (const [k, v] of Object.entries(s.attOverrides)) if (typeof v === 'boolean' && /^[\w-]{1,40}$/.test(k)) attOverrides[k] = v;
  if (Array.isArray(s.customAtt)) s.customAtt.slice(0, 30).forEach(a => {
    if (isPlainObject(a) && typeof a.label === 'string' && a.label.trim()) customAtt.push({ label: a.label.slice(0, 300), on: a.on !== false });
  });
}

/* ---------- PŁATNOŚĆ ----------
   Zasady bezpieczeństwa:
   1. Dostęp do PDF daje wyłącznie odpowiedź serwera (functions/api/verify.js),
      który sprawdza płatność bezpośrednio w Stripe.
   2. Sesja płatności jest powiązana z losowym identyfikatorem zamówienia
      (client_reference_id) zapisanym w tej przeglądarce – link z session_id
      nie działa w innej przeglądarce.
   3. Klient nie jest kierowany do płatności, jeśli serwer weryfikujący
      nie działa – nikt nie zapłaci za coś, czego nie dostanie. */
const sleep = ms => new Promise(r => setTimeout(r, ms));
function fmtPrice() { return CONFIG.price.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł'; }
function newRef() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return 'w' + Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}
async function getJson(url) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: ctrl.signal });
    let body = null;
    try { body = await r.json(); } catch (e) { body = null; }
    return { status: r.status, body };
  } catch (e) { return null; } finally { clearTimeout(timer); }
}
async function pingVerify() {
  const res = await getJson(`${CONFIG.verifyEndpoint}?ping=1`);
  return !!(res && res.status === 200 && res.body && res.body.ready === true);
}
/* true = opłacone, false = nieopłacone/nieważne, null = błąd połączenia (spróbuj później) */
async function verifyPaid(sid, ref) {
  if (!SID_RE.test(sid) || !REF_RE.test(ref)) return false;
  const res = await getJson(`${CONFIG.verifyEndpoint}?session_id=${encodeURIComponent(sid)}&ref=${encodeURIComponent(ref)}`);
  if (!res) return null;
  if (res.status === 200 && res.body && res.body.paid === true) return true;
  if (res.status >= 500 || res.status === 429) return null;
  return false;
}
function showFormErrors() {
  const d = readAppeal();
  const errs = validateAppeal(d);
  document.querySelectorAll('#appealForm [aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  const box = $('formErrors');
  if (errs.length) {
    errs.forEach(([id]) => $(id).setAttribute('aria-invalid', 'true'));
    box.innerHTML = '<li class="list-none -ml-4 font-semibold">Uzupełnij pola:</li>' + errs.map(([, m]) => `<li>${esc(m)}</li>`).join('');
    box.classList.remove('hidden');
    $(errs[0][0]).focus();
    return false;
  }
  box.classList.add('hidden');
  return true;
}
function onBuy() {
  if (!showFormErrors()) return;
  if (PAID) { downloadPdf(); return; }
  $('coDemo').hidden = !DEMO;
  $('coUnavailable').hidden = DEMO || SALES_CONFIGURED;
  $('coPay').disabled = !(DEMO || SALES_CONFIGURED);
  $('coError').hidden = true;
  $('dlgCheckout').showModal();
}
function coError(msg) { const e = $('coError'); e.textContent = msg; e.hidden = false; }
const UNAVAILABLE = 'Sprzedaż chwilowo niedostępna – nie pobraliśmy żadnych środków.';
let paying = false;
async function onPay() {
  if (paying) return;
  if (!$('coTerms').checked || !$('coWithdraw').checked) { coError('Zaznacz obie zgody, aby kontynuować.'); return; }
  if (DEMO) { PAID = true; $('dlgCheckout').close(); updateAppeal(); downloadPdf(); return; }
  if (!SALES_CONFIGURED) { coError(UNAVAILABLE); return; }
  paying = true;
  const btn = $('coPay'), label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Łączenie z bezpieczną płatnością…';
  const ready = await pingVerify();
  if (!ready) {
    paying = false; btn.disabled = false; btn.textContent = label;
    coError(UNAVAILABLE);
    return;
  }
  const ref = newRef();
  storageSet(localStorage, PAY_KEY, { ref, ts: Date.now() });
  saveStateNow();
  const url = new URL(CONFIG.paymentUrl);
  url.searchParams.set('client_reference_id', ref);
  const email = (readAppeal().email || '').trim();
  if (email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) url.searchParams.set('prefilled_email', email);
  window.location.assign(url.href);
}
function readPayRecord() {
  const rec = storageGet(localStorage, PAY_KEY);
  return isPlainObject(rec) && REF_RE.test(rec.ref || '') ? { ref: rec.ref, sid: SID_RE.test(rec.sid || '') ? rec.sid : '', ts: +rec.ts || 0 } : null;
}
async function handlePaymentReturn() {
  const q = new URLSearchParams(location.search);
  const status = q.get('platnosc'), sid = q.get('session_id') || '';
  if (status !== null || q.has('session_id')) history.replaceState(null, '', location.pathname + location.hash);
  if (DEMO || !CONFIG.verifyEndpoint) return;
  const pay = readPayRecord();
  if (status === 'sukces') {
    if (!SID_RE.test(sid)) { toast('Nieprawidłowe potwierdzenie płatności.', 8000); return; }
    if (!pay) { toast('Ta przeglądarka nie rozpoczęła tego zamówienia. Jeśli zapłaciłeś(-aś), napisz do nas z adresu e-mail podanego przy płatności.', 12000); return; }
    pay.sid = sid;
    storageSet(localStorage, PAY_KEY, pay);
  } else if (status) {
    toast('Płatność nie została ukończona. Możesz spróbować ponownie.');
  }
  if (!pay || !pay.sid) return;
  let ok = await verifyPaid(pay.sid, pay.ref);
  for (let i = 0; status === 'sukces' && ok !== true && i < 3; i++) { await sleep(2000); ok = await verifyPaid(pay.sid, pay.ref); }
  if (ok === true) {
    PAID = true;
    updateAppeal();
    if (status === 'sukces') {
      $('wniosek').scrollIntoView();
      const ready = !validateAppeal(readAppeal()).length;
      toast(ready ? 'Dziękujemy! Płatność potwierdzona – pobieram PDF.' : 'Dziękujemy! Płatność potwierdzona. Uzupełnij formularz i pobierz PDF.', 7000);
      if (ready) setTimeout(downloadPdf, 600);
    }
  } else if (status === 'sukces') {
    toast(ok === null ? 'Nie udało się połączyć z serwerem, aby potwierdzić płatność. Odśwież stronę za chwilę – dostęp zostanie przywrócony.' : 'Nie udało się potwierdzić płatności. Jeśli środki zostały pobrane, napisz do nas – podaj e-mail z potwierdzenia płatności.', 12000);
  } else if (ok === false) {
    storageDel(localStorage, PAY_KEY); // płatność wygasła lub jest nieważna
  }
}

/* ---------- inne ---------- */
let toastTimer = null;
function toast(msg, ms = 3500) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms); }

// Tylko https:// i mailto: – blokuje np. javascript: w konfiguracji
function safeUrl(u) {
  return /^(https:\/\/|mailto:)/i.test(u || '') ? u : '#';
}
const EMAIL_RE = /^[^@\s<>"']+@[^@\s<>"']+\.[^@\s<>"']+$/;

function applyConfigText() {
  document.querySelectorAll('[data-price]').forEach(el => { el.textContent = fmtPrice(); });
  document.querySelectorAll('[data-site-url]').forEach(el => { el.textContent = CONFIG.siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') || 'TWOJA-DOMENA.pl'; });
  document.querySelectorAll('[data-seller]').forEach(el => {
    const k = el.dataset.seller;
    if (k === 'nipLine') el.textContent = CONFIG.seller.nip ? `, NIP: ${CONFIG.seller.nip}` : '';
    else if (Object.prototype.hasOwnProperty.call(CONFIG.seller, k) && CONFIG.seller[k]) el.textContent = CONFIG.seller[k];
  });
  const mail = CONFIG.seller.email;
  document.querySelectorAll('[data-contact]').forEach(a => { a.href = EMAIL_RE.test(mail) ? `mailto:${mail}` : '#'; });
}

// Slot partnera: wyłącznie prawdziwy, skonfigurowany partner – inaczej neutralne pole kontaktowe.
function applyPartner() {
  const p = CONFIG.partner;
  if (p.name && p.url) {
    $('partnerName').textContent = p.name;
    $('partnerText').textContent = p.text;
    const a = $('partnerLink');
    a.href = p.url; a.target = '_blank'; a.rel = 'sponsored noopener noreferrer';
    $('partnerBox').hidden = false;
    $('partnerEmpty').hidden = true;
  } else {
    const contact = safeUrl(CONFIG.adContactUrl);
    $('adLink').href = contact !== '#' ? contact : (EMAIL_RE.test(CONFIG.seller.email) ? `mailto:${CONFIG.seller.email}` : '#');
  }
}

/* ---------- init ---------- */
function init() {
  // Ochrona przed osadzeniem strony w cudzej ramce (clickjacking)
  if (window.top !== window.self) {
    document.body.textContent = 'Ta strona nie może być wyświetlana w ramce.';
    return;
  }
  const today = new Date();
  $('parkDate').value = isoDate(nextWorkingDay(today));
  $('a-letterDate').value = isoDate(today);
  applyConfigText();
  applyPartner();

  renderRateTable();
  $('calcForm').addEventListener('input', updateCalc);
  $('calcForm').addEventListener('change', updateCalc);
  updateCalc();

  loadState();
  window.addEventListener('pagehide', () => { clearTimeout(saveTimer); saveStateNow(); });
  $('appealForm').addEventListener('input', e => {
    e.target.removeAttribute('aria-invalid');
    updateAppeal();
    saveState();
  });
  $('appealForm').addEventListener('change', e => {
    if (e.target.dataset.att != null) attOverrides[e.target.dataset.att] = e.target.checked;
    if (e.target.dataset.custom != null) customAtt[+e.target.dataset.custom].on = e.target.checked;
    updateAppeal();
    saveState();
  });
  $('addAtt').addEventListener('click', () => {
    const label = $('a-customAtt').value.trim();
    if (!label) return;
    customAtt.push({ label, on: true });
    $('a-customAtt').value = '';
    updateAppeal();
    saveState();
  });
  $('a-customAtt').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); $('addAtt').click(); }
  });
  $('a-controlDate').addEventListener('change', () => {
    if (!$('a-payDate').value) $('a-payDate').value = $('a-controlDate').value;
  });
  updateAppeal();

  document.querySelectorAll('form').forEach(f => f.addEventListener('submit', e => e.preventDefault()));
  $('getPdf').addEventListener('click', onBuy);
  $('coPay').addEventListener('click', onPay);
  document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => {
    const d = document.getElementById(b.dataset.open);
    if (d && d.tagName === 'DIALOG' && !d.open) d.showModal();
  }));
  document.querySelectorAll('dialog').forEach(d => {
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
    d.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => d.close()));
  });

  handlePaymentReturn();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
