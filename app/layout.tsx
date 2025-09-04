import './globals.css'
import type { Metadata } from 'next'
import Script from 'next/script'

export const metadata: Metadata = {
  title: 'Fabaro Age Estimation (PWA)',
  description: 'Perkiraan umur dari wajah, 100% on-device. Installable PWA.',
  manifest: '/manifest.webmanifest',
  themeColor: '#0b0b0c',
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/icon-192.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        {children}
        {/* Load Human.js from CDN after interactive */}
        <Script src="https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/dist/human.js" strategy="afterInteractive"/>
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
