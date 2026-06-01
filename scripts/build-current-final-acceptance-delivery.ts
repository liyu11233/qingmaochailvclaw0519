import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { exportBatchWorkbook } from "../server/exporters/excel";
import { exportOfflinePackage } from "../server/exporters/offlinePackage";
import { enrichHotelSampleDisplayDecision } from "../src/domain/hotelRatePlans";
import type { CollectionBatch, HotelGroup, HotelRatePlanLabel, HotelSample, PlatformName, PlatformQuote, QuoteStatus } from "../src/domain/types";

const PROJECT_ROOT = process.cwd();
const OUTPUT_ROOT = path.join(PROJECT_ROOT, "outputs", "current");
const CURRENT_STATE_PATH = path.join(OUTPUT_ROOT, "current-state.json");
const HOTEL_RUN_DIR = path.join(OUTPUT_ROOT, "pilot", "hotel-scale-validation", "hotel-scale-validation-2026-06-01-001634");
const HOTEL_RATE_PLAN_LABELS: HotelRatePlanLabel[] = ["大床无早餐", "大床有早餐", "双床无早餐", "双床有早餐"];
const PLATFORMS: PlatformName[] = ["青猫差旅", "携程商旅", "阿里商旅", "在途商旅"];

type HotelMainRateQuote = {
  platform: PlatformName;
  status: "available" | "not-found" | "platform-no-rate" | "parser-suspected-failed" | "failed" | "pending";
  price: number | null;
  hotelName: string;
  roomType: string;
  ratePlan: HotelRatePlanLabel;
  finalUrl?: string;
  screenshotPath?: string;
  diagnosisPath?: string;
  rawText?: string;
  error?: string;
};

type HotelScaleSample = {
  group?: string;
  query?: {
    city?: string;
    checkInDate?: string;
    checkOutDate?: string;
    nights?: number;
  };
  status: string;
  selectedCandidate?: {
    hotelName?: string;
  } | null;
  quotes?: HotelMainRateQuote[];
  coverImagePath?: string;
  coverImageSource?: PlatformName;
};

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function formatBatchTimestamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function toOutputUrl(filePath: string) {
  const relativePath = path.relative(path.join(PROJECT_ROOT, "outputs"), filePath);
  return `/outputs/${relativePath.split(path.sep).map(encodeURIComponent).join("/")}`;
}

function groupName(sourceGroup: string | undefined): HotelGroup {
  const map: Record<string, HotelGroup> = {
    "首旅如家": "如家集团",
    "如家集团": "如家集团",
    "华住": "华住集团",
    "华住集团": "华住集团",
    "锦江": "锦江集团",
    "锦江集团": "锦江集团",
    "东呈": "东呈集团",
    "东呈集团": "东呈集团",
    "亚朵": "亚朵集团",
    "亚朵集团": "亚朵集团",
    "亚朵酒店": "亚朵集团"
  };
  return map[sourceGroup ?? ""] ?? "东呈集团";
}

function brandName(sourceGroup: string | undefined, hotelName: string) {
  if (sourceGroup === "首旅如家" || sourceGroup === "如家集团") return "首旅如家";
  if (sourceGroup === "亚朵" || sourceGroup === "亚朵集团" || sourceGroup === "亚朵酒店") return "亚朵酒店";
  if (sourceGroup === "东呈" || sourceGroup === "东呈集团") {
    if (hotelName.includes("城市便捷")) return "城市便捷";
    if (hotelName.includes("柏曼")) return "柏曼";
    if (hotelName.includes("宜尚")) return "宜尚";
  }
  return sourceGroup ?? "";
}

function quoteStatus(status: HotelMainRateQuote["status"] | undefined): QuoteStatus {
  if (status === "available") return "可订";
  if (status === "not-found" || status === "platform-no-rate" || status === "pending") return "未展示";
  return "采集失败";
}

