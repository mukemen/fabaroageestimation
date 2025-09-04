import './globals.css'
import type { Metadata } from 'next'
import Script from 'next/script'

export const metadata: Metadata = {
  title: 'Fabaro Age Estimation (PWA)',
  description: 'Perkiraan umur dari wajah, 100% on-device. Installable PWA.',
  manifest: '/manifest.webmanifest',
  themeColor: '#0B0B0C',
  icons: {
    icon: [
      { url: '/icons/icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }
    ],
    apple: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }]
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        {children}
        {/* Human.js untuk deteksi wajah & age */}
        <Script
          src="https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/dist/human.js"
          strategy="afterInteractive"
        />
        {/* Daftarkan Service Worker PWA */}
        <Script id="sw-register" strategy="afterInteractive">{`
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
              navigator.serviceWorker.register('/sw.js').catch(console.error);
            });
          }
        `}</Script>
      </body>
    </html>
  )
}
