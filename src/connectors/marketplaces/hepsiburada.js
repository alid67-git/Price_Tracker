import { makeOffer, todayDateString } from "../../core/offer.js";
import { newContext, randomDelay, withRetry } from "../../core/browser.js";

export const platform = "hepsiburada";

// Hepsiburada urun sayfasi window.productModel.product global'inda yapilandirilmis
// urun+satici verisi tasir (interaktif tarayici oturumuyla dogrulandi). Duz HTTP
// fetch 403 doner. ONEMLI: temiz/basit bir Playwright headless oturumu da bu
// sitede 403 + "Güvenlik" arayla sayfasina takilabiliyor (canli testte gozlendi) --
// yani bu connector calisir durumdadir ama Hepsiburada'nin bot korumasi headless
// Chromium'u bazen engelliyor. Bu, bilinen bir kisit: gerekirse stealth eklentisi
// (ör. playwright-extra + puppeteer-extra-plugin-stealth muadili) veya kalici/
// dogrulanmis bir tarayici oturumu (cerezleriyle) eklenmesi gerekebilir.
function extractProductModel() {
  // Bu fonksiyon page.evaluate icinde tarayici baglaminda calisir.
  const model = window.productModel?.product;
  if (!model) return null;
  return {
    sku: model.sku ?? null,
    name: model.name ?? null,
    currentListing: model.currentListing ?? null,
    listings: Array.isArray(model.listings) ? model.listings : [],
  };
}

function listingToOfferFields(listing) {
  const merchant_name = listing.merchantName ?? listing.merchant?.name ?? null;
  const priceValue = listing.currentPrice?.value ?? listing.price?.value ?? null;
  const is_in_stock = listing.stockInformation?.isInStock ?? true;
  const free_shipping = listing.shipmentInformation?.freeShipping ?? false;
  return { merchant_name, priceValue, is_in_stock, free_shipping };
}

export function canHandle(url) {
  return /(^|\.)hepsiburada\.com$/i.test(new URL(url).hostname);
}

export async function fetchOffers({ sku, url }) {
  const date = todayDateString();
  const context = await newContext();
  try {
    const page = await context.newPage();
    const model = await withRetry(
      async () => {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
        await page
          .waitForFunction(() => Boolean(window.productModel?.product?.currentListing), { timeout: 10000 })
          .catch(() => {});
        const m = await page.evaluate(extractProductModel);
        if (!m || !m.currentListing) throw new Error("productModel bulunamadi");
        return m;
      },
      { label: "hepsiburada" }
    );

    const listings = [model.currentListing, ...model.listings];
    const offers = [];
    for (const listing of listings) {
      const { merchant_name, priceValue, is_in_stock, free_shipping } = listingToOfferFields(listing);
      if (!merchant_name || priceValue === null) continue;
      try {
        offers.push(
          makeOffer({
            sku,
            source_type: "marketplace",
            platform,
            seller_name: merchant_name,
            price: priceValue,
            stock_status: is_in_stock ? "in_stock" : "out_of_stock",
            shipping_info: free_shipping ? "Ücretsiz Kargo" : null,
            is_platform_official: /^hepsiburada$/i.test(merchant_name),
            product_url: url,
            date,
          })
        );
      } catch (err) {
        console.warn(`[hepsiburada] gecersiz satici satiri atlandi: ${err.message}`);
      }
    }

    if (offers.length === 0) {
      throw new Error(`hepsiburada: hicbir gecerli teklif cikarilamadi (${url})`);
    }
    await randomDelay();
    return offers;
  } finally {
    await context.close();
  }
}
