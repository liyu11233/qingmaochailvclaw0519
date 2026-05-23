import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { summarizeFlight, summarizeQuoteSet } from "../../src/domain/comparison";
import type { CollectionBatch, HotelGroup, HotelSample, PlatformName, PlatformQuote } from "../../src/domain/types";

const zipExec = promisify(execFile);
const PLATFORMS: PlatformName[] = ["青猫差旅", "携程商旅", "阿里商旅", "在途商旅"];
const PLATFORM_CLASS: Record<PlatformName, string> = {
  青猫差旅: "qingmao",
  携程商旅: "ctrip",
  阿里商旅: "alibtrip",
  在途商旅: "ztrip"
};
const GROUP_LABEL: Record<HotelGroup, string> = {
  如家集团: "首旅如家",
  华住集团: "华住",
  锦江集团: "锦江",
  东呈集团: "东呈",
  亚朵集团: "亚朵酒店"
};
const GROUP_ORDER: HotelGroup[] = ["如家集团", "华住集团", "锦江集团", "东呈集团", "亚朵集团"];
const STATIC_ASSET_DIR = path.join(process.cwd(), "server", "assets");

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

function formatPrice(quote: PlatformQuote | undefined) {
  if (!quote) return "暂无";
  return typeof quote.price === "number" ? `¥${quote.price.toLocaleString("zh-CN")}` : quote.status;
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}小时${mins ? `${mins}分` : ""}`;
}

function quoteByPlatform(quotes: PlatformQuote[], platform: PlatformName) {
  return quotes.find((quote) => quote.platform === platform);
}

function primaryRatePlan(hotel: HotelSample) {
  return hotel.ratePlans.find((ratePlan) => ratePlan.label === hotel.primaryRatePlan) ?? hotel.ratePlans[0];
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

function renderSavingBadge(gap: number | null, comparisonLabel: string) {
  if (gap === null) {
    return `<span class="saving-main neutral">暂无可比价</span><small>${escapeHtml(comparisonLabel)}</small>`;
  }
  if (gap === 0) {
    return `<span class="saving-main neutral">持平</span><small>${escapeHtml(comparisonLabel)}</small>`;
  }
  const prefix = gap < 0 ? "低" : "高";
  return `<span class="saving-main"><em>${prefix}</em><b>${Math.abs(gap)}</b><em>元</em></span><small>${escapeHtml(comparisonLabel)}</small>`;
}

function sharedHead(title: string) {
  return `<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="../assets/styles.css" />
</head>`;
}

function rootHead(title: string) {
  return `<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="assets/styles.css" />
</head>`;
}

function deterministicPick<T>(items: T[], seed: string) {
  if (!items.length) return null;
  const hash = Array.from(seed).reduce((total, char) => total + char.charCodeAt(0), 0);
  return items[hash % items.length];
}

function scaledPriceBarWidth(quotes: PlatformQuote[], quote: PlatformQuote) {
  if (typeof quote.price !== "number") return 18;
  const prices = quotes.flatMap((item) => (typeof item.price === "number" ? [item.price] : []));
  if (!prices.length) return 18;
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  if (minPrice === maxPrice) return 76;
  const range = maxPrice - minPrice;
  const baseline = Math.max(0, minPrice - Math.max(range, minPrice * 0.02));
  const denominator = Math.max(maxPrice - baseline, 1);
  return Math.round(28 + ((quote.price - baseline) / denominator) * 72);
}

function renderHomeFlightPreview(sample: CollectionBatch["samples"][number]) {
  return `<div class="mini-board">
    <header>${escapeHtml(sample.origin)}-${escapeHtml(sample.destination)}　${escapeHtml(sample.flightNo)}<span>${escapeHtml(sample.travelDate)}</span></header>
    ${sample.quotes
      .map((quote) => `<div class="mini-price ${PLATFORM_CLASS[quote.platform]}"><span>${escapeHtml(quote.platform)}</span><span class="mini-bar"><i style="width:${scaledPriceBarWidth(sample.quotes, quote)}%"></i></span><strong>${escapeHtml(formatPrice(quote))}</strong></div>`)
      .join("")}
  </div>`;
}

function renderHomeHotelRatePreview(hotel: HotelSample) {
  const primary = primaryRatePlan(hotel);
  const previewPlans = [
    primary,
    ...hotel.ratePlans.filter((ratePlan) => ratePlan.label !== primary.label)
  ].slice(0, 3);

  return `<div class="home-rate-preview">
    <header><strong>${escapeHtml(hotel.hotelName)}</strong><span>${escapeHtml(hotel.checkInDate)} · ${hotel.nights}间夜</span></header>
    <div class="rate-grid-head"><span>口径</span><span>青猫</span><span>携程</span><span>阿里</span><span>在途</span></div>
    ${previewPlans
      .map((ratePlan) => `<div class="rate-grid-row">
        <span>${escapeHtml(ratePlan.label)}</span>
        ${PLATFORMS.map((platform) => `<strong class="${PLATFORM_CLASS[platform]}">${escapeHtml(formatPrice(quoteByPlatform(ratePlan.quotes, platform)))}</strong>`).join("")}
      </div>`)
      .join("")}
    <div class="rate-grid-row more"><span>更多口径</span><strong>...</strong><strong>...</strong><strong>...</strong><strong>...</strong></div>
  </div>`;
}

function renderIndex(batch: CollectionBatch) {
  const displayTime = formatDisplayTime(batch.generatedAt);
  const hotels = batch.hotels ?? [];
  const flightAdvantageSamples = batch.samples.filter((sample) => {
    const summary = summarizeFlight(sample);
    return summary.qingmaoGap !== null && summary.qingmaoGap < 0;
  });
  const hotelAdvantageSamples = hotels.filter((hotel) => {
    const summary = summarizeQuoteSet(primaryRatePlan(hotel).quotes);
    return summary.qingmaoGap !== null && summary.qingmaoGap < 0;
  });
  const featuredFlight = deterministicPick(flightAdvantageSamples, batch.id) ?? batch.samples[0];
  const featuredFlightSummary = featuredFlight ? summarizeFlight(featuredFlight) : null;
  const featuredHotel = deterministicPick(hotelAdvantageSamples, `${batch.id}-hotel`) ?? hotels[0];
  const featuredHotelPlan = featuredHotel ? primaryRatePlan(featuredHotel) : null;
  const featuredHotelSummary = featuredHotelPlan ? summarizeQuoteSet(featuredHotelPlan.quotes) : null;

  return `<!doctype html>
