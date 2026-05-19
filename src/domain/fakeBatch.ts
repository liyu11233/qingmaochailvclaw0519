import type { CollectionBatch, FlightSample, PlatformName, PlatformQuote, RouteConfig } from "./types";

export const FIXED_ROUTES: RouteConfig[] = [
  { id: "dom-01", scope: "国内", origin: "广州", destination: "上海", directRule: "直飞" },
  { id: "dom-02", scope: "国内", origin: "广州", destination: "北京", directRule: "直飞" },
  { id: "dom-03", scope: "国内", origin: "广州", destination: "成都", directRule: "直飞" },
  { id: "dom-04", scope: "国内", origin: "广州", destination: "杭州", directRule: "直飞" },
  { id: "dom-05", scope: "国内", origin: "广州", destination: "青岛", directRule: "直飞" },
  { id: "dom-06", scope: "国内", origin: "深圳", destination: "上海", directRule: "直飞" },
  { id: "dom-07", scope: "国内", origin: "北京", destination: "成都", directRule: "直飞" },
  { id: "dom-08", scope: "国内", origin: "成都", destination: "南京", directRule: "直飞" },
  { id: "dom-09", scope: "国内", origin: "厦门", destination: "上海", directRule: "直飞" },
  { id: "dom-10", scope: "国内", origin: "北京", destination: "福州", directRule: "直飞" },
  { id: "intl-01", scope: "国际", origin: "广州", destination: "曼谷", directRule: "优先直飞" },
  { id: "intl-02", scope: "国际", origin: "深圳", destination: "曼谷", directRule: "优先直飞" },
  { id: "intl-03", scope: "国际", origin: "广州", destination: "河内", directRule: "优先直飞" },
  { id: "intl-04", scope: "国际", origin: "深圳", destination: "河内", directRule: "优先直飞" },
  { id: "intl-05", scope: "国际", origin: "广州", destination: "胡志明市", directRule: "优先直飞" },
  { id: "intl-06", scope: "国际", origin: "广州", destination: "吉隆坡", directRule: "优先直飞" },
  { id: "intl-07", scope: "国际", origin: "深圳", destination: "首尔", directRule: "优先直飞" },
  { id: "intl-08", scope: "国际", origin: "杭州", destination: "东京", directRule: "优先直飞" },
  { id: "intl-09", scope: "国际", origin: "广州", destination: "洛杉矶", directRule: "优先直飞" },
  { id: "intl-10", scope: "国际", origin: "深圳", destination: "洛杉矶", directRule: "优先直飞" }
];

export const INTERNATIONAL_FALLBACK_ROUTES: RouteConfig[] = [
  { id: "intl-fallback-01", scope: "国际", origin: "广州", destination: "新加坡", directRule: "优先直飞" },
  { id: "intl-fallback-02", scope: "国际", origin: "深圳", destination: "新加坡", directRule: "优先直飞" },
  { id: "intl-fallback-03", scope: "国际", origin: "广州", destination: "大阪", directRule: "优先直飞" },
  { id: "intl-fallback-04", scope: "国际", origin: "上海", destination: "东京", directRule: "优先直飞" },
  { id: "intl-fallback-05", scope: "国际", origin: "上海", destination: "首尔", directRule: "优先直飞" },
  { id: "intl-fallback-06", scope: "国际", origin: "北京", destination: "东京", directRule: "优先直飞" },
  { id: "intl-fallback-07", scope: "国际", origin: "北京", destination: "首尔", directRule: "优先直飞" },
  { id: "intl-fallback-08", scope: "国际", origin: "上海", destination: "曼谷", directRule: "优先直飞" },
  { id: "intl-fallback-09", scope: "国际", origin: "北京", destination: "曼谷", directRule: "优先直飞" },
  { id: "intl-fallback-10", scope: "国际", origin: "广州", destination: "悉尼", directRule: "优先直飞" },
  { id: "intl-fallback-11", scope: "国际", origin: "深圳", destination: "东京", directRule: "优先直飞" },
  { id: "intl-fallback-12", scope: "国际", origin: "杭州", destination: "首尔", directRule: "优先直飞" },
  { id: "intl-fallback-13", scope: "国际", origin: "广州", destination: "马尼拉", directRule: "优先直飞" },
  { id: "intl-fallback-14", scope: "国际", origin: "深圳", destination: "胡志明市", directRule: "优先直飞" }
];

