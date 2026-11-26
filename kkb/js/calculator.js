/**
 * Mesin Perhitungan Finansial & Asuransi KKB
 * Mengimplementasikan seluruh rumus spesifikasi KKB:
 * 1. TDP = DP + Asuransi + Biaya Kredit (+ Angsuran ke-1 bila ADDM aktif)
 * 2. Biaya Kredit = Admin + Provisi (Rp) + Polis + Fidusia + Blokir BPKB
 * 3. Biaya Provisi (Rp) = Biaya Provisi (%) * Pokok Hutang (atau Harga Kendaraan)
 * 4. Biaya Fidusia = Lookup tabel Nilai Penjaminan
 * 5. Premi Asuransi = Multi-tahun dengan Rate Dasar + Perluasan Klaim * Nilai Pertanggungan Terdepresiasi
 * 6. Jadwal Angsuran Bulanan (aplikasi selalu memakai rumus anuitas + Bunga Efektif, yang ditampilkan
 *    Bunga Flat; khusus ADDM bulan ke-1 tanpa porsi bunga)
 */
(function (global) {
  'use strict';

  const Config = global.KKBConfig;

  /** Minimum DP hanya berdasarkan pasangan merk dan model yang terdaftar. */
  function calculateMinDP(params) {
    const { brandValue, modelValue, vehiclePrice = 0 } = params;
    const vehicle = global.KKBVehicles.find(brandValue, modelValue);
    if (!vehicle) throw new RangeError('Merk dan tipe kendaraan tidak terdaftar.');
    const minDpPct = vehicle.minDpPct;
    const minDpAmount = Math.round((Math.max(0, vehiclePrice) * minDpPct) / 100);
    return {
      minDpPct,
      minDpAmount,
      basePct: minDpPct,
      vehicle,
      factors: [{ label: `${vehicle.brand} ${vehicle.model}`, value: `${minDpPct}%` }]
    };
  }

  /**
   * Lookup Biaya Fidusia berdasarkan Nilai Penjaminan (default: Harga Kendaraan)
   */
  function calculateFidusia(basisAmount) {
    const val = Math.max(0, Math.round(basisAmount || 0));
    if (val === 0) {
      return { fee: 0, bracketLabel: '-', basisAmount: 0 };
    }
    for (let i = 0; i < Config.FIDUSIA_TABLE.length; i++) {
      const row = Config.FIDUSIA_TABLE[i];
      if (val >= row.from && val <= row.to) {
        return {
          fee: row.fee,
          bracketLabel: row.label,
          basisAmount: val
        };
      }
    }
    const last = Config.FIDUSIA_TABLE[Config.FIDUSIA_TABLE.length - 1];
    return {
      fee: last.fee,
      bracketLabel: last.label,
      basisAmount: val
    };
  }

  /**
   * Lookup Rate Dasar Asuransi (All Risk & TLO) berdasarkan Tipe, Wilayah, dan Harga/Nilai Pertanggungan
   */
  function lookupBaseInsuranceRate(vehicleType, wilayah, lookupAmount) {
    const w = String(wilayah || '2');
    const val = Math.max(0, Math.round(lookupAmount || 0));

    const matchingRows = Config.INSURANCE_BASE_RATES.filter(
      (r) => r.type === vehicleType && r.wilayah === w
    );

    if (matchingRows.length === 0) {
      return { tlo: 0.38, allRisk: 2.08, from: 0, to: 0 };
    }

    for (let i = 0; i < matchingRows.length; i++) {
      const row = matchingRows[i];
      if (val >= row.from && val <= row.to) {
        return row;
      }
    }

    return matchingRows[matchingRows.length - 1];
  }

  /**
   * Menghitung Premi Asuransi Multi-Tahun lengkap dengan Depresiasi & Perluasan Klaim
   */
  function calculateInsuranceForTenor(params) {
    const {
      vehiclePrice = 0,
      wilayah = '2',
      vehicleType = 'Non Bus dan Non Truk',
      coverageValue = 'AllRisk',
      selectedPerils = [],
      tenorMonths = 36,
      bracketBasis = 'depreciated' // 'depreciated' (Nilai Pertanggungan tahun berjalan) atau 'initial' (Harga Awal)
    } = params;

    const years = Math.max(1, Math.ceil(tenorMonths / 12));
    const coverageObj =
      Config.COVERAGE_OPTIONS.find((c) => c.value === coverageValue) || Config.COVERAGE_OPTIONS[0];

    const yearlyBreakdown = [];
    let totalBasePremium = 0;
    let totalPerilPremium = 0;
    let totalPremium = 0;

    for (let yr = 1; yr <= years; yr++) {
      const depEntry = Config.DEPRECIATION_BY_YEAR[yr] || { tenorMonths: yr * 12, ratePct: 50 };
      const depPct = depEntry.ratePct;
      const insuredValue = (vehiclePrice * depPct) / 100;
      const yearCoverageType = yr <= coverageObj.allRiskYears ? 'All Risk' : 'TLO';

      const bracketLookupValue = bracketBasis === 'initial' ? vehiclePrice : insuredValue;
      const rateRow = lookupBaseInsuranceRate(vehicleType, wilayah, bracketLookupValue);
      const baseRatePct = yearCoverageType === 'All Risk' ? rateRow.allRisk : rateRow.tlo;

      let perilRatePct = 0;
      let perilFixedAmount = 0;
      const activePerils = [];

      selectedPerils.forEach((perilId) => {
        const perilDef = Config.INSURANCE_PERILS.find((p) => p.id === perilId);
        if (perilDef && perilDef.rates[yearCoverageType]) {
          const r = perilDef.rates[yearCoverageType][String(wilayah)] || 0;
          if (perilDef.fixed) perilFixedAmount += r;
          else perilRatePct += r;
          activePerils.push({
            id: perilDef.id,
            label: perilDef.label,
            code: `${perilDef.codePrefix}${wilayah}${yearCoverageType}`,
            fixed: !!perilDef.fixed,
            ratePct: perilDef.fixed ? 0 : r,
            amount: perilDef.fixed ? r : Math.round((insuredValue * r) / 100)
          });
        }
      });

      const combinedRatePct = baseRatePct + perilRatePct;
      const basePremium = Math.round((insuredValue * baseRatePct) / 100);
      const perilPremium = Math.round((insuredValue * perilRatePct) / 100) + perilFixedAmount;
      const yearTotalPremium = basePremium + perilPremium;

      totalBasePremium += basePremium;
      totalPerilPremium += perilPremium;
      totalPremium += yearTotalPremium;

      yearlyBreakdown.push({
        year: yr,
        monthRange: `${(yr - 1) * 12 + 1} – ${Math.min(yr * 12, tenorMonths)}`,
        depreciationPct: depPct,
        insuredValue,
        coverageType: yearCoverageType,
        baseRatePct,
        perilRatePct,
        perilFixedAmount,
        combinedRatePct,
        basePremium,
        perilPremium,
        yearTotalPremium,
        activePerils,
        rateBracket: rateRow
      });
    }

    return {
      coverage: coverageObj,
      years,
      yearlyBreakdown,
      totalBasePremium,
      totalPerilPremium,
      totalPremium
    };
  }

  /**
   * Menghitung Komponen Biaya Kredit:
   * Biaya Kredit = Admin + Provisi (Rp) + Polis + Fidusia + Blokir BPKB
   */
  function calculateCreditFees(params) {
    const {
      vehiclePrice = 0,
      principalLoan = 0,
      adminFee = 0,
      provisiPct = 0,
      polisFee = 0,
      blokirFee = 0,
      provisiBasis = 'principal', // 'principal' = Biaya Provisi (%) * Pokok Hutang (sesuai spesifikasi), 'price' = * Harga Kendaraan
      fidusiaBasis = 'price' // 'price' = Harga Kendaraan, 'principal' = Pokok Hutang
    } = params;

    const provisiBaseAmount = provisiBasis === 'price' ? vehiclePrice : principalLoan;
    const provisiAmount = Math.round((provisiBaseAmount * provisiPct) / 100);

    const fidusiaBaseAmount = fidusiaBasis === 'principal' ? principalLoan : vehiclePrice;
    const fidusia = calculateFidusia(fidusiaBaseAmount);

    const totalCreditFees =
      Math.round(adminFee) +
      provisiAmount +
      Math.round(polisFee) +
      fidusia.fee +
      Math.round(blokirFee);

    return {
      adminFee: Math.round(adminFee),
      provisiPct,
      provisiBaseAmount,
      provisiAmount,
      polisFee: Math.round(polisFee),
      fidusiaFee: fidusia.fee,
      fidusiaBracket: fidusia.bracketLabel,
      fidusiaBaseAmount,
      blokirFee: Math.round(blokirFee),
      totalCreditFees
    };
  }

  /**
   * Mencari Suku Bunga Efektif / Anuitas Tahunan (p.a.) yang menghasilkan angsuran bulanan sama persis
   * dengan perhitungan Bunga Flat KKB (menggunakan metode iterasi Newton-Raphson setara fungsi RATE Excel).
   */
  function solveEffectiveAnnualRate(nMonths, monthlyInstallment, principal, isADDM) {
    if (principal <= 0 || nMonths <= 0 || monthlyInstallment <= 0) {
      return 0;
    }
    const totalPaid = monthlyInstallment * nMonths;
    if (totalPaid <= principal) {
      return 0;
    }

    // Jika ADDM, angsuran pertama dibayar saat akad (t=0), sehingga sisa n-1 angsuran melunasi (principal - pmt)
    const n = isADDM ? nMonths - 1 : nMonths;
    const pv = isADDM ? principal - monthlyInstallment : principal;

    if (n <= 0 || pv <= 0) {
      return 0;
    }

    // Tebakan awal suku bunga bulanan r
    let r = ((totalPaid / principal - 1) / nMonths) * 1.8;
    if (r <= 0) r = 0.005;

    for (let iter = 0; iter < 60; iter++) {
      const pow = Math.pow(1 + r, -n);
      const f = monthlyInstallment * ((1 - pow) / r) - pv;
      const df =
        monthlyInstallment *
        ((n * Math.pow(1 + r, -n - 1) * r - (1 - pow)) / (r * r));

      if (Math.abs(df) < 1e-12) break;
      const nextR = r - f / df;
      if (Math.abs(nextR - r) < 1e-10) {
        r = nextR;
        break;
      }
      r = Math.max(1e-7, nextR);
    }

    return r * 12 * 100; // dalam persen p.a.
  }

  /**
   * Menghitung simulasi lengkap untuk satu Tenor tertentu
   */
  function calculateForTenor(params) {
    const {
      schemeId = 'regular',
      financingType = 'New Car',
      wilayah = '2',
      vehicleType,
      vehiclePrice = 0,
      dpAmount = 0,
      coverageValue = 'AllRisk',
      selectedPerils = [],
      adminFee = 0,
      provisiPct = 0,
      polisFee = 0,
      blokirFee = 0,
      tenorMonths = 36,
      rateType = 'efektif', // 'efektif' (Anuitas) atau 'flat'
      installmentType = 'ADDB', // 'ADDB' (default: TDP = DP + Asuransi + Biaya Kredit) atau 'ADDM'
      provisiBasis = 'principal',
      fidusiaBasis = 'price',
      bracketBasis = 'depreciated',
      schemes = Config.DEFAULT_SCHEMES
    } = params;

    const resolvedVehicleType =
      vehicleType ||
      (Config.VEHICLE_TYPE_BY_FINANCING && Config.VEHICLE_TYPE_BY_FINANCING[financingType]) ||
      'Non Bus dan Non Truk';

    const scheme = schemes[schemeId] || Config.DEFAULT_SCHEMES.regular;
    const safePrice = Math.max(0, vehiclePrice);
    const safeDp = Math.min(safePrice, Math.max(0, dpAmount));
    const dpPct = safePrice > 0 ? (safeDp / safePrice) * 100 : 0;
    const principalLoan = Math.max(0, safePrice - safeDp); // Pokok Hutang Murni

    // Suku bunga flat p.a. dan efektif p.a. dari rates.csv. ADDM memakai tabelnya sendiri
    // (bunga flat ADDM lebih rendah daripada ADDB untuk bunga efektif yang sama).
    const isADDM = installmentType === 'ADDM';
    const flatRates = getRateTable(scheme, 'interestRates', financingType, isADDM);
    const effRates = getRateTable(scheme, 'effectiveRates', financingType, isADDM);
    // Bunga flat adalah yang ditampilkan ke debitur. Bila tabel flat kosong untuk tenor ini,
    // nilainya diturunkan dari bunga efektif (konversi "EFEKTIF KE FLAT").
    let flatRatePa = Number(flatRates[tenorMonths]) || 0;
    if (flatRates[tenorMonths] === undefined && effRates[tenorMonths] !== undefined && global.KKBRates) {
      flatRatePa = Number(
        global.KKBRates.effectiveToFlat(Number(effRates[tenorMonths]), tenorMonths, isADDM).toFixed(2)
      );
    }
    const activeRateType = rateType === 'flat' ? 'flat' : 'efektif';

    // Hitung bunga efektif terlebih dahulu (dari rates.csv, atau ekuivalen flat bila tidak tersedia)
    const tenorYears = tenorMonths / 12;
    const rawFlatInterest = Math.round(principalLoan * (flatRatePa / 100) * tenorYears);
    const flatMonthlyInstallment =
      tenorMonths > 0 ? Math.round((principalLoan + rawFlatInterest) / tenorMonths) : 0;
    const effectiveRatePa =
      effRates[tenorMonths] !== undefined
        ? Number(effRates[tenorMonths])
        : solveEffectiveAnnualRate(tenorMonths, flatMonthlyInstallment, principalLoan, isADDM);

    // Angsuran per Bulan sesuai pilihan Jenis Suku Bunga (Efektif vs Flat) & Skema (ADDB vs ADDM)
    let monthlyInstallment = 0;
    if (principalLoan > 0 && tenorMonths > 0) {
      if (activeRateType === 'flat') {
        monthlyInstallment = flatMonthlyInstallment;
      } else {
        const r = effectiveRatePa / 100 / 12;
        if (r <= 0) {
          monthlyInstallment = Math.round(principalLoan / tenorMonths);
        } else if (isADDM) {
          // Annuity Due (ADDM): angsuran ke-1 saat akad tanpa bunga
          monthlyInstallment = Math.round(
            (principalLoan * r) / ((1 - Math.pow(1 + r, -tenorMonths)) * (1 + r))
          );
        } else {
          // Ordinary Annuity (ADDB): angsuran ke-1 dibayar 1 bulan pasca akad (ada bunga bln ke-1)
          monthlyInstallment = Math.round(
            (principalLoan * r) / (1 - Math.pow(1 + r, -tenorMonths))
          );
        }
      }
    }

    const totalLoanWithInterest = monthlyInstallment * tenorMonths;
    const totalInterest = Math.max(0, totalLoanWithInterest - principalLoan);
    const monthlyPrincipalFlat = tenorMonths > 0 ? principalLoan / tenorMonths : 0;
    const monthlyInterestFlat = tenorMonths > 0 ? totalInterest / tenorMonths : 0;

    // Asuransi sesuai tenor
    const insurance = calculateInsuranceForTenor({
      vehiclePrice: safePrice,
      wilayah,
      vehicleType: resolvedVehicleType,
      coverageValue,
      selectedPerils,
      tenorMonths,
      bracketBasis
    });

    // Biaya Kredit
    const creditFees = calculateCreditFees({
      vehiclePrice: safePrice,
      principalLoan,
      adminFee,
      provisiPct,
      polisFee,
      blokirFee,
      provisiBasis,
      fidusiaBasis
    });

    const firstInstallmentInTdp = isADDM ? monthlyInstallment : 0;

    // Rumus Utama TDP = DP + Asuransi + Biaya Kredit (+ Angsuran ke-1 bila ADDM)
    const totalDp =
      Math.round(safeDp) +
      insurance.totalPremium +
      creditFees.totalCreditFees +
      firstInstallmentInTdp;

    // Biaya awal tanpa DP (dipakai Refinancing, yang tidak memiliki DP)
    const totalUpfrontFees = totalDp - Math.round(safeDp);

    const remainingInstallmentsTotal = isADDM
      ? monthlyInstallment * Math.max(0, tenorMonths - 1)
      : monthlyInstallment * tenorMonths;

    const grandTotalOutflow = totalDp + remainingInstallmentsTotal;

    const allowedTenors = getAllowedTenors(scheme, financingType);
    const isAvailable = allowedTenors.indexOf(tenorMonths) !== -1;

    return {
      schemeId,
      schemeName: scheme.name,
      tenorMonths,
      tenorYears,
      isAvailable,
      vehiclePrice: safePrice,
      dpAmount: Math.round(safeDp),
      dpPct,
      principalLoan,
      rateType: activeRateType,
      flatRatePa,
      effectiveRatePa,
      totalInterest,
      totalLoanWithInterest,
      monthlyPrincipalFlat,
      monthlyInterestFlat,
      monthlyInstallment,
      installmentType,
      firstInstallmentInTdp,
      insurance,
      creditFees,
      totalDp,
      totalUpfrontFees,
      grandTotalOutflow
    };
  }

  /**
   * Menghasilkan Jadwal Angsuran Bulanan sesuai pilihan Jenis Bunga (Efektif / Flat) & Skema (ADDB / ADDM):
   * - Khusus ADDM di bulan ke-1 : seluruh angsuran menjadi Porsi Pokok (Porsi Bunga = 0)
   * - ADDB sejak bulan ke-1 (serta ADDM mulai bulan ke-2) : dikenakan Porsi Bunga sesuai metode (Efektif / Flat)
   * - Bulan terakhir : Porsi Pokok = sisa pokok sehingga pinjaman lunas hingga Rp 0
   */
  function generateAmortizationSchedule(tenorResult, modeOverride) {
    const n = tenorResult.tenorMonths;
    const principal = tenorResult.principalLoan;
    const pmt = tenorResult.monthlyInstallment;
    const isADDM = tenorResult.installmentType === 'ADDM';
    const rateMode = modeOverride || tenorResult.rateType || 'efektif';
    const useEffective = rateMode !== 'flat';
    const rMonthly = tenorResult.effectiveRatePa / 100 / 12;
    const yearlyIns = tenorResult.insurance.yearlyBreakdown;

    const rows = [];
    let remainingPrincipal = principal;
    let cumulativePrincipal = 0;
    let cumulativeInterest = 0;
    let cumulativePaid = 0;

    for (let m = 1; m <= n; m++) {
      const currentYear = Math.ceil(m / 12);
      const yearInsInfo = yearlyIns[currentYear - 1] || yearlyIns[yearlyIns.length - 1];

      let interestPart = 0;
      let principalPart = 0;
      let installmentThisMonth = pmt;

      if (principal <= 0) {
        installmentThisMonth = 0;
      } else if (isADDM && m === 1) {
        // Khusus ADDM: angsuran bulan ke-1 dibayar saat akad, langsung mengurangi pokok tanpa bunga
        principalPart = Math.min(pmt, remainingPrincipal);
        interestPart = Math.max(0, installmentThisMonth - principalPart);
      } else if (m === n) {
        principalPart = remainingPrincipal;
        interestPart = Math.max(0, installmentThisMonth - principalPart);
        installmentThisMonth = principalPart + interestPart;
      } else if (useEffective && rMonthly > 0) {
        interestPart = Math.round(remainingPrincipal * rMonthly);
        principalPart = Math.min(remainingPrincipal, Math.max(0, installmentThisMonth - interestPart));
        interestPart = installmentThisMonth - principalPart;
      } else {
        const flatPrincipal = isADDM
          ? Math.round((principal - pmt) / Math.max(1, n - 1))
          : Math.round(principal / n);
        principalPart = Math.min(remainingPrincipal, Math.max(0, flatPrincipal));
        interestPart = Math.max(0, installmentThisMonth - principalPart);
      }

      const beginningBalance = remainingPrincipal;
      remainingPrincipal = Math.max(0, remainingPrincipal - principalPart);
      cumulativePrincipal += principalPart;
      cumulativeInterest += interestPart;
      cumulativePaid += installmentThisMonth;

      const paidPct = principal > 0 ? Math.min(100, (cumulativePrincipal / principal) * 100) : 100;

      // Susun anotasi kontekstual per bulan seperti KPR + spesifik KKB (proteksi asuransi & depresiasi)
      const annotations = [];
      let badgeType = 'regular';

      if (m === 1) {
        badgeType = 'start';
        if (tenorResult.installmentType === 'ADDM') {
          annotations.push('Dibayar di muka saat Akad (masuk TDP)');
        } else {
          annotations.push('Angsuran perdana (1 bln pasca Akad)');
        }
        if (yearInsInfo) {
          annotations.push(
            `Proteksi Thn 1: ${yearInsInfo.coverageType} (Nilai 100%)`
          );
        }
      } else if (m === n) {
        badgeType = 'finish';
        annotations.push('Pelunasan Akhir & Pengambilan BPKB Asli');
      } else if ((m - 1) % 12 === 0) {
        // Awal tahun baru (Bulan 13, 25, 37, 49)
        const prevIns = yearlyIns[currentYear - 2];
        badgeType = 'year-start';
        if (yearInsInfo) {
          const switchedToTlo =
            prevIns &&
            prevIns.coverageType === 'All Risk' &&
            yearInsInfo.coverageType === 'TLO';
          if (switchedToTlo) {
            badgeType = 'coverage-switch';
            annotations.push(
              `Awal Thn ke-${currentYear}: Peralihan Asuransi All Risk → TLO (Pertanggungan ${yearInsInfo.depreciationPct}%)`
            );
          } else {
            annotations.push(
              `Awal Thn ke-${currentYear}: Asuransi ${yearInsInfo.coverageType} (Pertanggungan ${yearInsInfo.depreciationPct}%)`
            );
          }
        }
      } else if (m % 12 === 0) {
        badgeType = 'year-end';
        annotations.push(
          `Akhir Tahun ke-${currentYear} • Pokok lunas ${paidPct.toFixed(1)}%`
        );
      } else if (paidPct >= 50 && ((cumulativePrincipal - principalPart) / (principal || 1)) * 100 < 50) {
        badgeType = 'milestone';
        annotations.push('Milestone: >50% Pokok Pinjaman telah terbayar');
      } else {
        annotations.push(
          `Tahun ke-${currentYear} (Bln ${((m - 1) % 12) + 1}/12) • ${yearInsInfo ? yearInsInfo.coverageType : '-'}`
        );
      }

      rows.push({
        month: m,
        year: currentYear,
        beginningBalance,
        principalPart,
        interestPart,
        installment: installmentThisMonth,
        endingBalance: remainingPrincipal,
        cumulativePrincipal,
        cumulativeInterest,
        cumulativePaid,
        paidPct,
        coverageType: yearInsInfo ? yearInsInfo.coverageType : '-',
        depreciationPct: yearInsInfo ? yearInsInfo.depreciationPct : 100,
        annotation: annotations.join(' • '),
        badgeType
      });
    }

    return rows;
  }

  /**
   * Tabel bunga per tenor untuk skema & jenis pembiayaan. rateKey: 'interestRates' (flat) atau
   * 'effectiveRates'. Untuk ADDM, tenor yang tidak punya nilai khusus ADDM memakai nilai ADDB.
   */
  function getRateTable(scheme, rateKey, financingType, isADDM) {
    const base = (scheme && scheme[rateKey] && scheme[rateKey][financingType]) || {};
    if (!isADDM) return base;
    const addm = (scheme && scheme[rateKey + 'Addm'] && scheme[rateKey + 'Addm'][financingType]) || {};
    return Object.assign({}, base, addm);
  }

  /** Tenor yang tersedia untuk skema & jenis pembiayaan (sesuai isi rates.csv). */
  function getAllowedTenors(scheme, financingType) {
    const list = scheme && scheme.tenorsByFinancing && scheme.tenorsByFinancing[financingType];
    return list && list.length ? list : [12, 24, 36, 48, 60];
  }

  /**
   * Menghitung semua Tenor yang tersedia (maks. 12-60 bulan) sekaligus
   */
  function calculateFullSuite(baseParams) {
    const schemes = baseParams.schemes || Config.DEFAULT_SCHEMES;
    const scheme = schemes[baseParams.schemeId || 'regular'] || Config.DEFAULT_SCHEMES.regular;
    const standardTenors = getAllowedTenors(scheme, baseParams.financingType || 'New Car');
    const minDpInfo = calculateMinDP(baseParams);

    const tenorResults = standardTenors.map((tenorMonths) =>
      calculateForTenor(Object.assign({}, baseParams, { tenorMonths }))
    );

    const selectedTenor = baseParams.selectedTenor || 36;
    const activeResult =
      tenorResults.find((r) => r.tenorMonths === selectedTenor) || tenorResults[tenorResults.length - 1];

    return {
      minDpInfo,
      tenorResults,
      activeResult
    };
  }

  global.KKBCalculator = {
    calculateMinDP,
    calculateFidusia,
    lookupBaseInsuranceRate,
    calculateInsuranceForTenor,
    calculateCreditFees,
    solveEffectiveAnnualRate,
    calculateForTenor,
    generateAmortizationSchedule,
    getRateTable,
    getAllowedTenors,
    calculateFullSuite
  };
})(window);
