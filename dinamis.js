// ═══════════════════════════════════════════
//  KPR Dinamis — angsuran dengan dana pengurang suku bunga
//  Logika diturunkan dari:
//   • Tambahan/Kalkulator_Angsuran_Dinamis V2.xlsx  → metode "Angsuran Tetap"
//   • Tambahan/Simulasi_Angsuran_KPR DInamis.xlsx   → metode "Angsuran Menyesuaikan"
//  Butuh helper dari script.js (fmtMoney, parseNum, standardPayment, dll).
// ═══════════════════════════════════════════

const DIN_JENIS = ['Tabungan', 'Giro', 'Deposito'];

// Tabel tiering pengurang suku bunga (poin persen).
// Baris: [batas bawah rasio dana/plafon, label, Tabungan, Giro, Deposito]
// SENGAJA KOSONG: datanya TIDAK disimpan di repo. Diisi lewat setDinTiers() dari
// sheet "tiering" di Google Spreadsheet (API Apps Script) saat halaman dimuat.
let DIN_TIERS = [];
const DIN_MAX_STEPS = 10;
const DIN_MAX_VARS = 7;

const DIN_METHODS = {
  tetap: {
    label: 'Angsuran Tetap',
    hint: 'Angsuran dihitung dari bunga dasar dan tetap selama satu tahap. Dana pengurang hanya menurunkan porsi bunga, sehingga pokok terbayar lebih cepat dan kredit bisa lunas sebelum tenor berakhir.',
  },
  adjust: {
    label: 'Angsuran Menyesuaikan',
    hint: 'Angsuran dihitung ulang setiap bulan (anuitas) dari sisa pokok, sisa tenor, dan bunga efektif. Saat dana pengurang aktif, angsuran bulanan langsung turun; tenor tetap sama.',
  },
};

// ─── State ───
const din = {
  ready: false,
  method: 'adjust',
  plafon: 1000000000,
  steps: [{ months: 36, rate: 7 }, { months: 84, rate: 10.5 }],
  vars: [
    { amount: 800000000, jenis: 'Tabungan', start: 1, months: 24 },
    { amount: 600000000, jenis: 'Tabungan', start: 25, months: 24 },
    { amount: 400000000, jenis: 'Tabungan', start: 49, months: 36 },
    { amount: 200000000, jenis: 'Tabungan', start: 85, months: 36 },
  ],
  tierOpen: false,
  amortAll: false,
};
let dinChart = null;
let _dinLast = null;
const DIN_STORE_KEY = 'kpr-dinamis-v1';

// ─── Perhitungan ───
// Pengurang dari tabel tiering. Rasio di bawah tier pertama → tanpa pengurang; di atas tier terakhir → tier terakhir.
function dinTier(ratio, jenis) {
  const col = DIN_JENIS.indexOf(jenis);
  let idx = -1;
  for (let i = 0; i < DIN_TIERS.length; i++) if (ratio + 1e-9 >= DIN_TIERS[i][0]) idx = i;
  if (idx < 0 || col < 0) return { idx: -1, label: '< ' + (DIN_TIERS.length ? Math.round(DIN_TIERS[0][0] * 100) + '%' : '10%'), reduction: 0 };
  return { idx, label: DIN_TIERS[idx][1], reduction: DIN_TIERS[idx][2 + col] };
}

function dinVarInfo(v, plafon) {
  const ratio = plafon > 0 ? v.amount / plafon : 0;
  const t = v.amount > 0 && v.months > 0 ? dinTier(ratio, v.jenis) : { idx: -1, label: '—', reduction: 0 };
  return { ratio, tier: t, end: v.start + v.months - 1 };
}

function dinSimulate(plafon, steps, vars, method, withReduction) {
  const N = steps.reduce((a, s) => a + s.months, 0);
  const stageOf = new Array(N + 1);
  let m0 = 0;
  steps.forEach((s, i) => { for (let k = 0; k < s.months; k++) stageOf[++m0] = i; });

  const active = withReduction ? vars.map(v => ({ ...dinVarInfo(v, plafon), start: v.start })).filter(v => v.tier.reduction < 0) : [];
  const reductionAt = m => active.reduce((a, v) => a + (m >= v.start && m <= v.end ? v.tier.reduction : 0), 0);

  const rows = [];
  let bal = plafon, pmt = 0, prevStage = -1, totalInt = 0, totalPay = 0;
  for (let m = 1; m <= N; m++) {
    if (bal <= 0.5) break;               // sudah lunas (metode Angsuran Tetap)
    const st = stageOf[m];
    const base = steps[st].rate;
    const red = reductionAt(m);
    const eff = Math.max(0, base + red);
    const left = N - m + 1;
    if (method === 'tetap') {
      if (st !== prevStage) pmt = standardPayment(bal, base / 1200, left);
    } else {
      pmt = standardPayment(bal, eff / 1200, left);
    }
    prevStage = st;
    const interest = bal * eff / 1200;
    let pay = pmt, princ = pay - interest;
    if (princ >= bal - 0.5 || m === N) { princ = bal; pay = bal + interest; }  // pelunasan terakhir
    const begin = bal;
    bal = Math.max(0, bal - princ);
    totalInt += interest; totalPay += pay;
    rows.push({ month: m, stage: st + 1, base, red, eff, begin, payment: pay, interest, principal: princ, end: bal });
  }
  return { rows, tenor: N, paidOff: rows.length, totalInterest: totalInt, totalPayment: totalPay };
}