<html lang="zh-CN">
${rootHead("青猫差旅价格对比离线包")}
<body class="home-page">
  <header class="home-topbar">
    <a class="home-brand" href="index.html"><strong>青猫差旅</strong><span>QINGMAO TRAVEL</span></a>
    <nav><strong>首页</strong><a href="#about-package">关于本包</a></nav>
  </header>
  <main class="home-shell">
    <section class="home-hero">
      <div class="home-copy">
        <h1>青猫差旅价格对比</h1>
        <p>销售现场可分别查看航班与酒店价格。</p>
        <div class="home-rules"><span>同一航班 · 同一日期 · 同一舱位</span><i></i><span>同一酒店 · 同一日期 · 同一床型早餐口径</span></div>
      </div>
      <aside class="home-stamp">
        <span>数据更新时间</span>
        <strong>${escapeHtml(displayTime)}</strong>
        <small>当前为 ${escapeHtml(displayTime)} 采集数据</small>
        <em>离线网页包 / 不依赖本地服务</em>
      </aside>
    </section>
    <section class="home-metrics">
      <div><span>航班样本</span><strong>${batch.samples.length}</strong><small>同一航班四平台</small></div>
      <div><span>航班青猫低价</span><strong>${flightAdvantageSamples.length}</strong><small>按最新对比口径</small></div>
      <div><span>酒店样本</span><strong>${hotels.length}</strong><small>5 个集团</small></div>
      <div><span>酒店青猫低价</span><strong>${hotelAdvantageSamples.length}</strong><small>按当前验证口径</small></div>
    </section>
    <section class="home-feature-grid">
      <article class="home-feature-card flight-feature">
        <figure class="feature-photo flight-photo"><img src="assets/flight-photo.jpg" alt="飞行中的飞机实拍图" /></figure>
        <section>
          <h2>航班价格</h2>
          <p>同一航班四平台价格看板</p>
          ${featuredFlight ? renderHomeFlightPreview(featuredFlight) : `<div class="mini-board"><header>航班样本</header></div>`}
          <small>${featuredFlightSummary && featuredFlightSummary.qingmaoGap !== null ? `随机展示青猫低价样本：${escapeHtml(featuredFlightSummary.comparisonLabel)}` : "随机展示青猫低价样本"}</small>
          <a href="flights/index.html">查看航班比价</a>
        </section>
      </article>
      <article class="home-feature-card hotel-feature">
        <figure class="feature-photo hotel-photo-real"><img src="assets/hotel-photo.jpg" alt="酒店建筑实拍图" /></figure>
        <section>
          <h2>酒店价格</h2>
          <p>集团切换与六种口径价格对比</p>
          ${featuredHotel ? renderHomeHotelRatePreview(featuredHotel) : `<div class="mini-table"><header>酒店样本</header></div>`}
          <small>${featuredHotelSummary && featuredHotelSummary.qingmaoGap !== null ? `随机展示青猫低价酒店：${escapeHtml(featuredHotelSummary.comparisonLabel)}` : "随机展示青猫低价酒店"}</small>
          <a href="hotels/index.html">查看酒店比价</a>
        </section>
      </article>
    </section>
    <section id="about-package" class="home-benefits">
      <div><strong>同口径 · 可复核</strong><span>严格匹配航班/酒店与日期口径</span></div>
      <div><strong>离线可用</strong><span>离线网页包，不依赖本地服务</span></div>
      <div><strong>销售展示</strong><span>客户现场可直接打开查看</span></div>
      <div><strong>优先展示青猫价</strong><span>更低价格自动高亮展示</span></div>
    </section>
  </main>
</body>
</html>`;
}

function renderFlightQuoteRows(quotes: PlatformQuote[]) {
  return quotes
    .map((quote) => {
      const width = scaledPriceBarWidth(quotes, quote);
      return `<div class="flight-price-row ${PLATFORM_CLASS[quote.platform]}">
        <span class="platform-mark">${escapeHtml(quote.platform.slice(0, 1))}</span>
        <span class="platform-name">${escapeHtml(quote.platform)}</span>
        <span class="price-bar"><i style="width:${width}%"></i></span>
        <strong>${escapeHtml(formatPrice(quote))}</strong>
      </div>`;
    })
    .join("");
}

function renderFlights(batch: CollectionBatch) {
  const displayTime = formatDisplayTime(batch.generatedAt);
  const advantageSamples = batch.samples.filter((sample) => {
    const summary = summarizeFlight(sample);
    return summary.qingmaoGap !== null && summary.qingmaoGap < 0;
  });
  const gaps = advantageSamples.map((sample) => Math.abs(summarizeFlight(sample).qingmaoGap ?? 0));
  const averageAdvantage = gaps.length ? Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length) : 0;
  const maxAdvantageSample = advantageSamples.sort((a, b) => Math.abs(summarizeFlight(b).qingmaoGap ?? 0) - Math.abs(summarizeFlight(a).qingmaoGap ?? 0))[0];
  const cards = batch.samples
    .map((sample) => {
      const summary = summarizeFlight(sample);
      return `<article class="flight-record">
        <section class="flight-info">
          <h2>${escapeHtml(sample.origin)} - ${escapeHtml(sample.destination)}</h2>
          <p>${escapeHtml(sample.flightNo)}</p>
          <div class="timeline">
            <span><strong>起飞</strong>${escapeHtml(sample.travelDate)}</span>
            <i></i>
            <span><strong>航程</strong>${escapeHtml(formatDuration(sample.durationMinutes))}</span>
          </div>
          <small>${escapeHtml(sample.airline)} / ${escapeHtml(sample.cabin)} / ${escapeHtml(sample.directType)}${sample.transferCity ? ` / 经${escapeHtml(sample.transferCity)}` : ""}</small>
        </section>
        <section class="flight-prices">
          ${renderFlightQuoteRows(sample.quotes)}
        </section>
        <section class="flight-advantage ${gapClass(summary.qingmaoGap)}">
          <span>${escapeHtml(gapLabel(summary.qingmaoGap))}</span>
          <strong>${summary.qingmaoGap !== null && summary.qingmaoGap <= 0 ? "青猫价格更优" : "需结合企业协议价复核"}</strong>
          <small>${escapeHtml(summary.comparisonLabel)}</small>
        </section>
      </article>`;
    })
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
${sharedHead("航班价格对比")}
<body class="flight-page">
  <main class="flight-shell">
    <header class="dark-nav">
      <a class="dark-brand" href="../index.html">青猫差旅</a>
      <nav><strong>航班比价</strong><a href="../hotels/index.html">酒店比价</a></nav>
    </header>
    <header class="flight-hero">
      <div>
        <p class="eyebrow">当前为 ${escapeHtml(displayTime)} 采集数据</p>
        <h1>青猫差旅航班价格对比</h1>
        <p>同一航班 · 同一日期 · 同一舱位</p>
      </div>
      <div class="compare-visual" aria-label="四平台同航班价格动态示意">
        <div class="compare-orbit">
          <span class="orbit-node qingmao">青猫</span>
          <span class="orbit-node ctrip">携程</span>
          <span class="orbit-node alibtrip">阿里</span>
          <span class="orbit-node ztrip">在途</span>
          <span class="orbit-plane"><i></i></span>
        </div>
        <div class="compare-visual-copy">
          <strong>同航班价格扫描</strong>
          <span>四平台价格自动归一</span>
        </div>
      </div>
    </header>
    <section class="flight-stats">
      <div><span>青猫价格更优航班</span><strong>${advantageSamples.length} / ${batch.samples.length}</strong><small>${batch.samples.length ? Math.round((advantageSamples.length / batch.samples.length) * 100) : 0}%</small></div>
      <div><span>平均价格优势</span><strong>¥${averageAdvantage}</strong><small>按最新对比口径</small></div>
      <div><span>最高价格优势</span><strong>¥${Math.abs(summarizeFlight(maxAdvantageSample ?? batch.samples[0]).qingmaoGap ?? 0)}</strong><small>${maxAdvantageSample ? `${maxAdvantageSample.origin}-${maxAdvantageSample.destination} ${maxAdvantageSample.flightNo}` : "暂无"}</small></div>
    </section>
    <div class="flight-table-head"><span>航班信息</span><span>平台价格对比（含税价）</span><span>价格优势</span></div>
    <section class="flight-list">${cards}</section>
  </main>
</body>
</html>`;
}

