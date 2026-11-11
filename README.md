# 🏠 Kalkulator KPR — Versi Debitur BRI

![HTML](https://img.shields.io/badge/HTML5-E34F26?style=flat&logo=html5&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)
![Chart.js](https://img.shields.io/badge/Chart.js-FF6384?style=flat&logo=chartdotjs&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat&logo=tailwindcss&logoColor=white)

Kalkulator KPR (Kredit Pemilikan Rumah) berbasis web untuk membantu **debitur/nasabah** menyimulasikan angsuran.

## ✨ Fitur

- **KPR Baru** — simulasi angsuran berjenjang (fix → floating) sesuai program suku bunga.
- **Take Over Float / Fix** — bandingkan angsuran saat ini dengan program baru, lengkap dengan titik impas (BEP).
- **KPR Dinamis** — simulasi penurunan bunga berdasarkan dana yang ditempatkan (Tabungan/Giro/Deposito).
- Grafik sisa pokok & kumulatif, tabel amortisasi, mode gelap, dan tampilan ramah ponsel.

## 📁 Struktur File

```
├── index.html          # Tampilan kalkulator
├── script.js           # Logika perhitungan, grafik & pemuat data
├── dinamis.js          # Tab KPR Dinamis
├── config.js           # Konfigurasi sumber data
└── google-apps-script/ # Backend opsional (Google Apps Script)
```

## ▶️ Menjalankan Secara Lokal

Aplikasi memuat data lewat `fetch()`, jadi jalankan melalui web server lokal (bukan dengan membuka `index.html` langsung):

```bash
python -m http.server 8080
```

Lalu buka `http://localhost:8080`. Bisa juga memakai ekstensi **Live Server** di VS Code.

Data program suku bunga dan tiering diambil dari Google Spreadsheet saat halaman dimuat; datanya tidak disimpan di repositori ini.

## ⚙️ Backend (Opsional)

Data suku bunga dapat dikelola dari Google Spreadsheet melalui Google Apps Script (`google-apps-script/Code.gs`).
Token akses **tidak disimpan di repositori** — atur di *Project Settings → Script Properties* pada editor Apps Script.

## ⚠️ Catatan

Hasil perhitungan bersifat **simulasi/ilustrasi** dan dapat berbeda dengan perhitungan resmi bank.