// kelompokkan bulan berurutan dengan tahap & pengurang sama → periode bunga efektif
function dinPeriods(rows) {
  const out = [];
  rows.forEach(r => {
    const last = out[out.length - 1];
    if (last && last.stage === r.stage && Math.abs(last.red - r.red) < 1e-9) {
      last.to = r.month; last.interest += r.interest; last.principal += r.principal; last.payment += r.payment; last.lastPmt = r.payment; last.end = r.end;
    } else {
      out.push({ from: r.month, to: r.month, stage: r.stage, base: r.base, red: r.red, eff: r.eff, firstPmt: r.payment, lastPmt: r.payment, interest: r.interest, principal: r.principal, payment: r.payment, end: r.end });
    }
  });
  return out;
}

// ─── Input handlers ───
function dinNum(v, min, fallback) { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= min ? n : fallback; }

function onDinPlafon(el) {
  formatField(el);
  din.plafon = parseNum(el.value);
  const w = document.getElementById('dinPlafonWords');
  if (w) w.textContent = din.plafon > 0 ? '≈ ' + terbilang(din.plafon) + ' rupiah' : '';
  dinRefreshVarInfo(); dinSchedule();
}
function setDinMethod(m) {
  if (!DIN_METHODS[m]) return;
  din.method = m; dinSyncMethodUI(); dinSchedule();
}
function dinSyncMethodUI() {
  const on = 'flex-1 px-3 py-2 rounded-md bg-white dark:bg-slate-800 text-bri dark:text-blue-300 shadow-sm transition';
  const off = 'flex-1 px-3 py-2 rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition';
  Object.keys(DIN_METHODS).forEach(k => {
    const b = document.getElementById('dinMethod-' + k);
    if (b) { b.className = k === din.method ? on : off; b.setAttribute('aria-pressed', k === din.method); }
  });
  const h = document.getElementById('dinMethodHint');
  if (h) h.textContent = DIN_METHODS[din.method].hint;
}

function updateDinStep(i, key, val) {
  if (!din.steps[i]) return;
  if (key === 'months') din.steps[i].months = dinNum(val, 1, 1);
  else din.steps[i].rate = Math.max(0, Number(val) || 0);
  const selP = document.getElementById('dinProgram'); if (selP) selP.value = ''; updateDinProgramHint();
  dinSchedule();
}
function addDinStep() {
  if (din.steps.length >= DIN_MAX_STEPS) return;
  const last = din.steps[din.steps.length - 1];
  din.steps.push({ months: 12, rate: last ? last.rate : 10 });
  const selP = document.getElementById('dinProgram'); if (selP) selP.value = ''; updateDinProgramHint();
  renderDinSteps(); dinSchedule();
}
function removeDinStep(i) {
  if (din.steps.length <= 1) return;
  din.steps.splice(i, 1);
  const selP = document.getElementById('dinProgram'); if (selP) selP.value = ''; updateDinProgramHint();
  renderDinSteps(); dinSchedule();
}

function updateDinVar(i, key, val) {
  const v = din.vars[i]; if (!v) return;
  if (key === 'amount') v.amount = parseNum(val);
  else if (key === 'jenis') v.jenis = DIN_JENIS.includes(val) ? val : 'Tabungan';
  else if (key === 'start') v.start = dinNum(val, 1, 1);
  else if (key === 'months') v.months = dinNum(val, 1, 1);
  dinRefreshVarInfo(); dinSchedule();
}
function addDinVar() {
  if (din.vars.length >= DIN_MAX_VARS) return;
  const last = din.vars[din.vars.length - 1];
  // seperti di Excel Simulasi: variasi berikutnya mulai setelah variasi sebelumnya berakhir
  const start = last ? last.start + last.months : 1;
  din.vars.push({ amount: last ? last.amount : Math.round(din.plafon * 0.5), jenis: last ? last.jenis : 'Tabungan', start, months: 12 });
  renderDinVars(); dinSchedule();
}
function removeDinVar(i) {
  din.vars.splice(i, 1);
  renderDinVars(); dinSchedule();
}

let dinCurrentTier = 'Bukan Tier 1';

function onDinTierChange() {
  const tierSel = document.getElementById('dinTierSelect');
  if (!tierSel) return;
  dinCurrentTier = tierSel.value;
  populateDinProgramDropdown();
  onDinProgramChange();
}

function onDinProgramChange() {
  const sel = document.getElementById('dinProgram');
  if (!sel) return;
  const key = sel.value;
  updateDinProgramHint();
  if (!key) return; // manual
  const list = (typeof PROGRAMS !== 'undefined' && PROGRAMS[dinCurrentTier]) ? PROGRAMS[dinCurrentTier] : {};
  const p = list[key];
  if (!p) return;
  din.steps = p.segments.slice(0, DIN_MAX_STEPS).map(([months, rate]) => ({ months, rate: +Number(rate).toFixed(4) }));
  renderDinSteps();
  dinSchedule();
}

function populateDinTierDropdown() {
  const tierSel = document.getElementById('dinTierSelect');
  if (!tierSel) return;
  const tiers = typeof PROGRAMS !== 'undefined' ? Object.keys(PROGRAMS) : [];
  if (!tiers.length) return;
  const ordered = ['Bukan Tier 1', 'Tier 1'].filter(t => tiers.includes(t))
    .concat(tiers.filter(t => t !== 'Bukan Tier 1' && t !== 'Tier 1'));
  if (typeof PROGRAMS !== 'undefined' && !PROGRAMS[dinCurrentTier]) dinCurrentTier = ordered[0] || 'Bukan Tier 1';
  tierSel.innerHTML = '';
  ordered.forEach(t => {
    const o = document.createElement('option');
    o.value = t;
    o.textContent = t;
    tierSel.appendChild(o);
  });
  tierSel.value = dinCurrentTier;
}

