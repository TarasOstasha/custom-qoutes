import { chromium, Page } from "playwright";

const TARGET_URL =
  "https://www.xyzdisplays.com/admin/TableViewer.asp?table=CartIDLog";

async function isLoginPage(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase();
  if (url.includes("login")) return true;
  return page
    .locator('input[type="password"]')
    .first()
    .isVisible()
    .catch(() => false);
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

export async function identifyVolusionUser(
  cartId: string
): Promise<{ cartId: string; email: string | null }> {
  const loginEmail = process.env.VOLUSION_LOGIN_EMAIL;
  const password = process.env.VOLUSION_LOGIN_PASSWORD;

  if (!loginEmail || !password) {
    throw new Error("Missing VOLUSION_LOGIN_EMAIL or VOLUSION_LOGIN_PASSWORD.");
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });

    if (await isLoginPage(page)) {
      await fillFirstVisible(
        page,
        [
          'input[name="email"]',
          'input[name="Email"]',
          'input[name="Login"]',
          'input[name="username"]',
          'input[type="email"]',
        ],
        loginEmail
      );
      await fillFirstVisible(
        page,
        ['input[name="password"]', 'input[name="Password"]', 'input[type="password"]'],
        password
      );

      const submitSelectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("Sign In")',
        'button:has-text("Login")',
      ];
      let submitted = false;
      for (const selector of submitSelectors) {
        const btn = page.locator(selector).first();
        if (await btn.isVisible().catch(() => false)) {
          await btn.click();
          submitted = true;
          break;
        }
      }

      if (!submitted) {
        await page.keyboard.press("Enter");
      }

      await page.waitForLoadState("domcontentloaded");
    }

    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });

    const rows = page.locator("tr");
    const rowCount = await rows.count();
    let email: string | null = null;

    for (let i = 0; i < rowCount; i += 1) {
      const row = rows.nth(i);
      const cells = row.locator("td");
      const cellCount = await cells.count();
      if (cellCount < 4) continue;

      let hasCartId = false;
      for (let c = 0; c < cellCount; c += 1) {
        const text = (await cells.nth(c).innerText()).trim();
        if (text.toLowerCase() === cartId.toLowerCase()) {
          hasCartId = true;
          break;
        }
      }

      if (!hasCartId) continue;

      email = (await cells.nth(3).innerText()).trim() || null;
      break;
    }
    console.log(cartId, email, 'cartId, email');
    return { cartId, email };
  } finally {
    await browser.close();
  }
}
