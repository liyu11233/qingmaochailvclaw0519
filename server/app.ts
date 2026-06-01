import express from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFakeBatch } from "../src/domain/fakeBatch";
import { enrichHotelSampleDisplayDecision } from "../src/domain/hotelRatePlans";
import {
  applyThirdVersionStrategy,
  buildThirdVersionDeliveryBatch,
  DEFAULT_THIRD_VERSION_OPTIONS,
  getThirdVersionSourceBatch,
  thirdVersionCollectionLimits,
  type ThirdVersionBatchStatus,
  type ThirdVersionStrategyOptions
} from "../src/domain/thirdVersionStrategy";
import type { CollectionBatch, CompetitorPlatformName, ComparisonMode, HotelGroup, HotelRatePlanLabel, HotelSample, PlatformName, PlatformQuote, QuoteStatus } from "../src/domain/types";
import {
  type AliHotelSingleVerifyInput,
  type AliHotelSingleVerifyResult,
  CollectionStoppedError,
  type CollectionControlSignal,
  createPlaywrightPilotCollector,
  type AliHotelMatchProbeResult,
  type BrowserCleanupResult,
  type HotelAllRatePlanProbeResult,
  type HotelCalibrationInput,
  type HotelCalibrationResult,
  type HotelMainRateQuote,
  type HotelScaleValidationInput,
  type HotelScaleValidationResult,
  type HotelGroupMainRateProbeResult,
  type HotelSmallBatchProbeResult,
  type HotelMainRateProbeResult,
  type HotelSingleAllRatePlansInput,
  type HotelSingleAllRatePlansResult,
  type HotelSingleDiagnosisInput,
  type HotelSingleDiagnosisProbeResult,
  type HotelRatePlanProbeResult,
  type PilotCollector,
  type PilotResult,
  type QingmaoCandidateProbeResult,
  type QingmaoHotelCandidateProbeResult,
  type SameFlightComparisonProbeResult,
  type ZtripFlightProbeResult,
  type ZtripHotelProbeResult,
  type ZtripProbeResult
} from "./collectors/pilot";
import { exportBatchWorkbook } from "./exporters/excel";
import { exportOfflinePackage } from "./exporters/offlinePackage";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const servedOutputsRoot = path.join(projectRoot, "outputs");

interface ArtifactState {
  excel: string;
  offlinePackage: string;
}

interface AppState {
  batch: CollectionBatch | null;
  artifacts: ArtifactState | null;
  thirdVersionOptions: ThirdVersionStrategyOptions;
  pilot: PilotResult;
  qingmaoCandidates: QingmaoCandidateProbeResult;
  qingmaoHotelCandidates: QingmaoHotelCandidateProbeResult;
  hotelMainRate: HotelMainRateProbeResult;
  hotelGroupMainRate: HotelGroupMainRateProbeResult;
  hotelSmallBatch: HotelSmallBatchProbeResult;
  hotelScaleValidation: HotelScaleValidationResult;
  hotelSingleDiagnosis: HotelSingleDiagnosisProbeResult;
  hotelSingleAllRatePlans: HotelSingleAllRatePlansResult;
  aliHotelSingleVerify: AliHotelSingleVerifyResult;
  aliHotelMatch: AliHotelMatchProbeResult;
  hotelRatePlanProbe: HotelRatePlanProbeResult;
  hotelAllRatePlan: HotelAllRatePlanProbeResult;
  hotelCalibration: HotelCalibrationResult;
  sameFlightComparison: SameFlightComparisonProbeResult;
  ztrip: ZtripProbeResult;
  ztripFlight: ZtripFlightProbeResult;
  ztripHotel: ZtripHotelProbeResult;
}

interface ActiveOperation {
  label: string;
  startedAt: string;
  state: "running" | "paused" | "stopping";
  canPause: boolean;
  canResume: boolean;
  canStop: boolean;
  pauseRequestedAt: string | null;
  stopRequestedAt: string | null;
  control: OperationControl;
}

interface ArtifactExporters {
  workbook: typeof exportBatchWorkbook;
  offlinePackage: typeof exportOfflinePackage;
}

interface ThirdVersionResponse {
  options: ThirdVersionStrategyOptions;
  status: ThirdVersionBatchStatus;
}

interface PersistedAppState {
  batch?: CollectionBatch | null;
  artifacts?: unknown;
  thirdVersionOptions?: Partial<ThirdVersionStrategyOptions>;
}

class OperationControl implements CollectionControlSignal {
  private paused = false;
  private stopped = false;
  private waiters = new Set<() => void>();

  pause() {
    if (!this.stopped) {
      this.paused = true;
    }
  }

  resume() {
    this.paused = false;
    this.releaseWaiters();
  }

  stop() {
    this.stopped = true;
    this.paused = false;
    this.releaseWaiters();
  }

  async waitIfPaused() {
    while (this.paused && !this.stopped) {
      await new Promise<void>((resolve) => {
        this.waiters.add(resolve);
      });
    }
    this.throwIfStopped();
  }

  throwIfStopped() {
    if (this.stopped) {
      throw new CollectionStoppedError();
    }
  }

  private releaseWaiters() {
    const waiters = [...this.waiters];
    this.waiters.clear();
    waiters.forEach((resolve) => resolve());
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function restoreArtifactState(value: unknown): ArtifactState | null {
  if (!isRecord(value) || typeof value.excel !== "string") {
    return null;
  }

  const offlinePackage = typeof value.offlinePackage === "string" ? value.offlinePackage : typeof value.salesSnapshot === "string" ? value.salesSnapshot : "";
  if (!offlinePackage) {
    return null;
  }

  return {
    excel: value.excel,
    offlinePackage
  };
}

function emptyThirdVersionBatch(): CollectionBatch {
  return {
    id: "third-version-preview-empty",
    status: "ready",
    generatedAt: new Date(0).toISOString(),
    sampleCount: 0,
    successCount: 0,
    failedCount: 0,
    samples: [],
    hotels: []
  };
}

function parsePositiveIntegerField(value: unknown, field: "hotelDisplayLimit" | "flightDisplayLimit", fallback: number): { ok: true; value: number } | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: true, value: fallback };
  }
  if (!Number.isInteger(value) || typeof value !== "number" || value < 1) {
    return { ok: false, error: `${field} 必须是正整数` };
  }
  return { ok: true, value };
}

function parseTargetAdvantageRatio(value: unknown, fallback: number): { ok: true; value: number } | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: true, value: fallback };
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    return { ok: false, error: "targetAdvantageRatio 必须是 0 到 100 之间的数字" };
  }
  return { ok: true, value };
}

