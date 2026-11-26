# 🧮 Kalkulator Kredit — KPR & KKB

![HTML](https://img.shields.io/badge/HTML5-E34F26?style=flat&logo=html5&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)
![Chart.js](https://img.shields.io/badge/Chart.js-FF6384?style=flat&logo=chartdotjs&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat&logo=tailwindcss&logoColor=white)

Kalkulator kredit berbasis web untuk membantu **debitur/nasabah** menyimulasikan angsuran.
Satu aplikasi dengan dua produk yang dipilih lewat tab di bagian atas: **KPR** dan **KKB**.

## ✨ Fitur

### 🏠 KPR (Kredit Pemilikan Rumah)
- **KPR Baru** — simulasi angsuran berjenjang (fix → floating) sesuai program suku bunga, plus cek kemampuan bayar (RPC).
- **Pengajuan Takeover KPR** — bandingkan angsuran saat ini dengan program baru, lengkap dengan titik impas (BEP), untuk nasabah yang sudah floating maupun masih fixed rate.
- Grafik kumulatif, ringkasan tahap, dan jadwal amortisasi lengkap.

### 🚗 KKB (Kredit Kendaraan Bermotor)
- Tiga skema: **Regular**, **Prioritas**, dan **Karyawan** — biaya admin & provisi terisi otomatis sesuai skema.
- Pembiayaan **New Car, Used Car, Refinancing, Mobil Niaga**; merk & tipe kendaraan dengan minimum DP otomatis.
- Pilihan tenor 12–60 bulan, **Total DP (TDP)**, rincian biaya kredit & fidusia, premi asuransi per tahun (dengan depresiasi), dan jadwal angsuran bulanan (ADDB / ADDM).

Semua tab mendukung mode gelap, tampilan ponsel (navigasi bawah), dan menyimpan input terakhir di browser.

## 📁 Struktur File

```
├── index.html          # Tampilan (tab produk KPR / KKB)
├── script.js           # Logika KPR, navigasi produk, grafik & pemuat data
├── dinamis.js          # KPR Dinamis (sedang disembunyikan)
├── config.js           # Konfigurasi sumber data KPR
├── kkb/
│   ├── kkb.css         # Gaya komponen KKB
│   └── js/             # Logika KKB (kalkulator, data kendaraan, suku bunga)
└── google-apps-script/ # Backend opsional (Google Apps Script)
```

## ▶️ Menjalankan Secara Lokal

Aplikasi memuat data lewat `fetch()`, jadi jalankan melalui web server lokal (bukan dengan membuka `index.html` langsung):

```bash
python -m http.server 8080
```

Lalu buka `http://localhost:8080`. Tautan langsung ke tab tertentu: `#kpr-baru`, `#to-float`, `#to-fix`, `#kkb-regular`, `#kkb-lnp`, `#kkb-karyawan`.

Data suku bunga, kendaraan, dan tabel biaya diambil dari Google Spreadsheet saat halaman dimuat; datanya tidak disimpan di repositori ini.

## ⚙️ Backend (Opsional)

Data dikelola dari Google Spreadsheet melalui Google Apps Script (`google-apps-script/Code.gs`).
Token akses **tidak disimpan di repositori** — atur di *Project Settings → Script Properties* pada editor Apps Script.

## ⚠️ Catatan

Hasil perhitungan bersifat **simulasi/ilustrasi** dan dapat berbeda dengan perhitungan resmi bank.
