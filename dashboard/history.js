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

function showEmpty(message) {
  const el = document.getElementById("empty-history");
  el.textContent = message;
  el.hidden = false;
}

async function init() {
  let entries;
  try {
    const res = await fetch("/api/product-history");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    entries = await res.json();
  } catch (err) {
    showEmpty(`Geçmiş yüklenemedi (web sunucusu üzerinden açtığınızdan emin olun): ${err.message}`);
    return;
  }

  if (!entries.length) {
    showEmpty("Henüz eklenen ürün yok. \"Ürün Ekle\" sayfasından ilk ürününü ekleyebilirsin.");
    return;
  }

  const tbody = document.getElementById("history-body");
  for (const entry of [...entries].reverse()) {
    const tr = document.createElement("tr");
    for (const text of [formatDateTime(entry.addedAt), entry.sku, entry.name, sourceList(entry)]) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

init();
