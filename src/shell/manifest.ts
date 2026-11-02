// KC-0016 / KC-0121: the web app manifest — opens Nu standalone, dark from the first paint.
// Rendered from code so the name under the home-screen icon is PRODUKT, never a mirror of it.
import { PRODUKT } from './navn.ts';

export function manifest(): Record<string, unknown> {
  return {
    name: PRODUKT,
    short_name: PRODUKT,
    id: '/',
    lang: 'da',
    start_url: '/rum/hjem',
    scope: '/',
    display: 'standalone',
    background_color: '#121614',
    theme_color: '#0E1210',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
