/* Referensi kendaraan dari tabel pengguna. Nama model dipertahankan sesuai sumber. */
(function (global) {
  'use strict';


  const normalize = (value) => String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
  let unique = new Map();
  const api = {
    vehicles: [],
    brands: [],
    modelsFor: (brand) => api.vehicles.filter((row) => normalize(row.brand) === normalize(brand)),
    find: (brand, model) => unique.get(`${normalize(brand)}|${normalize(model)}`),
    loadText,
    loadJson,
    async load() {
      const response = await fetch('kkb/database/vehicles.csv', { cache: 'no-store' });
      if (!response.ok) throw new Error(`vehicles.csv: HTTP ${response.status}`);
      loadText(await response.text());
    }
  };

  function loadJson(items) {
    if (!Array.isArray(items) || !items.length) {
      throw new Error('Data kendaraan API tidak boleh kosong.');
    }
    const next = new Map();
    items.forEach((item, index) => {
      const brand = normalize(item.brand);
      const model = item.model !== undefined && item.model !== null ? String(item.model).trim() : '';
      const dp = String(item.min_dp_pct !== undefined ? item.min_dp_pct : '').replace(',', '.');
      const minDpPct = Number(dp);
      if (!brand || !model || !Number.isFinite(minDpPct) || minDpPct < 0 || minDpPct > 100) {
        return;
      }
      const key = `${brand}|${normalize(model)}`;
      const vehicle = {
        brand,
        model,
        category: item.category || '',
        depreciation: item.depreciation || '',
        minDpPct
      };
      if (!next.has(key) || minDpPct < next.get(key).minDpPct) next.set(key, vehicle);
    });
    if (!next.size) throw new Error('Data kendaraan valid tidak ditemukan.');
    unique = next;
    api.vehicles = [...next.values()];
    api.brands = [...new Set(api.vehicles.map((vehicle) => vehicle.brand))].sort();
  }

  function loadText(text) {
    const rows = global.KKBCsv.parse(text);
    const header = rows.shift() || [];
    const columns = ['brand', 'model', 'category', 'depreciation', 'min_dp_pct'];
    if (columns.some((name) => !header.includes(name))) {
      throw new Error(`Kolom wajib CSV: ${columns.join(', ')}.`);
    }
    const next = new Map();
    rows.forEach((cells, index) => {
      const get = (name) => cells[header.indexOf(name)] || '';
      const brand = normalize(get('brand'));
      const model = get('model');
      const dp = get('min_dp_pct').replace(',', '.');
      const minDpPct = Number(dp);
      if (cells.length !== header.length || !brand || !model || !dp || !Number.isFinite(minDpPct) || minDpPct < 0 || minDpPct > 100) {
        throw new Error(`Data kendaraan CSV baris ${index + 2} tidak valid (merk, model, atau DP 0-100).`);
      }
      const key = `${brand}|${normalize(model)}`;
      const vehicle = { brand, model, category: get('category'), depreciation: get('depreciation'), minDpPct };
      // Duplikat merk-model selalu menggunakan DP terkecil.
      if (!next.has(key) || minDpPct < next.get(key).minDpPct) next.set(key, vehicle);
    });
    if (!next.size) throw new Error('CSV kendaraan tidak boleh kosong.');
    unique = next;
    api.vehicles = [...next.values()];
    api.brands = [...new Set(api.vehicles.map((vehicle) => vehicle.brand))].sort();
  }

  global.KKBVehicles = api;
})(window);
