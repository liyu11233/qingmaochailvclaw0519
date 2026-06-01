import { resolveHotelPrimaryRatePlan } from "./hotelRatePlans";
import type { CollectionBatch, CompetitorPlatformName, ComparisonMode, FlightSample, HotelSample, PlatformName, PlatformQuote } from "./types";

export type ThirdVersionGenerationMode = "real_random" | "qingmao_advantage";
export type ThirdVersionComparisonMode = ComparisonMode;
export type ThirdVersionExportPrefix = "【青】" | "【随】";
export type ThirdVersionExportStatus = "达标" | "未达标" | "未满量" | "未满量未达标";

export interface ThirdVersionStrategyOptions {
  hotelDisplayLimit: number;
  flightDisplayLimit: number;
  generationMode: ThirdVersionGenerationMode;
  targetAdvantageRatio: number;
  comparisonMode: ThirdVersionComparisonMode;
  specifiedPlatform?: CompetitorPlatformName;
}

export interface ThirdVersionStrategyRuntime {
  random?: () => number;
}

export interface ThirdVersionExportNameInput {
  exportPrefix: ThirdVersionExportPrefix;
  hotelDisplayed: number;
  flightDisplayed: number;
  exportStatus: ThirdVersionExportStatus;
  exportAdvantageRatio: number;
}

export interface ThirdVersionBatchStatus {
  rawHotelCandidates: number;
  rawFlightCandidates: number;
  hotelStrategyCandidateLimit: number;
  flightStrategyCandidateLimit: number;
  hotelStrategyCandidates: number;
  flightStrategyCandidates: number;
  hotelDisplayed: number;
  flightDisplayed: number;
  hotelDisplayLimit: number;
  flightDisplayLimit: number;
  hotelAdvantageCount: number;
  flightAdvantageCount: number;
  hotelAdvantageDenominator: number;
  flightAdvantageDenominator: number;
  hotelAdvantageRatio: number;
  flightAdvantageRatio: number;
  hotelTargetMet: boolean;
  flightTargetMet: boolean;
  hotelFull: boolean;
  flightFull: boolean;
  exportPrefix: ThirdVersionExportPrefix;
  exportStatus: ThirdVersionExportStatus;
  exportAdvantageRatio: number;
  exportBaseName: string;
  exportNamePreview: string;
  failureReasons: string[];
}

export interface ThirdVersionStrategyResult {
  options: ThirdVersionStrategyOptions;
  flights: FlightSample[];
  hotels: HotelSample[];
  status: ThirdVersionBatchStatus;
}

export interface ThirdVersionFullCollectionLimits {
  flightCandidateLimit?: number;
  hotelCandidateLimit?: number;
}

export interface ThirdVersionPlatformRegressionPlatform {
  platform: PlatformName;
  rawFlightQuoteCount: number;
  rawHotelQuoteCount: number;
  pricedCount: number;
  failureReasonCount: number;
  evidenceCount: number;
  priceOrFailureCount: number;
}

export interface ThirdVersionPlatformRegressionReport {
  passed: boolean;
  platforms: ThirdVersionPlatformRegressionPlatform[];
  notes: string[];
}

export const DEFAULT_THIRD_VERSION_OPTIONS: ThirdVersionStrategyOptions = {
  hotelDisplayLimit: 40,
  flightDisplayLimit: 20,
  generationMode: "real_random",
  targetAdvantageRatio: 70,
  comparisonMode: "internal_discussion"
};

const COMPETITOR_PLATFORMS: CompetitorPlatformName[] = ["携程商旅", "阿里商旅", "在途商旅"];

function positiveInteger(value: number, fallback: number) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function clampRatio(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_THIRD_VERSION_OPTIONS.targetAdvantageRatio;
  return Math.min(100, Math.max(0, value));
}