function renderHotelSummary(hotels: HotelSample[]) {
  const primaryPlans = hotels.map(primaryRatePlan);
  const prices = primaryPlans.flatMap((plan) => plan.quotes.filter((quote) => quote.available && typeof quote.price === "number").map((quote) => quote.price as number));
  const qingmaoAdvantages = hotels.filter((hotel) => {
    const summary = summarizeQuoteSet(primaryRatePlan(hotel).quotes);
    return summary.qingmaoGap !== null && summary.qingmaoGap < 0;
  });
  const savings = qingmaoAdvantages.map((hotel) => Math.abs(summarizeQuoteSet(primaryRatePlan(hotel).quotes).qingmaoGap ?? 0));
  const avgSaving = savings.length ? Math.round(savings.reduce((sum, value) => sum + value, 0) / savings.length) : 0;
  return {
    lowest: prices.length ? Math.min(...prices) : 0,
    avgSaving,
    qingmaoShare: hotels.length ? Math.round((qingmaoAdvantages.length / hotels.length) * 1000) / 10 : 0
  };
}

function renderCompactRatePlan(ratePlan: HotelSample["ratePlans"][number]) {
  return `<div class="hotel-rate-mini">
    <strong>${escapeHtml(ratePlan.label)}</strong>
    ${PLATFORMS.map((platform) => {
      const quote = quoteByPlatform(ratePlan.quotes, platform);
      return `<span class="${PLATFORM_CLASS[platform]}">${escapeHtml(platform)} <b>${escapeHtml(formatPrice(quote))}</b></span>`;
    }).join("")}
  </div>`;
}

function renderHotelCard(hotel: HotelSample, index: number) {
  return `<article class="hotel-record">
    <div class="hotel-rank">${index + 1}</div>
    <figure class="hotel-photo"><img src="../assets/hotel-photo.jpg" alt="${escapeHtml(hotel.brand)}酒店实拍图" /><figcaption>${escapeHtml(hotel.brand)}</figcaption></figure>
    <section class="hotel-content">
      ${hotel.ratePlans.map((ratePlan) => renderHotelPlanView(hotel, ratePlan.label)).join("")}
    </section>
  </article>`;
}

function renderHotelPlanView(hotel: HotelSample, activeLabel: string) {
  const primary = hotel.ratePlans.find((ratePlan) => ratePlan.label === activeLabel) ?? primaryRatePlan(hotel);
  const summary = summarizeQuoteSet(primary.quotes);
  const secondaryPlans = hotel.ratePlans.filter((ratePlan) => ratePlan.label !== primary.label);
  const primaryQuotes = PLATFORMS.map((platform) => quoteByPlatform(primary.quotes, platform));
  const isDefault = primary.label === hotel.primaryRatePlan;

  return `<div class="hotel-plan-view ${isDefault ? "active" : ""}" data-plan="${escapeHtml(primary.label)}">
      <header class="hotel-title-row">
        <div>
          <h2>${escapeHtml(hotel.hotelName)}</h2>
          <p>${escapeHtml(hotel.city)} · 入住 ${escapeHtml(hotel.checkInDate)} · 离店 ${escapeHtml(hotel.checkOutDate)} · ${hotel.nights} 间夜</p>
        </div>
        <strong class="saving ${gapClass(summary.qingmaoGap)}">${renderSavingBadge(summary.qingmaoGap, summary.comparisonLabel)}</strong>
      </header>
      <div class="hotel-primary-row">
        <div class="room-type">${escapeHtml(primary.label)}</div>
        ${primaryQuotes
          .map((quote) => `<div class="hotel-platform-price ${quote ? PLATFORM_CLASS[quote.platform] : ""}">
            <span>${escapeHtml(quote?.platform ?? "平台")}</span>
            <strong>${escapeHtml(formatPrice(quote))}</strong>
          </div>`)
          .join("")}
      </div>
      <div class="hotel-rate-grid">${secondaryPlans.map(renderCompactRatePlan).join("")}</div>
    </div>`;
}