function parseThirdVersionOptionsInput(value: unknown, fallback: ThirdVersionStrategyOptions): { ok: true; options: ThirdVersionStrategyOptions } | { ok: false; error: string } {
  if (value === undefined || value === null || (isRecord(value) && Object.keys(value).length === 0)) {
    return { ok: true, options: fallback };
  }
  if (!isRecord(value)) {
    return { ok: false, error: "第三版配置请求体必须是对象" };
  }

  const hotelDisplayLimit = parsePositiveIntegerField(value.hotelDisplayLimit, "hotelDisplayLimit", fallback.hotelDisplayLimit);
  if (!hotelDisplayLimit.ok) return hotelDisplayLimit;
  const flightDisplayLimit = parsePositiveIntegerField(value.flightDisplayLimit, "flightDisplayLimit", fallback.flightDisplayLimit);
  if (!flightDisplayLimit.ok) return flightDisplayLimit;

  const generationMode = value.generationMode === undefined ? fallback.generationMode : value.generationMode;
  if (!THIRD_VERSION_GENERATION_MODES.includes(generationMode as typeof THIRD_VERSION_GENERATION_MODES[number])) {
    return { ok: false, error: "generationMode 只能是 real_random 或 qingmao_advantage" };
  }

  const targetAdvantageRatio = parseTargetAdvantageRatio(value.targetAdvantageRatio, fallback.targetAdvantageRatio);
  if (!targetAdvantageRatio.ok) return targetAdvantageRatio;

  const comparisonMode = value.comparisonMode === undefined ? fallback.comparisonMode : value.comparisonMode;
  if (!THIRD_VERSION_COMPARISON_MODES.includes(comparisonMode as ComparisonMode)) {
    return { ok: false, error: "comparisonMode 不在允许范围内" };
  }

  let specifiedPlatform: CompetitorPlatformName | undefined;
  const rawSpecifiedPlatform = value.specifiedPlatform === undefined ? fallback.specifiedPlatform : value.specifiedPlatform;
  if (rawSpecifiedPlatform !== undefined) {
    if (rawSpecifiedPlatform === "青猫差旅") {
      return { ok: false, error: "specifiedPlatform 不能是青猫差旅" };
    }
    if (!THIRD_VERSION_COMPETITOR_PLATFORMS.includes(rawSpecifiedPlatform as CompetitorPlatformName)) {
      return { ok: false, error: `specifiedPlatform 只能是：${THIRD_VERSION_COMPETITOR_PLATFORMS.join("、")}` };
    }
    specifiedPlatform = rawSpecifiedPlatform as CompetitorPlatformName;
  }

  if (comparisonMode === "specified_platform" && !specifiedPlatform) {
    return { ok: false, error: "指定平台口径必须选择 1 个竞品平台" };
  }

  return {
    ok: true,
    options: {
      hotelDisplayLimit: hotelDisplayLimit.value,
      flightDisplayLimit: flightDisplayLimit.value,
      generationMode: generationMode as ThirdVersionStrategyOptions["generationMode"],
      targetAdvantageRatio: targetAdvantageRatio.value,
      comparisonMode: comparisonMode as ThirdVersionStrategyOptions["comparisonMode"],
      ...(comparisonMode === "specified_platform" && specifiedPlatform ? { specifiedPlatform } : {})
    }
  };
}

const HOTEL_SINGLE_DIAGNOSIS_RATE_PLANS = ["大床无早餐", "大床有早餐", "双床无早餐", "双床有早餐"] as const;
const HOTEL_RATE_PLAN_LABELS: HotelRatePlanLabel[] = ["大床无早餐", "大床有早餐", "双床无早餐", "双床有早餐"];
const SECOND_VERSION_PLATFORMS: PlatformName[] = ["青猫差旅", "携程商旅", "阿里商旅", "在途商旅"];
const HOTEL_CALIBRATION_COMPETITOR_PLATFORMS = ["阿里商旅", "在途商旅", "携程商旅"] as const;
const THIRD_VERSION_GENERATION_MODES = ["real_random", "qingmao_advantage"] as const;
const THIRD_VERSION_COMPARISON_MODES: ComparisonMode[] = ["internal_discussion", "external_sales", "specified_platform"];
const THIRD_VERSION_COMPETITOR_PLATFORMS: CompetitorPlatformName[] = ["携程商旅", "阿里商旅", "在途商旅"];

function formatBatchTimestamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + "-" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

function hotelGroupName(value: string | undefined): HotelGroup {
  const map: Record<string, HotelGroup> = {
    "首旅如家": "如家集团",
    "如家集团": "如家集团",
    "锦江": "锦江集团",
    "锦江集团": "锦江集团",
    "华住": "华住集团",
    "华住集团": "华住集团",
    "东呈": "东呈集团",
    "东呈集团": "东呈集团",
    "亚朵": "亚朵集团",
    "亚朵集团": "亚朵集团",
    "亚朵酒店": "亚朵集团"
  };
  return map[value ?? ""] ?? "东呈集团";
}

function hotelBrandName(group: string | undefined, hotelName: string) {
  if (group === "首旅如家" || group === "如家集团") return "首旅如家";
  if (group === "亚朵" || group === "亚朵集团" || group === "亚朵酒店") return "亚朵酒店";
  if (group === "东呈" || group === "东呈集团") {
    if (hotelName.includes("城市便捷")) return "城市便捷";
    if (hotelName.includes("柏曼")) return "柏曼";
    if (hotelName.includes("宜尚")) return "宜尚";
  }
  return group ?? "";
}

function quoteStatus(status: HotelMainRateQuote["status"] | undefined): QuoteStatus {
  if (status === "available") return "可订";
  if (status === "not-found" || status === "platform-no-rate") return "未展示";
  if (status === "pending") return "未展示";
  return "采集失败";
}

function buildHotelPlatformQuote(
  rawQuotes: HotelMainRateQuote[],
  platform: PlatformName,
  ratePlan: HotelRatePlanLabel,
  hotelId: string
): PlatformQuote {
  const raw = rawQuotes.find((quote) => quote.platform === platform && quote.ratePlan === ratePlan);
  const available = raw?.status === "available" && typeof raw.price === "number";
  const sourceEvidencePath = raw?.screenshotPath || raw?.diagnosisPath || "";
  const extension = path.extname(sourceEvidencePath) || ".png";
  const evidencePath = sourceEvidencePath
    ? path.join("evidence", "hotels", hotelId, `${platform}-${ratePlan}${extension}`)
    : "";

  return {
    platform,
    price: available ? raw.price : null,
    refundRule: "以平台页面展示及酒店规则为准",
    baggageRule: "以平台页面展示及酒店规则为准",
    available,
    status: quoteStatus(raw?.status),
    evidencePath,
    sourceUrl: raw?.finalUrl ?? "",
    rawHotelName: raw?.hotelName ?? "",
    rawRoomName: raw?.roomType ?? "",
    normalizedRoomLabel: ratePlan,
    missingReason: available ? undefined : raw?.error || raw?.status || "暂无该口径价格",
    sourceEvidencePath
  } as PlatformQuote & { sourceEvidencePath?: string };
}

function buildAcceptanceHotelSample(sample: NonNullable<HotelScaleValidationResult["groups"][number]["samples"][number]>, index: number): HotelSample {
  const hotelName = sample.selectedCandidate?.hotelName ?? sample.query?.keyword ?? `酒店-${index + 1}`;
  const hotelId = `hotel-${String(index + 1).padStart(2, "0")}`;
  const coverImagePath = sample.coverImagePath && fs.existsSync(sample.coverImagePath) ? sample.coverImagePath : undefined;

  return enrichHotelSampleDisplayDecision({
    id: hotelId,
    group: hotelGroupName(sample.group),
    brand: hotelBrandName(sample.group, hotelName),
    hotelName,
    city: sample.query?.city ?? "",
    checkInDate: sample.query?.checkInDate ?? "",
    checkOutDate: sample.query?.checkOutDate ?? "",
    nights: sample.query?.nights ?? 1,
    primaryRatePlan: "大床有早餐",
    coverImagePath,
    coverImageSource: coverImagePath ? sample.coverImageSource : undefined,
    coverImageStatus: coverImagePath ? "saved" : "missing",
    ratePlans: HOTEL_RATE_PLAN_LABELS.map((label) => ({
      label,
      quotes: SECOND_VERSION_PLATFORMS.map((platform) => buildHotelPlatformQuote(sample.quotes ?? [], platform, label, hotelId))
    }))
  });
}