export function normalizeThirdVersionOptions(options: Partial<ThirdVersionStrategyOptions> = {}): ThirdVersionStrategyOptions {
  const comparisonMode = options.comparisonMode ?? DEFAULT_THIRD_VERSION_OPTIONS.comparisonMode;
  const specifiedPlatform =
    comparisonMode === "specified_platform" && options.specifiedPlatform && COMPETITOR_PLATFORMS.includes(options.specifiedPlatform)
      ? options.specifiedPlatform
      : undefined;

  return {
    hotelDisplayLimit: positiveInteger(options.hotelDisplayLimit ?? DEFAULT_THIRD_VERSION_OPTIONS.hotelDisplayLimit, DEFAULT_THIRD_VERSION_OPTIONS.hotelDisplayLimit),
    flightDisplayLimit: positiveInteger(options.flightDisplayLimit ?? DEFAULT_THIRD_VERSION_OPTIONS.flightDisplayLimit, DEFAULT_THIRD_VERSION_OPTIONS.flightDisplayLimit),
    generationMode: options.generationMode ?? DEFAULT_THIRD_VERSION_OPTIONS.generationMode,
    targetAdvantageRatio: clampRatio(options.targetAdvantageRatio ?? DEFAULT_THIRD_VERSION_OPTIONS.targetAdvantageRatio),
    comparisonMode,
    specifiedPlatform
  };
}

function availablePrice(quote: PlatformQuote | undefined) {
  return quote?.available && typeof quote.price === "number" ? quote.price : null;
}

function quoteByPlatform(quotes: PlatformQuote[], platform: PlatformName) {
  return quotes.find((quote) => quote.platform === platform);
}

function competitorPrices(quotes: PlatformQuote[], options: ThirdVersionStrategyOptions) {
  const platforms =
    options.comparisonMode === "specified_platform" && options.specifiedPlatform
      ? [options.specifiedPlatform]
      : COMPETITOR_PLATFORMS;

  return platforms
    .map((platform) => availablePrice(quoteByPlatform(quotes, platform)))
    .filter((price): price is number => typeof price === "number");
}

function qingmaoAdvantageState(quotes: PlatformQuote[], options: ThirdVersionStrategyOptions) {
  const qingmaoPrice = availablePrice(quoteByPlatform(quotes, "青猫差旅"));
  const competitors = competitorPrices(quotes, options);

  if (typeof qingmaoPrice !== "number" || competitors.length === 0) {
    return null;
  }

  const averageCompetitorPrice = competitors.reduce((sum, price) => sum + price, 0) / competitors.length;
  return qingmaoPrice < averageCompetitorPrice;
}

function hotelComparisonQuotes(hotel: HotelSample) {
  return resolveHotelPrimaryRatePlan(hotel)?.quotes ?? hotel.ratePlans[0]?.quotes ?? [];
}

function isHotelSelectable(hotel: HotelSample) {
  return hotel.salesDisplayEligible !== false && hotel.ratePlans.length > 0;
}

function shuffle<T>(items: T[], random: () => number) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function selectRealRandom<T>(items: T[], limit: number, random: () => number) {
  return shuffle(items, random).slice(0, limit);
}

function selectAdvantageFirst<T>(items: T[], limit: number, random: () => number, isAdvantage: (item: T) => boolean) {
  const advantageItems = items.filter(isAdvantage);
  const otherItems = items.filter((item) => !isAdvantage(item));
  return [...shuffle(advantageItems, random), ...shuffle(otherItems, random)].slice(0, limit);
}

function strategyCandidateLimit(mode: ThirdVersionGenerationMode, displayLimit: number, rawCount: number) {
  return mode === "qingmao_advantage" ? Math.min(rawCount, displayLimit * 2) : rawCount;
}

function strategyCandidatePool<T>(items: T[], options: ThirdVersionStrategyOptions, displayLimit: number) {
  return items.slice(0, strategyCandidateLimit(options.generationMode, displayLimit, items.length));
}

function advantageMetrics<T>(items: T[], isAdvantage: (item: T) => boolean | null) {
  const states = items.map(isAdvantage).filter((state): state is boolean => state !== null);
  const advantageCount = states.filter(Boolean).length;
  const denominator = states.length;
  const ratio = denominator === 0 ? 0 : Math.round((advantageCount / denominator) * 100);

  return {
    advantageCount,
    denominator,
    ratio
  };
}

