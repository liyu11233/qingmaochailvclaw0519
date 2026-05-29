import type { CollectionBatch, FlightSample, HotelGroup, HotelRatePlan, HotelRatePlanLabel, HotelSample, PlatformName, PlatformQuote, RouteConfig } from "./types";
import { enrichHotelSampleDisplayDecision } from "./hotelRatePlans";

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
  { id: "intl-fallback-14", scope: "国际", origin: "深圳", destination: "胡志明市", directRule: "优先直飞" },
  { id: "intl-fallback-15", scope: "国际", origin: "广州", destination: "首尔", directRule: "优先直飞" },
  { id: "intl-fallback-16", scope: "国际", origin: "广州", destination: "东京", directRule: "优先直飞" },
  { id: "intl-fallback-17", scope: "国际", origin: "深圳", destination: "大阪", directRule: "优先直飞" },
  { id: "intl-fallback-18", scope: "国际", origin: "上海", destination: "新加坡", directRule: "优先直飞" },
  { id: "intl-fallback-19", scope: "国际", origin: "上海", destination: "大阪", directRule: "优先直飞" },
  { id: "intl-fallback-20", scope: "国际", origin: "上海", destination: "吉隆坡", directRule: "优先直飞" },
  { id: "intl-fallback-21", scope: "国际", origin: "北京", destination: "新加坡", directRule: "优先直飞" },
  { id: "intl-fallback-22", scope: "国际", origin: "北京", destination: "大阪", directRule: "优先直飞" },
  { id: "intl-fallback-23", scope: "国际", origin: "杭州", destination: "大阪", directRule: "优先直飞" },
  { id: "intl-fallback-24", scope: "国际", origin: "杭州", destination: "曼谷", directRule: "优先直飞" },
  { id: "intl-fallback-25", scope: "国际", origin: "杭州", destination: "新加坡", directRule: "优先直飞" },
  { id: "intl-fallback-26", scope: "国际", origin: "成都", destination: "曼谷", directRule: "优先直飞" },
  { id: "intl-fallback-27", scope: "国际", origin: "成都", destination: "新加坡", directRule: "优先直飞" },
  { id: "intl-fallback-28", scope: "国际", origin: "厦门", destination: "曼谷", directRule: "优先直飞" },
  { id: "intl-fallback-29", scope: "国际", origin: "厦门", destination: "新加坡", directRule: "优先直飞" },
  { id: "intl-fallback-30", scope: "国际", origin: "南京", destination: "首尔", directRule: "优先直飞" },
  { id: "intl-fallback-31", scope: "国际", origin: "南京", destination: "东京", directRule: "优先直飞" },
  { id: "intl-fallback-32", scope: "国际", origin: "深圳", destination: "马尼拉", directRule: "优先直飞" },
  { id: "intl-fallback-33", scope: "国际", origin: "深圳", destination: "吉隆坡", directRule: "优先直飞" },
  { id: "intl-fallback-34", scope: "国际", origin: "上海", destination: "马尼拉", directRule: "优先直飞" },
  { id: "intl-fallback-35", scope: "国际", origin: "上海", destination: "胡志明市", directRule: "优先直飞" },
  { id: "intl-fallback-36", scope: "国际", origin: "北京", destination: "马尼拉", directRule: "优先直飞" },
  { id: "intl-fallback-37", scope: "国际", origin: "广州", destination: "雅加达", directRule: "优先直飞" },
  { id: "intl-fallback-38", scope: "国际", origin: "广州", destination: "普吉", directRule: "优先直飞" },
  { id: "intl-fallback-39", scope: "国际", origin: "广州", destination: "金边", directRule: "优先直飞" },
  { id: "intl-fallback-40", scope: "国际", origin: "杭州", destination: "马尼拉", directRule: "优先直飞" },
  { id: "intl-fallback-41", scope: "国际", origin: "杭州", destination: "吉隆坡", directRule: "优先直飞" },
  { id: "intl-fallback-42", scope: "国际", origin: "厦门", destination: "马尼拉", directRule: "优先直飞" },
  { id: "intl-fallback-43", scope: "国际", origin: "厦门", destination: "吉隆坡", directRule: "优先直飞" },
  { id: "intl-fallback-44", scope: "国际", origin: "南京", destination: "新加坡", directRule: "优先直飞" },
  { id: "intl-fallback-45", scope: "国际", origin: "南京", destination: "曼谷", directRule: "优先直飞" },
  { id: "intl-fallback-46", scope: "国际", origin: "福州", destination: "新加坡", directRule: "优先直飞" },
  { id: "intl-fallback-47", scope: "国际", origin: "福州", destination: "曼谷", directRule: "优先直飞" },
  { id: "intl-fallback-48", scope: "国际", origin: "青岛", destination: "首尔", directRule: "优先直飞" },
  { id: "intl-fallback-49", scope: "国际", origin: "青岛", destination: "大阪", directRule: "优先直飞" },
  { id: "intl-repeat-01", scope: "国际", origin: "广州", destination: "洛杉矶", directRule: "优先直飞" },
  { id: "intl-repeat-02", scope: "国际", origin: "深圳", destination: "新加坡", directRule: "优先直飞" },
  { id: "intl-repeat-03", scope: "国际", origin: "杭州", destination: "新加坡", directRule: "优先直飞" },
  { id: "intl-repeat-04", scope: "国际", origin: "厦门", destination: "曼谷", directRule: "优先直飞" },
  { id: "intl-repeat-05", scope: "国际", origin: "上海", destination: "胡志明市", directRule: "优先直飞" },
  { id: "intl-repeat-06", scope: "国际", origin: "广州", destination: "洛杉矶", directRule: "优先直飞" },
  { id: "intl-repeat-07", scope: "国际", origin: "深圳", destination: "新加坡", directRule: "优先直飞" },
  { id: "intl-repeat-08", scope: "国际", origin: "杭州", destination: "新加坡", directRule: "优先直飞" },
  { id: "intl-repeat-09", scope: "国际", origin: "厦门", destination: "曼谷", directRule: "优先直飞" },
  { id: "intl-repeat-10", scope: "国际", origin: "上海", destination: "胡志明市", directRule: "优先直飞" }
];

