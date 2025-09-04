# Fabaro Age Estimation — Next.js PWA

Age estimation (perkiraan umur dari wajah) **on-device** dengan **Next.js + PWA**.
- **Cepat & privat:** pemrosesan di perangkat.
- **PWA installable:** bisa di-install di Android/iOS/desktop.
- **Offline-first:** Service Worker akan menyimpan model Human.js setelah pemakaian pertama agar lebih lancar.

## 🚀 Deploy via GitHub + Vercel
1. Buat repo GitHub, upload semua file project ini.
2. **Vercel → New Project → Import** dari GitHub.
   - Framework: **Other** (atau biarkan autodetect).
   - Build: `next build`
   - Output: otomatis oleh Next.
3. Setelah deploy, buka URL Vercel (HTTPS), klik **Izinkan Kamera**.

## 🛠️ Pengembangan lokal
```bash
npm i
npm run dev
# buka http://localhost:3000
```

## 📦 Produksi
```bash
npm run build
npm start
```

## ⚙️ Teknologi
- Next.js 14 (App Router)
- Human.js (deteksi wajah & age)
- Service Worker untuk cache runtime model dan asset

## 🔒 Catatan Etika & Hukum
- Hanya perkiraan; minta persetujuan (consent).
- Jangan gunakan untuk keputusan berdampak.
- Patuhi UU PDP No. 27/2022.