function hotelQuote(rawQuotes: HotelMainRateQuote[], platform: PlatformName, ratePlan: HotelRatePlanLabel, hotelId: string): PlatformQuote {
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

function buildHotelSample(sample: HotelScaleSample, index: number): HotelSample {
  const hotelName = sample.selectedCandidate?.hotelName ?? `酒店-${index + 1}`;
  const hotelId = `hotel-${String(index + 1).padStart(2, "0")}`;
  const coverImagePath = sample.coverImagePath && fs.existsSync(sample.coverImagePath) ? sample.coverImagePath : undefined;

  return enrichHotelSampleDisplayDecision({
    id: hotelId,
    group: groupName(sample.group),
    brand: brandName(sample.group, hotelName),
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
      quotes: PLATFORMS.map((platform) => hotelQuote(sample.quotes ?? [], platform, label, hotelId))
    }))
  });
}

function readCompletedHotelSamples() {
  const groups = fs.readdirSync(HOTEL_RUN_DIR)
    .map((entry) => path.join(HOTEL_RUN_DIR, entry, "group-summary.json"))
    .filter((filePath) => fs.existsSync(filePath))
    .sort();
  return groups.flatMap((groupPath) => {
    const group = readJson<{ samples: HotelScaleSample[] }>(groupPath);
    return group.samples.filter((sample) => sample.status === "completed");
  });
}

async function main() {
  const currentState = readJson<{ batch: CollectionBatch }>(CURRENT_STATE_PATH);
  const flightBatch = currentState.batch;
  const hotelSummary = readJson<{ status: string; completedCount: number; partialCount: number; failedCount: number; skippedCount: number; timeoutCount: number; unattemptedCount: number }>(
    path.join(HOTEL_RUN_DIR, "summary.json")
  );
  const completedHotels = readCompletedHotelSamples();

  if (flightBatch.status !== "ready" || flightBatch.samples.length !== 20) {
    throw new Error(`航班未达标：需要 20 条完整样本，当前 ${flightBatch.samples.length} 条，状态 ${flightBatch.status}`);
  }
  if (hotelSummary.status !== "completed" || hotelSummary.completedCount !== 40 || completedHotels.length !== 40) {
    throw new Error(`酒店未达标：需要 40 家完整样本，summary=${hotelSummary.completedCount}，明细=${completedHotels.length}，状态 ${hotelSummary.status}`);
  }

  const now = new Date();
  const hotels = completedHotels.map(buildHotelSample);
  const batch: CollectionBatch = {
    id: `batch-${formatBatchTimestamp(now)}-second-version-final-acceptance`,
    status: "ready",
    generatedAt: now.toISOString(),
    sampleCount: flightBatch.samples.length + hotels.length,
    successCount: flightBatch.samples.length + hotels.length,
    failedCount: hotelSummary.partialCount + hotelSummary.failedCount + hotelSummary.skippedCount + hotelSummary.timeoutCount + hotelSummary.unattemptedCount,
    samples: flightBatch.samples,
    hotels,
    failureNotes: [
      `航班来源批次：${flightBatch.id}，四平台完整样本 ${flightBatch.samples.length} 条。`,
      `酒店来源验收：${HOTEL_RUN_DIR}，四平台完整酒店 ${hotels.length} 家。`,
      ...(flightBatch.failureNotes ?? [])
    ]
  };

  const workbook = await exportBatchWorkbook(batch, OUTPUT_ROOT);
  const offlinePackage = await exportOfflinePackage(batch, OUTPUT_ROOT);
  await fsp.writeFile(
    CURRENT_STATE_PATH,
    JSON.stringify({
      batch,
      artifacts: {
        excel: toOutputUrl(workbook.path),
        offlinePackage: toOutputUrl(offlinePackage.path)
      }
    }, null, 2),
    "utf8"
  );

  process.stdout.write(JSON.stringify({
    batchId: batch.id,
    flightCount: batch.samples.length,
    hotelCount: batch.hotels?.length ?? 0,
    failedCount: batch.failedCount,
    excelPath: workbook.path,
    offlinePackagePath: offlinePackage.path,
    offlinePackageFilename: offlinePackage.filename
  }, null, 2));
}

await main();