function targetMet(ratio: number, denominator: number, targetRatio: number) {
  return denominator > 0 && ratio >= targetRatio;
}

function exportStatus(isFull: boolean, isTargetMet: boolean): ThirdVersionExportStatus {
  if (isFull && isTargetMet) return "达标";
  if (isFull && !isTargetMet) return "未达标";
  if (!isFull && isTargetMet) return "未满量";
  return "未满量未达标";
}

function exportPrefix(mode: ThirdVersionGenerationMode, hotelTargetMet: boolean, flightTargetMet: boolean): ThirdVersionExportPrefix {
  if (mode === "qingmao_advantage" && hotelTargetMet && flightTargetMet) {
    return "【青】";
  }
  return "【随】";
}

function sourceFailureReasons(batch: CollectionBatch) {
  const reasons = [...(batch.failureNotes ?? [])];

  for (const sample of batch.samples) {
    for (const quote of sample.quotes) {
      if (!quote.available || typeof quote.price !== "number") {
        reasons.push(`${sample.origin}-${sample.destination} ${sample.flightNo} ${quote.platform}: ${quote.missingReason || quote.status || "暂无价格"}`);
      }
    }
  }

  for (const hotel of batch.hotels ?? []) {
    for (const ratePlan of hotel.ratePlans) {
      for (const quote of ratePlan.quotes) {
        if (!quote.available || typeof quote.price !== "number") {
          reasons.push(`${hotel.hotelName} ${ratePlan.label} ${quote.platform}: ${quote.missingReason || quote.status || "暂无价格"}`);
        }
      }
    }
  }

  return reasons;
}

export function buildThirdVersionExportBaseName(input: ThirdVersionExportNameInput) {
  return `${input.exportPrefix}青猫差旅一体化比价-酒店${input.hotelDisplayed}-航班${input.flightDisplayed}-优势${input.exportAdvantageRatio}%`;
}

export function applyThirdVersionStrategy(
  batch: CollectionBatch,
  rawOptions: Partial<ThirdVersionStrategyOptions> = {},
  runtime: ThirdVersionStrategyRuntime = {}
): ThirdVersionStrategyResult {
  const options = normalizeThirdVersionOptions(rawOptions);
  const random = runtime.random ?? Math.random;
  const sourceFlights = batch.samples;
  const sourceHotels = batch.hotels ?? [];
  const selectableHotels = sourceHotels.filter(isHotelSelectable);
  const flightStrategyPool = strategyCandidatePool(sourceFlights, options, options.flightDisplayLimit);
  const hotelStrategyPool = strategyCandidatePool(selectableHotels, options, options.hotelDisplayLimit);
  const isFlightAdvantage = (sample: FlightSample) => qingmaoAdvantageState(sample.quotes, options);
  const isHotelAdvantage = (hotel: HotelSample) => qingmaoAdvantageState(hotelComparisonQuotes(hotel), options);

  const flights =
    options.generationMode === "qingmao_advantage"
      ? selectAdvantageFirst(flightStrategyPool, options.flightDisplayLimit, random, (sample) => isFlightAdvantage(sample) === true)
      : selectRealRandom(flightStrategyPool, options.flightDisplayLimit, random);
  const hotels =
    options.generationMode === "qingmao_advantage"
      ? selectAdvantageFirst(hotelStrategyPool, options.hotelDisplayLimit, random, (hotel) => isHotelAdvantage(hotel) === true)
      : selectRealRandom(hotelStrategyPool, options.hotelDisplayLimit, random);

  const flightMetrics = advantageMetrics(flights, isFlightAdvantage);
  const hotelMetrics = advantageMetrics(hotels, isHotelAdvantage);
  const flightFull = flights.length >= options.flightDisplayLimit;
  const hotelFull = hotels.length >= options.hotelDisplayLimit;
  const flightTargetMet = targetMet(flightMetrics.ratio, flightMetrics.denominator, options.targetAdvantageRatio);
  const hotelTargetMet = targetMet(hotelMetrics.ratio, hotelMetrics.denominator, options.targetAdvantageRatio);
  const prefix = exportPrefix(options.generationMode, hotelTargetMet, flightTargetMet);
  const status = exportStatus(flightFull && hotelFull, flightTargetMet && hotelTargetMet);
  const exportAdvantageRatio = Math.min(hotelMetrics.ratio, flightMetrics.ratio);
  const exportBaseName = buildThirdVersionExportBaseName({
    exportPrefix: prefix,
    hotelDisplayed: hotels.length,
    flightDisplayed: flights.length,
    exportStatus: status,
    exportAdvantageRatio
  });

  return {
    options,
    flights,
    hotels,
    status: {
      rawHotelCandidates: sourceHotels.length,
      rawFlightCandidates: sourceFlights.length,
      hotelStrategyCandidateLimit: strategyCandidateLimit(options.generationMode, options.hotelDisplayLimit, selectableHotels.length),
      flightStrategyCandidateLimit: strategyCandidateLimit(options.generationMode, options.flightDisplayLimit, sourceFlights.length),
      hotelStrategyCandidates: hotelStrategyPool.length,
      flightStrategyCandidates: flightStrategyPool.length,
      hotelDisplayed: hotels.length,
      flightDisplayed: flights.length,
      hotelDisplayLimit: options.hotelDisplayLimit,
      flightDisplayLimit: options.flightDisplayLimit,
      hotelAdvantageCount: hotelMetrics.advantageCount,
      flightAdvantageCount: flightMetrics.advantageCount,
      hotelAdvantageDenominator: hotelMetrics.denominator,
      flightAdvantageDenominator: flightMetrics.denominator,
      hotelAdvantageRatio: hotelMetrics.ratio,
      flightAdvantageRatio: flightMetrics.ratio,
      hotelTargetMet,
      flightTargetMet,
      hotelFull,
      flightFull,
      exportPrefix: prefix,
      exportStatus: status,
      exportAdvantageRatio,
      exportBaseName,
      exportNamePreview: `${exportBaseName}.html`,
      failureReasons: sourceFailureReasons(batch)
    }
  };
}

