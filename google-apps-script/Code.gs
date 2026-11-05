/**
 * ============================================================================
 * GOOGLE APPS SCRIPT — UNIFIED API (KKB + KPR BRI)
 * Satu Spreadsheet & Satu Endpoint Web App untuk 2 Aplikasi Sekaligus!
 * ============================================================================
 * 
 * Fitur:
 * 1. HTTP GET ditolak total (405 Method Not Allowed).
 * 2. HTTP POST menerima token & jenis request di dalam Body Payload JSON:
 *    - Untuk KPR : { "token": "...", "type": "kpr" }  --> Mengambil sheet 'Programs'
 *    - Untuk KKB : { "token": "...", "type": "kkb" }  --> Mengambil sheet KKB (vehicles, rates, dll)
 *    - Jika tanpa "type" (KKB versi lama) --> Otomatis tetap melayani KKB.
 * 
 * Token yang diterima:
 * - KKB Token: BRI_KKB_SECURE_TOKEN_2026_xyz99
 * - KPR Token: BRI_KPR_SECURE_TOKEN_2026_xyz88
 * (Bisa juga memakai satu token yang sama untuk kedua aplikasi)
 * ============================================================================
 */

// Token Otorisasi yang diizinkan
var VALID_TOKENS = [
  'BRI_KKB_SECURE_TOKEN_2026_xyz99',
  'BRI_KPR_SECURE_TOKEN_2026_xyz88'
];

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

    // Deteksi tipe permintaan: 'kpr' atau 'kkb'
    var reqType = String(payload.type || payload.service || '').trim().toLowerCase();

    // ========================================================================
    // 1. JIKA REQUEST DARI KALKULATOR KPR (type: 'kpr' atau token KPR)
    // ========================================================================
    if (reqType === 'kpr' || clientToken === 'BRI_KPR_SECURE_TOKEN_2026_xyz88') {
      var sheetKPR = ss.getSheetByName('Programs') || ss.getSheetByName('programs');
      if (!sheetKPR) {
        return createJsonResponse({
          status: 'error',
          code: 404,
          message: 'Sheet "Programs" tidak ditemukan di Spreadsheet ini.'
        });
      }

      var valuesKPR = sheetKPR.getDataRange().getValues();
      var programs = [];

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

      return createJsonResponse({
        status: 'success',
        service: 'kpr',
        count: programs.length,
        updated_at: new Date().toISOString(),
        programs: programs
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

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
