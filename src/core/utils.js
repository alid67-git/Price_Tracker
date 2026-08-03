// Paylasilan yardimcilar: TL fiyat metni parse etme, bekleme, metin temizleme.

/**
 * "1.234,56 TL", "8.768,03", "634,80 TL" gibi TR bicimli fiyat metinlerini
 * sayiya cevirir. Bulamazsa null doner.
 * @param {string} text
 * @returns {number|null}
 */
export function parseTurkishPrice(text) {
  if (!text) return null;
  const match = text.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/);
  if (!match) return null;
  const normalized = match[1].replace(/\./g, "").replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function normalizeWhitespace(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const REALISTIC_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/**
 * SSR sayfa HTML'i icin hafif fetch yardimcisi (Playwright'a gerek olmayan
 * siteler icin -- Trendyol, N11, Amazon.tr taze cekimde SSR dondugu dogrulandi).
 * @param {string} url
 * @returns {Promise<string>} HTML metni
 */
export async function fetchHtml(url, opts = {}) {
  const { timeoutMs = 10000 } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": REALISTIC_UA,
        "Accept-Language": "tr-TR,tr;q=0.9",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} (${url})`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}