function populateDinProgramDropdown(preserveKey) {
  const sel = document.getElementById('dinProgram');
  if (!sel) return;
  const prevKey = preserveKey !== undefined ? preserveKey : sel.value;
  sel.innerHTML = '<option value="">Manual (custom)</option>';
  const list = (typeof PROGRAMS !== 'undefined' && PROGRAMS[dinCurrentTier]) ? PROGRAMS[dinCurrentTier] : {};
  Object.keys(list).forEach(k => {
    const p = list[k];
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
  if (prevKey && list[prevKey]) {
    sel.value = prevKey;
  } else {
    sel.value = '';
  }
  updateDinProgramHint();
}

function updateDinProgramHint() {
  const sel = document.getElementById('dinProgram'), hint = document.getElementById('dinProgramHint');
  if (!sel || !hint) return;
  const key = sel.value;
  if (!key) { hint.textContent = ''; return; }
  const list = (typeof PROGRAMS !== 'undefined' && PROGRAMS[dinCurrentTier]) ? PROGRAMS[dinCurrentTier] : {};
  const p = list[key];
  if (!p) { hint.textContent = ''; return; }
  const segText = p.segments.map(([m, r]) => `${m} bln (${r}%)`).join(' + ');
  hint.textContent = `Skema: ${segText}`;
}

function populateDinProgram() {
  populateDinTierDropdown();
  populateDinProgramDropdown();
}

function toggleDinTier() {
  din.tierOpen = !din.tierOpen;
  if (din.tierOpen) renderDinTierTable();
  document.getElementById('dinTierWrap').classList.toggle('hidden', !din.tierOpen);
  document.getElementById('dinTierArrow').style.transform = din.tierOpen ? 'rotate(0deg)' : 'rotate(-90deg)';
}
function toggleDinAmort() {
  const w = document.getElementById('dinAmortWrap'), a = document.getElementById('dinAmortArrow');
  const hidden = w.classList.toggle('hidden');
  a.style.transform = hidden ? 'rotate(-90deg)' : 'rotate(0deg)';
}
function showAllDinAmort() { din.amortAll = true; if (_dinLast) renderDinAmort(_dinLast.sim); }

// ─── Render: input lists ───
const DIN_INP = 'num w-full px-2 py-2 bg-blue-50 dark:bg-slate-800 border border-blue-200 dark:border-slate-600 rounded-md text-sm font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:border-bri focus:bg-white dark:focus:bg-slate-900 transition';
const DIN_LAB = 'block text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-1';

function renderDinSteps() {
  const n = din.steps.length;
  let cum = 0;
  document.getElementById('dinSteps').innerHTML = din.steps.map((s, i) => {
    const from = cum + 1; cum += s.months;
    return `
    <div class="flex items-end gap-2 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 border-l-[3px] border-l-bri rounded-lg p-3">
      <div class="w-16 shrink-0 pb-1">
        <span class="flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-300">
          <span class="inline-flex items-center justify-center h-5 w-5 rounded bg-bri text-white text-[11px] font-bold">${i + 1}</span> Tahap
        </span>
        <span id="dinStepRange-${i}" class="block mt-1 num text-[10px] text-slate-400 dark:text-slate-500">bln ${from}–${cum}</span>
      </div>
      <div class="flex-1 min-w-0"><label class="${DIN_LAB}" for="dinStepM-${i}">Durasi (bulan)</label><input id="dinStepM-${i}" type="number" value="${s.months}" min="1" step="1" oninput="updateDinStep(${i},'months',this.value)" class="${DIN_INP}"></div>
      <div class="flex-1 min-w-0"><label class="${DIN_LAB}" for="dinStepR-${i}">Bunga dasar (% p.a.)</label><input id="dinStepR-${i}" type="number" value="${s.rate}" min="0" step="0.01" oninput="updateDinStep(${i},'rate',this.value)" class="${DIN_INP}"></div>
      ${n > 1 ? `<button type="button" onclick="removeDinStep(${i})" aria-label="Hapus tahap ${i + 1}" class="shrink-0 h-9 w-7 text-slate-400 hover:text-red-500 text-sm leading-none transition">✕</button>` : ''}
    </div>`;
  }).join('');
  document.getElementById('dinAddStep').disabled = din.steps.length >= DIN_MAX_STEPS;
}

function renderDinVars() {
  const c = document.getElementById('dinVars');
  if (!din.vars.length) {
    c.innerHTML = '<p class="text-xs text-slate-400 dark:text-slate-500 rounded-lg border border-dashed border-slate-200 dark:border-slate-600 px-3 py-4 text-center">Belum ada dana pengurang. Klik <b>+ Tambah Variasi</b>.</p>';
  } else {
    c.innerHTML = din.vars.map((v, i) => `
    <div class="bg-emerald-50/50 dark:bg-slate-700/50 border border-emerald-100 dark:border-slate-600 border-l-[3px] border-l-emerald-600 rounded-lg p-3">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
          <span class="inline-flex items-center justify-center h-5 w-5 rounded bg-emerald-600 text-white text-[11px] font-bold">${i + 1}</span> Variasi ${i + 1}
        </span>
        <button type="button" onclick="removeDinVar(${i})" aria-label="Hapus variasi ${i + 1}" class="text-slate-400 hover:text-red-500 text-sm leading-none transition">✕</button>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div class="col-span-2 sm:col-span-1"><label class="${DIN_LAB}" for="dinVarA-${i}">Jumlah dana (Rp)</label><input id="dinVarA-${i}" type="text" inputmode="numeric" value="${formatThousands(v.amount)}" oninput="formatField(this); updateDinVar(${i},'amount',this.value)" class="${DIN_INP}"></div>
        <div class="col-span-2 sm:col-span-1"><label class="${DIN_LAB}" for="dinVarJ-${i}">Jenis dana</label>
          <select id="dinVarJ-${i}" onchange="updateDinVar(${i},'jenis',this.value)" class="w-full px-2 py-2 bg-blue-50 dark:bg-slate-800 border border-blue-200 dark:border-slate-600 rounded-md text-sm font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:border-bri transition">
            ${DIN_JENIS.map(j => `<option ${j === v.jenis ? 'selected' : ''}>${j}</option>`).join('')}
          </select></div>
        <div><label class="${DIN_LAB}" for="dinVarS-${i}">Mulai bulan ke</label><input id="dinVarS-${i}" type="number" min="1" step="1" value="${v.start}" oninput="updateDinVar(${i},'start',this.value)" class="${DIN_INP}"></div>
        <div><label class="${DIN_LAB}" for="dinVarM-${i}">Durasi (bulan)</label><input id="dinVarM-${i}" type="number" min="1" step="1" value="${v.months}" oninput="updateDinVar(${i},'months',this.value)" class="${DIN_INP}"></div>
      </div>
      <div id="dinVarInfo-${i}" class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400"></div>
    </div>`).join('');
  }
  document.getElementById('dinAddVar').disabled = din.vars.length >= DIN_MAX_VARS;
  dinRefreshVarInfo();
}

// perbarui info rasio/tier per variasi tanpa render ulang input (fokus tetap)
function dinRefreshVarInfo() {
  din.vars.forEach((v, i) => {
    const el = document.getElementById('dinVarInfo-' + i);
    if (!el) return;
    const inf = dinVarInfo(v, din.plafon);
    const red = inf.tier.reduction;
    el.innerHTML = `
      <span>Rasio <b class="num text-slate-700 dark:text-slate-200">${fmtPct(inf.ratio * 100, 1)}</b></span>
      <span>Tier <b class="text-slate-700 dark:text-slate-200">${inf.tier.label}</b></span>
      <span>Bln <b class="num text-slate-700 dark:text-slate-200">${v.start}–${inf.end}</b></span>
      <span class="ml-auto num font-bold px-1.5 py-0.5 rounded ${red < 0 ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}">${red < 0 ? red.toLocaleString('id-ID', { maximumFractionDigits: 2 }) + '%' : 'Tanpa pengurang'}</span>`;
  });
  if (din.tierOpen) renderDinTierTable();
}

function renderDinTierTable() {
  const used = new Set();
  din.vars.forEach(v => { const t = dinVarInfo(v, din.plafon).tier; if (t.idx >= 0) used.add(t.idx + ':' + DIN_JENIS.indexOf(v.jenis)); });
  const td = 'px-2.5 py-1.5 border-t border-slate-100 dark:border-slate-700';
  const cell = (val, r, c) => {
    const on = used.has(r + ':' + c);
    return `<td class="${td} text-right ${on ? 'bg-emerald-100 dark:bg-emerald-900/40 font-bold text-emerald-700 dark:text-emerald-300' : ''}">${val.toLocaleString('id-ID', { minimumFractionDigits: 2 })}</td>`;
  };
  document.getElementById('dinTierTable').innerHTML = `
    <table class="num w-full text-left text-[11px] text-slate-600 dark:text-slate-300 whitespace-nowrap">
      <thead class="bg-slate-50 dark:bg-slate-700/50 text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400">
        <tr><th class="px-2.5 py-2">Rasio dana</th>${DIN_JENIS.map(j => `<th class="px-2.5 py-2 text-right">${j}</th>`).join('')}</tr>
      </thead>
      <tbody>${DIN_TIERS.map((t, r) => `<tr><td class="${td}">${t[1]}</td>${cell(t[2], r, 0)}${cell(t[3], r, 1)}${cell(t[4], r, 2)}</tr>`).join('')}</tbody>
    </table>`;
}

// ─── Kalkulasi utama ───
let _dinTimer = null;
function dinSchedule() {
  clearTimeout(_dinTimer);
  _dinTimer = setTimeout(() => { try { calcDinamis(); } catch (e) { console.error(e); } }, 120);
}

function calcDinamis() {
  if (!din.ready) dinInit();
  const plafon = din.plafon;
  const steps = din.steps.map(s => ({ months: Math.max(1, Math.round(s.months)), rate: Math.max(0, +s.rate || 0) }));
  const vars = din.vars.filter(v => v.amount > 0 && v.months > 0);

  // ringkas info tenor & rentang bulan tiap tahap
  let cum = 0;
  steps.forEach((s, i) => { const el = document.getElementById('dinStepRange-' + i); const f = cum + 1; cum += s.months; if (el) el.textContent = `bln ${f}–${cum}`; });
  const tenor = cum;
  const tEl = document.getElementById('dinTenor');
  if (tEl) tEl.value = tenor;
  const twEl = document.getElementById('dinTenorWords');
  if (twEl) twEl.textContent = '≈ ' + monthsToText(tenor);
  const tiEl = document.getElementById('dinTenorInfo');
  if (tiEl) tiEl.innerHTML = `Total tenor <b class="num text-slate-700 dark:text-slate-200">${tenor} bln</b> (${monthsToText(tenor)})`;

  if (plafon <= 0) {
    document.getElementById('dinSummary').innerHTML = '<p class="sm:col-span-3 text-sm text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700">Isi plafon kredit untuk melihat simulasi.</p>';
    return;
  }

  const sim = dinSimulate(plafon, steps, vars, din.method, true);
  const base = dinSimulate(plafon, steps, vars, din.method, false);
  _dinLast = { sim, base, plafon, steps, vars, tenor };

  renderDinWarnings(vars, tenor, sim);
  renderDinSummary(sim, base, plafon);
  renderDinMetrics(sim, base, plafon, vars);
  renderDinChart(sim, base, plafon);
  renderDinPeriods(sim);
  renderDinAmort(sim);
  dinSave();
}

function renderDinWarnings(vars, tenor, sim) {
  const w = [];
  if (!DIN_TIERS.length) w.push('Tabel tiering belum bisa dimuat dari server, jadi pengurang bunga belum dihitung. Periksa koneksi internet lalu muat ulang halaman.');
  vars.forEach((v, i) => {
    const inf = dinVarInfo(v, din.plafon);
    if (v.start > tenor) w.push(`Variasi ${i + 1} dimulai setelah tenor berakhir (bulan ke-${tenor}), tidak berpengaruh.`);
    else if (inf.end > tenor) w.push(`Variasi ${i + 1} berakhir di bulan ke-${inf.end}, melewati tenor ${tenor} bln.`);
    if (inf.tier.idx < 0 && DIN_TIERS.length) w.push(`Variasi ${i + 1}: rasio dana ${fmtPct(inf.ratio * 100, 1)} di bawah ${Math.round(DIN_TIERS[0][0] * 100)}%, tidak mendapat pengurang.`);
  });
  for (let a = 0; a < vars.length; a++) for (let b = a + 1; b < vars.length; b++) {
    const A = vars[a], B = vars[b];
    const s = Math.max(A.start, B.start), e = Math.min(A.start + A.months - 1, B.start + B.months - 1);
    if (s <= e) w.push(`Variasi ${din.vars.indexOf(A) + 1} &amp; ${din.vars.indexOf(B) + 1} tumpang tindih di bulan ${s}–${e}; pengurangnya dijumlahkan.`);
  }
  if (sim.rows.some(r => r.base + r.red < 0)) w.push('Di beberapa bulan pengurang melebihi bunga dasar, bunga efektif dibatasi minimal 0%.');
  document.getElementById('dinVarWarn').innerHTML = w.length
    ? `<ul class="space-y-1">${w.map(t => `<li class="flex gap-1.5"><span aria-hidden="true">⚠️</span><span>${t}</span></li>`).join('')}</ul>` : '';
}

function renderDinSummary(sim, base, plafon) {
  const first = sim.rows[0] ? sim.rows[0].payment : 0;
  const baseFirst = base.rows[0] ? base.rows[0].payment : 0;
  const hemat = base.totalInterest - sim.totalInterest;
  const faster = base.paidOff - sim.paidOff;
  const whiteCard = 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5';

  const card1 = `
    <div class="relative overflow-hidden rounded-2xl p-5 text-white shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5" style="background:linear-gradient(135deg,rgb(var(--bri-2)),rgb(var(--bri)))">
      <div class="absolute -right-6 -top-6 w-24 h-24 bg-white/10 rounded-full"></div>
      <p class="text-blue-100 text-xs font-semibold mb-1">Angsuran KPR (Bulan ke-1)</p>
      <h3 class="text-2xl font-bold mb-1 num">${fmtMoney(Math.round(first))}<span class="text-xs font-normal"> /bln</span></h3>
      <p class="text-[11px] text-blue-200">${Math.round(baseFirst) !== Math.round(first) ? 'Tanpa dana: ' + fmtMoney(Math.round(baseFirst)) + '/bln' : 'Bunga efektif ' + fmtPct(sim.rows[0] ? sim.rows[0].eff : 0)}</p>
    </div>`;

  const card2 = `
    <div class="${whiteCard} flex flex-col justify-between">
      <div>
        <p class="text-slate-500 dark:text-slate-400 text-xs font-semibold mb-1">Total Pembayaran</p>
        <h3 class="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-1 num">${fmtCompact(sim.totalPayment)}</h3>
      </div>
      <p class="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">Pokok <span class="font-semibold text-slate-700 dark:text-slate-200">${fmtCompact(plafon)}</span> + Bunga <span class="font-semibold text-bri dark:text-blue-300">${fmtCompact(sim.totalInterest)}</span></p>
    </div>`;

  const card3 = `
    <div class="${whiteCard} flex flex-col justify-between">
      <div>
        <p class="text-slate-500 dark:text-slate-400 text-xs font-semibold mb-1">Total Bunga</p>
        <h3 class="text-2xl font-bold text-bri dark:text-blue-300 mb-1 num">${fmtCompact(sim.totalInterest)}</h3>
      </div>
      <p class="text-[11px] text-slate-400 dark:text-slate-500">${hemat > 0.5 ? 'Hemat bunga ' + fmtCompact(Math.max(0, hemat)) + (faster > 0 ? ' · ' + monthsToText(faster) + ' lebih cepat' : '') : 'Akumulasi selama ' + sim.paidOff + ' bulan'}</p>
    </div>`;

  document.getElementById('dinSummary').innerHTML = `${card1}${card2}${card3}`;

  const banner = document.getElementById('dinBanner');
  if (hemat > 0.5) {
    const extra = din.method === 'tetap' && faster > 0 ? ` dan kredit lunas <b>${monthsToText(faster)}</b> lebih cepat` : '';
    banner.innerHTML = `<div class="rounded-2xl border px-5 py-4 text-sm font-medium bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-900/40">✅ Dengan menempatkan dana di BRI, total bunga turun <b>${fmtMoney(Math.round(hemat))}</b>${extra} dibanding tanpa dana pengurang.</div>`;
  } else {
    banner.innerHTML = `<div class="rounded-2xl border px-5 py-4 text-sm font-medium bg-bri-light dark:bg-blue-900/20 text-bri dark:text-blue-300 border-blue-100 dark:border-blue-900/40">ℹ️ Belum ada dana pengurang yang aktif. Tambahkan variasi dengan rasio dana minimal 10% dari plafon.</div>`;
  }
}

function renderDinMetrics(sim, base, plafon, vars) {
  const blue = { bg: 'bg-bri-light dark:bg-blue-900/20', lc: 'text-bri dark:text-blue-300', vc: 'text-bri dark:text-blue-300', sc: 'text-slate-500 dark:text-slate-400' };
  const org = { bg: 'bg-orange-50 dark:bg-orange-900/20', lc: 'text-orange-600 dark:text-orange-300', vc: 'text-slate-800 dark:text-slate-100', sc: 'text-slate-500 dark:text-slate-400' };
  const pmts = sim.rows.map(r => r.payment);
  const minP = Math.min(...pmts), maxP = Math.max(...pmts);
  const monthsActive = sim.rows.filter(r => r.red < 0).length;
  const avgEff = sim.rows.length ? sim.rows.reduce((a, r) => a + r.eff, 0) / sim.rows.length : 0;
  const avgBase = sim.rows.length ? sim.rows.reduce((a, r) => a + r.base, 0) / sim.rows.length : 0;
  const basePm = base.rows.map(r => r.payment);

  document.getElementById('dinMetrics').innerHTML =
    metricSection('Dengan Dana Pengurang', 'bg-bri',
      bigCell('Total Pembayaran', fmtMoney(Math.round(sim.totalPayment)), Object.assign({ sub: 'Pokok ' + fmtCompact(plafon) + ' + Bunga ' + fmtCompact(sim.totalInterest) }, blue)) +
      bigCell('Total Bunga', fmtMoney(Math.round(sim.totalInterest)), blue) +
      bigCell('Rentang Angsuran', fmtCompact(minP) + ' – ' + fmtCompact(maxP), Object.assign({ sub: 'Terendah – tertinggi per bulan' }, blue)) +
      bigCell('Bunga Efektif Rata-rata', fmtPct(avgEff), Object.assign({ sub: 'Bunga dasar rata-rata ' + fmtPct(avgBase) + ' · pengurang aktif ' + monthsActive + ' bln' }, blue)), 'lg:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4') +
    metricSection('Tanpa Dana Pengurang (Pembanding)', 'bg-briorange',
      bigCell('Total Pembayaran', fmtMoney(Math.round(base.totalPayment)), org) +
      bigCell('Total Bunga', fmtMoney(Math.round(base.totalInterest)), org) +
      bigCell('Rentang Angsuran', fmtCompact(Math.min(...basePm)) + ' – ' + fmtCompact(Math.max(...basePm)), Object.assign({ sub: 'Terendah – tertinggi per bulan' }, org)) +
      bigCell('Jangka Waktu', base.paidOff + ' bln', Object.assign({ sub: monthsToText(base.paidOff) }, org)), 'lg:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4');
}

function renderDinChart(sim, base, plafon) {
  const saldo = [plafon], saldoBase = [plafon], eff = [], baseRate = [];
  sim.rows.forEach(r => { saldo.push(r.end); eff.push({ x: r.month, y: r.eff }); baseRate.push({ x: r.month, y: r.base }); });
  base.rows.forEach(r => saldoBase.push(r.end));

  const dark = isDark();
  const tick = dark ? '#94a3b8' : '#64748b', grid = dark ? 'rgba(148,163,184,0.14)' : '#eef2f7', legend = dark ? '#cbd5e1' : '#475569';
  const blue = dark ? '#4AA3E8' : briColor('--bri');
  const ds = [
    { label: 'Sisa pokok (dengan dana)', data: downsample(saldo, 240), borderColor: blue, backgroundColor: dark ? 'rgba(74,163,232,0.10)' : briColor('--bri-sky', 0.16), borderWidth: 2.5, fill: true, tension: 0.15, pointRadius: 0, pointHoverRadius: 4, yAxisID: 'y' },
    { label: 'Sisa pokok (tanpa dana)', data: downsample(saldoBase, 240), borderColor: '#F58220', borderDash: [5, 4], borderWidth: 2, fill: false, tension: 0.15, pointRadius: 0, pointHoverRadius: 4, yAxisID: 'y' },
    { label: 'Bunga efektif (%)', data: eff, borderColor: '#059669', borderWidth: 2, stepped: true, fill: false, pointRadius: 0, pointHoverRadius: 4, yAxisID: 'y1' },
    { label: 'Bunga dasar (%)', data: baseRate, borderColor: dark ? '#64748b' : '#94a3b8', borderDash: [2, 3], borderWidth: 1.5, stepped: true, fill: false, pointRadius: 0, pointHoverRadius: 3, yAxisID: 'y1' },
  ];
  const opts = {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    animation: { duration: 300 },
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14, font: { size: 11 }, color: legend, usePointStyle: true } },
      tooltip: { callbacks: { title: it => 'Bulan ' + it[0].parsed.x, label: it => it.dataset.label + ': ' + (it.dataset.yAxisID === 'y1' ? fmtPct(it.parsed.y) : fmtMoney(it.parsed.y)) } },
      annotation: { annotations: {} },
    },
    scales: {
      x: { type: 'linear', min: 0, max: sim.tenor, ticks: { color: tick, font: { size: 10 }, maxTicksLimit: 8 }, grid: { color: grid }, title: { display: true, text: 'Bulan', color: tick, font: { size: 10 } } },
      y: { beginAtZero: true, ticks: { color: tick, font: { size: 10 }, maxTicksLimit: 6, callback: v => fmtCompact(v) }, grid: { color: grid } },
      y1: { position: 'right', beginAtZero: true, ticks: { color: tick, font: { size: 10 }, maxTicksLimit: 6, callback: v => v + '%' }, grid: { drawOnChartArea: false } },
    },
  };
  if (dinChart) { dinChart.data.datasets = ds; dinChart.options = opts; dinChart.update(); }
  else dinChart = new Chart(document.getElementById('dinChart'), { type: 'line', data: { datasets: ds }, options: opts });
}

