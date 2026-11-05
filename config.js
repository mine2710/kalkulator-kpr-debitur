/**
 * Konfigurasi API Google Spreadsheet & Keamanan untuk Kalkulator KPR Debitur BRI
 * 
 * Endpoint & Token tersandikan (obfuscated) agar tidak tampil sebagai URL/Token polos di source code.
 * Endpoint ini hanya menerima permintaan via HTTP POST dengan Token yang sah di dalam body/payload.
 */
(function (global) {
  'use strict';

  // Kredensial API terenkripsi / ter-obfuscate (XOR + Base64)
  // URL sama dengan spreadsheet KKB yang sudah memiliki sheet "Programs"
  const _O_URL = 'Mi4uKilgdXUpOSgzKi50PTU1PTY/dDk1N3U3OzkoNSl1KXUbETwjOTgja2sVETYPAh4qIxY9KwIrPQkxajMNaGxsBSw1Nx5obBYXKzczbzAoA20zOTszNhcCHxQpGQAgEAkDay0CLTc0ajB1PyI/OQ==';
  const _O_TOK = 'GAgTBREKCAUJHxkPCB8FDhURHxQFaGpobAUiIyBiYg==';
  const _K = 0x5a;

  function _decrypt(enc, k) {
    try {
      const raw = atob(enc);
      let out = '';
      for (let i = 0; i < raw.length; i++) {
        out += String.fromCharCode(raw.charCodeAt(i) ^ k);
      }
      return out;
    } catch (_) {
      return '';
    }
  }

  function _encrypt(str, k) {
    k = k || _K;
    let out = '';
    for (let i = 0; i < str.length; i++) {
      out += String.fromCharCode(str.charCodeAt(i) ^ k);
    }
    return btoa(out);
  }

  function getApiEndpoint() {
    return _decrypt(_O_URL, _K);
  }

  function getApiToken() {
    return _decrypt(_O_TOK, _K);
  }

  global.KPRConfig = {
    getApiEndpoint: getApiEndpoint,
    getApiToken: getApiToken,
    /**
     * Helper untuk mengenkripsi URL dan Token baru jika Anda deploy ulang.
     * Jalankan di browser Console:
     * KPRConfig.obfuscate('https://script.google.com/macros/s/.../exec', 'TOKEN_ANDA')
     */
    obfuscate: function (endpointUrl, authToken) {
      return {
        _O_URL: _encrypt(endpointUrl, _K),
        _O_TOK: _encrypt(authToken, _K)
      };
    }
  };
})(window);