function comparisonModeLabel(options: ThirdVersionStrategyOptions) {
  if (options.comparisonMode === "external_sales") return "对外销售";
  if (options.comparisonMode === "specified_platform") return `指定平台${options.specifiedPlatform ? `（${options.specifiedPlatform}）` : ""}`;
  return "内部讨论";
}

function generationModeLabel(mode: ThirdVersionGenerationMode) {
  return mode === "qingmao_advantage" ? "青猫优势" : "真实随机";
}

export function getThirdVersionSourceBatch(batch: CollectionBatch): CollectionBatch {
  if (!batch.thirdVersion) return batch;

  return {
    id: batch.thirdVersion.sourceBatchId,
    status: batch.status,
    generatedAt: batch.thirdVersion.sourceGeneratedAt,
    sampleCount: batch.thirdVersion.rawSamples.length + batch.thirdVersion.rawHotels.length,
    successCount: batch.thirdVersion.rawSamples.length + batch.thirdVersion.rawHotels.length,
    failedCount: batch.failedCount,
    samples: batch.thirdVersion.rawSamples,
    hotels: batch.thirdVersion.rawHotels,
    failureNotes: batch.thirdVersion.sourceFailureNotes
  };
}

export function thirdVersionCollectionLimits(options: ThirdVersionStrategyOptions): ThirdVersionFullCollectionLimits | undefined {
  if (options.generationMode !== "qingmao_advantage") {
    return undefined;
  }

  return {
    flightCandidateLimit: options.flightDisplayLimit * 2,
    hotelCandidateLimit: options.hotelDisplayLimit * 2
  };
}

