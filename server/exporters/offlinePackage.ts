import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { summarizeFlight } from "../../src/domain/comparison";
import type { CollectionBatch, FlightSample, PlatformQuote } from "../../src/domain/types";

const require = createRequire(import.meta.url);

interface ArchiveWriter {
  pipe(destination: NodeJS.WritableStream): void;
  directory(sourceDir: string, destinationPath: false | string): void;
  finalize(): Promise<void>;
  on(event: "error", listener: (error: Error) => void): void;
}

interface ZipArchiveConstructor {
  new (options: { zlib: { level: number } }): ArchiveWriter;
}

const { ZipArchive } = require("archiver") as { ZipArchive: ZipArchiveConstructor };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

function formatDisplayTime(value: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function formatPrice(quote: PlatformQuote) {
  return typeof quote.price === "number" ? `¥${quote.price.toLocaleString("zh-CN")}` : quote.status;
}

function gapClass(gap: number | null) {
  if (gap === null) return "unknown";
  if (gap < 0) return "advantage";
  if (gap === 0) return "neutral";
  return "higher";
}

function gapLabel(gap: number | null) {
  if (gap === null) return "暂无可比价";
  if (gap < 0) return `低${Math.abs(gap)}元`;
  if (gap === 0) return "持平";
  return `高${gap}元`;
}

function renderQuoteCard(quote: PlatformQuote) {
  const isPrimary = quote.platform === "青猫差旅";
  const canOpenPlatform = Boolean(quote.sourceUrl);
  const className = ["quote", isPrimary ? "primary" : "", canOpenPlatform ? "clickable" : ""].filter(Boolean).join(" ");
  const clickAttrs = canOpenPlatform
    ? ` role="link" tabindex="0" data-url="${escapeHtml(quote.sourceUrl)}" onclick="openPlatform(event, this)" onkeydown="handlePlatformKey(event, this)"`
    : "";

  return `<div class="${className}"${clickAttrs}>
            <div class="platform">${quote.platform}</div>
            <div class="price">${formatPrice(quote)}</div>
            <div class="quote-actions">
              <a href="${escapeHtml(quote.evidencePath)}" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">查看网页截图</a>
            </div>
          </div>`;
}

function renderEvidenceSvg(sample: FlightSample, platform: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#f6f8fb"/>
  <rect x="64" y="72" width="1152" height="560" rx="24" fill="#ffffff" stroke="#d0d7de"/>
  <text x="104" y="140" font-family="Arial, sans-serif" font-size="38" font-weight="700" fill="#0f3d5e">${escapeHtml(platform)} 网页截图</text>
  <text x="104" y="210" font-family="Arial, sans-serif" font-size="28" fill="#111827">${escapeHtml(sample.origin)}-${escapeHtml(sample.destination)} / ${escapeHtml(sample.flightNo)}</text>
  <text x="104" y="270" font-family="Arial, sans-serif" font-size="24" fill="#667085">真实采集阶段这里会替换为平台页面截图。</text>
  <text x="104" y="330" font-family="Arial, sans-serif" font-size="24" fill="#667085">网页截图用于会后复核，不用于 OCR 采集。</text>
</svg>`;
}

function renderIndex(batch: CollectionBatch) {
  const displayTime = formatDisplayTime(batch.generatedAt);
  const advantageCount = batch.samples.filter((sample) => {
    const summary = summarizeFlight(sample);
    return summary.qingmaoGap !== null && summary.qingmaoGap < 0;
  }).length;
  const cards = batch.samples
    .map((sample) => {
      const summary = summarizeFlight(sample);
      const tone = gapClass(summary.qingmaoGap);
      const quotes = sample.quotes
        .map((quote) => renderQuoteCard(quote))
        .join("");
      return `<article class="flight-card" data-scope="${sample.scope}">
        <div class="card-head">
          <div class="route-line">
            <span>${sample.scope}</span>
            <strong>${sample.origin} → ${sample.destination}</strong>
            <em>${sample.travelDate}</em>
          </div>
          <div class="gap-pill ${tone}">${gapLabel(summary.qingmaoGap)}</div>
        </div>
        <div class="flight-meta">${sample.airline} ${sample.flightNo} / ${sample.cabin} / ${sample.directType}${sample.transferCity ? ` / 中转${sample.transferCity}` : ""}</div>
        <div class="quotes">${quotes}</div>
        <p class="conclusion">${summary.conclusion}</p>
        <div class="verify-bar">
          <span>需要现场复核时，点击携程商旅或阿里商旅价格卡片，进入对应平台预订入口后按同一日期、航班号查询。</span>
        </div>
      </article>`;
    })
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>青猫差旅航班价格演示包</title>
  <style>
    :root { --ink:#101a33; --muted:#61708d; --line:#dfe7f2; --panel:#ffffff; --bg:#f3f7fb; --accent:#078b84; --navy:#10395a; --blue:#145de8; --orange:#f27511; --soft:#e9f8f6; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif; color: var(--ink); background: radial-gradient(circle at 20% 0%, rgba(20,93,232,.08), transparent 32%), linear-gradient(180deg, #fff, var(--bg)); }
    .shell { width: min(1220px, calc(100% - 40px)); margin: 0 auto; padding: 32px 0 56px; }
    header { display: grid; grid-template-columns: 1.2fr .8fr; gap: 24px; align-items: end; border-bottom: 2px solid var(--navy); padding-bottom: 24px; }
    h1 { margin: 0; font-size: clamp(34px, 5vw, 68px); line-height: .96; letter-spacing: 0; color: var(--navy); }
    header p { max-width: 760px; color: var(--muted); font-size: 18px; line-height: 1.8; }
    .data-time { justify-self: end; border: 1px solid var(--line); background: rgba(255,255,255,.92); padding: 18px 20px; min-width: 300px; box-shadow: 0 18px 48px rgba(16,26,51,.08); }
    .data-time span { display:block; color:var(--muted); font-weight:800; font-size:13px; }
    .data-time strong { display: block; margin-top: 6px; font-size: 28px; color: var(--navy); }
    .data-time small { display:block; margin-top: 8px; color: var(--accent); font-weight: 800; }
    .toolbar { display: flex; gap: 12px; margin: 24px 0; flex-wrap: wrap; }
    button { border: 1px solid var(--navy); background: var(--navy); color: #fff; padding: 12px 18px; cursor: pointer; font-weight: 850; }
    button.secondary { background: #fff; color: var(--navy); }
    .overview { display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 22px 0 8px; }
    .overview-item { background:#fff; border:1px solid var(--line); padding:16px 18px; }
    .overview-item span { color: var(--muted); font-size:13px; font-weight:800; }
    .overview-item strong { display:block; margin-top:4px; font-size:28px; color: var(--navy); }
    .overview-item:first-child { border-top:5px solid var(--accent); }
    .overview-item:nth-child(2) { border-top:5px solid var(--blue); }
    .overview-item:nth-child(3) { border-top:5px solid var(--orange); }
    .flight-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
    .flight-card { background: var(--panel); border: 1px solid var(--line); padding: 22px; box-shadow: 0 16px 44px rgba(16, 26, 51, .08); }
    .card-head { display:flex; justify-content:space-between; gap:14px; align-items:flex-start; }
    .route-line { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .route-line span { background: #e5f3ef; color: var(--accent); padding: 4px 8px; font-weight: 800; }
    .route-line strong { font-size: 30px; color: var(--navy); }
    .route-line em { color: var(--muted); font-style: normal; }
    .flight-meta { margin-top: 10px; color: var(--muted); font-weight:700; }
    .gap-pill { flex:0 0 auto; padding:8px 12px; font-size:20px; font-weight:950; }
    .gap-pill.advantage { background: var(--soft); color: var(--accent); }
    .gap-pill.neutral { background:#edf4ff; color:var(--blue); }
    .gap-pill.higher { background:#fff6ea; color:var(--orange); font-size:16px; }
    .gap-pill.unknown { background:#f3f5f8; color:var(--muted); font-size:16px; }
    .quotes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 16px 0; }
    .quote { border: 1px solid var(--line); padding: 14px; min-height: 154px; background: #fbfcfe; display:flex; flex-direction:column; justify-content:space-between; }
    .quote.primary { border-color: var(--accent); background: var(--soft); }
    .quote.clickable { cursor: pointer; transition: border-color .18s ease, box-shadow .18s ease, transform .18s ease; }
    .quote.clickable:hover, .quote.clickable:focus { border-color: var(--blue); box-shadow: 0 12px 28px rgba(20, 93, 232, .12); outline: none; transform: translateY(-1px); }
    .platform { color: var(--muted); font-size: 15px; font-weight: 850; }
    .price { font-size: 34px; font-weight: 950; margin: 10px 0; color: var(--navy); }
    .primary .price { color: var(--accent); }
    .quote-actions { display:grid; gap: 7px; align-items:start; }
    a { color: var(--accent); font-weight: 850; text-decoration: none; }
    .conclusion { margin: 0; padding-top: 14px; border-top: 1px solid var(--line); font-weight: 950; font-size: 20px; color: var(--navy); }
    .verify-bar { display:flex; flex-wrap:wrap; gap: 10px 14px; align-items:center; margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--line); color: var(--muted); font-size: 14px; }
    .verify-bar span { flex: 1 1 360px; }
    @media (max-width: 820px) { header, .flight-grid, .quotes, .overview { grid-template-columns: 1fr; } .data-time { justify-self: stretch; } .card-head { flex-direction: column; } }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <div>
        <h1>青猫差旅<br/>航班价格对比</h1>
        <p>同一航班，三平台价格对比。当前为 ${displayTime} 的数据。</p>
      </div>
      <div class="data-time">
        <span>数据更新时间</span>
        <strong>${displayTime}</strong>
        <small>按同一日期、航班号、经济舱口径对比</small>
      </div>
    </header>
    <section class="overview" aria-label="价格对比概览">
      <div class="overview-item"><span>青猫低于竞品</span><strong>${advantageCount}</strong></div>
      <div class="overview-item"><span>对比口径</span><strong>同日同航班</strong></div>
      <div class="overview-item"><span>网页复核入口</span><strong>携程 / 阿里</strong></div>
    </section>
    <div class="toolbar">
      <button type="button" onclick="randomCard()">随机看一条航班</button>
      <button type="button" class="secondary" onclick="showAll()">显示全部</button>
    </div>
    <section class="flight-grid" id="cards">${cards}</section>
  </main>
  <script>
    const cards = Array.from(document.querySelectorAll('.flight-card'));
    function randomCard() {
      const selected = cards[Math.floor(Math.random() * cards.length)];
      cards.forEach(card => card.style.display = card === selected ? '' : 'none');
      selected.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    function showAll() {
      cards.forEach(card => card.style.display = '');
    }
    function openPlatform(event, element) {
      const url = element.dataset.url;
      if (!url) return;
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    function handlePlatformKey(event, element) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openPlatform(event, element);
    }
  </script>
</body>
</html>`;
}

async function zipDirectory(sourceDir: string, outputPath: string) {
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  const output = fs.createWriteStream(outputPath);
  const archive = new ZipArchive({ zlib: { level: 9 } });

  const done = new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    archive.on("error", reject);
  });

  archive.pipe(output);
  archive.directory(sourceDir, false);
  await archive.finalize();
  await done;
}

