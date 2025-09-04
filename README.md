# Age Estimation Web (On-Device)

Aplikasi web 1-halaman untuk **perkiraan umur dari wajah** langsung di perangkat (browser) tanpa server. Kamera harus lewat **HTTPS** (Vercel sudah https).

## 🚀 Deploy via GitHub + Vercel

1. **Buat repo GitHub baru** (mis. `age-estimation-web`).
2. **Upload** file `index.html` (dan file lain di repo ini) ke repo tersebut.
   - Atau gunakan Git (Windows CMD PowerShell):
     ```bash
     cd C:\age-estimation-web
     git init
     git add .
     git commit -m "init: age estimation web"
     git branch -M main
     git remote add origin https://github.com/USERNAME/age-estimation-web.git
     git push -u origin main
     ```
3. **Vercel** → **New Project** → **Import** repo GitHub tadi.
   - **Framework Preset**: `Other`
   - **Build Command**: *(kosongkan)*
   - **Output Directory**: *(kosongkan)*
   - Vercel akan mendeteksi **static** site dan langsung deploy.
4. Buka URL Vercel (https) → klik **Izinkan Kamera** → lihat hasil prediksi usia.

## 📁 Struktur
```
/ (root)
├─ index.html     # Aplikasi utama (1 file)
└─ README.md
```

## ❗ Catatan Penting
- Ini **perkiraan** (bisa meleset ± beberapa tahun).
- Gunakan secara etis, minta **consent** sebelum memproses wajah.
- Semua pemrosesan lokal; **tidak ada** upload gambar ke server.
- Jika di HP kamera tidak muncul, pastikan:
  - Akses via **HTTPS** (bukan file://).
  - Izin kamera sudah diberikan di browser.
  - Coba **Chrome** terbaru.

## 🧱 Teknologi
- [`@vladmandic/human`](https://github.com/vladmandic/human) dari CDN untuk deteksi wajah & estimasi umur (on-device).