export function buildThirdVersionDeliveryBatch(
  batch: CollectionBatch,
  rawOptions: Partial<ThirdVersionStrategyOptions> = {},
  runtime: ThirdVersionStrategyRuntime = {}
): CollectionBatch {
  const sourceBatch = getThirdVersionSourceBatch(batch);
  const strategy = applyThirdVersionStrategy(sourceBatch, rawOptions, runtime);
  const selectedCount = strategy.flights.length + strategy.hotels.length;
  const sourceCountsHotels = sourceBatch.sampleCount === sourceBatch.samples.length + (sourceBatch.hotels?.length ?? 0);
  const selectedSampleCount = sourceCountsHotels ? selectedCount : strategy.flights.length;
  const selectionNotes = [
    `第三版策略来源批次：${sourceBatch.id}，原始航班 ${strategy.status.rawFlightCandidates} 条，原始酒店 ${strategy.status.rawHotelCandidates} 家。`,
    `第三版展示结果：航班 ${strategy.status.flightDisplayed}/${strategy.status.flightDisplayLimit} 条，酒店 ${strategy.status.hotelDisplayed}/${strategy.status.hotelDisplayLimit} 家，内部状态 ${strategy.status.exportStatus}，文件标识 优势${strategy.status.exportAdvantageRatio}%。`,
    `第三版生成模式：${generationModeLabel(strategy.options.generationMode)}；比价口径：${comparisonModeLabel(strategy.options)}。`
  ];

  return {
    ...sourceBatch,
    sampleCount: selectedSampleCount,
    successCount: selectedSampleCount,
    samples: strategy.flights,
    hotels: strategy.hotels,
    failureNotes: [...selectionNotes, ...(sourceBatch.failureNotes ?? [])],
    thirdVersion: {
      sourceBatchId: sourceBatch.id,
      sourceGeneratedAt: sourceBatch.generatedAt,
      options: strategy.options,
      status: strategy.status,
      rawSamples: sourceBatch.samples,
      rawHotels: sourceBatch.hotels ?? [],
      sourceFailureNotes: sourceBatch.failureNotes ?? [],
      selectionNotes
    }
  };
}

function traceQuotes(batch: CollectionBatch) {
  const rawBatch = getThirdVersionSourceBatch(batch);
  const flightQuotes = rawBatch.samples.flatMap((sample) => sample.quotes.map((quote) => ({ quote, type: "flight" as const })));
  const hotelQuotes = (rawBatch.hotels ?? []).flatMap((hotel) =>
    hotel.ratePlans.flatMap((ratePlan) => ratePlan.quotes.map((quote) => ({ quote, type: "hotel" as const })))
  );

  return { flightQuotes, hotelQuotes };
}

export function buildThirdVersionPlatformRegressionReport(batch: CollectionBatch): ThirdVersionPlatformRegressionReport {
  const { flightQuotes, hotelQuotes } = traceQuotes(batch);
  const platforms = (["青猫差旅", "携程商旅", "阿里商旅", "在途商旅"] as PlatformName[]).map((platform) => {
    const platformFlightQuotes = flightQuotes.filter(({ quote }) => quote.platform === platform).map(({ quote }) => quote);
    const platformHotelQuotes = hotelQuotes.filter(({ quote }) => quote.platform === platform).map(({ quote }) => quote);
    const allQuotes = [...platformFlightQuotes, ...platformHotelQuotes];
    const pricedCount = allQuotes.filter((quote) => quote.available && typeof quote.price === "number").length;
    const failureReasonCount = allQuotes.filter((quote) => !quote.available || typeof quote.price !== "number").filter((quote) => Boolean(quote.missingReason || quote.status)).length;
    const evidenceCount = allQuotes.filter((quote) => Boolean(quote.evidencePath)).length;

    return {
      platform,
      rawFlightQuoteCount: platformFlightQuotes.length,
      rawHotelQuoteCount: platformHotelQuotes.length,
      pricedCount,
      failureReasonCount,
      evidenceCount,
      priceOrFailureCount: pricedCount + failureReasonCount
    };
  });
  const passed = platforms.every((platform) =>
    platform.rawFlightQuoteCount > 0
    && platform.rawHotelQuoteCount > 0
    && platform.evidenceCount > 0
    && platform.priceOrFailureCount === platform.rawFlightQuoteCount + platform.rawHotelQuoteCount
  );

  return {
    passed,
    platforms,
    notes: [
      "第三版策略层未删除四平台原始报价、截图索引和失败原因。",
      passed ? "四平台轻量回归通过：可用历史真实批次复核。" : "四平台轻量回归未通过：存在平台原始价格、截图或失败原因缺失。"
    ]
  };
}