export const DOMESTIC_FALLBACK_ROUTES: RouteConfig[] = [
  { id: "dom-fallback-01", scope: "国内", origin: "上海", destination: "广州", directRule: "直飞" },
  { id: "dom-fallback-02", scope: "国内", origin: "北京", destination: "上海", directRule: "直飞" },
  { id: "dom-fallback-03", scope: "国内", origin: "上海", destination: "深圳", directRule: "直飞" },
  { id: "dom-fallback-04", scope: "国内", origin: "杭州", destination: "广州", directRule: "直飞" },
  { id: "dom-fallback-05", scope: "国内", origin: "上海", destination: "成都", directRule: "直飞" },
  { id: "dom-fallback-06", scope: "国内", origin: "深圳", destination: "北京", directRule: "直飞" },
  { id: "dom-fallback-07", scope: "国内", origin: "南京", destination: "广州", directRule: "直飞" },
  { id: "dom-fallback-08", scope: "国内", origin: "福州", destination: "北京", directRule: "直飞" },
  { id: "dom-fallback-09", scope: "国内", origin: "上海", destination: "厦门", directRule: "直飞" },
  { id: "dom-fallback-10", scope: "国内", origin: "成都", destination: "广州", directRule: "直飞" }
];

const AIRLINES = ["南方航空", "中国国航", "东方航空", "深圳航空", "海南航空", "四川航空"];
const INTL_AIRLINES = ["泰国国际航空", "越南航空", "亚洲航空", "韩亚航空", "中国国航", "美国联合航空"];
const PLATFORMS: PlatformName[] = ["青猫差旅", "携程商旅", "阿里商旅", "在途商旅"];
const PLATFORM_VERIFY_URLS: Record<PlatformName, string> = {
  青猫差旅: "",
  携程商旅: "https://ct.ctrip.com/",
  阿里商旅: "https://www.alibtrip.com/alibtrip",
  在途商旅: "https://www.z-trip.cn/v/vcommon/home"
};

