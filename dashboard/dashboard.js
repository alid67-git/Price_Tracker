const SPREAD_CRITICAL_PCT = 20;
const SPREAD_WARNING_PCT = 10;

const STOCK_LABELS = {
  in_stock: "Stokta",
  out_of_stock: "Tükendi",
  unknown: "–",
};

let priceChart = null;
let sellerCountChart = null;
let selectedProduct = null;
let activePlatformFilter = "all";
let searchPlatformFilter = "all";
let allProducts = [];
let lastSearchResult = null;
let sourcesMeta = null;
let searchInFlight = false;
let searchAbort = null;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function formatPrice(value) {
  if (value === null || value === undefined) return "–";
  return value.toLocaleString("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });
}

function formatDate(d) {
  return new Date(d).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });
}

function formatStock(status) {
  return STOCK_LABELS[status] ?? "–";
}

function spreadBadge(pct) {
  const span = document.createElement("span");
  if (pct === null || pct === undefined) {
    span.className = "badge badge-neutral";
    span.textContent = "–";
    return span;
  }
  if (pct > SPREAD_CRITICAL_PCT) {
    span.className = "badge badge-critical";
    span.textContent = `⚠ %${pct.toFixed(1)}`;
  } else if (pct > SPREAD_WARNING_PCT) {
    span.className = "badge badge-warning";
    span.textContent = `%${pct.toFixed(1)}`;
  } else {
    span.className = "badge badge-neutral";
    span.textContent = `%${pct.toFixed(1)}`;
  }
  return span;
}

function trendTag(trend) {
  const glyphs = { up: "▲", down: "▼", flat: "→" };
  const words = { up: "Yükseliyor", down: "Düşüyor", flat: "Sabit" };
  const span = document.createElement("span");
  span.className = "trend-tag";
  span.textContent = `${glyphs[trend] ?? "→"} ${words[trend] ?? trend}`;
  return span;
}

function renderStatTiles(containerId, tiles) {
  const row = document.getElementById(containerId);
  row.innerHTML = "";
  for (const tile of tiles) {
    const div = document.createElement("div");
    div.className = "stat-tile";
    div.innerHTML = `<div class="label">${tile.label}</div><div class="value ${tile.cls ?? ""}">${tile.value}</div>`;
    row.appendChild(div);
  }
}

function appendOfferRows(tbody, offers, extra = {}) {
  const { newSellerNames = new Set(), urlCounts = new Map(), showRank = false } = extra;
  tbody.innerHTML = "";
  let rank = 0;
  for (const offer of offers) {
    const tr = document.createElement("tr");
    if (offer.is_outlier) tr.classList.add("outlier-row");

    if (showRank) {
      rank += 1;
      const rankTd = document.createElement("td");
      rankTd.className = "rank-cell";
      rankTd.textContent = String(rank);
      tr.appendChild(rankTd);
    }

    const platformTd = document.createElement("td");
    platformTd.textContent = offer.platform;

    const sellerTd = document.createElement("td");
    sellerTd.textContent = offer.seller_name + (offer.is_platform_official ? " ✓" : "");
    if (newSellerNames.has(offer.seller_name)) {
      const badge = document.createElement("span");
      badge.className = "badge badge-warning";
      badge.style.marginLeft = "0.4rem";
      badge.textContent = "yeni";
      sellerTd.appendChild(badge);
    }
    if (offer.is_outlier) {
      const badge = document.createElement("span");
      badge.className = "badge badge-critical";
      badge.style.marginLeft = "0.4rem";
      badge.textContent = "aykırı";
      sellerTd.appendChild(badge);
    }

    const priceTd = document.createElement("td");
    priceTd.textContent = formatPrice(offer.price);
    if (offer.is_outlier) priceTd.classList.add("outlier-price");

    const stockTd = document.createElement("td");
    stockTd.textContent = formatStock(offer.stock_status);
    stockTd.className =
      offer.stock_status === "in_stock" ? "stock-ok" : offer.stock_status === "out_of_stock" ? "stock-out" : "stock-unknown";

    const shippingTd = document.createElement("td");
    shippingTd.textContent = offer.shipping_info ?? "–";

    const linkTd = document.createElement("td");
    const a = document.createElement("a");
    a.className = "row-link";
    a.href = offer.product_url;
    a.target = "_blank";
    a.rel = "noopener";
    const shared = (urlCounts.get(offer.product_url) ?? 0) > 1;
    a.textContent = shared ? "Liste ↗" : "Git ↗";
    a.title = shared ? "Karşılaştırma sitesi ürün listesi" : "Ürün / satıcı sayfası";
    linkTd.appendChild(a);

    tr.append(platformTd, sellerTd, priceTd, stockTd, shippingTd, linkTd);
    tbody.appendChild(tr);
  }
}

