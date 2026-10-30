# 🏠 Kalkulator KPR — Versi Debitur

![HTML](https://img.shields.io/badge/HTML5-E34F26?style=flat&logo=html5&logoColor=white)
![CSS](https://img.shields.io/badge/CSS3-1572B6?style=flat&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)
![Chart.js](https://img.shields.io/badge/Chart.js-FF6384?style=flat&logo=chartdotjs&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat&logo=tailwindcss&logoColor=white)
![No Build](https://img.shields.io/badge/no%20build-needed-success)

Kalkulator KPR (Kredit Pemilikan Rumah) yang ramah pengguna untuk **debitur/nasabah**.
Versi sederhana dari kalkulator internal Consumer Loan Group (CSL), tanpa proses *build* — cukup HTML, CSS, dan JavaScript biasa.

🔗 **Demo:** <https://mine2710.github.io/kalkulator-kpr-debitur/>

---

## ✨ Fitur

- **Pilihan program KPR** dari file `programs.csv` — Fixed, Berjenjang, Fixed All Tenor, atau Manual (custom)
- **Tenor dinamis** menyesuaikan batas minimum & maksimum tiap program
- **Suku bunga bertahap** (sampai 7 tahap) dengan hitung ulang angsuran otomatis
- **Simulasi Take Over (TO)** — bandingkan skema sebelumnya vs skema take over:
  - Bunga lama bisa tunggal, atau **bertahap** seperti skema baru
  - Biaya tambahan take over bisa **nominal** atau **persen (%)**
  - Plafon skema sebelumnya bisa berbeda dari pinjaman baru
  - Deteksi otomatis **titik impas / BEP** (bisa lebih dari satu) dan selisih total pembayaran
- **Output lengkap**: IRR tahunan, total jangka waktu, total pembayaran, total bunga, grafik kumulatif, tabel ringkasan tahap, dan jadwal amortisasi lengkap
- **Tersimpan otomatis** di browser (localStorage) — input terakhir dipulihkan saat dibuka lagi
- Responsif (HP & desktop) + mode gelap/terang otomatis

---

## 📁 Struktur File

```
kalkulator-kpr-debitur/
├── index.html     # Halaman utama (UI)
├── script.js      # Logika kalkulator (matematika KPR, grafik, tabel)
├── style.css      # Styling tambahan
├── programs.csv   # Daftar program KPR & suku bunga (mudah diedit)
└── README.md
```

---

## ⚙️ Konfigurasi Program (`programs.csv`)

Program KPR dibaca dari `programs.csv`. Format tiap baris:

```
tier,key,name,min_months,segments
```

`segments` berisi daftar `bulan:bunga` dipisah tanda pipe (`|`). Contoh:

```
no_tier,berjenjang10,Berjenjang 10 Thn,120,36:4.0|36:8.5|48:10.0|180:12.5
```

Artinya: 36 bln @ 4%, lalu 36 bln @ 8,5%, lalu 48 bln @ 10%, sisanya 180 bln @ 12,5%.

---

## ▶️ Cara Menjalankan (Lokal)

> ⚠️ **Penting:** aplikasi membaca `programs.csv` lewat `fetch`, jadi **tidak bisa** dibuka dengan klik dua kali (`file://`). Jalankan lewat web server lokal.

**Opsi 1 — VS Code Live Server (disarankan):**
1. Install ekstensi **Live Server**.
2. Klik kanan `index.html` → **Open with Live Server**.

**Opsi 2 — Python:**
```bash
python -m http.server
# lalu buka http://localhost:8000
```

---

## 🚀 Deploy ke GitHub Pages

1. Buka **Settings → Pages**.
2. Bagian *Source*, pilih branch `main` dan folder `/ (root)`, lalu **Save**.
3. Tunggu 1-2 menit. Situs tayang di `https://<username>.github.io/kalkulator-kpr-debitur/`.

---

## 🛠️ Teknologi

- HTML + CSS + JavaScript (tanpa framework, tanpa build)
- [Tailwind CSS](https://tailwindcss.com/) via CDN untuk styling
- [Chart.js](https://www.chartjs.org/) untuk grafik (via CDN)

---

## 📝 Catatan

Simulasi ini bersifat **estimasi** untuk edukasi debitur. Angka resmi tetap mengacu pada ketentuan bank.
