const SPREAD_CRITICAL_PCT = 20;
const SPREAD_WARNING_PCT = 10;

let priceChart = null;
let sellerCountChart = null;

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

function renderKpiRow(products) {
  const totalProducts = products.length;
  const totalOffers = products.reduce((sum, p) => sum + p.aggregate.seller_count, 0);
  const criticalCount = products.filter((p) => (p.aggregate.price_spread_pct ?? 0) > SPREAD_CRITICAL_PCT).length;
  const newSellerCount = products.reduce((sum, p) => sum + p.changes.newSellers.length, 0);

  const tiles = [
    { label: "Takip edilen ürün", value: totalProducts },
    { label: "Toplam teklif", value: totalOffers },
    { label: "Yüksek spread uyarısı", value: criticalCount, cls: criticalCount > 0 ? "status-critical" : "" },
    { label: "Yeni satıcı (bugün)", value: newSellerCount, cls: newSellerCount > 0 ? "status-warning-text" : "" },
  ];

  const row = document.getElementById("kpi-row");
  row.innerHTML = "";
  for (const tile of tiles) {
    const div = document.createElement("div");
    div.className = "stat-tile";
    div.innerHTML = `<div class="label">${tile.label}</div><div class="value ${tile.cls ?? ""}">${tile.value}</div>`;
    row.appendChild(div);
  }
}

function renderSummaryTable(products, onSelect) {
  const tbody = document.getElementById("summary-body");
  tbody.innerHTML = "";
  for (const p of products) {
    const tr = document.createElement("tr");
    tr.dataset.sku = p.sku;
    const cells = [p.sku, p.name, String(p.aggregate.seller_count), formatPrice(p.aggregate.min_price), formatPrice(p.aggregate.max_price)];
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
  const alerts = [];

  if ((product.aggregate.price_spread_pct ?? 0) > SPREAD_CRITICAL_PCT) {
    alerts.push({
      level: "critical",
      icon: "⚠",
      text: `Fiyat farkı %${product.aggregate.price_spread_pct.toFixed(1)} — eşik değeri %${SPREAD_CRITICAL_PCT} üzerinde.`,
    });
  }
  for (const seller of product.changes.newSellers) {
    alerts.push({
      level: "warning",
      icon: "⭐",
      text: `Yeni satıcı: ${seller.seller_name} (${seller.platform}) — ${formatPrice(seller.price)}`,
    });
  }
  for (const change of product.changes.priceChanges) {
    if (Math.abs(change.pct_change) >= 10) {
      const direction = change.pct_change > 0 ? "arttı" : "düştü";
      alerts.push({
        level: "warning",
        icon: change.pct_change > 0 ? "↑" : "↓",
        text: `${change.seller_name} (${change.platform}) fiyatı %${Math.abs(change.pct_change).toFixed(1)} ${direction}: ${formatPrice(change.old_price)} → ${formatPrice(change.new_price)}`,
      });
    }
  }

  for (const alert of alerts) {
    const div = document.createElement("div");
    div.className = `alert alert-${alert.level}`;
    const iconSpan = document.createElement("span");
    iconSpan.className = "alert-icon";
    iconSpan.textContent = alert.icon;
    const textSpan = document.createElement("span");
    textSpan.textContent = alert.text;
    div.append(iconSpan, textSpan);
    container.appendChild(div);
  }
}

function renderOffersTable(product) {
  const tbody = document.getElementById("offers-body");
  tbody.innerHTML = "";
  const newSellerNames = new Set(product.changes.newSellers.map((s) => s.seller_name));

  for (const offer of product.latestOffers) {
    const tr = document.createElement("tr");
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
    const priceTd = document.createElement("td");
    priceTd.textContent = formatPrice(offer.price);
    const stockTd = document.createElement("td");
    stockTd.textContent = offer.stock_status;
    const shippingTd = document.createElement("td");
    shippingTd.textContent = offer.shipping_info ?? "–";
    const linkTd = document.createElement("td");
    const a = document.createElement("a");
    a.className = "row-link";
    a.href = offer.product_url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "Git ↗";
    linkTd.appendChild(a);

    tr.append(platformTd, sellerTd, priceTd, stockTd, shippingTd, linkTd);
    tbody.appendChild(tr);
  }
}

function renderPriceChart(product) {
  const ctx = document.getElementById("price-chart");
  if (priceChart) priceChart.destroy();

  const blue = cssVar("--series-blue");
  const wash = cssVar("--series-blue-wash");
  const gridline = cssVar("--gridline");
  const muted = cssVar("--text-muted");

  const labels = product.history.map((h) => formatDate(h.date));

  priceChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "max",
          data: product.history.map((h) => h.max_price),
          borderWidth: 0,
          pointRadius: 0,
          fill: false,
          spanGaps: true,
        },
        {
          label: "min",
          data: product.history.map((h) => h.min_price),
          borderWidth: 0,
          pointRadius: 0,
          backgroundColor: wash,
          fill: "-1",
          spanGaps: true,
        },
        {
          label: "Medyan",
          data: product.history.map((h) => h.median_price),
          borderColor: blue,
          backgroundColor: blue,
          borderWidth: 2,
          pointRadius: product.history.length <= 1 ? 4 : 2,
          pointHoverRadius: 5,
          tension: 0.15,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => item.dataset.label === "Medyan",
          callbacks: {
            label: (item) => `Medyan: ${formatPrice(item.parsed.y)}`,
            afterBody: (items) => {
              const idx = items[0].dataIndex;
              const h = product.history[idx];
              return [`Min: ${formatPrice(h.min_price)}`, `Max: ${formatPrice(h.max_price)}`];
            },
          },
        },
      },
      scales: {
        y: {
          title: { display: true, text: "Fiyat (TL)", color: muted },
          grid: { color: gridline },
          ticks: { color: muted },
        },
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
          pointRadius: product.history.length <= 1 ? 4 : 2,
          fill: true,
          tension: 0.15,
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (item) => `Teklif sayısı: ${item.parsed.y}` } },
      },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0, color: muted }, grid: { color: gridline } },
        x: { grid: { display: false }, ticks: { color: muted } },
      },
    },
  });
}