function renderDinPeriods(sim) {
  const per = dinPeriods(sim.rows);
  const td = 'px-3 py-2.5 border-t border-slate-100 dark:border-slate-700';
  const pmtTxt = p => Math.round(p.firstPmt) === Math.round(p.lastPmt) || p.from === p.to
    ? fmtMoney(Math.round(p.firstPmt)) : `${fmtCompact(p.firstPmt)} → ${fmtCompact(p.lastPmt)}`;
  const body = per.map(p => `
    <tr class="hover:bg-blue-50 dark:hover:bg-slate-700/60 transition-colors">
      <td class="${td}">${p.from === p.to ? p.from : p.from + '–' + p.to} <span class="text-[10px] text-slate-400">(${p.to - p.from + 1} bln)</span></td>
      <td class="${td} text-center"><span class="inline-flex items-center justify-center h-5 w-5 rounded bg-bri text-white text-[11px] font-bold">${p.stage}</span></td>
      <td class="${td}">${fmtPct(p.base)}</td>
      <td class="${td} ${p.red < 0 ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-400'}">${p.red < 0 ? fmtPct(p.red) : '—'}</td>
      <td class="${td} font-semibold">${fmtPct(p.eff)}</td>
      <td class="${td} font-semibold">${pmtTxt(p)}</td>
      <td class="${td} text-bri dark:text-blue-300">${fmtMoney(Math.round(p.interest))}</td>
      <td class="${td}">${fmtMoney(Math.round(p.end))}</td>
    </tr>`).join('');
  document.getElementById('dinPeriodTable').innerHTML = `
    <table class="num w-full text-left text-sm text-slate-600 dark:text-slate-300 whitespace-nowrap">
      <thead class="bg-slate-50 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400 text-[11px] uppercase font-semibold">
        <tr><th class="px-3 py-3">Bulan</th><th class="px-3 py-3 text-center">Tahap</th><th class="px-3 py-3">Bunga Dasar</th><th class="px-3 py-3">Pengurang</th><th class="px-3 py-3">Bunga Efektif</th><th class="px-3 py-3">Angsuran</th><th class="px-3 py-3">Bunga Dibayar</th><th class="px-3 py-3">Saldo Akhir</th></tr>
      </thead>
      <tbody>${body}
        <tr class="bg-bri-light dark:bg-slate-700 font-bold">
          <td class="px-3 py-2.5 border-t border-slate-200 dark:border-slate-600" colspan="5">TOTAL (${sim.paidOff} bln)</td>
          <td class="px-3 py-2.5 border-t border-slate-200 dark:border-slate-600">${fmtMoney(Math.round(sim.totalPayment))}</td>
          <td class="px-3 py-2.5 border-t border-slate-200 dark:border-slate-600 text-bri dark:text-blue-300">${fmtMoney(Math.round(sim.totalInterest))}</td>
          <td class="px-3 py-2.5 border-t border-slate-200 dark:border-slate-600">${fmtMoney(0)}</td>
        </tr>
      </tbody>
    </table>`;
}

