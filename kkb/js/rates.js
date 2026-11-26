/* Memuat suku bunga efektif (ADDB & ADDM) dari tab/CSV rates ke KKBConfig.DEFAULT_SCHEMES; bunga flat dihitung dari efektif. */
(function (global) {
  'use strict';

  const SCHEME_COLUMNS = ['karyawan', 'lnp', 'regular'];
  const RATE_TYPES = { flat: 'interestRates', efektif: 'effectiveRates' };
  // Kolom tipe_angsuran: kosong = ADDB (skema dasar). Baris ADDM yang tidak diisi diturunkan otomatis.
  const INSTALLMENT_TYPES = { '': 'ADDB', addb: 'ADDB', b: 'ADDB', addm: 'ADDM', m: 'ADDM' };
  const VALID_TENORS = [12, 24, 36, 48, 60];
  const REQUIRED_COLUMNS = ['jenis_bunga', 'pembiayaan', 'tenor'].concat(SCHEME_COLUMNS);

  /** Angsuran per Rp 1 pokok, setara -PMT(efektif/12, tenor, 1, 0, tipe) di Excel (tipe 1 = ADDM). */
  function installmentFactor(effectivePa, tenorMonths, isADDM) {
    const r = effectivePa / 100 / 12;
    if (r <= 0) return 1 / tenorMonths;
    const ordinary = r / (1 - Math.pow(1 + r, -tenorMonths));
    return isADDM ? ordinary / (1 + r) : ordinary;
  }

  /** Konversi "EFEKTIF KE FLAT" pada KALKULATOR RATE.xlsx: ((PMT x tenor) - 1) x 12 / tenor, dalam persen p.a. */
  function effectiveToFlat(effectivePa, tenorMonths, isADDM) {
    return ((installmentFactor(effectivePa, tenorMonths, isADDM) * tenorMonths - 1) * 12 / tenorMonths) * 100;
  }

  function parseRate(raw) {
    if (raw === undefined || raw === null || String(raw).trim() === '') return null;
    const value = Number(String(raw).replace('%', '').replace(',', '.'));
    return Number.isFinite(value) && value >= 0 && value <= 50 ? value : NaN;
  }

  /**
   * records: [{ jenis_bunga, tipe_angsuran, pembiayaan, tenor, karyawan, lnp, regular }]
   * strict (CSV): baris tidak valid menghentikan pemuatan. Tidak strict (API): baris tidak valid dilewati.
   */
  function apply(records, strict) {
    const Config = global.KKBConfig;
    const financingValues = Config.FINANCING_TYPES.map((f) => f.value);
    const emptyByFinancing = () => {
      const out = {};
      financingValues.forEach((fin) => { out[fin] = {}; });
      return out;
    };
    const table = {}; // table[schemeId][ADDB|ADDM][interestRates|effectiveRates][financing][tenor]
    SCHEME_COLUMNS.forEach((s) => {
      table[s] = {
        ADDB: { interestRates: emptyByFinancing(), effectiveRates: emptyByFinancing() },
        ADDM: { interestRates: emptyByFinancing(), effectiveRates: emptyByFinancing() }
      };
    });

    records.forEach((item, index) => {
      const lineNo = index + 2;
      const text = (name) => String(item[name] === undefined || item[name] === null ? '' : item[name]).trim();
      const rateKey = RATE_TYPES[text('jenis_bunga').toLowerCase()];
      const installmentType = INSTALLMENT_TYPES[text('tipe_angsuran').toLowerCase()];
      const fin = financingValues.find((v) => v.toLowerCase() === text('pembiayaan').toLowerCase());
      const tenor = Number(text('tenor'));
      if (!rateKey || !installmentType || !fin || VALID_TENORS.indexOf(tenor) === -1) {
        if (strict) {
          throw new Error(
            `Baris ${lineNo} rates.csv tidak valid (jenis_bunga flat/efektif, tipe_angsuran ADDB/ADDM, pembiayaan, tenor 12-60).`
          );
        }
        return;
      }
      SCHEME_COLUMNS.forEach((s) => {
        const value = parseRate(item[s]);
        if (value === null) return;
        if (Number.isNaN(value)) {
          if (strict) throw new Error(`Bunga CSV baris ${lineNo} tidak valid (0-50%).`);
          return;
        }
        table[s][installmentType][rateKey][fin][tenor] = value;
      });
    });

    SCHEME_COLUMNS.forEach((s) => {
      const scheme = Config.DEFAULT_SCHEMES[s];
      const addb = table[s].ADDB;
      const addm = table[s].ADDM;

      // Bunga efektif adalah satu-satunya sumber data. ADDM yang tidak diisi memakai bunga efektif
      // ADDB (Table Angsuran.xlsx). Bunga flat SELALU dihitung dari bunga efektif dengan rumus
      // "EFEKTIF KE FLAT" tipe B / M (KALKULATOR RATE.xlsx), jadi baris flat di sheet tidak perlu ada.
      // Baris flat lama hanya dipakai bila tenor tersebut tidak punya bunga efektif sama sekali.
      financingValues.forEach((fin) => {
        VALID_TENORS.forEach((t) => {
          if (addm.effectiveRates[fin][t] === undefined && addb.effectiveRates[fin][t] !== undefined) {
            addm.effectiveRates[fin][t] = addb.effectiveRates[fin][t];
          }
          [[addb, false], [addm, true]].forEach(([tbl, isADDM]) => {
            const eff = tbl.effectiveRates[fin][t];
            if (eff !== undefined) {
              tbl.interestRates[fin][t] = Number(effectiveToFlat(eff, t, isADDM).toFixed(2));
            }
          });
        });
      });

      scheme.interestRates = addb.interestRates;
      scheme.effectiveRates = addb.effectiveRates;
      scheme.interestRatesAddm = addm.interestRates;
      scheme.effectiveRatesAddm = addm.effectiveRates;
      scheme.tenorsByFinancing = {};
      financingValues.forEach((fin) => {
        // Tenor tersedia bila punya bunga efektif (atau baris flat lama sebagai cadangan).
        const tenors = VALID_TENORS.filter((t) => addb.interestRates[fin][t] !== undefined);
        if (!tenors.length && strict) {
          throw new Error(`rates.csv: ${fin} (${s}) belum memiliki bunga efektif.`);
        }
        scheme.tenorsByFinancing[fin] = tenors.length ? tenors : VALID_TENORS.slice();
      });
    });
  }

  function loadText(text) {
    const rows = global.KKBCsv.parse(text);
    const header = rows.shift() || [];
    if (REQUIRED_COLUMNS.some((name) => !header.includes(name))) {
      throw new Error(`Kolom wajib rates.csv: ${REQUIRED_COLUMNS.join(', ')}.`);
    }
    apply(
      rows.map((cells) => {
        const record = {};
        header.forEach((name, i) => { record[name] = cells[i] || ''; });
        return record;
      }),
      true
    );
  }

  function loadJson(items) {
    if (!Array.isArray(items) || !items.length) {
      throw new Error('Data suku bunga API tidak boleh kosong.');
    }
    apply(items, false);
  }

  global.KKBRates = {
    effectiveToFlat,
    loadText,
    loadJson,
    async load() {
      const response = await fetch('kkb/database/rates.csv', { cache: 'no-store' });
      if (!response.ok) throw new Error(`rates.csv: HTTP ${response.status}`);
      loadText(await response.text());
    }
  };
})(window);