function buildSecondVersionAcceptanceBatch(flightBatch: CollectionBatch, hotelResult: HotelScaleValidationResult, generatedAt: Date): CollectionBatch {
  const completedHotelSamples = hotelResult.groups.flatMap((group) =>
    group.samples.filter((sample) => sample.status === "completed")
  );
  const hotels = completedHotelSamples.map(buildAcceptanceHotelSample);
  const flightCount = flightBatch.samples.length;
  const hotelCount = hotels.length;

  if (flightBatch.status !== "ready" || flightCount !== 20) {
    throw new Error(`航班未达标：需要 20 条完整样本，当前 ${flightCount} 条，状态 ${flightBatch.status}`);
  }
  if (hotelResult.status !== "completed" || hotelResult.completedCount !== 40 || hotelCount !== 40) {
    throw new Error(`酒店未达标：需要 40 家完整样本，当前完整 ${hotelResult.completedCount} 家，可入批次 ${hotelCount} 家，状态 ${hotelResult.status}`);
  }

  return {
    id: `batch-${formatBatchTimestamp(generatedAt)}-second-version-final-acceptance`,
    status: "ready",
    generatedAt: generatedAt.toISOString(),
    sampleCount: flightCount + hotelCount,
    successCount: flightCount + hotelCount,
    failedCount: hotelResult.failedCount + hotelResult.partialCount + hotelResult.skippedCount + hotelResult.timeoutCount + hotelResult.unattemptedCount,
    samples: flightBatch.samples,
    hotels,
    failureNotes: [
      `航班来源批次：${flightBatch.id}，四平台完整样本 ${flightCount} 条。`,
      `酒店来源验收：${hotelResult.summaryPath ?? hotelResult.artifactDir ?? "本次 40 家酒店放量验证"}，四平台完整酒店 ${hotelCount} 家。`,
      ...(flightBatch.failureNotes ?? []),
      ...hotelResult.groups.flatMap((group) =>
        group.samples
          .filter((sample) => sample.status !== "completed")
          .map((sample) => `${group.group} 第 ${sample.sampleIndex ?? "-"} 家未入最终批次：${sample.failureReason ?? sample.message ?? sample.status}`)
      )
    ]
  };
}

function parseHotelSingleDiagnosisInput(value: unknown): { ok: true; input: HotelSingleDiagnosisInput } | { ok: false; error: string } {
  if (!isRecord(value)) {
    return { ok: false, error: "请求体必须是对象" };
  }

  const city = typeof value.city === "string" ? value.city.trim() : "";
  const keyword = typeof value.keyword === "string" ? value.keyword.trim() : "";
  const checkInDate = typeof value.checkInDate === "string" ? value.checkInDate.trim() : "";
  const checkOutDate = typeof value.checkOutDate === "string" ? value.checkOutDate.trim() : "";
  const ratePlan = typeof value.ratePlan === "string" ? value.ratePlan.trim() : "";

  if (!city || !keyword || !checkInDate || !checkOutDate || !ratePlan) {
    return { ok: false, error: "city、keyword、checkInDate、checkOutDate、ratePlan 均为必填" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkInDate) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOutDate)) {
    return { ok: false, error: "checkInDate 和 checkOutDate 必须是 YYYY-MM-DD" };
  }
  if (!HOTEL_SINGLE_DIAGNOSIS_RATE_PLANS.includes(ratePlan as HotelSingleDiagnosisInput["ratePlan"])) {
    return { ok: false, error: "ratePlan 不在允许范围内" };
  }

  return {
    ok: true,
    input: {
      city,
      keyword,
      checkInDate,
      checkOutDate,
      ratePlan: ratePlan as HotelSingleDiagnosisInput["ratePlan"]
    }
  };
}

function parseHotelSingleAllRatePlansInput(value: unknown): { ok: true; input: HotelSingleAllRatePlansInput } | { ok: false; error: string } {
  if (!isRecord(value)) {
    return { ok: false, error: "请求体必须是对象" };
  }

  const city = typeof value.city === "string" ? value.city.trim() : "";
  const keyword = typeof value.keyword === "string" ? value.keyword.trim() : "";
  const checkInDate = typeof value.checkInDate === "string" ? value.checkInDate.trim() : "";
  const checkOutDate = typeof value.checkOutDate === "string" ? value.checkOutDate.trim() : "";

  if (!city || !keyword || !checkInDate || !checkOutDate) {
    return { ok: false, error: "city、keyword、checkInDate、checkOutDate 均为必填" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkInDate) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOutDate)) {
    return { ok: false, error: "checkInDate 和 checkOutDate 必须是 YYYY-MM-DD" };
  }

  const checkIn = parseDateOnly(checkInDate);
  const checkOut = parseDateOnly(checkOutDate);
  if (!checkIn || !checkOut || checkOut.getTime() <= checkIn.getTime()) {
    return { ok: false, error: "checkOutDate 必须晚于 checkInDate" };
  }

  return {
    ok: true,
    input: {
      city,
      keyword,
      checkInDate,
      checkOutDate
    }
  };
}

function parseAliHotelSingleVerifyInput(value: unknown): { ok: true; input: AliHotelSingleVerifyInput } | { ok: false; error: string } {
  if (!isRecord(value)) {
    return { ok: false, error: "请求体必须是对象" };
  }

  const city = typeof value.city === "string" ? value.city.trim() : "";
  const hotelName = typeof value.hotelName === "string" ? value.hotelName.trim() : "";
  const address = typeof value.address === "string" ? value.address.trim() : "";
  const checkInDate = typeof value.checkInDate === "string" ? value.checkInDate.trim() : "";
  const checkOutDate = typeof value.checkOutDate === "string" ? value.checkOutDate.trim() : "";
  const ratePlan = typeof value.ratePlan === "string" ? value.ratePlan.trim() : "";

  if (!city || !hotelName || !address || !checkInDate || !checkOutDate || !ratePlan) {
    return { ok: false, error: "city、hotelName、address、checkInDate、checkOutDate、ratePlan 均为必填" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkInDate) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOutDate)) {
    return { ok: false, error: "checkInDate 和 checkOutDate 必须是 YYYY-MM-DD" };
  }
  if (ratePlan !== "大床有早餐") {
    return { ok: false, error: "阿里-only单酒店复验当前只支持 ratePlan=大床有早餐" };
  }

  return {
    ok: true,
    input: {
      city,
      hotelName,
      address,
      checkInDate,
      checkOutDate,
      ratePlan
    }
  };
}

function parseHotelCalibrationInput(value: unknown): { ok: true; input: HotelCalibrationInput } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return { ok: true, input: {} };
  }
  if (!isRecord(value)) {
    return { ok: false, error: "请求体必须是对象" };
  }

  const checkInDate = typeof value.checkInDate === "string" ? value.checkInDate.trim() : undefined;
  const checkOutDate = typeof value.checkOutDate === "string" ? value.checkOutDate.trim() : undefined;
  let platforms: HotelCalibrationInput["platforms"] | undefined;
  if ((checkInDate && !checkOutDate) || (!checkInDate && checkOutDate)) {
    return { ok: false, error: "checkInDate 和 checkOutDate 必须同时传入" };
  }
  if (checkInDate && !/^\d{4}-\d{2}-\d{2}$/.test(checkInDate)) {
    return { ok: false, error: "checkInDate 必须是 YYYY-MM-DD" };
  }
  if (checkOutDate && !/^\d{4}-\d{2}-\d{2}$/.test(checkOutDate)) {
    return { ok: false, error: "checkOutDate 必须是 YYYY-MM-DD" };
  }
  if (value.platforms !== undefined) {
    if (!Array.isArray(value.platforms) || value.platforms.length === 0) {
      return { ok: false, error: "platforms 必须是非空数组" };
    }
    const normalizedPlatforms = value.platforms
      .filter((platform): platform is string => typeof platform === "string")
      .map((platform) => platform.trim());
    if (normalizedPlatforms.length !== value.platforms.length) {
      return { ok: false, error: "platforms 只能包含平台名称字符串" };
    }
    const invalidPlatform = normalizedPlatforms.find((platform) => !HOTEL_CALIBRATION_COMPETITOR_PLATFORMS.includes(platform as typeof HOTEL_CALIBRATION_COMPETITOR_PLATFORMS[number]));
    if (invalidPlatform) {
      return { ok: false, error: `platforms 暂只支持：${HOTEL_CALIBRATION_COMPETITOR_PLATFORMS.join("、")}` };
    }
    platforms = Array.from(new Set(normalizedPlatforms)) as HotelCalibrationInput["platforms"];
  }

  return {
    ok: true,
    input: {
      ...(checkInDate && checkOutDate ? { checkInDate, checkOutDate } : {}),
      ...(platforms ? { platforms } : {})
    }
  };
}

