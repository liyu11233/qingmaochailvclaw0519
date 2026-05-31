import { summarizeFlight, summarizeQuoteSet } from "../domain/comparison";
import { analyzeHotelRatePlanCompleteness, resolveHotelDisplayDecision, resolveHotelPrimaryRatePlan } from "../domain/hotelRatePlans";
import type { CollectionBatch, FlightSample, HotelRatePlan, HotelSample, PlatformName, PlatformQuote } from "../domain/types";

export interface ArtifactLinks {
  excel: string;
  offlinePackage: string;
}

export const comparisonPlatforms: PlatformName[] = ["青猫差旅", "携程商旅", "阿里商旅", "在途商旅"];

export interface QuoteView {
  platform: PlatformQuote["platform"];
  priceLabel: string;
  status: PlatformQuote["status"];
  evidencePath: string;
  isQingmao: boolean;
  available: boolean;
}

export interface SampleView {
  id: string;
  scope: FlightSample["scope"];
  routeLabel: string;
  travelDate: string;
  flightNo: string;
  airline: string;
  cabin: FlightSample["cabin"];
  directType: FlightSample["directType"];
  transferLabel: string;
  durationLabel: string;
  quotes: QuoteView[];
  lowestPlatform: string;
  qingmaoGap: number | null;
  gapLabel: string;
  gapTone: "advantage" | "neutral" | "higher" | "unknown";
  conclusion: string;
}

export interface HotelView {
  id: string;
  group: HotelSample["group"];
  brand: string;
  hotelName: string;
  city: string;
  stayLabel: string;
  nightsLabel: string;
  primaryRatePlanLabel: string;
  completeRatePlanCount: number;
  salesDisplayEligible: boolean;
  salesDisplayReason: string;
  quotes: QuoteView[];
  lowestPlatform: string;
  qingmaoGap: number | null;
  gapLabel: string;
  gapTone: SampleView["gapTone"];
  conclusion: string;
}

export interface DashboardView {
  batchId: string;
  generatedAt: string;
  sampleCount: number;
  successCount: number;
  failedCount: number;
  domesticCount: number;
  internationalCount: number;
  advantageCount: number;
  neutralCount: number;
  notHigherThanLowestCount: number;
  higherThanLowestCount: number;
  flightCount: number;
  hotelCount: number;
  hotelAdvantageCount: number;
  hotelHigherThanLowestCount: number;
  evidenceCount: number;
  failureNotes: string[];
  samples: SampleView[];
  hotels: HotelView[];
}

const moneyFormatter = new Intl.NumberFormat("zh-CN");

export function formatMoney(value: number | null, fallback = "暂无价格") {
  return typeof value === "number" ? `¥${moneyFormatter.format(value)}` : fallback;
}

