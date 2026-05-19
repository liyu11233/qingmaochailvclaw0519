import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CircleCheckBig,
  Clock3,
  Download,
  ExternalLink,
  FileSpreadsheet,
  LogIn,
  Monitor,
  PackageOpen,
  Plane,
  Radar,
  RefreshCw,
  ShieldCheck
} from "lucide-react";
import type { CollectionBatch } from "./domain/types";
import { type ArtifactLinks, buildDashboardView } from "./ui/viewModel";

interface StatusResponse {
  hasBatch: boolean;
  batchId: string | null;
  generatedAt: string | null;
  sampleCount: number;
  successCount: number;
  failedCount: number;
  artifacts: ArtifactLinks | null;
  activeOperation?: {
    label: string;
    startedAt: string;
  } | null;
}

interface BatchResponse {
  batch: CollectionBatch;
  artifacts: ArtifactLinks | null;
}

type PilotStatus = "idle" | "login-browser-open" | "running" | "completed" | "failed";
type PilotOutcome = "needs-config" | "opened" | "reachable" | "login-required" | "failed";
type QingmaoCandidateStatus = "idle" | "running" | "completed" | "failed";
type SameFlightComparisonStatus = "idle" | "running" | "completed" | "failed";
type SameFlightQuoteStatus = "available" | "not-found" | "failed";
type PilotBusyAction = "login" | "probe" | "attached" | "qingmao-candidates" | "same-flight" | "";

interface PilotPlatformState {
  platform: string;
  loginUrl?: string;
  configured: boolean;
  outcome?: PilotOutcome;
  note?: string;
  pageTitle?: string;
  finalUrl?: string;
  screenshotUrl?: string;
  error?: string;
}

interface PilotResult {
  status: PilotStatus;
  route: {
    scope: "国内" | "国际";
    origin: string;
    destination: string;
    travelDate: string;
  };
  profileDir: string;
  platforms: PilotPlatformState[];
  updatedAt: string | null;
  message: string;
}

interface QingmaoFlightCandidate {
  airline: string;
  flightNo: string;
  aircraft: string;
  departureTime: string;
  arrivalTime: string;
  originAirport: string;
  destinationAirport: string;
  durationMinutes: number | null;
  price: number | null;
  cabin: "经济舱" | "";
  discount: string;
  meal: string;
  shared: boolean;
  rawText: string;
}

interface QingmaoCandidateProbeResult {
  status: QingmaoCandidateStatus;
  route: {
    scope: "国内" | "国际";
    origin: string;
    destination: string;
    travelDate: string;
  };
  candidates: QingmaoFlightCandidate[];
  totalFlights: number | null;
  screenshotUrl?: string;
  finalUrl?: string;
  updatedAt: string | null;
  message: string;
  error?: string;
}

interface SameFlightPlatformQuote {
  platform: string;
  status: SameFlightQuoteStatus;
  price: number | null;
  finalUrl?: string;
  screenshotUrl?: string;
  rawText?: string;
  error?: string;
}

interface SameFlightComparisonProbeResult {
  status: SameFlightComparisonStatus;
  route: {
    scope: "国内" | "国际";
    origin: string;
    destination: string;
    travelDate: string;
  };
  selectedFlight: QingmaoFlightCandidate | null;
  quotes: SameFlightPlatformQuote[];
  updatedAt: string | null;
  message: string;
  error?: string;
}

type ScopeFilter = "全部" | "国内" | "国际";

const scopeFilters: ScopeFilter[] = ["全部", "国内", "国际"];
const cityCodes: Record<string, string> = {
  广州: "CAN",
  上海: "SHA",
  北京: "PEK",
  成都: "CTU",
  杭州: "HGH",
  青岛: "TAO",
  深圳: "SZX",
  南京: "NKG",
  厦门: "XMN",
  福州: "FOC",
  曼谷: "BKK",
  河内: "HAN",
  胡志明市: "SGN",
  吉隆坡: "KUL",
  首尔: "SEL",
  东京: "TYO",
  洛杉矶: "LAX"
};