function renderPlatformChips(containerId, offers, activeFilter, onChange) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  const platforms = [...new Set(offers.map((o) => o.platform))].sort();
  let current = activeFilter;
  if (current !== "all" && !platforms.includes(current)) current = "all";

  const makeChip = (value, label) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `filter-chip${current === value ? " active" : ""}`;
    btn.textContent = label;
    btn.addEventListener("click", () => onChange(value));
    return btn;
  };

  container.appendChild(makeChip("all", `Tümü (${offers.length})`));
  for (const platform of platforms) {
    const count = offers.filter((o) => o.platform === platform).length;
    container.appendChild(makeChip(platform, `${platform} (${count})`));
  }
  return current;
}

/* ---------- SEARCH TAB ---------- */

function renderSearchResults(result) {
  lastSearchResult = result;
  document.getElementById("search-results").hidden = false;
  document.getElementById("pdf-btn").disabled = false;
  document.getElementById("save-tracked-btn").disabled = false;

  const agg = result.aggregate;
  renderStatTiles("search-kpi", [
    { label: "Teklif", value: agg.seller_count },
    { label: "En düşük", value: formatPrice(agg.min_price) },
    { label: "Medyan", value: formatPrice(agg.median_price) },
    {
      label: "Spread",
      value: agg.price_spread_pct != null ? `%${agg.price_spread_pct.toFixed(1)}` : "–",
      cls: (agg.price_spread_pct ?? 0) > SPREAD_CRITICAL_PCT ? "status-critical" : "",
    },
  ]);

  const alerts = document.getElementById("search-alerts");
  alerts.innerHTML = "";
  if ((agg.outlier_count ?? 0) > 0) {
    alerts.appendChild(makeAlert("warning", "✱", `${agg.outlier_count} aykırı fiyat tespit edildi; spread/medyan hesabından çıkarıldı.`));
  }
  if ((agg.price_spread_pct ?? 0) > SPREAD_CRITICAL_PCT) {
    alerts.appendChild(
      makeAlert("critical", "⚠", `Fiyat farkı %${agg.price_spread_pct.toFixed(1)} — eşik değeri %${SPREAD_CRITICAL_PCT} üzerinde.`)
    );
  }

  const stats = document.getElementById("platform-stats");
  stats.innerHTML = "";
  for (const p of result.platforms) {
    const row = document.createElement("div");
    row.className = "platform-stat-row";
    const pct = result.offers.length ? Math.round((p.count / result.offers.length) * 100) : 0;
    row.innerHTML = `<span>${p.platform}</span><span class="bar-wrap"><span class="bar" style="width:${pct}%"></span></span><span>${p.count}</span>`;
    stats.appendChild(row);
  }

  const dl = document.getElementById("search-stats-dl");
  dl.innerHTML = `
    <div><dt>En yüksek</dt><dd>${formatPrice(agg.max_price)}</dd></div>
    <div><dt>Spread tutarı</dt><dd>${formatPrice(agg.price_spread)}</dd></div>
    <div><dt>Aykırı</dt><dd>${agg.outlier_count ?? 0}</dd></div>
    <div><dt>Tarih</dt><dd>${new Date(result.generatedAt).toLocaleString("tr-TR")}</dd></div>
  `;

  searchPlatformFilter = "all";
  renderSearchOffers();
}

function makeAlert(level, icon, text) {
  const div = document.createElement("div");
  div.className = `alert alert-${level}`;
  const iconSpan = document.createElement("span");
  iconSpan.className = "alert-icon";
  iconSpan.textContent = icon;
  const textSpan = document.createElement("span");
  textSpan.textContent = text;
  div.append(iconSpan, textSpan);
  return div;
}

function sortSearchOffers(offers, sortKey) {
  const list = [...offers];
  if (sortKey === "price-desc") return list.sort((a, b) => b.price - a.price);
  if (sortKey === "platform") {
    return list.sort((a, b) => {
      const p = String(a.platform).localeCompare(String(b.platform), "tr");
      return p !== 0 ? p : a.price - b.price;
    });
  }
  return list.sort((a, b) => a.price - b.price);
}

