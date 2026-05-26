import express from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFakeBatch } from "../src/domain/fakeBatch";
import type { CollectionBatch } from "../src/domain/types";
import {
  type AliHotelSingleVerifyInput,
  type AliHotelSingleVerifyResult,
  createPlaywrightPilotCollector,
  type AliHotelMatchProbeResult,
  type BrowserCleanupResult,
  type HotelAllRatePlanProbeResult,
  type HotelCalibrationInput,
  type HotelCalibrationResult,
  type HotelScaleValidationInput,
  type HotelScaleValidationResult,
  type HotelGroupMainRateProbeResult,
  type HotelSmallBatchProbeResult,
  type HotelMainRateProbeResult,
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
  pilot: PilotResult;
  qingmaoCandidates: QingmaoCandidateProbeResult;
  qingmaoHotelCandidates: QingmaoHotelCandidateProbeResult;
  hotelMainRate: HotelMainRateProbeResult;
  hotelGroupMainRate: HotelGroupMainRateProbeResult;
  hotelSmallBatch: HotelSmallBatchProbeResult;
  hotelScaleValidation: HotelScaleValidationResult;
  hotelSingleDiagnosis: HotelSingleDiagnosisProbeResult;
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
}

interface ArtifactExporters {
  workbook: typeof exportBatchWorkbook;
  offlinePackage: typeof exportOfflinePackage;
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

const HOTEL_SINGLE_DIAGNOSIS_RATE_PLANS = ["大床无早餐", "大床有早餐", "双床无早餐", "双床有早餐"] as const;
const HOTEL_CALIBRATION_COMPETITOR_PLATFORMS = ["阿里商旅", "在途商旅", "携程商旅"] as const;

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

  if (value.limit !== undefined && (!Number.isInteger(limit) || !limit || limit < 5 || limit > 40 || limit % 5 !== 0)) {
    return { ok: false, error: "limit 必须是 5 到 40 之间的 5 的倍数" };
  }

  if ((checkInDate && !checkOutDate) || (!checkInDate && checkOutDate)) {
    return { ok: false, error: "checkInDate 和 checkOutDate 必须同时传入" };
  }
  if (!checkInDate && !checkOutDate) {
    return { ok: true, input: limit ? { limit } : {} };
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
      ...(limit ? { limit } : {})
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

  function loadPersistedBatchState(): Pick<AppState, "batch" | "artifacts"> {
    const persistedStatePath = path.join(outputDir, "current-state.json");

    try {
      if (fs.existsSync(persistedStatePath)) {
        const persisted = JSON.parse(fs.readFileSync(persistedStatePath, "utf8")) as Pick<AppState, "batch" | "artifacts">;
        const artifacts = restoreArtifactState(persisted.artifacts);
        if (persisted.batch && artifacts) {
          return {
            batch: persisted.batch,
            artifacts
          };
        }
      }

      if (!fs.existsSync(outputDir)) {
        return { batch: null, artifacts: null };
      }
    } catch {
      return { batch: null, artifacts: null };
    }

    return { batch: null, artifacts: null };
  }

  const persistedState = loadPersistedBatchState();
  const state: AppState = {
    batch: persistedState.batch,
    artifacts: persistedState.artifacts,
    pilot: pilotCollector.getStatus(),
    qingmaoCandidates: pilotCollector.getQingmaoCandidateStatus(),
    qingmaoHotelCandidates: pilotCollector.getQingmaoHotelCandidateStatus(),
    hotelMainRate: pilotCollector.getHotelMainRateStatus(),
    hotelGroupMainRate: pilotCollector.getHotelGroupMainRateStatus(),
    hotelSmallBatch: pilotCollector.getHotelSmallBatchStatus(),
    hotelScaleValidation: pilotCollector.getHotelScaleValidationStatus(),
    hotelSingleDiagnosis: pilotCollector.getHotelSingleDiagnosisStatus(),
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
      JSON.stringify({ batch: state.batch, artifacts: state.artifacts }, null, 2),
      "utf8"
    );
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
      artifacts: state.artifacts
    };
  }

  async function runExclusiveOperation(
    label: string,
    res: express.Response,
    next: express.NextFunction,
    task: () => Promise<unknown>
  ) {
    if (activeOperation) {
      res.status(409).json({
        error: `正在${activeOperation.label}，请等待完成后再操作。`,
        activeOperation
      });
      return;
    }

    activeOperation = {
      label,
      startedAt: new Date().toISOString()
    };

    try {
      res.json(await task());
    } catch (error) {
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
      successCount: state.batch?.successCount ?? 0,
      failedCount: state.batch?.failedCount ?? 0,
      artifacts: state.artifacts,
      activeOperation
    });
  });

  app.post("/api/collect", async (_req, res, next) => {
    await runExclusiveOperation("模拟采集", res, next, async () => {
      const batch = buildFakeBatch(new Date());
      const excel = await workbookExporter(batch, outputDir);
      const offlinePackage = await offlinePackageExporter(batch, outputDir);

      return setCurrentBatchArtifacts(batch, excel.path, offlinePackage.path);
    });
  });

  app.post("/api/collect-real-domestic", async (req, res, next) => {
    await runExclusiveOperation("国内真实采集", res, next, async () => {
      const rawLimit = isRecord(req.body) && typeof req.body.limit === "number" ? req.body.limit : undefined;
      const batch = await pilotCollector.runDomesticBatchCollection(rawLimit);
      const excel = await workbookExporter(batch, outputDir);
      const offlinePackage = await offlinePackageExporter(batch, outputDir);

      return setCurrentBatchArtifacts(batch, excel.path, offlinePackage.path);
    });
  });

  app.post("/api/collect-real-international", async (req, res, next) => {
    await runExclusiveOperation("国际真实采集", res, next, async () => {
      const rawLimit = isRecord(req.body) && typeof req.body.limit === "number" ? req.body.limit : undefined;
      const batch = await pilotCollector.runInternationalBatchCollection(rawLimit);
      const excel = await workbookExporter(batch, outputDir);
      const offlinePackage = await offlinePackageExporter(batch, outputDir);

      return setCurrentBatchArtifacts(batch, excel.path, offlinePackage.path);
    });
  });

  app.post("/api/collect-real-full", async (_req, res, next) => {
    await runExclusiveOperation("完整真实采集", res, next, async () => {
      const batch = await pilotCollector.runFullBatchCollection();
      const excel = await workbookExporter(batch, outputDir);
      const offlinePackage = await offlinePackageExporter(batch, outputDir);

      return setCurrentBatchArtifacts(batch, excel.path, offlinePackage.path);
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
      artifacts: state.artifacts
    });
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : "未知错误";
    res.status(500).json({ error: message });
  });

  return app;
}
