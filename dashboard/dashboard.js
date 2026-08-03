const SPREAD_ALERT_THRESHOLD_PCT = 20;
let historyChart = null;

function formatPrice(value) {
  if (value === null || value === undefined) return "-";
  return value.toLocaleString("tr-TR", { style: "currency", currency: "TRY" });
}

function trendClass(trend) {
  return trend === "up" ? "trend-up" : trend === "down" ? "trend-down" : "trend-flat";
}

function renderSummaryTable(products) {
  const tbody = document.getElementById("summary-body");
  tbody.innerHTML = "";
  for (const p of products) {
    const tr = document.createElement("tr");
    const highSpread = (p.aggregate.price_spread_pct ?? 0) > SPREAD_ALERT_THRESHOLD_PCT;
    if (highSpread) tr.classList.add("spread-high");
    tr.dataset.sku = p.sku;
    tr.innerHTML = `
      <td>${p.sku}</td>
      <td>${p.name}</td>
      <td>${p.aggregate.seller_count}</td>
      <td>${formatPrice(p.aggregate.min_price)}</td>
      <td>${formatPrice(p.aggregate.max_price)}</td>
      <td>${p.aggregate.price_spread_pct ?? "-"}%</td>
      <td class="${trendClass(p.trend)}">${p.trend}</td>
    `;
    tr.addEventListener("click", () => renderDetail(p));
    tbody.appendChild(tr);
  }
}

function renderAlerts(product) {
  const container = document.getElementById("alerts");
  container.innerHTML = "";
  const alerts = [];

  if ((product.aggregate.price_spread_pct ?? 0) > SPREAD_ALERT_THRESHOLD_PCT) {
    alerts.push({
      type: "danger",
      text: `Fiyat farkı %${product.aggregate.price_spread_pct} -- eşik değeri %${SPREAD_ALERT_THRESHOLD_PCT} üzerinde.`,
    });
  }
  for (const seller of product.changes.newSellers) {
    alerts.push({
      type: "warn",
      text: `Yeni satıcı: ${seller.seller_name} (${seller.platform}) -- ${formatPrice(seller.price)}`,
    });
  }
  for (const change of product.changes.priceChanges) {
    if (Math.abs(change.pct_change) >= 10) {
      const direction = change.pct_change > 0 ? "arttı" : "düştü";
      alerts.push({
        type: "warn",
        text: `${change.seller_name} (${change.platform}) fiyatı %${Math.abs(change.pct_change)} ${direction}: ${formatPrice(change.old_price)} → ${formatPrice(change.new_price)}`,
      });
    }
  }

  for (const alert of alerts) {
    const div = document.createElement("div");
    div.className = `alert alert-${alert.type}`;
    div.textContent = alert.text;
    container.appendChild(div);
  }
}

function renderOffersTable(product) {
  const tbody = document.getElementById("offers-body");
  tbody.innerHTML = "";
  const newSellerNames = new Set(product.changes.newSellers.map((s) => s.seller_name));

  for (const offer of product.latestOffers) {
    const tr = document.createElement("tr");
    if (newSellerNames.has(offer.seller_name)) tr.classList.add("seller-new");
    tr.innerHTML = `
      <td>${offer.platform}</td>
      <td>${offer.seller_name}${offer.is_platform_official ? " ✓" : ""}</td>
      <td>${formatPrice(offer.price)}</td>
      <td>${offer.stock_status}</td>
      <td>${offer.shipping_info ?? "-"}</td>
      <td><a href="${offer.product_url}" target="_blank" rel="noopener">Git</a></td>
    `;
    tbody.appendChild(tr);
  }
}

function renderHistoryChart(product) {
  const ctx = document.getElementById("history-chart");
  if (historyChart) historyChart.destroy();

  historyChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: product.history.map((h) => h.date),
      datasets: [
        { label: "Min Fiyat", data: product.history.map((h) => h.min_price), borderColor: "#16a34a", tension: 0.2 },
        { label: "Max Fiyat", data: product.history.map((h) => h.max_price), borderColor: "#dc2626", tension: 0.2 },
        { label: "Medyan Fiyat", data: product.history.map((h) => h.median_price), borderColor: "#2563eb", tension: 0.2 },
        {
          label: "Teklif Sayısı",
          data: product.history.map((h) => h.seller_count),
          borderColor: "#9333ea",
          borderDash: [4, 4],
          yAxisID: "y1",
          tension: 0.2,
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        y: { title: { display: true, text: "Fiyat (TL)" } },
        y1: { position: "right", title: { display: true, text: "Teklif Sayısı" }, grid: { drawOnChartArea: false } },
      },
    },
  });
}

function renderDetail(product) {
  document.getElementById("detail-section").hidden = false;
  document.getElementById("detail-title").textContent = `${product.name} (${product.sku})`;
  renderAlerts(product);
  renderOffersTable(product);
  renderHistoryChart(product);
  document.getElementById("detail-section").scrollIntoView({ behavior: "smooth" });
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
  renderSummaryTable(data.products);
  renderDetail(data.products[0]);
}

init();
