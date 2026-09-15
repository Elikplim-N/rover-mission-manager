import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Rover Mission Manager',
        short_name: 'Rover Mission',
        description: 'Local-first mission control and telemetry for the autonomous seed-planting rover. Works over the rover\'s own WiFi with no internet connection required.',
        theme_color: '#2563eb',
        background_color: '#f9fafb',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // Precache the app shell only. Calls to the rover's own LAN IP
        // (a different origin, e.g. http://192.168.4.1:8080) and to the
        // optional cloud sync API are left alone so they always hit the
        // network live instead of serving stale cached data.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: '/index.html',
        // The bundle includes Three.js (3D digital twin) and Plotly (analytics
        // charts), so it comfortably exceeds Workbox's 2 MiB default; raise the
        // limit rather than leave the app shell partially cached and unusable offline.
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024
      }
    })
  ],
})
