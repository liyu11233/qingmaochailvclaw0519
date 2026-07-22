import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  CircleCheckBig,
  Clock3,
  Monitor,
  Plane,
  SlidersHorizontal
} from "lucide-react";
import { DEFAULT_THIRD_VERSION_OPTIONS, type ThirdVersionBatchStatus, type ThirdVersionStrategyOptions } from "./domain/thirdVersionStrategy";
import type { CollectionBatch } from "./domain/types";
import { type ArtifactLinks, type QuoteView, buildDashboardView, comparisonPlatforms } from "./ui/viewModel";

interface StatusResponse {
  hasBatch: boolean;
  batchId: string | null;
  generatedAt: string | null;
  sampleCount: number;
  flightCount: number;
  hotelCount: number;
  successCount: number;
  failedCount: number;
  collectionDates?: CollectionDateConfig | null;
  artifacts: ArtifactLinks | null;
  activeOperation?: {
    label: string;
    startedAt: string;
    state: "running" | "paused" | "stopping";
    canPause: boolean;
    canResume: boolean;
    canStop: boolean;
    pauseRequestedAt: string | null;
    stopRequestedAt: string | null;
  } | null;
  thirdVersion: ThirdVersionResponse;
}

interface BatchResponse {
  batch: CollectionBatch;
  artifacts: ArtifactLinks | null;
  thirdVersion?: ThirdVersionResponse;
}

interface ThirdVersionResponse {
  options: ThirdVersionStrategyOptions;
  status: ThirdVersionBatchStatus;
}

interface CollectionResultNotice {
  tone: "success" | "failed" | "info";
  title: string;
  detail: string;
}

type CollectionDateMode = "default" | "manual";

interface CollectionDateDraft {
  flightTravelDate: string;
  hotelCheckInDate: string;
}

interface CollectionDateConfig {
  mode: CollectionDateMode;
  flightTravelDate: string;
  hotelCheckInDate: string;
  hotelCheckOutDate: string;
  hotelNights: 1;
}

type PilotStatus = "idle" | "login-browser-open" | "running" | "completed" | "failed";
type PilotOutcome = "needs-config" | "opened" | "reachable" | "login-required" | "failed";
type QingmaoCandidateStatus = "idle" | "running" | "completed" | "failed";
type SameFlightComparisonStatus = "idle" | "running" | "completed" | "failed";
type SameFlightQuoteStatus = "available" | "not-found" | "failed";
type ZtripProbeStatus = "idle" | "running" | "completed" | "failed";
type ZtripFlightProbeStatus = "idle" | "running" | "completed" | "failed";
type ZtripHotelProbeStatus = "idle" | "running" | "completed" | "failed";
type PilotBusyAction = "login" | "probe" | "attached" | "cleanup" | "qingmao-candidates" | "same-flight" | "ztrip" | "ztrip-flight" | "ztrip-hotel" | "";
type ThirdVersionConfigPatch = Partial<ThirdVersionStrategyOptions>;

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

interface ZtripProbeCheck {
  target: "入口页" | "航班入口" | "酒店入口";
  outcome?: PilotOutcome;
  note?: string;
  pageTitle?: string;
  finalUrl?: string;
  screenshotUrl?: string;
  error?: string;
}

interface ZtripProbeResult {
  status: ZtripProbeStatus;
  loginUrl: string;
  checks: ZtripProbeCheck[];
  updatedAt: string | null;
  message: string;
  error?: string;
}

interface ZtripFlightProbeResult {
  status: ZtripFlightProbeStatus;
  route: {
    scope: "国内" | "国际";
    origin: string;
    destination: string;
    travelDate: string;
  };
  selectedFlight: QingmaoFlightCandidate | null;
  candidates: QingmaoFlightCandidate[];
  totalFlights: number | null;
  screenshotUrl?: string;
  finalUrl?: string;
  updatedAt: string | null;
  message: string;
  error?: string;
}

interface ZtripHotelRate {
  hotelName: string;
  roomType: string;
  bedType: "大床" | "双床" | "";
  breakfast: "有早餐" | "无早餐" | "";
  price: number | null;
  rawText: string;
}

interface ZtripHotelProbeResult {
  status: ZtripHotelProbeStatus;
  query: {
    city: string;
    checkInDate: string;
    checkOutDate: string;
    nights: number;
  };
  selectedRate: ZtripHotelRate | null;
  rates: ZtripHotelRate[];
  screenshotUrl?: string;
  finalUrl?: string;
  updatedAt: string | null;
  message: string;
  error?: string;
}

interface BrowserCleanupResult {
  status: "completed" | "failed";
  beforeCount: number;
  closedCount: number;
  afterCount: number;
  updatedAt: string;
  message: string;
  error?: string;
}

const generationModeLabels: Record<ThirdVersionStrategyOptions["generationMode"], string> = {
  real_random: "真实随机",
  qingmao_advantage: "青猫优势"
};
const comparisonModeLabels: Record<ThirdVersionStrategyOptions["comparisonMode"], string> = {
  internal_discussion: "内部讨论",
  external_sales: "对外销售",
  specified_platform: "指定平台"
};
const thirdVersionCompetitors: NonNullable<ThirdVersionStrategyOptions["specifiedPlatform"]>[] = ["携程商旅", "阿里商旅", "在途商旅"];
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

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function formatDateInput(date: Date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function parseDateInput(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    return null;
  }
  return parsed;
}

function addDaysToDateInput(value: string, days: number) {
  const parsed = parseDateInput(value);
  return parsed ? formatDateInput(addDays(parsed, days)) : "";
}

function buildDefaultCollectionDates(now = new Date()): CollectionDateConfig {
  const hotelCheckInDate = formatDateInput(addDays(now, 1));
  return {
    mode: "default",
    flightTravelDate: formatDateInput(addDays(now, 3)),
    hotelCheckInDate,
    hotelCheckOutDate: addDaysToDateInput(hotelCheckInDate, 1),
    hotelNights: 1
  };
}

function collectionDateDraftFromConfig(config: CollectionDateConfig): CollectionDateDraft {
  return {
    flightTravelDate: config.flightTravelDate,
    hotelCheckInDate: config.hotelCheckInDate
  };
}

function buildManualCollectionDates(draft: CollectionDateDraft): CollectionDateConfig {
  return {
    mode: "manual",
    flightTravelDate: draft.flightTravelDate,
    hotelCheckInDate: draft.hotelCheckInDate,
    hotelCheckOutDate: addDaysToDateInput(draft.hotelCheckInDate, 1),
    hotelNights: 1
  };
}

function validateCollectionDateDraft(draft: CollectionDateDraft) {
  if (!draft.flightTravelDate) return "日期校验失败：请填写航班出行日期";
  if (!parseDateInput(draft.flightTravelDate)) return "日期校验失败：航班出行日期格式应为 YYYY-MM-DD";
  if (!draft.hotelCheckInDate) return "日期校验失败：请填写酒店入住日期";
  if (!parseDateInput(draft.hotelCheckInDate)) return "日期校验失败：酒店入住日期格式应为 YYYY-MM-DD";
  return "";
}

