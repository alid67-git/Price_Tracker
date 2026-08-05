import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const STOCK_LABELS = {
  in_stock: "Stokta",
  out_of_stock: "Tukendi",
  unknown: "Bilinmiyor",
};

const COLORS = {
  page: "#F7F7F4",
  ink: "#0B0B0B",
  muted: "#52514E",
  soft: "#898781",
  line: "#E1E0D9",
  card: "#FFFFFF",
  blue: "#2A78D6",
  blueWash: "#E8F1FB",
  green: "#0CA30C",
  greenWash: "#E6F6E6",
  warning: "#C47F00",
  warningWash: "#FFF4D6",
  critical: "#D03B3B",
  criticalWash: "#FBEAEA",
  header: "#0F2744",
  headerAccent: "#2A78D6",
  barTrack: "#ECEAE3",
  outlier: "#B45309",
  platform: ["#2A78D6", "#0CA30C", "#C47F00", "#7C5CBF", "#D03B3B", "#0E8A8A", "#5B6B7A"],
};

const SPREAD_CRITICAL = 20;
const MARGIN = 42;
const PAGE_W = 595.28;
const CONTENT_W = PAGE_W - MARGIN * 2;

function findFont(files) {
  const dirs = [
    path.join(os.homedir(), "AppData", "Local", "Microsoft", "Windows", "Fonts"),
    "C:\\Windows\\Fonts",
    "/usr/share/fonts/truetype/dejavu",
    "/System/Library/Fonts/Supplemental",
  ];
  for (const dir of dirs) {
    for (const file of files) {
      const p = path.join(dir, file);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function formatPrice(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });
}

function formatPct(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return `%${Number(value).toFixed(1)}`;
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleString("tr-TR");
}

function quantile(sorted, q) {
  const n = sorted.length;
  if (!n) return null;
  if (n === 1) return sorted[0];
  const pos = (n - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base] + rest * (sorted[Math.min(base + 1, n - 1)] - sorted[base]);
}

function mean(nums) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function computeExtraStats(offers) {
  const clean = offers.filter((o) => !o.is_outlier).map((o) => o.price).sort((a, b) => a - b);
  const all = offers.map((o) => o.price).sort((a, b) => a - b);
  const stock = { in_stock: 0, out_of_stock: 0, unknown: 0 };
  for (const o of offers) stock[o.stock_status] = (stock[o.stock_status] ?? 0) + 1;
  const freeShip = offers.filter((o) => /ucretsiz|ücretsiz|bedava/i.test(o.shipping_info ?? "")).length;
  return {
    clean,
    all,
    q1: quantile(clean, 0.25),
    q3: quantile(clean, 0.75),
    mean: mean(clean),
    stock,
    freeShip,
    cheapest: [...offers].filter((o) => !o.is_outlier).sort((a, b) => a.price - b.price).slice(0, 8),
    dearest: [...offers].filter((o) => !o.is_outlier).sort((a, b) => b.price - a.price).slice(0, 5),
  };
}

function ensureSpace(doc, y, need) {
  if (y + need <= 800) return y;
  doc.addPage();
  drawPageChrome(doc, doc.page.pageNumber);
  return 56;
}

function drawPageChrome(doc, pageNum) {
  doc.save();
  doc.rect(0, 0, PAGE_W, 8).fill(COLORS.headerAccent);
  doc.rect(0, 832, PAGE_W, 10).fill(COLORS.header);
  doc.fontSize(7).fillColor("#FFFFFF").text(`Fiyat Arastirma Sistemi  ·  sayfa ${pageNum}`, MARGIN, 834, {
    width: CONTENT_W,
    align: "right",
  });
  doc.restore();
}

function roundedRect(doc, x, y, w, h, r, fill) {
  doc.save();
  doc.roundedRect(x, y, w, h, r).fill(fill);
  doc.restore();
}

function sectionTitle(doc, text, y) {
  doc.save();
  doc.rect(MARGIN, y, 4, 14).fill(COLORS.blue);
  doc.font("Bold").fontSize(12).fillColor(COLORS.ink).text(text, MARGIN + 12, y - 1, { width: CONTENT_W - 12 });
  doc.restore();
  return y + 22;
}

function drawHeader(doc, report) {
  doc.save();
  doc.rect(0, 0, PAGE_W, 92).fill(COLORS.header);
  doc.rect(0, 92, PAGE_W, 4).fill(COLORS.headerAccent);

  doc.font("Bold").fontSize(18).fillColor("#FFFFFF").text("Fiyat Arastirma Raporu", MARGIN, 22, { width: CONTENT_W });
  doc.font("Body").fontSize(10).fillColor("#C8D7EA");
  doc.text(`Sorgu: ${report.query}`, MARGIN, 48, { width: CONTENT_W * 0.65 });
  doc.text(formatDateTime(report.generatedAt), MARGIN + CONTENT_W * 0.65, 48, { width: CONTENT_W * 0.35, align: "right" });

  const meta = [];
  if (report.sku) meta.push(`SKU: ${report.sku}`);
  if (report.marketplaceUrls?.length) meta.push(`${report.marketplaceUrls.length} pazaryeri URL`);
  meta.push(`${report.offers?.length ?? 0} teklif`);
  doc.fontSize(9).fillColor("#9BB4D0").text(meta.join("  ·  "), MARGIN, 68, { width: CONTENT_W });
  doc.restore();
  return 112;
}

function drawKpiCards(doc, y, agg, offerCount) {
  const cards = [
    { label: "Teklif", value: String(offerCount), accent: COLORS.blue, wash: COLORS.blueWash },
    { label: "En dusuk", value: formatPrice(agg.min_price), accent: COLORS.green, wash: COLORS.greenWash },
    { label: "Medyan", value: formatPrice(agg.median_price), accent: COLORS.blue, wash: COLORS.blueWash },
    {
      label: "Spread",
      value: formatPct(agg.price_spread_pct),
      accent: (agg.price_spread_pct ?? 0) > SPREAD_CRITICAL ? COLORS.critical : COLORS.green,
      wash: (agg.price_spread_pct ?? 0) > SPREAD_CRITICAL ? COLORS.criticalWash : COLORS.greenWash,
    },
  ];
  const gap = 10;
  const w = (CONTENT_W - gap * 3) / 4;
  cards.forEach((c, i) => {
    const x = MARGIN + i * (w + gap);
    roundedRect(doc, x, y, w, 58, 8, c.wash);
    doc.rect(x, y, 4, 58).fill(c.accent);
    doc.font("Body").fontSize(8).fillColor(COLORS.muted).text(c.label.toUpperCase(), x + 12, y + 10, { width: w - 18 });
    doc.font("Bold").fontSize(13).fillColor(COLORS.ink).text(c.value, x + 12, y + 28, { width: w - 18 });
  });
  return y + 72;
}

function drawAlerts(doc, y, agg) {
  const alerts = [];
  if ((agg.price_spread_pct ?? 0) > SPREAD_CRITICAL) {
    alerts.push({
      wash: COLORS.criticalWash,
      accent: COLORS.critical,
      text: `Yuksek spread: ${formatPct(agg.price_spread_pct)} (esik %${SPREAD_CRITICAL}). Rekabet bandi genis.`,
    });
  }
  if ((agg.outlier_count ?? 0) > 0) {
    alerts.push({
      wash: COLORS.warningWash,
      accent: COLORS.warning,
      text: `${agg.outlier_count} aykiri fiyat IQR ile tespit edildi; KPI/spread hesabindan cikarildi.`,
    });
  }
  if (!alerts.length) {
    roundedRect(doc, MARGIN, y, CONTENT_W, 28, 6, COLORS.greenWash);
    doc.rect(MARGIN, y, 4, 28).fill(COLORS.green);
    doc.font("Body").fontSize(9).fillColor(COLORS.ink).text("Kritik uyari yok — fiyat bandi kontrol altinda.", MARGIN + 12, y + 9, {
      width: CONTENT_W - 20,
    });
    return y + 38;
  }
  for (const a of alerts) {
    roundedRect(doc, MARGIN, y, CONTENT_W, 30, 6, a.wash);
    doc.rect(MARGIN, y, 4, 30).fill(a.accent);
    doc.font("Body").fontSize(9).fillColor(COLORS.ink).text(a.text, MARGIN + 12, y + 9, { width: CONTENT_W - 20 });
    y += 38;
  }
  return y;
}

function drawPlatformBars(doc, y, platforms, total) {
  y = sectionTitle(doc, "Platform dagilimi", y);
  if (!platforms?.length) {
    doc.font("Body").fontSize(9).fillColor(COLORS.muted).text("Platform verisi yok.", MARGIN, y);
    return y + 20;
  }
  const max = Math.max(...platforms.map((p) => p.count), 1);
  const barMax = CONTENT_W - 150;
  platforms.forEach((p, i) => {
    const color = COLORS.platform[i % COLORS.platform.length];
    const bw = (p.count / max) * barMax;
    const pct = total ? Math.round((p.count / total) * 100) : 0;
    doc.font("Body").fontSize(9).fillColor(COLORS.ink).text(p.platform, MARGIN, y, { width: 80 });
    roundedRect(doc, MARGIN + 88, y + 2, barMax, 10, 3, COLORS.barTrack);
    if (bw > 0) roundedRect(doc, MARGIN + 88, y + 2, Math.max(bw, 4), 10, 3, color);
    doc.font("Bold").fontSize(9).fillColor(COLORS.muted).text(`${p.count}  (${pct}%)`, MARGIN + 88 + barMax + 8, y, { width: 54 });
    y += 18;
  });
  return y + 8;
}

function drawPriceHistogram(doc, y, prices) {
  y = sectionTitle(doc, "Fiyat dagilimi (aykiri haric)", y);
  if (prices.length < 2) {
    doc.font("Body").fontSize(9).fillColor(COLORS.muted).text("Yeterli fiyat ornegi yok.", MARGIN, y);
    return y + 20;
  }
  const bins = Math.min(8, Math.max(4, Math.ceil(Math.sqrt(prices.length))));
  const min = prices[0];
  const max = prices[prices.length - 1];
  const span = Math.max(max - min, 1);
  const counts = Array(bins).fill(0);
  for (const p of prices) {
    let idx = Math.floor(((p - min) / span) * bins);
    if (idx >= bins) idx = bins - 1;
    counts[idx]++;
  }
  const maxCount = Math.max(...counts, 1);
  const chartH = 90;
  const chartW = CONTENT_W;
  const gap = 6;
  const barW = (chartW - gap * (bins - 1)) / bins;
  const baseY = y + chartH;

  doc.save();
  doc.moveTo(MARGIN, baseY).lineTo(MARGIN + chartW, baseY).strokeColor(COLORS.line).lineWidth(1).stroke();
  counts.forEach((c, i) => {
    const h = (c / maxCount) * (chartH - 16);
    const x = MARGIN + i * (barW + gap);
    const top = baseY - h;
    roundedRect(doc, x, top, barW, Math.max(h, 2), 3, i === 0 ? COLORS.green : i === bins - 1 ? COLORS.warning : COLORS.blue);
    doc.font("Body").fontSize(7).fillColor(COLORS.ink).text(String(c), x, top - 11, { width: barW, align: "center" });
    const lo = min + (span * i) / bins;
    doc.fontSize(6).fillColor(COLORS.soft).text(formatPrice(lo).replace(/\s/g, ""), x - 2, baseY + 4, { width: barW + 8, align: "center" });
  });
  doc.restore();
  return baseY + 24;
}

function drawTopCheapest(doc, y, cheapest, median) {
  y = sectionTitle(doc, "En uygun teklifler", y);
  if (!cheapest.length) {
    doc.font("Body").fontSize(9).fillColor(COLORS.muted).text("Teklif yok.", MARGIN, y);
    return y + 20;
  }
  const maxPrice = Math.max(...cheapest.map((o) => o.price), median ?? 1, 1);
  cheapest.forEach((o, i) => {
    const rankColor = i === 0 ? COLORS.green : COLORS.blue;
    const bw = (o.price / maxPrice) * (CONTENT_W - 210);
    roundedRect(doc, MARGIN, y, CONTENT_W, 22, 4, i % 2 === 0 ? COLORS.blueWash : COLORS.card);
    doc.circle(MARGIN + 12, y + 11, 7).fill(rankColor);
    doc.font("Bold").fontSize(8).fillColor("#FFFFFF").text(String(i + 1), MARGIN + 8, y + 7, { width: 8, align: "center" });
    doc.font("Body").fontSize(8).fillColor(COLORS.ink).text(`${o.seller_name}`.slice(0, 36), MARGIN + 26, y + 7, { width: 150 });
    roundedRect(doc, MARGIN + 180, y + 7, CONTENT_W - 210, 8, 3, COLORS.barTrack);
    roundedRect(doc, MARGIN + 180, y + 7, Math.max(bw, 3), 8, 3, rankColor);
    doc.font("Bold").fontSize(8).fillColor(COLORS.ink).text(formatPrice(o.price), MARGIN + CONTENT_W - 70, y + 7, {
      width: 62,
      align: "right",
    });
    y += 26;
  });
  return y + 6;
}

function drawStatsGrid(doc, y, agg, extra) {
  y = sectionTitle(doc, "Istatistik ozeti", y);
  const cells = [
    ["En dusuk", formatPrice(agg.min_price)],
    ["Q1", formatPrice(extra.q1)],
    ["Medyan", formatPrice(agg.median_price)],
    ["Ortalama", formatPrice(extra.mean)],
    ["Q3", formatPrice(extra.q3)],
    ["En yuksek*", formatPrice(agg.max_price)],
    ["Spread", `${formatPct(agg.price_spread_pct)} / ${formatPrice(agg.price_spread)}`],
    ["Aykiri", String(agg.outlier_count ?? 0)],
    ["Stokta", String(extra.stock.in_stock ?? 0)],
    ["Tukendi", String(extra.stock.out_of_stock ?? 0)],
    ["Stok bilinmiyor", String(extra.stock.unknown ?? 0)],
    ["Ucretsiz kargo", String(extra.freeShip)],
  ];
  const cols = 3;
  const gap = 8;
  const cellW = (CONTENT_W - gap * (cols - 1)) / cols;
  const cellH = 36;
  cells.forEach((cell, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = MARGIN + col * (cellW + gap);
    const cy = y + row * (cellH + gap);
    roundedRect(doc, x, cy, cellW, cellH, 6, COLORS.card);
    doc.roundedRect(x, cy, cellW, cellH, 6).strokeColor(COLORS.line).lineWidth(0.8).stroke();
    doc.font("Body").fontSize(7).fillColor(COLORS.soft).text(cell[0].toUpperCase(), x + 10, cy + 7, { width: cellW - 16 });
    doc.font("Bold").fontSize(11).fillColor(COLORS.ink).text(cell[1], x + 10, cy + 18, { width: cellW - 16 });
  });
  const rows = Math.ceil(cells.length / cols);
  y += rows * (cellH + gap) + 4;
  doc.font("Body").fontSize(7).fillColor(COLORS.soft).text("* En yuksek degeri aykiri fiyatlar haric tutulmustur.", MARGIN, y);
  return y + 16;
}

function drawOfferTable(doc, y, offers) {
  y = sectionTitle(doc, "Tum teklifler", y);
  const cols = [
    { key: "platform", label: "Platform", w: 70 },
    { key: "seller", label: "Satici", w: 175 },
    { key: "price", label: "Fiyat", w: 72 },
    { key: "stock", label: "Stok", w: 58 },
    { key: "ship", label: "Kargo", w: 90 },
    { key: "flag", label: "", w: 46 },
  ];

  const drawHead = (yy) => {
    roundedRect(doc, MARGIN, yy, CONTENT_W, 18, 3, COLORS.header);
    let x = MARGIN + 6;
    doc.font("Bold").fontSize(7).fillColor("#FFFFFF");
    for (const c of cols) {
      doc.text(c.label, x, yy + 5, { width: c.w });
      x += c.w;
    }
    return yy + 22;
  };

  y = drawHead(y);
  offers.forEach((offer, i) => {
    y = ensureSpace(doc, y, 20);
    if (y === 56) y = drawHead(y);

    const bg = offer.is_outlier ? COLORS.warningWash : i % 2 === 0 ? "#F3F5F8" : COLORS.card;
    roundedRect(doc, MARGIN, y, CONTENT_W, 16, 2, bg);
    let x = MARGIN + 6;
    const row = [
      String(offer.platform).slice(0, 12),
      String(offer.seller_name).slice(0, 34),
      formatPrice(offer.price),
      STOCK_LABELS[offer.stock_status] ?? "—",
      String(offer.shipping_info ?? "—").slice(0, 18),
      offer.is_outlier ? "AYKIRI" : "",
    ];
    doc.font("Body").fontSize(7).fillColor(offer.is_outlier ? COLORS.outlier : COLORS.ink);
    row.forEach((text, idx) => {
      if (idx === 5 && text) {
        doc.font("Bold").fillColor(COLORS.warning).text(text, x, y + 4, { width: cols[idx].w });
        doc.font("Body").fillColor(COLORS.ink);
      } else {
        doc.text(text, x, y + 4, { width: cols[idx].w });
      }
      x += cols[idx].w;
    });
    y += 18;
  });
  return y + 8;
}

function drawMethodNote(doc, y) {
  y = ensureSpace(doc, y, 70);
  y = sectionTitle(doc, "Yontem", y);
  roundedRect(doc, MARGIN, y, CONTENT_W, 52, 6, COLORS.blueWash);
  doc.font("Body").fontSize(8).fillColor(COLORS.muted).text(
    "Kaynaklar: Akakce, Cimri, Trendyol, Hepsiburada, n11, Amazon.com.tr (serbest metinle ilk urun eslesmesi) ve istege bagli ek URL'ler. " +
      "Aykiri fiyatlar Tukey IQR (Q1−1.5×IQR / Q3+1.5×IQR) ile isaretlenir; min/medyan/max/spread bu kayitlar haric hesaplanir. " +
      "Teklif listesinde aykirilar korunur ve turuncu olarak isaretlenir. Bu rapor disa aktarim icin uretilmistir.",
    MARGIN + 10,
    y + 10,
    { width: CONTENT_W - 20, lineGap: 2 }
  );
  return y + 60;
}

/**
 * Arama sonucu icin detayli, renkli PDF buffer uretir.
 * @returns {Promise<Buffer>}
 */
export function buildPdfReport(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: MARGIN,
      size: "A4",
      bufferPages: true,
      info: { Title: `Fiyat Raporu — ${report.query}`, Author: "Fiyat Arastirma Sistemi" },
    });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const regular = findFont(["arial.ttf", "segoeui.ttf", "DejaVuSans.ttf", "Arial Unicode.ttf"]);
    const bold = findFont(["arialbd.ttf", "segoeuib.ttf", "DejaVuSans-Bold.ttf", "Arial Bold.ttf"]);
    if (regular) doc.registerFont("Body", regular);
    if (bold) doc.registerFont("Bold", bold);
    else if (regular) doc.registerFont("Bold", regular);
    doc.font("Body");

    const offers = report.offers ?? [];
    const agg = report.aggregate ?? {};
    const platforms = report.platforms ?? [];
    const extra = computeExtraStats(offers);

    let y = drawHeader(doc, report);
    y = drawKpiCards(doc, y, agg, offers.length);
    y = drawAlerts(doc, y, agg);

    // Iki kolon: platform bars + histogram yan yana zor; dikey akista daha okunur
    y = drawPlatformBars(doc, y, platforms, offers.length);
    y = ensureSpace(doc, y, 130);
    y = drawPriceHistogram(doc, y, extra.clean);
    y = ensureSpace(doc, y, 40 + extra.cheapest.length * 26);
    y = drawTopCheapest(doc, y, extra.cheapest, agg.median_price);
    y = ensureSpace(doc, y, 180);
    y = drawStatsGrid(doc, y, agg, extra);
    y = ensureSpace(doc, y, 80);
    y = drawOfferTable(doc, y, offers);
    y = drawMethodNote(doc, y);

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      drawPageChrome(doc, i + 1);
    }

    doc.end();
  });
}
