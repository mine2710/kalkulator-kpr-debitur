/**
 * Tool Bantu Obfuscate URL & Token untuk config.js
 * 
 * Penggunaan via Node.js:
 *   node obfuscate.js <URL_WEB_APP> <TOKEN>
 * 
 * Contoh:
 *   node obfuscate.js https://script.google.com/macros/s/AKfy.../exec TOKEN_ANDA
 */

const KEY = 0x5a;

function encrypt(str, k = KEY) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    out += String.fromCharCode(str.charCodeAt(i) ^ k);
  }
  return Buffer.from(out, 'latin1').toString('base64');
}

const url = process.argv[2];
const token = process.argv[3];

if (!url || !token) {
  console.log('Penggunaan: node obfuscate.js <URL_WEB_APP> <TOKEN>');
  console.log('Contoh: node obfuscate.js https://script.google.com/macros/s/.../exec TOKEN_ANDA');
  process.exit(1);
}

console.log('--- HASIL OBFUSCATION UNTUK config.js ---');
console.log(`const _O_URL = '${encrypt(url)}';`);
console.log(`const _O_TOK = '${encrypt(token)}';`);
console.log('-----------------------------------------');
console.log('Salin dua baris di atas dan tempelkan ke dalam config.js');