function renderDinAmort(sim) {
  const all = din.amortAll || sim.rows.length <= 60;
  const rows = all ? sim.rows : sim.rows.slice(0, 36);
  const td = 'px-3 py-2 border-t border-slate-100 dark:border-slate-700';
  const body = rows.map((r, i) => {
    const prev = i > 0 ? rows[i - 1] : null;
    const changed = !prev || prev.eff !== r.eff;   // baris pertama dengan bunga efektif baru (kuning di Excel)
    return `
    <tr class="${changed ? 'bg-amber-50 dark:bg-amber-900/20' : ''} hover:bg-blue-50 dark:hover:bg-slate-700/60 transition-colors">
      <td class="${td}">${r.month}</td>
      <td class="${td} text-center"><span class="inline-flex items-center justify-center h-4 w-4 rounded bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300 text-[10px] font-bold">${r.stage}</span></td>
      <td class="${td}">${fmtPct(r.base)}</td>
      <td class="${td} ${r.red < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}">${r.red < 0 ? fmtPct(r.red) : '—'}</td>
      <td class="${td} font-semibold">${fmtPct(r.eff)}</td>
      <td class="${td}">${fmtMoney(Math.round(r.begin))}</td>
      <td class="${td} font-medium">${fmtMoney(Math.round(r.payment))}</td>
      <td class="${td} text-bri dark:text-blue-300">${fmtMoney(Math.round(r.interest))}</td>
      <td class="${td}">${fmtMoney(Math.round(r.principal))}</td>
      <td class="${td}">${fmtMoney(Math.round(r.end))}</td>
    </tr>`;
  }).join('');
  document.getElementById('dinAmortTable').innerHTML = `
    <table class="num w-full text-left text-sm text-slate-600 dark:text-slate-300 whitespace-nowrap">
      <thead class="bg-slate-50 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400 text-[11px] uppercase font-semibold">
        <tr><th class="px-3 py-3">Bln</th><th class="px-3 py-3 text-center">Thp</th><th class="px-3 py-3">Bunga Dasar</th><th class="px-3 py-3">Pengurang</th><th class="px-3 py-3">Efektif</th><th class="px-3 py-3">Saldo Awal</th><th class="px-3 py-3">Angsuran</th><th class="px-3 py-3">Bunga</th><th class="px-3 py-3">Pokok</th><th class="px-3 py-3">Saldo Akhir</th></tr>
      </thead><tbody>${body}</tbody></table>` +
    (all ? '' : `<div class="text-center my-3"><button type="button" onclick="showAllDinAmort()" class="text-xs font-semibold text-bri dark:text-blue-300 border border-slate-200 dark:border-slate-600 hover:bg-bri-light dark:hover:bg-slate-700 rounded-lg px-4 py-2 transition">Tampilkan semua ${sim.rows.length} bulan</button></div>`);
}

