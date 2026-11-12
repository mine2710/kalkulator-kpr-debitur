# AGENTS.md — Konteks Bersama untuk Semua AI Agent

File ini adalah **"otak bersama"** proyek. Dibaca otomatis oleh **Claude Code** (lewat `CLAUDE.md`)
dan **Antigravity** (lewat `.agent/rules/konteks-bersama.md`). Siapa pun agent-nya, ikuti isi file ini
supaya pemahamannya sama.

- Detail sistem, rumus, dan alur data: baca **`handoff.md`** sebelum mengubah logika perhitungan.
- Setelah menyelesaikan pekerjaan berarti, **tambahkan 1 baris di "Log Keputusan"** di bawah,
  supaya agent lain tahu apa yang berubah dan kenapa.

## Proyek singkat

Kalkulator KPR untuk debitur BRI. Web statis tanpa build (HTML + Tailwind CDN + Chart.js + JS biasa).
Live di GitHub Pages: https://mine2710.github.io/kalkulator-kpr-debitur/ (deploy otomatis dari branch `main`).

| File | Isi |
|---|---|
| `index.html` | Semua tampilan, 4 tab. Elemen per tab ditandai `data-modes="kpr-baru to-float to-fix kpr-dinamis"` |
| `script.js` | KPR Baru, Take Over Float/Fix, pemuat data (API → fallback CSV), helper format & grafik |
| `dinamis.js` | Tab KPR Dinamis (tiering dana pengurang bunga). Bergantung pada helper global dari `script.js` |
| `programs.csv` / `tiering.csv` | Cadangan lokal saja, **tidak ada di GitHub** (di-`.gitignore`). Sumber data = Google Spreadsheet (sheet `Programs`, `tiering`). `segments` = `durasi:bunga` dipisah `|` |
| `google-apps-script/Code.gs` | Backend; token dibaca dari Script Properties |

## Aturan wajib

1. **Bahasa:** UI, pesan commit, dan penjelasan ke pengguna dalam **Bahasa Indonesia**.
2. **Rahasia:** JANGAN pernah menulis token, URL Apps Script asli, atau path lokal (`file:///d:/...`)
   ke file apa pun di repo — repo ini **PUBLIC**. Token hanya di Script Properties (`KPR_TOKEN`, `KKB_TOKEN`)
   dan versi tersandi di `config.js`. Di dokumentasi tulis `<TOKEN>` saja.
3. **Data jangan masuk GitHub:** `programs.csv`, `tiering.csv`, `Tambahan/`, dan semua `.xlsx` di-`.gitignore`.
   Jangan salin isi tabel suku bunga/tiering ke kode atau dokumen. Sumber data hanya Google Spreadsheet.
4. **Warna:** pakai kelas Tailwind `bri`, `bri-2`, `bri-sky`, `bri-dark` (variabel CSS `--bri` dst. di `index.html`).
   Mode cerah: #0857C3 / #307FE2 / #71C5E8. Mode gelap memakai palet lama. Jangan tulis hex biru langsung;
   di JS grafik pakai `briColor('--bri', alpha)`.
5. **Cakupan:** kalau pengguna bilang "khusus tab X", jangan ubah tab lain.
6. **Tanpa build:** jangan tambah npm/bundler. Library hanya via CDN dengan versi pasti.
7. **Cek sebelum push:** `node --check script.js dinamis.js`, lalu buka lewat `python -m http.server 8080`
   (bukan klik dua kali `index.html`). Push ke `main` = langsung tayang di web.
8. **Git:** jangan commit file sementara (`Untitled spreadsheet*.xlsx`, `~$*`). Jangan force-push.

## Keputusan yang sudah disepakati (jangan diubah tanpa tanya pengguna)