function renderHotels(batch: CollectionBatch) {
  const displayTime = formatDisplayTime(batch.generatedAt);
  const hotels = batch.hotels ?? [];
  const groups = GROUP_ORDER.filter((group) => hotels.some((hotel) => hotel.group === group));
  const allSummary = renderHotelSummary(hotels);
  const defaultGroup = groups[0];
  const defaultHotels = hotels.filter((hotel) => hotel.group === defaultGroup);
  const checkIn = hotels[0]?.checkInDate ?? "";
  const checkOut = hotels[0]?.checkOutDate ?? "";
  const rateLabels = hotels[0]?.ratePlans.map((ratePlan) => ratePlan.label) ?? [];
  const tabs = groups
    .map((group, index) => `<button type="button" class="${index === 0 ? "active" : ""}" data-group="${escapeHtml(group)}">${escapeHtml(GROUP_LABEL[group])}</button>`)
    .join("");
  const panels = groups
    .map((group, index) => {
      const groupHotels = hotels.filter((hotel) => hotel.group === group);
      return `<section class="hotel-group-panel ${index === 0 ? "active" : ""}" data-group="${escapeHtml(group)}">
        <div class="hotel-records">${groupHotels.map((hotel, hotelIndex) => renderHotelCard(hotel, hotelIndex)).join("")}</div>
      </section>`;
    })
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
${sharedHead("酒店价格对比")}
<body class="hotel-page">
  <main class="hotel-shell">
    <header class="hotel-topbar">
      <a href="../index.html" class="brand">青猫差旅</a>
      <nav><a class="active" href="index.html">酒店比价</a><a href="../flights/index.html">航班比价</a></nav>
    </header>
    <section class="hotel-title">
      <h1>青猫差旅酒店价格对比</h1>
      <div class="hotel-tabs" role="tablist">${tabs}</div>
      <div class="hotel-chips">
        <span>当前为 ${escapeHtml(displayTime)} 采集数据</span>
        <span>入住 ${escapeHtml(checkIn)} · 离店 ${escapeHtml(checkOut)} · 1 间夜</span>
        <span>同一酒店 · 同一日期 · 同一床型早餐口径</span>
        <div class="rate-selector" aria-label="选择主对比口径">
          <b>主对比口径</b>
          ${rateLabels.map((label, index) => `<button type="button" class="${index === 0 ? "active" : ""}" data-plan="${escapeHtml(label)}">${escapeHtml(label)}</button>`).join("")}
        </div>
      </div>
    </section>
    <section class="hotel-metrics">
      <div><span>酒店数量</span><strong>${defaultHotels.length || hotels.length} 家</strong></div>
      <div><span>当前口径最低价</span><strong>¥${allSummary.lowest} 起</strong></div>
      <div><span>平均可节省</span><strong>¥${allSummary.avgSaving} 起</strong></div>
      <div><span>最优平台占比</span><strong>青猫差旅 ${allSummary.qingmaoShare}%</strong></div>
      <div><span>价格单位</span><strong>元 / 1 间夜</strong></div>
    </section>
    <p class="hotel-hint">以下价格为 1 间夜；每家酒店突出当前选择口径，其他 3 种床型早餐口径保留在同一张卡片内。</p>
    ${panels}
    <footer class="hotel-footer">以上价格为平台可订最低价的展示结果，实际预订以各平台实时价格为准。</footer>
  </main>
  <script>
    const buttons = Array.from(document.querySelectorAll('.hotel-tabs button'));
    const panels = Array.from(document.querySelectorAll('.hotel-group-panel'));
    buttons.forEach(button => {
      button.addEventListener('click', () => {
        buttons.forEach(item => item.classList.remove('active'));
        panels.forEach(panel => panel.classList.remove('active'));
        button.classList.add('active');
        const target = button.dataset.group;
        panels.find(panel => panel.dataset.group === target)?.classList.add('active');
      });
    });
    const rateButtons = Array.from(document.querySelectorAll('.rate-selector button'));
    const planViews = Array.from(document.querySelectorAll('.hotel-plan-view'));
    rateButtons.forEach(button => {
      button.addEventListener('click', () => {
        rateButtons.forEach(item => item.classList.remove('active'));
        button.classList.add('active');
        const target = button.dataset.plan;
        planViews.forEach(view => view.classList.toggle('active', view.dataset.plan === target));
      });
    });
  </script>
</body>
</html>`;
}

function renderEvidencePlaceholder(title: string, quote: PlatformQuote) {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="UTF-8" /><title>${escapeHtml(title)}</title><style>body{font-family:Arial,sans-serif;margin:40px;color:#10233f}main{max-width:760px;border:1px solid #d8e2ef;padding:28px}span{color:#667085}strong{font-size:36px;color:#0e8f7a}</style></head>
<body><main><span>网页快照占位</span><h1>${escapeHtml(title)}</h1><strong>${escapeHtml(formatPrice(quote))}</strong><p>真实采集时这里会替换为平台网页截图或网页快照。当前为阶段 2 假数据闭环。</p></main></body>
</html>`;
}

function renderFlightCoverSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="760" viewBox="0 0 640 760" role="img" aria-label="航班封面图">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#fbfdff"/><stop offset=".58" stop-color="#edf8f3"/><stop offset="1" stop-color="#ffffff"/></linearGradient>
    <linearGradient id="green" x1="0" x2="1"><stop offset="0" stop-color="#087a50"/><stop offset="1" stop-color="#19bd76"/></linearGradient>
    <filter id="shadow" x="-25%" y="-25%" width="150%" height="150%"><feDropShadow dx="0" dy="18" stdDeviation="16" flood-color="#0c4d35" flood-opacity=".18"/></filter>
  </defs>
  <rect width="640" height="760" rx="18" fill="url(#bg)"/>
  <circle cx="172" cy="235" r="148" fill="#eaf7f4" stroke="#d3eee7" stroke-width="5"/>
  <path d="M24 235h296M172 87c-58 48-86 97-86 148s28 100 86 148M172 87c58 48 86 97 86 148s-28 100-86 148M172 88v294" fill="none" stroke="#c9e8df" stroke-width="5" opacity=".8"/>
  <path d="M64 164c56 24 128 24 216 0M64 306c56-24 128-24 216 0" fill="none" stroke="#c9e8df" stroke-width="5" opacity=".8"/>
  <g filter="url(#shadow)" transform="translate(42 218) rotate(-8)">
    <path d="M28 210 424 76c58-20 92-18 106 2 14 21-7 48-64 75L70 330 28 210Z" fill="#fff"/>
    <path d="M113 275 0 368l105-5 150-110-142 22Z" fill="url(#green)"/>
    <path d="M238 155 105 16 28 22l108 178 102-45Z" fill="url(#green)"/>
    <path d="M424 76c58-20 92-18 106 2 14 21-7 48-64 75l-84 38c-13-44 1-82 42-115Z" fill="url(#green)"/>
    <path d="M96 238c82-22 188-58 318-111" fill="none" stroke="#d6e5e5" stroke-width="10" stroke-linecap="round"/>
    <path d="M130 227c45-10 93-25 145-44" fill="none" stroke="#12a66e" stroke-width="12" stroke-linecap="round"/>
  </g>
  <text x="365" y="96" font-family="Arial,'PingFang SC',sans-serif" font-size="54" font-weight="800" fill="#10233f">航班价格</text>
  <text x="365" y="146" font-family="Arial,'PingFang SC',sans-serif" font-size="25" font-weight="700" fill="#56647a">同一航班四平台价格看板</text>
  <g transform="translate(354 460)">
    <rect width="34" height="56" rx="5" fill="#0e8f5b"/>
    <rect x="44" y="28" width="34" height="28" rx="5" fill="#0e8f5b" opacity=".78"/>
    <rect x="88" y="8" width="34" height="48" rx="5" fill="#0e8f5b" opacity=".55"/>
    <text x="148" y="20" font-family="Arial,'PingFang SC',sans-serif" font-size="24" font-weight="800" fill="#10233f">实时比价</text>
    <text x="148" y="56" font-family="Arial,'PingFang SC',sans-serif" font-size="19" font-weight="700" fill="#647184">多平台价格对比</text>
  </g>
  <g transform="translate(354 574)">
    <path d="M31 2 56 11v25c0 32-25 49-25 49S6 68 6 36V11L31 2Z" fill="#0e8f5b"/>
    <path d="m20 39 8 8 16-22" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="82" y="24" font-family="Arial,'PingFang SC',sans-serif" font-size="24" font-weight="800" fill="#10233f">价格优势</text>
    <text x="82" y="60" font-family="Arial,'PingFang SC',sans-serif" font-size="19" font-weight="700" fill="#647184">青猫低价一目了然</text>
  </g>
