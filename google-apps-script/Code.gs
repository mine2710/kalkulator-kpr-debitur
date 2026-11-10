/**
 * ============================================================================
 * GOOGLE APPS SCRIPT — UNIFIED API (KKB + KPR BRI)
 * Satu Spreadsheet & Satu Endpoint Web App untuk 2 Aplikasi Sekaligus!
 * ============================================================================
 * 
 * Fitur:
 * 1. HTTP GET ditolak total (405 Method Not Allowed).
 * 2. HTTP POST menerima token & jenis request di dalam Body Payload JSON:
 *    - Untuk KPR : { "token": "...", "type": "kpr" }  --> Mengambil sheet 'Programs' & 'Tiering' (KPR Dinamis)
 *    - Untuk KKB : { "token": "...", "type": "kkb" }  --> Mengambil sheet KKB (vehicles, rates, dll)
 *    - Jika tanpa "type" (KKB versi lama) --> Otomatis tetap melayani KKB.
 * 
 * Token TIDAK ditulis di kode. Atur di Project Settings > Script Properties:
 * - KPR_TOKEN, KKB_TOKEN (dan/atau AUTH_TOKEN)
 * (Bisa juga memakai satu token yang sama untuk kedua aplikasi)
 * ============================================================================
 */

// Token Otorisasi yang diizinkan
var _PROPS = PropertiesService.getScriptProperties();
var KPR_TOKEN = _PROPS.getProperty('KPR_TOKEN');
var KKB_TOKEN = _PROPS.getProperty('KKB_TOKEN');
var VALID_TOKENS = [KPR_TOKEN, KKB_TOKEN].filter(function (t) { return !!t; });

/**
 * Tolak akses HTTP GET langsung di browser (Keamanan)
 */
