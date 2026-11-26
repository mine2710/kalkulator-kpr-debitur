/**
 * Controller UI Interaktif Kalkulator KKB
 * Fokus pada tampilan tabel responsif sesuai resolusi layar
 */
(function (global) {
  'use strict';

  const Config = global.KKBConfig;
  const Calc = global.KKBCalculator;

  const STORAGE_KEY = 'kkb-settings-v1';
  const SCHEME_IDS = ['regular', 'lnp', 'karyawan'];
  const TENORS = [12, 24, 36, 48, 60];

  function cloneDeep(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // State Aplikasi
  const state = {
    schemeId: 'regular',
    wilayah: '2',
    financingType: 'New Car',
    vehicleType: 'Non Bus dan Non Truk',
    brandValue: 'TOYOTA',
    modelValue: 'AVANZA',
    vehiclePrice: 350000000,
    dpMode: 'pct',
    dpPct: 20,
    dpAmount: 70000000,
    coverageValue: 'Kombinasi#1',
    selectedPerils: ['banjir'],
    adminFee: 2000000,
    provisiPct: 1.0,
    polisFee: 60000,
    blokirFee: 500000,
    installmentType: 'ADDB',
    selectedTenor: 36,
    activeModalTab: 'tabRates',
    modalFinancing: 'all',
    modalWilayah: 'all',
    provisiBasis: 'principal',
    fidusiaBasis: 'price',
    bracketBasis: 'depreciated',
    isCreditFeesCollapsed: true,
    schemes: cloneDeep(Config.DEFAULT_SCHEMES)
  };

  let lastSuiteResult = null;
  let isReady = false;

  const $ = (id) => document.getElementById(id);
  // Semua elemen KKB berada di dalam #kkbApp (satu halaman dengan kalkulator KPR)
  const root = () => document.getElementById('kkbApp') || document;

  // Refinancing tidak mengenal DP: yang diisi adalah Plafon Pinjaman (nilai kendaraan - porsi yang
  // tidak dibiayai), dan pembayaran awal hanya berisi biaya. Perhitungan internal tetap memakai dpPct/dpAmount.
  const WORDING = {
    standard: {
      sectionTitle: 'Pembiayaan & Down Payment',
      priceLabel: 'Harga Kendaraan (OTR)',
      dpLabel: 'Down Payment (DP Murni)',
      dpModeAria: 'Mode Input DP',
      applyLimit: 'Pakai Min',
      upfrontTitle: 'Total Down Payment (TDP)',
      upfrontColumn: 'Total DP (TDP)',
      upfrontTotalRow: 'TOTAL DOWN PAYMENT (TDP)',
      upfrontParts: 'DP + Asuransi + Biaya Kredit',
      detailTitle: 'Rincian TDP & Biaya Kredit',
      detailFormula: 'TDP = DP Murni + Premi Asuransi + Biaya Kredit',
      principalLabel: 'Pokok Hutang',
      addmOption: 'ADDM — Angsuran ke-1 Masuk TDP',
      addmCaption: 'Angsuran ke-1 masuk TDP saat akad (bulan ke-1 tanpa bunga).',
      limitNotice:
        'DP yang diisi belum memenuhi minimum kendaraan. Hasil ini hanya ilustrasi; gunakan tombol Pakai Min untuk menyesuaikan.'
    },
    refinancing: {
      sectionTitle: 'Pembiayaan & Plafon Pinjaman',
      priceLabel: 'Nilai Kendaraan (Harga Pasar)',
      dpLabel: 'Plafon Pinjaman',
      dpModeAria: 'Mode Input Plafon',
      applyLimit: 'Pakai Maks',
      upfrontTitle: 'Total Biaya Awal',
      upfrontColumn: 'Total Biaya Awal',
      upfrontTotalRow: 'TOTAL BIAYA AWAL',
      upfrontParts: 'Asuransi + Biaya Kredit',
      detailTitle: 'Rincian Biaya Awal',
      detailFormula: 'Biaya Awal = Premi Asuransi + Biaya Kredit',
      principalLabel: 'Plafon Pinjaman',
      addmOption: 'ADDM — Angsuran ke-1 Dibayar di Muka',
      addmCaption: 'Angsuran ke-1 dibayar di muka saat akad (bulan ke-1 tanpa bunga).',
      limitNotice:
        'Plafon yang diisi melebihi batas maksimal untuk kendaraan ini. Hasil ini hanya ilustrasi; gunakan tombol Pakai Maks untuk menyesuaikan.'
    }
  };

  const isRefinancing = () => state.financingType === 'Refinancing';
  const wording = () => (isRefinancing() ? WORDING.refinancing : WORDING.standard);
  const upfrontTotal = (result) => (isRefinancing() ? result.totalUpfrontFees : result.totalDp);

  // ======================== FORMATTERS ========================
  function formatNumberId(num) {
    const rounded = Math.round(Number(num) || 0);
    return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function formatRupiah(num) {
    const val = Math.round(Number(num) || 0);
    return (val < 0 ? '-Rp ' : 'Rp ') + formatNumberId(Math.abs(val));
  }

  function formatPct(num, decimals) {
    const d = decimals !== undefined ? decimals : 2;
    return (Number(num) || 0).toFixed(d).replace('.', ',') + '%';
  }

  function parseDigits(str) {
    const cleaned = String(str || '').replace(/[^\d]/g, '');
    return cleaned ? parseInt(cleaned, 10) : 0;
  }

  function parseDecimalId(str) {
    const normalized = String(str || '')
      .replace(/\s+/g, '')
      .replace(',', '.')
      .replace(/[^0-9.]/g, '');
    const parsed = parseFloat(normalized);
    return isNaN(parsed) ? 0 : parsed;
  }

  // ======================== PERSISTENCE ========================
  // Sidik jari default rates.csv: bila CSV berubah, kustomisasi lama di browser diabaikan.
  function defaultRatesSignature() {
    return JSON.stringify(
      SCHEME_IDS.map((sId) => {
        const sch = Config.DEFAULT_SCHEMES[sId];
        return [sch.interestRates, sch.effectiveRates, sch.interestRatesAddm, sch.effectiveRatesAddm];
      })
    );
  }

  function loadSavedSettings() {
    try {
      const raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved.schemes && saved.ratesSignature === defaultRatesSignature()) state.schemes = saved.schemes;
      if (saved.provisiBasis) state.provisiBasis = saved.provisiBasis;
      if (saved.fidusiaBasis) state.fidusiaBasis = saved.fidusiaBasis;
      if (saved.bracketBasis) state.bracketBasis = saved.bracketBasis;
    } catch (e) {
      // localStorage tidak tersedia
    }
  }

  function saveCustomSettings() {
    try {
      global.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          schemes: state.schemes,
          ratesSignature: defaultRatesSignature(),
          provisiBasis: state.provisiBasis,
          fidusiaBasis: state.fidusiaBasis,
          bracketBasis: state.bracketBasis
        })
      );
    } catch (e) {
      // abaikan
    }
  }

  // ======================== DROPDOWNS & CHECKBOXES ========================
  function syncVehicleTypeFromFinancing() {
    state.vehicleType =
      (Config.VEHICLE_TYPE_BY_FINANCING && Config.VEHICLE_TYPE_BY_FINANCING[state.financingType]) ||
      'Non Bus dan Non Truk';
  }

  function populateStaticDropdowns() {
    syncVehicleTypeFromFinancing();

    if (!global.KKBVehicles.brands.includes(state.brandValue)) {
      state.brandValue = global.KKBVehicles.brands[0];
    }
    $('inputBrand').replaceChildren(...global.KKBVehicles.brands.map(
      (brand) => new Option(brand, brand)
    ));
    $('inputBrand').value = state.brandValue;
    populateModels();

    $('inputCoverage').innerHTML = Config.COVERAGE_OPTIONS.map(
      (c) => `<option value="${c.value}">${c.label}</option>`
    ).join('');
    $('inputCoverage').value = state.coverageValue;
  }

  function populateModels() {
    const models = global.KKBVehicles.modelsFor(state.brandValue);
    if (!models.some((row) => row.model === state.modelValue)) state.modelValue = models[0].model;
    $('inputModel').replaceChildren(...models.map((row) => new Option(row.model, row.model)));
    $('inputModel').value = state.modelValue;
  }

  function applyMinimumDp() {
    const minimum = getMinDp();
    state.dpPct = minimum.minDpPct;
    state.dpAmount = minimum.minDpAmount;
    syncDpInputField();
  }

  function renderPerilCheckboxes() {
    const container = $('perilCheckboxesContainer');

    container.innerHTML = Config.INSURANCE_PERILS.map((peril) => {
      const isChecked = state.selectedPerils.indexOf(peril.id) !== -1;

      return `
        <label class="peril-item ${isChecked ? 'checked' : ''}">
          <span class="peril-left">
            <input type="checkbox" class="peril-checkbox" value="${peril.id}" ${isChecked ? 'checked' : ''} />
            <span>${peril.label}</span>
          </span>
        </label>
      `;
    }).join('');

    container.querySelectorAll('.peril-checkbox').forEach((cb) => {
      cb.addEventListener('change', () => {
        state.selectedPerils = Array.from(
          container.querySelectorAll('.peril-checkbox:checked')
        ).map((el) => el.value);
        cb.closest('.peril-item').classList.toggle('checked', cb.checked);
        updateSelectAllLabel();
        recalculateAndRender();
      });
    });

    updateSelectAllLabel();
  }

  function updateSelectAllLabel() {
    const all = state.selectedPerils.length === Config.INSURANCE_PERILS.length;
    $('btnSelectAllPerils').textContent = all ? 'Hapus Semua' : 'Pilih Semua';
  }

  // ======================== SKEMA & DP ========================
  function getMinDp() {
    return Calc.calculateMinDP({
      schemeId: state.schemeId,
      financingType: state.financingType,
      vehicleType: state.vehicleType,
      brandValue: state.brandValue,
      modelValue: state.modelValue,
      vehiclePrice: state.vehiclePrice,
      schemes: state.schemes
    });
  }

  function ensureTenorAllowed() {
    const sch = state.schemes[state.schemeId];
    const allowed = (sch.tenorsByFinancing && sch.tenorsByFinancing[state.financingType]) || TENORS;
    if (allowed.indexOf(state.selectedTenor) === -1) {
      state.selectedTenor = allowed[allowed.length - 1] || 36;
    }
  }

  function applySchemeDefaults(schemeId) {
    state.schemeId = schemeId;
    syncVehicleTypeFromFinancing();
    const scheme = state.schemes[schemeId] || Config.DEFAULT_SCHEMES.regular;

    state.adminFee = scheme.defaultAdmin;
    state.provisiPct = scheme.defaultProvisiPct;
    state.polisFee = scheme.defaultPolis;
    state.blokirFee =
      scheme.defaultBlokirByFinancing &&
      scheme.defaultBlokirByFinancing[state.financingType] !== undefined
        ? scheme.defaultBlokirByFinancing[state.financingType]
        : 500000;

    $('inputAdminFee').value = formatNumberId(state.adminFee);
    $('inputProvisiPct').value = state.provisiPct.toFixed(2).replace('.', ',');
    $('inputPolisFee').value = formatNumberId(state.polisFee);
    $('inputBlokirFee').value = formatNumberId(state.blokirFee);

    ensureTenorAllowed();

    if (!lastSuiteResult) applyMinimumDp();

    updateSchemeUi();
    recalculateAndRender();
  }

  function updateSchemeUi() {
    root().querySelectorAll('.scheme-btn').forEach((btn) => {
      const selected = btn.getAttribute('data-scheme') === state.schemeId;
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-pressed', String(selected));
    });

    const metaIds = { regular: 'metaRegular', lnp: 'metaLnp', karyawan: 'metaKaryawan' };
    // Yang ditampilkan ke debitur selalu bunga flat; perhitungan angsuran tetap memakai bunga efektif.
    SCHEME_IDS.forEach((sId) => {
      const sch = state.schemes[sId];
      const rates = Calc.getRateTable(
        sch,
        'interestRates',
        state.financingType,
        state.installmentType === 'ADDM'
      );
      const minRate = Math.min.apply(null, Object.values(rates));
      $(metaIds[sId]).textContent = `${sch.badge} • bunga mulai ${formatPct(minRate)}`;
    });

    const active = state.schemes[state.schemeId];
    $('activeSchemeSubtitle').textContent = `${active.name} • ${state.financingType} • Bunga Flat`;
    $('tableSchemeBadge').textContent = active.name;
  }

  function syncDpInputField() {
    const elInput = $('inputDpValue');
    const wrap = $('dpInputWrap');
    const isPct = state.dpMode === 'pct';

    wrap.className = 'input-group ' + (isPct ? 'has-right' : 'has-left');
    $('dpAddonLeft').hidden = isPct;
    $('dpAddonRight').hidden = !isPct;

    // Refinancing menampilkan Plafon Pinjaman, yaitu kebalikan dari DP
    const shownPct = isRefinancing() ? 100 - state.dpPct : state.dpPct;
    const shownAmount = isRefinancing() ? state.vehiclePrice - state.dpAmount : state.dpAmount;
    if (isPct) {
      elInput.value =
        shownPct % 1 === 0
          ? String(shownPct)
          : shownPct.toFixed(2).replace(/\.?0+$/, '').replace('.', ',');
    } else {
      elInput.value = formatNumberId(shownAmount);
    }

    $('btnDpModePct').classList.toggle('active', isPct);
    $('btnDpModeRp').classList.toggle('active', !isPct);
  }

  // ======================== RENDERING UTAMA ========================
  function recalculateAndRender() {
    const covObj = Config.COVERAGE_OPTIONS.find((c) => c.value === state.coverageValue);
    if (covObj) {
      $('coverageCriteriaText').textContent = covObj.criteria;
      $('insSubtitleBadge').textContent = `${covObj.label} • Wilayah ${state.wilayah} • ${state.vehicleType}`;
    }

    const suite = Calc.calculateFullSuite({
      schemeId: state.schemeId,
      financingType: state.financingType,
      wilayah: state.wilayah,
      vehicleType: state.vehicleType,
      brandValue: state.brandValue,
      modelValue: state.modelValue,
      vehiclePrice: state.vehiclePrice,
      dpAmount: state.dpAmount,
      coverageValue: state.coverageValue,
      selectedPerils: state.selectedPerils,
      adminFee: state.adminFee,
      provisiPct: state.provisiPct,
      polisFee: state.polisFee,
      blokirFee: state.blokirFee,
      rateType: 'efektif', // angsuran selalu dihitung dengan rumus anuitas & bunga efektif
      installmentType: state.installmentType,
      selectedTenor: state.selectedTenor,
      provisiBasis: state.provisiBasis,
      fidusiaBasis: state.fidusiaBasis,
      bracketBasis: state.bracketBasis,
      schemes: state.schemes
    });

    lastSuiteResult = suite;
    const active = suite.activeResult;
    const minDp = suite.minDpInfo;

    // Istilah mengikuti jenis pembiayaan (Refinancing: Plafon Pinjaman & Biaya Awal, tanpa DP)
    const refi = isRefinancing();
    const words = wording();
    const withFirstInstallment = active.installmentType === 'ADDM' ? ' + Angsuran Ke-1' : '';
    $('sectionFinancingTitle').textContent = words.sectionTitle;
    $('labelVehiclePrice').textContent = words.priceLabel;
    $('labelDpValue').textContent = words.dpLabel;
    $('dpModeGroup').setAttribute('aria-label', words.dpModeAria);
    $('btnApplyMinDp').textContent = words.applyLimit;
    $('kpiUpfrontLabel').textContent = words.upfrontTitle;
    $('kpiPrincipalLabel').textContent = words.principalLabel;
    $('detailTitleText').textContent = words.detailTitle;
    $('detailFormulaText').textContent = words.detailFormula + withFirstInstallment;
    $('inputInstallmentType').querySelector('option[value="ADDM"]').textContent = words.addmOption;

    // Info DP / Plafon
    const maxPlafonPct = 100 - minDp.minDpPct;
    const maxPlafonAmount = active.vehiclePrice - minDp.minDpAmount;
    $('dpConvertedCaption').innerHTML = refi
      ? `Plafon Pinjaman <strong>${formatRupiah(active.principalLoan)}</strong> (${formatPct(100 - active.dpPct, 1)} dari nilai kendaraan)`
      : `DP Murni <strong>${formatRupiah(active.dpAmount)}</strong> (${formatPct(active.dpPct, 1)}) • Pokok Hutang <strong>${formatRupiah(active.principalLoan)}</strong>`;

    const isBelowMin = Math.round(active.dpAmount) < Math.round(minDp.minDpAmount);
    $('simulationNotice').hidden = !isBelowMin;
    $('simulationNotice').textContent = words.limitNotice;
    $('inputDpValue').setAttribute('aria-invalid', String(isBelowMin));
    $('dpMinBox').classList.toggle('warning', isBelowMin);
    if (refi) {
      $('dpMinText').innerHTML = isBelowMin
        ? `<strong>⚠ Di atas maksimal plafon ${formatPct(maxPlafonPct, 1)}</strong> (${formatRupiah(maxPlafonAmount)})`
        : `<strong>✓ Maksimal plafon ${formatPct(maxPlafonPct, 1)}</strong> (${formatRupiah(maxPlafonAmount)})`;
      $('dpFactorsList').textContent = `${minDp.vehicle.brand} ${minDp.vehicle.model} maks. ${formatPct(maxPlafonPct, 0)}`;
    } else {
      $('dpMinText').innerHTML = isBelowMin
        ? `<strong>⚠ Di bawah minimal ${formatPct(minDp.minDpPct, 1)}</strong> (${formatRupiah(minDp.minDpAmount)})`
        : `<strong>✓ Minimal DP ${formatPct(minDp.minDpPct, 1)}</strong> (${formatRupiah(minDp.minDpAmount)})`;
      $('dpFactorsList').textContent = minDp.factors.map((f) => `${f.label} ${f.value}`).join(' • ');
    }
    $('btnApplyMinDp').hidden = !isBelowMin && Math.abs(active.dpPct - minDp.minDpPct) < 0.01;

    // Info Biaya Provisi & Fidusia
    $('provisiRpCaption').textContent =
      `Provisi = ${formatRupiah(active.creditFees.provisiAmount)} (${formatPct(state.provisiPct)} × ${state.provisiBasis === 'price' ? (refi ? 'Nilai Kendaraan' : 'Harga Kendaraan') : words.principalLabel})`;
    $('fidusiaBracketInfo').textContent = active.creditFees.fidusiaBracket;
    $('fidusiaFeeDisplay').textContent = formatRupiah(active.creditFees.fidusiaFee);
    const instCap = $('installmentTypeCaption');
    if (instCap) {
      instCap.textContent =
        active.installmentType === 'ADDM'
          ? words.addmCaption
          : 'Angsuran ke-1 dibayar 1 bulan pasca akad (sudah termasuk bunga).';
    }

    // KPI Cards
    $('kpiTenorLabel').textContent = `Angsuran / Bulan • Tenor ${active.tenorMonths} Bln`;
    $('kpiMonthlyInstallment').textContent = formatRupiah(active.monthlyInstallment);
    $('kpiRateInfo').textContent =
      `Bunga Flat ${formatPct(active.flatRatePa)} p.a. • Skema ${active.installmentType}`;
    $('kpiTotalDp').textContent = formatRupiah(upfrontTotal(active));
    $('kpiTdpSub').textContent = words.upfrontParts + withFirstInstallment;
    $('kpiPrincipalLoan').textContent = formatRupiah(active.principalLoan);
    $('kpiTotalInterestSub').textContent = `Total bunga kredit ${formatRupiah(active.totalInterest)}`;

    // 1. Tabel Simulasi Tenor
    renderTenorTable(suite.tenorResults, active.tenorMonths);

    // 2. Tabel Rincian TDP & Biaya Kredit + Tabel Asuransi per Tahun
    $('detailTenorSpan').textContent = active.tenorMonths;
    renderTdpTable(active);
    renderInsuranceTable(active.insurance);

    // 3. Tabel Jadwal Amortisasi & Anotasi Bulanan
    $('amortTenorSpan').textContent = active.tenorMonths;
    const amortRows = Calc.generateAmortizationSchedule(active);
    renderAmortizationTable(amortRows, active);

    if ($('refModalBackdrop') && $('refModalBackdrop').classList.contains('open')) {
      renderModalTabContent();
    }
  }

  function renderTenorTable(tenorResults, selectedTenor) {
    const tbody = $('tenorSummaryBody');
    const rateHeader = 'Suku Bunga Flat';
    const upfrontHeader = wording().upfrontColumn;
    $('thTenorUpfront').textContent = upfrontHeader;

    tbody.innerHTML = tenorResults
      .map((row) => {
        const isSel = row.tenorMonths === selectedTenor;
        const cls = ['clickable', isSel ? 'selected' : '', !row.isAvailable ? 'unavailable' : '']
          .filter(Boolean)
          .join(' ');
        return `
          <tr class="${cls}" data-tenor="${row.tenorMonths}" tabindex="${row.isAvailable ? '0' : '-1'}" aria-disabled="${!row.isAvailable}">
            <td>
              <strong>${row.tenorMonths} Bulan</strong>
              <span class="muted">(${row.tenorYears} thn)</span>
              ${isSel ? '<span class="tag tag-orange">Dipilih</span>' : ''}
              ${!row.isAvailable ? '<span class="tag tag-gray">Tidak tersedia</span>' : ''}
            </td>
            <td class="num strong text-blue" data-label="${rateHeader}">${formatPct(row.flatRatePa)}</td>
            <td class="num strong text-blue" data-label="Angsuran / Bulan">${formatRupiah(row.monthlyInstallment)}</td>
            <td class="num strong text-dark" data-label="${upfrontHeader}">${formatRupiah(upfrontTotal(row))}</td>
          </tr>
        `;
      })
      .join('');

    tbody.querySelectorAll('tr.clickable').forEach((tr) => {
      const select = () => {
        if (tr.classList.contains('unavailable')) return;
        state.selectedTenor = parseInt(tr.getAttribute('data-tenor'), 10);
        recalculateAndRender();
      };
      tr.addEventListener('click', select);
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          select();
        }
      });
    });
  }

  function renderTdpTable(active) {
    const fees = active.creditFees;
    const ins = active.insurance;
    const covLabel = ins.coverage.label.split(' (')[0];
    const isCollapsed = state.isCreditFeesCollapsed;
    const words = wording();
    // Refinancing tidak memiliki baris DP, sehingga penomoran dimulai dari premi asuransi
    let rowNo = 0;
    const dpRowHtml = isRefinancing()
      ? ''
      : `
      <tr>
        <td class="strong">${++rowNo}. Down Payment (DP Murni)</td>
        <td class="num strong">${formatRupiah(active.dpAmount)}</td>
        <td class="muted col-ket">${formatPct(active.dpPct, 2)} × ${formatRupiah(active.vehiclePrice)}</td>
      </tr>`;

    const rowsHtml = `${dpRowHtml}
      <tr>
        <td class="strong">${++rowNo}. Total Premi Asuransi</td>
        <td class="num strong">${formatRupiah(ins.totalPremium)}</td>
        <td class="muted col-ket">${covLabel} (${active.tenorYears} Tahun • ${state.vehicleType})</td>
      </tr>
      <tr class="subtotal-row" id="btnToggleCreditFees" style="cursor:pointer;" title="Klik untuk menampilkan atau menyembunyikan rincian biaya kredit">
        <td class="strong" style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
          <span>${++rowNo}. Total Biaya Kredit</span>
          <span class="tag tag-gray" style="font-size:0.68rem; font-weight:600; cursor:pointer;">${isCollapsed ? '▶ Buka Rincian' : '▼ Sembunyikan'}</span>
        </td>
        <td class="num strong">${formatRupiah(fees.totalCreditFees)}</td>
        <td class="col-ket"></td>
      </tr>
      <tr class="subrow fee-subrow" style="${isCollapsed ? 'display:none;' : ''}">
        <td style="padding-left:28px;">• Biaya Admin</td>
        <td class="num">${formatRupiah(fees.adminFee)}</td>
        <td class="col-ket"></td>
      </tr>
      <tr class="subrow fee-subrow" style="${isCollapsed ? 'display:none;' : ''}">
        <td style="padding-left:28px;">• Biaya Provisi</td>
        <td class="num">${formatRupiah(fees.provisiAmount)}</td>
        <td class="col-ket"></td>
      </tr>
      <tr class="subrow fee-subrow" style="${isCollapsed ? 'display:none;' : ''}">
        <td style="padding-left:28px;">• Biaya Polis</td>
        <td class="num">${formatRupiah(fees.polisFee)}</td>
        <td class="col-ket"></td>
      </tr>
      <tr class="subrow fee-subrow" style="${isCollapsed ? 'display:none;' : ''}">
        <td style="padding-left:28px;">• Biaya Fidusia</td>
        <td class="num">${formatRupiah(fees.fidusiaFee)}</td>
        <td class="col-ket"></td>
      </tr>
      <tr class="subrow fee-subrow" style="${isCollapsed ? 'display:none;' : ''}">
        <td style="padding-left:28px;">• Blokir BPKB</td>
        <td class="num">${formatRupiah(fees.blokirFee)}</td>
        <td class="col-ket"></td>
      </tr>
      ${
        active.firstInstallmentInTdp > 0
          ? `
        <tr>
          <td class="strong">${++rowNo}. Angsuran Ke-1 (ADDM)</td>
          <td class="num strong">${formatRupiah(active.firstInstallmentInTdp)}</td>
          <td class="muted col-ket">Dibayar di muka saat akad</td>
        </tr>`
          : ''
      }
    `;

    $('tdpTableBody').innerHTML = rowsHtml;
    $('tdpTableFoot').innerHTML = `
      <tr>
        <td>${words.upfrontTotalRow}</td>
        <td class="num strong text-dark">${formatRupiah(upfrontTotal(active))}</td>
        <td class="muted col-ket">${words.upfrontParts}${active.installmentType === 'ADDM' ? ' + Angsuran Ke-1' : ''}</td>
      </tr>
    `;

    const toggleBtn = $('btnToggleCreditFees');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        state.isCreditFeesCollapsed = !state.isCreditFeesCollapsed;
        renderTdpTable(active);
      });
    }
  }

  function renderInsuranceTable(insurance) {
    $('yearlyInsuranceBody').innerHTML = insurance.yearlyBreakdown
      .map((yr) => {
        const isAR = yr.coverageType === 'All Risk';
        let rateDetail =
          yr.perilRatePct > 0
            ? `${formatPct(yr.combinedRatePct, 3)} <span class="muted">(${formatPct(yr.baseRatePct)} + ${formatPct(yr.perilRatePct, 3)})</span>`
            : formatPct(yr.baseRatePct);
        if (yr.perilFixedAmount > 0) {
          rateDetail += ` <span class="muted">+ ${formatRupiah(yr.perilFixedAmount)}</span>`;
        }
        return `
          <tr>
            <td><strong>Tahun ${yr.year}</strong> <span class="muted">(Bln ${yr.monthRange})</span></td>
            <td class="num strong" data-label="Premi (Rp)">${formatRupiah(yr.yearTotalPremium)}</td>
            <td class="num" data-label="Pertanggungan">${formatRupiah(yr.insuredValue)}</td>
            <td class="num" data-label="Depresiasi">${yr.depreciationPct}%</td>
            <td class="col-ket" data-label="Coverage"><span class="tag ${isAR ? 'tag-blue' : 'tag-amber'}">${yr.coverageType}</span></td>
            <td class="num" data-label="Total Rate">${rateDetail}</td>
          </tr>
        `;
      })
      .join('');

    $('yearlyInsuranceFoot').innerHTML = `
      <tr>
        <td>TOTAL PREMI ASURANSI (${insurance.years} TAHUN)</td>
        <td class="num strong text-dark" data-label="Total Premi">${formatRupiah(insurance.totalPremium)}</td>
        <td colspan="4" class="muted col-ket hide-sm">Akumulasi premi tahun 1 s.d. tahun ${insurance.years}</td>
      </tr>
    `;
  }

  function renderAmortizationTable(rows, active) {
    const isADDM = active.installmentType === 'ADDM';
    const rateLabel = `Bunga Flat ${formatPct(active.flatRatePa)} p.a.`;
    const ruleLabel = isADDM
      ? 'ADDM: Bulan ke-1 tanpa bunga (100% Porsi Pokok), bunga dihitung mulai bulan ke-2'
      : 'ADDB: Bunga dihitung sejak bulan ke-1 dari sisa pokok pinjaman';
    $('amortSubtitleInfo').textContent = `${rateLabel} • ${ruleLabel}`;

    let tPrin = 0;
    let tInt = 0;
    let tPmt = 0;

    $('amortizationBody').innerHTML = rows
      .map((r) => {
        tPrin += r.principalPart;
        tInt += r.interestPart;
        tPmt += r.installment;
        return `
          <tr class="row-${r.badgeType}">
            <td><strong>${r.month}</strong></td>
            <td class="num hide-laptop">${formatRupiah(r.beginningBalance)}</td>
            <td class="num text-blue strong">${formatRupiah(r.principalPart)}</td>
            <td class="num">${formatRupiah(r.interestPart)}</td>
            <td class="num strong">${formatRupiah(r.installment)}</td>
            <td class="num">${formatRupiah(r.endingBalance)}</td>
          </tr>
        `;
      })
      .join('');

    $('amortizationFoot').innerHTML = `
      <tr>
        <td>TOTAL</td>
        <td class="num hide-laptop">-</td>
        <td class="num">${formatRupiah(tPrin)}</td>
        <td class="num">${formatRupiah(tInt)}</td>
        <td class="num">${formatRupiah(tPmt)}</td>
        <td class="num">Rp 0</td>
      </tr>
    `;
  }

  // ======================== MODAL TABEL REFERENSI & RATE ========================
  function segmentedHtml(id, options, activeValue) {
    return `
      <div class="segmented" id="${id}">
        ${options
          .map(
            (o) =>
              `<button type="button" data-value="${o.value}" class="${o.value === activeValue ? 'active' : ''}">${o.label}</button>`
          )
          .join('')}
      </div>
    `;
  }

  function bindSegmented(id, onChange) {
    const el = $(id);
    if (!el) return;
    el.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => onChange(btn.getAttribute('data-value')));
    });
  }

  function onSettingsChanged() {
    saveCustomSettings();
    updateSchemeUi();
    recalculateAndRender();
  }

  function renderModalTabContent() {
    const box = $('refModalContent');
    if (!box) return;
    const tab = state.activeModalTab;
    const schemeHeaders = SCHEME_IDS.map(
      (sId) =>
        `<th class="num">${state.schemes[sId].name}${sId === state.schemeId ? ' <span class="tag tag-orange">Aktif</span>' : ''}</th>`
    ).join('');

    if (tab === 'tabRates') {
      const finFilter = state.modalFinancing;
      const finList =
        finFilter === 'all'
          ? Config.FINANCING_TYPES.map((f) => f.value)
          : [finFilter];

      const rateTypes = [
        { key: 'interestRates', label: 'Bunga Flat p.a. (%)' },
        { key: 'effectiveRates', label: 'Bunga Efektif p.a. (%)' }
      ];

      const sectionsHtml = finList
        .map((fin) => {
          const finTenors = TENORS.filter((t) =>
            SCHEME_IDS.some((sId) => (state.schemes[sId].tenorsByFinancing[fin] || []).indexOf(t) !== -1)
          );
          return rateTypes
            .map((rt) => {
              const rows = finTenors.map((t) => {
                const cells = SCHEME_IDS.map((sId) => {
                  const sch = state.schemes[sId];
                  const allowed = (sch.tenorsByFinancing[fin] || []).indexOf(t) !== -1;
                  const val = ((sch[rt.key] || {})[fin] || {})[t];
                  return allowed
                    ? `<td class="num"><input type="number" step="0.01" min="0" max="50" class="rate-input js-rate"
                        data-rate-key="${rt.key}" data-fin="${fin}" data-scheme="${sId}" data-tenor="${t}" value="${val}" /></td>`
                    : '<td class="num muted">-</td>';
                }).join('');
                const isHl = fin === state.financingType && t === state.selectedTenor;
                return `<tr class="${isHl ? 'highlight' : ''}"><td><strong>${t} Bulan</strong> (${t / 12} Thn)</td>${cells}</tr>`;
              }).join('');

              return `
                <div class="modal-section">
                  <div class="modal-section-head">
                    <div><h4>${rt.label} — ${fin}</h4></div>
                  </div>
                  <div class="bordered">
                    <div class="table-wrap">
                      <table class="table">
                        <thead><tr><th>Tenor</th>${schemeHeaders}</tr></thead>
                        <tbody>${rows}</tbody>
                      </table>
                    </div>
                  </div>
                </div>
              `;
            })
            .join('');
        })
        .join('');

      const filterOpts = [{ value: 'all', label: 'Semua Pembiayaan' }].concat(
        Config.FINANCING_TYPES.map((f) => ({ value: f.value, label: f.value }))
      );

      box.innerHTML = `
        <div class="modal-section-head" style="margin-bottom:16px;">
          <div>
            <h4>Pengaturan Suku Bunga per Skema &amp; Jenis Pembiayaan</h4>
            <p>Default dari rates.csv. Perubahan di sini hanya tersimpan di browser ini.</p>
          </div>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            ${segmentedHtml('segModalFin', filterOpts, finFilter)}
            <button type="button" class="btn btn-ghost btn-xs" id="btnResetDefaultRates">↺ Reset Default</button>
          </div>
        </div>
        ${sectionsHtml}
      `;

      bindSegmented('segModalFin', (v) => {
        state.modalFinancing = v;
        renderModalTabContent();
      });

      box.querySelectorAll('.js-rate').forEach((inp) => {
        inp.addEventListener('change', () => {
          const key = inp.getAttribute('data-rate-key');
          const fin = inp.getAttribute('data-fin');
          const sId = inp.getAttribute('data-scheme');
          const t = parseInt(inp.getAttribute('data-tenor'), 10);
          state.schemes[sId][key][fin][t] = Math.max(0, parseFloat(inp.value) || 0);
          onSettingsChanged();
        });
      });

      bindResetButton();
    } else if (tab === 'tabFees') {
      const feeRows = [
        { key: 'defaultAdmin', label: 'Biaya Admin Default (Rp)', step: 50000 },
        { key: 'defaultProvisiPct', label: 'Biaya Provisi Default (%)', step: 0.05 },
        { key: 'defaultPolis', label: 'Biaya Polis Default (Rp)', step: 5000 },
        { key: 'blokir:New Car', label: 'Blokir BPKB — New Car (Rp)', step: 50000 },
        { key: 'blokir:Used Car', label: 'Blokir BPKB — Used Car (Rp)', step: 50000 },
        { key: 'blokir:Refinancing', label: 'Blokir BPKB — Refinancing (Rp)', step: 50000 },
        { key: 'blokir:Mobil Niaga', label: 'Blokir BPKB — Mobil Niaga (Rp)', step: 50000 }
      ];

      const getVal = (sch, key) =>
        key.indexOf('blokir:') === 0
          ? sch.defaultBlokirByFinancing[key.split(':')[1]] ?? 500000
          : sch[key];

      const rows = feeRows
        .map(
          (f) => `
          <tr>
            <td><strong>${f.label}</strong></td>
            ${SCHEME_IDS.map(
              (sId) => `<td class="num"><input type="number" step="${f.step}" class="rate-input js-fee"
                data-scheme="${sId}" data-key="${f.key}" value="${getVal(state.schemes[sId], f.key)}" style="max-width:130px;" /></td>`
            ).join('')}
          </tr>`
        )
        .join('');

      box.innerHTML = `
        <div class="modal-section">
          <div class="modal-section-head">
            <div>
              <h4>Biaya Default Masing-Masing Skema</h4>
              <p>Nilai otomatis yang terisi ketika tombol skema dipilih</p>
            </div>
            <button type="button" class="btn btn-ghost btn-xs" id="btnResetDefaultRates">↺ Reset Default</button>
          </div>
          <div class="bordered">
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>Komponen Biaya</th>${schemeHeaders}</tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="modal-section">
          <div class="modal-section-head"><div><h4>Pengaturan Basis Rumus</h4></div></div>
          <div class="settings-grid">
            <div class="field">
              <label class="label" for="selProvisiBasis">Basis Biaya Provisi (Rp)</label>
              <select id="selProvisiBasis" class="control">
                <option value="principal" ${state.provisiBasis === 'principal' ? 'selected' : ''}>Biaya Provisi (%) × Pokok Hutang</option>
                <option value="price" ${state.provisiBasis === 'price' ? 'selected' : ''}>Biaya Provisi (%) × Harga Kendaraan</option>
              </select>
            </div>
            <div class="field">
              <label class="label" for="selFidusiaBasis">Basis Nilai Penjaminan Fidusia</label>
              <select id="selFidusiaBasis" class="control">
                <option value="price" ${state.fidusiaBasis === 'price' ? 'selected' : ''}>Rentang Harga Kendaraan</option>
                <option value="principal" ${state.fidusiaBasis === 'principal' ? 'selected' : ''}>Rentang Pokok Hutang</option>
              </select>
            </div>
            <div class="field">
              <label class="label" for="selBracketBasis">Penentuan Rentang Rate Asuransi</label>
              <select id="selBracketBasis" class="control">
                <option value="depreciated" ${state.bracketBasis === 'depreciated' ? 'selected' : ''}>Nilai Pertanggungan Setelah Depresiasi</option>
                <option value="initial" ${state.bracketBasis === 'initial' ? 'selected' : ''}>Harga Kendaraan Awal</option>
              </select>
            </div>
          </div>
        </div>
      `;

      box.querySelectorAll('.js-fee').forEach((inp) => {
        inp.addEventListener('change', () => {
          const sId = inp.getAttribute('data-scheme');
          const key = inp.getAttribute('data-key');
          const sch = state.schemes[sId];
          const v = parseFloat(inp.value) || 0;
          if (key.indexOf('blokir:') === 0) {
            sch.defaultBlokirByFinancing[key.split(':')[1]] = Math.max(0, v);
          } else {
            sch[key] = Math.max(0, v);
          }
          if (sId === state.schemeId) {
            state.adminFee = sch.defaultAdmin;
            state.provisiPct = sch.defaultProvisiPct;
            state.polisFee = sch.defaultPolis;
            state.blokirFee =
              sch.defaultBlokirByFinancing[state.financingType] !== undefined
                ? sch.defaultBlokirByFinancing[state.financingType]
                : 500000;
            $('inputAdminFee').value = formatNumberId(state.adminFee);
            $('inputProvisiPct').value = state.provisiPct.toFixed(2).replace('.', ',');
            $('inputPolisFee').value = formatNumberId(state.polisFee);
            $('inputBlokirFee').value = formatNumberId(state.blokirFee);
          }
          onSettingsChanged();
        });
      });

      [
        ['selProvisiBasis', 'provisiBasis'],
        ['selFidusiaBasis', 'fidusiaBasis'],
        ['selBracketBasis', 'bracketBasis']
      ].forEach(([id, key]) => {
        $(id).addEventListener('change', (e) => {
          state[key] = e.target.value;
          onSettingsChanged();
        });
      });

      bindResetButton();
    } else if (tab === 'tabInsBase') {
      const wFilter = state.modalWilayah;
      const curRow = Calc.lookupBaseInsuranceRate(state.vehicleType, state.wilayah, state.vehiclePrice);
      const filteredRows = Config.INSURANCE_BASE_RATES.filter(
        (r) => wFilter === 'all' || r.wilayah === wFilter
      );

      const rows = filteredRows
        .map((r) => {
          const hl = r === curRow;
          return `
            <tr class="${hl ? 'highlight' : ''}">
              <td><strong>${r.type}</strong>${hl ? ' <span class="tag tag-orange">Aktif di Form</span>' : ''}</td>
              <td>Wilayah ${r.wilayah}</td>
              <td class="num">${r.from === 0 ? 'Rp 0' : formatRupiah(r.from)}</td>
              <td class="num">${r.to >= 99999999999 ? 'Tanpa batas' : formatRupiah(r.to)}</td>
              <td class="num strong">${formatPct(r.tlo)}</td>
              <td class="num strong text-blue">${formatPct(r.allRisk)}</td>
            </tr>`;
        })
        .join('');

      const wilOpts = [{ value: 'all', label: 'Semua Wilayah' }].concat(
        Config.WILAYAH_OPTIONS.map((o) => ({ value: o.value, label: o.shortLabel }))
      );

      box.innerHTML = `
        <div class="modal-section">
          <div class="modal-section-head">
            <div>
              <h4>Tabel Rate Dasar Asuransi Kendaraan Bermotor (TLO &amp; All Risk)</h4>
              <p>Wilayah 1: Sumatera • Wilayah 2: DKI Jakarta &amp; Banten • Wilayah 3: Selain Wilayah 1 &amp; 2</p>
            </div>
            ${segmentedHtml('segModalWil', wilOpts, wFilter)}
          </div>
          <div class="bordered">
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th>Tipe Kendaraan</th>
                    <th>Wilayah</th>
                    <th class="num">Rentang Dari</th>
                    <th class="num">Sampai Dengan</th>
                    <th class="num">Rate TLO</th>
                    <th class="num">Rate All Risk</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </div>
        </div>
      `;

      bindSegmented('segModalWil', (v) => {
        state.modalWilayah = v;
        renderModalTabContent();
      });
    } else if (tab === 'tabInsPeril') {
      const perilRows = Config.INSURANCE_PERILS.map(
        (p) => `
        <tr>
          <td><strong>${p.label}</strong></td>
          ${['All Risk', 'TLO'].map((cov) => ['1', '2', '3'].map((w) => `<td class="num">${p.fixed ? formatRupiah(p.rates[cov][w]) : formatPct(p.rates[cov][w], 3)}</td>`).join('')).join('')}
        </tr>`
      ).join('');

      const depRows = Object.keys(Config.DEPRECIATION_BY_YEAR)
        .map((yr) => {
          const d = Config.DEPRECIATION_BY_YEAR[yr];
          return `
            <tr>
              <td><strong>Tahun ke-${yr}</strong></td>
              <td class="num">Tenor ${d.tenorMonths} Bulan</td>
              <td class="num strong">${d.ratePct}%</td>
              <td class="num">${formatRupiah((state.vehiclePrice * d.ratePct) / 100)}</td>
            </tr>`;
        })
        .join('');

      box.innerHTML = `
        <div class="modal-section">
          <div class="modal-section-head">
            <div>
              <h4>Tabel Syarat Klaim / Perluasan Jaminan Asuransi</h4>
              <p>Rate tambahan per tahun berdasarkan Wilayah (1 / 2 / 3) dan jenis Coverage (All Risk / TLO); TJH berupa nominal tetap per tahun</p>
            </div>
          </div>
          <div class="bordered">
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th rowspan="2">Jenis Perluasan Klaim</th>
                    <th class="num" colspan="3" style="text-align:center;">All Risk</th>
                    <th class="num" colspan="3" style="text-align:center;">TLO</th>
                  </tr>
                  <tr>
                    <th class="num">Wilayah 1</th><th class="num">Wilayah 2</th><th class="num">Wilayah 3</th>
                    <th class="num">Wilayah 1</th><th class="num">Wilayah 2</th><th class="num">Wilayah 3</th>
                  </tr>
                </thead>
                <tbody>${perilRows}</tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="modal-section">
          <div class="modal-section-head">
            <div>
              <h4>Tabel Rumus Depresiasi Nilai Pertanggungan</h4>
              <p>Simulasi otomatis terhadap harga kendaraan saat ini (${formatRupiah(state.vehiclePrice)})</p>
            </div>
          </div>
          <div class="bordered">
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th>Tahun Berjalan</th>
                    <th class="num">Tenor (Bulan)</th>
                    <th class="num">Persentase Depresiasi</th>
                    <th class="num">Nilai Pertanggungan</th>
                  </tr>
                </thead>
                <tbody>${depRows}</tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    } else if (tab === 'tabFidusia') {
      const basis =
        state.fidusiaBasis === 'principal' && lastSuiteResult
          ? lastSuiteResult.activeResult.principalLoan
          : state.vehiclePrice;
      const rows = Config.FIDUSIA_TABLE.map((f) => {
        const hl = basis >= f.from && basis <= f.to;
        return `
          <tr class="${hl ? 'highlight' : ''}">
            <td><strong>${f.label}</strong></td>
            <td class="num">${f.from === 0 ? 'Rp 0' : formatRupiah(f.from)}</td>
            <td class="num">${f.to === Infinity ? 'Tanpa batas' : formatRupiah(f.to)}</td>
            <td class="num strong text-blue">${formatRupiah(f.fee)} ${hl ? '<span class="tag tag-orange">Sesuai Input</span>' : ''}</td>
          </tr>`;
      }).join('');

      box.innerHTML = `
        <div class="modal-section">
          <div class="modal-section-head">
            <div>
              <h4>Tabel Biaya Netto Fidusia Berdasarkan Nilai Penjaminan</h4>
              <p>Nilai penjaminan saat ini: ${formatRupiah(basis)} (${state.fidusiaBasis === 'price' ? 'Harga Kendaraan' : 'Pokok Hutang'})</p>
            </div>
          </div>
          <div class="bordered">
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th>Rentang Nilai Penjaminan</th>
                    <th class="num">Dari</th>
                    <th class="num">Sampai Dengan</th>
                    <th class="num">Biaya Netto Fidusia</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }
  }

  function bindResetButton() {
    const btn = $('btnResetDefaultRates');
    if (!btn) return;
    btn.addEventListener('click', () => {
      state.schemes = cloneDeep(Config.DEFAULT_SCHEMES);
      state.provisiBasis = 'principal';
      state.fidusiaBasis = 'price';
      state.bracketBasis = 'depreciated';
      saveCustomSettings();
      applySchemeDefaults(state.schemeId);
      renderModalTabContent();
    });
  }

  function openModal() {
    if (!$('refModalBackdrop')) return;
    renderModalTabContent();
    $('refModalBackdrop').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    if (!$('refModalBackdrop')) return;
    $('refModalBackdrop').classList.remove('open');
    document.body.style.overflow = '';
  }

  // ======================== EVENT LISTENERS ========================
  function updateDpFromPrice() {
    if (state.dpMode === 'pct') {
      state.dpAmount = Math.round((state.vehiclePrice * state.dpPct) / 100);
    } else {
      state.dpAmount = Math.min(state.dpAmount, state.vehiclePrice);
      state.dpPct = state.vehiclePrice > 0 ? (state.dpAmount / state.vehiclePrice) * 100 : 0;
    }
  }

  function bindEvents() {
    root().querySelectorAll('.scheme-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        applySchemeDefaults(btn.getAttribute('data-scheme'));
        notifySchemeChange();
      });
    });

    $('inputWilayah').addEventListener('change', (e) => {
      state.wilayah = e.target.value;
      renderPerilCheckboxes();
      recalculateAndRender();
    });

    $('inputFinancingType').addEventListener('change', (e) => {
      state.financingType = e.target.value;
      syncVehicleTypeFromFinancing();
      const sch = state.schemes[state.schemeId];
      state.blokirFee =
        sch.defaultBlokirByFinancing &&
        sch.defaultBlokirByFinancing[state.financingType] !== undefined
          ? sch.defaultBlokirByFinancing[state.financingType]
          : 500000;
      $('inputBlokirFee').value = formatNumberId(state.blokirFee);
      ensureTenorAllowed();
      syncDpInputField(); // isi kolom berganti antara DP dan Plafon Pinjaman
      updateSchemeUi();
      recalculateAndRender();
    });

    $('inputBrand').addEventListener('change', (e) => {
      state.brandValue = e.target.value;
      state.modelValue = '';
      populateModels();
      applyMinimumDp();
      recalculateAndRender();
    });
    $('inputModel').addEventListener('change', (e) => {
      state.modelValue = e.target.value;
      applyMinimumDp();
      recalculateAndRender();
    });

    const elPrice = $('inputVehiclePrice');
    elPrice.addEventListener('input', () => {
      state.vehiclePrice = parseDigits(elPrice.value);
      elPrice.value = state.vehiclePrice > 0 ? formatNumberId(state.vehiclePrice) : '';
      updateDpFromPrice();
      if (state.dpMode === 'rp') syncDpInputField();
      recalculateAndRender();
    });

    root().querySelectorAll('.chip[data-price]').forEach((chip) => {
      chip.addEventListener('click', () => {
        state.vehiclePrice = parseInt(chip.getAttribute('data-price'), 10);
        elPrice.value = formatNumberId(state.vehiclePrice);
        updateDpFromPrice();
        syncDpInputField();
        recalculateAndRender();
      });
    });

    $('btnDpModePct').addEventListener('click', () => {
      state.dpMode = 'pct';
      syncDpInputField();
    });
    $('btnDpModeRp').addEventListener('click', () => {
      state.dpMode = 'rp';
      syncDpInputField();
    });

    const elDp = $('inputDpValue');
    elDp.addEventListener('input', () => {
      // Refinancing: angka yang diketik adalah Plafon Pinjaman, DP internal = sisanya
      const refi = isRefinancing();
      if (state.dpMode === 'pct') {
        const typed = parseDecimalId(elDp.value);
        state.dpPct = refi ? Math.min(100, Math.max(0, 100 - typed)) : Math.min(95, Math.max(0, typed));
        state.dpAmount = Math.round((state.vehiclePrice * state.dpPct) / 100);
      } else {
        const typed = Math.min(state.vehiclePrice, parseDigits(elDp.value));
        state.dpAmount = refi ? state.vehiclePrice - typed : typed;
        state.dpPct = state.vehiclePrice > 0 ? (state.dpAmount / state.vehiclePrice) * 100 : 0;
        elDp.value = typed > 0 ? formatNumberId(typed) : '';
      }
      recalculateAndRender();
    });

    $('btnApplyMinDp').addEventListener('click', () => {
      applyMinimumDp();
      recalculateAndRender();
    });

    $('inputCoverage').addEventListener('change', (e) => {
      state.coverageValue = e.target.value;
      renderPerilCheckboxes();
      recalculateAndRender();
    });

    $('btnSelectAllPerils').addEventListener('click', () => {
      state.selectedPerils =
        state.selectedPerils.length === Config.INSURANCE_PERILS.length
          ? []
          : Config.INSURANCE_PERILS.map((p) => p.id);
      renderPerilCheckboxes();
      recalculateAndRender();
    });

    [
      ['inputAdminFee', 'adminFee'],
      ['inputPolisFee', 'polisFee'],
      ['inputBlokirFee', 'blokirFee']
    ].forEach(([id, key]) => {
      const el = $(id);
      el.addEventListener('input', () => {
        state[key] = parseDigits(el.value);
        el.value = formatNumberId(state[key]);
        recalculateAndRender();
      });
    });

    $('inputProvisiPct').addEventListener('input', (e) => {
      state.provisiPct = Math.min(20, Math.max(0, parseDecimalId(e.target.value)));
      recalculateAndRender();
    });

    $('inputInstallmentType').addEventListener('change', (e) => {
      state.installmentType = e.target.value;
      updateSchemeUi();
      recalculateAndRender();
    });

    const btnToggleIns = $('btnToggleInsurance');
    if (btnToggleIns) {
      btnToggleIns.addEventListener('click', () => {
        const wrap = $('wrapYearlyInsurance');
        const arrow = $('insArrowText');
        const isHidden = wrap.style.display === 'none';
        wrap.style.display = isHidden ? 'block' : 'none';
        if (arrow) arrow.textContent = isHidden ? '▼ Sembunyikan' : '▶ Buka Rincian';
      });
    }

    // Reset Form
    $('btnResetForm').addEventListener('click', () => {
      Object.assign(state, {
        wilayah: '2',
        financingType: 'New Car',
        vehicleType: 'Non Bus dan Non Truk',
        brandValue: 'TOYOTA',
        modelValue: 'AVANZA',
        vehiclePrice: 350000000,
        dpMode: 'pct',
        coverageValue: 'Kombinasi#1',
        selectedPerils: ['banjir'],
        installmentType: 'ADDB',
        selectedTenor: 36
      });
      $('inputWilayah').value = state.wilayah;
      $('inputFinancingType').value = state.financingType;
      populateStaticDropdowns();
      applyMinimumDp();
      $('inputVehiclePrice').value = formatNumberId(state.vehiclePrice);
      $('inputCoverage').value = state.coverageValue;
      $('inputInstallmentType').value = state.installmentType;
      renderPerilCheckboxes();
      applySchemeDefaults('regular');
      notifySchemeChange();
    });

    // Modal (jika ada tombol & modal di halaman)
    if ($('btnOpenRefModal')) $('btnOpenRefModal').addEventListener('click', openModal);
    if ($('btnCloseRefModal')) $('btnCloseRefModal').addEventListener('click', closeModal);
    if ($('refModalBackdrop')) {
      $('refModalBackdrop').addEventListener('click', (e) => {
        if (e.target === $('refModalBackdrop')) closeModal();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && $('refModalBackdrop').classList.contains('open')) closeModal();
      });
    }

    document.querySelectorAll('.modal-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.modal-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.activeModalTab = btn.getAttribute('data-tab');
        renderModalTabContent();
        $('refModalContent').scrollTop = 0;
      });
    });
  }

  // ======================== INIT ========================
  async function init() {
    const controls = [...root().querySelectorAll('button, input, select')];
    controls.forEach((control) => { control.disabled = true; });
    const status = $('simulationNotice');
    status.hidden = false;
    status.textContent = 'Memuat database dari Google Spreadsheet...';
    try {
      let loadedFromApi = false;
      const urlParams = new URLSearchParams(window.location.search);
      const forceCsv = urlParams.get('source') === 'csv';

      const endpoint = Config.getApiEndpoint ? Config.getApiEndpoint() : Config.API_ENDPOINT;
      const token = Config.getApiToken ? Config.getApiToken() : '';

      if (endpoint && !forceCsv) {
        try {
          // Mengirim request via HTTP POST dengan Token di dalam amplop (Body/Payload)
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'text/plain;charset=utf-8'
            },
            body: JSON.stringify({ token: token })
          });

          if (res.ok) {
            const data = await res.json();
            if (data.status === 'error' || data.error) {
              console.warn('Otorisasi POST API ditolak oleh Google Apps Script:', data.message);
            } else if (data && data.vehicles && data.vehicles.length && data.rates && data.rates.length) {
              global.KKBConfig.updateFromApi(data);
              global.KKBVehicles.loadJson(data.vehicles);
              global.KKBRates.loadJson(data.rates);
              loadedFromApi = true;
              console.log(
                `Database berhasil dimuat via POST dari Google Spreadsheet (${data.vehicles.length} mobil, ${data.rates.length} baris suku bunga).`
              );
            }
          }
        } catch (apiErr) {
          console.warn('Gagal memuat via POST dari Google Spreadsheet, beralih ke cadangan lokal:', apiErr);
        }
      }

      if (!loadedFromApi) {
        status.textContent = 'Memuat data cadangan lokal (vehicles.csv, rates.csv)...';
        await Promise.all([global.KKBVehicles.load(), global.KKBRates.load()]);
      }

      state.schemes = cloneDeep(Config.DEFAULT_SCHEMES);
      loadSavedSettings();
      populateStaticDropdowns();
      renderPerilCheckboxes();
      bindEvents();
      applySchemeDefaults(state.schemeId);
      isReady = true;
      status.hidden = true;
      status.textContent = '';
      controls.forEach((control) => { control.disabled = false; });
    } catch (error) {
      status.hidden = false;
      status.textContent = `Data gagal dimuat: ${error.message} Jalankan melalui Live Server atau hosting HTTP, lalu periksa vehicles.csv / rates.csv dan muat ulang halaman.`;
      root().querySelector('.results').querySelectorAll('section').forEach((section) => { section.hidden = true; });
    }
  }

  // Sinkron dengan tab produk KPR / KKB di header (script.js): link tab KKB membuka skema terakhir
  function notifySchemeChange() {
    if (typeof global.onKKBSchemeChange === 'function') global.onKKBSchemeChange(state.schemeId);
  }
  global.KKBApp = {
    setScheme(schemeId) {
      if (SCHEME_IDS.indexOf(schemeId) === -1) return;
      if (!isReady) { state.schemeId = schemeId; return; }
      if (schemeId !== state.schemeId) applySchemeDefaults(schemeId);
    },
    getScheme: () => state.schemeId
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