</svg>`;
}

function renderHotelCoverSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="760" viewBox="0 0 640 760" role="img" aria-label="酒店封面图">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#f5fbfd"/><stop offset="1" stop-color="#ffffff"/></linearGradient>
    <linearGradient id="wall" x1="0" x2="1"><stop offset="0" stop-color="#9db3c6"/><stop offset="1" stop-color="#c5d5e3"/></linearGradient>
    <linearGradient id="light" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ffd98c"/><stop offset="1" stop-color="#f1a33f"/></linearGradient>
    <filter id="shadow" x="-25%" y="-25%" width="150%" height="150%"><feDropShadow dx="0" dy="16" stdDeviation="14" flood-color="#17324b" flood-opacity=".18"/></filter>
  </defs>
  <rect width="640" height="760" rx="18" fill="url(#bg)"/>
  <g filter="url(#shadow)" transform="translate(28 132)">
    <path d="M24 456V92L214 28l166 64v364H24Z" fill="url(#wall)"/>
    <path d="M214 28v428h166V92L214 28Z" fill="#7e9aae"/>
    <rect x="146" y="40" width="134" height="62" rx="8" fill="#235f78"/>
    <text x="213" y="82" text-anchor="middle" font-family="Arial,'PingFang SC',sans-serif" font-size="32" font-weight="800" fill="#f7fbff">HOTEL</text>
    ${Array.from({ length: 7 }, (_, row) =>
      Array.from({ length: 4 }, (_, col) => {
        const x = 72 + col * 70;
        const y = 142 + row * 42;
        const lit = (row + col) % 3 !== 1;
        return `<rect x="${x}" y="${y}" width="34" height="28" rx="3" fill="${lit ? "url(#light)" : "#315267"}" opacity="${lit ? ".95" : ".72"}"/>`;
      }).join("")
    ).join("")}
    <path d="M0 456h422" stroke="#e6edf2" stroke-width="10"/>
    <path d="M150 456V372c0-22 18-40 40-40h72c22 0 40 18 40 40v84H150Z" fill="#486a80"/>
    <path d="M174 456v-88h104v88" fill="#24495f"/>
    <path d="M380 456c50 0 90 6 132 24H16c92-16 156-24 364-24Z" fill="#e9f2f5"/>
  </g>
  <text x="392" y="112" font-family="Arial,'PingFang SC',sans-serif" font-size="54" font-weight="800" fill="#10233f">酒店价格</text>
  <text x="392" y="164" font-family="Arial,'PingFang SC',sans-serif" font-size="24" font-weight="700" fill="#56647a">集团切换与酒店明细卡</text>
  <g transform="translate(384 296)">
    <rect width="48" height="48" rx="7" fill="#0f8b84"/>
    <rect x="9" y="9" width="12" height="12" rx="2" fill="#fff"/><rect x="27" y="9" width="12" height="12" rx="2" fill="#fff"/><rect x="9" y="27" width="12" height="12" rx="2" fill="#fff"/><rect x="27" y="27" width="12" height="12" rx="2" fill="#fff"/>
    <text x="78" y="18" font-family="Arial,'PingFang SC',sans-serif" font-size="24" font-weight="800" fill="#10233f">集团切换</text>
    <text x="78" y="54" font-family="Arial,'PingFang SC',sans-serif" font-size="19" font-weight="700" fill="#647184">五大酒店集团</text>
  </g>
  <g transform="translate(384 418)">
    <rect width="48" height="42" rx="6" fill="none" stroke="#0f8b84" stroke-width="7"/>
    <path d="M11 16h26M11 28h26" stroke="#0f8b84" stroke-width="7" stroke-linecap="round"/>
    <text x="78" y="16" font-family="Arial,'PingFang SC',sans-serif" font-size="24" font-weight="800" fill="#10233f">明细对比</text>
    <text x="78" y="52" font-family="Arial,'PingFang SC',sans-serif" font-size="19" font-weight="700" fill="#647184">六种口径价格对比</text>
  </g>