function renderSearchOffers() {
  if (!lastSearchResult) return;
  const offers = lastSearchResult.offers;
  searchPlatformFilter = renderPlatformChips("search-platform-filters", offers, searchPlatformFilter, (v) => {
    searchPlatformFilter = v;
    renderSearchOffers();
  });

  const sortKey = document.getElementById("search-sort")?.value || "price-asc";
  const filtered = sortSearchOffers(
    offers.filter((o) => searchPlatformFilter === "all" || o.platform === searchPlatformFilter),
    sortKey
  );
  const urlCounts = offers.reduce((map, o) => {
    map.set(o.product_url, (map.get(o.product_url) ?? 0) + 1);
    return map;
  }, new Map());
  appendOfferRows(document.getElementById("search-offers-body"), filtered, { urlCounts, showRank: true });
}

async function saveSearchToTracked() {
  if (!lastSearchResult) return;
  const btn = document.getElementById("save-tracked-btn");
  const status = document.getElementById("search-status");
  btn.disabled = true;
  try {
    const res = await fetch("/api/search/save-tracked", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: lastSearchResult.query,
        sku: lastSearchResult.sku,
        name: lastSearchResult.query,
        offers: lastSearchResult.offers,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    status.hidden = false;
    status.classList.remove("status-error");
    status.textContent = `"${data.sku}" takibe kaydedildi. Günlük tarama / Actions bu ürünü dahil edecek.`;
    historyLoaded = false;
  } catch (err) {
    status.hidden = false;
    status.classList.add("status-error");
    status.textContent = `Kaydetme hatası: ${err.message}`;
  } finally {
    btn.disabled = !lastSearchResult?.offers?.length;
  }
}

function setupResearchModes() {
  const radios = document.querySelectorAll('input[name="research-mode"]');
  const trPanel = document.getElementById("research-tr");
  const intlPanel = document.getElementById("research-intl");
  const apply = () => {
    const mode = document.querySelector('input[name="research-mode"]:checked')?.value || "tr";
    trPanel.hidden = mode !== "tr";
    intlPanel.hidden = mode !== "intl";
    if (mode === "intl") loadIntlMarkets();
  };
  radios.forEach((r) => r.addEventListener("change", apply));
  apply();
}

let intlLoaded = false;
async function loadIntlMarkets() {
  if (intlLoaded) return;
  const box = document.getElementById("intl-markets-list");
  if (!box) return;
  try {
    let data = null;
    try {
      const res = await fetch("/api/international-markets");
      if (res.ok) data = await res.json();
    } catch {
      /* Pages / sunucusuz */
    }
    if (!data) {
      const res = await fetch("intl-markets.json");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    }
    box.innerHTML = "";
    for (const region of data.regions ?? []) {
      const section = document.createElement("section");
      section.className = "intl-region";
      const h = document.createElement("h3");
      h.textContent = region.name;
      section.appendChild(h);
      const ul = document.createElement("ul");
      ul.className = "intl-country-list";
      for (const c of region.countries ?? []) {
        const li = document.createElement("li");
        li.innerHTML = `<strong>${c.code}</strong> ${c.name} <span class="muted">(${c.currency})</span>`;
        ul.appendChild(li);
      }
      section.appendChild(ul);
      box.appendChild(section);
    }
    intlLoaded = true;
  } catch (err) {
    box.textContent = `Pazar listesi yüklenemedi: ${err.message}`;
  }
}

async function loadSources() {
  try {
    const res = await fetch("/api/sources");
    if (!res.ok) throw new Error();
    sourcesMeta = await res.json();
    renderCategoryFilters();
    const el = document.getElementById("sources-count");
    if (el) el.textContent = `(${sourcesMeta.total} site tanımlı)`;
  } catch {
    sourcesMeta = null;
  }
}

function renderCategoryFilters() {
  const box = document.getElementById("category-filters");
  if (!box || !sourcesMeta?.categories) return;
  box.innerHTML = "";
  for (const cat of sourcesMeta.categories) {
    const label = document.createElement("label");
    label.className = `category-chip${cat.defaultEnabled ? " active" : ""}`;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = cat.id;
    input.checked = Boolean(cat.defaultEnabled);
    input.addEventListener("change", () => {
      label.classList.toggle("active", input.checked);
      syncToggleCategoriesLabel();
    });
    label.append(input, document.createTextNode(cat.name));
    box.appendChild(label);
  }
  syncToggleCategoriesLabel();
}

function syncToggleCategoriesLabel() {
  const btn = document.getElementById("toggle-categories");
  if (!btn) return;
  const inputs = [...document.querySelectorAll("#category-filters input")];
  const allOn = inputs.length > 0 && inputs.every((el) => el.checked);
  btn.textContent = allOn ? "Tümünü kaldır" : "Tümünü seç";
}

function toggleAllCategories() {
  const inputs = [...document.querySelectorAll("#category-filters input")];
  if (!inputs.length) return;
  const allOn = inputs.every((el) => el.checked);
  const next = !allOn;
  for (const input of inputs) {
    input.checked = next;
    input.closest(".category-chip")?.classList.toggle("active", next);
  }
  syncToggleCategoriesLabel();
}

function selectedCategories() {
  return [...document.querySelectorAll("#category-filters input:checked")].map((el) => el.value);
}

async function cancelActiveSearch() {
  if (searchAbort) {
    searchAbort.abort();
    searchAbort = null;
  }
  try {
    await fetch("/api/search/cancel", { method: "POST" });
  } catch {
    /* ignore */
  }
  // Sunucunun kiliti birakmasini kisa sure bekle
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      const health = await fetch("/api/health").then((r) => r.json());
      if (!health.searching) break;
    } catch {
      break;
    }
  }
  searchInFlight = false;
}

