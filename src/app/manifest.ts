import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/dashboard/city/pos',
    name: 'Hiroma Point of Sale',
    short_name: 'Hiroma POS',
    description: 'Secure and installable Hiroma cashier workspace for authorized branches and city distributors.',
    start_url: '/dashboard/city/pos?source=pwa',
    // Keep authentication inside the installed window. An expired cashier
    // session redirects to /login, which must remain inside the PWA scope.
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f4f6fb',
    theme_color: '#071638',
    categories: ['business', 'finance', 'productivity'],
    icons: [
      { src: '/pos-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pos-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/pos-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
    shortcuts: [
      {
        name: 'Open Hiroma POS',
        short_name: 'Open POS',
        description: 'Open the assigned Hiroma cashier terminal.',
        url: '/dashboard/city/pos',
        icons: [{ src: '/pos-icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  }
}