// ─── Simpan / pulihkan (localStorage, per perangkat) ───
function dinSave() {
  try {
    localStorage.setItem(DIN_STORE_KEY, JSON.stringify({ v: 1, method: din.method, plafon: din.plafon, steps: din.steps, vars: din.vars }));
  } catch (e) {}
}
function dinRestore() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(DIN_STORE_KEY) || 'null'); } catch (e) {}
  if (!s || s.v !== 1) return;
  if (DIN_METHODS[s.method]) din.method = s.method;
  if (Number(s.plafon) > 0) din.plafon = Math.round(Number(s.plafon));
  const okStep = x => x && Number(x.months) >= 1 && Number(x.months) <= 600 && Number(x.rate) >= 0;
  if (Array.isArray(s.steps) && s.steps.length >= 1 && s.steps.length <= DIN_MAX_STEPS && s.steps.every(okStep)) {
    din.steps = s.steps.map(x => ({ months: Math.round(+x.months), rate: +x.rate }));
  }
  const okVar = x => x && Number(x.amount) >= 0 && Number(x.start) >= 1 && Number(x.months) >= 1 && DIN_JENIS.includes(x.jenis);
  if (Array.isArray(s.vars) && s.vars.length <= DIN_MAX_VARS && s.vars.every(okVar)) {
    din.vars = s.vars.map(x => ({ amount: Math.round(+x.amount), jenis: x.jenis, start: Math.round(+x.start), months: Math.round(+x.months) }));
  }
}
function resetDinamis() {
  try { localStorage.removeItem(DIN_STORE_KEY); } catch (e) {}
}