async function runSearch(e) {
  e.preventDefault();

  if (searchInFlight) {
    const ok = window.confirm("Devam eden bir arama var. İptal edip yenisini başlatalım mı?");
    if (!ok) return;
    const statusEl = document.getElementById("search-status");
    statusEl.hidden = false;
    statusEl.classList.remove("status-error");
    statusEl.textContent = "Önceki arama iptal ediliyor…";
    await cancelActiveSearch();
  }

  const query = document.getElementById("search-query").value.trim();
  const urlsText = document.getElementById("search-urls").value;
  const marketplaceUrls = urlsText
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const categories = selectedCategories();
  if (!categories.length) {
    const status = document.getElementById("search-status");
    status.hidden = false;
    status.textContent = "En az bir kategori seçin.";
    status.classList.add("status-error");
    return;
  }

  const btn = document.getElementById("search-btn");
  const status = document.getElementById("search-status");
  document.getElementById("pdf-btn").disabled = true;
  status.hidden = false;
  status.textContent = `Taranıyor… ${categories.length} kategori. İptal için tekrar Ara’ya basın.`;
  status.classList.remove("status-error");
  btn.textContent = "İptal / Yeni ara";

  searchAbort = new AbortController();
  searchInFlight = true;

  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, marketplaceUrls, categories }),
      signal: searchAbort.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 || data.code === "SEARCH_IN_PROGRESS") {
      const ok = window.confirm("Sunucuda hâlâ bir arama sürüyor. İptal edip tekrar deneyelim mi?");
      if (!ok) throw new Error(data.error || "Arama meşgul");
      await cancelActiveSearch();
      searchAbort = new AbortController();
      searchInFlight = true;
      const retry = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, marketplaceUrls, categories }),
        signal: searchAbort.signal,
      });
      const retryData = await retry.json().catch(() => ({}));
      if (!retry.ok) throw new Error(retryData.error || `HTTP ${retry.status}`);
      if (!retryData.offers?.length) {
        status.textContent = `Sonuç bulunamadı.${retryData.warnings?.length ? ` (${retryData.warnings.join("; ")})` : ""}`;
        status.classList.add("status-error");
        document.getElementById("search-results").hidden = true;
        return;
      }
      status.textContent = `${retryData.offers.length} teklif · ${retryData.searchedSources?.length ?? "?"} kaynak tarandı (fiyata göre sıralı).`;
      renderSearchResults(retryData);
      document.getElementById("save-tracked-btn").disabled = false;
      return;
    }
    if (data.code === "SEARCH_CANCELLED" || res.status === 499) {
      status.textContent = "Arama iptal edildi.";
      return;
    }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (!data.offers?.length) {
      const warn = data.warnings?.length ? ` (${data.warnings.join("; ")})` : "";
      status.textContent = `Sonuç bulunamadı.${warn}`;
      status.classList.add("status-error");
      document.getElementById("search-results").hidden = true;
      return;
    }
    status.textContent = data.warnings?.length
      ? `${data.offers.length} teklif · ${data.searchedSources?.length ?? "?"} kaynak. Uyarı: ${data.warnings.slice(0, 3).join("; ")}${data.warnings.length > 3 ? "…" : ""}`
      : `${data.offers.length} teklif · ${data.searchedSources?.length ?? "?"} kaynak tarandı (fiyata göre sıralı).`;
    renderSearchResults(data);
    document.getElementById("save-tracked-btn").disabled = false;
  } catch (err) {
    if (err.name === "AbortError") {
      status.textContent = "Arama iptal edildi.";
      status.classList.remove("status-error");
    } else {
      status.textContent = `Hata: ${err.message}`;
      status.classList.add("status-error");
    }
  } finally {
    searchInFlight = false;
    searchAbort = null;
    btn.textContent = "Türkiye’de ara";
    btn.disabled = false;
  }
}

