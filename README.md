# 🏠 Kalkulator KPR — Versi Debitur BRI

![HTML](https://img.shields.io/badge/HTML5-E34F26?style=flat&logo=html5&logoColor=white)
![CSS](https://img.shields.io/badge/CSS3-1572B6?style=flat&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)
![Chart.js](https://img.shields.io/badge/Chart.js-FF6384?style=flat&logo=chartdotjs&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat&logo=tailwindcss&logoColor=white)
![Google Apps Script](https://img.shields.io/badge/Google_Apps_Script-4285F4?style=flat&logo=google&logoColor=white)

Kalkulator KPR (Kredit Pemilikan Rumah) yang ramah pengguna untuk **debitur/nasabah BRI**.
Mendukung sinkronisasi suku bunga secara online langsung dari **Google Spreadsheet** via **HTTP POST aman dengan Token terselubung**.

---

## 🔒 Arsitektur Keamanan API (Sama seperti KKB)

1. **Akses GET Ditutup Penuh (405 Method Not Allowed):**
   Mencegah pihak luar membuka link API di browser secara langsung.
2. **HTTP POST Payload Tertutup:**
   Token keamanan dikirimkan di dalam *body payload* JSON `{ "token": "..." }`, bukan sebagai query parameter di URL.
3. **Kredensial Tersandikan (Obfuscated):**
   URL dan token di `config.js` dienkripsi dengan XOR + Base64 sehingga tidak terbaca sebagai teks polos di DevTools browser.
4. **Cadangan Otomatis (Offline Fallback):**
   Jika Google Spreadsheet sedang lambat atau offline, aplikasi otomatis beralih memuat data cadangan lokal dari `programs.csv`.

---

## 📁 Struktur File

```
kalkulator-kpr-debitur/
├── index.html                   # Halaman UI kalkulator
├── config.js                    # Konfigurasi endpoint & token (obfuscated)
├── script.js                    # Logika perhitungan, grafik & data loader (POST + fallback CSV)
├── dinamis.js                   # Tab "KPR Dinamis": dana pengurang bunga (tiering CSL) — dari file Excel di Tambahan/
├── style.css                    # Styling tambahan
├── programs.csv                 # Data cadangan lokal suku bunga KPR
├── tiering.csv                  # Data cadangan lokal tabel tiering KPR Dinamis
├── obfuscate.py / obfuscate.js  # Tool bantu enkripsi URL Web App & Token
├── google-apps-script/
│   └── Code.gs                  # Kode backend untuk Google Spreadsheet Apps Script
└── README.md
```

---

## ⚙️ Cara Menghubungkan Google Spreadsheet (Apps Script)

1. **Buat Google Spreadsheet baru:**
   - Beri nama (misalnya: `Database KPR Debitur BRI`).
   - Buat sheet bernama `programs`.

2. **Buka Google Apps Script:**
   - Di spreadsheet, klik menu **Extensions (Ekstensi)** > **Apps Script**.
   - Hapus semua kode bawaan di `Code.gs`.
   - Salin isi dari [google-apps-script/Code.gs](file:///d:/Kerja/Magang%20Hub%20BRI/kalkulator-kpr-debitur/kalkulator-kpr-debitur/google-apps-script/Code.gs) dan tempel ke editor Apps Script.

3. **Inisialisasi Template Data (Opsional tapi Mudah):**
   - Di toolbar editor Apps Script, pilih fungsi `isiTemplateDataKPR`.
   - Klik **Run (Jalankan)** dan berikan izin akses saat diminta. Sheet `programs` akan otomatis terisi seluruh suku bunga KPR resmi.

4. **Deploy sebagai Web App:**
   - Klik tombol biru **Deploy** > **New deployment (Penerapan baru)**.
   - Pilih jenis roda gigi ⚙️ > **Web app (Aplikasi web)**.
   - Isi pengaturan berikut:
     - **Description:** `API Kalkulator KPR Debitur BRI`
     - **Execute as:** `Me` (email Anda)
     - **Who has access:** `Anyone` (Siapa saja)
   - Klik **Deploy**, lalu salin **Web app URL** yang dihasilkan (berformat `https://script.google.com/macros/s/.../exec`).

5. **Enkripsikan URL ke `config.js`:**
   Jalankan perintah ini di terminal (menggunakan URL deploy Anda):
   ```bash
   python obfuscate.py "https://script.google.com/macros/s/.../exec" "BRI_KPR_SECURE_TOKEN_2026_xyz88"
   ```
   Salin nilai `_O_URL` dan `_O_TOK` yang dicetak ke dalam file [config.js](file:///d:/Kerja/Magang%20Hub%20BRI/kalkulator-kpr-debitur/kalkulator-kpr-debitur/config.js).

---

## ▶️ Cara Menjalankan Aplikasi (Lokal)

Aplikasi membaca data lewat `fetch()`, sehingga **harus dijalankan melalui web server lokal** (jangan klik dua kali file `index.html`).

### Opsi 1 — VS Code Live Server (Paling Praktis)
1. Buka folder proyek di VS Code.
2. Pastikan ekstensi **Live Server** sudah terpasang.
3. Klik kanan pada file `index.html` → pilih **Open with Live Server**.

### Opsi 2 — Menggunakan Python
Buka terminal di dalam folder proyek, lalu jalankan:
```bash
python -m http.server 8080
```
Buka browser ke alamat: `http://localhost:8080`

---

## 🧪 Cara Pengujian Keamanan

1. **Uji Coba GET (Buka URL Web App di Browser Langsung):**
   - Tempelkan URL Web App Anda ke address bar browser.
   - Hasil yang benar adalah ditolak dengan status:
     ```json
     {"status":"error","code":405,"message":"405 Method Not Allowed: Endpoint ini hanya menerima permintaan via HTTP POST dengan Token yang sah."}
     ```
2. **Uji Coba POST dari Web Kalkulator:**
   - Buka web kalkulator via Live Server.
   - Buka Console DevTools (F12) → akan muncul pesan:
     `Database program KPR berhasil dimuat via POST dari Google Spreadsheet (... program).`