</svg>`;
}

function renderBaseStyles() {
  return `:root{--ink:#10233f;--muted:#667085;--line:#d8e2ef;--teal:#0e8f7a;--green:#3fd081;--blue:#2f8cff;--orange:#ff971e;--purple:#8b5cf6}*{box-sizing:border-box}body{margin:0;font-family:Avenir Next,PingFang SC,Microsoft YaHei,sans-serif;letter-spacing:0}.eyebrow{margin:0 0 12px;color:var(--green);font-weight:900}.home-page{background:#f5f7fb;color:var(--ink)}.home-topbar{height:70px;background:#061421;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 46px}.home-brand{color:#fff;text-decoration:none;display:flex;flex-direction:column;line-height:1}.home-brand strong{font-size:24px}.home-brand span{font-size:11px;color:#b8cad8}.home-topbar nav{display:flex;gap:40px}.home-topbar nav a,.home-topbar nav strong{color:#fff;text-decoration:none;font-weight:900;padding:24px 0}.home-topbar nav strong{border-bottom:3px solid var(--green)}.home-shell{width:min(1360px,calc(100% - 64px));margin:0 auto;padding:44px 0 56px}.home-hero{display:grid;grid-template-columns:1fr 360px;gap:40px;align-items:center;padding:10px 0 22px}.home-copy h1{margin:0;font-size:58px;line-height:1;color:#061421}.home-copy p{font-size:20px;color:#334155}.home-rules{display:flex;gap:18px;align-items:center;color:#334155;font-weight:900}.home-rules i{width:1px;height:18px;background:#cbd5e1}.home-stamp,.home-metrics div,.home-feature-card,.home-benefits{background:#fff;border:1px solid var(--line);box-shadow:0 18px 48px rgba(16,35,63,.08)}.home-stamp{padding:22px;border-radius:10px}.home-stamp span,.home-metrics span{display:block;color:var(--muted);font-size:13px;font-weight:900}.home-stamp strong{display:block;margin-top:8px;font-size:30px;color:#087044}.home-stamp small,.home-stamp em{display:block;margin-top:10px;color:#475569;font-style:normal}.home-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:0;margin:20px 0;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#fff}.home-metrics div{box-shadow:none;border:0;border-right:1px solid var(--line);padding:24px 34px}.home-metrics strong{display:block;font-size:38px;color:#087044}.home-feature-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:24px;margin-top:18px}.home-feature-card{display:grid;grid-template-columns:236px minmax(0,1fr);gap:20px;border-radius:10px;padding:22px;text-decoration:none}.home-feature-card h2{font-size:32px;margin:0 0 6px}.home-feature-card p{margin:0 0 12px;color:#475569;font-weight:800}.feature-visual{min-height:324px;border-radius:8px;background:#fff}.plane-visual{background:url('flight-cover.svg') center/contain no-repeat #fbfefd}.hotel-visual{background:url('hotel-cover.svg') center/contain no-repeat #fbfefd}.mini-board,.mini-table,.home-rate-preview{background:#fff;border:1px solid var(--line);border-radius:8px;padding:14px}.mini-board header,.mini-table header,.home-rate-preview header{font-weight:900;margin-bottom:10px}.mini-board header span,.mini-table header span,.home-rate-preview header span{float:right;color:#64748b}.mini-price,.mini-table div{display:grid;grid-template-columns:100px 1fr 80px;gap:10px;align-items:center;padding:6px 0}.mini-price i{height:14px;border-radius:999px;background:#dbeafe}.mini-price.qingmao i{background:var(--green)}.mini-price.ctrip i{background:var(--blue)}.mini-price.alibtrip i{background:var(--orange)}.mini-price.ztrip i{background:var(--purple)}.mini-table div{grid-template-columns:1fr auto}.home-rate-preview{padding:12px}.home-rate-preview header{font-size:15px;line-height:1.35}.home-rate-preview header span{font-size:13px}.rate-grid-head,.rate-grid-row{display:grid;grid-template-columns:1.15fr repeat(4,.85fr);gap:8px;align-items:center;border-bottom:1px solid #edf2f7;padding:7px 0}.rate-grid-head{color:#64748b;font-size:12px;font-weight:900}.rate-grid-row span{font-size:13px;font-weight:900}.rate-grid-row strong{font-size:13px;text-align:right}.rate-grid-row.more{border-bottom:0;color:#64748b}.home-feature-card small{display:block;color:#087044;font-weight:900;margin-top:12px;line-height:1.5}.home-feature-card a{display:block;margin-top:16px;background:#07814f;color:#fff;text-align:center;text-decoration:none;font-weight:900;padding:14px;border-radius:8px}.hotel-feature a{background:#087b86}.home-benefits{display:grid;grid-template-columns:repeat(4,1fr);gap:0;margin-top:24px;border-radius:10px;padding:22px}.home-benefits div{padding:0 22px}.home-benefits strong{display:block;font-size:18px}.home-benefits span{color:#64748b}.flight-page{min-height:100vh;background:#020b12;color:#edf8ff}.flight-shell{width:min(1260px,calc(100% - 48px));margin:0 auto;padding:28px 0 54px}.dark-nav{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:26px}.dark-nav nav{display:flex;align-items:center;gap:22px}.dark-nav a,.dark-nav strong{color:#d9f7ee;text-decoration:none;font-weight:900}.dark-nav strong{border-bottom:2px solid var(--green);padding-bottom:10px}.dark-brand{font-size:24px}.flight-hero{min-height:250px;display:grid;grid-template-columns:1fr 420px;align-items:center;border-bottom:1px solid rgba(119,231,190,.28);position:relative}.flight-hero h1{font-size:56px;line-height:1.05;margin:0;text-shadow:0 8px 30px rgba(0,0,0,.45)}.flight-hero p{font-size:28px;color:#45e68f;font-weight:900}.compare-scope{background:rgba(9,40,46,.88);border:1px solid rgba(119,231,190,.28);border-radius:14px;padding:28px 30px;box-shadow:0 18px 60px rgba(0,0,0,.22)}.compare-scope span{display:block;color:#8fd8c7;font-weight:900;margin-bottom:8px}.compare-scope strong{display:block;color:#35e3ae;font-size:28px;margin-bottom:16px}.compare-scope ul{margin:0;padding-left:18px;color:#d9f7ee;line-height:1.9;font-weight:800}.flight-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:0;margin:28px 0 14px;border:1px solid rgba(142,206,232,.18);background:rgba(11,34,49,.9);border-radius:12px;overflow:hidden}.flight-stats div{padding:24px 30px;border-right:1px solid rgba(142,206,232,.16)}.flight-stats span{display:block;color:#9db5c6;font-weight:900}.flight-stats strong{display:block;color:#47d883;font-size:42px;margin:10px 0}.flight-stats small{color:#c7d7e1;font-size:16px}.flight-table-head,.flight-record{display:grid;grid-template-columns:280px 1fr 230px;gap:12px}.flight-table-head{background:rgba(14,41,58,.86);border-radius:10px;padding:13px 24px;margin-bottom:10px;color:#9db5c6;font-weight:900}.flight-list{display:grid;gap:10px}.flight-record{background:rgba(8,31,46,.92);border:1px solid rgba(142,206,232,.18);border-radius:12px;overflow:hidden}.flight-info,.flight-prices,.flight-advantage{padding:22px}.flight-info{border-right:1px solid rgba(142,206,232,.16)}.flight-info h2{margin:0 0 6px;font-size:27px}.flight-info p{margin:0 0 16px;color:#cbd7df;font-size:18px}.timeline{display:grid;grid-template-columns:1fr 22px 1fr;align-items:center;color:#eaf7ff}.timeline strong{display:block;color:#68dda8;font-size:13px}.timeline i{width:10px;height:70px;border-left:3px solid #56d990;display:block;margin:auto}.flight-info small{display:block;margin-top:12px;color:#a8bac7}.flight-price-row{display:grid;grid-template-columns:44px 112px 1fr 110px;gap:14px;align-items:center;margin:10px 0}.platform-mark{width:34px;height:34px;border-radius:12px;display:grid;place-items:center;font-weight:900;color:#06111a}.flight-price-row.qingmao .platform-mark{background:var(--green)}.flight-price-row.ctrip .platform-mark{background:var(--blue)}.flight-price-row.alibtrip .platform-mark{background:var(--orange)}.flight-price-row.ztrip .platform-mark{background:var(--purple)}.platform-name{font-weight:900}.price-bar{height:22px;background:rgba(255,255,255,.1);border-radius:999px;overflow:hidden}.price-bar i{height:100%;display:block;border-radius:999px}.qingmao .price-bar i{background:linear-gradient(90deg,#35c76f,#60e39b)}.ctrip .price-bar i{background:linear-gradient(90deg,#1675ea,#4fa5ff)}.alibtrip .price-bar i{background:linear-gradient(90deg,#ff850e,#ffb04a)}.ztrip .price-bar i{background:linear-gradient(90deg,#7c3aed,#a78bfa)}.flight-price-row strong{font-size:24px}.qingmao strong{color:var(--green)}.ctrip strong{color:var(--blue)}.alibtrip strong{color:var(--orange)}.ztrip strong{color:var(--purple)}.flight-advantage{border-left:1px solid rgba(142,206,232,.16);display:flex;flex-direction:column;justify-content:center;min-width:0}.flight-advantage span{font-size:30px;font-weight:900;color:#42dc83;white-space:nowrap}.flight-advantage.higher span{color:#ffb04a}.flight-advantage strong{margin:8px 0;color:#40df83}.flight-advantage small{color:#a8bac7;line-height:1.45}.hotel-page{background:#f7fafb;color:var(--ink)}.hotel-shell{width:min(1210px,calc(100% - 36px));margin:0 auto;padding:0 0 50px}.hotel-topbar{height:80px;display:flex;align-items:center;justify-content:space-between;background:#012b32;color:#fff;margin:0 calc((100vw - min(1210px,calc(100vw - 36px)))/-2);padding:0 calc((100vw - min(1210px,calc(100vw - 36px)))/2)}.brand{color:#fff;text-decoration:none;font-size:26px;font-weight:900}.hotel-topbar nav{display:flex;gap:22px}.hotel-topbar nav a{color:#d6eff0;text-decoration:none;font-weight:900;padding:28px 4px}.hotel-topbar nav a.active{border-bottom:3px solid #1fb8a8}.hotel-title{padding:28px 0 18px}.hotel-title h1{margin:0 0 20px;font-size:36px}.hotel-tabs{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:20px}.hotel-tabs button{border:0;background:#eef2f5;border-radius:8px 8px 0 0;color:#26384d;height:52px;font-weight:900;font-size:17px;cursor:pointer}.hotel-tabs button.active{background:#139b8c;color:#fff}.hotel-chips{display:flex;gap:12px;flex-wrap:wrap;align-items:center;background:#e9fbf9;border-radius:10px;padding:12px 16px;color:#235d64;font-weight:900}.rate-selector{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.rate-selector b{font-size:14px;color:#1b5961}.rate-selector button{border:1px solid #b7e4df;background:#fff;color:#235d64;border-radius:8px;padding:8px 10px;font-weight:900;cursor:pointer}.rate-selector button.active{background:#139b8c;color:#fff;border-color:#139b8c}.hotel-metrics{display:grid;grid-template-columns:1.1fr 1.2fr 1.1fr 1.4fr 1fr;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 10px 30px rgba(16,35,63,.06);margin-bottom:18px}.hotel-metrics div{padding:20px 26px;border-right:1px solid var(--line)}.hotel-metrics span{display:block;color:var(--muted);font-weight:900}.hotel-metrics strong{display:block;margin-top:8px;color:#0e8f7a;font-size:22px}.hotel-hint,.hotel-footer{background:#e9fbf9;color:#235d64;border-radius:10px;text-align:center;padding:12px;font-weight:900}.hotel-group-panel{display:none}.hotel-group-panel.active{display:block}.hotel-records{display:grid;gap:16px;margin-top:18px}.hotel-record{position:relative;display:grid;grid-template-columns:300px 1fr;gap:22px;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgba(16,35,63,.05);padding:16px}.hotel-rank{position:absolute;left:10px;top:10px;z-index:2;background:#0e9b91;color:#fff;border-radius:8px;font-size:24px;font-weight:900;width:42px;height:42px;display:grid;place-items:center}.hotel-photo{height:300px;margin:0;border-radius:8px;position:relative;overflow:hidden;background:#17324b}.hotel-photo img{width:100%;height:100%;object-fit:cover;display:block}.hotel-photo:after{content:"";position:absolute;left:0;right:0;bottom:0;height:42%;background:linear-gradient(180deg,transparent,rgba(0,0,0,.68))}.hotel-photo figcaption{position:absolute;left:22px;bottom:22px;z-index:2;color:#fff;font-size:22px;font-weight:900}.hotel-content{min-width:0}.hotel-title-row{display:flex;justify-content:space-between;gap:16px;align-items:start;margin-bottom:10px;padding-right:244px;min-height:74px}.hotel-plan-view{display:none;position:relative}.hotel-plan-view.active{display:block}.hotel-plan-view .saving{position:absolute;right:0;top:-88px;margin:0}.hotel-title-row h2{margin:4px 0 6px;font-size:30px}.hotel-title-row p{margin:0;color:#637184;font-weight:800}.saving{width:224px;background:#eefaf3;border:1px solid #ccebd9;color:#0a8b57;border-radius:12px;padding:13px 12px;text-align:center;font-size:28px;line-height:1.08}.saving b{display:block;white-space:nowrap}.saving small{display:block;font-size:14px;margin-top:7px;line-height:1.25}.saving.higher{background:#fff7e8;color:#b45309}.hotel-primary-row{clear:both;display:grid;grid-template-columns:150px repeat(4,1fr);border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-bottom:14px}.room-type{display:grid;place-items:center;font-size:24px;font-weight:900;background:#fff}.hotel-platform-price{padding:14px 12px;text-align:center;border-left:1px solid var(--line)}.hotel-platform-price span{display:block;font-weight:900}.hotel-platform-price strong{display:block;margin-top:6px;font-size:26px}.hotel-platform-price.qingmao{background:#e8f7f0}.hotel-platform-price.ctrip{background:#eaf3ff}.hotel-platform-price.alibtrip{background:#fff4e2}.hotel-platform-price.ztrip{background:#f1ecff}.hotel-rate-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}.hotel-rate-mini{border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:#fbfcfe}.hotel-rate-mini strong{display:block;text-align:center;margin-bottom:8px}.hotel-rate-mini span{display:flex;justify-content:space-between;gap:6px;font-size:13px;line-height:1.5;font-weight:800}.hotel-rate-mini b{font-weight:900}@media(max-width:940px){.home-hero,.entry-grid,.home-metrics,.flight-hero,.flight-stats,.flight-table-head,.flight-record,.hotel-record,.hotel-primary-row,.hotel-metrics{grid-template-columns:1fr}.compare-scope{display:none}.flight-table-head{display:none}.hotel-tabs{grid-template-columns:1fr 1fr}.hotel-rate-grid{grid-template-columns:1fr 1fr}.hotel-photo{height:220px}.hotel-topbar{margin:0 -18px;padding:0 18px}.hotel-title-row{padding-right:0}.hotel-plan-view .saving{position:static;margin-bottom:12px}.saving{width:100%}}`;
}

