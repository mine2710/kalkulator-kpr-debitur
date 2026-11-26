/* Parser CSV bersama untuk vehicles.csv dan rates.csv. */
(function (global) {
  'use strict';

  // Handles quoted fields, escaped quotes, CRLF, comment rows (#), and Excel's semicolon delimiter.
  function parse(text) {
    text = String(text).replace(/^\uFEFF/, '');
    const firstLine = text.split(/\r?\n/).find((line) => line.trim() && !line.trim().startsWith('#')) || '';
    const delimiter = firstLine.includes(';') ? ';' : ',';
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        if (quoted && text[i + 1] === '"') { field += '"'; i++; }
        else if (quoted || !field) quoted = !quoted;
        else throw new Error('Tanda kutip CSV tidak valid.');
      } else if (!quoted && (char === delimiter || char === '\n' || char === '\r')) {
        row.push(field.trim());
        field = '';
        if (char !== delimiter) {
          if (char === '\r' && text[i + 1] === '\n') i++;
          if (row.some(Boolean) && !row[0].startsWith('#')) rows.push(row);
          row = [];
        }
      } else field += char;
    }
    if (quoted) throw new Error('Tanda kutip CSV belum ditutup.');
    row.push(field.trim());
    if (row.some(Boolean) && !row[0].startsWith('#')) rows.push(row);
    return rows;
  }

  global.KKBCsv = { parse };
})(window);