function doGet(e) {
  var errResponse = {
    status: 'error',
    code: 405,
    message: '405 Method Not Allowed: Endpoint ini hanya menerima permintaan via HTTP POST dengan Token yang sah.'
  };

  return ContentService.createTextOutput(JSON.stringify(errResponse))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Handler HTTP POST utama
 */
function doPost(e) {
  try {
    var payload = {};
    if (e && e.postData && e.postData.contents) {
      try {
        payload = JSON.parse(e.postData.contents);
      } catch (parseErr) {
        return createJsonResponse({
          status: 'error',
          code: 400,
          message: '400 Bad Request: Format JSON di body request tidak valid.'
        });
      }
    }

    var clientToken = payload.token || (e && e.parameter && e.parameter.token);

    // Cek token ke Script Properties atau VALID_TOKENS array
    var customPropToken = PropertiesService.getScriptProperties().getProperty('AUTH_TOKEN');
    var isTokenValid = false;

    if (customPropToken && clientToken === customPropToken) {
      isTokenValid = true;
    } else if (VALID_TOKENS.indexOf(clientToken) !== -1) {
      isTokenValid = true;
    }

    if (!isTokenValid) {
      return createJsonResponse({
        status: 'error',
        code: 403,
        message: '403 Forbidden: Token otorisasi tidak valid atau tidak disertakan.'
      });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      return createJsonResponse({
        status: 'error',
        code: 500,
        message: 'Spreadsheet aktif tidak ditemukan.'
      });
    }

    // Deteksi tipe permintaan: 'kpr', 'kkb', atau 'tiering'
    var reqType = String(payload.type || payload.service || '').trim().toLowerCase();

    // ========================================================================
    // 1. JIKA REQUEST DARI KALKULATOR KPR (type: 'kpr' / 'tiering' atau token KPR)
    // ========================================================================
    if (reqType === 'kpr' || reqType === 'tiering' || (KPR_TOKEN && clientToken === KPR_TOKEN)) {
      var programs = [];
      var tiering = [];

      // A. Cari sheet Programs
      var sheetKPR = ss.getSheetByName('Programs') || ss.getSheetByName('programs') || ss.getSheetByName('PROGRAMS') || ss.getSheetByName('Program');
      if (!sheetKPR) {
        var allSheets = ss.getSheets();
        for (var s = 0; s < allSheets.length; s++) {
          if (allSheets[s].getName().toLowerCase().indexOf('program') !== -1) {
            sheetKPR = allSheets[s];
            break;
          }
        }
      }

      if (sheetKPR) {
        var valuesKPR = sheetKPR.getDataRange().getValues();
        if (valuesKPR && valuesKPR.length >= 2) {
          var headers = valuesKPR[0].map(function (h) {
            return String(h).trim().toLowerCase();
          });

          var tierIdx = headers.indexOf('tier');
          var keyIdx = headers.indexOf('key');
          var nameIdx = headers.indexOf('name');
          var minMonthsIdx = headers.indexOf('min_months');
          var segmentsIdx = headers.indexOf('segments');

          for (var i = 1; i < valuesKPR.length; i++) {
            var row = valuesKPR[i];
            if (!row || !row[0] || String(row[0]).trim().indexOf('#') === 0) continue;

            var tier = tierIdx !== -1 && row[tierIdx] ? String(row[tierIdx]).trim() : 'no_tier';
            var key = keyIdx !== -1 && row[keyIdx] ? String(row[keyIdx]).trim() : '';
            var name = nameIdx !== -1 && row[nameIdx] ? String(row[nameIdx]).trim() : '';
            var minMonths = minMonthsIdx !== -1 && row[minMonthsIdx] ? Number(row[minMonthsIdx]) || 1 : 1;
            var segments = segmentsIdx !== -1 && row[segmentsIdx] ? String(row[segmentsIdx]).trim() : '';

            if (key && segments) {
              programs.push({
                tier: tier,
                key: key,
                name: name || key,
                min_months: minMonths,
                segments: segments
              });
            }
          }
        }
      }

      // B. Cari sheet Tiering (untuk KPR Dinamis)
      var sheetTier = ss.getSheetByName('Tiering') || ss.getSheetByName('tiering') || ss.getSheetByName('TIERING') || ss.getSheetByName('Tier') || ss.getSheetByName('tiers');
      if (!sheetTier) {
        var allSheets2 = ss.getSheets();
        for (var st = 0; st < allSheets2.length; st++) {
          if (allSheets2[st].getName().toLowerCase().indexOf('tier') !== -1 && allSheets2[st] !== sheetKPR) {
            sheetTier = allSheets2[st];
            break;
          }
        }
      }

      if (sheetTier) {
        tiering = readTieringSheet(sheetTier);
      }

      if (!sheetKPR && !sheetTier) {
        return createJsonResponse({
          status: 'error',
          code: 404,
          message: 'Sheet "Programs" atau "Tiering" tidak ditemukan di Spreadsheet ini.'
        });
      }

      return createJsonResponse({
        status: 'success',
        service: 'kpr',
        count: programs.length,
        tiering_count: tiering.length,
        updated_at: new Date().toISOString(),
        programs: programs,
        tiering: tiering
      });
    }

    // ========================================================================
    // 2. JIKA REQUEST DARI KALKULATOR KKB (Default / type: 'kkb')
    // ========================================================================
    var responseKKB = {
      status: 'success',
      service: 'kkb',
      updated_at: new Date().toISOString()
    };

    // Helper untuk membaca sheet menjadi array of object
    function readSheetAsJson(sheetName) {
      var sh = ss.getSheetByName(sheetName);
      if (!sh) return [];
      var data = sh.getDataRange().getValues();
      if (!data || data.length < 2) return [];
      var heads = data[0].map(function (h) { return String(h).trim(); });
      var list = [];
      for (var r = 1; r < data.length; r++) {
        var rowObj = {};
        var hasVal = false;
        for (var c = 0; c < heads.length; c++) {
          var val = data[r][c];
          if (val !== undefined && val !== '') hasVal = true;
          rowObj[heads[c]] = val;
        }
        if (hasVal) list.push(rowObj);
      }
      return list;
    }

    responseKKB.vehicles = readSheetAsJson('vehicles');
    responseKKB.rates = readSheetAsJson('rates');
    responseKKB.insurance_base = readSheetAsJson('insurance_base');
    responseKKB.insurance_perils = readSheetAsJson('insurance_perils');
    responseKKB.depreciation = readSheetAsJson('depreciation');
    responseKKB.fees = readSheetAsJson('fees');
    responseKKB.fidusia = readSheetAsJson('fidusia');

    return createJsonResponse(responseKKB);

  } catch (err) {
    return createJsonResponse({
      status: 'error',
      code: 500,
      message: '500 Internal Server Error: ' + err.toString()
    });
  }
}

/**
 * Helper untuk membaca sheet 'Tiering' (KPR Dinamis)
 * Fleksibel mendukung berbagai tata letak header & format persentase.
 */
function readTieringSheet(sh) {
  if (!sh) return [];
  var data = sh.getDataRange().getValues();
  if (!data || data.length < 2) return [];

  var headerRowIdx = -1;
  var ratioCol = -1, labelCol = -1, tabCol = -1, girCol = -1, depCol = -1;

  for (var r = 0; r < Math.min(15, data.length); r++) {
    var row = data[r];
    if (!row || !row.length) continue;
    for (var c = 0; c < row.length; c++) {
      var cell = String(row[c] || '').trim().toLowerCase();
      if (ratioCol === -1 && (cell.indexOf('batas') !== -1 || cell.indexOf('ratio') !== -1 || cell.indexOf('rasio') !== -1)) {
        ratioCol = c;
      }
      if (labelCol === -1 && (cell.indexOf('label') !== -1 || cell.indexOf('tiering') !== -1 || cell.indexOf('rentang') !== -1)) {
        labelCol = c;
      }
      if (tabCol === -1 && (cell.indexOf('tabungan') !== -1 || cell.indexOf('saving') !== -1)) {
        tabCol = c;
      }
      if (girCol === -1 && cell.indexOf('giro') !== -1) {
        girCol = c;
      }
      if (depCol === -1 && (cell.indexOf('deposito') !== -1 || cell.indexOf('deposit') !== -1)) {
        depCol = c;
      }
    }
    if (tabCol !== -1 && (ratioCol !== -1 || labelCol !== -1)) {
      headerRowIdx = r;
      break;
    }
  }

  // Jika tidak ditemukan header spesifik, gunakan kolom 0 s/d 4
  if (headerRowIdx === -1) {
    headerRowIdx = 0;
    ratioCol = 0;
    labelCol = 1;
    tabCol = 2;
    girCol = 3;
    depCol = 4;
  } else {
    if (ratioCol === -1) ratioCol = 0;
    if (labelCol === -1) labelCol = 1;
    if (girCol === -1) girCol = tabCol + 1;
    if (depCol === -1) depCol = tabCol + 2;
  }

  function parseRatioVal(v) {
    if (v === null || v === undefined || v === '') return null;
    var s = String(v).replace('%', '').replace(',', '.').trim();
    var num = parseFloat(s);
    if (isNaN(num)) return null;
    if (num >= 5) num = num / 100; // Contoh: jika ditulis 10 atau 20 (bukan 0.1 / 0.2)
    return Math.round(num * 10000) / 10000;
  }

  function parseRedVal(v) {
    if (v === null || v === undefined || v === '') return 0;
    var s = String(v).replace('%', '').replace(',', '.').trim();
    var num = parseFloat(s);
    if (isNaN(num)) return 0;
    // Jika tersimpan sebagai desimal pecahan (misal -0.004 -> -0.40%)
    if (Math.abs(num) > 0 && Math.abs(num) <= 0.25) {
      num = num * 100;
    }
    // Pengurang suku bunga bernilai negatif
    if (num > 0) num = -num;
    return Math.round(num * 10000) / 10000;
  }

  var tiers = [];
  for (var i = headerRowIdx + 1; i < data.length; i++) {
    var dRow = data[i];
    if (!dRow || !dRow.length) continue;
    var rVal = parseRatioVal(dRow[ratioCol]);
    if (rVal === null || rVal < 0) continue;

    var lbl = labelCol !== -1 && dRow[labelCol] ? String(dRow[labelCol]).trim() : (Math.round(rVal * 100) + '%');
    var tabVal = tabCol !== -1 ? parseRedVal(dRow[tabCol]) : 0;
    var girVal = girCol !== -1 ? parseRedVal(dRow[girCol]) : tabVal;
    var depVal = depCol !== -1 ? parseRedVal(dRow[depCol]) : tabVal;

    tiers.push({
      min_ratio: rVal,
      label: lbl,
      tabungan: tabVal,
      giro: girVal,
      deposito: depVal
    });
  }

  tiers.sort(function (a, b) { return a.min_ratio - b.min_ratio; });
  return tiers;
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
