// ═══════════════════════════════════════════
//  Kalkulator KPR — logika (dashboard BRI)
// ═══════════════════════════════════════════

// Registrasi plugin anotasi Chart.js (garis BEP)
if (window.Chart && window['chartjs-plugin-annotation']) {
  Chart.register(window['chartjs-plugin-annotation']);
}

// ─── State ───
let state = {
  steps: [
    { months: 36, rate: 3, payment: 0 },
    { months: 36, rate: 6.5, payment: 0 },
    { months: 108, rate: 9.35, payment: 0 },
  ],
    mode: 'kpr-baru',
  feeMode: 'persen',
  lastTenor: null, // tenor terakhir yang diisi user (dipertahankan saat ganti program)
};
let saldoChart = null;
let kumulatifChart = null;

let _calcTimer = null;
function scheduleCalc() {
  clearTimeout(_calcTimer);
  _calcTimer = setTimeout(() => { try { calculate(); } catch (e) { console.error(e); } }, 150);
}
function isDark() { return document.documentElement.classList.contains('dark'); }

// ─── Theme toggle ───
function updateThemeIcon() {
  const d = isDark();
  const sun = document.getElementById('iconSun'), moon = document.getElementById('iconMoon');
  if (sun && moon) { sun.classList.toggle('hidden', !d); moon.classList.toggle('hidden', d); }
}
function toggleTheme() {
  const d = document.documentElement.classList.toggle('dark');
  try { localStorage.setItem('kpr-theme', d ? 'dark' : 'light'); } catch (e) {}
  updateThemeIcon();
  scheduleCalc(); // re-render charts dengan warna tema baru
}

// ─── Math ───
function standardPayment(balance, monthlyRate, n) {
  if (n <= 0) return 0;
  if (Math.abs(monthlyRate) < 1e-9) return balance / n;
  const f = Math.pow(1 + monthlyRate, n);
  return (balance * monthlyRate * f) / (f - 1);
}
function simulateFull(principal, steps) {
  let balance = principal;
  const rows = [];
  const stepSummaries = [];
  let monthCounter = 0;
  steps.forEach((s, stepIdx) => {
    const r = (s.rate || 0) / 100 / 12;
    const startBal = balance;
    let stepInt = 0, stepPrinc = 0;
    for (let m = 0; m < s.months; m++) {
      monthCounter++;
      const begin = balance;
      const interest = begin * r;
      const princPaid = s.payment - interest;
      balance = begin - princPaid;
      stepInt += interest;
      stepPrinc += princPaid;
      rows.push({ month: monthCounter, step: stepIdx + 1, beginBalance: begin, interest, payment: s.payment, principal: princPaid, endBalance: balance });
    }
    stepSummaries.push({ step: stepIdx + 1, months: s.months, rate: s.rate, payment: s.payment, startBalance: startBal, interest: stepInt, principal: stepPrinc, endBalance: balance });
  });
  return {
    rows, stepSummaries,
    totalInterest: rows.reduce((a, r) => a + r.interest, 0),
    totalPayments: rows.reduce((a, r) => a + r.payment, 0),
    endingBalance: balance,
    totalMonths: monthCounter,
  };
}
function solveMonthlyIRR(cashflows) {
  const npv = (rate) => cashflows.reduce((acc, cf, i) => acc + cf / Math.pow(1 + rate, i), 0);
  let lo = -0.99, hi = 3;
  let npvLo = npv(lo), npvHi = npv(hi);
  if (npvLo * npvHi > 0) { hi = 20; npvHi = npv(hi); if (npvLo * npvHi > 0) return null; }
  let mid = 0;
  for (let i = 0; i < 200; i++) {
    mid = (lo + hi) / 2;
    const m = npv(mid);
    if (Math.abs(m) < 1e-8) break;
    if (npvLo * m < 0) hi = mid; else { lo = mid; npvLo = m; }
  }
  return mid;
}
function amortizeSingle(principal, annualRate, months) {
  const r = (annualRate || 0) / 100 / 12;
  const pmt = standardPayment(principal, r, months);
  const saldo = [principal];
  let bal = principal;
  for (let i = 0; i < months; i++) {
    const interest = bal * r;
    bal = bal - (pmt - interest);
    if (bal < 0) bal = 0;
    saldo.push(bal);
  }
  return { pmt, saldo, totalBayar: pmt * months, totalBunga: pmt * months - principal };
}

