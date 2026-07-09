import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "LIV Fantasy",
        short_name: "LIV Fantasy",
        description: "Fantasy golf for LIV Golf events",
        theme_color: "#0a0a0a",
        background_color: "#0a0a0a",
        display: "standalone",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
  server: {
    // Vite blocks requests with an unrecognized Host header by
    // default (DNS-rebinding protection) - this is what you'd hit
    // immediately when accessing the dev server through a tunnel
    // (e.g. cloudflared, ngrok) since the public URL's hostname isn't
    // localhost. Safe to leave on for local development/testing; this
    // server should never be exposed via a real production deploy.
    allowedHosts: true,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET || "http://localhost:3001",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