function formatCollectionDateSummary(config: CollectionDateConfig) {
  return `航班出行 ${config.flightTravelDate}；酒店 ${config.hotelCheckInDate} 入住，${config.hotelCheckOutDate} 离店（固定 1 晚）`;
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
      detail: "系统正在检查四个平台是否已经登录并可读取页面。"
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
      detail: "先打开登录浏览器，登录四个平台并保持窗口打开，再点击连接。"
    };
  }

  if (pilot.status === "login-browser-open") {
    return {
      tone: "idle",
      title: "等待人工登录",
      detail: "登录青猫差旅、携程商旅、阿里商旅、在途商旅后，回到这里点击连接当前登录窗口。"
    };
  }

  if (pilot.status === "idle") {
    return {
      tone: "idle",
      title: "尚未连接",
      detail: "先打开登录浏览器，登录四个平台并保持窗口打开，再点击连接。"
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
    title: `未完全连接：${reachable.length}/${configured.length || 4} 个平台可访问`,
    detail: pending || "请确认四个平台已经登录，并且登录窗口没有关闭。"
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

function ztripStatusLabel(status?: ZtripProbeStatus) {
  if (!status) return "待验证";
  const labels: Record<ZtripProbeStatus, string> = {
    idle: "待验证",
    running: "验证中",
    completed: "已完成",
    failed: "验证失败"
  };
  return labels[status];
}

function ztripFlightStatusLabel(status?: ZtripFlightProbeStatus) {
  if (!status) return "待采集";
  const labels: Record<ZtripFlightProbeStatus, string> = {
    idle: "待采集",
    running: "采集中",
    completed: "已完成",
    failed: "采集失败"
  };
  return labels[status];
}

function ztripHotelStatusLabel(status?: ZtripHotelProbeStatus) {
  if (!status) return "待采集";
  const labels: Record<ZtripHotelProbeStatus, string> = {
    idle: "待采集",
    running: "采集中",
    completed: "已完成",
    failed: "采集失败"
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

function validateThirdVersionOptions(options: ThirdVersionStrategyOptions) {
  if (!Number.isInteger(options.hotelDisplayLimit) || options.hotelDisplayLimit < 1) {
    return "酒店展示数量必须是正整数";
  }
  if (!Number.isInteger(options.flightDisplayLimit) || options.flightDisplayLimit < 1) {
    return "航班展示数量必须是正整数";
  }
  if (!Number.isFinite(options.targetAdvantageRatio) || options.targetAdvantageRatio < 0 || options.targetAdvantageRatio > 100) {
    return "青猫优势目标比例必须在 0 到 100 之间";
  }
  if (options.comparisonMode === "specified_platform" && !options.specifiedPlatform) {
    return "指定平台口径必须选择 1 个竞品平台";
  }
  return "";
}

function percentLabel(value: number) {
  return `${Math.round(value)}%`;
}

function targetMetBadgeLabel(value: boolean) {
  return value ? "已达标" : "未达标";
}

function metricCardTone(value: boolean) {
  return value ? "ok" : "warn";
}

function connectionDotTone(tone: string) {
  if (tone === "connected") return "ok";
  if (tone === "failed") return "bad";
  return "warn";
}

function platformHeadClass(platform: string) {
  const classes: Record<string, string> = {
    青猫差旅: "qingmao-head",
    携程商旅: "ctrip-head",
    阿里商旅: "ali-head",
    在途商旅: "ztrip-head"
  };
  return classes[platform] ?? "";
}

function platformPriceClass(quote: QuoteView) {
  const classes: Record<string, string> = {
    青猫差旅: "qingmao-cell",
    携程商旅: "ctrip-cell",
    阿里商旅: "ali-cell",
    在途商旅: "ztrip-cell"
  };
  return classes[quote.platform] ?? "";
}

function isFailureTraceNote(note: string) {
  return /已替换|失败|为空|共同航班|无同航班|无价格|不可订|异常|错误|超时|登录|页面/.test(note);
}

function failureTraceObjectLabel(note: string) {
  const replacementMatch = note.match(/^已替换\s+([^:：]+)/);
  if (replacementMatch) return `已替换 ${replacementMatch[1].trim()}`;

  const [label] = note.split(/[:：]/);
  return label && label.length <= 18 ? label : "当前批次";
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : "请求失败");
  }

  return data as T;
}

export function App() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [batch, setBatch] = useState<CollectionBatch | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactLinks | null>(null);
  const [thirdVersionOptions, setThirdVersionOptions] = useState<ThirdVersionStrategyOptions>(DEFAULT_THIRD_VERSION_OPTIONS);
  const [thirdVersionStatus, setThirdVersionStatus] = useState<ThirdVersionBatchStatus | null>(null);
  const [thirdVersionSaving, setThirdVersionSaving] = useState(false);
  const [thirdVersionError, setThirdVersionError] = useState("");
  const [collecting, setCollecting] = useState(false);
  const [realCollecting, setRealCollecting] = useState(false);
  const [internationalCollecting, setInternationalCollecting] = useState(false);
  const [fullCollecting, setFullCollecting] = useState(false);
  const [regeneratingArtifacts, setRegeneratingArtifacts] = useState(false);
  const [pilot, setPilot] = useState<PilotResult | null>(null);
  const [qingmaoCandidates, setQingmaoCandidates] = useState<QingmaoCandidateProbeResult | null>(null);
  const [sameFlightComparison, setSameFlightComparison] = useState<SameFlightComparisonProbeResult | null>(null);
  const [ztripProbe, setZtripProbe] = useState<ZtripProbeResult | null>(null);
  const [ztripFlight, setZtripFlight] = useState<ZtripFlightProbeResult | null>(null);
  const [ztripHotel, setZtripHotel] = useState<ZtripHotelProbeResult | null>(null);
  const [pilotBusy, setPilotBusy] = useState<PilotBusyAction>("");
  const [pilotError, setPilotError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [collectionResult, setCollectionResult] = useState<CollectionResultNotice | null>(null);
  const [activeDetailTab, setActiveDetailTab] = useState<"flight" | "hotel">("flight");
  const [flightDetailExpanded, setFlightDetailExpanded] = useState(false);
  const [hotelDetailExpanded, setHotelDetailExpanded] = useState(false);
  const [failureTraceOpen, setFailureTraceOpen] = useState(true);
  const [defaultCollectionDates, setDefaultCollectionDates] = useState<CollectionDateConfig>(() => buildDefaultCollectionDates());
  const [collectionDateMode, setCollectionDateMode] = useState<CollectionDateMode>("default");
  const [collectionDateEditing, setCollectionDateEditing] = useState(false);
  const [collectionDateDraft, setCollectionDateDraft] = useState<CollectionDateDraft>(() => collectionDateDraftFromConfig(buildDefaultCollectionDates()));
  const [lockedCollectionDates, setLockedCollectionDates] = useState<CollectionDateConfig | null>(null);

  const view = useMemo(() => (batch ? buildDashboardView(batch) : null), [batch]);
  const connection = useMemo(() => connectionStatus(pilot, pilotBusy, pilotError), [pilot, pilotBusy, pilotError]);
  const visibleSamples = useMemo(() => view?.samples ?? [], [view]);
  const hotelRows = view?.hotels ?? [];
  const displayedFlightRows = flightDetailExpanded ? visibleSamples : visibleSamples.slice(0, 3);
  const displayedHotelRows = hotelDetailExpanded ? hotelRows : hotelRows.slice(0, 3);
  const hiddenFlightRowCount = Math.max(visibleSamples.length - displayedFlightRows.length, 0);
  const hiddenHotelRowCount = Math.max(hotelRows.length - displayedHotelRows.length, 0);
  const flightCount = status?.flightCount ?? batch?.samples.length ?? 0;
  const hotelCount = status?.hotelCount ?? batch?.hotels?.length ?? 0;
  const [collectionStartedAt, setCollectionStartedAt] = useState<number | null>(null);
  const [progressNow, setProgressNow] = useState(Date.now());
  const serverOperation = status?.activeOperation ?? null;
  const isCollectionRunning = collecting || realCollecting || internationalCollecting || fullCollecting || regeneratingArtifacts;
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
          : regeneratingArtifacts
            ? "重新生成交付包"
            : "";
  const runningCollectionLabel = localCollectionLabel || serverOperation?.label || "";
  const serverStartedAt = serverOperation ? Date.parse(serverOperation.startedAt) : Number.NaN;
  const runningStartedAt = collectionStartedAt ?? (Number.isNaN(serverStartedAt) ? null : serverStartedAt);
  const runningIsFull = runningCollectionLabel.includes("完整真实采集");
  const runningIsSegment = runningCollectionLabel.includes("国内真实采集") || runningCollectionLabel.includes("国际真实采集");
  const runningIsRegeneratingArtifacts = runningCollectionLabel.includes("重新生成交付包");
  const runningEstimateText = runningIsFull ? "预计 10-18 分钟" : runningIsSegment ? "预计 5-10 分钟" : runningIsRegeneratingArtifacts ? "预计 30 秒内" : "预计 10 秒内";
  const runningEstimateMs = runningIsFull ? 15 * 60 * 1000 : runningIsSegment ? 8 * 60 * 1000 : runningIsRegeneratingArtifacts ? 30 * 1000 : 10 * 1000;
  const runningElapsedMs = runningStartedAt ? progressNow - runningStartedAt : 0;
  const runningProgress = isOperationRunning ? estimateProgress(runningElapsedMs, runningEstimateMs) : 0;
  const collectionPaused = serverOperation?.state === "paused";
  const collectionStopping = serverOperation?.state === "stopping";
  const canPauseCollection = Boolean(serverOperation?.canPause);
  const canResumeCollection = Boolean(serverOperation?.canResume);
  const canStopCollection = Boolean(serverOperation?.canStop);
  const fullCollectionRunning = fullCollecting || serverOperation?.label === "完整真实采集";
  const artifactRegenerationRunning = regeneratingArtifacts || serverOperation?.label === "重新生成交付包";
  const manualCollectionDates = useMemo(() => buildManualCollectionDates(collectionDateDraft), [collectionDateDraft]);
  const effectiveCollectionDates = collectionDateMode === "manual" ? manualCollectionDates : defaultCollectionDates;
  const currentBatchCollectionDates = batch?.collectionDates ?? status?.collectionDates ?? null;
  const collectionDateValidationMessage = collectionDateEditing ? validateCollectionDateDraft(collectionDateDraft) : "";
  const collectionDateBlocked = collectionDateEditing || Boolean(collectionDateValidationMessage);
  const dateConfigLocked = isOperationRunning;
  const collectionDateStateLabel = dateConfigLocked
    ? "采集中锁定"
    : collectionDateEditing
      ? "编辑中"
      : collectionDateMode === "manual"
        ? "已指定"
        : "系统默认";
  const thirdVersionValidationMessage = validateThirdVersionOptions(thirdVersionOptions);
  const thirdVersionBlocked = Boolean(thirdVersionValidationMessage || thirdVersionError);
  const connectionReady = connection.tone === "connected";
  const hotelDisplayed = thirdVersionStatus?.hotelDisplayed ?? 0;
  const flightDisplayed = thirdVersionStatus?.flightDisplayed ?? 0;
  const rawHotelCandidates = thirdVersionStatus?.rawHotelCandidates ?? hotelCount;
  const rawFlightCandidates = thirdVersionStatus?.rawFlightCandidates ?? flightCount;
  const hotelAdvantageCount = thirdVersionStatus?.hotelAdvantageCount ?? 0;
  const flightAdvantageCount = thirdVersionStatus?.flightAdvantageCount ?? 0;
  const hotelAdvantageRatio = thirdVersionStatus?.hotelAdvantageRatio ?? 0;
  const flightAdvantageRatio = thirdVersionStatus?.flightAdvantageRatio ?? 0;
  const hotelFull = thirdVersionStatus?.hotelFull ?? false;
  const flightFull = thirdVersionStatus?.flightFull ?? false;
  const hotelTargetMet = thirdVersionStatus?.hotelTargetMet ?? false;
  const flightTargetMet = thirdVersionStatus?.flightTargetMet ?? false;
  const fullState = hotelFull && flightFull;
  const targetState = thirdVersionOptions.generationMode === "qingmao_advantage" ? hotelTargetMet && flightTargetMet : null;
  const exportBaseName = thirdVersionStatus?.exportBaseName ?? "【随】青猫差旅一体化比价-酒店0-航班0-优势0%";
  const exportHtmlName = thirdVersionStatus?.exportNamePreview ?? `${exportBaseName}.html`;
  const exportExcelName = `${exportBaseName}.xlsx`;
  const failureTraceRows = view?.failureNotes.filter(isFailureTraceNote) ?? [];
  const visibleFailureTraceRows = failureTraceRows.length > 0 ? failureTraceRows : (view?.failureNotes ?? []);
  const failureTraceTableRows = visibleFailureTraceRows.length > 0 ? visibleFailureTraceRows : ["当前没有失败留痕记录。"];
  const hasFailureTraceRows = visibleFailureTraceRows.length > 0;
  const failureRecordCount = view ? Math.max(view.failedCount, visibleFailureTraceRows.length) : 0;
  const failureScreenshotCount = visibleFailureTraceRows.filter((note) => /截图|screenshot|\.png|\.jpe?g/i.test(note)).length;
  const failureHtmlSnapshotCount = visibleFailureTraceRows.filter((note) => /html|网页快照|快照|\.html/i.test(note)).length;
  const pendingManualReviewCount = visibleFailureTraceRows.filter((note) => /待|复核|人工/i.test(note)).length;

  function refreshDefaultCollectionDates() {
    const nextDefaultDates = buildDefaultCollectionDates();
    setDefaultCollectionDates(nextDefaultDates);
    return nextDefaultDates;
  }

  function startCollectionDateEditing() {
    if (dateConfigLocked) return;
    const baseDates = collectionDateMode === "manual" ? manualCollectionDates : refreshDefaultCollectionDates();
    setCollectionDateDraft(collectionDateDraftFromConfig(baseDates));
    setCollectionDateEditing(true);
  }

  function saveManualCollectionDates() {
    if (dateConfigLocked) return;
    const validationMessage = validateCollectionDateDraft(collectionDateDraft);
    if (validationMessage) return;
    setCollectionDateMode("manual");
    setCollectionDateEditing(false);
  }

  function restoreDefaultCollectionDates() {
    if (dateConfigLocked) return;
    const nextDefaultDates = refreshDefaultCollectionDates();
    setCollectionDateDraft(collectionDateDraftFromConfig(nextDefaultDates));
    setCollectionDateMode("default");
    setCollectionDateEditing(false);
  }

  function collectionDatesForRequest() {
    return collectionDateMode === "manual" ? manualCollectionDates : buildDefaultCollectionDates();
  }

  function lockCollectionDatesForStart() {
    const lockedDates = collectionDateMode === "manual" ? buildManualCollectionDates(collectionDateDraft) : refreshDefaultCollectionDates();
    setLockedCollectionDates(lockedDates);
    return lockedDates;
  }

  function markCollectionStart() {
    const startedAt = Date.now();
    setCollectionStartedAt(startedAt);
    setProgressNow(startedAt);
    setPilotError("");
    setCollectionResult(null);
  }

  async function refreshStatus() {
    const latestStatus = await readJson<StatusResponse>("/api/status");
    setStatus(latestStatus);
    setArtifacts(latestStatus.artifacts);
    setThirdVersionOptions(latestStatus.thirdVersion.options);
    setThirdVersionStatus(latestStatus.thirdVersion.status);

    if (!latestStatus.hasBatch) {
      setBatch(null);
      return;
    }

    const latest = await readJson<BatchResponse>("/api/batch/latest");
    setBatch(latest.batch);
    setArtifacts(latest.artifacts);
    if (latest.thirdVersion) {
      setThirdVersionOptions(latest.thirdVersion.options);
      setThirdVersionStatus(latest.thirdVersion.status);
    }
  }

  async function refreshPilot() {
    const [nextPilot, nextQingmaoCandidates, nextSameFlightComparison, nextZtripProbe, nextZtripFlight, nextZtripHotel] = await Promise.all([
      readJson<PilotResult>("/api/pilot/status"),
      readJson<QingmaoCandidateProbeResult>("/api/pilot/qingmao-candidates/status"),
      readJson<SameFlightComparisonProbeResult>("/api/pilot/same-flight/status"),
      readJson<ZtripProbeResult>("/api/pilot/ztrip/status"),
      readJson<ZtripFlightProbeResult>("/api/pilot/ztrip-flight/status"),
      readJson<ZtripHotelProbeResult>("/api/pilot/ztrip-hotel/status")
    ]);
    setPilot(nextPilot);
    setQingmaoCandidates(nextQingmaoCandidates);
    setSameFlightComparison(nextSameFlightComparison);
    setZtripProbe(nextZtripProbe);
    setZtripFlight(nextZtripFlight);
    setZtripHotel(nextZtripHotel);
  }

  async function updateThirdVersionConfig(patch: ThirdVersionConfigPatch) {
    const nextOptions: ThirdVersionStrategyOptions = {
      ...thirdVersionOptions,
      ...patch
    };
    if (patch.comparisonMode && patch.comparisonMode !== "specified_platform") {
      delete nextOptions.specifiedPlatform;
    }

    setThirdVersionOptions(nextOptions);
    const validationMessage = validateThirdVersionOptions(nextOptions);
    if (validationMessage) {
      setThirdVersionError(validationMessage);
      return;
    }

    setThirdVersionSaving(true);
    setThirdVersionError("");
    try {
      const result = await readJson<{ thirdVersion: ThirdVersionResponse }>("/api/third-version/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextOptions)
      });
      setThirdVersionOptions(result.thirdVersion.options);
      setThirdVersionStatus(result.thirdVersion.status);
    } catch (configError) {
      setThirdVersionError(configError instanceof Error ? configError.message : "第三版配置保存失败");
    } finally {
      setThirdVersionSaving(false);
    }
  }

  async function collect() {
    markCollectionStart();
    setCollecting(true);
    setError("");

    try {
      const result = await readJson<BatchResponse>("/api/collect", { method: "POST" });
      setBatch(result.batch);
      setArtifacts(result.artifacts);
      setCollectionResult({ tone: "success", title: "模拟采集完成", detail: `已生成 ${result.batch.sampleCount} 条样本，可以导出 Excel 和离线网页。` });
      await refreshStatus();
    } catch (collectionError) {
      const message = collectionError instanceof Error ? collectionError.message : "采集失败";
      setError(message);
      setCollectionResult({ tone: "failed", title: "模拟采集失败", detail: message });
    } finally {
      setCollecting(false);
      setCollectionStartedAt(null);
      void refreshStatus().catch(() => undefined);
    }
  }

  async function collectRealDomestic() {
    const collectionDates = lockCollectionDatesForStart();
    markCollectionStart();
    setRealCollecting(true);
    setError("");

    try {
      const result = await readJson<BatchResponse>("/api/collect-real-domestic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionDates })
      });
      setBatch(result.batch);
      setArtifacts(result.artifacts);
      setCollectionResult({ tone: "success", title: "国内真实采集完成", detail: `已生成 ${result.batch.sampleCount} 条国内样本，可以导出 Excel 和离线网页。` });
      await refreshStatus();
    } catch (collectionError) {
      const message = collectionError instanceof Error ? collectionError.message : "国内真实采集失败";
      setError(message);
      setCollectionResult({ tone: "failed", title: "国内真实采集失败", detail: message });
    } finally {
      setRealCollecting(false);
      setCollectionStartedAt(null);
      void refreshStatus().catch(() => undefined);
    }
  }

  async function collectRealInternational() {
    const collectionDates = lockCollectionDatesForStart();
    markCollectionStart();
    setInternationalCollecting(true);
    setError("");

    try {
      const result = await readJson<BatchResponse>("/api/collect-real-international", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionDates })
      });
      setBatch(result.batch);
      setArtifacts(result.artifacts);
      setCollectionResult({ tone: "success", title: "国际真实采集完成", detail: `已生成 ${result.batch.sampleCount} 条国际样本，可以导出 Excel 和离线网页。` });
      await refreshStatus();
    } catch (collectionError) {
      const message = collectionError instanceof Error ? collectionError.message : "国际真实采集失败";
      setError(message);
      setCollectionResult({ tone: "failed", title: "国际真实采集失败", detail: message });
    } finally {
      setInternationalCollecting(false);
      setCollectionStartedAt(null);
      void refreshStatus().catch(() => undefined);
    }
  }

  async function collectRealFull() {
    const validationMessage = validateThirdVersionOptions(thirdVersionOptions);
    if (validationMessage) {
      setThirdVersionError(validationMessage);
      setCollectionResult({ tone: "failed", title: "第三版配置未保存", detail: validationMessage });
      return;
    }
    if (collectionDateEditing) {
      setCollectionResult({ tone: "failed", title: "采集时间未保存", detail: "采集时间还在编辑中，请先保存指定时间或恢复默认。" });
      return;
    }
    const collectionDateDraftMessage = collectionDateMode === "manual" ? validateCollectionDateDraft(collectionDateDraft) : "";
    if (collectionDateDraftMessage) {
      setCollectionResult({ tone: "failed", title: "采集时间校验失败", detail: collectionDateDraftMessage });
      return;
    }

    const collectionDates = lockCollectionDatesForStart();
    markCollectionStart();
    setFullCollecting(true);
    setError("");

    try {
      const result = await readJson<BatchResponse>("/api/collect-real-full", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...thirdVersionOptions,
          collectionDates
        })
      });
      setBatch(result.batch);
      setArtifacts(result.artifacts);
      if (result.thirdVersion) {
        setThirdVersionOptions(result.thirdVersion.options);
        setThirdVersionStatus(result.thirdVersion.status);
      }
      setCollectionResult({
        tone: "success",
        title: "完整真实采集完成",
        detail: `已生成 ${result.batch.sampleCount} 条样本，可以导出 Excel 和离线网页。本轮日期：${formatCollectionDateSummary(collectionDates)}。`
      });
      await refreshStatus();
    } catch (collectionError) {
      const message = collectionError instanceof Error ? collectionError.message : "完整真实采集失败";
      setError(message);
      setCollectionResult({
        tone: message.includes("采集已停止") ? "info" : "failed",
        title: message.includes("采集已停止") ? "完整真实采集已停止" : "完整真实采集失败",
        detail: `${message}。本轮日期：${formatCollectionDateSummary(collectionDates)}。`
      });
    } finally {
      setFullCollecting(false);
      setCollectionStartedAt(null);
      void refreshStatus().catch(() => undefined);
    }
  }

  async function controlCollection(action: "pause" | "resume" | "stop") {
    const actionLabel = action === "pause" ? "暂停采集" : action === "resume" ? "继续采集" : "停止采集";
    setError("");

    try {
      await readJson<{ message: string; activeOperation: StatusResponse["activeOperation"] }>(`/api/collection/${action}`, { method: "POST" });
      await refreshStatus();
      setCollectionResult({
        tone: "info",
        title: `${actionLabel}已提交`,
        detail: action === "stop" ? "系统会在下一个安全点停止，本轮不会生成半成品批次。" : "系统会在采集安全点切换状态，不会改写当前已发布批次。"
      });
    } catch (controlError) {
      const message = controlError instanceof Error ? controlError.message : `${actionLabel}失败`;
      setError(message);
      setCollectionResult({ tone: "failed", title: `${actionLabel}失败`, detail: message });
    }
  }

  async function regenerateArtifacts() {
    markCollectionStart();
    setRegeneratingArtifacts(true);
    setError("");

    try {
      const result = await readJson<BatchResponse>("/api/artifacts/regenerate", { method: "POST" });
      setBatch(result.batch);
      setArtifacts(result.artifacts);
      setCollectionResult({ tone: "success", title: "交付包已重新生成", detail: "未重新采集数据，已基于当前批次重新生成 Excel 和离线网页。" });
      await refreshStatus();
    } catch (regenerationError) {
      const message = regenerationError instanceof Error ? regenerationError.message : "交付包重新生成失败";
      setError(message);
      setCollectionResult({ tone: "failed", title: "交付包重新生成失败", detail: message });
    } finally {
      setRegeneratingArtifacts(false);
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

  async function cleanupBrowserPages() {
    setPilotBusy("cleanup");
    setPilotError("");

    try {
      const result = await readJson<BrowserCleanupResult>("/api/pilot/cleanup-browser-pages", { method: "POST" });
      if (result.status === "failed") {
        setPilotError(result.error ?? result.message);
        setCollectionResult({ tone: "failed", title: "采集窗口清理失败", detail: result.error ?? result.message });
        return;
      }
      setCollectionResult({
        tone: "success",
        title: "采集窗口已清理",
        detail: `关闭 ${result.closedCount} 个采集临时窗口，当前剩余 ${result.afterCount} 个窗口。`
      });
    } catch (cleanupError) {
      const message = cleanupError instanceof Error ? cleanupError.message : "采集窗口清理失败";
      setPilotError(message);
      setCollectionResult({ tone: "failed", title: "采集窗口清理失败", detail: message });
    } finally {
      setPilotBusy("");
    }
  }

  async function runQingmaoCandidateProbe() {
    setPilotBusy("qingmao-candidates");
    setPilotError("");

    try {
      const result = await readJson<QingmaoCandidateProbeResult>("/api/pilot/qingmao-candidates/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionDates: collectionDatesForRequest() })
      });
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
      const result = await readJson<SameFlightComparisonProbeResult>("/api/pilot/same-flight/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionDates: collectionDatesForRequest() })
      });
      setSameFlightComparison(result);
    } catch (probeError) {
      setPilotError(probeError instanceof Error ? probeError.message : "同航班比价失败");
    } finally {
      setPilotBusy("");
    }
  }

  async function runZtripProbe() {
    setPilotBusy("ztrip");
    setPilotError("");

    try {
      const result = await readJson<ZtripProbeResult>("/api/pilot/ztrip/run", { method: "POST" });
      setZtripProbe(result);
    } catch (probeError) {
      setPilotError(probeError instanceof Error ? probeError.message : "在途商旅验证失败");
    } finally {
      setPilotBusy("");
    }
  }

  async function runZtripFlightProbe() {
    setPilotBusy("ztrip-flight");
    setPilotError("");

    try {
      const result = await readJson<ZtripFlightProbeResult>("/api/pilot/ztrip-flight/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionDates: collectionDatesForRequest() })
      });
      setZtripFlight(result);
    } catch (probeError) {
      setPilotError(probeError instanceof Error ? probeError.message : "在途商旅航班样本采集失败");
    } finally {
      setPilotBusy("");
    }
  }

  async function runZtripHotelProbe() {
    setPilotBusy("ztrip-hotel");
    setPilotError("");

    try {
      const result = await readJson<ZtripHotelProbeResult>("/api/pilot/ztrip-hotel/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionDates: collectionDatesForRequest() })
      });
      setZtripHotel(result);
    } catch (probeError) {
      setPilotError(probeError instanceof Error ? probeError.message : "在途商旅酒店样本采集失败");
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
    <main className="shell">
      <header className="top-status" aria-label="顶部状态条">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">Q</div>
          <div>
            <b>青猫差旅比价管理台</b>
            <span>第三版阶段 1 · 管理端交互设计</span>
          </div>
        </div>
        <div className="status-strip" aria-label="平台状态">
          <div className="status-chip"><i className={`dot ${connectionDotTone(connection.tone)}`} /><span>{connection.title}</span></div>
          <div className="status-chip"><i className={isOperationRunning ? "dot warn" : "dot ok"} /><span>运行状态：{runningCollectionLabel || "空闲"}</span></div>
          <div className="status-chip"><i className="dot ok" /><span>最近数据：{formatDateTime(status?.generatedAt ?? null)}</span></div>
        </div>
        <div className="batch-pill">{status?.batchId ?? "暂无当前批次"}</div>
      </header>

      <section className="hero-grid" aria-label="管理端首屏">
        <article className="overview-card">
          <div className="overview-copy">
            <p className="screen-kicker">Third Version Console</p>
            <h1>先配置展示策略，再执行完整真实采集</h1>
            <p>这个页面只给采集负责人使用。首屏保留登录、连接、采集、导出四个真实动作，同时把酒店 40 家、航班 20 条、青猫优势比例和比价口径放在采集前确认。</p>
          </div>

          <div className="delivery-preview" aria-label="本次采集总览">
            <div className="preview-title">
              <b>本次采集总览</b>
              <span className="badge neutral">{generationModeLabels[thirdVersionOptions.generationMode]}</span>
            </div>
            <div className="analysis-grid">
              <div className="analysis-card">
                <span>原始候选池</span>
                <strong>{rawHotelCandidates + rawFlightCandidates}</strong>
                <small>酒店候选 {rawHotelCandidates} 家 / 航班候选 {rawFlightCandidates} 条</small>
              </div>
              <div className="analysis-card">
                <span>最终展示</span>
                <strong>{hotelDisplayed + flightDisplayed}</strong>
                <small>酒店 {hotelDisplayed} 家 / 航班 {flightDisplayed} 条</small>
              </div>
              <div className="analysis-card">
                <span>青猫优势样本</span>
                <strong>{hotelAdvantageCount + flightAdvantageCount}</strong>
                <small>酒店 {hotelAdvantageCount} 家 / 航班 {flightAdvantageCount} 条</small>
              </div>
              <a className="analysis-card actionable" href="#failureTracePanel" aria-label="查看失败留痕" onClick={() => setFailureTraceOpen(true)}>
                <span>失败留痕</span>
                <strong>{status?.failedCount ?? batch?.failedCount ?? 0}</strong>
                <small>不进客户页，只进后台复核</small>
                <em className="card-link">查看失败记录和截图</em>
              </a>
            </div>
            <div className="summary-list">
              <div className="summary-line"><span>酒店分析</span><b>青猫优势 {percentLabel(hotelAdvantageRatio)}，满量 {hotelDisplayed}/{thirdVersionOptions.hotelDisplayLimit}</b><strong>{targetMetBadgeLabel(hotelTargetMet)}</strong></div>
              <div className="summary-line"><span>航班分析</span><b>青猫优势 {percentLabel(flightAdvantageRatio)}，满量 {flightDisplayed}/{thirdVersionOptions.flightDisplayLimit}</b><strong>{targetMetBadgeLabel(flightTargetMet)}</strong></div>
              <div className="summary-line"><span>证据文件</span><b>四平台截图与 HTML 快照</b><strong>{view?.evidenceCount ?? 0} 份</strong></div>
              <div className="summary-line"><span>导出状态</span><b>Excel 与离线网页使用同一份策略结果</b><strong>{artifacts ? "可导出" : "待生成"}</strong></div>
            </div>
          </div>
        </article>

        <aside className="action-card" aria-label="正式操作区">
          <p className="section-label">Formal Actions</p>
          <h2>正式操作区</h2>
          <div className="action-stack">
            <button className="op-button" type="button" onClick={openPilotLogin} disabled={operationLocked}>
              <span className="step">1</span>
              <span><b>打开登录浏览器</b><small>保持四个平台登录窗口打开</small></span>
              <span className="state">{pilotBusy === "login" ? "打开中" : "可操作"}</span>
            </button>
            <button className="op-button" type="button" onClick={runAttachedPilotProbe} disabled={operationLocked}>
              <span className="step">2</span>
              <span><b>连接当前登录窗口</b><small>检查青猫、携程、阿里、在途</small></span>
              <span className="state">{pilotBusy === "attached" ? "连接中" : connectionReady ? "已连接" : "待连接"}</span>
            </button>
            <button className="op-button primary" type="button" onClick={collectRealFull} disabled={isOperationRunning || Boolean(pilotBusy) || loading || thirdVersionSaving || thirdVersionBlocked || collectionDateBlocked || !connectionReady}>
              <span className="step">3</span>
              <span><b>开始完整真实采集</b><small>采集期间锁定登录和探测按钮</small></span>
              <span className="state">{fullCollectionRunning ? "采集中" : "主操作"}</span>
            </button>
            {artifacts?.excel ? (
              <a className="op-button export" href={artifacts.excel}>
                <span className="step">4</span>
                <span><b>导出 Excel</b><small>客户主表跟随当前口径</small></span>
                <span className="state">可导出</span>
              </a>
            ) : (
              <button className="op-button export" type="button" disabled>
                <span className="step">4</span>
                <span><b>导出 Excel</b><small>客户主表跟随当前口径</small></span>
                <span className="state">待生成</span>
              </button>
            )}
            {artifacts?.offlinePackage ? (
              <a className="op-button export" href={artifacts.offlinePackage}>
                <span className="step">5</span>
                <span><b>导出离线网页</b><small>单个 HTML，销售直接打开</small></span>
                <span className="state">可导出</span>
              </a>
            ) : (
              <button className="op-button export" type="button" disabled>
                <span className="step">5</span>
                <span><b>导出离线网页</b><small>单个 HTML，销售直接打开</small></span>
                <span className="state">待生成</span>
              </button>
            )}
          </div>
          <div className="collection-control-row" aria-label="采集控制区">
            <button
              className={`collection-control-button ${collectionPaused ? "resume" : ""}`}
              type="button"
              onClick={() => void controlCollection(collectionPaused ? "resume" : "pause")}
              disabled={collectionStopping || (!canPauseCollection && !canResumeCollection)}
            >
              <b>{collectionPaused ? "继续采集" : "暂停采集"}</b>
              <small>{collectionPaused ? "从安全点继续执行" : "停在下一个安全点"}</small>
            </button>
            <button
              className="collection-control-button danger"
              type="button"
              onClick={() => void controlCollection("stop")}
              disabled={collectionStopping || !canStopCollection}
            >
              <b>停止采集</b>
              <small>不生成半成品批次</small>
            </button>
          </div>
          {["partial", "failed", "running"].includes(connection.tone) ? (
          <div className={`connection-card ${connection.tone}`}>
            <div>
              {connection.tone === "connected" ? <CircleCheckBig size={18} /> : connection.tone === "failed" ? <AlertTriangle size={18} /> : <Monitor size={18} />}
              <strong>{connection.title}</strong>
            </div>
            <p>{connection.detail}</p>
          </div>
          ) : null}
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
                {collectionPaused
                  ? "采集已暂停在安全点，点击继续采集后恢复。"
                  : collectionStopping
                    ? "采集正在停止，本轮不会生成半成品批次。"
                    : `${runningEstimateText}。${runningIsRegeneratingArtifacts ? "系统正在基于当前批次重新整理 Excel 和离线网页，不会重新访问平台。" : "系统正在通过已登录浏览器后台采集，期间已锁定连接和后台探测按钮。"}`}
              </p>
            </div>
          ) : null}
          {collectionResult ? (
            <div className={`collection-result-card ${collectionResult.tone}`} role={collectionResult.tone === "failed" ? "alert" : "status"} aria-live="polite">
              <div>
                {collectionResult.tone === "success" ? <CircleCheckBig size={18} /> : collectionResult.tone === "info" ? <Monitor size={18} /> : <AlertTriangle size={18} />}
                <strong>{collectionResult.title}</strong>
              </div>
              <p>{collectionResult.detail}</p>
            </div>
          ) : null}
        </aside>
      </section>

      <section className="content-grid" aria-label="第三版配置和状态">
        <article className="config-card" aria-label="第三版配置区">
          <p className="section-label">Version 3 Config</p>
          <h2>第三版配置区</h2>
          {thirdVersionError || thirdVersionValidationMessage || thirdVersionSaving ? (
            <div className={`third-version-save ${thirdVersionError || thirdVersionValidationMessage ? "failed" : thirdVersionSaving ? "saving" : "saved"}`}>
              <SlidersHorizontal size={16} className={thirdVersionSaving ? "spin" : ""} />
              <span>{thirdVersionError || thirdVersionValidationMessage || "正在保存配置"}</span>
            </div>
          ) : null}
          <div className="config-grid">
            <div className={`field wide collection-date-field ${collectionDateEditing ? "editing" : ""} ${dateConfigLocked ? "locked" : ""} ${collectionDateValidationMessage ? "invalid" : ""}`}>
              <div className="collection-date-head">
                <div>
                  <span className="field-label">采集时间</span>
                  <strong>{collectionDateStateLabel}</strong>
                </div>
                <div className="collection-date-actions">
                  {collectionDateMode === "manual" && !collectionDateEditing ? (
                    <button className="date-action-button secondary" type="button" onClick={restoreDefaultCollectionDates} disabled={dateConfigLocked}>
                      恢复默认
                    </button>
                  ) : null}
                  <button className="date-action-button" type="button" onClick={startCollectionDateEditing} disabled={dateConfigLocked || collectionDateEditing}>
                    {collectionDateMode === "manual" ? "修改指定时间" : "指定时间"}
                  </button>
                </div>
              </div>

              <div className="collection-date-summary" aria-label="采集时间摘要">
                {collectionDateMode === "default" && !collectionDateEditing ? (
                  <>
                    <div>
                      <span>默认航班出行</span>
                      <b>{defaultCollectionDates.flightTravelDate}</b>
                    </div>
                    <div>
                      <span>默认酒店入住</span>
                      <b>{defaultCollectionDates.hotelCheckInDate}</b>
                    </div>
                    <div>
                      <span>默认酒店离店</span>
                      <b>{defaultCollectionDates.hotelCheckOutDate}</b>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <span>航班出行</span>
                      <b>{effectiveCollectionDates.flightTravelDate || "待填写"}</b>
                    </div>
                    <div>
                      <span>酒店入住</span>
                      <b>{effectiveCollectionDates.hotelCheckInDate || "待填写"}</b>
                    </div>
                    <div>
                      <span>酒店离店</span>
                      <b>{effectiveCollectionDates.hotelCheckOutDate || "待计算"}</b>
                    </div>
                  </>
                )}
              </div>

              {collectionDateEditing ? (
                <div className="collection-date-editor" aria-label="指定时间设置">
                  <label>
                    <span>航班出行日期</span>
                    <input
                      type="date"
                      value={collectionDateDraft.flightTravelDate}
                      disabled={dateConfigLocked}
                      onChange={(event) => {
                        const flightTravelDate = event.currentTarget.value;
                        setCollectionDateDraft((draft) => ({ ...draft, flightTravelDate }));
                      }}
                    />
                  </label>
                  <label>
                    <span>酒店入住日期</span>
                    <input
                      type="date"
                      value={collectionDateDraft.hotelCheckInDate}
                      disabled={dateConfigLocked}
                      onChange={(event) => {
                        const hotelCheckInDate = event.currentTarget.value;
                        setCollectionDateDraft((draft) => ({ ...draft, hotelCheckInDate }));
                      }}
                    />
                  </label>
                  <label className="readonly-date">
                    <span>酒店离店日期</span>
                    <input type="date" value={manualCollectionDates.hotelCheckOutDate} readOnly disabled />
                  </label>
                  <div className="fixed-night-note">当前酒店固定采 1 晚</div>
                  <div className="collection-date-editor-actions">
                    <button className="date-action-button" type="button" onClick={saveManualCollectionDates} disabled={dateConfigLocked || Boolean(collectionDateValidationMessage)}>
                      保存指定时间
                    </button>
                    <button className="date-action-button secondary" type="button" onClick={restoreDefaultCollectionDates} disabled={dateConfigLocked}>
                      恢复默认
                    </button>
                  </div>
                  {collectionDateValidationMessage ? (
                    <div className="collection-date-error" role="alert">
                      {collectionDateValidationMessage}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {dateConfigLocked && lockedCollectionDates ? (
                <p className="collection-date-lock-note">本轮日期已锁定：{formatCollectionDateSummary(lockedCollectionDates)}</p>
              ) : null}
            </div>
            <div className="field">
              <label>酒店展示数量</label>
              <div className="number-control">
              <input
                type="number"
                min={1}
                step={1}
                value={thirdVersionOptions.hotelDisplayLimit}
                onChange={(event) => void updateThirdVersionConfig({ hotelDisplayLimit: Number(event.currentTarget.value) })}
              />
                <span className="unit">家</span>
              </div>
            </div>
            <div className="field">
              <label>航班展示数量</label>
              <div className="number-control">
              <input
                type="number"
                min={1}
                step={1}
                value={thirdVersionOptions.flightDisplayLimit}
                onChange={(event) => void updateThirdVersionConfig({ flightDisplayLimit: Number(event.currentTarget.value) })}
              />
                <span className="unit">条</span>
              </div>
            </div>
            <div className="field wide">
              <span className="field-label">生成模式</span>
              <div className="segmented">
              {(Object.keys(generationModeLabels) as ThirdVersionStrategyOptions["generationMode"][]).map((mode) => (
                <button
                  type="button"
                  key={mode}
                  aria-pressed={thirdVersionOptions.generationMode === mode}
                  className={thirdVersionOptions.generationMode === mode ? "selected" : ""}
                  onClick={() => void updateThirdVersionConfig({ generationMode: mode })}
                >
                  {generationModeLabels[mode]}
                </button>
              ))}
              </div>
            </div>
            <div className={`field wide ${thirdVersionOptions.generationMode === "qingmao_advantage" ? "" : "disabled"}`}>
              <label>青猫优势比例</label>
              <div className="slider-row">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={thirdVersionOptions.targetAdvantageRatio}
                disabled={thirdVersionOptions.generationMode !== "qingmao_advantage"}
                onChange={(event) => void updateThirdVersionConfig({ targetAdvantageRatio: Number(event.currentTarget.value) })}
              />
                <div className="percent-box">{percentLabel(thirdVersionOptions.targetAdvantageRatio)}</div>
              </div>
            </div>
            <div className="field wide">
              <span className="field-label">比价口径</span>
              <div className="segmented three">
              {(Object.keys(comparisonModeLabels) as ThirdVersionStrategyOptions["comparisonMode"][]).map((mode) => (
                <button
                  type="button"
                  key={mode}
                  aria-pressed={thirdVersionOptions.comparisonMode === mode}
                  className={thirdVersionOptions.comparisonMode === mode ? "selected" : ""}
                  onClick={() => void updateThirdVersionConfig({ comparisonMode: mode })}
                >
                  {comparisonModeLabels[mode]}
                </button>
              ))}
              </div>
            </div>
            <div className={`field wide ${thirdVersionOptions.comparisonMode === "specified_platform" ? "" : "disabled"}`}>
              <label>指定平台</label>
              <select
                value={thirdVersionOptions.specifiedPlatform ?? ""}
                disabled={thirdVersionOptions.comparisonMode !== "specified_platform"}
                onChange={(event) => {
                  const specifiedPlatform = event.currentTarget.value as "" | NonNullable<ThirdVersionStrategyOptions["specifiedPlatform"]>;
                  void updateThirdVersionConfig({ specifiedPlatform: specifiedPlatform || undefined });
                }}
              >
                <option value="">请选择竞品平台</option>
                {thirdVersionCompetitors.map((platform) => (
                  <option key={platform} value={platform}>{platform}</option>
                ))}
              </select>
            </div>
          </div>
        </article>

        <div className="side-stack">
          <article className="status-card" aria-label="状态展示区">
            <p className="section-label">Batch Status</p>
            <h2>状态展示区</h2>
            <div className="status-grid">
              <div className={`metric-card ${metricCardTone(hotelFull)}`}>
                <span className="mini-label">酒店实际展示数</span>
                <strong>{hotelDisplayed}/{thirdVersionOptions.hotelDisplayLimit}</strong>
                <small>未满量时仍可导出</small>
              </div>
              <div className={`metric-card ${metricCardTone(flightFull)}`}>
                <span className="mini-label">航班实际展示数</span>
                <strong>{flightDisplayed}/{thirdVersionOptions.flightDisplayLimit}</strong>
                <small>国内和国际合计展示</small>
              </div>
              <div className={`metric-card ${metricCardTone(hotelTargetMet || thirdVersionOptions.generationMode === "real_random")}`}>
                <span className="mini-label">酒店青猫优势比例</span>
                <strong>{percentLabel(hotelAdvantageRatio)}</strong>
                <small>{thirdVersionOptions.generationMode === "qingmao_advantage" ? `目标 ${percentLabel(thirdVersionOptions.targetAdvantageRatio)}` : "真实随机模式仅展示比例"}</small>
              </div>
              <div className={`metric-card ${metricCardTone(flightTargetMet || thirdVersionOptions.generationMode === "real_random")}`}>
                <span className="mini-label">航班青猫优势比例</span>
                <strong>{percentLabel(flightAdvantageRatio)}</strong>
                <small>{thirdVersionOptions.generationMode === "qingmao_advantage" ? `目标 ${percentLabel(thirdVersionOptions.targetAdvantageRatio)}` : "真实随机模式仅展示比例"}</small>
              </div>
              <div className={`metric-card ${metricCardTone(fullState)}`}>
                <span className="mini-label">是否满量</span>
                <strong>{fullState ? "满量" : "未满量"}</strong>
                <small>酒店和航班分别判断</small>
              </div>
              <div className={`metric-card ${targetState === false ? "warn" : "ok"}`}>
                <span className="mini-label">是否达标</span>
                <strong>{targetState === null ? "不判定" : targetMetBadgeLabel(targetState)}</strong>
                <small>{thirdVersionOptions.generationMode === "qingmao_advantage" ? "青猫优势模式启用" : "青猫优势模式启用后判定"}</small>
              </div>
            </div>
          </article>

          <article className="preview-card" aria-label="导出预览">
            <p className="section-label">Export Preview</p>
            <h2>导出预览</h2>
            <div className="file-list">
              <div className="file-row">
                <code>{exportExcelName}</code>
                <span>Excel</span>
              </div>
              <div className="file-row">
                <code>{exportHtmlName}</code>
                <span>离线网页</span>
              </div>
            </div>
          </article>
        </div>
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
            <p>登录四个平台并连接当前窗口后，点击“开始完整真实采集”生成 Excel 和离线网页。</p>
          </div>
        </section>
      ) : null}

      {view ? (
        <>
          <section className="detail-card" aria-label="当前批次明细">
            <div className="detail-head">
              <div>
                <p className="section-label">Current Batch</p>
                <h2>当前批次明细</h2>
                <p>客户主表和离线网页只展示当前比价口径；内部留痕保留四平台原始价格、截图索引和失败原因。</p>
                <div className="section-meta">
                  <span><CalendarDays size={15} /> 国内 / 国际航班</span>
                  <span>本轮日期：{currentBatchCollectionDates ? formatCollectionDateSummary(currentBatchCollectionDates) : "本批次未记录统一目标查询日期"}</span>
                  <span>数据日期：{view.samples[0]?.travelDate ?? "暂无"}</span>
                </div>
              </div>
              <div className="table-tabs" role="tablist" aria-label="明细切换">
                <button
                  type="button"
                  className={activeDetailTab === "flight" ? "active" : ""}
                  onClick={() => setActiveDetailTab("flight")}
                >
                  航班明细
                </button>
                <button
                  type="button"
                  className={activeDetailTab === "hotel" ? "active" : ""}
                  onClick={() => setActiveDetailTab("hotel")}
                >
                  酒店明细
                </button>
              </div>
            </div>

            <div className={activeDetailTab === "flight" ? "table-wrap" : "table-wrap hidden"} id="flightTable">
              <table className="batch-table">
                <colgroup>
                  <col className="route-column" />
                  <col className="flight-column" />
                  <col className="platform-column" />
                  <col className="platform-column" />
                  <col className="platform-column" />
                  <col className="platform-column" />
                  <col className="gap-column" />
                  <col className="conclusion-column" />
                </colgroup>
                <thead>
                  <tr>
                    <th>航线</th>
                    <th>日期 / 航班</th>
                    {comparisonPlatforms.map((platform) => (
                      <th key={platform}><span className={`platform-head ${platformHeadClass(platform)}`}>{platform}</span></th>
                    ))}
                    <th>当前口径结论</th>
                    <th>网页截图</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedFlightRows.map((sample) => (
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
                        <b>{sample.travelDate}</b>
                        <span>{sample.flightNo} · {sample.cabin}</span>
                        <span>{sample.airline} / {sample.transferLabel} / {sample.durationLabel}</span>
                      </td>
                      {sample.quotes.map((quote) => (
                        <td
                          key={quote.platform}
                          className={[
                            "platform-price-cell",
                            platformPriceClass(quote),
                            quote.available ? "available" : "unavailable"
                          ].join(" ")}
                        >
                          <b>{quote.priceLabel}</b>
                          {quote.status !== quote.priceLabel ? <span>{quote.status}</span> : null}
                        </td>
                      ))}
                      <td>
                        <span className={sample.gapTone === "higher" ? "gap-bad" : "gap-good"}>{sample.gapLabel}</span>
                        <span>{sample.conclusion}</span>
                      </td>
                      <td>
                        <span className={`badge ${sample.quotes.filter((quote) => quote.evidencePath).length < 4 ? "warn" : "neutral"}`}>
                          {sample.quotes.filter((quote) => quote.evidencePath).length} 张
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visibleSamples.length > 3 ? (
                <div className="table-footer">
                  <button className="expand-detail" type="button" onClick={() => setFlightDetailExpanded((expanded) => !expanded)}>
                    {flightDetailExpanded ? "收起航班明细" : `展开更多航班明细（还有 ${hiddenFlightRowCount} 条）`}
                  </button>
                </div>
              ) : null}
            </div>

            <div className={activeDetailTab === "hotel" ? "table-wrap" : "table-wrap hidden"} id="hotelTable">
              {hotelRows.length > 0 ? (
                <table className="batch-table hotel-table">
                  <colgroup>
                    <col className="hotel-column" />
                    <col className="hotel-rate-column" />
                    <col className="platform-column" />
                    <col className="platform-column" />
                    <col className="platform-column" />
                    <col className="platform-column" />
                    <col className="gap-column" />
                    <col className="conclusion-column" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>酒店</th>
                      <th>日期 / 口径</th>
                    {comparisonPlatforms.map((platform) => (
                      <th key={platform}><span className={`platform-head ${platformHeadClass(platform)}`}>{platform}</span></th>
                    ))}
                      <th>当前口径结论</th>
                      <th>网页截图</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedHotelRows.map((hotel) => (
                      <tr key={hotel.id}>
                        <td>
                          <div className="route-cell hotel-cell">
                            <span className="route-icon hotel-icon"><Building2 size={16} /></span>
                            <div>
                              <b>{hotel.hotelName}</b>
                              <span>{hotel.group} / {hotel.brand} / {hotel.city}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <b>{hotel.primaryRatePlanLabel}</b>
                          <span>{hotel.stayLabel}</span>
                          <span>{hotel.nightsLabel} / 完整口径 {hotel.completeRatePlanCount} 个</span>
                        </td>
                        {hotel.quotes.map((quote) => (
                          <td
                            key={quote.platform}
                            className={[
                              "platform-price-cell",
                              platformPriceClass(quote),
                              quote.available ? "available" : "unavailable"
                            ].join(" ")}
                          >
                            <b>{quote.priceLabel}</b>
                            {quote.status !== quote.priceLabel ? <span>{quote.status}</span> : null}
                          </td>
                        ))}
                        <td>
                          <span className={hotel.gapTone === "higher" ? "gap-bad" : "gap-good"}>{hotel.gapLabel}</span>
                          <span>{hotel.conclusion}</span>
                          <span>{hotel.salesDisplayReason}</span>
                        </td>
                        <td>
                          <span className={`badge ${hotel.quotes.filter((quote) => quote.evidencePath).length < 4 ? "warn" : "neutral"}`}>
                            {hotel.quotes.filter((quote) => quote.evidencePath).length} 张
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty-detail">
                  <Building2 size={24} />
                  <span>当前批次没有酒店明细。</span>
                </div>
              )}
              {hotelRows.length > 3 ? (
                <div className="table-footer">
                  <button className="expand-detail" type="button" onClick={() => setHotelDetailExpanded((expanded) => !expanded)}>
                    {hotelDetailExpanded ? "收起酒店明细" : `展开更多酒店明细（还有 ${hiddenHotelRowCount} 家）`}
                  </button>
                </div>
              ) : null}
            </div>
          </section>

          <section className="advanced-card" aria-label="问题排查区">
            <details>
              <summary>
                <div>
                  <p className="section-label">Diagnostics</p>
                  <h2>问题排查区（平时不用）</h2>
                  <p className="diagnostic-copy">完整真实采集失败时才打开这里。它用来拆开排查是哪一段坏了：登录态、航班链路、酒店候选池，还是某个平台页面结构变化。</p>
                </div>
                <span className="badge neutral">默认折叠</span>
              </summary>
              <div className="advanced-actions">
                <button className="tiny-button" type="button" onClick={runPilotProbe} disabled={operationLocked}>
                  {pilotBusy === "probe" ? "后台探测中" : "检查四平台登录态"}
                </button>
                <button className="tiny-button" type="button" onClick={collectRealDomestic} disabled={operationLocked || loading}>
                  {realCollecting ? "航班链路采集中" : "只跑航班采集链路"}
                </button>
                <button className="tiny-button" type="button" onClick={runZtripHotelProbe} disabled={operationLocked}>
                  {pilotBusy === "ztrip-hotel" ? "酒店候选池采集中" : "只跑酒店候选池"}
                </button>
                <button className="tiny-button" type="button" onClick={runZtripProbe} disabled={operationLocked}>
                  {pilotBusy === "ztrip" ? "单平台验证中" : "单平台故障验证"}
                </button>
                <button className="tiny-button" type="button" onClick={cleanupBrowserPages} disabled={operationLocked}>
                  {pilotBusy === "cleanup" ? "正在清理" : "清理采集窗口"}
                </button>
                <button className="tiny-button" type="button" onClick={regenerateArtifacts} disabled={!batch || operationLocked || loading}>
                  {artifactRegenerationRunning ? "正在重新生成" : "重新生成交付包"}
                </button>
                <button className="tiny-button" type="button" onClick={runQingmaoCandidateProbe} disabled={operationLocked}>
                  {pilotBusy === "qingmao-candidates" ? "读取中" : "读取青猫候选池"}
                </button>
                <button className="tiny-button" type="button" onClick={runSameFlightComparisonProbe} disabled={operationLocked}>
                  {pilotBusy === "same-flight" ? "查询中" : "随机同航班比价"}
                </button>
              </div>
              {pilotError ? (
                <div className="pilot-error diagnostic-error" role="alert">
                  <AlertTriangle size={16} />
                  {pilotError}
                </div>
              ) : null}
              <div className="diagnostic-status-grid">
                <div>
                  <span>登录态检查</span>
                  <b>{pilot ? pilotStatusLabel(pilot.status) : "读取中"}</b>
                  <small>{connection.title}</small>
                </div>
                <div>
                  <span>青猫候选池</span>
                  <b>{qingmaoCandidateStatusLabel(qingmaoCandidates?.status)}</b>
                  <small>{qingmaoCandidates?.message ?? "未单独读取"}</small>
                </div>
                <div>
                  <span>随机同航班</span>
                  <b>{sameFlightStatusLabel(sameFlightComparison?.status)}</b>
                  <small>{sameFlightComparison?.message ?? "未单独比价"}</small>
                </div>
                <div>
                  <span>在途商旅</span>
                  <b>{ztripStatusLabel(ztripProbe?.status)}</b>
                  <small>{ztripProbe?.message ?? "未单独验证"}</small>
                </div>
              </div>
            </details>
          </section>

          <section className={`failure-trace-panel ${failureTraceOpen ? "" : "hidden"}`} id="failureTracePanel" aria-label="失败留痕面板">
            <div className="detail-head">
              <div>
                <p className="section-label">Failure Trace</p>
                <h2>失败留痕</h2>
                <p>这里放不进入客户交付物的失败记录。采集负责人可以看失败原因、当时页面截图或网页快照，再决定放弃、替换候选或重试。</p>
              </div>
              <button className="secondary-action" type="button" onClick={() => setFailureTraceOpen(false)}>收起留痕</button>
            </div>
            <div className="trace-summary">
              <div className="trace-stat"><span>失败记录</span><strong>{failureRecordCount}</strong></div>
              <div className="trace-stat"><span>已保存截图</span><strong>{failureScreenshotCount}</strong></div>
              <div className="trace-stat"><span>HTML 快照</span><strong>{failureHtmlSnapshotCount}</strong></div>
              <div className="trace-stat"><span>待人工复核</span><strong>{pendingManualReviewCount}</strong></div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>对象</th>
                    <th>平台 / 阶段</th>
                    <th>失败原因</th>
                    <th>痕迹文件</th>
                    <th>处理状态</th>
                  </tr>
                </thead>
                <tbody>
                  {failureTraceTableRows.map((note, index) => (
                    <tr key={`${note}-${index}`}>
                      <td><b>{hasFailureTraceRows ? failureTraceObjectLabel(note) : "当前批次"}</b><span>后台留痕</span></td>
                      <td><b>采集链路</b><span>候选处理</span></td>
                      <td><span>{note}</span></td>
                      <td>
                        <div className="trace-actions">
                          <button className="trace-action" type="button" disabled>查看截图</button>
                          <button className="trace-action" type="button" disabled>查看网页快照</button>
                        </div>
                      </td>
                      <td><span className={hasFailureTraceRows ? "trace-status done" : "trace-status"}>{hasFailureTraceRows ? "已入留痕" : "暂无记录"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

        </>
      ) : null}

    </main>
  );
}
