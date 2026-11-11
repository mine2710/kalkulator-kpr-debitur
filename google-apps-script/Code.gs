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

/**
 * Token Otorisasi yang diizinkan — TIDAK ditulis di file ini (repo GitHub bersifat publik).
 * Sumber token (dibaca saat ada permintaan):
 *  1. Script Properties: KPR_TOKEN, KKB_TOKEN, AUTH_TOKEN
 *  2. File Secrets.gs di proyek Apps Script (hanya ada di Google, tidak ikut ke GitHub):
 *       var SECRET_KPR_TOKEN = '...';  var SECRET_KKB_TOKEN = '...';
 */
function getTokens_() {
  var props = PropertiesService.getScriptProperties();
  var kpr = props.getProperty('KPR_TOKEN') || (typeof SECRET_KPR_TOKEN !== 'undefined' ? SECRET_KPR_TOKEN : null);
  var kkb = props.getProperty('KKB_TOKEN') || (typeof SECRET_KKB_TOKEN !== 'undefined' ? SECRET_KKB_TOKEN : null);
  var auth = props.getProperty('AUTH_TOKEN');
  return { kpr: kpr, kkb: kkb, valid: [kpr, kkb, auth].filter(function (t) { return !!t; }) };
}

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

    // Cek token ke Script Properties / Secrets.gs
    var TOKENS = getTokens_();
    var KPR_TOKEN = TOKENS.kpr;
    var isTokenValid = !!clientToken && TOKENS.valid.indexOf(clientToken) !== -1;

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

  // 1. Cari baris header: baris pertama yang memuat kolom pengurang
  //    (CASA / Deposito). Hanya ada DUA jenis dana: CASA dan Deposito.
  //    Judul lama "Tabungan" atau "Giro" tetap dikenali sebagai kolom CASA.
  var headerRowIdx = -1, casaCol = -1, depCol = -1;
  for (var r = 0; r < Math.min(15, data.length) && headerRowIdx === -1; r++) {
    var row = data[r] || [];
    var t = -1, d = -1;
    for (var c = 0; c < row.length; c++) {
      var cell = String(row[c] === null || row[c] === undefined ? '' : row[c]).trim().toLowerCase();
      if (!cell) continue;
      if (cell.indexOf('casa') !== -1 || cell.indexOf('tabungan') !== -1 || cell.indexOf('saving') !== -1 || cell.indexOf('giro') !== -1) { if (t === -1) t = c; }
      else if (cell.indexOf('deposit') !== -1) { if (d === -1) d = c; }
    }
    if (t !== -1 || d !== -1) { headerRowIdx = r; casaCol = t; depCol = d; }
  }
  if (headerRowIdx === -1) return [];

  // 2. Kolom rasio & label ditentukan dari ISI baris data pertama (bukan dari judul kolom):
  //    kolom angka = batas bawah rasio, kolom teks = label rentang.
  var valueCols = [casaCol, depCol];
  var firstRow = data[headerRowIdx + 1] || [];
  var ratioCol = -1, labelCol = -1;
  for (var k = 0; k < firstRow.length; k++) {
    if (valueCols.indexOf(k) !== -1) continue;
    var v0 = firstRow[k];
    if (typeof v0 === 'number' && ratioCol === -1) ratioCol = k;
    else if (typeof v0 === 'string' && v0.trim() && labelCol === -1) labelCol = k;
  }

  // Angka pertama di dalam teks/angka. "10 - <20%" -> 10, "≥ 220%" -> 220, 0.1 -> 0.1
  function firstNumber(v) {
    if (typeof v === 'number') return v;
    var m = String(v === null || v === undefined ? '' : v).replace(',', '.').match(/\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : NaN;
  }
  function parseRatioVal(v) {
    if (v === null || v === undefined || v === '') return null;
    var num = firstNumber(v);
    if (isNaN(num)) return null;
    if (typeof v === 'string' || num >= 5) num = num / 100; // teks "10%" / angka 10 -> 0.10
    return Math.round(num * 10000) / 10000;
  }
  function parseRedVal(v) {
    if (v === null || v === undefined || v === '') return 0;
    var num;
    if (typeof v === 'number') {
      num = v;
      // Sel berformat persen tersimpan sebagai pecahan (0.0025 = 0,25%)
      if (Math.abs(num) > 0 && Math.abs(num) <= 0.25) num = num * 100;
    } else {
      num = parseFloat(String(v).replace('%', '').replace(',', '.').trim());
      if (isNaN(num)) return 0;
    }
    if (num > 0) num = -num; // pengurang suku bunga selalu negatif
    return Math.round(num * 10000) / 10000;
  }

  var tiers = [];
  for (var i = headerRowIdx + 1; i < data.length; i++) {
    var dRow = data[i];
    if (!dRow || !dRow.length) continue;
    var rVal = ratioCol !== -1 ? parseRatioVal(dRow[ratioCol]) : null;
    if (rVal === null && labelCol !== -1) rVal = parseRatioVal(String(dRow[labelCol] || ''));
    if (rVal === null || rVal < 0) continue;

    var lbl = labelCol !== -1 && dRow[labelCol] !== '' && dRow[labelCol] !== null && dRow[labelCol] !== undefined
      ? String(dRow[labelCol]).trim() : (Math.round(rVal * 100) + '%');

    tiers.push({
      min_ratio: rVal,
      label: lbl,
      casa: casaCol !== -1 ? parseRedVal(dRow[casaCol]) : 0,
      deposito: depCol !== -1 ? parseRedVal(dRow[depCol]) : 0
    });
  }

  tiers.sort(function (a, b) { return a.min_ratio - b.min_ratio; });
  return tiers;
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
