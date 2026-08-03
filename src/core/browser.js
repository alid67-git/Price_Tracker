import { chromium } from "playwright";

const REALISTIC_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

let sharedBrowser = null;

export async function getBrowser() {
  if (!sharedBrowser) {
    sharedBrowser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"],
    });
  }
  return sharedBrowser;
}

export async function closeBrowser() {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}

/**
 * Yeni bir izole browser context acar (gercekci UA, TR locale).
 */
export async function newContext() {
  const browser = await getBrowser();
  return browser.newContext({
    userAgent: REALISTIC_USER_AGENT,
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
    viewport: { width: 1366, height: 900 },
  });
}

/** ms cinsinden min-max arasi rastgele bekleme. Ardisik isteklerde site'yi yormamak icin. */
export function randomDelay(minMs = 2000, maxMs = 5000) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Playwright ile sayfayi acip render edilmis HTML'ini dondurur. Canli testte
 * dogrulandi: bazi siteler (Trendyol dahil) duz `fetch()` isteklerini 403 ile
 * engelliyor ama gercek bir tarayici baglaminda calisiyor -- bu yuzden tum
 * pazaryeri/aggregator connector'lari icin varsayilan HTTP katmani budur,
 * hafif `fetch()` degil.
 * @param {string} url
 * @returns {Promise<string>} render edilmis HTML
 */
export async function fetchRenderedHtml(url, opts = {}) {
  const { waitUntil = "domcontentloaded", timeoutMs = 20000, waitForSelector = null, waitForNonEmptyText = null } = opts;
  const context = await newContext();
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil, timeout: timeoutMs });
    if (waitForNonEmptyText) {
      // Bazi alanlar (ornegin N11'in fiyat kutusu) once bos bir DOM node olarak
      // render olup icerigi biraz gecikmeli JS ile dolduruyor -- salt selector
      // varligi yetmiyor, metnin dolmasini beklemek gerekiyor.
      await page
        .waitForFunction(
          (sel) => {
            const el = document.querySelector(sel);
            return el && el.textContent.trim().length > 0;
          },
          waitForNonEmptyText,
          { timeout: 10000 }
        )
        .catch(() => {});
    } else if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: 8000 }).catch(() => {});
    } else {
      await page.waitForTimeout(1000);
    }
    return await page.content();
  } finally {
    await context.close();
  }
}

/**
 * Gecici hatalara karsi kisitli retry. 403/429 gibi bot-duvari sinyallerinde
 * agresif retry yapmaz, tek denemeden sonra vazgecer.
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{retries?: number, label?: string}} [opts]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, opts = {}) {
  const { retries = 2, label = "istek" } = opts;
  let lastError;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const blocked = /403|429|blocked|bot/i.test(String(err.message));
      if (blocked) {
        console.warn(`[${label}] bot-duvari/engelleme sinyali, vazgeciliyor: ${err.message}`);
        throw err;
      }
      if (attempt <= retries) {
        console.warn(`[${label}] deneme ${attempt} basarisiz (${err.message}), tekrar denenecek...`);
        await randomDelay(1000, 2000);
      }
    }
  }
  throw lastError;
}