function formatDateTime(value: string | null) {
  if (!value) return "暂无";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function routeCodeLabel(routeLabel: string) {
  const [origin, destination] = routeLabel.split("-");
  return `${cityCodes[origin] ?? origin} → ${cityCodes[destination] ?? destination}`;
}

function pilotStatusLabel(status: PilotStatus) {
  const labels: Record<PilotStatus, string> = {
    idle: "未开始",
    "login-browser-open": "等待人工登录",
    running: "后台探测中",
    completed: "探测完成",
    failed: "探测失败"
  };
  return labels[status];
}

function pilotOutcomeLabel(outcome?: PilotOutcome) {
  if (!outcome) return "待处理";
  const labels: Record<PilotOutcome, string> = {
    "needs-config": "需配置入口",
    opened: "已打开",
    reachable: "后台可访问",
    "login-required": "可能未登录",
    failed: "失败"
  };
  return labels[outcome];
}

function connectionStatus(pilot: PilotResult | null, busy: PilotBusyAction, error: string) {
  if (busy === "attached") {
    return {
      tone: "running",
      title: "正在连接当前登录窗口",
      detail: "系统正在检查三平台是否已经登录并可读取页面。"
    };
  }

  if (error) {
    return {
      tone: "failed",
      title: "连接失败",
      detail: error
    };
  }

  if (!pilot) {
    return {
      tone: "idle",
      title: "尚未连接",
      detail: "先打开登录浏览器，登录三平台并保持窗口打开，再点击连接。"
    };
  }

  if (pilot.status === "login-browser-open") {
    return {
      tone: "idle",
      title: "等待人工登录",
      detail: "登录青猫差旅、携程商旅、阿里商旅后，回到这里点击连接当前登录窗口。"
    };
  }

  if (pilot.status === "idle") {
    return {
      tone: "idle",
      title: "尚未连接",
      detail: "先打开登录浏览器，登录三平台并保持窗口打开，再点击连接。"
    };
  }

  const configured = pilot.platforms.filter((platform) => platform.configured);
  const reachable = configured.filter((platform) => platform.outcome === "reachable");

  if (configured.length > 0 && reachable.length === configured.length) {
    return {
      tone: "connected",
      title: `已连接成功：${reachable.length}/${configured.length} 个平台可访问`,
      detail: "可以开始完整真实采集。"
    };
  }

  if (pilot.status === "failed") {
    return {
      tone: "failed",
      title: "连接失败",
      detail: pilot.message || "未能读取已登录窗口。"
    };
  }

  const pending = configured
    .filter((platform) => platform.outcome !== "reachable")
    .map((platform) => `${platform.platform}：${pilotOutcomeLabel(platform.outcome)}`)
    .join("；");

  return {
    tone: reachable.length > 0 ? "partial" : "idle",
    title: `未完全连接：${reachable.length}/${configured.length || 3} 个平台可访问`,
    detail: pending || "请确认三平台已经登录，并且登录窗口没有关闭。"
  };
}

function qingmaoCandidateStatusLabel(status?: QingmaoCandidateStatus) {
  if (!status) return "待读取";
  const labels: Record<QingmaoCandidateStatus, string> = {
    idle: "待读取",
    running: "读取中",
    completed: "已读取",
    failed: "读取失败"
  };
  return labels[status];
}

function sameFlightStatusLabel(status?: SameFlightComparisonStatus) {
  if (!status) return "待比价";
  const labels: Record<SameFlightComparisonStatus, string> = {
    idle: "待比价",
    running: "查询中",
    completed: "已完成",
    failed: "查询失败"
  };
  return labels[status];
}

function quoteStatusLabel(status: SameFlightQuoteStatus) {
  const labels: Record<SameFlightQuoteStatus, string> = {
    available: "已读取",
    "not-found": "未展示同航班",
    failed: "读取失败"
  };
  return labels[status];
}

function quotePriceLabel(quote: SameFlightPlatformQuote) {
  return quote.status === "available" && typeof quote.price === "number" ? `¥${quote.price}` : "无同航班";
}

function formatDuration(minutes: number | null) {
  if (minutes === null) return "时长待识别";
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours === 0) return `${restMinutes}分钟`;
  return restMinutes === 0 ? `${hours}小时` : `${hours}小时${restMinutes}分钟`;
}

