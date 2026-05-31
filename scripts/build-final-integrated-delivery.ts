import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { exportBatchWorkbook } from "../server/exporters/excel";
import { exportOfflinePackage } from "../server/exporters/offlinePackage";
import { enrichHotelSampleDisplayDecision } from "../src/domain/hotelRatePlans";
import type { CollectionBatch, HotelGroup, HotelRatePlanLabel, HotelSample, PlatformName, PlatformQuote, QuoteStatus } from "../src/domain/types";

const zipExec = promisify(execFile);

const PROJECT_ROOT = process.cwd();
const OUTPUT_ROOT = path.join(PROJECT_ROOT, "outputs", "current");
const FLIGHT_BATCH_PATH = "/tmp/qingmao-real-full-shared-allowed.json";
const HOTEL_TRACE_PATH = path.join(OUTPUT_ROOT, "delivery-drafts", "hotel-client-draft-2026-05-29-111801", "internal-trace.json");
const FINAL_ID = "batch-2026-05-30-024928-flight-hotel-integrated";
const RATE_LABELS: HotelRatePlanLabel[] = ["大床无早餐", "大床有早餐", "双床无早餐", "双床有早餐"];
const PLATFORMS: PlatformName[] = ["青猫差旅", "携程商旅", "阿里商旅", "在途商旅"];

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function platformStatus(status: string | undefined): QuoteStatus {
  if (status === "available") return "可订";
  if (status === "not-found" || status === "platform-no-rate") return "未展示";
  return "采集失败";
}

function groupName(sourceGroup: string): HotelGroup {
  const map: Record<string, HotelGroup> = {
    "首旅如家": "如家集团",
    "华住": "华住集团",
    "锦江": "锦江集团",
    "东呈": "东呈集团",
    "亚朵": "亚朵集团"
  };
  return map[sourceGroup] ?? "东呈集团";
}

function brandName(sourceGroup: string, hotelName: string) {
  if (sourceGroup === "首旅如家") return "首旅如家";
  if (sourceGroup === "亚朵") return "亚朵酒店";
  if (sourceGroup === "东呈") {
    if (hotelName.includes("城市便捷")) return "城市便捷";
    if (hotelName.includes("柏曼")) return "柏曼";
    if (hotelName.includes("宜尚")) return "宜尚";
  }
  return sourceGroup;
}

function hotelQuote(rawQuotes: any[], platform: PlatformName, ratePlan: HotelRatePlanLabel, hotelId: string): PlatformQuote {
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
    status: platformStatus(raw?.status),
    evidencePath,
    sourceEvidencePath,
    sourceUrl: raw?.finalUrl ?? "",
    rawHotelName: raw?.hotelName ?? "",
    rawRoomName: raw?.roomType ?? "",
    normalizedRoomLabel: ratePlan,
    missingReason: available ? undefined : raw?.error || raw?.status || "暂无该口径价格"
  } as PlatformQuote & { sourceEvidencePath?: string };
}

function hotelCoverSource(rawQuotes: any[]) {
  const qingmaoCover = rawQuotes.find(
    (quote) => quote.platform === "青猫差旅" && quote.screenshotPath && fs.existsSync(quote.screenshotPath)
  );
  return qingmaoCover?.screenshotPath ?? "";
}

function buildHotelSample(resultPath: string, index: number): HotelSample {
  const result = readJson<any>(resultPath);
  const candidate = result.selectedCandidate ?? {};
  const hotelName = candidate.hotelName ?? result.query?.keyword ?? `酒店-${index + 1}`;
  const hotelId = `hotel-${String(index + 1).padStart(2, "0")}`;
  const coverImagePath = hotelCoverSource(result.quotes ?? []);
  const hotel: HotelSample = {
    id: hotelId,
    group: groupName(result.group),
    brand: brandName(result.group, hotelName),
    hotelName,
    city: result.query?.city ?? "",
    checkInDate: result.query?.checkInDate ?? "",
    checkOutDate: result.query?.checkOutDate ?? "",
    nights: result.query?.nights ?? 1,
    primaryRatePlan: "大床无早餐",
    coverImagePath: coverImagePath || undefined,
    coverImageSource: coverImagePath ? "青猫差旅" : undefined,
    coverImageStatus: coverImagePath ? "saved" : "missing",
    ratePlans: RATE_LABELS.map((label) => ({
      label,
      quotes: PLATFORMS.map((platform) => hotelQuote(result.quotes ?? [], platform, label, hotelId))
    }))
  };
  return enrichHotelSampleDisplayDecision(hotel);
}

function buildBatch(): CollectionBatch {
  const flightPayload = readJson<{ batch: CollectionBatch }>(FLIGHT_BATCH_PATH);
  const trace = readJson<{ completedResultJson: string[]; partialRecords?: any[] }>(HOTEL_TRACE_PATH);
  const flights = flightPayload.batch.samples.map((sample) => ({
    ...sample,
    quotes: sample.quotes.map((quote) => {
      const sourceEvidencePath = quote.evidencePath.startsWith("outputs/current/")
        ? quote.evidencePath
        : path.join("outputs", "current", quote.evidencePath);
      return {
        ...quote,
        evidencePath: path.join("evidence", "flights", path.basename(sourceEvidencePath)),
        sourceEvidencePath
      } as PlatformQuote & { sourceEvidencePath?: string };
    })
  }));
  const hotels = trace.completedResultJson.map(buildHotelSample);

  return {
    id: FINAL_ID,
    status: "ready",
    generatedAt: new Date().toISOString(),
    sampleCount: flights.length + hotels.length,
    successCount: flights.length + hotels.length,
    failedCount: trace.partialRecords?.length ?? 0,
    samples: flights,
    hotels,
    failureNotes: [
      `航班来源批次：${flightPayload.batch.id}，四平台完整样本 ${flights.length} 条。`,
      `酒店来源批次：hotel-scale-validation-2026-05-28-222300，进入客户主展示 ${hotels.length} 家；不完整酒店仅进入后台留痕。`
    ]
  };
}

async function main() {
  const batch = buildBatch();
  const deliveryDir = path.join(OUTPUT_ROOT, `final-integrated-delivery-${FINAL_ID}`);
  await fsp.rm(deliveryDir, { recursive: true, force: true });
  await fsp.mkdir(deliveryDir, { recursive: true });

  const workbook = await exportBatchWorkbook(batch, deliveryDir);
  const offlinePackage = await exportOfflinePackage(batch, deliveryDir);

  const finalZip = path.join(OUTPUT_ROOT, `青猫差旅第二版正式交付包-航班酒店一体化-2026-05-30.zip`);
  await fsp.rm(finalZip, { force: true });
  await fsp.rm(offlinePackage.path, { force: true });
  await zipExec("zip", ["-qr", finalZip, path.basename(deliveryDir)], { cwd: OUTPUT_ROOT });

  console.log(JSON.stringify({
    deliveryDir,
    finalZip,
    workbook,
    offlinePackage,
    flightCount: batch.samples.length,
    hotelCount: batch.hotels?.length ?? 0
  }, null, 2));
}

await main();