export function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}小时${rest}分` : `${rest}分`;
}

function gapTone(gap: number | null): SampleView["gapTone"] {
  if (gap === null) return "unknown";
  if (gap < 0) return "advantage";
  if (gap === 0) return "neutral";
  return "higher";
}

function quoteByPlatform(quotes: PlatformQuote[], platform: PlatformName) {
  return quotes.find((quote) => quote.platform === platform);
}

function buildQuoteView(quotes: PlatformQuote[], platform: PlatformName): QuoteView {
  const quote = quoteByPlatform(quotes, platform);

  return {
    platform,
    priceLabel: quote ? formatMoney(quote.price, quote.status) : "采集失败",
    status: quote?.status ?? "采集失败",
    evidencePath: quote?.evidencePath ?? "",
    isQingmao: platform === "青猫差旅",
    available: quote?.available ?? false
  };
}

export function buildSampleView(sample: FlightSample): SampleView {
  const summary = summarizeFlight(sample);
  const transferLabel = sample.directType === "中转" && sample.transferCity ? `中转${sample.transferCity}` : sample.directType;

  return {
    id: sample.id,
    scope: sample.scope,
    routeLabel: `${sample.origin}-${sample.destination}`,
    travelDate: sample.travelDate,
    flightNo: sample.flightNo,
    airline: sample.airline,
    cabin: sample.cabin,
    directType: sample.directType,
    transferLabel,
    durationLabel: formatDuration(sample.durationMinutes),
    quotes: comparisonPlatforms.map((platform) => buildQuoteView(sample.quotes, platform)),
    lowestPlatform: summary.lowestPlatform || "无",
    qingmaoGap: summary.qingmaoGap,
    gapLabel: summary.comparisonLabel,
    gapTone: gapTone(summary.qingmaoGap),
    conclusion: summary.conclusion
  };
}

function fallbackRatePlan(): HotelRatePlan {
  return {
    label: "大床有早餐",
    quotes: []
  };
}

export function buildHotelView(hotel: HotelSample): HotelView {
  const primary = resolveHotelPrimaryRatePlan(hotel) ?? fallbackRatePlan();
  const displayDecision = resolveHotelDisplayDecision(hotel.ratePlans);
  const completeness = analyzeHotelRatePlanCompleteness(primary);
  const summary = summarizeQuoteSet(primary.quotes);
  const completeRatePlanCount = hotel.completeRatePlanCount ?? displayDecision.completeRatePlanCount;

  return {
    id: hotel.id,
    group: hotel.group,
    brand: hotel.brand,
    hotelName: hotel.hotelName,
    city: hotel.city,
    stayLabel: `${hotel.checkInDate} 至 ${hotel.checkOutDate}`,
    nightsLabel: `${hotel.nights} 间夜`,
    primaryRatePlanLabel: primary.label,
    completeRatePlanCount,
    salesDisplayEligible: hotel.salesDisplayEligible ?? displayDecision.salesDisplayEligible,
    salesDisplayReason: hotel.salesDisplayReason ?? displayDecision.salesDisplayReason,
    quotes: comparisonPlatforms.map((platform) => buildQuoteView(primary.quotes, platform)),
    lowestPlatform: summary.lowestPlatform || "无",
    qingmaoGap: summary.qingmaoGap,
    gapLabel: summary.comparisonLabel,
    gapTone: gapTone(summary.qingmaoGap),
    conclusion: completeness.isFourPlatformComplete ? summary.conclusion : `${primary.label}当前只有 ${completeness.pricedPlatformCount} 个平台有可比价格。`
  };
}

export function buildDashboardView(batch: CollectionBatch): DashboardView {
  const samples = batch.samples.map(buildSampleView);
  const hotels = (batch.hotels ?? []).map(buildHotelView);

  return {
    batchId: batch.id,
    generatedAt: batch.generatedAt,
    sampleCount: batch.sampleCount,
    successCount: batch.successCount,
    failedCount: batch.failedCount,
    domesticCount: samples.filter((sample) => sample.scope === "国内").length,
    internationalCount: samples.filter((sample) => sample.scope === "国际").length,
    advantageCount: samples.filter((sample) => sample.gapTone === "advantage").length,
    neutralCount: samples.filter((sample) => sample.gapTone === "neutral").length,
    notHigherThanLowestCount: samples.filter((sample) => sample.qingmaoGap !== null && sample.qingmaoGap <= 0).length,
    higherThanLowestCount: samples.filter((sample) => sample.qingmaoGap !== null && sample.qingmaoGap > 0).length,
    flightCount: samples.length,
    hotelCount: hotels.length,
    hotelAdvantageCount: hotels.filter((hotel) => hotel.gapTone === "advantage").length,
    hotelHigherThanLowestCount: hotels.filter((hotel) => hotel.gapTone === "higher").length,
    evidenceCount: samples.reduce((count, sample) => count + sample.quotes.filter((quote) => quote.evidencePath).length, 0)
      + hotels.reduce((count, hotel) => count + hotel.quotes.filter((quote) => quote.evidencePath).length, 0),
    failureNotes: batch.failureNotes ?? [],
    samples,
    hotels
  };
}