function renderLayoutFixStyles() {
  return `.home-feature-card{grid-template-columns:minmax(290px,.9fr) minmax(0,1.35fr);gap:28px;padding:26px;border-radius:8px;align-items:stretch}.home-feature-card>section{min-width:0;display:flex;flex-direction:column;justify-content:center}.home-feature-card h2{font-size:40px;line-height:1.05;margin-bottom:12px}.home-feature-card p{font-size:20px;margin-bottom:18px}.feature-photo{margin:0;min-height:366px;height:100%;border-radius:8px;overflow:hidden;position:relative;background:#e8eef2}.feature-photo img{width:100%;height:100%;display:block;object-fit:cover;filter:saturate(.92) contrast(.98)}.flight-photo img{object-position:58% center}.hotel-photo-real img{object-position:center}.feature-photo:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,255,255,.02),rgba(6,20,33,.16))}.mini-board,.home-rate-preview{padding:16px}.mini-price{grid-template-columns:100px minmax(0,1fr) 76px}.mini-price .mini-bar{height:14px;border-radius:999px;background:#edf3f4;overflow:hidden}.mini-price .mini-bar i{display:block;height:100%;border-radius:999px}.mini-price.qingmao .mini-bar i{background:var(--green)}.mini-price.ctrip .mini-bar i{background:var(--blue)}.mini-price.alibtrip .mini-bar i{background:var(--orange)}.mini-price.ztrip .mini-bar i{background:var(--purple)}.compare-visual{height:218px;position:relative;border:1px solid rgba(119,231,190,.32);border-radius:18px;background:radial-gradient(circle at 78% 18%,rgba(67,220,131,.24),transparent 30%),linear-gradient(135deg,rgba(6,29,40,.98),rgba(8,59,61,.9));overflow:hidden;box-shadow:0 18px 60px rgba(0,0,0,.24)}.compare-visual:before{content:"";position:absolute;inset:18px;border:1px solid rgba(137,232,198,.12);border-radius:16px}.compare-orbit{position:absolute;left:34px;right:34px;top:26px;height:126px;border:1px solid rgba(157,242,216,.24);border-radius:999px}.compare-orbit:before{content:"";position:absolute;left:44px;right:44px;top:50%;border-top:1px dashed rgba(191,232,220,.36);transform:translateY(-50%) rotate(-8deg)}.orbit-node{position:absolute;width:62px;height:62px;border-radius:50%;display:grid;place-items:center;font-size:15px;font-weight:900;color:#061421;box-shadow:0 10px 26px rgba(0,0,0,.25)}.orbit-node.qingmao{left:-12px;top:32px;background:#35d885}.orbit-node.ctrip{left:37%;top:-24px;background:#2f8cff;color:#fff}.orbit-node.alibtrip{right:-12px;top:32px;background:#ff971e;color:#fff}.orbit-node.ztrip{left:43%;bottom:-28px;background:#8b5cf6;color:#fff}.orbit-plane{position:absolute;left:0;top:0;width:34px;height:34px;animation:scanFlight 5.8s ease-in-out infinite}.orbit-plane:before{content:"";position:absolute;left:4px;top:15px;width:26px;height:5px;border-radius:999px;background:#dffaf0;box-shadow:0 0 18px rgba(63,208,129,.95);transform:rotate(-18deg)}.orbit-plane:after{content:"";position:absolute;left:13px;top:7px;width:9px;height:20px;background:#dffaf0;clip-path:polygon(50% 0,100% 100%,50% 74%,0 100%);transform:rotate(72deg)}.orbit-plane i{position:absolute;left:-30px;top:16px;width:34px;height:2px;border-radius:999px;background:linear-gradient(90deg,transparent,rgba(63,208,129,.8))}.compare-visual-copy{position:absolute;left:30px;right:30px;bottom:22px;display:flex;justify-content:space-between;align-items:flex-end;gap:18px}.compare-visual-copy strong{font-size:24px;color:#35e3ae}.compare-visual-copy span{color:#bfe8dc;font-weight:900}.hotel-title-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:24px;align-items:start;margin-bottom:22px;padding-right:0;min-height:104px}.hotel-plan-view .saving{position:static;right:auto;top:auto;margin:0}.saving{width:auto;min-width:360px;max-width:450px;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:7px;padding:15px 22px;text-align:left;line-height:1.08}.saving-main{display:flex;align-items:baseline;gap:2px;color:#078b52;font-weight:900;line-height:.95;white-space:nowrap}.saving-main b{font-size:48px;font-weight:1000;letter-spacing:0}.saving-main em{font-style:normal;font-size:30px;font-weight:900}.saving-main.neutral{font-size:32px}.saving small{display:block;margin-top:0;font-size:15px;font-weight:900;line-height:1.28;color:#078b52}.saving.higher .saving-main,.saving.higher small{color:#b45309}.hotel-primary-row{margin-top:0}@keyframes scanFlight{0%,100%{transform:translate(18px,72px) rotate(-10deg)}45%{transform:translate(275px,22px) rotate(8deg)}55%{transform:translate(300px,96px) rotate(150deg)}}@media(max-width:940px){.home-feature-card{grid-template-columns:1fr}.feature-photo{min-height:230px}.compare-visual{display:none}.hotel-title-row{grid-template-columns:1fr;min-height:auto}.saving{width:100%;min-width:0;max-width:none;flex-direction:column;text-align:center}.saving small{text-align:center}}`;
}