async function downloadPdf() {
  if (!lastSearchResult) return;
  const btn = document.getElementById("pdf-btn");
  btn.disabled = true;
  try {
    const res = await fetch("/api/report.pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report: lastSearchResult, searchId: lastSearchResult.id }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fiyat-raporu-${lastSearchResult.query.slice(0, 30).replace(/\s+/g, "-")}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    const status = document.getElementById("search-status");
    status.hidden = false;
    status.textContent = `PDF hatası: ${err.message}`;
    status.classList.add("status-error");
  } finally {
    btn.disabled = false;
  }
}

/* ---------- TRACKED TAB ---------- */

function renderKpiRow(products) {
  const totalProducts = products.length;
  const totalOffers = products.reduce((sum, p) => sum + p.aggregate.seller_count, 0);
  const criticalCount = products.filter((p) => (p.aggregate.price_spread_pct ?? 0) > SPREAD_CRITICAL_PCT).length;
  const outlierCount = products.reduce((sum, p) => sum + (p.aggregate.outlier_count ?? 0), 0);
  renderStatTiles("tracked-kpi", [
    { label: "Takip edilen ürün", value: totalProducts },
    { label: "Toplam teklif", value: totalOffers },
    { label: "Yüksek spread uyarısı", value: criticalCount, cls: criticalCount > 0 ? "status-critical" : "" },
    { label: "Aykırı fiyat", value: outlierCount, cls: outlierCount > 0 ? "status-warning-text" : "" },
  ]);
}

function renderSummaryTable(products, onSelect) {
  const tbody = document.getElementById("summary-body");
  tbody.innerHTML = "";
  for (const p of products) {
    const tr = document.createElement("tr");
    tr.dataset.sku = p.sku;
    if (selectedProduct?.sku === p.sku) tr.classList.add("active-row");
    const cells = [
      p.sku,
      p.name,
      String(p.aggregate.seller_count),
      formatPrice(p.aggregate.min_price),
      formatPrice(p.aggregate.median_price),
      formatPrice(p.aggregate.max_price),
    ];
    for (const text of cells) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    }
    const spreadTd = document.createElement("td");
    spreadTd.appendChild(spreadBadge(p.aggregate.price_spread_pct));
    tr.appendChild(spreadTd);
    const trendTd = document.createElement("td");
    trendTd.appendChild(trendTag(p.trend));
    tr.appendChild(trendTd);
    tr.addEventListener("click", () => {
      document.querySelectorAll("#summary-body tr").forEach((r) => r.classList.remove("active-row"));
      tr.classList.add("active-row");
      onSelect(p);
    });
    tbody.appendChild(tr);
  }
}

function renderAlerts(product) {
  const container = document.getElementById("alerts");
  container.innerHTML = "";
  if ((product.aggregate.outlier_count ?? 0) > 0) {
    container.appendChild(
      makeAlert("warning", "✱", `${product.aggregate.outlier_count} aykırı fiyat tespit edildi ve spread/medyan hesabından çıkarıldı.`)
    );
  }
  if ((product.aggregate.price_spread_pct ?? 0) > SPREAD_CRITICAL_PCT) {
    container.appendChild(
      makeAlert("critical", "⚠", `Fiyat farkı %${product.aggregate.price_spread_pct.toFixed(1)} — eşik değeri %${SPREAD_CRITICAL_PCT} üzerinde.`)
    );
  }
  for (const seller of product.changes.newSellers) {
    container.appendChild(
      makeAlert("warning", "⭐", `Yeni satıcı: ${seller.seller_name} (${seller.platform}) — ${formatPrice(seller.price)}`)
    );
  }
}

function renderOffersTable(product) {
  activePlatformFilter = renderPlatformChips("platform-filters", product.latestOffers, activePlatformFilter, (v) => {
    activePlatformFilter = v;
    renderOffersTable(product);
  });
  const filtered = product.latestOffers.filter((o) => activePlatformFilter === "all" || o.platform === activePlatformFilter);
  const newSellerNames = new Set(product.changes.newSellers.map((s) => s.seller_name));
  const urlCounts = product.latestOffers.reduce((map, o) => {
    map.set(o.product_url, (map.get(o.product_url) ?? 0) + 1);
    return map;
  }, new Map());
  appendOfferRows(document.getElementById("offers-body"), filtered, { newSellerNames, urlCounts });
}