// ─── Formatting ───
function sym() { return 'Rp'; }
function fmtMoney(v) {
  if (v == null || !isFinite(v)) return '—';
  const neg = v < 0;
  return `${neg ? '-' : ''}${sym()} ${Math.abs(v).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
}
function fmtCompact(v) {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v); let n = v, u = '';
  if (a >= 1e12) { n = v / 1e12; u = ' T'; }
  else if (a >= 1e9) { n = v / 1e9; u = ' M'; }
  else if (a >= 1e6) { n = v / 1e6; u = ' jt'; }
  else if (a >= 1e3) { n = v / 1e3; u = ' rb'; }
  return sym() + ' ' + n.toLocaleString('id-ID', { maximumFractionDigits: 2 }) + u;
}
function fmtPct(v, d) { return v == null || !isFinite(v) ? '—' : v.toFixed(d || 2) + '%'; }
function parseNum(str) { const d = String(str).replace(/[^0-9]/g, ''); return d === '' ? 0 : Number(d); }
function formatThousands(n) { if (n == null || n === '') return ''; const v = Number(n); return isFinite(v) ? Math.round(v).toLocaleString('id-ID') : ''; }
function restoreCursor(el, fmt, before) {
  let seen = 0, np = fmt.length;
  for (let i = 0; i < fmt.length; i++) { if (/[0-9]/.test(fmt[i])) seen++; if (seen === before) { np = i + 1; break; } }
  if (before === 0) np = 0;
  el.setSelectionRange(np, np);
}
function formatPrincipal(el) {
  const before = el.value.slice(0, el.selectionStart).replace(/[^0-9]/g, '').length;
  const fmt = formatThousands(parseNum(el.value));
  el.value = fmt; restoreCursor(el, fmt, before);
  updatePrincipalWords(); recalcAll(); scheduleCalc();
}
function formatField(el) {
  const before = el.value.slice(0, el.selectionStart).replace(/[^0-9]/g, '').length;
  const fmt = formatThousands(parseNum(el.value));
  el.value = fmt; restoreCursor(el, fmt, before);
}
function terbilang(n) {
  if (n >= 1e12) return (n / 1e12).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' triliun';
  if (n >= 1e9) return (n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' miliar';
  if (n >= 1e6) return (n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' juta';
  if (n >= 1e3) return (n / 1e3).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' ribu';
  return n.toLocaleString('id-ID');
}
function updatePrincipalWords() {
  const n = parseNum(document.getElementById('principal').value);
  document.getElementById('principalWords').textContent = n > 0 ? '≈ ' + terbilang(n) + (sym() === 'Rp' ? ' rupiah' : '') : '';
}
function monthsToText(m) {
  const y = Math.floor(m / 12), mo = m % 12; let s = '';
  if (y > 0) s += y + ' thn'; if (mo > 0) s += (s ? ' ' : '') + mo + ' bln';
  return s || '0 bln';
}

// ─── Program KPR — dimuat dari programs.csv (edit file itu untuk ubah konfigurasi) ───
let PROGRAMS = {};
let currentTier = 'no_tier';

function currentProgram() {
  const key = document.getElementById('program').value;
  return key ? PROGRAMS[currentTier][key] : null;
}
function programMaxMonths(p) { return p.segments.reduce((a, s) => a + s[0], 0); }
function buildProgramSteps(p, tenor) {
  const out = []; let left = tenor;
  for (const [months, rate] of p.segments) {
    if (left <= 0) break;
    const m = Math.min(months, left);
    out.push({ months: m, rate: +Number(rate).toFixed(4), payment: 0 });
    left -= m;
  }
  return out;
}
function parseCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}
function parseProgramsCsv(text) {
  const res = {}; let header = null;
  text.replace(/^\uFEFF/, '').split(/\r?\n/).forEach((raw, ln) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const cols = parseCsvLine(line);
    if (!header) { header = cols.map(c => c.toLowerCase()); return; }
    const row = {}; header.forEach((h, i) => row[h] = cols[i] || '');
    const segments = row.segments.split('|').map(s => s.split(':').map(Number)).filter(x => x.length === 2 && x[0] > 0 && isFinite(x[1]));
    if (!row.key || !segments.length) { console.warn('programs.csv baris ' + (ln + 1) + ' dilewati'); return; }
    const tier = row.tier || 'no_tier';
    (res[tier] = res[tier] || {})[row.key] = { name: row.name || row.key, min_months: Number(row.min_months) || 1, segments };
  });
  return res;
}
async function loadPrograms() {
  const sel = document.getElementById('program'), hint = document.getElementById('programHint');
  try {
    const r = await fetch('programs.csv', { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    PROGRAMS = parseProgramsCsv(await r.text());
    const list = PROGRAMS[currentTier] || {};
    Object.keys(list).forEach(k => {
      const o = document.createElement('option');
      o.value = k; o.textContent = list[k].name;
      sel.appendChild(o);
    });
  } catch (e) {
    console.error(e);
    hint.textContent = 'programs.csv gagal dimuat — buka lewat web server (mis. python -m http.server), bukan klik dua kali.';
  }
}
function updateProgramHint() {
  const p = currentProgram(), hint = document.getElementById('programHint'), t = document.getElementById('tenor');
  if (!p) {
    if (Number(t.value) > 0) state.lastTenor = Math.round(Number(t.value));
    hint.textContent = ''; t.disabled = true; t.value = ''; t.removeAttribute('min'); t.removeAttribute('max'); return;
  }
  const mx = programMaxMonths(p);
  t.disabled = false; t.min = p.min_months; t.max = mx;
  hint.textContent = 'Tenor ' + p.min_months + '–' + mx + ' bln (' + monthsToText(p.min_months) + ' – ' + monthsToText(mx) + ')';
}
function applyProgram(tenor) {
  const p = currentProgram(); if (!p) return;
  const mx = programMaxMonths(p);
  tenor = Math.min(mx, Math.max(p.min_months, Math.round(Number(tenor) || mx)));
  document.getElementById('tenor').value = tenor;
  state.lastTenor = tenor;
  state.steps = buildProgramSteps(p, tenor);
  updateProgramHint();
  renderSteps(); recalcAll(); scheduleCalc();
}
function onProgramChange() {
  const p = currentProgram();
    if (!p) { updateProgramHint(); return; }
  // pertahankan tenor yang sudah diisi (dibatasi ke rentang program); default ke maksimum program
  const cur = Number(document.getElementById('tenor').value) || state.lastTenor;
  applyProgram(cur > 0 ? cur : programMaxMonths(p));
}
function onTenorChange() { applyProgram(document.getElementById('tenor').value); }
// ubah manual tahap → lepas dari program
function markManual() {
  const sel = document.getElementById('program');
  if (sel.value) { sel.value = ''; updateProgramHint(); }
}

// ─── Steps UI ───
function renderSteps() {
  const c = document.getElementById('stepsContainer');
  const n = state.steps.length;
  const inp = 'num w-full px-2 py-2 bg-blue-50 dark:bg-slate-800 border border-blue-200 dark:border-slate-600 rounded-md text-sm font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:border-bri focus:bg-white dark:focus:bg-slate-900 transition';
  const lab = 'block text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-1';
  c.innerHTML = state.steps.map((s, i) => `
    <div class="bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 border-l-[3px] border-l-bri rounded-lg p-3 transition-all hover:border-l-briorange">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
          <span class="inline-flex items-center justify-center h-5 w-5 rounded bg-bri text-white text-[11px] font-bold">${i + 1}</span> Tahap ${i + 1}
        </span>
        ${n > 1 ? `<button onclick="removeStep(${i})" class="text-slate-400 hover:text-briorange text-sm leading-none transition">✕</button>` : ''}
      </div>
      <div class="grid grid-cols-3 gap-2">
        <div><label class="${lab}">Bulan</label><input type="number" value="${s.months}" min="1" step="1" onchange="updateStep(${i},'months',this.value); recalcAll(); scheduleCalc()" class="${inp}"></div>
        <div><label class="${lab}">Bunga %</label><input type="number" value="${s.rate}" min="0" step="0.01" onchange="updateStep(${i},'rate',this.value); recalcAll(); scheduleCalc()" class="${inp}"></div>
        <div><label class="${lab}">Angsuran</label><input type="text" value="${formatThousands(s.payment)}" inputmode="numeric" oninput="formatField(this); updateStep(${i},'payment',parseNum(this.value)); scheduleCalc()" class="${inp}"></div>
      </div>
    </div>`).join('');
}
function addStep() {
  if (state.steps.length >= 7) return;
  const last = state.steps.length ? state.steps[state.steps.length - 1].rate : 0;
  markManual();
  state.steps.push({ months: 12, rate: last, payment: 0 });
  renderSteps(); recalcAll(); scheduleCalc();
}
function removeStep(i) {
  if (state.steps.length <= 1) return;
  markManual();
  state.steps.splice(i, 1); renderSteps(); recalcAll(); scheduleCalc();
}
function updateStep(i, key, val) {
  if (key === 'months' || key === 'rate') markManual();
  if (key === 'months') state.steps[i].months = Math.max(1, Math.round(Number(val) || 1));
  else if (key === 'rate') state.steps[i].rate = Number(val) || 0;
  else if (key === 'payment') state.steps[i].payment = Number(val) || 0;
}
function recalcAll() {
  const principal = parseNum(document.getElementById('principal').value);
  if (principal <= 0) return;
  let balance = principal;
  for (let i = 0; i < state.steps.length; i++) {
    const monthsOwn = Math.max(1, state.steps[i].months);
    const remaining = state.steps.slice(i).reduce((a, s) => a + Math.max(1, s.months), 0);
    const r = (state.steps[i].rate || 0) / 100 / 12;
    const pmt = Math.round(standardPayment(balance, r, remaining));
    state.steps[i].payment = pmt;
    for (let m = 0; m < monthsOwn; m++) { const interest = balance * r; balance -= pmt - interest; }
  }
  renderSteps();
}

// ─── Take Over controls ───
// ─── Halaman & mode simulasi ───
const MODE_ORDER = ['kpr-baru', 'to-float', 'to-fix'];
const MODES = {
  'kpr-baru': {
    short: 'KPR Baru', icon: '🏠', mainTitle: 'Skema KPR Baru',
    title: 'KPR Baru (KPR New &amp; Secondary)',
    tagline: 'Simulasi angsuran untuk pengajuan KPR baru di BRI, baik rumah baru dari developer (primary) maupun rumah bekas (secondary).',
    who: ['Calon debitur yang akan membeli rumah dengan KPR.', 'Pembelian rumah baru dari developer (<b>KPR New</b>) atau rumah bekas/second dari perorangan (<b>Secondary</b>).'],
    calc: ['Angsuran per bulan di setiap tahap suku bunga.', 'Total bunga, total pembayaran, dan jadwal amortisasi.', '<b>Cek Kemampuan Bayar (RPC)</b>: apakah angsuran masih sesuai pendapatan.'],
    need: ['Jumlah pinjaman (plafon) dan tenor.', 'Program suku bunga yang dipilih.', 'Pendapatan per bulan &amp; angsuran lain yang sedang berjalan.'],
    ui: { border: 'border-t-bri', borderL: 'border-l-bri', badge: 'bg-bri-light text-bri dark:bg-blue-900/30 dark:text-blue-300', dot: 'bg-bri', btn: 'bg-bri hover:bg-blue-800', tab: 'bg-bri text-white' },
  },
  'to-float': {
    short: 'Take Over Float', icon: '🔄', mainTitle: 'Skema Take Over (BRI)',
    title: 'Take Over Float',
    tagline: 'Simulasi pindah KPR dari bank lain ke BRI ketika bunga di bank sebelumnya sudah memasuki masa floating.',
    who: ['Debitur KPR di bank lain yang masa bunga fix-nya sudah berakhir.', 'Bunga yang dibayar saat ini sudah <b>floating</b> (mengikuti suku bunga pasar).'],
    calc: ['Perbandingan angsuran skema sebelumnya vs skema take over BRI.', 'Selisih total pembayaran, sudah termasuk biaya take over.', '<b>Titik impas (BEP)</b>: bulan ke berapa take over mulai lebih ringan.'],
    need: ['Bunga floating saat ini &amp; sisa tenor di bank sebelumnya.', 'Sisa pokok (outstanding) pinjaman.', 'Biaya take over (persen atau nominal).'],
    ui: { border: 'border-t-briorange', borderL: 'border-l-briorange', badge: 'bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300', dot: 'bg-briorange', btn: 'bg-orange-600 hover:bg-orange-700', tab: 'bg-orange-600 text-white' },
  },
  'to-fix': {
    short: 'Take Over Fix', icon: '📌', mainTitle: '② KPR Simulasi Take Over',
    title: 'Take Over Fix',
    tagline: 'Simulasi pindah KPR dari bank lain ke BRI ketika bunga di bank sebelumnya masih fix dan nantinya akan berubah menjadi floating.',
    who: ['Debitur KPR di bank lain yang masih dalam masa bunga <b>fix</b>.', 'Ingin membandingkan: pindah ke BRI sekarang, atau bertahan dan menanggung bunga floating setelah masa fix habis.'],
    calc: ['<b>① KPR Sebelumnya</b>: angsuran saat ini, angsuran setelah float, dan tenor float.', '<b>② KPR Simulasi Take Over</b>: angsuran sesuai plafon, tenor, dan program BRI yang diajukan.', 'Perbandingan total pembayaran &amp; titik impas (BEP).'],
    need: ['Sisa pokok, sisa tenor total, dan sisa masa fix.', 'Bunga fix saat ini &amp; perkiraan bunga floating.', 'Tenor &amp; program yang diajukan ke BRI.'],
    ui: { border: 'border-t-emerald-600', borderL: 'border-l-emerald-600', badge: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300', dot: 'bg-emerald-600', btn: 'bg-emerald-600 hover:bg-emerald-700', tab: 'bg-emerald-600 text-white' },
  },
};
function infoList(title, items, dot) {
  return `<div><p class="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">${title}</p>
    <ul class="space-y-1.5">${items.map(t => `<li class="flex gap-2 text-sm text-slate-600 dark:text-slate-300"><span class="mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${dot}" aria-hidden="true"></span><span>${t}</span></li>`).join('')}</ul></div>`;
}
function infoLists(m) {
  return infoList('Untuk siapa', m.who, m.ui.dot) + infoList('Yang dihitung', m.calc, m.ui.dot) + infoList('Data yang disiapkan', m.need, m.ui.dot);
}
function renderMenu() {
  document.getElementById('menuCards').innerHTML = MODE_ORDER.map((k, i) => {
    const m = MODES[k];
    return `
    <article class="flex flex-col bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 border-t-4 ${m.ui.border} p-6 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
      <div class="flex items-center gap-3 mb-3">
        <span class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg ${m.ui.badge}" aria-hidden="true">${m.icon}</span>
        <div>
          <p class="text-[11px] font-semibold text-slate-400 dark:text-slate-500">Program ${i + 1}</p>
          <h3 class="text-base font-bold text-slate-800 dark:text-white leading-tight">${m.title}</h3>
        </div>
      </div>
      <p class="text-sm text-slate-600 dark:text-slate-300 mb-4">${m.tagline}</p>
      <div class="space-y-4 mb-6">${infoLists(m)}</div>
      <a href="#${k}" class="mt-auto inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition ${m.ui.btn}">Mulai Simulasi →</a>
    </article>`;
  }).join('');
}
function renderTabs() {
  document.getElementById('modeTabs').innerHTML = MODE_ORDER.map(k => {
    const on = k === state.mode;
    return `<a href="#${k}" ${on ? 'aria-current="page"' : ''} class="rounded-xl px-4 py-2 text-sm font-semibold transition ${on ? MODES[k].ui.tab : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}">${MODES[k].icon} ${MODES[k].short}</a>`;
  }).join('');
}
function renderProgramInfo() {
  const m = MODES[state.mode];
  document.getElementById('programInfo').innerHTML = `
    <details open class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 border-l-4 ${m.ui.borderL} p-5">
      <summary class="cursor-pointer select-none list-none flex items-start gap-3">
        <span class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${m.ui.badge}" aria-hidden="true">${m.icon}</span>
        <span class="flex-1">
          <span class="block text-base font-bold text-slate-800 dark:text-white">${m.title}</span>
          <span class="block text-sm text-slate-500 dark:text-slate-400">${m.tagline}</span>
        </span>
        <span class="text-xs font-semibold text-slate-400 mt-1">Info ▾</span>
      </summary>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 pt-4 border-t border-slate-100 dark:border-slate-700">${infoLists(m)}</div>
    </details>`;
}
// URL hash menentukan halaman: #kpr-baru, #to-float, #to-fix; selain itu menu
function route() {
  const h = location.hash.replace('#', '');
  const isMenu = !MODES[h];
  document.getElementById('menuPage').classList.toggle('hidden', !isMenu);
  document.getElementById('appPage').classList.toggle('hidden', isMenu);
  window.scrollTo(0, 0);
  if (isMenu) return;
  state.mode = h;
  renderTabs();
  renderProgramInfo();
  document.querySelectorAll('[data-modes]').forEach(el => el.classList.toggle('hidden', !el.dataset.modes.split(' ').includes(h)));
  document.getElementById('mainCardTitle').textContent = MODES[h].mainTitle;
  try { calculate(); } catch (e) { console.error(e); }
}

// ─── RPC: cek kemampuan bayar (KPR Baru) ───
// rasio maksimal angsuran terhadap pendapatan: <15jt 50%, 15–25jt 55%, >25jt 60%
function rpcRatio(income) { return income < 15e6 ? 0.50 : income <= 25e6 ? 0.55 : 0.60; }
function renderRpc(sim) {
  const el = document.getElementById('rpcResult');
  const income = parseNum(document.getElementById('rpcIncome').value);
  const debt = parseNum(document.getElementById('rpcDebt').value);
  if (income <= 0) { el.innerHTML = '<p class="text-xs text-slate-400 dark:text-slate-500">Isi pendapatan per bulan untuk melihat kemampuan bayar.</p>'; return; }
  const ratio = rpcRatio(income);
  const maxAng = income * ratio;
  const sisa = maxAng - debt;
  const multi = sim.stepSummaries.length > 1;
  const pmt = sim.stepSummaries[0] ? sim.stepSummaries[0].payment : 0;
  const peak = Math.max(0, ...sim.stepSummaries.map(s => s.payment));
  const ok = sisa >= pmt;
  const row = (l, v, cls) => `<div class="flex justify-between gap-3 py-1.5 text-sm"><span class="text-slate-500 dark:text-slate-400">${l}</span><span class="num font-semibold text-right ${cls || 'text-slate-800 dark:text-slate-100'}">${v}</span></div>`;
  const note = ok && peak > sisa
    ? `<p class="mt-1 text-xs">Catatan: angsuran tahap berikutnya naik hingga ${fmtMoney(Math.round(peak))}/bln, melebihi sisa kemampuan bayar.</p>` : '';
  const cls = ok
    ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-900/40'
    : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-900/40';
  const msg = ok
    ? `✅ <b>Mampu bayar</b> — angsuran masih di bawah sisa kemampuan bayar (sisa ruang ${fmtMoney(Math.round(sisa - pmt))}/bln).`
    : `⚠️ <b>Belum mampu bayar</b> — angsuran melebihi sisa kemampuan bayar sebesar ${fmtMoney(Math.round(pmt - Math.max(0, sisa)))}/bln. Coba perpanjang tenor atau kurangi plafon.`;
  el.innerHTML = `
    <div class="rounded-xl border border-slate-100 dark:border-slate-700 px-4 py-1 divide-y divide-slate-100 dark:divide-slate-700">
      ${row('Batas angsuran (' + Math.round(ratio * 100) + '% pendapatan)', fmtMoney(Math.round(maxAng)))}
      ${row('Dikurangi angsuran berjalan', '− ' + fmtMoney(debt))}
      ${row('Sisa kemampuan bayar', fmtMoney(Math.round(sisa)), 'text-bri dark:text-blue-300')}
      ${row('Angsuran KPR' + (multi ? ' (Tahap 1)' : ''), fmtMoney(Math.round(pmt)))}
    </div>
    <div role="status" class="mt-3 rounded-xl border px-4 py-3 text-sm font-medium ${cls}">${msg}${note}</div>`;
}

// ─── Take Over Fix: skema KPR sebelumnya (fix → float) ───
function readFixInputs() {
  const total = Math.max(1, Math.round(Number(document.getElementById('fixTotal').value) || 1));
  const leftRaw = Math.max(0, Math.round(Number(document.getElementById('fixLeft').value) || 0));
  return {
    os: parseNum(document.getElementById('fixOS').value),
    total, leftRaw, left: Math.min(total, leftRaw),
    rFix: Number(document.getElementById('fixRate').value) || 0,
    rFloat: Number(document.getElementById('floatRate').value) || 0,
  };
}
function buildFixSchedule() {
  const f = readFixInputs();
  const floatMonths = f.total - f.left;
  const steps = [];
  let curPmt = 0, floatPmt = 0, bal = f.os;
  if (f.left > 0) {
    // angsuran masa fix dihitung atas seluruh sisa tenor
    curPmt = Math.round(standardPayment(f.os, f.rFix / 1200, f.total));
    steps.push({ months: f.left, rate: f.rFix, payment: curPmt });
    for (let m = 0; m < f.left; m++) bal -= curPmt - bal * f.rFix / 1200;
  }
  if (floatMonths > 0) {
    // setelah fix habis, angsuran dihitung ulang dari sisa saldo dengan bunga float
    floatPmt = Math.round(standardPayment(bal, f.rFloat / 1200, floatMonths));
    steps.push({ months: floatMonths, rate: f.rFloat, payment: floatPmt });
  }
  if (f.left === 0) curPmt = floatPmt;
  return { f, floatMonths, curPmt, floatPmt, sim: simulateFull(f.os, steps) };
}
function renderFixOutputs(fx) {
  const f = fx.f;
  document.getElementById('fixHint').textContent = f.leftRaw > f.total
    ? 'Sisa masa fix melebihi tenor total, dianggap ' + f.total + ' bln.' : '';
  const row = (l, v, sub) => `<div class="flex justify-between gap-3 py-2 border-b last:border-b-0 border-emerald-100 dark:border-emerald-900/40">
    <span class="text-xs text-slate-500 dark:text-slate-400">${l}${sub ? `<span class="block text-[10px] text-slate-400 dark:text-slate-500">${sub}</span>` : ''}</span>
    <span class="num text-sm font-bold text-slate-800 dark:text-slate-100 text-right">${v}</span></div>`;
  document.getElementById('fixOutputs').innerHTML =
    row('Angsuran saat ini', fmtMoney(fx.curPmt) + ' /bln', f.left > 0 ? 'Bunga fix ' + fmtPct(f.rFix) + ', ' + f.left + ' bln lagi' : 'Masa fix sudah habis') +
    row('Angsuran float', fx.floatMonths > 0 ? fmtMoney(fx.floatPmt) + ' /bln' : '—', fx.floatMonths > 0 ? 'Bunga ' + fmtPct(f.rFloat) + ', mulai bulan ke-' + (f.left + 1) : '') +
    row('Tenor float', fx.floatMonths + ' bln', monthsToText(fx.floatMonths));
}

function toggleCustomPlafon() {
  const c = document.getElementById('customPlafon').checked;
  document.getElementById('plafonField').classList.toggle('hidden', !c);
  scheduleCalc();
}



function onFeeModeChange() {
  state.feeMode = document.getElementById('feeMode').value;
  const inp = document.getElementById('feeVal'), suf = document.getElementById('feeSuffix');
  if (state.feeMode === 'persen') { suf.textContent = '%'; inp.value = '5'; }
  else { suf.textContent = ''; inp.value = '50.000.000'; }
  updateFeeHint(); scheduleCalc();
}
function onFeeInput(el) {
  if (state.feeMode === 'nominal') formatField(el);
  updateFeeHint(); scheduleCalc();
}
function getFee(principal) {
  const raw = document.getElementById('feeVal').value;
  if (state.feeMode === 'persen') return Math.round(principal * (Number(raw) || 0) / 100);
  return parseNum(raw);
}
function updateFeeHint() {
  const principal = parseNum(document.getElementById('principal').value);
  const hint = document.getElementById('feeHint');
  if (state.feeMode === 'persen') {
    const pct = Number(document.getElementById('feeVal').value) || 0;
    hint.textContent = '= ' + fmtMoney(Math.round(principal * pct / 100));
  } else {
    const val = parseNum(document.getElementById('feeVal').value);
    hint.textContent = principal > 0 ? '= ' + fmtPct(val / principal * 100, 2) + ' dari plafon' : '';
  }
}
function toggleAmort() {
  const w = document.getElementById('amortWrap'), a = document.getElementById('amortArrow');
  const hidden = w.classList.toggle('hidden');
  a.style.transform = hidden ? 'rotate(-90deg)' : 'rotate(0deg)';
}

// ─── Take Over computation ───
// bangun jadwal pembayaran bulanan skema lama (array panjang = jumlah bulan)
function buildOldSchedule(principal) {
  if (state.mode === 'to-fix') {
    const fx = buildFixSchedule();
    const saldo = [fx.f.os];
    fx.sim.rows.forEach(r => saldo.push(Math.max(0, r.endBalance)));
    return {
      principal: fx.f.os,
      months: fx.sim.totalMonths,
      payments: fx.sim.rows.map(r => r.payment),
      saldo,
      totalBunga: fx.sim.totalInterest,
      firstPmt: fx.curPmt,
      fx,
    };
  }
  // Take Over Float: bunga float tunggal sepanjang sisa tenor
  const oldPrincipal = document.getElementById('customPlafon').checked ? parseNum(document.getElementById('oldPlafon').value) : principal;
  const oldRate = Number(document.getElementById('oldRate').value) || 0;
  const oldMonths = Math.max(1, Math.round(Number(document.getElementById('oldTerm').value) || 1));
  const a = amortizeSingle(oldPrincipal, oldRate, oldMonths);
    return {
    principal: oldPrincipal,
    months: oldMonths,
    payments: new Array(oldMonths).fill(a.pmt),
    saldo: a.saldo,
    totalBunga: a.totalBunga,
    firstPmt: a.pmt,
  };
}
function computeTakeover(principal, sim) {
    const old = buildOldSchedule(principal);
  const oldPrincipal = old.principal;
  const oldMonths = old.months;
  const oldPmt = old.firstPmt;
  const fee = getFee(principal);

  const horizon = Math.max(oldMonths, sim.totalMonths);
  const cumOld = [0], cumNew = [fee];
  let runOld = 0, runNew = fee;
  for (let t = 1; t <= horizon; t++) {
    if (t <= oldMonths) runOld += old.payments[t - 1];
    cumOld.push(runOld);
    if (t <= sim.totalMonths) {
      runNew += sim.rows[t - 1].payment;
      if (t === sim.totalMonths && Math.abs(sim.endingBalance) > 1) runNew += sim.endingBalance;
    }
    cumNew.push(runNew);
  }
  const crossings = [];
  for (let t = 1; t <= horizon; t++) {
    const dP = cumNew[t - 1] - cumOld[t - 1], dC = cumNew[t] - cumOld[t];
    if (Math.abs(dP) < 1e-6) crossings.push(t - 1);
    else if (dP * dC < 0) crossings.push(t - 1 + dP / (dP - dC));
  }
  crossings.sort((a, b) => a - b);
  const meets = crossings.filter((m, i) => i === 0 || Math.abs(m - crossings[i - 1]) > 1e-4);

    const oldTotal = cumOld[oldMonths];
  const newTotal = cumNew[sim.totalMonths];
  return {
    oldPrincipal, oldMonths, oldPmt, fee, horizon, cumOld, cumNew,
    fx: old.fx || null,
    oldSaldo: old.saldo, oldTotalBunga: old.totalBunga,
    meets, oldTotal, newTotal, efisiensi: oldTotal - newTotal,
  };
}

// ─── Main calculate (real-time) ───
function calculate() {
  const principal = parseNum(document.getElementById('principal').value);
  const s = sym();
  document.getElementById('curr1').textContent = s;
  document.getElementById('curr2').textContent = s;
  if (principal <= 0) return;

  const cleanSteps = state.steps.map(st => ({ months: Math.max(1, Math.round(st.months)), rate: st.rate || 0, payment: st.payment || 0 }));
  const sim = simulateFull(principal, cleanSteps);

  const cashflows = [-principal];
  sim.rows.forEach((row, i) => { cashflows.push(row.payment + (i === sim.rows.length - 1 ? sim.endingBalance : 0)); });
  const mIRR = solveMonthlyIRR(cashflows);
  sim.irrNominal = mIRR !== null ? mIRR * 12 * 100 : null;
  sim.irrEfektif = mIRR !== null ? (Math.pow(1 + mIRR, 12) - 1) * 100 : null;

    const to = state.mode !== 'kpr-baru' ? computeTakeover(principal, sim) : null;
  if (to && to.fx) renderFixOutputs(to.fx);
  if (state.mode === 'kpr-baru') renderRpc(sim);


  renderSummaryCards(sim, to, principal);
  renderMetrics(sim, to, principal);
  renderCharts(sim, to);
  renderStepTable(sim);
  renderAmort(sim);
  renderToBanner(sim, to);
  saveState();
}

// ─── Render: summary cards ───
function renderSummaryCards(sim, to, principal) {
  const firstPmt = sim.stepSummaries[0] ? sim.stepSummaries[0].payment : 0;
  const multi = sim.stepSummaries.length > 1;
  const pctBunga = principal > 0 ? (sim.totalInterest / principal * 100) : 0;
  const whiteCard = 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5';

  let html = `
    <div class="relative overflow-hidden rounded-2xl p-5 text-white shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5" style="background:linear-gradient(135deg,#0072C6,#00529C)">
      <div class="absolute -right-6 -top-6 w-24 h-24 bg-white/10 rounded-full"></div>
      <p class="text-blue-100 text-xs font-semibold mb-1">${to ? 'Angsuran Take Over' : 'Angsuran KPR'} ${multi ? '(Tahap 1)' : ''}</p>
      <h3 class="text-2xl font-bold mb-1 num">${fmtMoney(firstPmt)}<span class="text-xs font-normal"> /bln</span></h3>
      <p class="text-[11px] text-blue-200">${multi ? 'Angsuran ringan di awal · ' : ''}Total bunga ${fmtCompact(sim.totalInterest)}</p>
    </div>`;

  if (to) {
    const selPmt = to.oldPmt - firstPmt;
    const pmtHtml = selPmt >= 0
      ? `<span class="text-emerald-600 dark:text-emerald-400">▼ ${fmtMoney(selPmt)}</span>`
            : `<span class="text-amber-600 dark:text-amber-400">▲ ${fmtMoney(Math.abs(selPmt))}</span>`;
    const hemat = to.efisiensi >= 0;
    const effColor = hemat ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400';
    html += `
      <div class="${whiteCard}">
        <p class="text-slate-500 dark:text-slate-400 text-xs font-semibold mb-1">Perubahan Angsuran</p>
        <h3 class="text-xl font-bold mb-1 num">${pmtHtml}</h3>
                <p class="text-[11px] text-slate-400 dark:text-slate-500">Angsuran sebelum: ${fmtMoney(Math.round(to.oldPmt))}/bln</p>
      </div>
      <div class="${whiteCard}">
        <p class="text-slate-500 dark:text-slate-400 text-xs font-semibold mb-1">Selisih Total Dibayar</p>
        <h3 class="text-xl font-bold mb-1 num ${effColor}">${hemat ? 'Hemat ' : 'Lebih '}${fmtCompact(Math.abs(to.efisiensi))}</h3>
        <p class="text-[11px] text-slate-400 dark:text-slate-500">Biaya tambahan take over ${fmtCompact(to.fee)}</p>
      </div>`;
  } else {
    html += `
      <div class="${whiteCard}">
        <p class="text-slate-500 dark:text-slate-400 text-xs font-semibold mb-1">Total Pembayaran</p>
        <h3 class="text-xl font-bold text-slate-800 dark:text-slate-100 num">${fmtCompact(sim.totalPayments)}</h3>
        <p class="text-[11px] text-slate-400 dark:text-slate-500">${sim.totalMonths} bulan</p>
      </div>
      <div class="${whiteCard}">
        <p class="text-slate-500 dark:text-slate-400 text-xs font-semibold mb-1">Total Bunga</p>
        <h3 class="text-xl font-bold text-bri dark:text-blue-300 num">${fmtCompact(sim.totalInterest)}</h3>
        <p class="text-[11px] text-slate-400 dark:text-slate-500">${fmtPct(pctBunga, 1)} dari pokok</p>
      </div>`;
  }
  document.getElementById('summaryCards').innerHTML = html;
}

// Keep "Rp" attached to the number, and measure text length for auto-fit
function fitText(v) {
  const s = String(v).replace(/Rp /g, 'Rp\u00A0');
  return { s, len: [...s].length };
}
function metricCell(label, value, o) {
  o = o || {};
  const bg = o.bg || 'bg-slate-50 dark:bg-slate-700/50';
  const lc = o.lc || 'text-slate-500 dark:text-slate-400';
  const vc = o.vc || 'text-slate-800 dark:text-slate-100';
  const f = fitText(value);
  return `<div class="fit-card p-3 rounded-lg ${bg} transition-all duration-200 hover:-translate-y-0.5">
    <p class="text-[10px] font-bold uppercase mb-1 break-words ${lc}">${label}</p>
    <p class="fit-val font-semibold num ${vc}" style="--len:${f.len};--max:.875rem">${f.s}</p></div>`;
}
function bigCell(label, value, o) {
  o = o || {};
  const bg = o.bg || 'bg-slate-50 dark:bg-slate-700/50';
  const lc = o.lc || 'text-slate-500 dark:text-slate-400';
  const vc = o.vc || 'text-slate-800 dark:text-slate-100';
  const sc = o.sc || 'text-slate-400 dark:text-slate-500';
  const f = fitText(value);
  return `<div class="fit-card p-4 rounded-xl ${bg} transition-all duration-200 hover:-translate-y-0.5">
    <p class="text-[10px] sm:text-[11px] font-bold uppercase mb-1.5 break-words ${lc}">${label}</p>
    <p class="fit-val font-bold num ${vc}" style="--len:${f.len};--max:1.125rem">${f.s}</p>
    ${o.sub ? `<p class="text-[11px] mt-1 break-words ${sc}">${o.sub}</p>` : ''}</div>`;
}
function metricSection(title, dot, cells, cols) {
  return `<div>
    <p class="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300 mb-2"><span class="h-2 w-2 rounded-full ${dot}"></span>${title}</p>
    <div class="grid grid-cols-2 ${cols || 'lg:grid-cols-4'} gap-3">${cells}</div></div>`;
}
function renderMetrics(sim, to, principal) {
  const balloon = Math.abs(sim.endingBalance) > 1;
  const steps = sim.stepSummaries;
  const firstPmt = steps[0] ? steps[0].payment : 0;
  const lastPmt = steps.length ? steps[steps.length - 1].payment : 0;
  const multi = steps.length > 1;
  const pctBunga = principal > 0 ? sim.totalInterest / principal * 100 : 0;
  const blue = { bg: 'bg-bri-light dark:bg-blue-900/20', lc: 'text-bri dark:text-blue-300', vc: 'text-bri dark:text-blue-300', sc: 'text-slate-500 dark:text-slate-400' };
  const org = { bg: 'bg-orange-50 dark:bg-orange-900/20', lc: 'text-orange-600 dark:text-orange-300', vc: 'text-slate-800 dark:text-slate-100', sc: 'text-slate-500 dark:text-slate-400' };

  // 1) Skema baru
  let html = metricSection(to ? 'Skema Take Over (Setelah Take Over)' : 'Skema KPR', 'bg-bri',
    bigCell('Total Jangka Waktu', sim.totalMonths + ' bln', Object.assign({ sub: monthsToText(sim.totalMonths) }, blue)) +
    bigCell('Total Pembayaran', fmtMoney(Math.round(sim.totalPayments)), Object.assign({ sub: balloon ? 'Belum termasuk sisa saldo ' + fmtCompact(sim.endingBalance) : '' }, blue)) +
    bigCell('Total Bunga', fmtMoney(Math.round(sim.totalInterest)), Object.assign({ sub: fmtPct(pctBunga, 1) + ' dari pokok' }, blue)) +
    bigCell(multi ? 'Angsuran (Tahap 1)' : 'Angsuran', fmtMoney(Math.round(firstPmt)) + ' /bln', Object.assign({ sub: multi ? 'Tahap akhir ' + fmtMoney(Math.round(lastPmt)) + ' /bln' : '' }, blue)));

  if (to) {
        // 2) Skema sebelumnya (before)
    html += metricSection('Skema Sebelumnya (Sebelum Take Over)', 'bg-briorange',
      bigCell('Total Jangka Waktu Sebelum', to.oldMonths + ' bln', Object.assign({ sub: monthsToText(to.oldMonths) }, org)) +
      bigCell('Total Pembayaran Sebelum', fmtMoney(Math.round(to.oldTotal)), org) +
      bigCell('Total Bunga Sebelum', fmtMoney(Math.round(to.oldTotalBunga)), Object.assign({ sub: to.oldPrincipal > 0 ? fmtPct(to.oldTotalBunga / to.oldPrincipal * 100, 1) + ' dari pokok' : '' }, org)) +
      bigCell('Angsuran Sebelum', fmtMoney(Math.round(to.oldPmt)) + ' /bln', Object.assign({ sub: 'Plafon sebelumnya ' + fmtCompact(to.oldPrincipal) }, org)));

    // 3) Perbandingan
    const selPmt = to.oldPmt - firstPmt;
    const pmtGood = selPmt >= 0;
    const effGood = to.efisiensi >= 0;
    const good = { bg: 'bg-emerald-50 dark:bg-emerald-900/20', lc: 'text-emerald-600 dark:text-emerald-300', vc: 'text-emerald-600 dark:text-emerald-300', sc: 'text-slate-500 dark:text-slate-400' };
    const bad = { bg: 'bg-amber-50 dark:bg-amber-900/20', lc: 'text-amber-600 dark:text-amber-300', vc: 'text-amber-600 dark:text-amber-300', sc: 'text-slate-500 dark:text-slate-400' };
    html += metricSection('Perbandingan Take Over', 'bg-emerald-500',
    bigCell('Keunggulan Angsuran (vs Skema Sebelumnya)', (pmtGood ? '▼ ' : '▲ ') + fmtMoney(Math.round(Math.abs(selPmt))) + ' /bln',
    Object.assign({ sub: (pmtGood ? 'Angsuran lebih ringan' : 'Angsuran lebih tinggi di awal') + (multi ? ' (acuan Tahap 1)' : '') }, pmtGood ? good : bad)) +
    bigCell('Selisih Total Dibayar', (effGood ? 'Hemat ' : 'Lebih ') + fmtMoney(Math.round(Math.abs(to.efisiensi))),
    Object.assign({ sub: 'Selisih total skema sebelumnya dengan take over, termasuk biaya tambahan take over ' + fmtCompact(to.fee) + (balloon ? ' & sisa saldo' : '') }, effGood ? good : bad)),
  'lg:grid-cols-2');
  }

  // 4) Detail lainnya (sekunder)
  let more =
    metricCell('IRR Bank (Tahunan)', fmtPct(sim.irrNominal), { vc: 'text-bri dark:text-blue-300' }) +
    metricCell('IRR Efektif', fmtPct(sim.irrEfektif), { vc: 'text-bri dark:text-blue-300' }) 
    // +
    // metricCell('Sisa Saldo Akhir', balloon ? fmtCompact(sim.endingBalance) : sym() + ' 0',
    //   balloon ? { vc: 'text-orange-600 dark:text-orange-400' } : { vc: 'text-emerald-600 dark:text-emerald-400' })
      ;
  if (to) more += metricCell('Biaya Tambahan Take Over', fmtCompact(to.fee), { vc: 'text-bri dark:text-blue-300' });
  html += `<div class="pt-4 border-t border-slate-100 dark:border-slate-700">
    <p class="text-xs font-bold text-slate-400 dark:text-slate-500 mb-2">Detail Lainnya</p>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${more}</div></div>`;

  document.getElementById('metricsGrid').innerHTML = html;
}

// ─── Render: TO banner ───
function renderToBanner(sim, to) {
  const el = document.getElementById('toBanner');
  if (!to) { el.innerHTML = ''; return; }
  let msg, cls;
    if (to.efisiensi > 0) { cls = 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-900/40'; msg = `✅ <b>Take over lebih menguntungkan</b> — Anda berpotensi menghemat <b>${fmtMoney(Math.round(to.efisiensi))}</b> dibanding skema sebelumnya.`; }
  else if (to.efisiensi < 0) { cls = 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 border-orange-100 dark:border-orange-900/40'; msg = `ℹ️ <b>Total pembayaran take over lebih tinggi</b> sebesar <b>${fmtMoney(Math.round(Math.abs(to.efisiensi)))}</b>, namun Anda menikmati bunga awal yang lebih ringan di tahun-tahun pertama.`; }
  else { cls = 'bg-bri-light dark:bg-blue-900/20 text-bri dark:text-blue-300 border-blue-100 dark:border-blue-900/40'; msg = `Total pembayaran skema take over & skema sebelumnya hampir sama.`; }
    let bep = '';
  if (to.meets.length) {
    const parts = to.meets.map(mp => {
      const bm = Math.round(mp);
      const after = Math.min(bm + 1, to.horizon);
      const newCheaper = to.cumNew[after] < to.cumOld[after];
      return `<b>bulan ke-${bm}</b> (${monthsToText(bm)}) total take over ${newCheaper ? 'mulai <b>lebih ringan</b>' : 'kembali <b>lebih tinggi</b>'} dibanding skema sebelumnya`;
    });
    const label = to.meets.length > 1 ? `Terdapat ${to.meets.length} titik impas — ` : `Titik impas di `;
    bep = `<div class="mt-2 text-xs opacity-90">📍 ${label}${parts.join('; kemudian ')}.</div>`;
  }
  el.innerHTML = `<div class="rounded-2xl border px-5 py-4 text-sm font-medium ${cls}">${msg}${bep}</div>`;
}

// ─── Render: charts ───
function downsample(arr, maxN) {
  const n = arr.length;
  if (n <= maxN) return arr.map((y, x) => ({ x, y }));
  const step = Math.ceil(n / maxN);
  const out = [];
  for (let i = 0; i < n; i += step) out.push({ x: i, y: arr[i] });
  if (out[out.length - 1].x !== n - 1) out.push({ x: n - 1, y: arr[n - 1] });
  return out;
}
function renderCharts(sim, to) {
  const balBaru = [parseNum(document.getElementById('principal').value)];
  sim.rows.forEach(r => balBaru.push(Math.max(0, r.endBalance)));
  const cumBaru = [0]; let run = 0;
  sim.rows.forEach(r => { run += r.payment; cumBaru.push(run); });

  const dsSaldo = [{ label: 'Saldo Take Over', data: downsample(balBaru, 220), borderColor: '#00529C', backgroundColor: 'rgba(0,82,156,0.08)', borderWidth: 2, fill: true, tension: 0.2, pointRadius: 0, pointHoverRadius: 4 }];
  const dsKum = [{ label: to ? 'Kumulatif Take Over' : 'Kumulatif Pembayaran', data: downsample(to ? to.cumNew : cumBaru, 220), borderColor: '#00529C', backgroundColor: 'rgba(0,82,156,0.06)', borderWidth: 2, fill: true, tension: 0.2, pointRadius: 0, pointHoverRadius: 4 }];
  let annos = {};
  if (to) {
    dsSaldo.push({ label: 'Saldo Sebelumnya', data: downsample(to.oldSaldo, 220), borderColor: '#F58220', borderDash: [5, 4], borderWidth: 2, fill: false, tension: 0.2, pointRadius: 0, pointHoverRadius: 4 });
    dsKum.push({ label: 'Kumulatif Sebelumnya', data: downsample(to.cumOld, 220), borderColor: '#F58220', borderDash: [5, 4], borderWidth: 2, fill: false, tension: 0.2, pointRadius: 0, pointHoverRadius: 4 });
        if (to.meets.length) {
      to.meets.forEach((mp, idx) => {
        const x = Math.round(mp);
        annos['bep' + idx] = { type: 'line', xMin: x, xMax: x, borderColor: '#94a3b8', borderWidth: 1.5, borderDash: [6, 4], label: { display: true, content: to.meets.length > 1 ? 'BEP ' + (idx + 1) : 'BEP', position: idx % 2 ? 'end' : 'start', backgroundColor: 'rgba(100,116,139,0.9)', color: '#fff', font: { size: 10 } } };
      });
    }
  }

  const dark = isDark();
  const tickColor = dark ? '#94a3b8' : '#64748b';
  const gridColor = dark ? 'rgba(148,163,184,0.14)' : '#eef2f7';
  const legendColor = dark ? '#cbd5e1' : '#475569';

  const baseOpts = (withAnno) => ({
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    animation: { duration: 500 },
    plugins: {
      legend: { display: !!to, position: 'bottom', labels: { boxWidth: 12, font: { size: 10 }, color: legendColor, usePointStyle: true } },
      tooltip: { callbacks: { title: (it) => 'Bulan ' + it[0].parsed.x, label: (it) => it.dataset.label + ': ' + fmtMoney(it.parsed.y) } },
      annotation: { annotations: withAnno ? annos : {} },
    },
    scales: {
      x: { type: 'linear', ticks: { color: tickColor, font: { size: 10 }, maxTicksLimit: 8 }, grid: { color: gridColor }, title: { display: true, text: 'Bulan', color: tickColor, font: { size: 10 } } },
      y: { beginAtZero: true, ticks: { color: tickColor, font: { size: 10 }, maxTicksLimit: 6, callback: (v) => fmtCompact(v) }, grid: { color: gridColor } },
    },
  });

  const saldoEl = document.getElementById('saldoChart'); // bisa tidak ada (dikomentari di HTML)
  if (saldoChart) { saldoChart.data.datasets = dsSaldo; saldoChart.options = baseOpts(false); saldoChart.update(); }
  else if (saldoEl) { saldoChart = new Chart(saldoEl, { type: 'line', data: { datasets: dsSaldo }, options: baseOpts(false) }); }
  if (kumulatifChart) { kumulatifChart.data.datasets = dsKum; kumulatifChart.options = baseOpts(true); kumulatifChart.update(); }
  else { kumulatifChart = new Chart(document.getElementById('kumulatifChart'), { type: 'line', data: { datasets: dsKum }, options: baseOpts(true) }); }
}

// ─── Render: step table ───
function renderStepTable(sim) {
  const td = 'px-3 py-2.5 border-t border-slate-100 dark:border-slate-700';
  let rows = sim.stepSummaries.map(r => `
    <tr class="hover:bg-blue-50 dark:hover:bg-slate-700/60 transition-colors">
      <td class="${td} text-center"><span class="inline-flex items-center justify-center h-5 w-5 rounded bg-bri text-white text-[11px] font-bold">${r.step}</span></td>
      <td class="${td}">${r.months}</td>
      <td class="${td}">${fmtPct(r.rate)}</td>
      <td class="${td} font-semibold">${fmtMoney(Math.round(r.payment))}</td>
      <td class="${td}">${fmtMoney(Math.round(r.principal))}</td>
      <td class="${td} text-bri dark:text-blue-300">${fmtMoney(Math.round(r.interest))}</td>
      <td class="${td}">${fmtMoney(Math.round(r.endBalance))}</td>
    </tr>`).join('');
  rows += `
    <tr class="bg-bri-light dark:bg-slate-700 font-bold">
      <td class="px-3 py-2.5 border-t border-slate-200 dark:border-slate-600" colspan="3">TOTAL</td>
      <td class="px-3 py-2.5 border-t border-slate-200 dark:border-slate-600">${fmtMoney(Math.round(sim.totalPayments))}</td>
      <td class="px-3 py-2.5 border-t border-slate-200 dark:border-slate-600">${fmtMoney(Math.round(sim.totalPayments - sim.totalInterest))}</td>
      <td class="px-3 py-2.5 border-t border-slate-200 dark:border-slate-600 text-bri dark:text-blue-300">${fmtMoney(Math.round(sim.totalInterest))}</td>
      <td class="px-3 py-2.5 border-t border-slate-200 dark:border-slate-600">${fmtMoney(Math.round(sim.endingBalance))}</td>
    </tr>`;
  document.getElementById('stepTable').innerHTML = `
    <table class="num w-full text-left text-sm text-slate-600 dark:text-slate-300 whitespace-nowrap">
      <thead class="bg-slate-50 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400 text-[11px] uppercase font-semibold">
        <tr><th class="px-3 py-3 text-center">Tahap</th><th class="px-3 py-3">Bulan</th><th class="px-3 py-3">Bunga</th><th class="px-3 py-3">Angsuran</th><th class="px-3 py-3">Pokok</th><th class="px-3 py-3">Bunga Dibayar</th><th class="px-3 py-3">Saldo Akhir</th></tr>
      </thead><tbody>${rows}</tbody></table>`;
}

// ─── Render: full amortization ───
let _lastSim = null;
function renderAmort(sim) {
  _lastSim = sim;
  const showAll = sim.rows.length <= 60;
  const rows = showAll ? sim.rows : sim.rows.slice(0, 36);
  document.getElementById('amortTable').innerHTML = amortTableHtml(rows) +
    (showAll ? '' : `<div class="text-center mt-3"><button onclick="showFullAmort()" class="text-xs font-semibold text-bri dark:text-blue-300 border border-slate-200 dark:border-slate-600 hover:bg-bri-light dark:hover:bg-slate-700 rounded-lg px-4 py-2 transition">Tampilkan semua ${sim.rows.length} bulan</button></div>`);
}
function amortTableHtml(rows) {
  const td = 'px-3 py-2 border-t border-slate-100 dark:border-slate-700';
  const body = rows.map(r => `
    <tr class="hover:bg-blue-50 dark:hover:bg-slate-700/60 transition-colors">
      <td class="${td}">${r.month}</td>
      <td class="${td} text-center"><span class="inline-flex items-center justify-center h-4 w-4 rounded bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300 text-[10px] font-bold">${r.step}</span></td>
      <td class="${td}">${fmtMoney(Math.round(r.beginBalance))}</td>
      <td class="${td} text-bri dark:text-blue-300">${fmtMoney(Math.round(r.interest))}</td>
      <td class="${td}">${fmtMoney(Math.round(r.principal))}</td>
      <td class="${td} font-medium">${fmtMoney(Math.round(r.payment))}</td>
      <td class="${td}">${fmtMoney(Math.round(r.endBalance))}</td>
    </tr>`).join('');
  return `<table class="num w-full text-left text-sm text-slate-600 dark:text-slate-300 whitespace-nowrap">
    <thead class="bg-slate-50 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400 text-[11px] uppercase font-semibold">
      <tr><th class="px-3 py-3">Bln</th><th class="px-3 py-3 text-center">Thp</th><th class="px-3 py-3">Saldo Awal</th><th class="px-3 py-3">Bunga</th><th class="px-3 py-3">Pokok</th><th class="px-3 py-3">Angsuran</th><th class="px-3 py-3">Saldo Akhir</th></tr>
    </thead><tbody>${body}</tbody></table>`;
}
function showFullAmort() {
  if (_lastSim) document.getElementById('amortTable').innerHTML = amortTableHtml(_lastSim.rows);
}

// ─── Simpan input terakhir (localStorage) ───
const STORE_KEY = 'kpr-state-v1';
let _stateReady = false;   // baru boleh menyimpan setelah program selesai dimuat
let _saved = null;         // data tersimpan yang dibaca saat start
function saveState() {
  if (!_stateReady) return;
  const v = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  const c = id => { const el = document.getElementById(id); return !!(el && el.checked); };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      v: 1,
      principal: v('principal'), program: v('program'), tenor: v('tenor'),
      steps: state.steps,
            oldRate: v('oldRate'), oldTerm: v('oldTerm'),
                  customPlafon: c('customPlafon'), oldPlafon: v('oldPlafon'),
                  rpcIncome: v('rpcIncome'), rpcDebt: v('rpcDebt'),
                  fixOS: v('fixOS'), fixTotal: v('fixTotal'), fixLeft: v('fixLeft'), fixRate: v('fixRate'), floatRate: v('floatRate'),

      feeMode: state.feeMode, feeVal: v('feeVal'),
    }));
  } catch (e) {}
}
function validSteps(a) {
  return Array.isArray(a) && a.length >= 1 && a.length <= 7 &&
    a.every(s => s && Number.isFinite(+s.months) && +s.months >= 1 && +s.months <= 600 && Number.isFinite(+s.rate) && +s.rate >= 0 && Number.isFinite(+s.payment));
}
// kembalikan true jika tahapan bunga berhasil dipulihkan
function restoreState() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) {}
  if (!s || s.v !== 1) return false;
  _saved = s;
  const set = (id, val) => { const el = document.getElementById(id); if (el && val != null && val !== '') el.value = val; };

  if (parseNum(s.principal) > 0) set('principal', formatThousands(parseNum(s.principal)));
  set('oldRate', s.oldRate); set('oldTerm', s.oldTerm);

  document.getElementById('customPlafon').checked = !!s.customPlafon;
  document.getElementById('plafonField').classList.toggle('hidden', !s.customPlafon);
  if (parseNum(s.oldPlafon) > 0) set('oldPlafon', formatThousands(parseNum(s.oldPlafon)));

  if (s.feeMode === 'persen' || s.feeMode === 'nominal') {
    state.feeMode = s.feeMode;
    document.getElementById('feeMode').value = s.feeMode;
    document.getElementById('feeSuffix').textContent = s.feeMode === 'persen' ? '%' : '';
    set('feeVal', s.feeVal);
  }

    if (parseNum(s.rpcIncome) > 0) set('rpcIncome', formatThousands(parseNum(s.rpcIncome)));
      if (s.rpcDebt != null && s.rpcDebt !== '') set('rpcDebt', formatThousands(parseNum(s.rpcDebt)));
      if (parseNum(s.fixOS) > 0) set('fixOS', formatThousands(parseNum(s.fixOS)));
      set('fixTotal', s.fixTotal); set('fixLeft', s.fixLeft); set('fixRate', s.fixRate); set('floatRate', s.floatRate);

  if (validSteps(s.steps)) {
    state.steps = s.steps.map(x => ({ months: Math.round(+x.months), rate: +x.rate, payment: +x.payment }));
    return true;
  }
  return false;
}
// program dipulihkan setelah programs.csv termuat; tahapan dibangun ulang dari CSV terbaru
function applySavedProgram() {
  if (!_saved || !_saved.program) return;
  const sel = document.getElementById('program');
  sel.value = _saved.program;
  if (sel.value !== _saved.program) { sel.value = ''; return; }  // program sudah dihapus dari CSV
  applyProgram(_saved.tenor);
}
function resetSaved() {
  _stateReady = false;
  try { localStorage.removeItem(STORE_KEY); } catch (e) {}
  location.reload();
}

// ─── Init ───
document.addEventListener('DOMContentLoaded', () => {
  updateThemeIcon();
  const restored = restoreState();
  renderSteps();
  if (!restored) recalcAll();
    updatePrincipalWords();
  updateFeeHint();
  
  ['oldRate', 'oldTerm', 'fixTotal', 'fixLeft', 'fixRate', 'floatRate'].forEach(id => document.getElementById(id).addEventListener('input', scheduleCalc));

  renderMenu();
  window.addEventListener('hashchange', route);
  route();
  loadPrograms().finally(() => {
    applySavedProgram();
    _stateReady = true;
    saveState();
  });
});
