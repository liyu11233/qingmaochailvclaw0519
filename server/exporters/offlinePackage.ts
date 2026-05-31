import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { summarizeFlight, summarizeQuoteSet } from "../../src/domain/comparison";
import {
  analyzeHotelRatePlanCompleteness,
  HOTEL_DISPLAY_RATE_PLAN_PRIORITY,
  resolveHotelDisplayDecision,
  resolveHotelPrimaryRatePlan
} from "../../src/domain/hotelRatePlans";
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
const DEFAULT_RATE_PLAN_KEY = "__default";
const INCLUDE_EVIDENCE_IN_SALES_PACKAGE = false;

interface HotelMetricSummary {
  hotelCount: number;
  lowestPrice: number | null;
  averageSaving: number | null;
  qingmaoLowestShare: number;
}

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

function formatHotelPrice(quote: PlatformQuote | undefined) {
  return quote && typeof quote.price === "number" ? `¥${quote.price.toLocaleString("zh-CN")}` : "暂无";
}

function evidenceHref(evidencePath: string | undefined) {
  if (!INCLUDE_EVIDENCE_IN_SALES_PACKAGE) return "";
  if (!evidencePath || evidencePath.startsWith("http://") || evidencePath.startsWith("https://") || evidencePath.startsWith("file://")) return "";
  return `../${evidencePath.split(path.sep).join("/")}`;
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
  return resolveHotelPrimaryRatePlan(hotel) ?? hotel.ratePlans[0];
}

function hotelSalesDisplayEligible(hotel: HotelSample) {
  return resolveHotelDisplayDecision(hotel.ratePlans).salesDisplayEligible;
}

function gapClass(gap: number | null) {
  if (gap === null) return "unknown";
  if (gap < 0) return "advantage";
  if (gap === 0) return "neutral";
  return "higher";
}

function formatGapAmount(gap: number) {
  return String(Math.round(Math.abs(gap)));
}

function gapLabel(gap: number | null) {
  if (gap === null) return "暂无可比价";
  if (gap < 0) return `低${formatGapAmount(gap)}元`;
  if (gap === 0) return "持平";
  return `高${formatGapAmount(gap)}元`;
}

function renderSavingBadge(gap: number | null, comparisonLabel: string) {
  if (gap === null) {
    return `<span class="saving-main neutral">暂无可比价</span><small>${escapeHtml(comparisonLabel)}</small>`;
  }
  if (gap === 0) {
    return `<span class="saving-main neutral">持平</span><small>${escapeHtml(comparisonLabel)}</small>`;
  }
  const prefix = gap < 0 ? "低" : "高";
  return `<span class="saving-main"><em>${prefix}</em><b>${formatGapAmount(gap)}</b><em>元</em></span><small>${escapeHtml(comparisonLabel)}</small>`;
}

function highestCompetitorComparisonLabel(quotes: PlatformQuote[]) {
  const qingmao = quoteByPlatform(quotes, "青猫差旅");
  const competitors = PLATFORMS
    .filter((platform) => platform !== "青猫差旅")
    .map((platform) => quoteByPlatform(quotes, platform))
    .filter((quote): quote is PlatformQuote => {
      if (!quote) return false;
      return quote.available && typeof quote.price === "number";
    });

  if (!qingmao?.available || typeof qingmao.price !== "number" || competitors.length < 3) {
    return "暂无完整可比价格";
  }

  const highestCompetitorPrice = Math.max(...competitors.map((quote) => quote.price as number));
  const gap = qingmao.price - highestCompetitorPrice;
  if (gap < 0) return `对比另外${competitors.length}家平台最高价低了${formatGapAmount(gap)}元`;
  if (gap > 0) return `对比另外${competitors.length}家平台最高价高了${formatGapAmount(gap)}元`;
  return `与另外${competitors.length}家平台最高价持平`;
}

function salesComparisonLabel(quotes: PlatformQuote[], summary: { qingmaoGap: number | null; comparisonLabel: string }) {
  return summary.qingmaoGap !== null && summary.qingmaoGap > 0
    ? highestCompetitorComparisonLabel(quotes)
    : summary.comparisonLabel;
}

function renderFlightAdvantageHeadline(gap: number | null) {
  if (gap === null) return "";
  if (gap < 0) return "<strong>青猫价格更优</strong>";
  if (gap === 0) return "<strong>价格持平</strong>";
  return "";
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
        ${PLATFORMS.map((platform) => `<strong class="${PLATFORM_CLASS[platform]}">${escapeHtml(formatHotelPrice(quoteByPlatform(ratePlan.quotes, platform)))}</strong>`).join("")}
      </div>`)
      .join("")}
    <div class="rate-grid-row more"><span>更多口径</span><strong>...</strong><strong>...</strong><strong>...</strong><strong>...</strong></div>
  </div>`;
}