function renderPriceChart(product) {
  const ctx = document.getElementById("price-chart");
  if (priceChart) priceChart.destroy();
  const blue = cssVar("--series-blue");
  const wash = cssVar("--series-blue-wash");
  const gridline = cssVar("--gridline");
  const muted = cssVar("--text-muted");
  priceChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: product.history.map((h) => formatDate(h.date)),
      datasets: [
        { label: "max", data: product.history.map((h) => h.max_price), borderWidth: 0, pointRadius: 0, fill: false, spanGaps: true },
        { label: "min", data: product.history.map((h) => h.min_price), borderWidth: 0, pointRadius: 0, backgroundColor: wash, fill: "-1", spanGaps: true },
        {
          label: "Medyan",
          data: product.history.map((h) => h.median_price),
          borderColor: blue,
          backgroundColor: blue,
          borderWidth: 2,
          pointRadius: product.history.length <= 1 ? 4 : 2,
          tension: 0.15,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { grid: { color: gridline }, ticks: { color: muted } },
        x: { grid: { display: false }, ticks: { color: muted } },
      },
    },
  });
}

function renderSellerCountChart(product) {
  const ctx = document.getElementById("seller-count-chart");
  if (sellerCountChart) sellerCountChart.destroy();
  const blue = cssVar("--series-blue");
  const wash = cssVar("--series-blue-wash");
  const gridline = cssVar("--gridline");
  const muted = cssVar("--text-muted");
  sellerCountChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: product.history.map((h) => formatDate(h.date)),
      datasets: [
        {
          label: "Teklif sayısı",
          data: product.history.map((h) => h.seller_count),
          borderColor: blue,
          backgroundColor: wash,
          borderWidth: 2,
          fill: true,
          tension: 0.15,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0, color: muted }, grid: { color: gridline } },
        x: { grid: { display: false }, ticks: { color: muted } },
      },
    },
  });
}

function renderDetail(product) {
  selectedProduct = product;
  activePlatformFilter = "all";
  document.getElementById("detail-section").hidden = false;
  document.getElementById("detail-title").textContent = `${product.name} (${product.sku})`;
  renderAlerts(product);
  renderOffersTable(product);
  if (!document.getElementById("tab-tracked").hidden) {
    renderPriceChart(product);
    renderSellerCountChart(product);
  }
}

function applySummaryFilter() {
  const q = (document.getElementById("summary-filter").value ?? "").trim().toLowerCase();
  const filtered = q
    ? allProducts.filter((p) => p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
    : allProducts;
  renderSummaryTable(filtered, renderDetail);
}

async function loadTracked() {
  try {
    const res = await fetch("summary.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.products?.length) {
      document.getElementById("empty-state").hidden = false;
      return;
    }
    allProducts = data.products;
    renderKpiRow(allProducts);
    applySummaryFilter();
    renderDetail(allProducts[0]);
  } catch {
    document.getElementById("empty-state").hidden = false;
  }
}

function activateTab(name) {
  const tab = document.querySelector(`.tab[data-tab="${name}"]`);
  if (!tab) return;
  document.querySelectorAll(".tab").forEach((t) => {
    const on = t === tab;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.getElementById("tab-search").hidden = name !== "search";
  document.getElementById("tab-tracked").hidden = name !== "tracked";
  document.getElementById("tab-add-product").hidden = name !== "add-product";
  document.getElementById("tab-history").hidden = name !== "history";
  if (name === "tracked" && selectedProduct) {
    renderPriceChart(selectedProduct);
    renderSellerCountChart(selectedProduct);
  }
  if (name === "add-product") updateAddProductMode();
  if (name === "history") loadHistory();
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => activateTab(tab.dataset.tab));
  });
}

/* ---------- URUN EKLE TAB ---------- */

const MARKETPLACE_FIELDS = ["trendyol", "hepsiburada", "n11", "amazon_tr"];

function addStandaloneRow() {
  const wrap = document.getElementById("standalone-rows");
  const row = document.createElement("div");
  row.className = "standalone-row";

  const urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.placeholder = "Site URL'si";
  urlInput.className = "standalone-url";

  const platformInput = document.createElement("input");
  platformInput.type = "text";
  platformInput.placeholder = "Platform adı (opsiyonel)";
  platformInput.className = "standalone-platform";

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "btn-secondary";
  removeBtn.textContent = "✕";
  removeBtn.addEventListener("click", () => row.remove());

  row.append(urlInput, platformInput, removeBtn);
  wrap.appendChild(row);
}

function setFormStatus(message, kind) {
  const el = document.getElementById("form-status");
  el.textContent = message;
  el.className = kind ? `form-message ${kind}` : "";
}

