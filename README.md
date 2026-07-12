# GoPay Merchant Gateway (QRIS Dynamic Payment Gateway SaaS)

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D%2022.0.0-blue.svg)](https://nodejs.org)
[![Database](https://img.shields.io/badge/database-Supabase-green.svg)](https://supabase.com)
[![WhatsApp Gateway](https://img.shields.io/badge/whatsapp-Fonnte-brightgreen.svg)](https://fonnte.com)
[![License](https://img.shields.io/badge/license-ISC-blue.svg)](LICENSE)

Aplikasi **GoPay Merchant Gateway** adalah sistem Payment Gateway SaaS (Software as a Service) berbasis **Node.js** dan **Express** yang memungkinkan merchant untuk membuat dan mengintegrasikan pembayaran **QRIS Dinamis** secara otomatis dan instan. Dilengkapi dengan notifikasi webhook, verifikasi OTP via WhatsApp (menggunakan layanan Fonnte), dan penyimpanan berbasis Cloud PostgreSQL (Supabase).

Aplikasi ini sangat cocok bagi pelaku bisnis online yang ingin mengintegrasikan pembayaran QRIS dengan **0% potongan fee (MDR)** karena dana pembayaran langsung masuk 100% ke rekening/e-wallet merchant (GoPay/OVO/Dana/LinkAja/Qris Gopay Merchant) Anda sendiri tanpa perantara.

---

## 🌟 Fitur Utama

- **QRIS Dinamis Otomatis**: Mengubah QRIS Statis Merchant (GoPay, ShopeePay, dll.) secara programatis menjadi QRIS Dinamis berdasarkan jumlah nominal transfer dengan penyesuaian Tag 54 dan perhitungan ulang CRC16 standar.
- **Upload & Decode QRIS**: Dilengkapi dengan fitur unggah gambar QRIS Statis untuk didekode otomatis menjadi teks QRIS menggunakan library `jimp` dan `jsqr`.
- **Portal Merchant & Dashboard SaaS**: Portal antarmuka modern yang menyajikan statistik penjualan, log transaksi, pengaturan API Key, dan riwayat webhook.
- **Autentikasi Dua Faktor (2FA) WhatsApp OTP**: Sistem masuk yang aman menggunakan verifikasi password ditambah kode OTP 6 digit yang dikirim langsung ke WhatsApp merchant menggunakan API Fonnte.
- **Sistem Webhook Real-time**: Mengirimkan notifikasi callback transaksi otomatis ke server backend Anda secara instan saat status pembayaran berubah. Dilengkapi dengan fitur log webhook dan pengiriman ulang (retry).
- **Keamanan Ketat (Security & Rate Limiting)**:
  - Pembatasan request menggunakan *In-Memory Rate Limiter* untuk mencegah serangan brute force pada form login dan pendaftaran.
  - Autentikasi API Key terenkripsi (Public & Secret API Keys) dengan hashing bcrypt.
  - Header HTTP Keamanan Kustom (CORS, XSS Protection, Frame Options).
- **Database Self-Healing**: Otomatis melengkapi profil merchant, membuat kunci API, serta pengaturan webhook jika data belum tersedia saat pengguna masuk untuk pertama kali.

---

## 🛠️ Stack Teknologi

- **Backend Runtime**: [Node.js v22+](https://nodejs.org) (menggunakan fitur bawaan global `fetch` dan `FormData`)
- **Web Framework**: [Express.js v5](https://expressjs.com)
- **Database**: [Supabase](https://supabase.com) (PostgreSQL Client & REST API)
- **WhatsApp Gateway**: [Fonnte](https://fonnte.com) (API WhatsApp Gateway Indonesia)
- **QR Decoding**: [jsQR](https://github.com/cozmo/jsQR) & [Jimp](https://github.com/jimp-dev/jimp)
- **QR Encoding**: [qrcode](https://github.com/soldair/node-qrcode)
- **Kriptografi & Keamanan**: [bcrypt](https://github.com/kelektiv/node.bcrypt.js) & [jsonwebtoken (JWT)](https://github.com/auth0/node-jsonwebtoken)

---

## 📂 Struktur Direktori

```text
autopost/
├── data/                    # Penyimpanan data JSON konfigurasi SaaS
│   └── saas_settings.json   # Pengaturan durasi kedaluwarsa & panjang kode nominal
├── public/                  # Static files untuk UI Front-End
│   ├── css/                 # Styling kustom (Vanilla CSS)
│   ├── js/                  # Logic JavaScript untuk interaksi API
│   ├── api-docs.html        # Dokumentasi API interaktif
│   ├── gateway.html         # Portal Dashboard Merchant
│   └── index.html           # Landing page / Form Login & Register
├── src/
│   ├── config/              # Berkas konfigurasi tambahan
│   └── services/            # Modul helper dan integrasi pihak ketiga
│       ├── fonnteService.js # Integrasi pengiriman pesan & OTP WhatsApp via Fonnte
│       └── qrService.js     # Helper decode QR Code gambar ke string QRIS
├── uploads/                 # Folder penyimpanan sementara unggahan QRIS
├── .env                     # File konfigurasi sensitif (diabaikan oleh git)
├── .env.example             # Template konfigurasi environment variables
├── .gitignore               # Berkas untuk mengabaikan folder sensitif dari Git
├── package.json             # Dependensi npm & metadata proyek
├── server.js                # Entry point utama aplikasi Express
└── test-api.js              # Script testing untuk API endpoints
```

---

## 🚀 Panduan Instalasi

### 1. Prasyarat
Pastikan Anda sudah menginstal:
*   [Node.js](https://nodejs.org/) versi 22.0.0 atau yang lebih baru.
*   Akun [Supabase](https://supabase.com) yang aktif beserta project PostgreSQL.
*   Akun [Fonnte](https://fonnte.com) untuk pengiriman OTP WhatsApp.

### 2. Kloning Repositori
Kloning repositori ini atau download source codenya:
```bash
git clone https://github.com/febzofc/gopay-merchant-gateway.git
cd gopay-merchant-gateway
```

### 3. Instalasi Dependensi
Jalankan perintah berikut untuk menginstal package yang diperlukan:
```bash
npm install
```

### 4. Konfigurasi Environment Variables
Salin berkas `.env.example` menjadi `.env`:
```bash
cp .env.example .env
```
Buka file `.env` dan lengkapi konfigurasi berikut sesuai akun Anda:
```env
PORT=3000

# Kredensial Login Admin
ADMIN_USER=Febriansyah
ADMIN_PASS=Febri956

# Kredensial Supabase
SUPABASE_URL=https://akghoqwwkkzndeibtalj.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Token Fonnte (Layanan Pengiriman WhatsApp)
FONNTE_TOKEN=your_fonnte_token_here

# Kunci Rahasia JWT
JWT_SECRET=your_jwt_secret_key
```

### 5. Struktur Database (Supabase)
Pastikan Anda memiliki tabel-tabel berikut di database Supabase Anda:
*   `users`: Menyimpan kredensial user & nomor WhatsApp.
*   `merchants`: Menyimpan data profil merchant/toko.
*   `api_keys`: Menyimpan public_key dan hash secret_key untuk akses API.
*   `merchant_qris`: Menyimpan string QRIS statis merchant.
*   `webhook_settings`: Menyimpan URL webhook merchant & secret token.
*   `webhook_logs`: Menyimpan history log pengiriman webhook beserta respons server tujuan.
*   `transactions`: Menyimpan data transaksi pembayaran.
*   `otp_codes`: Menyimpan data OTP login sementara.
*   `password_reset_tokens`: Menyimpan token reset password.
*   `audit_logs`: Mencatat aktivitas keamanan pengguna.

### 6. Menjalankan Aplikasi
Untuk menjalankan server secara lokal:
```bash
npm start
# Atau jika menggunakan node langsung:
node server.js
```
Aplikasi akan berjalan di `http://localhost:3000` (atau port yang Anda tentukan di `.env`).

---

## 🔌 Dokumentasi Singkat API

Dokumentasi API lengkap dapat diakses secara visual setelah server berjalan melalui alamat `http://localhost:3000/api-docs`.

Berikut adalah beberapa endpoint utama:

### **Autentikasi**
*   `POST /api/auth/register` : Mendaftarkan merchant baru.
*   `POST /api/auth/login` : Memverifikasi kata sandi dan mengirim kode OTP ke WhatsApp.
*   `POST /api/auth/verify-otp` : Memverifikasi kode OTP 6 digit dan mengeluarkan JWT Token.
*   `POST /api/auth/forgot-password` : Mengirim tautan pemulihan kata sandi ke WhatsApp.
*   `POST /api/auth/reset-password` : Memperbarui kata sandi menggunakan token reset.

### **Manajemen Merchant (Butuh JWT Token)**
*   `GET /api/merchant/profile` : Mengambil informasi profil merchant.
*   `PUT /api/merchant/profile` : Memperbarui profil merchant.
*   `GET /api/merchant/qris` : Mengambil data string QRIS yang terdaftar.
*   `POST /api/merchant/qris/decode` : Mengunggah gambar QR Code dan mengembalikannya dalam bentuk teks QRIS.
*   `POST /api/merchant/qris` : Menyimpan string QRIS merchant.

### **Integrasi Transaksi & API Gateway (Menggunakan API Key Header)**
Gunakan header berikut untuk mengakses endpoint transaksi API:
*   `x-api-key`: `pk_xxxxxxxxxxxxxxxx`
*   `x-secret-key`: `sk_xxxxxxxxxxxxxxxxxxxxxxxx`

*   `POST /api/payment/generate-qris` : Membuat pembayaran baru dan menghasilkan QRIS Dinamis.
*   `GET /api/payment/check` : Mengecek status pembayaran tertentu.
*   `GET /api/payment/transactions` : Mengambil daftar transaksi yang masuk.

---

## 🔒 Keamanan Informasi Penting

> [!WARNING]  
> Jangan pernah mengunggah berkas `.env` atau folder `node_modules` Anda ke dalam repositori publik GitHub. File tersebut berisi kredensial server dan database Supabase yang sangat sensitif. Pastikan file `.gitignore` selalu aktif sebelum melakukan git commit.

---

## 👨‍💻 Kontributor & Lisensi
*   **Author**: Febriansyah (febzofc)
*   **Lisensi**: Proyek ini dilisensikan di bawah [ISC License](LICENSE).