function platformSlug(platform: PlatformName) {
  const slugs: Record<PlatformName, string> = {
    青猫差旅: "qingmao",
    携程商旅: "ctrip",
    阿里商旅: "alibtrip",
    在途商旅: "ztrip"
  };
  return slugs[platform];
}

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
    index % 5 === 0 ? 46 : index % 5 === 1 ? 0 : -22,
    index % 2 === 0 ? 68 : 36
  ];

  return PLATFORMS.map((platform, platformIndex) => {
    return {
      platform,
      price: Math.max(280, basePrice + deltas[platformIndex]),
      refundRule: platformIndex === 0 ? "退改¥180起，按航司规则执行" : "退改¥160起，免费托运20kg",
      baggageRule: "20kg托运行李，随身行李1件",
      available: true,
      status: "可订",
      evidencePath: `evidence/flights/${sampleId}-${platformSlug(platform)}.html`,
      sourceUrl: PLATFORM_VERIFY_URLS[platform]
    };
  });
}

const HOTEL_GROUPS: Array<{ group: HotelGroup; brands: string[] }> = [
  { group: "如家集团", brands: ["如家酒店", "莫泰", "YUNIK", "艾扉", "驿居", "璞隐", "扉缦", "和颐至尚"] },
  { group: "锦江集团", brands: ["锦江之星", "锦江都城", "维也纳", "丽枫", "希岸", "喆啡", "7天酒店", "凯里亚德"] },
  { group: "华住集团", brands: ["汉庭", "全季", "桔子", "星程", "漫心", "禧玥", "美仑", "海友"] },
  { group: "东呈集团", brands: ["城市便捷", "宜尚", "柏曼", "精途", "怡程", "璞程", "城市精选", "隐沫"] },
  { group: "亚朵集团", brands: ["亚朵酒店"] }
];

const HOTEL_CITIES = ["北京", "广州", "杭州", "上海", "深圳", "武汉", "佛山", "成都", "厦门"];
const HOTEL_RATE_LABELS: HotelRatePlanLabel[] = ["大床无早餐", "大床有早餐", "双床无早餐", "双床有早餐"];

function buildHotelQuotes(hotelId: string, rateLabel: HotelRatePlanLabel, basePrice: number, index: number): PlatformQuote[] {
  const rateOffset = HOTEL_RATE_LABELS.indexOf(rateLabel) * 18;
  const deltas = [-12, 16, 28, 8];

  return PLATFORMS.map((platform, platformIndex) => ({
    platform,
    price: basePrice + rateOffset + deltas[platformIndex],
    refundRule: rateLabel.includes("无早餐") ? "不含早餐，以平台页面为准" : "含早餐，以平台页面为准",
    baggageRule: "酒店房型口径，无行李规则",
    available: true,
    status: "可订",
    evidencePath: `evidence/hotels/${hotelId}-${platformSlug(platform)}-${HOTEL_RATE_LABELS.indexOf(rateLabel) + 1}.html`,
    sourceUrl: PLATFORM_VERIFY_URLS[platform],
    rawRoomName: `${platform}${rateLabel}房`,
    normalizedRoomLabel: rateLabel
  }));
}

function buildHotelDemoData(now: Date): HotelSample[] {
  const checkInDate = formatDate(addDays(now, 1));
  const checkOutDate = formatDate(addDays(now, 2));

  return HOTEL_GROUPS.flatMap(({ group, brands }, groupIndex) =>
    Array.from({ length: 8 }, (_, brandIndex) => {
      const brand = brands[brandIndex % brands.length];
      const hotelIndex = groupIndex * 8 + brandIndex;
      const id = `hotel-${String(hotelIndex + 1).padStart(2, "0")}`;
      const city = HOTEL_CITIES[hotelIndex % HOTEL_CITIES.length];
      const basePrice = 260 + groupIndex * 22 + brandIndex * 9;
      const ratePlans: HotelRatePlan[] = HOTEL_RATE_LABELS.map((label) => ({
        label,
        quotes: buildHotelQuotes(id, label, basePrice, hotelIndex).map((quote) => ({
          ...quote,
          rawHotelName: `${brand}${city}中心店`
        }))
      }));

      return enrichHotelSampleDisplayDecision({
        id,
        group,
        brand,
        hotelName: `${brand}${city}中心店`,
        city,
        checkInDate,
        checkOutDate,
        nights: 1,
        primaryRatePlan: "大床有早餐",
        ratePlans
      });
    })
  );
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
    samples,
    hotels: buildHotelDemoData(now)
  };
}