export async function exportOfflinePackage(batch: CollectionBatch, outputDir: string) {
  const packageName = `青猫差旅离线演示包-${batch.id}`;
  const packageDir = path.join(outputDir, packageName);
  const screenshotDir = path.join(packageDir, "screenshots");
  const dataDir = path.join(packageDir, "data");
  await fsp.mkdir(screenshotDir, { recursive: true });
  await fsp.mkdir(dataDir, { recursive: true });

  await fsp.writeFile(path.join(packageDir, "index.html"), renderIndex(batch), "utf8");
  await fsp.writeFile(path.join(dataDir, "batch.json"), JSON.stringify(batch, null, 2), "utf8");

  for (const sample of batch.samples) {
    for (const quote of sample.quotes) {
      const packagedEvidencePath = path.join(packageDir, quote.evidencePath);
      const sourceEvidencePath = path.join(outputDir, quote.evidencePath);
      await fsp.mkdir(path.dirname(packagedEvidencePath), { recursive: true });

      if (fs.existsSync(sourceEvidencePath)) {
        await fsp.copyFile(sourceEvidencePath, packagedEvidencePath);
      } else {
        await fsp.writeFile(packagedEvidencePath, renderEvidenceSvg(sample, quote.platform), "utf8");
      }
    }
  }

  const filename = `${packageName}.zip`;
  const outputPath = path.join(outputDir, filename);
  await zipDirectory(packageDir, outputPath);

  return {
    path: outputPath,
    filename,
    entryFile: "index.html"
  };
}