function parseDateOnly(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function parseHotelScaleValidationInput(value: unknown): { ok: true; input: HotelScaleValidationInput } | { ok: false; error: string } {
  if (value === undefined || value === null || (isRecord(value) && Object.keys(value).length === 0)) {
    return { ok: true, input: {} };
  }
  if (!isRecord(value)) {
    return { ok: false, error: "请求体必须是对象" };
  }

  const checkInDate = typeof value.checkInDate === "string" ? value.checkInDate.trim() : undefined;
  const checkOutDate = typeof value.checkOutDate === "string" ? value.checkOutDate.trim() : undefined;
  const limit = typeof value.limit === "number" ? value.limit : undefined;
  const disableBudgets = value.disableBudgets === true;

  if (value.limit !== undefined && (!Number.isInteger(limit) || !limit || limit < 1 || limit > 40)) {
    return { ok: false, error: "limit 必须是 1 到 40 之间的整数" };
  }
  if (value.disableBudgets !== undefined && typeof value.disableBudgets !== "boolean") {
    return { ok: false, error: "disableBudgets 必须是布尔值" };
  }

  if ((checkInDate && !checkOutDate) || (!checkInDate && checkOutDate)) {
    return { ok: false, error: "checkInDate 和 checkOutDate 必须同时传入" };
  }
  if (!checkInDate && !checkOutDate) {
    return { ok: true, input: { ...(limit ? { limit } : {}), ...(disableBudgets ? { disableBudgets } : {}) } };
  }
  if (!checkInDate || !checkOutDate || !/^\d{4}-\d{2}-\d{2}$/.test(checkInDate) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOutDate)) {
    return { ok: false, error: "checkInDate 和 checkOutDate 必须是 YYYY-MM-DD" };
  }

  const checkIn = parseDateOnly(checkInDate);
  const checkOut = parseDateOnly(checkOutDate);
  if (!checkIn || !checkOut || checkOut.getTime() <= checkIn.getTime()) {
    return { ok: false, error: "checkOutDate 必须晚于 checkInDate" };
  }

  return {
    ok: true,
    input: {
      checkInDate,
      checkOutDate,
      ...(limit ? { limit } : {}),
      ...(disableBudgets ? { disableBudgets } : {})
    }
  };
}