function renderIndex(batch: CollectionBatch) {
  const displayTime = formatDisplayTime(batch.generatedAt);
  const hotels = (batch.hotels ?? []).filter(hotelSalesDisplayEligible);
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
          <p>集团切换与四种口径价格对比</p>
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
      const href = evidenceHref(quote.evidencePath);
      return `<div class="flight-price-row ${PLATFORM_CLASS[quote.platform]}">
        <span class="platform-mark">${escapeHtml(quote.platform.slice(0, 1))}</span>
        <span class="platform-name">${escapeHtml(quote.platform)}</span>
        <span class="price-bar"><i style="width:${width}%"></i></span>
        <strong>${escapeHtml(formatPrice(quote))}</strong>
        ${href ? `<a class="evidence-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">截图</a>` : ""}
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
  const maxAdvantage = Math.abs(summarizeFlight(maxAdvantageSample ?? batch.samples[0]).qingmaoGap ?? 0);
  const cards = batch.samples
    .map((sample) => {
      const summary = summarizeFlight(sample);
      const displayComparisonLabel = salesComparisonLabel(sample.quotes, summary);
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
          ${renderFlightAdvantageHeadline(summary.qingmaoGap)}
          <small>${escapeHtml(displayComparisonLabel)}</small>
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
      <div><span>平均优势金额</span><strong>¥${averageAdvantage}</strong><small>按竞品最低价口径</small></div>
      <div><span>最大优势金额</span><strong>¥${formatGapAmount(maxAdvantage)}</strong><small>${maxAdvantageSample ? `${maxAdvantageSample.origin}-${maxAdvantageSample.destination} ${maxAdvantageSample.flightNo}` : "暂无"}</small></div>
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

function isCompleteRatePlan(ratePlan: HotelSample["ratePlans"][number]) {
  return analyzeHotelRatePlanCompleteness(ratePlan).isFourPlatformComplete;
}

function scopedRatePlan(hotel: HotelSample, planKey: string) {
  if (planKey === DEFAULT_RATE_PLAN_KEY) {
    return primaryRatePlan(hotel);
  }

  return hotel.ratePlans.find((ratePlan) => ratePlan.label === planKey);
}

function summarizeHotelMetrics(hotels: HotelSample[], planKey: string): HotelMetricSummary {
  const completePlans = hotels
    .map((hotel) => scopedRatePlan(hotel, planKey))
    .filter((ratePlan): ratePlan is HotelSample["ratePlans"][number] => Boolean(ratePlan))
    .filter(isCompleteRatePlan);
  const prices = completePlans.flatMap((ratePlan) =>
    ratePlan.quotes.flatMap((quote) => (quote.available && typeof quote.price === "number" ? [quote.price] : []))
  );
  const summaries = completePlans.map((ratePlan) => summarizeQuoteSet(ratePlan.quotes));
  const savings = summaries.flatMap((summary) => (summary.lowestPlatform === "青猫差旅" && typeof summary.qingmaoGap === "number" && summary.qingmaoGap < 0 ? [Math.abs(summary.qingmaoGap)] : []));
  const qingmaoLowestCount = summaries.filter((summary) => summary.lowestPlatform === "青猫差旅").length;

  return {
    hotelCount: completePlans.length,
    lowestPrice: prices.length ? Math.min(...prices) : null,
    averageSaving: savings.length ? Math.round(savings.reduce((sum, value) => sum + value, 0) / savings.length) : null,
    qingmaoLowestShare: completePlans.length ? Math.round((qingmaoLowestCount / completePlans.length) * 1000) / 10 : 0
  };
}

function buildHotelMetricsByGroup(hotels: HotelSample[], groups: HotelGroup[], rateLabels: string[]) {
  const planKeys = [DEFAULT_RATE_PLAN_KEY, ...rateLabels];

  return Object.fromEntries(
    groups.map((group) => {
      const groupHotels = hotels.filter((hotel) => hotel.group === group);
      return [
        group,
        Object.fromEntries(planKeys.map((planKey) => [planKey, summarizeHotelMetrics(groupHotels, planKey)]))
      ];
    })
  );
}

function safeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function formatNullableMoney(value: number | null, emptyLabel: string) {
  return typeof value === "number" ? `¥${Math.round(value)} 起` : emptyLabel;
}

function initialMetric(metrics: Record<string, Record<string, HotelMetricSummary>>, group: HotelGroup | undefined) {
  return group ? metrics[group]?.[DEFAULT_RATE_PLAN_KEY] ?? null : null;
}

function renderCompactRatePlan(ratePlan: HotelSample["ratePlans"][number]) {
  return `<div class="hotel-rate-mini">
    <strong>${escapeHtml(ratePlan.label)}</strong>
    ${PLATFORMS.map((platform) => {
      const quote = quoteByPlatform(ratePlan.quotes, platform);
      return `<span class="${PLATFORM_CLASS[platform]}">${escapeHtml(platform)} <b>${escapeHtml(formatHotelPrice(quote))}</b></span>`;
    }).join("")}
  </div>`;
}

function renderHotelCard(hotel: HotelSample, index: number) {
  const coverImage = hotel.coverImageStatus === "saved" && hotel.coverImagePath
    ? `<figure class="hotel-photo"><img src="../covers/${escapeHtml(hotel.id)}/hotel-cover.jpg" alt="${escapeHtml(hotel.hotelName)}酒店封面图" /><figcaption>${escapeHtml(hotel.brand)}</figcaption></figure>`
    : `<figure class="hotel-photo"><img src="../assets/hotel-photo.jpg" alt="${escapeHtml(hotel.hotelName)}酒店展示图" /><figcaption>${escapeHtml(hotel.brand)}</figcaption></figure>`;
  return `<article class="hotel-record">
    <div class="hotel-rank">${index + 1}</div>
    ${coverImage}
    <section class="hotel-content">
      ${hotel.ratePlans.map((ratePlan) => renderHotelPlanView(hotel, ratePlan.label)).join("")}
    </section>
  </article>`;
}

function renderHotelPlanView(hotel: HotelSample, activeLabel: string) {
  const primary = hotel.ratePlans.find((ratePlan) => ratePlan.label === activeLabel) ?? primaryRatePlan(hotel);
  const summary = summarizeQuoteSet(primary.quotes);
  const displayComparisonLabel = salesComparisonLabel(primary.quotes, summary);
  const secondaryPlans = hotel.ratePlans.filter((ratePlan) => ratePlan.label !== primary.label);
  const primaryQuotes = PLATFORMS.map((platform) => quoteByPlatform(primary.quotes, platform));
  const isDefault = primary.label === primaryRatePlan(hotel).label;

  return `<div class="hotel-plan-view${isDefault ? " active" : ""}" data-plan="${escapeHtml(primary.label)}" data-default="${isDefault ? "true" : "false"}">
      <header class="hotel-title-row">
        <div>
          <h2>${escapeHtml(hotel.hotelName)}</h2>
          <p>${escapeHtml(hotel.city)} · 入住 ${escapeHtml(hotel.checkInDate)} · 离店 ${escapeHtml(hotel.checkOutDate)} · ${hotel.nights} 间夜</p>
        </div>
        <strong class="saving ${gapClass(summary.qingmaoGap)}">${renderSavingBadge(summary.qingmaoGap, displayComparisonLabel)}</strong>
      </header>
      <div class="hotel-primary-row">
        <div class="room-type">${escapeHtml(primary.label)}</div>
        ${primaryQuotes
          .map((quote) => `<div class="hotel-platform-price ${quote ? PLATFORM_CLASS[quote.platform] : ""}">
            <span>${escapeHtml(quote?.platform ?? "平台")}</span>
            <strong>${escapeHtml(formatHotelPrice(quote))}</strong>
            ${quote && evidenceHref(quote.evidencePath) ? `<a href="${escapeHtml(evidenceHref(quote.evidencePath))}" target="_blank" rel="noreferrer">截图</a>` : ""}
          </div>`)
          .join("")}
      </div>
      <div class="hotel-rate-grid">${secondaryPlans.map(renderCompactRatePlan).join("")}</div>
    </div>`;
}

function renderHotels(batch: CollectionBatch) {
  const displayTime = formatDisplayTime(batch.generatedAt);
  const hotels = (batch.hotels ?? []).filter(hotelSalesDisplayEligible);
  const groups = GROUP_ORDER.filter((group) => hotels.some((hotel) => hotel.group === group));
  const defaultGroup = groups[0];
  const defaultHotels = hotels.filter((hotel) => hotel.group === defaultGroup);
  const checkIn = hotels[0]?.checkInDate ?? "";
  const checkOut = hotels[0]?.checkOutDate ?? "";
  const rateLabels = HOTEL_DISPLAY_RATE_PLAN_PRIORITY.filter((label) => hotels.some((hotel) => hotel.ratePlans.some((ratePlan) => ratePlan.label === label)));
  const hotelMetrics = buildHotelMetricsByGroup(hotels, groups, rateLabels);
  const firstMetric = initialMetric(hotelMetrics, defaultGroup);
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
          <button type="button" class="active" data-plan="__default">推荐口径</button>
          ${rateLabels.map((label) => `<button type="button" data-plan="${escapeHtml(label)}">${escapeHtml(label)}</button>`).join("")}
        </div>
      </div>
    </section>
    <section class="hotel-metrics">
      <div><span>酒店数量</span><strong data-metric="hotel-count">${firstMetric?.hotelCount ?? (defaultHotels.length || hotels.length)} 家</strong><small data-metric="coverage-note">当前集团可展示</small></div>
      <div><span>当前口径最低价</span><strong data-metric="lowest-price">${formatNullableMoney(firstMetric?.lowestPrice ?? null, "暂无完整价格")}</strong></div>
      <div><span>平均可节省</span><strong data-metric="average-saving">${formatNullableMoney(firstMetric?.averageSaving ?? null, "暂无优势")}</strong></div>
      <div><span>青猫最低占比</span><strong data-metric="qingmao-share">青猫差旅 ${firstMetric?.qingmaoLowestShare ?? 0}%</strong></div>
      <div><span>价格单位</span><strong>元 / 1 间夜</strong></div>
    </section>
    <p class="hotel-hint">以下价格为 1 间夜；系统优先展示当前最具价格优势且四平台可比的床型早餐口径，其他口径收在同一张卡片内。</p>
    ${panels}
    <footer class="hotel-footer">以上价格为平台可订最低价的展示结果，实际预订以各平台实时价格为准。</footer>
  </main>
  <script type="application/json" id="hotel-metrics-data">${safeJson(hotelMetrics)}</script>
  <script>
    const hotelMetrics = JSON.parse(document.getElementById('hotel-metrics-data')?.textContent || '{}');
    const buttons = Array.from(document.querySelectorAll('.hotel-tabs button'));
    const panels = Array.from(document.querySelectorAll('.hotel-group-panel'));
    const metricNodes = {
      hotelCount: document.querySelector('[data-metric="hotel-count"]'),
      lowestPrice: document.querySelector('[data-metric="lowest-price"]'),
      averageSaving: document.querySelector('[data-metric="average-saving"]'),
      qingmaoShare: document.querySelector('[data-metric="qingmao-share"]'),
      coverageNote: document.querySelector('[data-metric="coverage-note"]')
    };
    function moneyMetric(value, emptyLabel) {
      return typeof value === 'number' ? '¥' + Math.round(value) + ' 起' : emptyLabel;
    }
    function activeGroup() {
      return document.querySelector('.hotel-tabs button.active')?.dataset.group || '';
    }
    function activePlan() {
      return document.querySelector('.rate-selector button.active')?.dataset.plan || '${DEFAULT_RATE_PLAN_KEY}';
    }
    function updateHotelMetrics() {
      const group = activeGroup();
      const plan = activePlan();
      const metrics = hotelMetrics[group]?.[plan] || hotelMetrics[group]?.['${DEFAULT_RATE_PLAN_KEY}'];
      if (!metrics) return;
      metricNodes.hotelCount.textContent = metrics.hotelCount + ' 家';
      metricNodes.lowestPrice.textContent = moneyMetric(metrics.lowestPrice, '暂无完整价格');
      metricNodes.averageSaving.textContent = moneyMetric(metrics.averageSaving, '暂无优势');
      metricNodes.qingmaoShare.textContent = '青猫差旅 ' + metrics.qingmaoLowestShare + '%';
      metricNodes.coverageNote.textContent = plan === '${DEFAULT_RATE_PLAN_KEY}' ? '当前集团可展示' : '当前口径完整可比';
    }
    buttons.forEach(button => {
      button.addEventListener('click', () => {
        buttons.forEach(item => item.classList.remove('active'));
        panels.forEach(panel => panel.classList.remove('active'));
        button.classList.add('active');
        const target = button.dataset.group;
        panels.find(panel => panel.dataset.group === target)?.classList.add('active');
        updateHotelMetrics();
      });
    });
    const rateButtons = Array.from(document.querySelectorAll('.rate-selector button'));
    const planViews = Array.from(document.querySelectorAll('.hotel-plan-view'));
    rateButtons.forEach(button => {
      button.addEventListener('click', () => {
        rateButtons.forEach(item => item.classList.remove('active'));
        button.classList.add('active');
        const target = button.dataset.plan;
        planViews.forEach(view => {
          const useDefault = target === '${DEFAULT_RATE_PLAN_KEY}';
          view.classList.toggle('active', useDefault ? view.dataset.default === 'true' : view.dataset.plan === target);
        });
        updateHotelMetrics();
      });
    });
    updateHotelMetrics();
  </script>
</body>
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
    <text x="78" y="52" font-family="Arial,'PingFang SC',sans-serif" font-size="19" font-weight="700" fill="#647184">四种口径价格对比</text>
  </g>
</svg>`;
}