const AIRLINES = ["南方航空", "中国国航", "东方航空", "深圳航空", "海南航空", "四川航空"];
const INTL_AIRLINES = ["泰国国际航空", "越南航空", "亚洲航空", "韩亚航空", "中国国航", "美国联合航空"];
const PLATFORMS: PlatformName[] = ["青猫差旅", "携程商旅", "阿里商旅"];
const PLATFORM_VERIFY_URLS: Record<PlatformName, string> = {
  青猫差旅: "",
  携程商旅: "https://ct.ctrip.com/",
  阿里商旅: "https://www.alibtrip.com/alibtrip"
};

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatBatchTimestamp(date: Date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${formatDate(date)}-${hours}${minutes}${seconds}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function buildFlightNo(route: RouteConfig, index: number) {
  const prefix = route.scope === "国内" ? ["CZ", "CA", "MU", "ZH"][index % 4] : ["TG", "VN", "AK", "OZ", "CA"][index % 5];
  return `${prefix}${String(3100 + index * 37).slice(0, 4)}`;
}

function buildQuotes(sampleId: string, basePrice: number, index: number): PlatformQuote[] {
  const deltas = [
    index % 4 === 0 ? -35 : index % 4 === 1 ? 0 : index % 4 === 2 ? 42 : 18,
    index % 3 === 0 ? 28 : index % 3 === 1 ? -18 : 55,
    index % 5 === 0 ? 46 : index % 5 === 1 ? 0 : -22
  ];

  return PLATFORMS.map((platform, platformIndex) => {
    const missingAli = platform === "阿里商旅" && index % 11 === 0;
    return {
      platform,
      price: missingAli ? null : Math.max(280, basePrice + deltas[platformIndex]),
      refundRule: missingAli ? "无同航班退改规则" : platformIndex === 0 ? "退改¥180起，按航司规则执行" : "退改¥160起，免费托运20kg",
      baggageRule: missingAli ? "无同航班行李规则" : "20kg托运行李，随身行李1件",
      available: !missingAli,
      status: missingAli ? "无同航班" : "可订",
      evidencePath: `screenshots/${sampleId}-${platformIndex + 1}.svg`,
      sourceUrl: PLATFORM_VERIFY_URLS[platform]
    };
  });
}

export function buildFakeBatch(now = new Date()): CollectionBatch {
  const travelDate = formatDate(addDays(now, 3));
  const samples: FlightSample[] = FIXED_ROUTES.map((route, index) => {
    const isInternational = route.scope === "国际";
    const basePrice = isInternational ? 980 + index * 235 : 430 + index * 38;
    const directType = isInternational && index % 6 === 0 ? "中转" : "直飞";
    const sampleId = `flight-${String(index + 1).padStart(2, "0")}`;

    return {
      id: sampleId,
      routeId: route.id,
      scope: route.scope,
      origin: route.origin,
      destination: route.destination,
      travelDate,
      flightNo: buildFlightNo(route, index),
      airline: isInternational ? INTL_AIRLINES[index % INTL_AIRLINES.length] : AIRLINES[index % AIRLINES.length],
      cabin: "经济舱",
      directType,
      transferCity: directType === "中转" ? "香港" : "",
      durationMinutes: isInternational ? 190 + index * 27 : 110 + index * 8,
      quotes: buildQuotes(sampleId, basePrice, index)
    };
  });

  return {
    id: `batch-${formatBatchTimestamp(now)}-demo`,
    status: "ready",
    generatedAt: now.toISOString(),
    sampleCount: samples.length,
    successCount: samples.length,
    failedCount: 0,
    samples
  };
}
