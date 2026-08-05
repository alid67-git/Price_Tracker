const GH_DEFAULTS = { owner: "alid67-git", repo: "Price_Tracker", branch: "main" };
const GH_LS_KEYS = { token: "pt_gh_token", owner: "pt_gh_owner", repo: "pt_gh_repo", branch: "pt_gh_branch" };

function getGithubConfig() {
  return {
    token: localStorage.getItem(GH_LS_KEYS.token) || "",
    owner: localStorage.getItem(GH_LS_KEYS.owner) || GH_DEFAULTS.owner,
    repo: localStorage.getItem(GH_LS_KEYS.repo) || GH_DEFAULTS.repo,
    branch: localStorage.getItem(GH_LS_KEYS.branch) || GH_DEFAULTS.branch,
  };
}

function saveGithubConfig({ token, owner, repo, branch }) {
  localStorage.setItem(GH_LS_KEYS.token, token ?? "");
  localStorage.setItem(GH_LS_KEYS.owner, owner || GH_DEFAULTS.owner);
  localStorage.setItem(GH_LS_KEYS.repo, repo || GH_DEFAULTS.repo);
  localStorage.setItem(GH_LS_KEYS.branch, branch || GH_DEFAULTS.branch);
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function base64ToUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function ghRequest(path, { method = "GET", body, token } = {}) {
  const headers = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || `GitHub API hatasi (HTTP ${res.status})`);
  }
  return data;
}

async function ghGetFile(cfg, path) {
  try {
    const data = await ghRequest(
      `/repos/${cfg.owner}/${cfg.repo}/contents/${path}?ref=${encodeURIComponent(cfg.branch)}`,
      { token: cfg.token }
    );
    return { content: base64ToUtf8(data.content), sha: data.sha };
  } catch (err) {
    if (String(err.message).toLowerCase().includes("not found")) return null;
    throw err;
  }
}

async function ghPutFile(cfg, path, content, sha, message) {
  if (!cfg.token) throw new Error("GitHub token gerekli (aşağıdaki Ayarlar bölümünden ekle).");
  return ghRequest(`/repos/${cfg.owner}/${cfg.repo}/contents/${path}`, {
    method: "PUT",
    token: cfg.token,
    body: { message, content: utf8ToBase64(content), branch: cfg.branch, sha: sha || undefined },
  });
}

async function isLocalServerAvailable() {
  try {
    const res = await fetch("/api/product-history", { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}