function formatElapsed(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}分${String(seconds).padStart(2, "0")}秒`;
}

function estimateProgress(elapsedMs: number, estimateMs: number) {
  if (elapsedMs <= 0) return 6;
  return Math.min(94, Math.max(8, Math.round((elapsedMs / estimateMs) * 100)));
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : "请求失败");
  }

  return data as T;
}

function DownloadButton({
  href,
  icon,
  label
}: {
  href: string | null;
  icon: React.ReactNode;
  label: string;
}) {
  if (!href) {
    return (
      <button className="ghost-button" type="button" disabled>
        {icon}
        {label}
      </button>
    );
  }

  return (
    <a className="ghost-button active-link" href={href}>
      {icon}
      {label}
    </a>
  );
}

export function App() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [batch, setBatch] = useState<CollectionBatch | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactLinks | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [realCollecting, setRealCollecting] = useState(false);
  const [internationalCollecting, setInternationalCollecting] = useState(false);
  const [fullCollecting, setFullCollecting] = useState(false);
  const [pilot, setPilot] = useState<PilotResult | null>(null);
  const [qingmaoCandidates, setQingmaoCandidates] = useState<QingmaoCandidateProbeResult | null>(null);
  const [sameFlightComparison, setSameFlightComparison] = useState<SameFlightComparisonProbeResult | null>(null);
  const [pilotBusy, setPilotBusy] = useState<PilotBusyAction>("");
  const [pilotError, setPilotError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scope, setScope] = useState<ScopeFilter>("全部");

  const view = useMemo(() => (batch ? buildDashboardView(batch) : null), [batch]);
  const connection = useMemo(() => connectionStatus(pilot, pilotBusy, pilotError), [pilot, pilotBusy, pilotError]);
  const visibleSamples = useMemo(() => {
    if (!view) return [];
    return scope === "全部" ? view.samples : view.samples.filter((sample) => sample.scope === scope);
  }, [scope, view]);
  const [collectionStartedAt, setCollectionStartedAt] = useState<number | null>(null);
  const [progressNow, setProgressNow] = useState(Date.now());
  const serverOperation = status?.activeOperation ?? null;
  const isCollectionRunning = collecting || realCollecting || internationalCollecting || fullCollecting;
  const isOperationRunning = isCollectionRunning || Boolean(serverOperation);
  const operationLocked = isOperationRunning || Boolean(pilotBusy);
  const localCollectionLabel = fullCollecting
    ? "完整真实采集"
    : realCollecting
      ? "国内真实采集"
      : internationalCollecting
        ? "国际真实采集"
        : collecting
          ? "模拟采集"
          : "";
  const runningCollectionLabel = localCollectionLabel || serverOperation?.label || "";
  const serverStartedAt = serverOperation ? Date.parse(serverOperation.startedAt) : Number.NaN;
  const runningStartedAt = collectionStartedAt ?? (Number.isNaN(serverStartedAt) ? null : serverStartedAt);
  const runningIsFull = runningCollectionLabel.includes("完整真实采集");
  const runningIsSegment = runningCollectionLabel.includes("国内真实采集") || runningCollectionLabel.includes("国际真实采集");
  const runningEstimateText = runningIsFull ? "预计 10-18 分钟" : runningIsSegment ? "预计 5-10 分钟" : "预计 10 秒内";
  const runningEstimateMs = runningIsFull ? 15 * 60 * 1000 : runningIsSegment ? 8 * 60 * 1000 : 10 * 1000;
  const runningElapsedMs = runningStartedAt ? progressNow - runningStartedAt : 0;
  const runningProgress = isOperationRunning ? estimateProgress(runningElapsedMs, runningEstimateMs) : 0;
  const fullCollectionRunning = fullCollecting || serverOperation?.label === "完整真实采集";

  function markCollectionStart() {
    const startedAt = Date.now();
    setCollectionStartedAt(startedAt);
    setProgressNow(startedAt);
    setPilotError("");
  }

  async function refreshStatus() {
    const latestStatus = await readJson<StatusResponse>("/api/status");
    setStatus(latestStatus);
    setArtifacts(latestStatus.artifacts);

    if (!latestStatus.hasBatch) {
      setBatch(null);
      return;
    }

    const latest = await readJson<BatchResponse>("/api/batch/latest");
    setBatch(latest.batch);
    setArtifacts(latest.artifacts);
  }

  async function refreshPilot() {
    const [nextPilot, nextQingmaoCandidates, nextSameFlightComparison] = await Promise.all([
      readJson<PilotResult>("/api/pilot/status"),
      readJson<QingmaoCandidateProbeResult>("/api/pilot/qingmao-candidates/status"),
      readJson<SameFlightComparisonProbeResult>("/api/pilot/same-flight/status")
    ]);
    setPilot(nextPilot);
    setQingmaoCandidates(nextQingmaoCandidates);
    setSameFlightComparison(nextSameFlightComparison);
  }

  async function collect() {
    markCollectionStart();
    setCollecting(true);
    setError("");

    try {
      const result = await readJson<BatchResponse>("/api/collect", { method: "POST" });
      setBatch(result.batch);
      setArtifacts(result.artifacts);
      await refreshStatus();
    } catch (collectionError) {
      setError(collectionError instanceof Error ? collectionError.message : "采集失败");
    } finally {
      setCollecting(false);
      setCollectionStartedAt(null);
      void refreshStatus().catch(() => undefined);
    }
  }

  async function collectRealDomestic() {
    markCollectionStart();
    setRealCollecting(true);
    setError("");

    try {
      const result = await readJson<BatchResponse>("/api/collect-real-domestic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      setBatch(result.batch);
      setArtifacts(result.artifacts);
      await refreshStatus();
    } catch (collectionError) {
      setError(collectionError instanceof Error ? collectionError.message : "国内真实采集失败");
    } finally {
      setRealCollecting(false);
      setCollectionStartedAt(null);
      void refreshStatus().catch(() => undefined);
    }
  }

  async function collectRealInternational() {
    markCollectionStart();
    setInternationalCollecting(true);
    setError("");

    try {
      const result = await readJson<BatchResponse>("/api/collect-real-international", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      setBatch(result.batch);
      setArtifacts(result.artifacts);
      await refreshStatus();
    } catch (collectionError) {
      setError(collectionError instanceof Error ? collectionError.message : "国际真实采集失败");
    } finally {
      setInternationalCollecting(false);
      setCollectionStartedAt(null);
      void refreshStatus().catch(() => undefined);
    }
  }

  async function collectRealFull() {
    markCollectionStart();
    setFullCollecting(true);
    setError("");

    try {
      const result = await readJson<BatchResponse>("/api/collect-real-full", { method: "POST" });
      setBatch(result.batch);
      setArtifacts(result.artifacts);
      await refreshStatus();
    } catch (collectionError) {
      setError(collectionError instanceof Error ? collectionError.message : "完整真实采集失败");
    } finally {
      setFullCollecting(false);
      setCollectionStartedAt(null);
      void refreshStatus().catch(() => undefined);
    }
  }

  async function openPilotLogin() {
    setPilotBusy("login");
    setPilotError("");

    try {
      const result = await readJson<PilotResult>("/api/pilot/open-login", { method: "POST" });
      setPilot(result);
    } catch (loginError) {
      setPilotError(loginError instanceof Error ? loginError.message : "登录浏览器启动失败");
    } finally {
      setPilotBusy("");
    }
  }

  async function runPilotProbe() {
    setPilotBusy("probe");
    setPilotError("");

    try {
      const result = await readJson<PilotResult>("/api/pilot/run-silent-probe", { method: "POST" });
      setPilot(result);
    } catch (probeError) {
      setPilotError(probeError instanceof Error ? probeError.message : "后台探测失败");
    } finally {
      setPilotBusy("");
    }
  }

  async function runAttachedPilotProbe() {
    setPilotBusy("attached");
    setPilotError("");

    try {
      const result = await readJson<PilotResult>("/api/pilot/run-attached-probe", { method: "POST" });
      setPilot(result);
    } catch (probeError) {
      setPilotError(probeError instanceof Error ? probeError.message : "附着探测失败");
    } finally {
      setPilotBusy("");
    }
  }

  async function runQingmaoCandidateProbe() {
    setPilotBusy("qingmao-candidates");
    setPilotError("");

    try {
      const result = await readJson<QingmaoCandidateProbeResult>("/api/pilot/qingmao-candidates/run", { method: "POST" });
      setQingmaoCandidates(result);
    } catch (probeError) {
      setPilotError(probeError instanceof Error ? probeError.message : "青猫候选航班读取失败");
    } finally {
      setPilotBusy("");
    }
  }

  async function runSameFlightComparisonProbe() {
    setPilotBusy("same-flight");
    setPilotError("");

    try {
      const result = await readJson<SameFlightComparisonProbeResult>("/api/pilot/same-flight/run", { method: "POST" });
      setSameFlightComparison(result);
    } catch (probeError) {
      setPilotError(probeError instanceof Error ? probeError.message : "同航班比价失败");
    } finally {
      setPilotBusy("");
    }
  }

  useEffect(() => {
    Promise.all([refreshStatus(), refreshPilot()])
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "状态读取失败"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!isOperationRunning) return;

    const timer = window.setInterval(() => setProgressNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isOperationRunning]);

  useEffect(() => {
    if (loading) return;

    void refreshStatus().catch(() => undefined);
    const timer = window.setInterval(
      () => {
        void refreshStatus().catch(() => undefined);
      },
      isOperationRunning || !status?.hasBatch ? 3000 : 15000
    );

    return () => window.clearInterval(timer);
  }, [loading, isOperationRunning, status?.hasBatch, status?.batchId]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark">
          <Plane size={22} />
          <span>青猫差旅</span>
        </div>
        <div className="topbar-status">
          <ShieldCheck size={18} />
          第一版真实采集闭环
        </div>
      </header>

      <section className="command-band">
        <div className="command-copy">
          <p className="eyebrow">Manual Collection Console</p>
          <h1>航班比价采集台</h1>
          <p>
            先人工登录三平台，再由系统随机抽取未来 3 天后的航班，生成三平台同航班价格对比、Excel 和离线销售演示包。
          </p>
        </div>

        <div className="command-panel" aria-label="采集操作">
          <div className="panel-state">
            <span>{loading ? "正在读取状态" : status?.hasBatch ? "已有当前批次" : "暂无当前批次"}</span>
            <strong>{status?.sampleCount ?? 0} 条样本</strong>
            <small>最近采集：{formatDateTime(status?.generatedAt ?? null)}</small>
          </div>
          <p className="operation-note">日常只需要先登录并保持浏览器打开，再连接当前窗口，最后开始完整真实采集。</p>
          <button className="ghost-button active-link" type="button" onClick={openPilotLogin} disabled={operationLocked}>
            <LogIn size={18} />
            {pilotBusy === "login" ? "正在打开" : "打开登录浏览器"}
          </button>
          <button className="primary-button" type="button" onClick={runAttachedPilotProbe} disabled={operationLocked}>
            <Monitor size={18} className={pilotBusy === "attached" ? "spin" : ""} />
            {pilotBusy === "attached" ? "正在连接窗口" : connection.tone === "connected" ? "已连接，可重新检测" : "连接当前登录窗口"}
          </button>
          <div className={`connection-card ${connection.tone}`}>
            <div>
              {connection.tone === "connected" ? <CircleCheckBig size={18} /> : connection.tone === "failed" ? <AlertTriangle size={18} /> : <Monitor size={18} />}
              <strong>{connection.title}</strong>
            </div>
            <p>{connection.detail}</p>
          </div>
          <button className="primary-button real-button strong-action" type="button" onClick={collectRealFull} disabled={isOperationRunning || Boolean(pilotBusy) || loading}>
            <Radar size={18} className={fullCollectionRunning ? "spin" : ""} />
            {fullCollectionRunning ? "完整真实采集中" : "开始完整真实采集"}
          </button>
          {isOperationRunning ? (
            <div className="collection-progress-card" role="status" aria-live="polite">
              <div className="progress-head">
                <div>
                  <Clock3 size={18} />
                  <strong>{runningCollectionLabel}进行中</strong>
                </div>
                <span>已运行 {formatElapsed(runningElapsedMs)}</span>
              </div>
              <div className="progress-track" aria-label={`${runningCollectionLabel}预计进度`}>
                <span style={{ width: `${runningProgress}%` }} />
              </div>
              <p>
                {runningEstimateText}。系统正在占用已登录浏览器执行采集，期间已锁定连接和后台探测按钮，避免重复点击导致连接失败。
              </p>
            </div>
          ) : null}
          <div className="download-row">
            <DownloadButton href={artifacts?.excel ?? null} icon={<FileSpreadsheet size={17} />} label="导出 Excel" />
            <DownloadButton href={artifacts?.offlinePackage ?? null} icon={<PackageOpen size={17} />} label="离线演示包" />
          </div>
        </div>
      </section>

      <section className="advanced-section" aria-label="高级验证">
        <details>
          <summary>
            <div className="pilot-copy">
              <p className="eyebrow"><span className="section-dot" /> Advanced Checks</p>
              <h2>高级验证</h2>
              <p>这些按钮只用于排查问题：检查登录态、单独读青猫候选池、单条同航班比价，或只跑国内/国际分段采集。</p>
            </div>
            <div className="pilot-route">
              <span>{pilot ? pilotStatusLabel(pilot.status) : "读取中"}</span>
              <strong>{pilot ? `${pilot.route.origin} → ${pilot.route.destination}` : "广州 → 上海"}</strong>
              <small>当前验证航线</small>
            </div>
          </summary>
        <div className="pilot-actions advanced-actions">
          <button className="primary-button inline-primary" type="button" onClick={runPilotProbe} disabled={operationLocked}>
            <Radar size={17} className={pilotBusy === "probe" ? "spin" : ""} />
            {pilotBusy === "probe" ? "后台探测中" : "运行后台探测"}
          </button>
          <button className="primary-button inline-primary strong-action" type="button" onClick={runQingmaoCandidateProbe} disabled={operationLocked}>
            <Plane size={17} className={pilotBusy === "qingmao-candidates" ? "spin" : ""} />
            {pilotBusy === "qingmao-candidates" ? "读取中" : "读取青猫候选航班"}
          </button>
          <button className="primary-button inline-primary strong-action" type="button" onClick={runSameFlightComparisonProbe} disabled={operationLocked}>
            <Radar size={17} className={pilotBusy === "same-flight" ? "spin" : ""} />
            {pilotBusy === "same-flight" ? "查询中" : "随机同航班比价"}
          </button>
          <button className="primary-button inline-primary" type="button" onClick={collect} disabled={operationLocked || loading}>
            <RefreshCw size={17} className={collecting ? "spin" : ""} />
            {collecting ? "模拟采集中" : "模拟采集"}
          </button>
          <button className="primary-button inline-primary real-button" type="button" onClick={collectRealDomestic} disabled={operationLocked || loading}>
            <Radar size={17} className={realCollecting ? "spin" : ""} />
            {realCollecting ? "国内采集中" : "只采国内"}
          </button>
          <button className="primary-button inline-primary real-button" type="button" onClick={collectRealInternational} disabled={operationLocked || loading}>
            <Radar size={17} className={internationalCollecting ? "spin" : ""} />
            {internationalCollecting ? "国际采集中" : "只采国际"}
          </button>
        </div>
        {pilotError ? (
          <div className="pilot-error" role="alert">
            <AlertTriangle size={16} />
            {pilotError}
          </div>
        ) : null}
        <div className="pilot-platforms">
          {(pilot?.platforms ?? []).map((platform) => (
            <div className={`pilot-platform ${platform.outcome ?? "pending"}`} key={platform.platform}>
              <div>
                <b>{platform.platform}</b>
                <span>{pilotOutcomeLabel(platform.outcome)}</span>
              </div>
              <p>{platform.note ?? (platform.configured ? "等待探测" : "请先配置平台入口")}</p>
              {platform.error ? <small>{platform.error}</small> : null}
              {platform.screenshotUrl ? (
                <a href={platform.screenshotUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={15} />
                  查看探测截图
                </a>
              ) : null}
            </div>
          ))}
        </div>
        <div className={`qingmao-candidate-panel ${qingmaoCandidates?.status ?? "idle"}`}>
          <div className="candidate-head">
            <div>
              <span>{qingmaoCandidateStatusLabel(qingmaoCandidates?.status)}</span>
              <b>青猫候选航班池</b>
              <small>
                {qingmaoCandidates
                  ? `${qingmaoCandidates.route.origin} → ${qingmaoCandidates.route.destination} · ${qingmaoCandidates.route.travelDate}`
                  : "广州 → 上海 · 未来 3 天后"}
              </small>
            </div>
            <div className="candidate-counts">
              <strong>{qingmaoCandidates?.totalFlights ?? "--"}</strong>
              <span>页面航班数</span>
            </div>
            {qingmaoCandidates?.screenshotUrl ? (
              <a href={qingmaoCandidates.screenshotUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={15} />
                查看候选池截图
              </a>
            ) : null}
          </div>
          {qingmaoCandidates?.error ? (
            <div className="pilot-error compact" role="alert">
              <AlertTriangle size={16} />
              {qingmaoCandidates.error}
            </div>
          ) : null}
          {qingmaoCandidates && qingmaoCandidates.candidates.length > 0 ? (
            <div className="candidate-table">
              <table>
                <thead>
                  <tr>
                    <th>航班</th>
                    <th>时间</th>
                    <th>机场</th>
                    <th>价格</th>
                    <th>舱位</th>
                  </tr>
                </thead>
                <tbody>
                  {qingmaoCandidates.candidates.slice(0, 6).map((candidate) => (
                    <tr key={`${candidate.flightNo}-${candidate.departureTime}`}>
                      <td>
                        <b>{candidate.airline}{candidate.flightNo}</b>
                        <span>{candidate.aircraft}{candidate.shared && !candidate.aircraft.includes("共享") ? " / 共享" : ""}</span>
                      </td>
                      <td>
                        <b>{candidate.departureTime} → {candidate.arrivalTime}</b>
                        <span>{formatDuration(candidate.durationMinutes)}</span>
                      </td>
                      <td>
                        <b>{candidate.originAirport}</b>
                        <span>{candidate.destinationAirport}</span>
                      </td>
                      <td className="candidate-price">¥{candidate.price ?? "--"}</td>
                      <td>
                        <b>{candidate.discount || candidate.cabin || "待识别"}</b>
                        <span>{candidate.meal}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
        <div className={`same-flight-panel ${sameFlightComparison?.status ?? "idle"}`}>
          <div className="candidate-head">
            <div>
              <span>{sameFlightStatusLabel(sameFlightComparison?.status)}</span>
              <b>随机同航班比价</b>
              <small>
                {sameFlightComparison?.selectedFlight
                  ? `${sameFlightComparison.selectedFlight.airline}${sameFlightComparison.selectedFlight.flightNo} · ${sameFlightComparison.route.travelDate}`
                  : "从青猫候选池随机抽取一条航班，再查携程商旅与阿里商旅"}
              </small>
            </div>
            <div className="candidate-counts">
              <strong>{sameFlightComparison?.quotes.filter((quote) => quote.status === "available").length ?? "--"}</strong>
              <span>平台已读取</span>
            </div>
            <button
              className="ghost-button active-link compact-action"
              type="button"
              onClick={runSameFlightComparisonProbe}
              disabled={operationLocked}
            >
              <Radar size={15} className={pilotBusy === "same-flight" ? "spin" : ""} />
              再随机一次
            </button>
          </div>
          {sameFlightComparison?.error ? (
            <div className="pilot-error compact" role="alert">
              <AlertTriangle size={16} />
              {sameFlightComparison.error}
            </div>
          ) : null}
          {sameFlightComparison && sameFlightComparison.quotes.length > 0 ? (
            <div className="same-flight-quotes">
              {sameFlightComparison.quotes.map((quote) => (
                <div className={`same-flight-quote ${quote.platform === "青猫差旅" ? "qingmao" : ""} ${quote.status}`} key={quote.platform}>
                  <span>{quote.platform}</span>
                  <strong>{quotePriceLabel(quote)}</strong>
                  <small>{quoteStatusLabel(quote.status)}</small>
                  {quote.error ? <em>{quote.error}</em> : null}
                  <div className="quote-links">
                    {quote.screenshotUrl ? (
                      <a href={quote.screenshotUrl} target="_blank" rel="noreferrer">
                        <ExternalLink size={14} />
                        网页截图
                      </a>
                    ) : null}
                    {quote.finalUrl ? (
                      <a href={quote.finalUrl} target="_blank" rel="noreferrer">
                        <ExternalLink size={14} />
                        平台页面
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        </details>
      </section>

      {error ? (
        <div className="notice error" role="alert">
          <AlertTriangle size={18} />
          {error}
        </div>
      ) : null}

      {!batch && !loading ? (
        <section className="empty-state">
          <Monitor size={34} />
          <div>
            <h2>还没有可展示的数据</h2>
            <p>登录三平台并连接当前窗口后，点击“开始完整真实采集”生成 Excel 和销售离线包。</p>
          </div>
        </section>
      ) : null}

      {view ? (
        <>
          <section className="metric-grid" aria-label="采集结果概览">
            <div className="metric-item">
              <span>总样本</span>
              <strong>{view.sampleCount}</strong>
              <small>国内 {view.domesticCount} / 国际 {view.internationalCount}</small>
            </div>
            <div className="metric-item">
              <span>青猫低于竞品</span>
              <strong>{view.advantageCount}</strong>
              <small>需要在客户现场放大展示</small>
            </div>
            <div className="metric-item">
              <span>青猫高于竞品最低</span>
              <strong>{view.higherThanLowestCount}</strong>
              <small>弱提示，内部复盘即可</small>
            </div>
            <div className="metric-item">
              <span>证据入口</span>
              <strong>{view.evidenceCount}</strong>
              <small>每条记录绑定三平台</small>
            </div>
          </section>

          <section className="data-section">
            <div className="section-head">
              <div>
                <p className="eyebrow"><span className="section-dot" /> Current Batch</p>
                <h2>当前批次明细</h2>
                <p className="section-subtitle">对比青猫差旅与主流商旅平台价格，助力企业差旅成本优化</p>
                <div className="section-meta">
                  <span><CalendarDays size={15} /> {scope === "国际" ? "国际航班" : scope === "国内" ? "国内航班" : "国内 / 国际航班"}</span>
                  <span>数据日期：{view.samples[0]?.travelDate ?? "暂无"}</span>
                </div>
              </div>
              <div className="segmented-control" aria-label="航线范围筛选">
                {scopeFilters.map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={scope === filter ? "selected" : ""}
                    onClick={() => setScope(filter)}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>

            <div className="table-frame">
              <table className="batch-table">
                <colgroup>
                  <col className="route-column" />
                  <col className="flight-column" />
                  <col className="platform-column" />
                  <col className="platform-column" />
                  <col className="platform-column" />
                  <col className="gap-column" />
                  <col className="conclusion-column" />
                </colgroup>
                <thead>
                  <tr>
                    <th>航线</th>
                    <th>航班</th>
                    <th><span className="platform-head qingmao-head">青猫差旅</span></th>
                    <th><span className="platform-head ctrip-head">携程商旅</span></th>
                    <th><span className="platform-head ali-head">阿里商旅</span></th>
                    <th>青猫差额</th>
                    <th>结论</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSamples.map((sample) => (
                    <tr key={sample.id}>
                      <td>
                        <div className="route-cell">
                          <span className="route-icon"><Plane size={16} /></span>
                          <div>
                            <b>{sample.routeLabel}</b>
                            <span>{routeCodeLabel(sample.routeLabel)}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <b>{sample.flightNo}</b>
                        <span>{sample.airline} / {sample.transferLabel} / {sample.durationLabel}</span>
                      </td>
                      {sample.quotes.map((quote) => (
                        <td
                          key={quote.platform}
                          className={[
                            "platform-price-cell",
                            quote.isQingmao ? "qingmao-cell" : quote.platform === "携程商旅" ? "ctrip-cell" : "ali-cell",
                            quote.available ? "available" : "unavailable"
                          ].join(" ")}
                        >
                          <b>{quote.priceLabel}</b>
                          {quote.status !== quote.priceLabel ? <span>{quote.status}</span> : null}
                        </td>
                      ))}
                      <td className={`gap-cell ${sample.gapTone}`}>
                        <b className="gap-badge">
                          {sample.gapLabel}
                        </b>
                        <span>竞品最低：{sample.lowestPlatform}</span>
                      </td>
                      <td>
                        <div className={`conclusion-cell ${sample.gapTone}`}>
                          <CircleCheckBig size={16} />
                          {sample.conclusion}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="trace-strip">
            <Clock3 size={18} />
            <span>批次 {view.batchId}</span>
            <span>生成时间 {formatDateTime(view.generatedAt)}</span>
            <span>成功 {view.successCount} / 失败 {view.failedCount}</span>
            <Download size={18} />
          </section>

          {view.failureNotes.length > 0 ? (
            <section className="failure-notes" aria-label="替换航线原因">
              <b>替换航线记录</b>
              {view.failureNotes.map((note) => (
                <span key={note}>{note}</span>
              ))}
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
