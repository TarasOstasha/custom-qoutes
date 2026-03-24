import dotenv from "dotenv";
dotenv.config();
import { chromium, Page } from "playwright";

const TARGET_URL =
  "https://hxyrr-gdtbo.volusion.store/admin/TableViewer.asp?table=CartIDLog";

async function isLoginPage(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase();
  if (url.includes("login")) return true;

  const hasPasswordInput = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
  return hasPasswordInput;
}

async function fillFirstVisible(page: Page, selectors: string[], value: string) {
  for (const selector of selectors) {
    const el = page.locator(selector).first();
    if (await el.isVisible().catch(() => false)) {
      await el.fill(value);
      return true;
    }
  }
  return false;
}

async function main() {
  const email = process.env.VOLUSION_LOGIN_EMAIL;
  const password = process.env.VOLUSION_LOGIN_PASSWORD;

  if (!email || !password) {
    throw new Error("Missing VOLUSION_LOGIN_EMAIL or VOLUSION_LOGIN_PASSWORD in env.");
  }

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });

  if (await isLoginPage(page)) {
    await fillFirstVisible(
      page,
      ['input[name="email"]', 'input[name="Email"]', 'input[name="Login"]', 'input[name="username"]', 'input[type="email"]'],
      email
    );
    await fillFirstVisible(
      page,
      ['input[name="password"]', 'input[name="Password"]', 'input[type="password"]'],
      password
    );

    const submitted = await (async () => {
      const submitSelectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("Sign In")',
        'button:has-text("Login")',
      ];
      for (const selector of submitSelectors) {
        const btn = page.locator(selector).first();
        if (await btn.isVisible().catch(() => false)) {
          await btn.click();
          return true;
        }
      }
      return false;
    })();

    if (!submitted) {
      await page.keyboard.press("Enter");
    }

    await page.waitForLoadState("domcontentloaded");
  }

  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });

  console.log("Final URL:", page.url());
  console.log("Page Title:", await page.title());

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