- **KPR Dinamis — tabel tiering** bersumber dari sheet `tiering` di Google Spreadsheet **"API Kalkulator"** (kolom: label, `Tiering` = batas bawah rasio, `CASA`, `Deposito`). `DIN_TIERS` di `dinamis.js` sengaja kosong dan diisi dari API; jangan tulis angkanya ke repo.
- **Jenis dana hanya DUA: `CASA` dan `Deposito`** — mengikuti kolom sheet. Jangan memecah CASA menjadi Tabungan/Giro di UI, kode, maupun API (API mengirim `casa` dan `deposito`).
- **Metode "Angsuran Menyesuaikan"** (dari Excel Simulasi): angsuran dihitung ulang tiap bulan dengan bunga efektif.
  **Metode "Angsuran Tetap"** (dari Excel V2): angsuran dari bunga dasar, dihitung ulang hanya saat ganti tahap → lunas lebih cepat.
- Deposito **tetap dapat pengurang** sesuai kolom `Deposito` di sheet (di Excel Simulasi selalu 0 karena bug rumus `INDEX`).
- Bulan pelunasan hanya menagih sisa pokok + bunga (Excel V2 menagih angsuran penuh — bug).
- Bunga efektif = `max(0, bunga dasar + jumlah pengurang)`. Rasio di bawah tier pertama → tanpa pengurang; di atas tier terakhir → tier terakhir.
- Dropdown program 2 tingkat (Tier → Program) di KPR Baru dan KPR Dinamis.

## Log Keputusan (tambahkan di paling bawah, format: tanggal — agent — ringkasan)

- 2026-11-10 — Claude Code — Tab KPR Dinamis dibuat dari 2 Excel di `Tambahan/`; diverifikasi cocok dengan angka Excel.
- 2026-11-10 — Claude Code — README diringkas; token dihapus dari README/Code.gs/obfuscate; Code.gs pakai Script Properties.
- 2026-11-10 — Claude Code — Tata letak KPR Dinamis dirapikan (kolom 5/12 : 7/12, kartu variasi 2×2).
- 2026-11-10 — Antigravity — Dropdown bertingkat Tier → Program di KPR Dinamis; kartu & navigasi diselaraskan dengan KPR Baru.
- 2026-11-10 — Claude Code — Palet biru mode cerah (#0857C3, #307FE2, #71C5E8) via variabel CSS.
- 2026-11-11 — Antigravity — `handoff.md` dibuat (dokumentasi lengkap sistem).
- 2026-11-11 — Claude Code — `AGENTS.md` (konteks bersama) dibuat; token & path lokal dihapus dari `handoff.md`.
- 2026-11-11 — Claude Code — Data (CSV program/tiering, Excel `Tambahan/`) dikeluarkan dari GitHub; `Code.gs` baca token dari Script Properties/`Secrets.gs`. Tabel `DIN_TIERS` di `dinamis.js` menyusul setelah API menyajikan tiering.
- 2026-11-11 — Claude Code — Apps Script di-deploy versi 8 lewat `clasp` (link API tetap): API mengirim `programs` + `tiering` dari spreadsheet; parser tiering mengenali kolom `CASA`. Tabel `DIN_TIERS` dihapus dari `dinamis.js`. Perubahan Apps Script/spreadsheet berdampak ke aplikasi KKB juga: selalu tes KPR + KKB setelah deploy.
- 2026-11-11 — Claude Code — Jenis dana KPR Dinamis dijadikan 2 (CASA, Deposito) di UI, `dinamis.js`, dan API; perbaikan bug pengurang 0,25% yang terbaca 25%.
- 2026-11-12 — Claude Code — RPC (KPR Baru): kolom "Maksimal Angsuran yang Harus Dibayarkan" (Rp) diganti sakelar on/off "Atur Rasio Manual". Mati (bawaan) → rasio 50/55/60% sesuai pendapatan; nyala → muncul kolom "Rasio Maksimal Angsuran" (%) untuk menimpanya. Maksimal angsuran kini selalu hasil hitung (rasio × pendapatan − angsuran berjalan).
- 2026-11-12 — Claude Code — Logo/gambar BRI di header dihapus atas permintaan pengguna (jangan dipasang lagi tanpa tanya); header kini hanya judul + tombol tema, tanpa garis pemisah.