export function createApp(options: { outputDir?: string; pilotCollector?: PilotCollector; exporters?: Partial<ArtifactExporters> } = {}) {
  const app = express();
  const outputDir = options.outputDir ?? path.join(servedOutputsRoot, "current");
  const workbookExporter = options.exporters?.workbook ?? exportBatchWorkbook;
  const offlinePackageExporter = options.exporters?.offlinePackage ?? exportOfflinePackage;
  const pilotCollector =
    options.pilotCollector ??
    createPlaywrightPilotCollector({
      profileDir: path.join(projectRoot, ".runtime", "browser-profile"),
      artifactDir: path.join(outputDir, "pilot")
    });
  let activeOperation: ActiveOperation | null = null;

  function toOutputUrl(filePath: string) {
    const relativePath = path.relative(servedOutputsRoot, filePath);
    return `/outputs/${relativePath.split(path.sep).map(encodeURIComponent).join("/")}`;
  }

  function loadPersistedBatchState(): Pick<AppState, "batch" | "artifacts" | "thirdVersionOptions"> {
    const persistedStatePath = path.join(outputDir, "current-state.json");

    try {
      if (fs.existsSync(persistedStatePath)) {
        const persisted = JSON.parse(fs.readFileSync(persistedStatePath, "utf8")) as PersistedAppState;
        const artifacts = restoreArtifactState(persisted.artifacts);
        const parsedThirdVersionOptions = parseThirdVersionOptionsInput(persisted.thirdVersionOptions ?? {}, DEFAULT_THIRD_VERSION_OPTIONS);
        const thirdVersionOptions = parsedThirdVersionOptions.ok ? parsedThirdVersionOptions.options : DEFAULT_THIRD_VERSION_OPTIONS;
        if (persisted.batch && artifacts) {
          return {
            batch: persisted.batch,
            artifacts,
            thirdVersionOptions
          };
        }
        return { batch: null, artifacts: null, thirdVersionOptions };
      }

      if (!fs.existsSync(outputDir)) {
        return { batch: null, artifacts: null, thirdVersionOptions: DEFAULT_THIRD_VERSION_OPTIONS };
      }
    } catch {
      return { batch: null, artifacts: null, thirdVersionOptions: DEFAULT_THIRD_VERSION_OPTIONS };
    }

    return { batch: null, artifacts: null, thirdVersionOptions: DEFAULT_THIRD_VERSION_OPTIONS };
  }

  const persistedState = loadPersistedBatchState();
  const state: AppState = {
    batch: persistedState.batch,
    artifacts: persistedState.artifacts,
    thirdVersionOptions: persistedState.thirdVersionOptions,
    pilot: pilotCollector.getStatus(),
    qingmaoCandidates: pilotCollector.getQingmaoCandidateStatus(),
    qingmaoHotelCandidates: pilotCollector.getQingmaoHotelCandidateStatus(),
    hotelMainRate: pilotCollector.getHotelMainRateStatus(),
    hotelGroupMainRate: pilotCollector.getHotelGroupMainRateStatus(),
    hotelSmallBatch: pilotCollector.getHotelSmallBatchStatus(),
    hotelScaleValidation: pilotCollector.getHotelScaleValidationStatus(),
    hotelSingleDiagnosis: pilotCollector.getHotelSingleDiagnosisStatus(),
    hotelSingleAllRatePlans: pilotCollector.getHotelSingleAllRatePlansStatus(),
    aliHotelSingleVerify: pilotCollector.getAliHotelSingleVerifyStatus(),
    aliHotelMatch: pilotCollector.getAliHotelMatchStatus(),
    hotelRatePlanProbe: pilotCollector.getHotelRatePlanProbeStatus(),
    hotelAllRatePlan: pilotCollector.getHotelAllRatePlanStatus(),
    hotelCalibration: pilotCollector.getHotelCalibrationStatus(),
    sameFlightComparison: pilotCollector.getSameFlightComparisonStatus(),
    ztrip: pilotCollector.getZtripStatus(),
    ztripFlight: pilotCollector.getZtripFlightStatus(),
    ztripHotel: pilotCollector.getZtripHotelStatus()
  };

  async function persistCurrentBatchState() {
    await fsp.mkdir(outputDir, { recursive: true });
    await fsp.writeFile(
      path.join(outputDir, "current-state.json"),
      JSON.stringify({ batch: state.batch, artifacts: state.artifacts, thirdVersionOptions: state.thirdVersionOptions }, null, 2),
      "utf8"
    );
  }

  function buildThirdVersionResponse(batch: CollectionBatch | null = state.batch): ThirdVersionResponse {
    const sourceBatch = batch ? getThirdVersionSourceBatch(batch) : emptyThirdVersionBatch();
    const strategy = applyThirdVersionStrategy(sourceBatch, state.thirdVersionOptions, { random: () => 0.5 });
    return {
      options: strategy.options,
      status: strategy.status
    };
  }

  async function setCurrentBatchArtifacts(batch: CollectionBatch, excelPath: string, offlinePackagePath: string) {
    state.batch = batch;
    state.artifacts = {
      excel: toOutputUrl(excelPath),
      offlinePackage: toOutputUrl(offlinePackagePath)
    };
    await persistCurrentBatchState();

    return {
      batch,
      artifacts: state.artifacts,
      thirdVersion: buildThirdVersionResponse(batch)
    };
  }

  async function exportThirdVersionArtifacts(sourceBatch: CollectionBatch) {
    const deliveryBatch = buildThirdVersionDeliveryBatch(sourceBatch, state.thirdVersionOptions, { random: () => 0.5 });
    const excel = await workbookExporter(deliveryBatch, outputDir);
    const offlinePackage = await offlinePackageExporter(deliveryBatch, outputDir);

    return setCurrentBatchArtifacts(deliveryBatch, excel.path, offlinePackage.path);
  }

  function serializeActiveOperation(operation: ActiveOperation | null) {
    if (!operation) return null;
    return {
      label: operation.label,
      startedAt: operation.startedAt,
      state: operation.state,
      canPause: operation.canPause,
      canResume: operation.canResume,
      canStop: operation.canStop,
      pauseRequestedAt: operation.pauseRequestedAt,
      stopRequestedAt: operation.stopRequestedAt
    };
  }

  function refreshOperationControls(operation: ActiveOperation) {
    operation.canPause = operation.state === "running";
    operation.canResume = operation.state === "paused";
    operation.canStop = operation.state === "running" || operation.state === "paused";
  }

  async function runExclusiveOperation(
    label: string,
    res: express.Response,
    next: express.NextFunction,
    task: (control: CollectionControlSignal) => Promise<unknown>
  ) {
    if (activeOperation) {
      res.status(409).json({
        error: `正在${activeOperation.label}，请等待完成后再操作。`,
        activeOperation: serializeActiveOperation(activeOperation)
      });
      return;
    }

    const control = new OperationControl();
    activeOperation = {
      label,
      startedAt: new Date().toISOString(),
      state: "running",
      canPause: true,
      canResume: false,
      canStop: true,
      pauseRequestedAt: null,
      stopRequestedAt: null,
      control
    };

    try {
      res.json(await task(control));
    } catch (error) {
      if (error instanceof CollectionStoppedError) {
        res.status(409).json({
          error: error.message,
          activeOperation: serializeActiveOperation(activeOperation)
        });
        return;
      }
      next(error);
    } finally {
      activeOperation = null;
    }
  }

  function decoratePilotResult(result: PilotResult): PilotResult {
    return {
      ...result,
      platforms: result.platforms.map((platform) => {
        if (!platform.screenshotPath || path.relative(servedOutputsRoot, platform.screenshotPath).startsWith("..")) {
          return platform;
        }

        return {
          ...platform,
          screenshotUrl: toOutputUrl(platform.screenshotPath)
        };
      })
    };
  }

  function decorateQingmaoCandidateResult(result: QingmaoCandidateProbeResult): QingmaoCandidateProbeResult {
    if (!result.screenshotPath || path.relative(servedOutputsRoot, result.screenshotPath).startsWith("..")) {
      return result;
    }

    return {
      ...result,
      screenshotUrl: toOutputUrl(result.screenshotPath)
    };
  }

  function decorateQingmaoHotelCandidateResult(result: QingmaoHotelCandidateProbeResult): QingmaoHotelCandidateProbeResult {
    if (!result.screenshotPath || path.relative(servedOutputsRoot, result.screenshotPath).startsWith("..")) {
      return result;
    }

    return {
      ...result,
      screenshotUrl: toOutputUrl(result.screenshotPath)
    };
  }

  function decorateHotelMainRateResult(result: HotelMainRateProbeResult): HotelMainRateProbeResult {
    return {
      ...result,
      quotes: result.quotes.map((quote) => {
        if (!quote.screenshotPath || path.relative(servedOutputsRoot, quote.screenshotPath).startsWith("..")) {
          return quote;
        }

        return {
          ...quote,
          screenshotUrl: toOutputUrl(quote.screenshotPath)
        };
      })
    };
  }

  function decorateHotelGroupMainRateResult(result: HotelGroupMainRateProbeResult): HotelGroupMainRateProbeResult {
    return {
      ...result,
      samples: result.samples.map((sample) => ({
        ...sample,
        quotes: sample.quotes.map((quote) => {
          if (!quote.screenshotPath || path.relative(servedOutputsRoot, quote.screenshotPath).startsWith("..")) {
            return quote;
          }

          return {
            ...quote,
            screenshotUrl: toOutputUrl(quote.screenshotPath)
          };
        })
      }))
    };
  }

  function decorateHotelSmallBatchResult(result: HotelSmallBatchProbeResult): HotelSmallBatchProbeResult {
    return {
      ...result,
      groups: result.groups.map((group) => ({
        ...group,
        samples: group.samples.map((sample) => ({
          ...sample,
          quotes: sample.quotes.map((quote) => {
            if (!quote.screenshotPath || path.relative(servedOutputsRoot, quote.screenshotPath).startsWith("..")) {
              return quote;
            }

            return {
              ...quote,
              screenshotUrl: toOutputUrl(quote.screenshotPath)
            };
          })
        }))
      }))
    };
  }

  function decorateHotelScaleValidationResult(result: HotelScaleValidationResult): HotelScaleValidationResult {
    return {
      ...result,
      groups: result.groups.map((group) => ({
        ...group,
        samples: group.samples.map((sample) => ({
          ...sample,
          quotes: sample.quotes?.map((quote) => decorateHotelQuote(quote)) ?? []
        }))
      }))
    };
  }

  function decorateHotelSingleDiagnosisResult(result: HotelSingleDiagnosisProbeResult): HotelSingleDiagnosisProbeResult {
    return {
      ...result,
      platforms: result.platforms.map((platform) => {
        if (!platform.screenshotPath || path.relative(servedOutputsRoot, platform.screenshotPath).startsWith("..")) {
          return platform;
        }

        return {
          ...platform,
          screenshotUrl: toOutputUrl(platform.screenshotPath)
        };
      })
    };
  }

  function outputUrlIfServed(filePath: string | undefined) {
    if (!filePath || path.relative(servedOutputsRoot, filePath).startsWith("..")) {
      return undefined;
    }
    return toOutputUrl(filePath);
  }

  function decorateHotelSingleAllRatePlansResult(result: HotelSingleAllRatePlansResult): HotelSingleAllRatePlansResult {
    return {
      ...result,
      resultUrl: outputUrlIfServed(result.resultPath) ?? result.resultUrl,
      diagnosticReviewUrl: outputUrlIfServed(result.diagnosticReviewPath) ?? result.diagnosticReviewUrl,
      platforms: result.platforms.map((platform) => ({
        ...platform,
        screenshotUrl: outputUrlIfServed(platform.screenshotPath) ?? platform.screenshotUrl
      }))
    };
  }

  function decorateAliHotelSingleVerifyResult(result: AliHotelSingleVerifyResult): AliHotelSingleVerifyResult {
    const platformResult = result.result;
    if (!platformResult?.screenshotPath || path.relative(servedOutputsRoot, platformResult.screenshotPath).startsWith("..")) {
      return result;
    }

    return {
      ...result,
      result: {
        ...platformResult,
        screenshotUrl: toOutputUrl(platformResult.screenshotPath)
      }
    };
  }

  function decorateAliHotelMatchResult(result: AliHotelMatchProbeResult): AliHotelMatchProbeResult {
    return {
      ...result,
      samples: result.samples.map((sample) => ({
        ...sample,
        qingmaoQuote: decorateHotelQuote(sample.qingmaoQuote),
        aliQuote: decorateHotelQuote(sample.aliQuote)
      }))
    };
  }

  function decorateHotelQuote<T extends { screenshotPath?: string; screenshotUrl?: string } | null>(quote: T): T {
    if (!quote?.screenshotPath || path.relative(servedOutputsRoot, quote.screenshotPath).startsWith("..")) {
      return quote;
    }

    return {
      ...quote,
      screenshotUrl: toOutputUrl(quote.screenshotPath)
    };
  }

  function decorateHotelRatePlanProbeResult(result: HotelRatePlanProbeResult): HotelRatePlanProbeResult {
    return {
      ...result,
      plans: result.plans.map((plan) => ({
        ...plan,
        samples: plan.samples.map((sample) => ({
          ...sample,
          quotes: sample.quotes.map((quote) => {
            if (!quote.screenshotPath || path.relative(servedOutputsRoot, quote.screenshotPath).startsWith("..")) {
              return quote;
            }

            return {
              ...quote,
              screenshotUrl: toOutputUrl(quote.screenshotPath)
            };
          })
        }))
      }))
    };
  }

  function decorateHotelAllRatePlanProbeResult(result: HotelAllRatePlanProbeResult): HotelAllRatePlanProbeResult {
    return {
      ...result,
      samples: result.samples.map((sample) => ({
        ...sample,
        quotes: sample.quotes.map((quote) => decorateHotelQuote(quote))
      }))
    };
  }

  function decorateHotelCalibrationResult(result: HotelCalibrationResult): HotelCalibrationResult {
    return {
      ...result,
      samples: result.samples.map((sample) => ({
        ...sample,
        platforms: sample.platforms.map((platform) => {
          if (!platform.screenshotPath || path.relative(servedOutputsRoot, platform.screenshotPath).startsWith("..")) {
            return platform;
          }

          return {
            ...platform,
            screenshotUrl: toOutputUrl(platform.screenshotPath)
          };
        })
      }))
    };
  }

  function decorateSameFlightComparisonResult(result: SameFlightComparisonProbeResult): SameFlightComparisonProbeResult {
    return {
      ...result,
      quotes: result.quotes.map((quote) => {
        if (!quote.screenshotPath || path.relative(servedOutputsRoot, quote.screenshotPath).startsWith("..")) {
          return quote;
        }

        return {
          ...quote,
          screenshotUrl: toOutputUrl(quote.screenshotPath)
        };
      })
    };
  }

  function decorateZtripResult(result: ZtripProbeResult): ZtripProbeResult {
    return {
      ...result,
      checks: result.checks.map((check) => {
        if (!check.screenshotPath || path.relative(servedOutputsRoot, check.screenshotPath).startsWith("..")) {
          return check;
        }

        return {
          ...check,
          screenshotUrl: toOutputUrl(check.screenshotPath)
        };
      })
    };
  }

  function decorateZtripFlightResult(result: ZtripFlightProbeResult): ZtripFlightProbeResult {
    if (!result.screenshotPath || path.relative(servedOutputsRoot, result.screenshotPath).startsWith("..")) {
      return result;
    }

    return {
      ...result,
      screenshotUrl: toOutputUrl(result.screenshotPath)
    };
  }

  function decorateZtripHotelResult(result: ZtripHotelProbeResult): ZtripHotelProbeResult {
    if (!result.screenshotPath || path.relative(servedOutputsRoot, result.screenshotPath).startsWith("..")) {
      return result;
    }

    return {
      ...result,
      screenshotUrl: toOutputUrl(result.screenshotPath)
    };
  }

  app.use(express.json());
  app.use("/outputs", express.static(servedOutputsRoot));

  app.get("/api/status", (_req, res) => {
    res.json({
      hasBatch: Boolean(state.batch),
      batchId: state.batch?.id ?? null,
      generatedAt: state.batch?.generatedAt ?? null,
      sampleCount: state.batch?.sampleCount ?? 0,
      flightCount: state.batch?.samples.length ?? 0,
      hotelCount: state.batch?.hotels?.length ?? 0,
      successCount: state.batch?.successCount ?? 0,
      failedCount: state.batch?.failedCount ?? 0,
      artifacts: state.artifacts,
      activeOperation: serializeActiveOperation(activeOperation),
      thirdVersion: buildThirdVersionResponse()
    });
  });

  app.post("/api/third-version/config", async (req, res) => {
    const parsed = parseThirdVersionOptionsInput(req.body, state.thirdVersionOptions);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error, thirdVersion: buildThirdVersionResponse() });
      return;
    }

    state.thirdVersionOptions = parsed.options;
    await persistCurrentBatchState();
    res.json({ thirdVersion: buildThirdVersionResponse() });
  });

  app.post("/api/collection/pause", (_req, res) => {
    if (!activeOperation) {
      res.status(409).json({ error: "当前没有正在运行的采集任务。" });
      return;
    }
    if (activeOperation.state === "stopping") {
      res.status(409).json({ error: "采集正在停止，不能再暂停。", activeOperation: serializeActiveOperation(activeOperation) });
      return;
    }

    activeOperation.control.pause();
    activeOperation.state = "paused";
    activeOperation.pauseRequestedAt = new Date().toISOString();
    refreshOperationControls(activeOperation);
    res.json({ message: "采集已暂停，当前任务停在下一个安全点。", activeOperation: serializeActiveOperation(activeOperation) });
  });

  app.post("/api/collection/resume", (_req, res) => {
    if (!activeOperation) {
      res.status(409).json({ error: "当前没有已暂停的采集任务。" });
      return;
    }
    if (activeOperation.state !== "paused") {
      res.status(409).json({ error: "当前采集没有处于暂停状态。", activeOperation: serializeActiveOperation(activeOperation) });
      return;
    }

    activeOperation.control.resume();
    activeOperation.state = "running";
    refreshOperationControls(activeOperation);
    res.json({ message: "采集已继续。", activeOperation: serializeActiveOperation(activeOperation) });
  });

  app.post("/api/collection/stop", (_req, res) => {
    if (!activeOperation) {
      res.status(409).json({ error: "当前没有正在运行的采集任务。" });
      return;
    }
    if (activeOperation.state === "stopping") {
      res.json({ message: "采集正在停止。", activeOperation: serializeActiveOperation(activeOperation) });
      return;
    }

    activeOperation.control.stop();
    activeOperation.state = "stopping";
    activeOperation.stopRequestedAt = new Date().toISOString();
    refreshOperationControls(activeOperation);
    res.json({ message: "采集已请求停止，本轮不会生成半成品批次。", activeOperation: serializeActiveOperation(activeOperation) });
  });

  app.post("/api/collect", async (_req, res, next) => {
    await runExclusiveOperation("模拟采集", res, next, async () => {
      const batch = buildFakeBatch(new Date());
      return exportThirdVersionArtifacts(batch);
    });
  });

  app.post("/api/collect-real-domestic", async (req, res, next) => {
    await runExclusiveOperation("国内真实采集", res, next, async (control) => {
      const rawLimit = isRecord(req.body) && typeof req.body.limit === "number" ? req.body.limit : undefined;
      const batch = await pilotCollector.runDomesticBatchCollection(rawLimit, control);
      return exportThirdVersionArtifacts(batch);
    });
  });

  app.post("/api/collect-real-international", async (req, res, next) => {
    await runExclusiveOperation("国际真实采集", res, next, async (control) => {
      const rawLimit = isRecord(req.body) && typeof req.body.limit === "number" ? req.body.limit : undefined;
      const batch = await pilotCollector.runInternationalBatchCollection(rawLimit, control);
      return exportThirdVersionArtifacts(batch);
    });
  });

  app.post("/api/collect-real-full", async (req, res, next) => {
    const parsed = parseThirdVersionOptionsInput(req.body, state.thirdVersionOptions);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error, thirdVersion: buildThirdVersionResponse() });
      return;
    }

    await runExclusiveOperation("完整真实采集", res, next, async (control) => {
      state.thirdVersionOptions = parsed.options;
      const batch = await pilotCollector.runFullBatchCollection({
        ...(thirdVersionCollectionLimits(state.thirdVersionOptions) ?? {}),
        control
      });
      return exportThirdVersionArtifacts(batch);
    });
  });

  app.post("/api/acceptance/second-version-final/run", async (_req, res, next) => {
    await runExclusiveOperation("第二版最终验收：航班 + 酒店连续完整采集", res, next, async (control) => {
      const startedAt = new Date();
      const flightBatch = await pilotCollector.runFullBatchCollection({ control });
      await control.waitIfPaused();
      control.throwIfStopped();
      const hotelResult = await pilotCollector.runHotelScaleValidationProbe({ limit: 40, disableBudgets: true });
      await control.waitIfPaused();
      control.throwIfStopped();
      const batch = buildSecondVersionAcceptanceBatch(flightBatch, hotelResult, new Date());
      const persisted = await exportThirdVersionArtifacts(batch);
      const endedAt = new Date();

      return {
        ...persisted,
        acceptance: {
          status: "passed",
          startedAt: startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          durationMs: endedAt.getTime() - startedAt.getTime(),
          flightBatchId: flightBatch.id,
          flightSuccessCount: flightBatch.samples.length,
          flightFailedCount: flightBatch.failedCount,
          hotelStatus: hotelResult.status,
          hotelSuccessCount: hotelResult.completedCount,
          hotelFailedCount: hotelResult.failedCount + hotelResult.partialCount + hotelResult.skippedCount + hotelResult.timeoutCount + hotelResult.unattemptedCount,
          hotelSummaryPath: hotelResult.summaryPath,
          hotelDiagnosticReviewPath: hotelResult.diagnosticReviewPath
        }
      };
    });
  });

  app.post("/api/acceptance/second-version-final/finalize-current", async (_req, res, next) => {
    await runExclusiveOperation("第二版最终验收：生成航班 + 酒店一体化交付物", res, next, async () => {
      const currentBatch = state.batch ? getThirdVersionSourceBatch(state.batch) : null;
      if (!currentBatch || currentBatch.samples.length !== 20) {
        res.status(400);
        return { error: `当前航班批次未达标：需要 20 条航班，当前 ${currentBatch?.samples.length ?? 0} 条。` };
      }
      if (state.hotelScaleValidation.status !== "completed" || state.hotelScaleValidation.completedCount !== 40) {
        res.status(400);
        return {
          error: `当前酒店验收未达标：需要 40 家完整酒店，当前 ${state.hotelScaleValidation.completedCount} 家，状态 ${state.hotelScaleValidation.status}。`
        };
      }

      const batch = buildSecondVersionAcceptanceBatch(currentBatch, state.hotelScaleValidation, new Date());
      const persisted = await exportThirdVersionArtifacts(batch);

      return {
        ...persisted,
        acceptance: {
          status: "passed",
          flightBatchId: currentBatch.id,
          flightSuccessCount: currentBatch.samples.length,
          flightFailedCount: currentBatch.failedCount,
          hotelStatus: state.hotelScaleValidation.status,
          hotelSuccessCount: state.hotelScaleValidation.completedCount,
          hotelFailedCount: state.hotelScaleValidation.failedCount
            + state.hotelScaleValidation.partialCount
            + state.hotelScaleValidation.skippedCount
            + state.hotelScaleValidation.timeoutCount
            + state.hotelScaleValidation.unattemptedCount,
          hotelSummaryPath: state.hotelScaleValidation.summaryPath,
          hotelDiagnosticReviewPath: state.hotelScaleValidation.diagnosticReviewPath
        }
      };
    });
  });

  app.post("/api/artifacts/regenerate", async (_req, res, next) => {
    await runExclusiveOperation("重新生成交付包", res, next, async () => {
      const currentBatch = state.batch;
      if (!currentBatch) {
        res.status(400);
        return { error: "还没有可用批次，不能重新生成交付包。" };
      }

      return exportThirdVersionArtifacts(currentBatch);
    });
  });

  app.get("/api/pilot/status", (_req, res) => {
    state.pilot = pilotCollector.getStatus();
    res.json(decoratePilotResult(state.pilot));
  });

  app.post("/api/pilot/open-login", async (_req, res, next) => {
    await runExclusiveOperation("打开登录浏览器", res, next, async () => {
      state.pilot = await pilotCollector.openLoginSession();
      return decoratePilotResult(state.pilot);
    });
  });

  app.post("/api/pilot/run-silent-probe", async (_req, res, next) => {
    await runExclusiveOperation("后台探测", res, next, async () => {
      state.pilot = await pilotCollector.runSilentProbe();
      return decoratePilotResult(state.pilot);
    });
  });

  app.post("/api/pilot/run-attached-probe", async (_req, res, next) => {
    await runExclusiveOperation("连接当前登录窗口", res, next, async () => {
      state.pilot = await pilotCollector.runAttachedProbe();
      return decoratePilotResult(state.pilot);
    });
  });

  app.get("/api/pilot/qingmao-candidates/status", (_req, res) => {
    state.qingmaoCandidates = pilotCollector.getQingmaoCandidateStatus();
    res.json(decorateQingmaoCandidateResult(state.qingmaoCandidates));
  });

  app.post("/api/pilot/qingmao-candidates/run", async (_req, res, next) => {
    await runExclusiveOperation("读取青猫候选航班", res, next, async () => {
      state.qingmaoCandidates = await pilotCollector.runQingmaoCandidateProbe();
      return decorateQingmaoCandidateResult(state.qingmaoCandidates);
    });
  });

  app.get("/api/pilot/qingmao-hotel-candidates/status", (_req, res) => {
    state.qingmaoHotelCandidates = pilotCollector.getQingmaoHotelCandidateStatus();
    res.json(decorateQingmaoHotelCandidateResult(state.qingmaoHotelCandidates));
  });

  app.post("/api/pilot/qingmao-hotel-candidates/run", async (_req, res, next) => {
    await runExclusiveOperation("读取青猫酒店候选池", res, next, async () => {
      state.qingmaoHotelCandidates = await pilotCollector.runQingmaoHotelCandidateProbe();
      return decorateQingmaoHotelCandidateResult(state.qingmaoHotelCandidates);
    });
  });

  app.get("/api/pilot/hotel-main-rate/status", (_req, res) => {
    state.hotelMainRate = pilotCollector.getHotelMainRateStatus();
    res.json(decorateHotelMainRateResult(state.hotelMainRate));
  });

  app.post("/api/pilot/hotel-main-rate/run", async (_req, res, next) => {
    await runExclusiveOperation("酒店主口径验证", res, next, async () => {
      state.hotelMainRate = await pilotCollector.runHotelMainRateProbe();
      return decorateHotelMainRateResult(state.hotelMainRate);
    });
  });

  app.get("/api/pilot/hotel-group-main-rate/status", (_req, res) => {
    state.hotelGroupMainRate = pilotCollector.getHotelGroupMainRateStatus();
    res.json(decorateHotelGroupMainRateResult(state.hotelGroupMainRate));
  });

  app.post("/api/pilot/hotel-group-main-rate/run", async (_req, res, next) => {
    await runExclusiveOperation("酒店集团主口径小样本验证", res, next, async () => {
      state.hotelGroupMainRate = await pilotCollector.runHotelGroupMainRateProbe();
      return decorateHotelGroupMainRateResult(state.hotelGroupMainRate);
    });
  });

  app.get("/api/pilot/hotel-small-batch/status", (_req, res) => {
    state.hotelSmallBatch = pilotCollector.getHotelSmallBatchStatus();
    res.json(decorateHotelSmallBatchResult(state.hotelSmallBatch));
  });

  app.post("/api/pilot/hotel-small-batch/run", async (_req, res, next) => {
    await runExclusiveOperation("10 家酒店小放量", res, next, async () => {
      state.hotelSmallBatch = await pilotCollector.runHotelSmallBatchProbe();
      return decorateHotelSmallBatchResult(state.hotelSmallBatch);
    });
  });

  app.get("/api/pilot/hotel-scale-validation/status", (_req, res) => {
    state.hotelScaleValidation = pilotCollector.getHotelScaleValidationStatus();
    res.json(decorateHotelScaleValidationResult(state.hotelScaleValidation));
  });

  app.post("/api/pilot/hotel-scale-validation/run", async (req, res, next) => {
    const parsed = parseHotelScaleValidationInput(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    await runExclusiveOperation("40 家酒店放量验证 / 准生产诊断跑", res, next, async () => {
      state.hotelScaleValidation = await pilotCollector.runHotelScaleValidationProbe(parsed.input);
      return decorateHotelScaleValidationResult(state.hotelScaleValidation);
    });
  });

  app.get("/api/pilot/hotel-single-diagnosis/status", (_req, res) => {
    state.hotelSingleDiagnosis = pilotCollector.getHotelSingleDiagnosisStatus();
    res.json(decorateHotelSingleDiagnosisResult(state.hotelSingleDiagnosis));
  });

  app.post("/api/pilot/hotel-single-diagnosis/run", async (req, res, next) => {
    const parsed = parseHotelSingleDiagnosisInput(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    await runExclusiveOperation("严格单酒店诊断", res, next, async () => {
      state.hotelSingleDiagnosis = await pilotCollector.runHotelSingleDiagnosisProbe(parsed.input);
      return decorateHotelSingleDiagnosisResult(state.hotelSingleDiagnosis);
    });
  });

  app.get("/api/pilot/hotel-single-all-rate-plans/status", (_req, res) => {
    state.hotelSingleAllRatePlans = pilotCollector.getHotelSingleAllRatePlansStatus();
    res.json(decorateHotelSingleAllRatePlansResult(state.hotelSingleAllRatePlans));
  });

  app.post("/api/pilot/hotel-single-all-rate-plans/run", async (req, res, next) => {
    const parsed = parseHotelSingleAllRatePlansInput(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    await runExclusiveOperation("指定单酒店一次性四口径复验", res, next, async () => {
      state.hotelSingleAllRatePlans = await pilotCollector.runHotelSingleAllRatePlansProbe(parsed.input);
      return decorateHotelSingleAllRatePlansResult(state.hotelSingleAllRatePlans);
    });
  });

  app.get("/api/pilot/ali-hotel-single/status", (_req, res) => {
    state.aliHotelSingleVerify = pilotCollector.getAliHotelSingleVerifyStatus();
    res.json(decorateAliHotelSingleVerifyResult(state.aliHotelSingleVerify));
  });

  app.post("/api/pilot/ali-hotel-single/run", async (req, res, next) => {
    const parsed = parseAliHotelSingleVerifyInput(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    await runExclusiveOperation("指定酒店阿里-only复验", res, next, async () => {
      state.aliHotelSingleVerify = await pilotCollector.runAliHotelSingleVerifyProbe(parsed.input);
      return decorateAliHotelSingleVerifyResult(state.aliHotelSingleVerify);
    });
  });

  app.get("/api/pilot/ali-hotel-match/status", (_req, res) => {
    state.aliHotelMatch = pilotCollector.getAliHotelMatchStatus();
    res.json(decorateAliHotelMatchResult(state.aliHotelMatch));
  });

  app.post("/api/pilot/ali-hotel-match/run", async (_req, res, next) => {
    await runExclusiveOperation("阿里酒店同店匹配验证", res, next, async () => {
      state.aliHotelMatch = await pilotCollector.runAliHotelMatchProbe(3);
      return decorateAliHotelMatchResult(state.aliHotelMatch);
    });
  });

  app.get("/api/pilot/hotel-rate-plan-probe/status", (_req, res) => {
    state.hotelRatePlanProbe = pilotCollector.getHotelRatePlanProbeStatus();
    res.json(decorateHotelRatePlanProbeResult(state.hotelRatePlanProbe));
  });

  app.post("/api/pilot/hotel-rate-plan-probe/run", async (_req, res, next) => {
    await runExclusiveOperation("酒店主口径难度探针", res, next, async () => {
      state.hotelRatePlanProbe = await pilotCollector.runHotelRatePlanProbe();
      return decorateHotelRatePlanProbeResult(state.hotelRatePlanProbe);
    });
  });

  app.get("/api/pilot/hotel-all-rate-plans/status", (_req, res) => {
    state.hotelAllRatePlan = pilotCollector.getHotelAllRatePlanStatus();
    res.json(decorateHotelAllRatePlanProbeResult(state.hotelAllRatePlan));
  });

  app.post("/api/pilot/hotel-all-rate-plans/run", async (_req, res, next) => {
    await runExclusiveOperation("四平台四口径酒店价格采集", res, next, async () => {
      state.hotelAllRatePlan = await pilotCollector.runHotelAllRatePlanProbe();
      return decorateHotelAllRatePlanProbeResult(state.hotelAllRatePlan);
    });
  });

  app.get("/api/pilot/hotel-calibration/status", (_req, res) => {
    state.hotelCalibration = pilotCollector.getHotelCalibrationStatus();
    res.json(decorateHotelCalibrationResult(state.hotelCalibration));
  });

  app.post("/api/pilot/hotel-calibration/run", async (req, res, next) => {
    const parsed = parseHotelCalibrationInput(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    await runExclusiveOperation("3 家酒店校准测试", res, next, async () => {
      state.hotelCalibration = await pilotCollector.runHotelCalibrationProbe(parsed.input);
      return decorateHotelCalibrationResult(state.hotelCalibration);
    });
  });

  app.post("/api/pilot/cleanup-browser-pages", async (_req, res, next) => {
    await runExclusiveOperation("清理采集临时窗口", res, next, async (): Promise<BrowserCleanupResult> => {
      return await pilotCollector.cleanupBrowserPages();
    });
  });

  app.get("/api/pilot/same-flight/status", (_req, res) => {
    state.sameFlightComparison = pilotCollector.getSameFlightComparisonStatus();
    res.json(decorateSameFlightComparisonResult(state.sameFlightComparison));
  });

  app.post("/api/pilot/same-flight/run", async (_req, res, next) => {
    await runExclusiveOperation("随机同航班比价", res, next, async () => {
      state.sameFlightComparison = await pilotCollector.runSameFlightComparisonProbe();
      return decorateSameFlightComparisonResult(state.sameFlightComparison);
    });
  });

  app.get("/api/pilot/ztrip/status", (_req, res) => {
    state.ztrip = pilotCollector.getZtripStatus();
    res.json(decorateZtripResult(state.ztrip));
  });

  app.post("/api/pilot/ztrip/run", async (_req, res, next) => {
    await runExclusiveOperation("在途商旅验证", res, next, async () => {
      state.ztrip = await pilotCollector.runZtripProbe();
      return decorateZtripResult(state.ztrip);
    });
  });

  app.get("/api/pilot/ztrip-flight/status", (_req, res) => {
    state.ztripFlight = pilotCollector.getZtripFlightStatus();
    res.json(decorateZtripFlightResult(state.ztripFlight));
  });

  app.post("/api/pilot/ztrip-flight/run", async (_req, res, next) => {
    await runExclusiveOperation("在途航班样本采集", res, next, async () => {
      state.ztripFlight = await pilotCollector.runZtripFlightProbe();
      return decorateZtripFlightResult(state.ztripFlight);
    });
  });

  app.get("/api/pilot/ztrip-hotel/status", (_req, res) => {
    state.ztripHotel = pilotCollector.getZtripHotelStatus();
    res.json(decorateZtripHotelResult(state.ztripHotel));
  });

  app.post("/api/pilot/ztrip-hotel/run", async (_req, res, next) => {
    await runExclusiveOperation("在途酒店样本采集", res, next, async () => {
      state.ztripHotel = await pilotCollector.runZtripHotelProbe();
      return decorateZtripHotelResult(state.ztripHotel);
    });
  });

  app.get("/api/batch/latest", (_req, res) => {
    if (!state.batch) {
      res.status(404).json({ error: "暂无可用采集批次" });
      return;
    }

    res.json({
      batch: state.batch,
      artifacts: state.artifacts,
      thirdVersion: buildThirdVersionResponse()
    });
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : "未知错误";
    res.status(500).json({ error: message });
  });

  return app;
}
