require("../lib/playwrightSetup");

import { setTimeout as delay } from "node:timers/promises";
import type { Page } from "playwright";

const STORE_BASE =
  process.env.VOLUSION_STORE_BASE_URL?.trim() || "https://www.xyzdisplays.com";

function preferPhp(url: string): string {
  return url.replace(/\.asp(?=($|\?|#))/gi, ".php");
}

function storefrontCredentials(): { email: string; password: string } | null {
  const email =
    process.env.VOLUSION_STOREFRONT_EMAIL?.trim() ||
    process.env.VOLUSION_LOGIN_EMAIL?.trim() ||
    "";
  const password =
    process.env.VOLUSION_STOREFRONT_PASSWORD?.trim() ||
    process.env.VOLUSION_LOGIN_PASSWORD?.trim() ||
    "";
  if (!email || !password) return null;
  return { email, password };
}

async function fillFirstVisible(page: Page, selectors: string[], value: string): Promise<boolean> {
  for (const selector of selectors) {
    const el = page.locator(selector).first();
    if (await el.isVisible().catch(() => false)) {
      await el.fill(value);
      return true;
    }
  }
  return false;
}

async function clickFirstVisible(page: Page, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    const el = page.locator(selector).first();
    if (await el.isVisible().catch(() => false)) {
      await el.click();
      return true;
    }
  }
  return false;
}

async function dismissCookieBanner(page: Page): Promise<void> {
  await clickFirstVisible(page, [
    'button:has-text("Accept")',
    'button:has-text("Accept All")',
    'button:has-text("I Agree")',
    'a:has-text("Accept")',
  ]).catch(() => false);
  await delay(200);
}

function isAdminUrl(url: string): boolean {
  const u = url.toLowerCase();
  return u.includes("/admin/") || u.includes("login.volusion.com");
}

async function looksLoggedInOnStorefront(page: Page): Promise<boolean> {
  const url = page.url();
  if (isAdminUrl(url) && !url.toLowerCase().includes("xyzdisplays.com") && !url.includes("Login.php")) {
    // Still on hosted login — not a storefront customer session.
    if (url.includes("login.volusion.com")) return false;
  }
  if (url.toLowerCase().includes("/admin/")) return false;

  const bodyText = ((await page.locator("body").innerText().catch(() => "")) || "").toLowerCase();
  if (
    bodyText.includes("log out") ||
    bodyText.includes("logout") ||
    bodyText.includes("sign out") ||
    bodyText.includes("signout")
  ) {
    return true;
  }

  const logoutSelectors = [
    'a:has-text("Log Out")',
    'a:has-text("Logout")',
    'a:has-text("Sign Out")',
    'a[href*="Logout"]',
    'a[href*="logout"]',
    'a[href*="logoff"]',
  ];
  for (const selector of logoutSelectors) {
    const el = page.locator(selector).first();
    if (await el.isVisible().catch(() => false)) return true;
  }

  return false;
}

async function completeHostedVolusionLogin(page: Page, email: string, password: string): Promise<void> {
  // Auth0 / login.volusion.com form.
  await page.waitForURL(/login\.volusion\.com/i, { timeout: 15_000 }).catch(() => undefined);
  if (!/login\.volusion\.com/i.test(page.url())) return;

  await fillFirstVisible(
    page,
    ['input[name="username"]', 'input[name="email"]', 'input[type="email"]', 'input[name="emailAddress"]'],
    email,
  );
  await fillFirstVisible(page, ['input[name="password"]', 'input[type="password"]'], password);
  await clickFirstVisible(page, [
    'button:has-text("Log in")',
    'button:has-text("Login")',
    'button[type="submit"]',
    'button[name="action"]',
  ]);
  await page.waitForLoadState("domcontentloaded");
  await delay(1200);
}

/**
 * Ensure the persistent storefront session is logged in as a *customer*.
 * Note: staff VOLUSION_LOGIN_* often authenticates to /admin (not storefront).
 * Prefer VOLUSION_STOREFRONT_EMAIL/PASSWORD for a real customer account.
 */
export async function ensureVolusionStorefrontLogin(page: Page): Promise<{
  loggedIn: boolean;
  email: string | null;
  skipped?: boolean;
  error?: string;
}> {
  const creds = storefrontCredentials();
  if (!creds) {
    return {
      loggedIn: false,
      email: null,
      skipped: true,
      error: "Missing VOLUSION_STOREFRONT_EMAIL/PASSWORD (or VOLUSION_LOGIN_*)",
    };
  }

  try {
    if (await looksLoggedInOnStorefront(page)) {
      return { loggedIn: true, email: creds.email };
    }

    const loginUrl = preferPhp(`${STORE_BASE.replace(/\/$/, "")}/Login.php`);
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await delay(400);
    await dismissCookieBanner(page);

    if (await looksLoggedInOnStorefront(page)) {
      return { loggedIn: true, email: creds.email };
    }

    // Step 1: email on storefront Login.php
    const emailFilled = await fillFirstVisible(
      page,
      [
        'input[name="email"]',
        'input[name="Email"]',
        'input[name="CustomerEmail"]',
        'input[name="Em"]',
        'input[type="email"]',
        'form input[type="text"]',
      ],
      creds.email,
    );
    if (!emailFilled) {
      return { loggedIn: false, email: creds.email, error: "Could not find storefront email field" };
    }

    const continued = await clickFirstVisible(page, [
      'button:has-text("Continue")',
      'input[type="submit"][value*="Continue" i]',
      'input[value*="Continue" i]',
      'button[type="submit"]',
      'input[type="submit"]',
    ]);
    if (!continued) await page.keyboard.press("Enter");
    await page.waitForLoadState("domcontentloaded");
    await delay(800);

    // Step 2a: password still on storefront, or 2b: hosted login.volusion.com
    if (/login\.volusion\.com/i.test(page.url())) {
      await completeHostedVolusionLogin(page, creds.email, creds.password);
    } else if (await page.locator('input[type="password"]').first().isVisible().catch(() => false)) {
      await fillFirstVisible(
        page,
        ['input[name="password"]', 'input[name="Password"]', 'input[type="password"]'],
        creds.password,
      );
      const submitted = await clickFirstVisible(page, [
        'button:has-text("Sign In")',
        'button:has-text("Log In")',
        'button:has-text("Login")',
        'button:has-text("Continue")',
        'button[type="submit"]',
        'input[type="submit"]',
      ]);
      if (!submitted) await page.keyboard.press("Enter");
      await page.waitForLoadState("domcontentloaded");
      await delay(1000);
    } else {
      // Wait briefly for hosted redirect.
      await completeHostedVolusionLogin(page, creds.email, creds.password);
    }

    const finalUrl = page.url();
    if (finalUrl.toLowerCase().includes("/admin/")) {
      console.log("[storefront-login] landed on admin, not storefront customer session", finalUrl);
      // Leave admin; reopen storefront home as guest so cart work continues.
      await page.goto(preferPhp(`${STORE_BASE.replace(/\/$/, "")}/`), {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      return {
        loggedIn: false,
        email: creds.email,
        error:
          "Credentials signed into Volusion Admin, not a storefront customer. Set VOLUSION_STOREFRONT_EMAIL/PASSWORD to a customer account (guest carts will have blank email).",
      };
    }

    const ok = await looksLoggedInOnStorefront(page);
    console.log("[storefront-login]", { email: creds.email, loggedIn: ok, url: finalUrl });
    return {
      loggedIn: ok,
      email: creds.email,
      ...(ok ? {} : { error: "Storefront customer login did not succeed" }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Storefront login failed";
    return { loggedIn: false, email: creds.email, error: message };
  }
}

export function configuredStorefrontEmail(): string | null {
  return storefrontCredentials()?.email ?? null;
}
