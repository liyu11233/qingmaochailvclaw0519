import express from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFakeBatch } from "../src/domain/fakeBatch";
import type { CollectionBatch } from "../src/domain/types";
import {
  createPlaywrightPilotCollector,
  type PilotCollector,
  type PilotResult,
  type QingmaoCandidateProbeResult,
  type SameFlightComparisonProbeResult
} from "./collectors/pilot";
import { exportBatchWorkbook } from "./exporters/excel";
import { exportSalesLongScreenshot } from "./exporters/offlinePackage";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const servedOutputsRoot = path.join(projectRoot, "outputs");

interface ArtifactState {
  excel: string;
  salesSnapshot: string;
}

interface AppState {
  batch: CollectionBatch | null;
  artifacts: ArtifactState | null;
  pilot: PilotResult;
  qingmaoCandidates: QingmaoCandidateProbeResult;
  sameFlightComparison: SameFlightComparisonProbeResult;
}

interface ActiveOperation {
  label: string;
  startedAt: string;
}

interface ArtifactExporters {
  workbook: typeof exportBatchWorkbook;
  salesSnapshot: typeof exportSalesLongScreenshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function restoreArtifactState(value: unknown): ArtifactState | null {
  if (!isRecord(value) || typeof value.excel !== "string") {
    return null;
  }

  const salesSnapshot = typeof value.salesSnapshot === "string" ? value.salesSnapshot : typeof value.offlinePackage === "string" ? value.offlinePackage : "";
  if (!salesSnapshot) {
    return null;
  }

  return {
    excel: value.excel,
    salesSnapshot
  };
}

export function createApp(options: { outputDir?: string; pilotCollector?: PilotCollector; exporters?: Partial<ArtifactExporters> } = {}) {
  const app = express();
  const outputDir = options.outputDir ?? path.join(servedOutputsRoot, "current");
  const workbookExporter = options.exporters?.workbook ?? exportBatchWorkbook;
  const salesSnapshotExporter = options.exporters?.salesSnapshot ?? exportSalesLongScreenshot;
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
    sameFlightComparison: pilotCollector.getSameFlightComparisonStatus()
  };

  async function persistCurrentBatchState() {
    await fsp.mkdir(outputDir, { recursive: true });
    await fsp.writeFile(
      path.join(outputDir, "current-state.json"),
      JSON.stringify({ batch: state.batch, artifacts: state.artifacts }, null, 2),
      "utf8"
    );
  }

  async function setCurrentBatchArtifacts(batch: CollectionBatch, excelPath: string, salesSnapshotPath: string) {
    state.batch = batch;
    state.artifacts = {
      excel: toOutputUrl(excelPath),
      salesSnapshot: toOutputUrl(salesSnapshotPath)
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
      const salesSnapshot = await salesSnapshotExporter(batch, outputDir);

      return setCurrentBatchArtifacts(batch, excel.path, salesSnapshot.path);
    });
  });

  app.post("/api/collect-real-domestic", async (req, res, next) => {
    await runExclusiveOperation("国内真实采集", res, next, async () => {
      const rawLimit = isRecord(req.body) && typeof req.body.limit === "number" ? req.body.limit : undefined;
      const batch = await pilotCollector.runDomesticBatchCollection(rawLimit);
      const excel = await workbookExporter(batch, outputDir);
      const salesSnapshot = await salesSnapshotExporter(batch, outputDir);

      return setCurrentBatchArtifacts(batch, excel.path, salesSnapshot.path);
    });
  });

  app.post("/api/collect-real-international", async (req, res, next) => {
    await runExclusiveOperation("国际真实采集", res, next, async () => {
      const rawLimit = isRecord(req.body) && typeof req.body.limit === "number" ? req.body.limit : undefined;
      const batch = await pilotCollector.runInternationalBatchCollection(rawLimit);
      const excel = await workbookExporter(batch, outputDir);
      const salesSnapshot = await salesSnapshotExporter(batch, outputDir);

      return setCurrentBatchArtifacts(batch, excel.path, salesSnapshot.path);
    });
  });

  app.post("/api/collect-real-full", async (_req, res, next) => {
    await runExclusiveOperation("完整真实采集", res, next, async () => {
      const batch = await pilotCollector.runFullBatchCollection();
      const excel = await workbookExporter(batch, outputDir);
      const salesSnapshot = await salesSnapshotExporter(batch, outputDir);

      return setCurrentBatchArtifacts(batch, excel.path, salesSnapshot.path);
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