function renderStyles() {
  return renderBaseStyles() + renderLayoutFixStyles();
}

async function writeFileEnsured(filePath: string, content: string | Buffer) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content);
}

async function copyStaticAsset(packageDir: string, filename: string) {
  await fsp.copyFile(path.join(STATIC_ASSET_DIR, filename), path.join(packageDir, "assets", filename));
}

async function materializeEvidence(batch: CollectionBatch, outputDir: string, packageDir: string) {
  const quotes = [
    ...batch.samples.flatMap((sample) => sample.quotes),
    ...(batch.hotels ?? []).flatMap((hotel) => hotel.ratePlans.flatMap((ratePlan) => ratePlan.quotes))
  ];

  for (const [index, quote] of quotes.entries()) {
    if (!quote.evidencePath) continue;
    const targetPath = path.join(packageDir, quote.evidencePath);
    const sourcePath = path.join(outputDir, quote.evidencePath);
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    if (fs.existsSync(sourcePath)) {
      await fsp.copyFile(sourcePath, targetPath);
      continue;
    }
    const title = `${quote.platform} 证据 ${index + 1}`;
    await fsp.writeFile(targetPath, renderEvidencePlaceholder(title, quote), "utf8");
  }
}

export async function exportOfflinePackage(batch: CollectionBatch, outputDir: string) {
  await fsp.mkdir(outputDir, { recursive: true });

  const packageName = `qingmao-offline-package-${batch.id}`;
  const filename = `青猫差旅离线网页包-${batch.id}.zip`;
  const zipPath = path.join(outputDir, filename);
  const packageDir = path.join(outputDir, packageName);

  await fsp.rm(packageDir, { recursive: true, force: true });
  await fsp.rm(zipPath, { force: true });
  await fsp.mkdir(path.join(packageDir, "assets"), { recursive: true });
  await fsp.mkdir(path.join(packageDir, "flights"), { recursive: true });
  await fsp.mkdir(path.join(packageDir, "hotels"), { recursive: true });

  await writeFileEnsured(path.join(packageDir, "assets", "styles.css"), renderStyles());
  await copyStaticAsset(packageDir, "flight-photo.jpg");
  await copyStaticAsset(packageDir, "hotel-photo.jpg");
  await writeFileEnsured(path.join(packageDir, "index.html"), renderIndex(batch));
  await writeFileEnsured(path.join(packageDir, "flights", "index.html"), renderFlights(batch));
  await writeFileEnsured(path.join(packageDir, "hotels", "index.html"), renderHotels(batch));
  await materializeEvidence(batch, outputDir, packageDir);

  await zipExec("zip", ["-qr", zipPath, packageName], { cwd: outputDir });

  return {
    path: zipPath,
    filename,
    directory: packageDir
  };
}
