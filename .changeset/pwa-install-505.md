---
"prompt-hash-stellar": minor
---

Add PWA (installable web app) support for mobile creators and buyers (#505). The frontend now ships a web app manifest, generated app icons, and a service worker that precaches the shell and runtime-caches the API and fonts for offline browsing. An "Install app" button is wired into the navigation (desktop, mobile header, and mobile menu) using the `beforeinstallprompt` event, and `theme-color`/apple-touch meta are set for a native-like experience.