function renderBaseStyles() {
  return fs.readFileSync(path.join(STATIC_ASSET_DIR, "offline-base.css"), "utf8");
}

function renderLayoutFixStyles() {
  return `.evidence-link{display:inline-flex;align-items:center;justify-content:center;border:1px solid rgba(95,211,161,.36);border-radius:999px;padding:4px 10px;color:#d9f7ee;text-decoration:none;font-weight:900;font-size:12px}.evidence-link:hover{background:rgba(63,208,129,.14)}.hotel-platform-price a{display:inline-flex;margin-top:8px;border:1px solid rgba(16,35,63,.12);border-radius:999px;padding:4px 10px;color:#235d64;text-decoration:none;font-weight:900;font-size:12px}.flight-price-row{grid-template-columns:44px 112px 1fr 110px}.hotel-rate-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;align-items:stretch}.hotel-rate-mini{min-height:auto;padding:10px 12px}.hotel-rate-mini span{font-size:12px;line-height:1.35}.hotel-metrics small{display:block;margin-top:7px;color:#64748b;font-size:12px;font-weight:900}`;
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

async function materializeHotelCoverImages(batch: CollectionBatch, packageDir: string) {
  for (const hotel of batch.hotels ?? []) {
    if (hotel.coverImageStatus !== "saved" || !hotel.coverImagePath || !fs.existsSync(hotel.coverImagePath)) continue;
    const targetPath = path.join(packageDir, "covers", hotel.id, "hotel-cover.jpg");
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await fsp.copyFile(hotel.coverImagePath, targetPath);
  }
}

function allEvidencePaths(batch: CollectionBatch) {
  const paths = new Map<string, string>();
  for (const sample of batch.samples) {
    for (const quote of sample.quotes) {
      if (quote.evidencePath) paths.set(quote.evidencePath, (quote as PlatformQuote & { sourceEvidencePath?: string }).sourceEvidencePath ?? quote.evidencePath);
    }
  }
  for (const hotel of batch.hotels ?? []) {
    for (const ratePlan of hotel.ratePlans) {
      for (const quote of ratePlan.quotes) {
        if (quote.evidencePath) paths.set(quote.evidencePath, (quote as PlatformQuote & { sourceEvidencePath?: string }).sourceEvidencePath ?? quote.evidencePath);
      }
    }
  }
  return [...paths.entries()].map(([targetPath, sourcePath]) => ({ targetPath, sourcePath }));
}

async function materializeEvidenceFiles(batch: CollectionBatch, packageDir: string) {
  const projectRoot = process.cwd();
  for (const evidence of allEvidencePaths(batch)) {
    if (evidence.targetPath.startsWith("http://") || evidence.targetPath.startsWith("https://") || evidence.targetPath.startsWith("file://")) continue;
    const sourcePath = path.isAbsolute(evidence.sourcePath) ? evidence.sourcePath : path.join(projectRoot, evidence.sourcePath);
    if (!fs.existsSync(sourcePath)) continue;
    const targetPath = path.join(packageDir, evidence.targetPath);
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await fsp.copyFile(sourcePath, targetPath);
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
  await fsp.mkdir(path.join(packageDir, "covers"), { recursive: true });

  await writeFileEnsured(path.join(packageDir, "assets", "styles.css"), renderStyles());
  await copyStaticAsset(packageDir, "flight-photo.jpg");
  await copyStaticAsset(packageDir, "hotel-photo.jpg");
  await writeFileEnsured(path.join(packageDir, "index.html"), renderIndex(batch));
  await writeFileEnsured(path.join(packageDir, "flights", "index.html"), renderFlights(batch));
  await writeFileEnsured(path.join(packageDir, "hotels", "index.html"), renderHotels(batch));
  await materializeHotelCoverImages(batch, packageDir);
  if (INCLUDE_EVIDENCE_IN_SALES_PACKAGE) {
    await materializeEvidenceFiles(batch, packageDir);
  }

  await zipExec("zip", ["-qr", zipPath, packageName], { cwd: outputDir });

  return {
    path: zipPath,
    filename,
    directory: packageDir
  };
}