function renderHistoryTable(product) {
  const tbody = document.getElementById("history-body");
  tbody.innerHTML = "";
  for (const h of [...product.history].reverse()) {
    const tr = document.createElement("tr");
    for (const text of [formatDate(h.date), String(h.seller_count), formatPrice(h.min_price), formatPrice(h.median_price), formatPrice(h.max_price)]) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

function renderDetail(product) {
  document.getElementById("detail-section").hidden = false;
  document.getElementById("detail-title").textContent = `${product.name} (${product.sku})`;
  renderAlerts(product);
  renderOffersTable(product);
  renderPriceChart(product);
  renderSellerCountChart(product);
  renderHistoryTable(product);
}

async function init() {
  let data;
  try {
    const res = await fetch("summary.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    document.getElementById("empty-state").hidden = false;
    document.getElementById("empty-state").textContent = `Veri yüklenemedi: ${err.message}`;
    return;
  }

  if (!data.products || data.products.length === 0) {
    document.getElementById("empty-state").hidden = false;
    return;
  }

  document.getElementById("generated-at").textContent = `Son güncelleme: ${new Date(data.generatedAt).toLocaleString("tr-TR")}`;
  renderKpiRow(data.products);
  renderSummaryTable(data.products, renderDetail);
  renderDetail(data.products[0]);
  document.querySelector("#summary-body tr")?.classList.add("active-row");

  document.getElementById("toggle-history-table").addEventListener("click", (e) => {
    const wrap = document.getElementById("history-table-wrap");
    wrap.hidden = !wrap.hidden;
    e.target.textContent = wrap.hidden ? "Tabloyu göster" : "Tabloyu gizle";
  });
}

init();
