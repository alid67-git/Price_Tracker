// Pazaryeri connector sozlesmesi. Her connector asagidaki sekli disa aktarir:
//
//   export const platform = "trendyol";
//   export function canHandle(url) { ... }
//   export async function fetchOffers({ sku, url }) { ... } -> Promise<Offer[]>
//
// fetchOffers, o urun sayfasindaki TUM saticilari (sadece one cikan degil) Offer[]
// olarak dondurur. Tek saticili urunlerde tek elemanli dizi doner.
export {};