function collectProductPayload(form) {
  const sku = form.sku.value.trim();
  const marketplaces = {};
  for (const platform of MARKETPLACE_FIELDS) {
    const url = form[platform].value.trim();
    if (url) marketplaces[platform] = url;
  }
  const standalone = [];
  document.querySelectorAll("#standalone-rows .standalone-row").forEach((row) => {
    const url = row.querySelector(".standalone-url").value.trim();
    const platform = row.querySelector(".standalone-platform").value.trim();
    if (url) standalone.push(platform ? { url, platform } : { url });
  });

  return {
    sku,
    name: form.name.value.trim() || sku,
    marketplaces,
    aggregatorQuery: form.aggregatorQuery.value.trim(),
    standalone,
  };
}

async function submitProductViaLocalServer(payload) {
  const res = await fetch("/api/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
}

async function submitProductViaGithub(payload) {
  const cfg = getGithubConfig();
  if (!cfg.token) {
    document.querySelector(".gh-settings").open = true;
    throw new Error("GitHub token'ı aşağıdaki Ayarlar bölümünden ekle.");
  }

  const productsFile = await ghGetFile(cfg, "config/products.json");
  const products = productsFile ? JSON.parse(productsFile.content) : [];
  if (products.some((p) => p.sku === payload.sku)) {
    throw new Error(`"${payload.sku}" zaten mevcut`);
  }

  const product = {
    sku: payload.sku,
    name: payload.name,
    marketplaces: payload.marketplaces,
    aggregatorQuery: payload.aggregatorQuery || undefined,
    standalone: payload.standalone,
  };
  products.push(product);
  await ghPutFile(
    cfg,
    "config/products.json",
    JSON.stringify(products, null, 2),
    productsFile?.sha,
    `chore: web'den urun ekle - ${payload.sku}`
  );

  const historyFile = await ghGetFile(cfg, "data/product-history.json");
  const history = historyFile ? JSON.parse(historyFile.content) : [];
  history.push({ ...product, addedAt: new Date().toISOString() });
  await ghPutFile(
    cfg,
    "data/product-history.json",
    JSON.stringify(history, null, 2),
    historyFile?.sha,
    `chore: web'den urun ekleme kaydi - ${payload.sku}`
  );
}

async function submitProduct(e) {
  e.preventDefault();
  setFormStatus("", null);

  const form = e.target;
  const payload = collectProductPayload(form);
  if (!payload.sku) {
    setFormStatus("SKU zorunludur.", "error");
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    const useLocal = await isLocalServerAvailable();
    if (useLocal) {
      await submitProductViaLocalServer(payload);
      setFormStatus(`"${payload.sku}" eklendi (yerel sunucu). Bir sonraki taramada dahil edilecek.`, "success");
    } else {
      await submitProductViaGithub(payload);
      setFormStatus(`"${payload.sku}" GitHub'a commit edildi. Bir sonraki otomatik taramada dahil edilecek.`, "success");
    }
    form.reset();
    document.getElementById("standalone-rows").innerHTML = "";
    historyLoaded = false;
  } catch (err) {
    setFormStatus(`Hata: ${err.message}`, "error");
  } finally {
    submitBtn.disabled = false;
  }
}

async function updateAddProductMode() {
  const el = document.getElementById("add-product-mode");
  const useLocal = await isLocalServerAvailable();
  if (useLocal) {
    el.textContent = "Kayıt yöntemi: PC üzerindeki yerel sunucu";
    return;
  }
  const cfg = getGithubConfig();
  el.textContent = cfg.token
    ? "Kayıt yöntemi: GitHub (telefon/Pages). Ürün doğrudan repoya commit edilir; PC'de sync-from-github.bat ile çekersin."
    : "Kayıt yöntemi: GitHub. Önce aşağıdaki ayarlardan token kaydet — sonra ürün ekleyebilirsin.";
  if (!cfg.token) {
    const details = document.querySelector(".gh-settings");
    if (details) details.open = true;
  }
}

function initGithubSettingsForm() {
  const cfg = getGithubConfig();
  document.getElementById("gh-token").value = cfg.token;
  document.getElementById("gh-owner").value = cfg.owner;
  document.getElementById("gh-repo").value = cfg.repo;
  document.getElementById("gh-branch").value = cfg.branch;

  document.getElementById("gh-save").addEventListener("click", () => {
    saveGithubConfig({
      token: document.getElementById("gh-token").value.trim(),
      owner: document.getElementById("gh-owner").value.trim(),
      repo: document.getElementById("gh-repo").value.trim(),
      branch: document.getElementById("gh-branch").value.trim(),
    });
    setFormStatus("GitHub ayarları kaydedildi.", "success");
  });
}

/* ---------- GECMIS TAB ---------- */

function formatDateTime(iso) {
  return new Date(iso).toLocaleString("tr-TR");
}

function sourceList(entry) {
  const sources = [];
  if (entry.marketplaces) sources.push(...Object.keys(entry.marketplaces));
  if (entry.aggregatorQuery) sources.push("akakçe/cimri");
  if (entry.standalone?.length) sources.push(`${entry.standalone.length} bağımsız site`);
  return sources.join(", ") || "–";
}

let historyLoaded = false;

async function loadHistory() {
  if (historyLoaded) return;
  const tbody = document.getElementById("history-body");
  const emptyEl = document.getElementById("empty-history");
  emptyEl.hidden = true;
  tbody.innerHTML = "";

  let entries;
  try {
    const useLocal = await isLocalServerAvailable();
    if (useLocal) {
      const res = await fetch("/api/product-history");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      entries = await res.json();
    } else {
      const cfg = getGithubConfig();
      const file = await ghGetFile(cfg, "data/product-history.json");
      entries = file ? JSON.parse(file.content) : [];
    }
  } catch (err) {
    emptyEl.hidden = false;
    emptyEl.textContent = `Geçmiş yüklenemedi: ${err.message}`;
    return;
  }

  if (!entries.length) {
    emptyEl.hidden = false;
    emptyEl.textContent = 'Henüz eklenen ürün yok. "Ürün Ekle" sekmesinden ilk ürününü ekleyebilirsin.';
    return;
  }

  for (const entry of [...entries].reverse()) {
    const tr = document.createElement("tr");
    for (const text of [formatDateTime(entry.addedAt), entry.sku, entry.name, sourceList(entry)]) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  historyLoaded = true;
}

function isGithubPagesHost() {
  return /\.github\.io$/i.test(location.hostname);
}

async function checkServer() {
  const el = document.getElementById("server-status");
  const banner = document.getElementById("mode-banner");
  const verEl = document.getElementById("app-version");
  try {
    const res = await fetch("/api/health", { signal: AbortSignal.timeout(1500) });
    if (!res.ok) throw new Error();
    const health = await res.json();
    if (verEl && health.label) verEl.textContent = health.label;
    el.textContent = `PC modu ${health.label || ""} — Türkiye araştırması hazır`;
    el.classList.remove("status-error");
    if (banner) banner.hidden = true;
    return true;
  } catch {
    try {
      const vr = await fetch("https://raw.githubusercontent.com/alid67-git/Price_Tracker/main/package.json", {
        signal: AbortSignal.timeout(2000),
      });
      if (vr.ok) {
        const pkg = await vr.json();
        if (verEl && pkg.version) verEl.textContent = `v${pkg.version}`;
      }
    } catch {
      if (verEl) verEl.textContent = "v—";
    }
    el.textContent = isGithubPagesHost()
      ? "Telefon / GitHub Pages — takip + ürün ekleme (token ile)"
      : "Sunucu yok — takip verisi okunur; canlı arama için pricetracker.bat";
    el.classList.add("status-error");
    if (banner) {
      banner.hidden = false;
      banner.innerHTML =
        "<strong>Mobil / online mod:</strong> Takip edilenler her gün otomatik güncellenir. " +
        "Ürün Ekle sekmesinden token kaydedip yeni ürün commit edebilirsin. " +
        "Canlı Türkiye araştırması yalnızca PC’de <code>pricetracker.bat</code> ile çalışır. " +
        "Telefondan eklediklerini PC’de <code>sync-from-github.bat</code> ile çekersin.";
    }
    return false;
  }
}

async function init() {
  setupTabs();
  setupResearchModes();
  document.getElementById("search-form").addEventListener("submit", runSearch);
  document.getElementById("pdf-btn").addEventListener("click", downloadPdf);
  document.getElementById("save-tracked-btn")?.addEventListener("click", saveSearchToTracked);
  document.getElementById("search-sort")?.addEventListener("change", renderSearchOffers);
  document.getElementById("toggle-categories")?.addEventListener("click", toggleAllCategories);
  document.getElementById("summary-filter").addEventListener("input", applySummaryFilter);
  document.getElementById("add-standalone-row").addEventListener("click", addStandaloneRow);
  document.getElementById("add-product-form").addEventListener("submit", submitProduct);
  initGithubSettingsForm();
  const hasLocal = await checkServer();
  if (!hasLocal) {
    activateTab("tracked");
    const searchTab = document.querySelector('.tab[data-tab="search"]');
    if (searchTab) {
      searchTab.title = "Canlı arama yalnızca PC yerel sunucusunda çalışır";
      searchTab.classList.add("tab-limited");
    }
  }
  await loadSources();
  await loadTracked();
}

init();