function setDinTiers(tiers) {
  if (!Array.isArray(tiers) || !tiers.length) return false;
  const parsed = [];
  for (const item of tiers) {
    if (!item) continue;
    let ratio, label, tab, gir, dep;
    if (Array.isArray(item)) {
      ratio = Number(item[0]);
      label = String(item[1] || '');
      tab = Number(item[2]);
      gir = Number(item[3]);
      dep = Number(item[4]);
    } else if (typeof item === 'object') {
      ratio = Number(item.min_ratio !== undefined ? item.min_ratio : item.ratio);
      label = String(item.label || item.tiering || item.rentang || '');
      tab = Number(item.tabungan !== undefined ? item.tabungan : item.tab);
      gir = Number(item.giro !== undefined ? item.giro : item.gir);
      dep = Number(item.deposito !== undefined ? item.deposito : item.dep);
    } else {
      continue;
    }
    if (isNaN(ratio) || ratio < 0) continue;
    if (ratio >= 5) ratio = ratio / 100;
    const fixVal = v => {
      let n = Number(v) || 0;
      if (Math.abs(n) > 0 && Math.abs(n) <= 0.25) n = n * 100;
      if (n > 0) n = -n;
      return +n.toFixed(4);
    };
    tab = fixVal(tab);
    gir = fixVal(gir);
    dep = fixVal(dep);
    if (!label) label = `${Math.round(ratio * 100)}%`;
    parsed.push([+ratio.toFixed(4), label, tab, gir, dep]);
  }
  if (!parsed.length) return false;
  parsed.sort((a, b) => a[0] - b[0]);
  DIN_TIERS = parsed;
  if (din.ready) {
    dinRefreshVarInfo();
    dinSchedule();
  }
  return true;
}

