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
  removeBtn.className = "btn btn-secondary";
  removeBtn.textContent = "✕";
  removeBtn.addEventListener("click", () => row.remove());

  row.append(urlInput, platformInput, removeBtn);
  wrap.appendChild(row);
}

function setStatus(message, kind) {
  const el = document.getElementById("form-status");
  el.textContent = message;
  el.className = kind ? `form-message ${kind}` : "";
}

async function submitProduct(e) {
  e.preventDefault();
  setStatus("", null);

  const form = e.target;
  const sku = form.sku.value.trim();
  if (!sku) {
    setStatus("SKU zorunludur.", "error");
    return;
  }

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

  const payload = {
    sku,
    name: form.name.value.trim(),
    marketplaces,
    aggregatorQuery: form.aggregatorQuery.value.trim(),
    standalone,
  };

  try {
    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    setStatus(`"${sku}" eklendi. Bir sonraki taramada dahil edilecek.`, "success");
    form.reset();
    document.getElementById("standalone-rows").innerHTML = "";
  } catch (err) {
    setStatus(`Hata: ${err.message}`, "error");
  }
}

document.getElementById("add-standalone-row").addEventListener("click", addStandaloneRow);
document.getElementById("add-product-form").addEventListener("submit", submitProduct);
