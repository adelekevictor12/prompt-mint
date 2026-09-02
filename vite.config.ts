import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import { VitePWA } from "vite-plugin-pwa";
import { nodePolyfills } from "vite-plugin-node-polyfills";
// import tailwindcss from '@tailwindcss/vite';
import path from "path";

// https://vite.dev/config/
export default defineConfig(() => {
  return {
    plugins: [
      react(),
      // tailwindcss(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: [
          "favicon.ico",
          "pwa/icon-192.png",
          "pwa/icon-512.png",
          "pwa/maskable-512.png",
          "pwa/apple-touch-icon.png",
        ],
        manifest: {
          name: "PromptHash — Stellar Prompt Marketplace",
          short_name: "PromptHash",
          description:
            "Buy, sell, and license AI prompts with wallet-verified XLM payments on Stellar.",
          theme_color: "#7c3aed",
          background_color: "#020617",
          display: "standalone",
          orientation: "portrait",
          start_url: "/",
          scope: "/",
          lang: "en",
          categories: ["shopping", "finance", "productivity"],
          icons: [
            {
              src: "/pwa/icon-192.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "/pwa/icon-512.png",
              sizes: "512x512",
              type: "image/png",
            },
            {
              src: "/pwa/maskable-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,woff2,png,ico}"],
          navigateFallback: "/index.html",
          cleanupOutdatedCaches: true,
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.startsWith("/api"),
              handler: "NetworkFirst",
              options: {
                cacheName: "prompthash-api",
                networkTimeoutSeconds: 10,
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 60 * 60 * 24,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: ({ url }) =>
                url.hostname.includes("fonts.googleapis.com") ||
                url.hostname.includes("fonts.gstatic.com"),
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "prompthash-fonts",
                expiration: {
                  maxEntries: 20,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: false,
          type: "module",
        },
      }),
      nodePolyfills({
        include: ["buffer"],
        globals: {
          Buffer: true,
        },
      }),
      wasm(),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "libsodium-wrappers": path.resolve(
          __dirname,
          "./node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js",
        ),
      },
    },
    build: {
      target: "esnext",
    },
    define: {
      global: "window",
    },
    envPrefix: "PUBLIC_",
    test: {
      environment: "node",
    },
    server: {
      proxy: {
        "/friendbot": {
          // target: "http://localhost:8000/friendbot",
          target: "https://friendbot.stellar.org",
          changeOrigin: true,
        },
        "/api": {
          target: "http://localhost:5000",
          changeOrigin: true,
        },
      },
    },
  };
});