function parseTieringCsv(csvText) {
  if (!csvText || typeof csvText !== 'string') return [];
  const lines = csvText.trim().split(/\r?\n/);
  const result = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const sep = line.includes(';') ? ';' : (line.includes('\t') ? '\t' : ',');
    const cleanCell = s => { let t = String(s || "").trim(); if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) t = t.slice(1, -1).trim(); return t; };
    const cols = line.split(sep).map(cleanCell);
    if (cols.length < 5) continue;
    if (cols[0].toLowerCase().includes('batas') || cols[0].toLowerCase().includes('ratio') || isNaN(parseFloat(cols[0]))) continue;
    result.push([
      parseFloat(cols[0]),
      cols[1],
      parseFloat(cols[2]),
      parseFloat(cols[3]),
      parseFloat(cols[4])
    ]);
  }
  return result;
}

if (typeof window !== 'undefined') {
  window.setDinTiers = setDinTiers;
  window.parseTieringCsv = parseTieringCsv;
  window.populateDinTierDropdown = populateDinTierDropdown;
  window.populateDinProgramDropdown = populateDinProgramDropdown;
  window.onDinTierChange = onDinTierChange;
  window.onDinProgramChange = onDinProgramChange;
  window.populateDinProgram = populateDinProgram;
  if (window._cachedApiTiering) {
    setDinTiers(window._cachedApiTiering);
  }
}

function dinInit() {
  din.ready = true;
  dinRestore();
  if (typeof window !== "undefined" && window._cachedApiTiering) setDinTiers(window._cachedApiTiering);
  const p = document.getElementById('dinPlafon');
  if (p) p.value = formatThousands(din.plafon);
  const pw = document.getElementById('dinPlafonWords');
  if (pw) pw.textContent = '≈ ' + terbilang(din.plafon) + ' rupiah';
  const tenor = din.steps.reduce((a, s) => a + s.months, 0);
  const tEl = document.getElementById('dinTenor');
  if (tEl) tEl.value = tenor;
  const twEl = document.getElementById('dinTenorWords');
  if (twEl) twEl.textContent = '≈ ' + monthsToText(tenor);
  dinSyncMethodUI();
  populateDinTierDropdown();
  populateDinProgramDropdown();
  renderDinSteps();
  renderDinVars();
}

// ekspor untuk pengujian di Node (diabaikan di browser)
if (typeof module !== 'undefined') module.exports = { dinSimulate, dinTier, setDinTiers, parseTieringCsv, DIN_TIERS };
