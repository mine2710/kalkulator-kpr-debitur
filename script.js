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
  oldPmtCustom: false,
  fixSyncPlafon: true,
  fixAmortOpen: false,
  fixAmortAll: false,
  userPrincipal: 1000000000,
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
  if (rows.length) rows[rows.length - 1].endBalance = 0;
  if (stepSummaries.length) stepSummaries[stepSummaries.length - 1].endBalance = 0;
  return {
    rows, stepSummaries,
    totalInterest: rows.reduce((a, r) => a + r.interest, 0),
    totalPayments: rows.reduce((a, r) => a + r.payment, 0),
    endingBalance: 0,
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
  const val = parseNum(el.value);
  const fmt = formatThousands(val);
  el.value = fmt; restoreCursor(el, fmt, before);
  if (val > 0 && !(state.mode === 'to-fix' && state.fixSyncPlafon)) {
    state.userPrincipal = val;
  }
  updatePrincipalWords(); updateFeeHint(); recalcAll(); scheduleCalc();
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
let currentTier = 'Bukan Tier 1';

function activeTier() {
  if (state.mode !== 'kpr-baru') {
    return PROGRAMS['Bukan Tier 1'] ? 'Bukan Tier 1' : (Object.keys(PROGRAMS)[0] || 'Bukan Tier 1');
  }
  return currentTier;
}

function currentProgram() {
  const key = document.getElementById('program').value;
  const list = PROGRAMS[activeTier()] || {};
  return key && list[key] ? list[key] : null;
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
function parseProgramsJson(items) {
  const res = {};
  if (!Array.isArray(items)) return res;
  items.forEach(row => {
    let segments = [];
    if (Array.isArray(row.segments)) {
      segments = row.segments;
    } else if (typeof row.segments === 'string') {
      segments = row.segments.split('|').map(s => s.split(':').map(Number)).filter(x => x.length === 2 && x[0] > 0 && isFinite(x[1]));
    }
    if (!row.key || !segments.length) return;
    const tier = row.tier || 'no_tier';
    (res[tier] = res[tier] || {})[row.key] = {
      name: row.name || row.key,
      min_months: Number(row.min_months) || 1,
      segments: segments
    };
  });
  return res;
}
async function loadPrograms() {
  const sel = document.getElementById('program'), hint = document.getElementById('programHint');
  let loadedFromApi = false;
  let tieringLoadedFromApi = false;

  const urlParams = new URLSearchParams(window.location.search);
  const forceCsv = urlParams.get('source') === 'csv';

  const endpoint = window.KPRConfig && typeof window.KPRConfig.getApiEndpoint === 'function' ? window.KPRConfig.getApiEndpoint() : '';
  const token = window.KPRConfig && typeof window.KPRConfig.getApiToken === 'function' ? window.KPRConfig.getApiToken() : '';

  // 1. Coba muat data via HTTP POST dengan Token di dalam amplop (Body payload)
  if (endpoint && !endpoint.includes('GANTI_DENGAN_DEPLOYMENT_ID_ANDA') && !forceCsv) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ token: token, type: 'kpr' })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'error' || data.error) {
          console.warn('Otorisasi POST API ditolak oleh Google Apps Script:', data.message);
        } else {
          if (data && Array.isArray(data.programs) && data.programs.length) {
            PROGRAMS = parseProgramsJson(data.programs);
            loadedFromApi = true;
            console.log(`Database program KPR berhasil dimuat via POST dari Google Spreadsheet (${data.programs.length} program).`);
          }
          if (data && Array.isArray(data.tiering) && data.tiering.length) {
            if (typeof window !== 'undefined') window._cachedApiTiering = data.tiering;
            if (typeof setDinTiers === 'function') {
              setDinTiers(data.tiering);
              tieringLoadedFromApi = true;
              console.log(`Database tiering KPR Dinamis berhasil dimuat via POST (${data.tiering.length} tier).`);
            }
          }
        }
      }
    } catch (apiErr) {
      console.warn('Gagal memuat via POST dari Google Spreadsheet, beralih ke cadangan lokal:', apiErr);
    }
  }

  // 2. Fallback cadangan ke file programs.csv lokal jika belum dimuat dari API
  if (!loadedFromApi) {
    try {
      const r = await fetch('programs.csv', { cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      PROGRAMS = parseProgramsCsv(await r.text());
      console.log('Database program KPR dimuat dari cadangan lokal (programs.csv).');
    } catch (e) {
      console.error(e);
      hint.textContent = 'Data program KPR belum bisa dimuat. Periksa koneksi internet lalu muat ulang halaman, atau isi tahapan bunga secara manual.';
      return;
    }
  }

  // 3. Fallback cadangan ke file tiering.csv lokal jika belum dimuat dari API
  if (!tieringLoadedFromApi) {
    try {
      const rTier = await fetch('tiering.csv', { cache: 'no-cache' });
      if (rTier.ok && typeof parseTieringCsv === 'function') {
        const text = await rTier.text();
        const parsedTiers = parseTieringCsv(text);
        if (parsedTiers && parsedTiers.length && typeof setDinTiers === 'function') {
          setDinTiers(parsedTiers);
          console.log(`Database tiering KPR Dinamis dimuat dari cadangan lokal (tiering.csv, ${parsedTiers.length} tier).`);
        }
      }
    } catch (eTier) {
      console.warn('Gagal memuat tiering.csv lokal:', eTier);
    }
  }

  populateTierDropdown();
  populateProgramDropdown();
  if (typeof populateDinProgram === 'function') populateDinProgram();
}
function populateTierDropdown() {
  const tierSel = document.getElementById('tierSelect');
  const tiers = Object.keys(PROGRAMS);
  if (!tiers.length) return;
  const ordered = ['Bukan Tier 1', 'Tier 1'].filter(t => tiers.includes(t))
    .concat(tiers.filter(t => t !== 'Bukan Tier 1' && t !== 'Tier 1'));
  if (!PROGRAMS[currentTier]) currentTier = ordered[0] || 'Bukan Tier 1';
  if (tierSel) {
    tierSel.innerHTML = '';
    ordered.forEach(t => {
      const o = document.createElement('option');
      o.value = t;
      o.textContent = t;
      tierSel.appendChild(o);
    });
    tierSel.value = currentTier;
  }
}
function populateProgramDropdown(preserveKey) {
  const sel = document.getElementById('program');
  if (!sel) return;
  const prevKey = preserveKey !== undefined ? preserveKey : sel.value;
  sel.innerHTML = '<option value="">Manual (custom)</option>';
  const list = PROGRAMS[activeTier()] || {};
  Object.keys(list).forEach(k => {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = list[k].name;
    sel.appendChild(o);
  });
  if (prevKey && list[prevKey]) sel.value = prevKey;
  else sel.value = '';
}
function syncProgramDropdownForMode() {
  if (!Object.keys(PROGRAMS).length) return;
  const sel = document.getElementById('program');
  const prevKey = sel ? sel.value : '';
  populateProgramDropdown(prevKey);
  if (sel && sel.value !== prevKey) {
    updateProgramHint();
  }
}
function onTierChange() {
  if (state.mode !== 'kpr-baru') return;
  const tierSel = document.getElementById('tierSelect');
  if (!tierSel) return;
  const prevKey = document.getElementById('program').value;
  currentTier = tierSel.value;
  populateProgramDropdown(prevKey);
  const p = currentProgram();
  if (p) {
    const cur = Number(document.getElementById('tenor').value) || state.lastTenor;
    applyProgram(cur > 0 ? cur : programMaxMonths(p));
  } else {
    updateProgramHint();
    saveState();
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
    <div class="bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 border-l-[3px] border-l-bri rounded-lg p-3 transition-all hover:border-l-sky-500">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
          <span class="inline-flex items-center justify-center h-5 w-5 rounded bg-bri text-white text-[11px] font-bold">${i + 1}</span> Tahap ${i + 1}
        </span>
        ${n > 1 ? `<button onclick="removeStep(${i})" class="text-slate-400 hover:text-sky-500 text-sm leading-none transition">✕</button>` : ''}
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
const MODE_ORDER = ['kpr-baru', 'to-float', 'to-fix', 'kpr-dinamis'];
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
    tagline: 'Simulasi pindah KPR dari bank lain ke BRI dengan menghitung amortisasi lengkap dari plafon awal hingga bulan take over untuk memperoleh Sisa OS otomatis.',
    who: ['Debitur KPR di bank lain yang masih dalam masa bunga <b>fix</b>.', 'Ingin membandingkan: pindah ke BRI pada bulan tertentu, atau bertahan hingga terkena bunga floating.'],
    calc: ['<b>① KPR Sebelumnya</b>: amortisasi lengkap dari plafon awal, menghasilkan <b>Saldo Akhir (Sisa OS)</b> tepat di bulan take over.', '<b>② KPR Simulasi Take Over</b>: simulasi KPR BRI dari Sisa OS tersebut.', 'Perbandingan kumulatif pembayaran &amp; titik impas (BEP) dari Sisa OS pada bulan berjalan yang sama.'],
    need: ['Plafon awal, tenor awal total, dan masa bunga fix awal di bank sebelumnya.', 'Bunga fix saat ini, perkiraan bunga floating, dan bulan take over.', 'Tenor &amp; program yang diajukan ke BRI.'],
    ui: { border: 'border-t-bri', borderL: 'border-l-bri', badge: 'bg-blue-50 text-bri dark:bg-slate-700 dark:text-blue-300', dot: 'bg-bri', btn: 'bg-bri hover:bg-bri-dark', tab: 'bg-bri text-white' },
  },
  'kpr-dinamis': {
    short: 'KPR Dinamis', icon: '📉', mainTitle: 'KPR Dinamis',
    title: 'KPR Dinamis (Dana Pengurang Bunga)',
    tagline: 'Simulasi angsuran KPR ketika debitur menempatkan dana (CASA atau Deposito) di BRI sehingga suku bunga kredit berkurang sesuai tabel tiering.',
    who: ['Debitur yang memiliki atau berencana menempatkan dana di BRI selama masa kredit.', 'Ingin melihat seberapa besar bunga dan angsuran turun dari dana yang ditempatkan.'],
    calc: ['<b>Bunga efektif</b> tiap bulan = bunga dasar tahap + pengurang dari dana yang aktif (minimal 0%).', 'Dua metode: <b>Angsuran Tetap</b> (lunas lebih cepat) atau <b>Angsuran Menyesuaikan</b> (angsuran turun tiap bulan).', 'Penghematan bunga dibanding tanpa dana pengurang, serta jadwal angsuran bulanan.'],
    need: ['Plafon kredit dan tahapan suku bunga dasar.', 'Jumlah dana, jenis dana, bulan mulai, dan durasi penempatan tiap variasi.'],
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
// ikon garis (stroke) per program, gaya aplikasi BRI
const MODE_ICONS = {
  'kpr-baru': '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/>',
  'to-float': '<path d="M4 8h13l-3-3"/><path d="M20 16H7l3 3"/>',
  'to-fix': '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  'kpr-dinamis': '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
};
function modeIcon(k, cls) {
  return `<svg class="${cls || 'h-5 w-5'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${MODE_ICONS[k]}</svg>`;
}
function infoIcon(cls) {
  return `<svg class="${cls || 'h-3.5 w-3.5'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>`;
}
function renderTabs() {
  document.getElementById('modeTabs').innerHTML = MODE_ORDER.map(k => {
    const m = MODES[k], on = k === state.mode;
    const tabCls = on
      ? 'bg-bri text-white shadow-sm'
      : 'text-slate-600 dark:text-slate-300 hover:bg-bri-light dark:hover:bg-slate-700';
    const infoCls = on
      ? 'text-white/80 hover:text-white hover:bg-white/15'
      : 'text-slate-400 hover:text-bri dark:hover:text-blue-300 hover:bg-slate-100 dark:hover:bg-slate-600';
    return `<div class="relative">
      <a href="#${k}" ${on ? 'aria-current="page"' : ''} class="flex items-center justify-center gap-1.5 md:gap-2 rounded-xl px-3 sm:px-4 md:px-5 py-2.5 md:py-3 text-xs md:text-sm font-semibold transition ${tabCls}">
        ${modeIcon(k)}<span class="text-center leading-tight">${m.short}</span>
      </a>
      <button type="button" onclick="openInfo('${k}')" aria-label="Info program ${m.short}" title="Info program"
        class="absolute top-1.5 right-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full transition ${infoCls}">${infoIcon()}</button>
    </div>`;
  }).join('');

  const cur = MODES[state.mode];
  const mobileBar = document.getElementById('mobileModeBar');
  if (mobileBar) {
    mobileBar.innerHTML = `
      <div class="flex items-center gap-3 min-w-0">
        <span class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-bri-light dark:bg-blue-900/30 text-bri dark:text-blue-300">
          ${modeIcon(state.mode, 'h-5 w-5')}
        </span>
        <div class="min-w-0">
          <p class="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Program Simulasi</p>
          <h2 class="text-sm font-bold text-slate-800 dark:text-white leading-snug">${cur.title}</h2>
        </div>
      </div>
      <button type="button" onclick="openInfo('${state.mode}')" aria-label="Info program ${cur.short}" title="Info program"
        class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-100 dark:border-slate-600 bg-bri-light/70 dark:bg-slate-700 text-bri dark:text-blue-300 hover:bg-bri hover:text-white active:scale-95 transition">
        ${infoIcon('h-5 w-5')}
      </button>`;
  }

  const bottomNav = document.getElementById('bottomNavItems');
  if (bottomNav) {
    bottomNav.innerHTML = MODE_ORDER.map(k => {
      const m = MODES[k], on = k === state.mode;
      const linkCls = on
        ? 'text-bri dark:text-blue-300 font-bold'
        : 'text-slate-400 dark:text-slate-400 font-medium hover:text-slate-600 dark:hover:text-slate-200';
      const pillCls = on
        ? 'bg-bri-light dark:bg-blue-900/40 text-bri dark:text-blue-300'
        : 'text-current';
      return `<a href="#${k}" ${on ? 'aria-current="page"' : ''}
        class="relative flex flex-col items-center justify-center gap-1 py-2 px-1 text-[11px] leading-tight transition active:scale-95 ${linkCls}">
        ${on ? '<span class="absolute top-0 left-1/2 -translate-x-1/2 h-[3px] w-10 rounded-b-full bg-bri dark:bg-blue-400" aria-hidden="true"></span>' : ''}
        <span class="inline-flex items-center justify-center rounded-xl px-3.5 py-1 transition ${pillCls}">
          ${modeIcon(k, 'h-5 w-5')}
        </span>
        <span class="text-center leading-tight">${m.short}</span>
      </a>`;
    }).join('');
  }
}
// dialog info program (tombol i)
function openInfo(k) {
  const m = MODES[k];
  document.getElementById('infoBody').innerHTML = `
    <div class="flex items-start gap-3 px-5 pt-5 pb-4 text-white rounded-t-2xl" style="background:linear-gradient(135deg,rgb(var(--bri)),rgb(var(--bri-2)))">
      <span class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15">${modeIcon(k)}</span>
      <div class="flex-1">
        <h3 id="infoTitle" class="text-base font-bold leading-tight">${m.title}</h3>
        <p class="mt-1 text-xs text-blue-100">${m.tagline}</p>
      </div>
      <button type="button" onclick="closeInfo()" aria-label="Tutup" class="h-8 w-8 shrink-0 rounded-lg hover:bg-white/15 transition">✕</button>
    </div>
    <div class="space-y-4 px-5 py-5">${infoLists(m)}</div>
    <div class="flex gap-2 px-5 pb-5">
      ${k !== state.mode ? `<a href="#${k}" onclick="closeInfo()" class="flex-1 text-center rounded-xl bg-bri hover:bg-blue-800 px-4 py-2.5 text-sm font-semibold text-white transition">Buka simulasi</a>` : ''}
      <button type="button" onclick="closeInfo()" class="flex-1 rounded-xl border border-slate-200 dark:border-slate-600 px-4 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition">Tutup</button>
    </div>`;
  const d = document.getElementById('infoDialog');
  if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
}
function closeInfo() {
  const d = document.getElementById('infoDialog');
  if (typeof d.close === 'function') d.close(); else d.removeAttribute('open');
}
// URL hash menentukan program: #kpr-baru (default), #to-float, #to-fix
function syncPrincipalInputState() {
  const pEl = document.getElementById('principal');
  if (!pEl) return;
  const locked = state.mode === 'to-fix' && state.fixSyncPlafon;
  pEl.readOnly = locked;
  pEl.classList.toggle('opacity-80', locked);
  pEl.classList.toggle('cursor-not-allowed', locked);
}

function route(fromHashChange) {
  const prevMode = state.mode;
  const h = location.hash.replace('#', '');
  state.mode = MODES[h] ? h : 'kpr-baru';
  renderTabs();
  document.querySelectorAll('[data-modes]').forEach(el => el.classList.toggle('hidden', !el.dataset.modes.split(' ').includes(state.mode)));
  document.getElementById('mainCardTitle').textContent = MODES[state.mode].mainTitle;
  syncPrincipalInputState();
  syncProgramDropdownForMode();
  if (prevMode === 'to-fix' && state.mode !== 'to-fix' && state.fixSyncPlafon && state.userPrincipal > 0) {
    const pEl = document.getElementById('principal');
    pEl.value = formatThousands(state.userPrincipal);
    updatePrincipalWords();
    updateFeeHint();
    recalcAll();
  }
  if (fromHashChange === true && window.innerWidth < 768) {
    const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    window.scrollTo({ top: 0, behavior });
  }
  try { calculate(); } catch (e) { console.error(e); }
}

// ─── RPC: cek kemampuan bayar (KPR Baru) ───
// rasio maksimal angsuran terhadap pendapatan: <15jt 50%, 15–25jt 55%, >25jt 60%
let _rpcCustomEdited = false;

function rpcRatio(income) { return income < 15e6 ? 0.50 : income <= 25e6 ? 0.55 : 0.60; }

function onRpcInputChange() {
  _rpcCustomEdited = false;
  syncRpcMaxField();
}

function onRpcMaxCustomInput() {
  _rpcCustomEdited = true;
}

function syncRpcMaxField() {
  const maxEl = document.getElementById('rpcMaxInstallment');
  if (!maxEl) return;
  if (_rpcCustomEdited && parseNum(maxEl.value) > 0) return;
  const income = parseNum(document.getElementById('rpcIncome').value);
  const debt = parseNum(document.getElementById('rpcDebt').value);
  if (income > 0) {
    const ratio = rpcRatio(income);
    const maxAng = income * ratio;
    const sisaBank = Math.max(0, Math.round(maxAng - debt));
    maxEl.value = formatThousands(sisaBank);
  }
}

function renderRpc(sim) {
  const el = document.getElementById('rpcResult');
  syncRpcMaxField();

  const income = parseNum(document.getElementById('rpcIncome').value);
  const debt = parseNum(document.getElementById('rpcDebt').value);
  const maxCustomEl = document.getElementById('rpcMaxInstallment');
  const customVal = maxCustomEl ? parseNum(maxCustomEl.value) : 0;

  const ratio = rpcRatio(income);
  const maxAng = income * ratio;
  const sisaBank = Math.max(0, maxAng - debt);
  const limitToUse = customVal > 0 ? customVal : sisaBank;

  if (limitToUse <= 0 && income <= 0) {
    el.innerHTML = '<p class="text-xs text-slate-400 dark:text-slate-500">Isi pendapatan per bulan atau maksimal angsuran untuk melihat kemampuan bayar.</p>';
    return;
  }

  const multi = sim.stepSummaries.length > 1;
  const pmt = sim.stepSummaries[0] ? sim.stepSummaries[0].payment : 0;
  const peak = Math.max(0, ...sim.stepSummaries.map(s => s.payment));
  const ok = limitToUse >= pmt;

  const cls = ok
    ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/40'
    : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900/40';
  const msg = ok
    ? `✅ <b>Mampu bayar</b> — Angsuran KPR (${fmtMoney(Math.round(pmt))}/bln) masih di bawah batas maksimal angsuran (${fmtMoney(Math.round(limitToUse))}/bln).`
    : `⚠️ <b>Belum mampu bayar</b> — Angsuran KPR (${fmtMoney(Math.round(pmt))}/bln) melebihi batas maksimal angsuran (${fmtMoney(Math.round(limitToUse))}/bln). Coba perpanjang tenor atau kurangi plafon.`;
  const note = ok && peak > limitToUse
    ? `<p class="mt-1.5 text-[11px] opacity-90">Catatan: angsuran tahap berikutnya naik hingga <b>${fmtMoney(Math.round(peak))}/bln</b>, melebihi batas maksimal angsuran.</p>` : '';

  el.innerHTML = `
    <div class="rounded-xl border border-sky-100 dark:border-sky-900/40 bg-sky-50/50 dark:bg-sky-900/10 px-3.5 py-2.5 flex items-center justify-between">
      <span class="text-xs font-semibold text-slate-600 dark:text-slate-300">Maksimal Angsuran</span>
      <span class="num text-sm font-bold text-bri dark:text-blue-300">${fmtMoney(Math.round(limitToUse))} /bln</span>
    </div>
    <div role="status" class="mt-2.5 rounded-xl border px-3.5 py-3 text-xs leading-relaxed font-medium ${cls}">${msg}${note}</div>`;
}

// ─── Take Over Fix: amortisasi lengkap dari plafon awal → Saldo Akhir bulan take over (Sisa OS) ───
let _lastFixFx = null;

function readFixInputs() {
  const plafonAwal = parseNum(document.getElementById('fixOS').value);
  const total = Math.max(2, Math.round(Number(document.getElementById('fixTotal').value) || 240));
  const fixRaw = Math.max(0, Math.round(Number(document.getElementById('fixLeft').value) || 0));
  const fixMonths = Math.min(total, fixRaw);
  const toRawEl = document.getElementById('fixTakeoverMonth');
  const toRaw = toRawEl ? Math.max(1, Math.round(Number(toRawEl.value) || 1)) : 1;
  const toMonth = Math.min(Math.max(1, toRaw), total - 1);
  return {
    plafonAwal,
    total,
    fixRaw,
    fixMonths,
    toRaw,
    toMonth,
    rFix: Number(document.getElementById('fixRate').value) || 0,
    rFloat: Number(document.getElementById('floatRate').value) || 0,
  };
}

function buildFixSchedule() {
  const f = readFixInputs();
  const floatAwalMonths = f.total - f.fixMonths;
  const fullSteps = [];
  let fixPmt = 0, floatPmt = 0, bal = f.plafonAwal;

  if (f.fixMonths > 0) {
    fixPmt = Math.round(standardPayment(f.plafonAwal, f.rFix / 1200, f.total));
    fullSteps.push({ months: f.fixMonths, rate: f.rFix, payment: fixPmt });
    for (let m = 0; m < f.fixMonths; m++) {
      bal -= fixPmt - bal * (f.rFix / 1200);
    }
  }
  if (floatAwalMonths > 0) {
    floatPmt = Math.round(standardPayment(Math.max(0, bal), f.rFloat / 1200, floatAwalMonths));
    fullSteps.push({ months: floatAwalMonths, rate: f.rFloat, payment: floatPmt });
  }

  const fullSim = simulateFull(f.plafonAwal, fullSteps);
  const toRow = fullSim.rows[f.toMonth - 1];
  const sisaOS = toRow ? Math.max(0, Math.round(toRow.endBalance)) : f.plafonAwal;
  const remRows = fullSim.rows.slice(f.toMonth);
  const sisaTenor = remRows.length;
  const sisaFix = Math.max(0, f.fixMonths - f.toMonth);
  const sisaFloat = Math.max(0, sisaTenor - sisaFix);
  const curPmt = sisaFix > 0 ? fixPmt : floatPmt;
  const remTotalBunga = remRows.reduce((acc, r) => acc + r.interest, 0);

  return {
    f,
    fixPmt,
    floatPmt,
    curPmt,
    sisaOS,
    sisaTenor,
    sisaFix,
    sisaFloat,
    fullSim,
    remRows,
    remTotalBunga,
  };
}

function toggleFixAmort() {
  state.fixAmortOpen = !state.fixAmortOpen;
  if (_lastFixFx) renderFixOutputs(_lastFixFx);
}

function showAllFixAmort() {
  state.fixAmortAll = true;
  if (_lastFixFx) renderFixOutputs(_lastFixFx);
}

function onFixSyncPlafonChange() {
  const cb = document.getElementById('fixSyncPlafon');
  state.fixSyncPlafon = !!(cb && cb.checked);
  syncPrincipalInputState();
  if (!state.fixSyncPlafon) {
    state.userPrincipal = parseNum(document.getElementById('principal').value) || state.userPrincipal;
  }
  scheduleCalc();
}

function renderFixOutputs(fx) {
  _lastFixFx = fx;
  const f = fx.f;
  const hints = [];
  if (f.fixRaw > f.total) hints.push('Masa fix awal melebihi tenor awal, disesuaikan menjadi ' + f.total + ' bln.');
  if (f.toRaw >= f.total) hints.push('Bulan take over dibatasi maksimal bulan ke-' + (f.total - 1) + '.');
  document.getElementById('fixHint').textContent = hints.join(' ');

  const row = (l, v, sub) => `<div class="flex items-center justify-between gap-2 py-2 border-b last:border-b-0 border-sky-100 dark:border-sky-900/40">
    <span class="text-xs text-slate-500 dark:text-slate-400 leading-snug">${l}${sub ? `<span class="block text-[10px] text-slate-400 dark:text-slate-500">${sub}</span>` : ''}</span>
    <span class="num text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100 text-right whitespace-nowrap shrink-0">${v}</span></div>`;

  let amortHtml = '';
  if (state.fixAmortOpen) {
    const allRows = fx.fullSim.rows;
    let displayRows = allRows;
    let slicedNote = '';
    if (!state.fixAmortAll && allRows.length > 36) {
      const startIdx = Math.max(0, f.toMonth - 6);
      const endIdx = Math.min(allRows.length, startIdx + 18);
      displayRows = allRows.slice(startIdx, endIdx);
      slicedNote = `<div class="p-2 text-center border-t border-slate-100 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800">
        <button type="button" onclick="showAllFixAmort()" class="text-[11px] font-semibold text-bri dark:text-blue-300 hover:underline">Tampilkan seluruh ${allRows.length} bulan amortisasi</button>
      </div>`;
    }
    const trs = displayRows.map(r => {
      const isTO = r.month === f.toMonth;
      const trCls = isTO
        ? 'bg-amber-100/80 dark:bg-amber-900/40 font-bold text-amber-900 dark:text-amber-200'
        : 'hover:bg-sky-50/60 dark:hover:bg-slate-700/50';
      return `<tr class="${trCls}">
        <td class="px-2 py-1.5 border-t border-slate-100 dark:border-slate-700 whitespace-nowrap">${r.month}${isTO ? ' ★' : ''}</td>
        <td class="px-2 py-1.5 border-t border-slate-100 dark:border-slate-700 whitespace-nowrap">${fmtMoney(Math.round(r.payment))}</td>
        <td class="px-2 py-1.5 border-t border-slate-100 dark:border-slate-700 whitespace-nowrap">${fmtMoney(Math.round(r.interest))}</td>
        <td class="px-2 py-1.5 border-t border-slate-100 dark:border-slate-700 whitespace-nowrap font-semibold">${fmtMoney(Math.round(r.endBalance))}</td>
      </tr>`;
    }).join('');
    amortHtml = `
      <div class="mt-2 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-800">
        <div class="px-3 py-1.5 bg-slate-50 dark:bg-slate-700/60 text-[10px] text-slate-500 dark:text-slate-300 flex items-center justify-between">
          <span>★ Bulan ke-${f.toMonth} = Bulan Take Over (Sisa OS)</span>
          <span>Total ${allRows.length} bln</span>
        </div>
        <div class="max-h-56 overflow-auto">
          <table class="num w-full text-left text-[11px] text-slate-600 dark:text-slate-300">
            <thead class="sticky top-0 bg-slate-100 dark:bg-slate-700 text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-300">
              <tr><th class="px-2 py-1.5">Bln</th><th class="px-2 py-1.5">Angsuran</th><th class="px-2 py-1.5">Bunga</th><th class="px-2 py-1.5">Saldo Akhir</th></tr>
            </thead>
            <tbody>${trs}</tbody>
          </table>
        </div>
        ${slicedNote}
      </div>`;
  }

  document.getElementById('fixOutputs').innerHTML = `
    <div class="rounded-xl bg-amber-50/90 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 px-3.5 py-3">
      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">Saldo Akhir Bulan ke-${f.toMonth} (Sisa OS)</span>
        <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200">Sisa ${fx.sisaTenor} bln</span>
      </div>
      <p class="num text-lg font-extrabold text-slate-900 dark:text-white mt-0.5">${fmtMoney(fx.sisaOS)}</p>
      <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Sisa masa fix: <b>${fx.sisaFix} bln</b> · Masa float: <b>${fx.sisaFloat} bln</b></p>
    </div>
    <div class="rounded-xl border border-sky-100 dark:border-sky-900/40 bg-sky-50/50 dark:bg-sky-900/10 px-3.5 py-1">
      ${row('Angsuran masa fix', fx.fixPmt > 0 ? fmtMoney(fx.fixPmt) + ' /bln' : '—', f.fixMonths > 0 ? 'Bunga ' + fmtPct(f.rFix) + ' (bln 1–' + f.fixMonths + ')' : 'Tanpa masa fix')}
      ${row('Angsuran masa float', fx.sisaFloat > 0 ? fmtMoney(fx.floatPmt) + ' /bln' : '—', fx.sisaFloat > 0 ? 'Bunga ' + fmtPct(f.rFloat) + ' (mulai bln ke-' + (f.fixMonths + 1) + ')' : '')}
    </div>
    <button type="button" onclick="toggleFixAmort()"
      class="w-full flex items-center justify-between px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-semibold text-bri dark:text-blue-300 transition">
      <span>${state.fixAmortOpen ? 'Sembunyikan' : 'Lihat'} Tabel Amortisasi KPR Sebelumnya</span>
      <span>${state.fixAmortOpen ? '▲' : '▼'}</span>
    </button>
    ${amortHtml}`;
}

function toggleCustomPlafon() {
  scheduleCalc();
}

function syncOldPmtCustomUI() {
  const isCustom = !!state.oldPmtCustom;
  const field = document.getElementById('oldCustomPmtField');
  const btnMatch = document.getElementById('btnOldPmtMatch');
  const btnCustom = document.getElementById('btnOldPmtCustom');
  if (field) field.classList.toggle('hidden', !isCustom);
  const activeCls = 'px-2.5 py-1 rounded-md bg-white dark:bg-slate-800 text-bri dark:text-blue-300 shadow-sm transition';
  const idleCls = 'px-2.5 py-1 rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition';
  if (btnMatch) btnMatch.className = isCustom ? idleCls : activeCls;
  if (btnCustom) btnCustom.className = isCustom ? activeCls : idleCls;
}

function setOldPmtCustom(isCustom) {
  state.oldPmtCustom = !!isCustom;
  syncOldPmtCustomUI();
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
function buildOldSchedule(principal, prebuiltFx) {
  if (state.mode === 'to-fix') {
    const fx = prebuiltFx || buildFixSchedule();
    const saldo = [fx.sisaOS];
    fx.remRows.forEach(r => saldo.push(Math.max(0, r.endBalance)));
    return {
      principal: fx.sisaOS,
      months: fx.sisaTenor,
      payments: fx.remRows.map(r => r.payment),
      saldo,
      totalBunga: fx.remTotalBunga,
      firstPmt: fx.curPmt,
      fx,
    };
  }
  // Take Over Float: bunga float tunggal sepanjang sisa tenor
  const oldPlafonEl = document.getElementById('oldPlafon');
  const oldPrincipal = (oldPlafonEl && parseNum(oldPlafonEl.value) > 0) ? parseNum(oldPlafonEl.value) : principal;
  const oldRate = Number(document.getElementById('oldRate').value) || 0;
  const oldMonths = Math.max(1, Math.round(Number(document.getElementById('oldTerm').value) || 1));
  const a = amortizeSingle(oldPrincipal, oldRate, oldMonths);

  const calcDisp = document.getElementById('oldCalcPmtDisplay');
  if (calcDisp) calcDisp.textContent = fmtMoney(Math.round(a.pmt)) + ' /bln';

  const customPmtEl = document.getElementById('oldCustomPmt');
  const customPmtVal = state.oldPmtCustom && customPmtEl ? parseNum(customPmtEl.value) : 0;
  if (customPmtVal > 0) {
    const r = (oldRate || 0) / 100 / 12;
    const saldo = [oldPrincipal];
    let bal = oldPrincipal;
    for (let i = 0; i < oldMonths; i++) {
      const interest = bal * r;
      bal = Math.max(0, bal - (customPmtVal - interest));
      saldo.push(bal);
    }
    return {
      principal: oldPrincipal,
      months: oldMonths,
      payments: new Array(oldMonths).fill(customPmtVal),
      saldo,
      totalBunga: Math.max(0, customPmtVal * oldMonths - oldPrincipal),
      firstPmt: customPmtVal,
    };
  }

  return {
    principal: oldPrincipal,
    months: oldMonths,
    payments: new Array(oldMonths).fill(a.pmt),
    saldo: a.saldo,
    totalBunga: a.totalBunga,
    firstPmt: a.pmt,
  };
}
function computeTakeover(principal, sim, prebuiltFx) {
  const old = buildOldSchedule(principal, prebuiltFx);
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
  if (state.mode === 'kpr-dinamis') { if (typeof calcDinamis === 'function') calcDinamis(); return; }
  const s = sym();
  document.getElementById('curr1').textContent = s;
  document.getElementById('curr2').textContent = s;

  let prebuiltFx = null;
  if (state.mode === 'to-fix') {
    prebuiltFx = buildFixSchedule();
    renderFixOutputs(prebuiltFx);
    if (state.fixSyncPlafon && prebuiltFx.sisaOS > 0) {
      const pEl = document.getElementById('principal');
      const curP = parseNum(pEl.value);
      if (curP !== prebuiltFx.sisaOS) {
        pEl.value = formatThousands(prebuiltFx.sisaOS);
        updatePrincipalWords();
        updateFeeHint();
        recalcAll();
      }
    }
  }

  const principal = parseNum(document.getElementById('principal').value);
  if (principal <= 0) return;

  const cleanSteps = state.steps.map(st => ({ months: Math.max(1, Math.round(st.months)), rate: st.rate || 0, payment: st.payment || 0 }));
  const sim = simulateFull(principal, cleanSteps);

  const cashflows = [-principal];
  sim.rows.forEach((row, i) => { cashflows.push(row.payment + (i === sim.rows.length - 1 ? sim.endingBalance : 0)); });
  const mIRR = solveMonthlyIRR(cashflows);
  sim.irrNominal = mIRR !== null ? mIRR * 12 * 100 : null;
  sim.irrEfektif = mIRR !== null ? (Math.pow(1 + mIRR, 12) - 1) * 100 : null;

  const to = state.mode !== 'kpr-baru' ? computeTakeover(principal, sim, prebuiltFx) : null;
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
    <div class="relative overflow-hidden rounded-2xl p-5 text-white shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5" style="background:linear-gradient(135deg,rgb(var(--bri-2)),rgb(var(--bri)))">
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
      <div class="${whiteCard} flex flex-col justify-between">
        <div>
          <p class="text-slate-500 dark:text-slate-400 text-xs font-semibold mb-1">Total Pembayaran</p>
          <h3 class="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-1 num">${fmtCompact(sim.totalPayments)}</h3>
        </div>
        <p class="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">Pokok <span class="font-semibold text-slate-700 dark:text-slate-200">${fmtCompact(principal)}</span> + Bunga <span class="font-semibold text-bri dark:text-blue-300">${fmtCompact(sim.totalInterest)}</span></p>
      </div>
      <div class="${whiteCard} flex flex-col justify-between">
        <div>
          <p class="text-slate-500 dark:text-slate-400 text-xs font-semibold mb-1">Total Bunga</p>
          <h3 class="text-2xl font-bold text-bri dark:text-blue-300 mb-1 num">${fmtCompact(sim.totalInterest)}</h3>
        </div>
        <p class="text-[11px] text-slate-400 dark:text-slate-500">Akumulasi selama ${sim.totalMonths} bulan</p>
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
// warna palet BRI dari variabel CSS (ikut mode cerah/gelap)
function briColor(name, alpha) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '8 87 195';
  return alpha === undefined ? `rgb(${v})` : `rgb(${v} / ${alpha})`;
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
  const totalBayarVal = to ? (sim.totalPayments + to.fee) : sim.totalPayments;
  const totalBayarSub = to
    ? ('Sudah termasuk Biaya Tambahan Take Over (' + fmtCompact(to.fee) + ')')
    : ('Pokok ' + fmtCompact(principal) + ' + Bunga ' + fmtCompact(sim.totalInterest));
  let html = metricSection(to ? 'Skema Take Over (Setelah Take Over)' : 'Skema KPR', 'bg-bri',
    bigCell('Total Jangka Waktu', sim.totalMonths + ' bln', Object.assign({ sub: monthsToText(sim.totalMonths) }, blue)) +
    bigCell('Total Pembayaran', fmtMoney(Math.round(totalBayarVal)), Object.assign({ sub: totalBayarSub }, blue)) +
    bigCell('Total Bunga', fmtMoney(Math.round(sim.totalInterest)), blue) +
    bigCell(multi ? 'Angsuran (Tahap 1)' : 'Angsuran', fmtMoney(Math.round(firstPmt)) + ' /bln', Object.assign({ sub: multi ? 'Tahap akhir ' + fmtMoney(Math.round(lastPmt)) + ' /bln' : '' }, blue)));

  if (to) {
        // 2) Skema sebelumnya (before)
    html += metricSection('Skema Sebelumnya (Sebelum Take Over)', 'bg-briorange',
      bigCell('Total Jangka Waktu Sebelum', to.oldMonths + ' bln', Object.assign({ sub: monthsToText(to.oldMonths) }, org)) +
      bigCell('Total Pembayaran Sebelum', fmtMoney(Math.round(to.oldTotal)), org) +
      bigCell('Total Bunga Sebelum', fmtMoney(Math.round(to.oldTotalBunga)), org) +
      bigCell('Angsuran Sebelum', fmtMoney(Math.round(to.oldPmt)) + ' /bln', Object.assign({ sub: 'Sisa OS ' + fmtCompact(to.oldPrincipal) }, org)));

    // 3) Perbandingan
    const selPmt = to.oldPmt - firstPmt;
    const pmtGood = selPmt >= 0;
    const effGood = to.efisiensi >= 0;
    const good = { bg: 'bg-emerald-50 dark:bg-emerald-900/20', lc: 'text-emerald-600 dark:text-emerald-300', vc: 'text-emerald-600 dark:text-emerald-300', sc: 'text-slate-500 dark:text-slate-400' };
    const bad = { bg: 'bg-amber-50 dark:bg-amber-900/20', lc: 'text-amber-600 dark:text-amber-300', vc: 'text-amber-600 dark:text-amber-300', sc: 'text-slate-500 dark:text-slate-400' };
    html += metricSection('Perbandingan Take Over', 'bg-emerald-500',
    bigCell('Kondisi Angsuran (vs Skema Sebelumnya)', (pmtGood ? '▼ ' : '▲ ') + fmtMoney(Math.round(Math.abs(selPmt))) + ' /bln',
    Object.assign({ sub: (pmtGood ? 'Angsuran lebih ringan' : 'Angsuran lebih tinggi di awal') + (multi ? ' (acuan Tahap 1)' : '') }, pmtGood ? good : bad)) +
    bigCell('Selisih Total Dibayar', (effGood ? 'Hemat ' : 'Lebih ') + fmtMoney(Math.round(Math.abs(to.efisiensi))),
    Object.assign({ sub: 'Selisih total skema sebelumnya dengan take over, termasuk biaya tambahan take over ' + fmtCompact(to.fee) }, effGood ? good : bad)),
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
  html += `<div class="hidden pt-4 border-t border-slate-100 dark:border-slate-700">
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
function toggleChartDataset(idx, visible) {
  if (!kumulatifChart || !kumulatifChart.data.datasets[idx]) return;
  kumulatifChart.setDatasetVisibility(idx, visible);
  syncTogglePillStyle(idx, visible);
  kumulatifChart.update();
}

function syncTogglePillStyle(idx, visible) {
  const ids = ['toggleTotal', 'togglePokok', 'toggleBunga'];
  const cb = document.getElementById(ids[idx]);
  if (!cb || !cb.parentElement) return;
  cb.parentElement.classList.toggle('opacity-50', !visible);
}

function renderCharts(sim, to) {
  const balBaru = [parseNum(document.getElementById('principal').value)];
  sim.rows.forEach(r => balBaru.push(Math.max(0, r.endBalance)));

  const dsSaldo = [{ label: to ? 'Saldo Take Over' : 'Saldo Pokok', data: downsample(balBaru, 220), borderColor: briColor('--bri'), backgroundColor: briColor('--bri-sky', 0.16), borderWidth: 2, fill: true, tension: 0.2, pointRadius: 0, pointHoverRadius: 4 }];
  let dsKum = [];
  let annos = {};

  if (to) {
    dsSaldo.push({ label: 'Saldo Sebelumnya', data: downsample(to.oldSaldo, 220), borderColor: '#F58220', borderDash: [5, 4], borderWidth: 2, fill: false, tension: 0.2, pointRadius: 0, pointHoverRadius: 4 });
    dsKum = [
      { label: 'Kumulatif Take Over', data: downsample(to.cumNew, 220), borderColor: briColor('--bri'), backgroundColor: briColor('--bri-sky', 0.14), borderWidth: 2, fill: true, tension: 0.2, pointRadius: 0, pointHoverRadius: 4 },
      { label: 'Kumulatif Sebelumnya', data: downsample(to.cumOld, 220), borderColor: '#F58220', borderDash: [5, 4], borderWidth: 2, fill: false, tension: 0.2, pointRadius: 0, pointHoverRadius: 4 },
    ];
    if (to.meets.length) {
      to.meets.forEach((mp, idx) => {
        const x = Math.round(mp);
        annos['bep' + idx] = { type: 'line', xMin: x, xMax: x, borderColor: '#94a3b8', borderWidth: 1.5, borderDash: [6, 4], label: { display: true, content: to.meets.length > 1 ? 'BEP ' + (idx + 1) : 'BEP', position: idx % 2 ? 'end' : 'start', backgroundColor: 'rgba(100,116,139,0.9)', color: '#fff', font: { size: 10 } } };
      });
    }
  } else {
    const cumTotal = [0], cumPokok = [0], cumBunga = [0];
    let runT = 0, runP = 0, runB = 0;
    sim.rows.forEach(r => {
      runT += r.payment; cumTotal.push(runT);
      runP += r.principal; cumPokok.push(runP);
      runB += r.interest; cumBunga.push(runB);
    });
    const showTotal = document.getElementById('toggleTotal') ? document.getElementById('toggleTotal').checked : true;
    const showPokok = document.getElementById('togglePokok') ? document.getElementById('togglePokok').checked : true;
    const showBunga = document.getElementById('toggleBunga') ? document.getElementById('toggleBunga').checked : true;
    syncTogglePillStyle(0, showTotal);
    syncTogglePillStyle(1, showPokok);
    syncTogglePillStyle(2, showBunga);

    dsKum = [
      { label: 'Total Pembayaran (Pokok + Bunga)', data: downsample(cumTotal, 220), borderColor: briColor('--bri'), backgroundColor: briColor('--bri-sky', 0.14), borderWidth: 2.5, fill: true, tension: 0.2, pointRadius: 0, pointHoverRadius: 4, hidden: !showTotal },
      { label: 'Kumulatif Pokok', data: downsample(cumPokok, 220), borderColor: '#059669', backgroundColor: 'rgba(5,150,105,0.05)', borderWidth: 2, fill: false, tension: 0.2, pointRadius: 0, pointHoverRadius: 4, hidden: !showPokok },
      { label: 'Kumulatif Bunga', data: downsample(cumBunga, 220), borderColor: '#F58220', backgroundColor: 'rgba(245,130,32,0.05)', borderWidth: 2, borderDash: [5, 4], fill: false, tension: 0.2, pointRadius: 0, pointHoverRadius: 4, hidden: !showBunga },
    ];
  }

  const dark = isDark();
  const tickColor = dark ? '#94a3b8' : '#64748b';
  const gridColor = dark ? 'rgba(148,163,184,0.14)' : '#eef2f7';
  const legendColor = dark ? '#cbd5e1' : '#475569';

  const baseOpts = (withAnno) => ({
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    animation: { duration: 400 },
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: { boxWidth: 12, padding: 14, font: { size: 11 }, color: legendColor, usePointStyle: true },
        onClick: (e, legendItem, legend) => {
          const idx = legendItem.datasetIndex;
          const ci = legend.chart;
          const nextVisible = !ci.isDatasetVisible(idx);
          ci.setDatasetVisibility(idx, nextVisible);
          ci.update();
          if (!to) {
            const ids = ['toggleTotal', 'togglePokok', 'toggleBunga'];
            const cb = document.getElementById(ids[idx]);
            if (cb) { cb.checked = nextVisible; syncTogglePillStyle(idx, nextVisible); }
          }
        },
      },
      tooltip: { callbacks: { title: (it) => 'Bulan ' + it[0].parsed.x, label: (it) => it.dataset.label + ': ' + fmtMoney(it.parsed.y) } },
      annotation: { annotations: withAnno ? annos : {} },
    },
    scales: {
      x: { type: 'linear', ticks: { color: tickColor, font: { size: 10 }, maxTicksLimit: 8 }, grid: { color: gridColor }, title: { display: true, text: 'Bulan', color: tickColor, font: { size: 10 } } },
      y: { beginAtZero: true, ticks: { color: tickColor, font: { size: 10 }, maxTicksLimit: 6, callback: (v) => fmtCompact(v) }, grid: { color: gridColor } },
    },
  });

  const saldoEl = document.getElementById('saldoChart');
  if (saldoChart) { saldoChart.data.datasets = dsSaldo; saldoChart.options = baseOpts(false); saldoChart.update(); }
  else if (saldoEl) { saldoChart = new Chart(saldoEl, { type: 'line', data: { datasets: dsSaldo }, options: baseOpts(false) }); }
  if (kumulatifChart) {
    kumulatifChart.data.datasets = dsKum;
    kumulatifChart.options = baseOpts(true);
    dsKum.forEach((d, idx) => kumulatifChart.setDatasetVisibility(idx, !d.hidden));
    kumulatifChart.update();
  } else {
    kumulatifChart = new Chart(document.getElementById('kumulatifChart'), { type: 'line', data: { datasets: dsKum }, options: baseOpts(true) });
  }
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
      <td class="px-3 py-2.5 border-t border-slate-200 dark:border-slate-600">${fmtMoney(0)}</td>
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
      principal: v('principal'), tier: currentTier, program: v('program'), tenor: v('tenor'),
      steps: state.steps,
            oldRate: v('oldRate'), oldTerm: v('oldTerm'),
                  oldPlafon: v('oldPlafon'), oldPmtCustom: !!state.oldPmtCustom, oldCustomPmt: v('oldCustomPmt'),
                  rpcIncome: v('rpcIncome'), rpcDebt: v('rpcDebt'), rpcMaxInstallment: v('rpcMaxInstallment'),
                  fixOS: v('fixOS'), fixTotal: v('fixTotal'), fixLeft: v('fixLeft'), fixRate: v('fixRate'), floatRate: v('floatRate'), fixTakeoverMonth: v('fixTakeoverMonth'), fixSyncPlafon: !!state.fixSyncPlafon, userPrincipal: state.userPrincipal,

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

  if (parseNum(s.principal) > 0) {
    set('principal', formatThousands(parseNum(s.principal)));
    state.userPrincipal = parseNum(s.userPrincipal) || parseNum(s.principal);
  }
  set('oldRate', s.oldRate); set('oldTerm', s.oldTerm);


  if (parseNum(s.oldPlafon) > 0) set('oldPlafon', formatThousands(parseNum(s.oldPlafon)));
  state.oldPmtCustom = !!s.oldPmtCustom;
  if (parseNum(s.oldCustomPmt) > 0) set('oldCustomPmt', formatThousands(parseNum(s.oldCustomPmt)));
  syncOldPmtCustomUI();

  if (s.feeMode === 'persen' || s.feeMode === 'nominal') {
    state.feeMode = s.feeMode;
    document.getElementById('feeMode').value = s.feeMode;
    document.getElementById('feeSuffix').textContent = s.feeMode === 'persen' ? '%' : '';
    set('feeVal', s.feeVal);
  }

    if (s.tier) currentTier = s.tier;
    if (parseNum(s.rpcIncome) > 0) set('rpcIncome', formatThousands(parseNum(s.rpcIncome)));
      if (s.rpcDebt != null && s.rpcDebt !== '') set('rpcDebt', formatThousands(parseNum(s.rpcDebt)));
      if (parseNum(s.rpcMaxInstallment) > 0) {
        set('rpcMaxInstallment', formatThousands(parseNum(s.rpcMaxInstallment)));
        _rpcCustomEdited = true;
      }
      if (parseNum(s.fixOS) > 0) set('fixOS', formatThousands(parseNum(s.fixOS)));
      set('fixTotal', s.fixTotal); set('fixLeft', s.fixLeft); set('fixRate', s.fixRate); set('floatRate', s.floatRate);
      set('fixTakeoverMonth', s.fixTakeoverMonth);
      if (typeof s.fixSyncPlafon === 'boolean') {
        state.fixSyncPlafon = s.fixSyncPlafon;
        const syncEl = document.getElementById('fixSyncPlafon');
        if (syncEl) syncEl.checked = s.fixSyncPlafon;
      }

  if (validSteps(s.steps)) {
    state.steps = s.steps.map(x => ({ months: Math.round(+x.months), rate: +x.rate, payment: +x.payment }));
    return true;
  }
  return false;
}
// program dipulihkan setelah programs.csv termuat; tahapan dibangun ulang dari CSV terbaru
function applySavedProgram() {
  if (!_saved) return;
  if (_saved.tier && PROGRAMS[_saved.tier]) {
    currentTier = _saved.tier;
    const tierSel = document.getElementById('tierSelect');
    if (tierSel) tierSel.value = currentTier;
  }
  populateProgramDropdown();
  if (!_saved.program) return;
  const sel = document.getElementById('program');
  sel.value = _saved.program;
  if (sel.value !== _saved.program) { sel.value = ''; return; }  // program sudah dihapus dari CSV/Sheet
  applyProgram(_saved.tenor);
}
function resetSaved() {
  _stateReady = false;
  try { localStorage.removeItem(STORE_KEY); } catch (e) {}
  if (typeof resetDinamis === 'function') resetDinamis();
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
  
  ['oldRate', 'oldTerm', 'fixTotal', 'fixLeft', 'fixRate', 'floatRate', 'fixTakeoverMonth'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('input', () => { state.fixAmortAll = false; scheduleCalc(); }); });

    // klik di luar dialog info → tutup
  document.getElementById('infoDialog').addEventListener('click', e => { if (e.target.id === 'infoDialog') closeInfo(); });
  window.addEventListener('hashchange', () => route(true));
  route(false);
  loadPrograms().finally(() => {
    applySavedProgram();
    _stateReady = true;
    saveState();
  });
});
