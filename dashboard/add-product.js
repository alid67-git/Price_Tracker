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

function collectPayload(form) {
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

async function submitViaLocalServer(payload) {
  const res = await fetch("/api/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
}

async function submitViaGithub(payload) {
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
  setStatus("", null);

  const form = e.target;
  const payload = collectPayload(form);
  if (!payload.sku) {
    setStatus("SKU zorunludur.", "error");
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    const useLocal = await isLocalServerAvailable();
    if (useLocal) {
      await submitViaLocalServer(payload);
      setStatus(`"${payload.sku}" eklendi (yerel sunucu). Bir sonraki taramada dahil edilecek.`, "success");
    } else {
      await submitViaGithub(payload);
      setStatus(`"${payload.sku}" GitHub'a commit edildi. Bir sonraki otomatik taramada dahil edilecek.`, "success");
    }
    form.reset();
    document.getElementById("standalone-rows").innerHTML = "";
  } catch (err) {
    setStatus(`Hata: ${err.message}`, "error");
  } finally {
    submitBtn.disabled = false;
  }
}

async function updateModeIndicator() {
  const el = document.getElementById("mode-indicator");
  const useLocal = await isLocalServerAvailable();
  el.textContent = useLocal
    ? "Kayıt yöntemi: PC üzerindeki yerel sunucu (npm run web)"
    : "Kayıt yöntemi: yerel sunucu bulunamadı, GitHub'a doğrudan commit edilecek (aşağıdan token gerekir)";
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
    setStatus("GitHub ayarları kaydedildi.", "success");
  });
}

document.getElementById("add-standalone-row").addEventListener("click", addStandaloneRow);
document.getElementById("add-product-form").addEventListener("submit", submitProduct);
initGithubSettingsForm();
updateModeIndicator();
