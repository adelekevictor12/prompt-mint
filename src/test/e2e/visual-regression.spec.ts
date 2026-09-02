import { expect, test } from "@playwright/test";

/**
 * Key screens visual regression test suite for Playwright.
 * Specifically validates `browse`, `sell`, and `dashboard` as well as major app pages.
 */
const keyScreens = [
  { name: "browse", path: "/browse" },
  { name: "sell", path: "/sell" },
  { name: "dashboard", path: "/analytics" },
];

const secondaryRoutes = [
  { name: "home", path: "/" },
  { name: "chat", path: "/chat" },
  { name: "profile", path: "/profile" },
  { name: "status", path: "/status" },
  { name: "history", path: "/history" },
  { name: "favorites", path: "/favorites" },
  { name: "compare", path: "/compare" },
  { name: "api-keys", path: "/settings/api-keys" },
];

test.describe("major page visual regressions", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (!url.startsWith("http://localhost:5173")) {
        await route.abort();
        return;
      }
      await route.continue();
    });

    await page.addInitScript(() => {
      const style = document.createElement("style");
      style.textContent = `
          *, *::before, *::after {
            animation-delay: 0s !important;
            animation-duration: 0s !important;
            transition: none !important;
          }
        `;
      document.documentElement.appendChild(style);
    });
  });

  test.describe("key screens visual snapshot regression", () => {
    for (const screen of keyScreens) {
      test(`visual snapshot - ${screen.name} screen (${screen.path})`, async ({ page }) => {
        await page.goto(screen.path, { waitUntil: "domcontentloaded" });
        await expect(page.locator("body")).toBeVisible();
        await expect(page).toHaveScreenshot(`${screen.name}-screen.png`, {
          fullPage: true,
          animations: "disabled",
          caret: "hide",
        });
      });
    }
  });

  test.describe("additional application routes", () => {
    for (const route of secondaryRoutes) {
      test(`${route.name} page`, async ({ page }) => {
        await page.goto(route.path, { waitUntil: "domcontentloaded" });
        await expect(page.locator("body")).toBeVisible();
        await expect(page).toHaveScreenshot(`${route.name}.png`, {
          fullPage: true,
          animations: "disabled",
          caret: "hide",
        });
      });
    }
  });
});