import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { FIXED_ROUTES, INTERNATIONAL_FALLBACK_ROUTES } from "../../src/domain/fakeBatch";
import type { CollectionBatch, FlightSample, PlatformName, PlatformQuote, RouteConfig, RouteScope } from "../../src/domain/types";

type PilotStatus = "idle" | "login-browser-open" | "running" | "completed" | "failed";
type PilotOutcome = "needs-config" | "opened" | "reachable" | "login-required" | "failed";
type QingmaoCandidateStatus = "idle" | "running" | "completed" | "failed";
type SameFlightComparisonStatus = "idle" | "running" | "completed" | "failed";
type SameFlightQuoteStatus = "available" | "not-found" | "failed";
type ZtripProbeStatus = "idle" | "running" | "completed" | "failed";
type ZtripProbeTarget = "入口页" | "航班入口" | "酒店入口";
type ZtripFlightProbeStatus = "idle" | "running" | "completed" | "failed";
type ZtripHotelProbeStatus = "idle" | "running" | "completed" | "failed";
type QingmaoHotelCandidateProbeStatus = "idle" | "running" | "completed" | "failed";
type HotelMainRateProbeStatus = "idle" | "running" | "partial" | "completed" | "failed";
type HotelGroupMainRateProbeStatus = "idle" | "running" | "partial" | "completed" | "failed";
type HotelSingleDiagnosisStatus = "idle" | "running" | "completed" | "failed";
type HotelSingleDiagnosisStep = "pending" | "searching-hotel" | "matching-hotel" | "checking-rate-plan" | "success" | "failed";
type HotelRatePlanProbeStatus = "idle" | "running" | "partial" | "completed" | "failed";
type HotelCalibrationStatus = "idle" | "running" | "partial" | "completed" | "failed";
type HotelRatePlanLabel = "大床无早餐" | "大床有早餐" | "双床无早餐" | "双床有早餐";
const HOTEL_RATE_PLAN_LABELS: HotelRatePlanLabel[] = ["大床无早餐", "大床有早餐", "双床无早餐", "双床有早餐"];
const HOTEL_VALIDATION_RATE_PLAN = readHotelValidationRatePlan();
const HOTEL_CALIBRATION_LIMIT = 3;
const HOTEL_CALIBRATION_MAIN_RATE_PLAN = "大床有早餐";
const HOTEL_CALIBRATION_OTHER_RATE_PLANS: HotelRatePlanLabel[] = ["大床无早餐", "双床有早餐", "双床无早餐"];
const HOTEL_CALIBRATION_PLATFORM_ORDER: PlatformName[] = ["青猫差旅", "阿里商旅", "在途商旅", "携程商旅"];
const HOTEL_CALIBRATION_COMPETITOR_PLATFORM_ORDER: PlatformName[] = ["阿里商旅", "在途商旅", "携程商旅"];
const ALI_HOTEL_LIST_CARD_SELECTOR = ".room-list-hotel-card-block";
const HOTEL_GROUP_MAIN_RATE_MAX_ATTEMPTS = 5;
type HotelGroupName = "首旅如家" | "华住" | "锦江" | "东呈" | "亚朵";
export type HotelCalibrationFailureType =
  | "qingmao_no_main_rate"
  | "qingmao_candidate_keyword_not_applied"
  | "qingmao_candidate_pool_empty"
  | "competitor_no_same_hotel"
  | "competitor_no_main_rate"
  | "login_or_permission_failed"
  | "page_load_timeout"
  | "stale_page_or_wrong_date"
  | "parser_suspected_failed"
  | "platform_page_state_error"
  | "unknown_technical_failure";

function readHotelValidationRatePlan(): HotelRatePlanLabel {
  const configured = process.env.HOTEL_VALIDATION_RATE_PLAN;
  if (configured && HOTEL_RATE_PLAN_LABELS.includes(configured as HotelRatePlanLabel)) {
    return configured as HotelRatePlanLabel;
  }
  return "大床有早餐";
}

interface PilotRoute {
  scope: RouteScope;
  origin: string;
  destination: string;
  travelDate: string;
}

export interface PilotPlatformState {
  platform: PlatformName;
  loginUrl?: string;
  configured: boolean;
  outcome?: PilotOutcome;
  note?: string;
  pageTitle?: string;
  finalUrl?: string;
  screenshotPath?: string;
  screenshotUrl?: string;
  error?: string;
}

export interface PilotResult {
  status: PilotStatus;
  route: PilotRoute;
  profileDir: string;
  platforms: PilotPlatformState[];
  updatedAt: string | null;
  message: string;
}

export interface QingmaoFlightCandidate {
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

export interface QingmaoCandidateProbeResult {
  status: QingmaoCandidateStatus;
  route: PilotRoute;
  candidates: QingmaoFlightCandidate[];
  totalFlights: number | null;
  screenshotPath?: string;
  screenshotUrl?: string;
  finalUrl?: string;
  updatedAt: string | null;
  message: string;
  error?: string;
}

export interface SameFlightPlatformQuote {
  platform: PlatformName;
  status: SameFlightQuoteStatus;
  price: number | null;
  finalUrl?: string;
  screenshotPath?: string;
  screenshotUrl?: string;
  rawText?: string;
  error?: string;
}

export interface SameFlightComparisonProbeResult {
  status: SameFlightComparisonStatus;
  route: PilotRoute;
  selectedFlight: QingmaoFlightCandidate | null;
  quotes: SameFlightPlatformQuote[];
  updatedAt: string | null;
  message: string;
  error?: string;
}

export interface ZtripProbeCheck {
  target: ZtripProbeTarget;
  outcome?: PilotOutcome;
  note?: string;
  pageTitle?: string;
  finalUrl?: string;
  screenshotPath?: string;
  screenshotUrl?: string;
  error?: string;
}

export interface ZtripProbeResult {
  status: ZtripProbeStatus;
  loginUrl: string;
  checks: ZtripProbeCheck[];
  updatedAt: string | null;
  message: string;
  error?: string;
}

export interface ZtripFlightProbeResult {
  status: ZtripFlightProbeStatus;
  route: PilotRoute;
  selectedFlight: QingmaoFlightCandidate | null;
  candidates: QingmaoFlightCandidate[];
  totalFlights: number | null;
  screenshotPath?: string;
  screenshotUrl?: string;
  finalUrl?: string;
  updatedAt: string | null;
  message: string;
  error?: string;
}

export interface ZtripHotelQuery {
  city: string;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
}

export interface ZtripHotelRate {
  hotelName: string;
  roomType: string;
  bedType: "大床" | "双床" | "";
  breakfast: "有早餐" | "无早餐" | "";
  price: number | null;
  rawText: string;
}

export interface ZtripHotelProbeResult {
  status: ZtripHotelProbeStatus;
  query: ZtripHotelQuery;
  selectedRate: ZtripHotelRate | null;
  rates: ZtripHotelRate[];
  screenshotPath?: string;
  screenshotUrl?: string;
  finalUrl?: string;
  updatedAt: string | null;
  message: string;
  error?: string;
}

export interface QingmaoHotelCandidateQuery {
  city: string;
  keyword: string;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
}

export interface QingmaoHotelCandidate {
  hotelName: string;
  level: string;
  score: string;
  area: string;
  address: string;
  price: number | null;
  rawText: string;
}

export interface QingmaoHotelCandidateProbeResult {
  status: QingmaoHotelCandidateProbeStatus;
  query: QingmaoHotelCandidateQuery;
  candidates: QingmaoHotelCandidate[];
  selectedCandidate: QingmaoHotelCandidate | null;
  totalHotels: number | null;
  screenshotPath?: string;
  screenshotUrl?: string;
  finalUrl?: string;
  updatedAt: string | null;
  message: string;
  error?: string;
}

export interface HotelMainRateQuote {
  platform: PlatformName;
  status: "available" | "not-found" | "failed" | "pending";
  price: number | null;
  hotelName: string;
  roomType: string;
  ratePlan: HotelRatePlanLabel;
  finalUrl?: string;
  screenshotPath?: string;
  screenshotUrl?: string;
  rawText?: string;
  durationMs?: number;
  error?: string;
}

export interface HotelMainRateProbeResult {
  status: HotelMainRateProbeStatus;
  query: QingmaoHotelCandidateQuery;
  selectedCandidate: QingmaoHotelCandidate | null;
  quotes: HotelMainRateQuote[];
  updatedAt: string | null;
  message: string;
  error?: string;
}

export interface HotelGroupMainRateSample {
  group: HotelGroupName;
  query: QingmaoHotelCandidateQuery;
  status: "completed" | "partial" | "failed";
  selectedCandidate: QingmaoHotelCandidate | null;
  quotes: HotelMainRateQuote[];
  message: string;
  error?: string;
}

export interface HotelGroupMainRateProbeResult {
  status: HotelGroupMainRateProbeStatus;
  samples: HotelGroupMainRateSample[];
  updatedAt: string | null;
  message: string;
  error?: string;
}

export interface HotelSingleDiagnosisInput {
  city: string;
  keyword: string;
  checkInDate: string;
  checkOutDate: string;
  ratePlan: HotelRatePlanLabel;
}

export interface HotelSingleDiagnosisPlatformResult {
  platform: PlatformName;
  step: HotelSingleDiagnosisStep;
  sameHotel: boolean | null;
  matchBasis: string;
  sourceDoorPlate: string | null;
  targetDoorPlate: string | null;
  durationMs: number | null;
  price: number | null;
  error?: string;
  screenshotPath?: string;
  screenshotUrl?: string;
  finalUrl?: string;
  roomType?: string;
  rawText?: string;
  ctripHotelIdSource?: string;
  ctripExtractedHotelId?: string;
  ctripFinalUrl?: string;
  ctripSearchKeywordUsed?: string;
}

export interface HotelSingleDiagnosisProbeResult {
  status: HotelSingleDiagnosisStatus;
  input: HotelSingleDiagnosisInput | null;
  selectedCandidate: QingmaoHotelCandidate | null;
  platforms: HotelSingleDiagnosisPlatformResult[];
  updatedAt: string | null;
  message: string;
  error?: string;
}

export interface AliHotelSingleVerifyInput {
  city: string;
  hotelName: string;
  address: string;
  checkInDate: string;
  checkOutDate: string;
  ratePlan: "大床有早餐";
}

export interface AliHotelSingleVerifyResult {
  status: HotelSingleDiagnosisStatus;
  input: AliHotelSingleVerifyInput | null;
  selectedCandidate: QingmaoHotelCandidate | null;
  result: HotelCalibrationPlatformResult | null;
  artifactDir?: string;
  diagnosisPath?: string;
  updatedAt: string | null;
  message: string;
  error?: string;
}

export interface AliHotelMatchProbeSample {
  query: QingmaoHotelCandidateQuery;
  selectedCandidate: QingmaoHotelCandidate | null;
  qingmaoQuote: HotelMainRateQuote | null;
  aliQuote: HotelMainRateQuote | null;
  status: "completed" | "partial" | "failed";
  message: string;
  error?: string;
}

export interface AliHotelMatchProbeResult {
  status: HotelMainRateProbeStatus;
  samples: AliHotelMatchProbeSample[];
  updatedAt: string | null;
  message: string;
  error?: string;
}

export interface HotelRatePlanProbeSample {
  group: HotelGroupName;
  query: QingmaoHotelCandidateQuery;
  selectedCandidate: QingmaoHotelCandidate | null;
  status: "completed" | "partial" | "failed";
  quotes: HotelMainRateQuote[];
  durationMs: number;
  message: string;
  error?: string;
}

export interface HotelRatePlanProbeSummary {
  ratePlan: HotelRatePlanLabel;
  status: "completed" | "partial" | "failed";
  completedCount: number;
  partialCount: number;
  failedCount: number;
  completeRate: number;
  durationMs: number;
  samples: HotelRatePlanProbeSample[];
}

export interface HotelRatePlanProbeResult {
  status: HotelRatePlanProbeStatus;
  plans: HotelRatePlanProbeSummary[];
  recommendedRatePlan: HotelRatePlanLabel | null;
  updatedAt: string | null;
  message: string;
  error?: string;
}

export interface HotelAllRatePlanSample {
  ratePlan: HotelRatePlanLabel;
  status: "completed" | "partial" | "failed";
  selectedCandidate: QingmaoHotelCandidate | null;
  quotes: HotelMainRateQuote[];
  durationMs: number;
  message: string;
  error?: string;
}

export interface HotelAllRatePlanProbeResult {
  status: HotelRatePlanProbeStatus;
  query: QingmaoHotelCandidateQuery;
  selectedCandidate: QingmaoHotelCandidate | null;
  samples: HotelAllRatePlanSample[];
  updatedAt: string | null;
  message: string;
  error?: string;
}

export interface HotelCalibrationInput {
  checkInDate?: string;
  checkOutDate?: string;
  platforms?: PlatformName[];
}

export type HotelCalibrationOtherRates = Record<"大床无早餐" | "双床有早餐" | "双床无早餐", number | null>;

export interface HotelCalibrationPlatformResult {
  platform: PlatformName;
  sameHotel: boolean | null;
  matchBasis: string;
  platformHotelName: string;
  platformAddress: string;
  platformDoorPlate: string | null;
  hasMainRate: boolean;
  mainRatePrice: number | null;
  otherRates: HotelCalibrationOtherRates;
  durationMs: number;
  failureType: HotelCalibrationFailureType | null;
  failureReason: string;
  screenshotPath?: string;
  screenshotUrl?: string;
  finalUrl: string;
  pageTextSummary: string;
}

export interface HotelCalibrationSample {
  index: number;
  status: "completed" | "partial" | "failed";
  sourceHotel: {
    hotelName: string;
    city: string;
    address: string;
    doorPlate: string | null;
    rawText: string;
  } | null;
  platforms: HotelCalibrationPlatformResult[];
  message: string;
}

export interface HotelCalibrationResult {
  status: HotelCalibrationStatus;
  mode: "calibration";
  limit: 3;
  mainRatePlan: "大床有早餐";
  platformOrder: PlatformName[];
  query: QingmaoHotelCandidateQuery;
  samples: HotelCalibrationSample[];
  updatedAt: string | null;
  message: string;
  error?: string;
}

export interface BrowserCleanupResult {
  status: "completed" | "failed";
  beforeCount: number;
  closedCount: number;
  afterCount: number;
  updatedAt: string;
  message: string;
  error?: string;
}

export interface PilotCollector {
  getStatus(): PilotResult;
  getQingmaoCandidateStatus(): QingmaoCandidateProbeResult;
  getQingmaoHotelCandidateStatus(): QingmaoHotelCandidateProbeResult;
  getHotelMainRateStatus(): HotelMainRateProbeResult;
  getHotelGroupMainRateStatus(): HotelGroupMainRateProbeResult;
  getHotelSingleDiagnosisStatus(): HotelSingleDiagnosisProbeResult;
  getAliHotelSingleVerifyStatus(): AliHotelSingleVerifyResult;
  getAliHotelMatchStatus(): AliHotelMatchProbeResult;
  getHotelRatePlanProbeStatus(): HotelRatePlanProbeResult;
  getHotelAllRatePlanStatus(): HotelAllRatePlanProbeResult;
  getHotelCalibrationStatus(): HotelCalibrationResult;
  getSameFlightComparisonStatus(): SameFlightComparisonProbeResult;
  getZtripStatus(): ZtripProbeResult;
  getZtripFlightStatus(): ZtripFlightProbeResult;
  getZtripHotelStatus(): ZtripHotelProbeResult;
  openLoginSession(): Promise<PilotResult>;
  runSilentProbe(): Promise<PilotResult>;
  runAttachedProbe(): Promise<PilotResult>;
  runQingmaoCandidateProbe(): Promise<QingmaoCandidateProbeResult>;
  runQingmaoHotelCandidateProbe(): Promise<QingmaoHotelCandidateProbeResult>;
  runHotelMainRateProbe(): Promise<HotelMainRateProbeResult>;
  runHotelGroupMainRateProbe(): Promise<HotelGroupMainRateProbeResult>;
  runHotelSingleDiagnosisProbe(input: HotelSingleDiagnosisInput): Promise<HotelSingleDiagnosisProbeResult>;
  runAliHotelSingleVerifyProbe(input: AliHotelSingleVerifyInput): Promise<AliHotelSingleVerifyResult>;
  runAliHotelMatchProbe(limit?: number): Promise<AliHotelMatchProbeResult>;
  runHotelRatePlanProbe(): Promise<HotelRatePlanProbeResult>;
  runHotelAllRatePlanProbe(): Promise<HotelAllRatePlanProbeResult>;
  runHotelCalibrationProbe(input?: HotelCalibrationInput): Promise<HotelCalibrationResult>;
  cleanupBrowserPages(): Promise<BrowserCleanupResult>;
  runSameFlightComparisonProbe(): Promise<SameFlightComparisonProbeResult>;
  runZtripProbe(): Promise<ZtripProbeResult>;
  runZtripFlightProbe(): Promise<ZtripFlightProbeResult>;
  runZtripHotelProbe(): Promise<ZtripHotelProbeResult>;
  runDomesticBatchCollection(limit?: number): Promise<CollectionBatch>;
  runInternationalBatchCollection(limit?: number): Promise<CollectionBatch>;
  runFullBatchCollection(): Promise<CollectionBatch>;
}

interface PilotCollectorOptions {
  profileDir: string;
  artifactDir: string;
  now?: () => Date;
  random?: () => number;
  remoteDebuggingPort?: number;
  openLoginWindow?: (profileDir: string, urls: string[], debuggingPort: number) => Promise<void>;
}

interface BrowserLocator {
  innerText(options?: { timeout?: number }): Promise<string>;
  click(options?: { timeout?: number }): Promise<unknown>;
  fill(value: string): Promise<unknown>;
  press(key: string): Promise<unknown>;
  count(): Promise<number>;
  first(): BrowserLocator;
  nth(index: number): BrowserLocator;
}

interface BrowserFrame {
  url(): string;
  locator(selector: string): BrowserLocator;
  getByRole(role: string, options?: { name?: string; exact?: boolean }): BrowserLocator;
  getByText(text: string, options?: { exact?: boolean }): BrowserLocator;
  waitForTimeout(timeout: number): Promise<unknown>;
  evaluate<T, Arg = unknown>(pageFunction: string | ((arg: Arg) => T), arg?: Arg): Promise<T>;
}

interface BrowserPage {
  goto(url: string, options?: { waitUntil?: "domcontentloaded"; timeout?: number }): Promise<unknown>;
  title(): Promise<string>;
  url(): string;
  locator(selector: string): BrowserLocator;
  getByRole(role: string, options?: { name?: string; exact?: boolean }): BrowserLocator;
  getByText(text: string, options?: { exact?: boolean }): BrowserLocator;
  screenshot(options: { path: string; fullPage?: boolean; timeout?: number }): Promise<unknown>;
  setContent(html: string): Promise<unknown>;
  waitForTimeout(timeout: number): Promise<unknown>;
  waitForLoadState?(state: "domcontentloaded" | "load" | "networkidle", options?: { timeout?: number }): Promise<unknown>;
  waitForResponse?(predicate: (response: { url(): string; text(): Promise<string> }) => boolean, options?: { timeout?: number }): Promise<{ url(): string; text(): Promise<string> }>;
  evaluate<T, Arg = unknown>(pageFunction: string | ((arg: Arg) => T), arg?: Arg): Promise<T>;
  on?(event: "console", handler: (message: { text(): string }) => void): unknown;
  frames(): BrowserFrame[];
  bringToFront(): Promise<unknown>;
  close?(options?: { runBeforeUnload?: boolean }): Promise<unknown>;
}

interface BrowserContext {
  newPage(): Promise<BrowserPage>;
  pages(): BrowserPage[];
  cookies?(urls?: string[]): Promise<Array<{ name: string; value: string; domain: string }>>;
  close(): Promise<void>;
}

interface BrowserConnection {
  contexts(): BrowserContext[];
  disconnect?: () => Promise<void>;
}

interface ChromiumLauncher {
  launchPersistentContext(userDataDir: string, options: Record<string, unknown>): Promise<BrowserContext>;
  connectOverCDP(endpointURL: string): Promise<BrowserConnection>;
}

const platformUrls: Record<PlatformName, string> = {
  青猫差旅: process.env.QINGMAO_TRAVEL_URL ?? "https://booking.tmctrip.com/TravelBooking",
  携程商旅: process.env.CTRIP_BUSINESS_URL ?? "https://ct.ctrip.com/login",
  阿里商旅: process.env.ALIBABA_BUSINESS_URL ?? "https://travel.alibtrip.com/index.html#/login",
  在途商旅: process.env.ZTRIP_BUSINESS_URL ?? "https://www.z-trip.cn/v/vcommon/home"
};

const cityCodes: Record<string, string> = {
  广州: "CAN",
  上海: "SHA",
  北京: "BJS",
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
  胡志明: "SGN",
  吉隆坡: "KUL",
  首尔: "SEL",
  东京: "TYO",
  洛杉矶: "LAX",
  新加坡: "SIN",
  大阪: "OSA",
  悉尼: "SYD",
  马尼拉: "MNL"
};

const citySearchNames: Record<string, string> = {
  胡志明市: "胡志明"
};

const ztripHotelCityIds: Record<string, string> = {
  广州: "11958",
  上海: "10801",
  北京: "13215",
  深圳: "11742",
  杭州: "13391",
  武汉: "12655",
  佛山: "11692",
  成都: "11040",
  厦门: "11562"
};

const ctripHotelCityIds: Record<string, string> = {
  广州: "32",
  上海: "2",
  北京: "1",
  深圳: "30",
  杭州: "17",
  成都: "28",
  厦门: "25"
};

const aliHotelCityCodes: Record<string, string> = {
  广州: "440100",
  上海: "310100",
  北京: "110100",
  深圳: "440300",
  杭州: "330100",
  武汉: "420100",
  佛山: "440600",
  成都: "510100",
  厦门: "350200"
};

const aliInternationalCities = new Set(["曼谷", "河内", "胡志明市", "胡志明", "吉隆坡", "首尔", "东京", "洛杉矶", "新加坡", "大阪", "悉尼", "马尼拉"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isChromiumLauncher(value: unknown): value is ChromiumLauncher {
  return isRecord(value) && typeof value.launchPersistentContext === "function" && typeof value.connectOverCDP === "function";
}

async function loadChromium() {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
  const playwright = await dynamicImport("playwright");

  if (!isRecord(playwright) || !isChromiumLauncher(playwright.chromium)) {
    throw new Error("Playwright Chromium 不可用");
  }

  return playwright.chromium;
}

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function buildPilotRoute(now: Date): PilotRoute {
  return {
    scope: "国内",
    origin: "广州",
    destination: "上海",
    travelDate: formatDate(addDays(now, 3))
  };
}

function buildRouteFromConfig(route: RouteConfig, now: Date): PilotRoute {
  return {
    scope: route.scope,
    origin: route.origin,
    destination: route.destination,
    travelDate: formatDate(addDays(now, 3))
  };
}

function buildZtripHotelQuery(now: Date): ZtripHotelQuery {
  const checkInDate = formatDate(addDays(now, 1));
  const checkOutDate = formatDate(addDays(now, 2));

  return {
    city: "广州",
    checkInDate,
    checkOutDate,
    nights: 1
  };
}

function buildZtripHotelQueryFromQingmao(query: QingmaoHotelCandidateQuery): ZtripHotelQuery {
  return {
    city: query.city,
    checkInDate: query.checkInDate,
    checkOutDate: query.checkOutDate,
    nights: query.nights
  };
}

function buildQingmaoHotelCandidateQuery(now: Date): QingmaoHotelCandidateQuery {
  const checkInDate = formatDate(addDays(now, 1));
  const checkOutDate = formatDate(addDays(now, 2));

  return {
    city: "广州",
    keyword: "如家商旅",
    checkInDate,
    checkOutDate,
    nights: 1
  };
}

function buildHotelCandidateQuery(now: Date, keyword: string, city = "广州"): QingmaoHotelCandidateQuery {
  const checkInDate = formatDate(addDays(now, 1));
  const checkOutDate = formatDate(addDays(now, 2));

  return {
    city,
    keyword,
    checkInDate,
    checkOutDate,
    nights: 1
  };
}

function buildHotelCalibrationQuery(now: Date, input: HotelCalibrationInput = {}): QingmaoHotelCandidateQuery {
  const defaultQuery = buildQingmaoHotelCandidateQuery(now);
  const checkInDate = input.checkInDate ?? defaultQuery.checkInDate;
  const checkOutDate = input.checkOutDate ?? defaultQuery.checkOutDate;
  const checkIn = new Date(`${checkInDate}T00:00:00`);
  const checkOut = new Date(`${checkOutDate}T00:00:00`);
  const nights = Number.isFinite(checkIn.getTime()) && Number.isFinite(checkOut.getTime())
    ? Math.max(1, Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000))
    : 1;

  return {
    ...defaultQuery,
    checkInDate,
    checkOutDate,
    nights
  };
}

export function resolveHotelCalibrationPlatformOrder(input: HotelCalibrationInput = {}): PlatformName[] {
  const requested = input.platforms?.length
    ? HOTEL_CALIBRATION_COMPETITOR_PLATFORM_ORDER.filter((platform) => input.platforms?.includes(platform))
    : HOTEL_CALIBRATION_COMPETITOR_PLATFORM_ORDER;
  if (!input.platforms?.length) return HOTEL_CALIBRATION_PLATFORM_ORDER;
  return ["青猫差旅", ...requested];
}

export function isHotelCalibrationSampleComplete(platforms: HotelCalibrationPlatformResult[], expectedPlatformOrder: PlatformName[]) {
  return expectedPlatformOrder.every((expectedPlatform) =>
    platforms.some((platform) =>
      platform.platform === expectedPlatform
      && platform.sameHotel === true
      && platform.hasMainRate
    )
  );
}

const hotelGroupPilotQueries: Array<{ group: HotelGroupName; keyword: string; city?: string }> = [
  { group: "首旅如家", keyword: "如家商旅" },
  { group: "华住", keyword: "全季" },
  { group: "锦江", keyword: "维也纳" },
  { group: "东呈", keyword: "城市便捷" },
  { group: "亚朵", keyword: "亚朵" }
];

function formatBatchTimestamp(date: Date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${formatDate(date)}-${hours}${minutes}${seconds}`;
}

function buildPlatformStatus(): PilotPlatformState[] {
  return (Object.entries(platformUrls) as Array<[PlatformName, string]>).map(([platform, loginUrl]) => ({
    platform,
    loginUrl,
    configured: Boolean(loginUrl)
  }));
}

function buildInitialZtripProbeResult(): ZtripProbeResult {
  return {
    status: "idle",
    loginUrl: platformUrls.在途商旅,
    checks: [],
    updatedAt: null,
    message: "等待验证在途商旅"
  };
}

function buildInitialZtripFlightProbeResult(now: Date): ZtripFlightProbeResult {
  return {
    status: "idle",
    route: buildPilotRoute(now),
    selectedFlight: null,
    candidates: [],
    totalFlights: null,
    updatedAt: null,
    message: "等待采集在途商旅航班样本"
  };
}

function buildInitialZtripHotelProbeResult(now: Date): ZtripHotelProbeResult {
  return {
    status: "idle",
    query: buildZtripHotelQuery(now),
    selectedRate: null,
    rates: [],
    updatedAt: null,
    message: "等待采集在途商旅酒店样本"
  };
}

function buildInitialQingmaoHotelCandidateProbeResult(now: Date): QingmaoHotelCandidateProbeResult {
  return {
    status: "idle",
    query: buildQingmaoHotelCandidateQuery(now),
    candidates: [],
    selectedCandidate: null,
    totalHotels: null,
    updatedAt: null,
    message: "等待读取青猫酒店候选池"
  };
}

function buildInitialHotelMainRateProbeResult(now: Date): HotelMainRateProbeResult {
  return {
    status: "idle",
    query: buildQingmaoHotelCandidateQuery(now),
    selectedCandidate: null,
    quotes: [],
    updatedAt: null,
    message: `等待验证酒店当前口径${HOTEL_VALIDATION_RATE_PLAN}`
  };
}

function buildInitialHotelGroupMainRateProbeResult(): HotelGroupMainRateProbeResult {
  return {
    status: "idle",
    samples: [],
    updatedAt: null,
    message: "等待验证每个集团 1 家酒店主口径"
  };
}

function buildInitialHotelSingleDiagnosisResult(): HotelSingleDiagnosisProbeResult {
  return {
    status: "idle",
    input: null,
    selectedCandidate: null,
    platforms: [],
    updatedAt: null,
    message: "等待严格单酒店诊断"
  };
}

function buildInitialAliHotelSingleVerifyResult(): AliHotelSingleVerifyResult {
  return {
    status: "idle",
    input: null,
    selectedCandidate: null,
    result: null,
    updatedAt: null,
    message: "等待指定酒店阿里-only复验"
  };
}

function buildInitialAliHotelMatchProbeResult(): AliHotelMatchProbeResult {
  return {
    status: "idle",
    samples: [],
    updatedAt: null,
    message: "等待验证阿里商旅同店匹配"
  };
}

function buildInitialHotelRatePlanProbeResult(): HotelRatePlanProbeResult {
  return {
    status: "idle",
    plans: [],
    recommendedRatePlan: null,
    updatedAt: null,
    message: "等待验证酒店 4 个房型早餐口径完整率"
  };
}

function buildInitialHotelAllRatePlanProbeResult(now: Date): HotelAllRatePlanProbeResult {
  return {
    status: "idle",
    query: buildHotelCandidateQuery(now, "如家商旅", "广州"),
    selectedCandidate: null,
    samples: [],
    updatedAt: null,
    message: "等待选择青猫候选酒店并采集四平台四口径"
  };
}

function buildInitialHotelCalibrationResult(now: Date): HotelCalibrationResult {
  return {
    status: "idle",
    mode: "calibration",
    limit: HOTEL_CALIBRATION_LIMIT,
    mainRatePlan: HOTEL_CALIBRATION_MAIN_RATE_PLAN,
    platformOrder: ["青猫差旅", "阿里商旅", "在途商旅", "携程商旅"],
    query: buildHotelCalibrationQuery(now),
    samples: [],
    updatedAt: null,
    message: "等待执行 3 家酒店校准测试"
  };
}

function buildZtripProductCheck(target: ZtripProbeTarget, bodyText: string, entryOutcome: PilotOutcome): ZtripProbeCheck {
  const pattern = target === "航班入口" ? /国内机票|国际机票|机票|航班|flight/i : /国内酒店|酒店|hotel/i;

  if (pattern.test(bodyText)) {
    return {
      target,
      outcome: "reachable",
      note: `${target}已在页面中出现`
    };
  }

  if (entryOutcome === "login-required") {
    return {
      target,
      outcome: "login-required",
      note: "入口页需要登录，暂不能继续验证该入口"
    };
  }

  return {
    target,
    outcome: "failed",
    note: `页面中未识别到${target}`
  };
}

export function classifyZtripProductEntries(bodyText: string, entryOutcome: PilotOutcome): ZtripProbeCheck[] {
  return [
    buildZtripProductCheck("航班入口", bodyText, entryOutcome),
    buildZtripProductCheck("酒店入口", bodyText, entryOutcome)
  ];
}

function safeFilename(name: string) {
  return name.replace(/[^\u4e00-\u9fa5a-zA-Z0-9_-]/g, "-");
}

export function classifyProbeOutcome(text: string, finalUrl: string): PilotOutcome {
  if (/TravelBooking/i.test(finalUrl)) return "reachable";
  if (/ct\.ctrip\.com\/online\/home/i.test(finalUrl)) return "reachable";
  if (/travel\.alibtrip\.com\/index\.html.*#\/flight/i.test(finalUrl)) return "reachable";
  if (/travel\.alibtrip\.com\/flight-new.*#\/i-search-list/i.test(finalUrl)) return "reachable";
  if (/login|signin|sign-in/i.test(finalUrl)) return "login-required";
  return /登录|登陆|扫码|验证码|login|sign in/i.test(text) ? "login-required" : "reachable";
}

export function classifyZtripProbeOutcome(text: string, finalUrl: string): PilotOutcome {
  const normalized = text.replace(/\s+/g, "").trim();

  if (!normalized || /^loading\.{0,3}$/i.test(normalized)) {
    return "failed";
  }

  if (/gateway timeout|bad gateway|service unavailable|504|503|502|无法访问|访问被拒绝/i.test(text)) {
    return "failed";
  }

  if (/login|signin|sign-in|passport/i.test(finalUrl)) {
    return "login-required";
  }

  if (/密码登录|验证码登录|扫码登录|账号登录|请登录|登录\/注册/i.test(text)) {
    return "login-required";
  }

  if (/国内机票|国际机票|机票|航班|国内酒店|酒店|差旅订单|企业差旅|商旅/i.test(text)) {
    return "reachable";
  }

  return classifyProbeOutcome(text, finalUrl);
}

async function openZtripBookingEntry(page: BrowserPage) {
  const currentText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  if (/机票|酒店|booking/i.test(currentText) && /\/booking/i.test(page.url())) {
    return;
  }

  const bookingNavigation = page.getByText("预订", { exact: true }).first();
  try {
    await bookingNavigation.click({ timeout: 8_000 });
    await page.waitForLoadState?.("networkidle", { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(3_000).catch(() => undefined);
  } catch {
    await page.goto("https://www.z-trip.cn/v/pg/otapub/booking?type=flight", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState?.("networkidle", { timeout: 15_000 }).catch(() => undefined);
  }
}

async function selectZtripFlightCity(page: BrowserPage, placeholder: string, city: string) {
  const input = page.locator(`input[placeholder="${placeholder}"]`).first();
  await input.click({ timeout: 8_000 });
  await input.fill(city);
  await page.waitForTimeout(1_000);

  try {
    await page.locator(`li.ret-item-flight-city:has-text("${city}")`).first().click({ timeout: 5_000 });
    await page.waitForTimeout(800);
    return;
  } catch {
    // Fall through to DOM event dispatch for older result popovers.
  }

  const cityValue = JSON.stringify(city);
  const clicked = await page.evaluate<boolean>(`(() => {
    const targetCity = ${cityValue};
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const items = Array.from(document.querySelectorAll("li.ret-item-flight-city, li.ret-item-flight-traffic"))
      .filter((element) => isVisible(element));
    const target = items.find((element) => {
      const text = (element.textContent || "").replace(/\\s+/g, "");
      return text.includes(targetCity) && text.includes("城市");
    }) ?? items.find((element) => (element.textContent || "").includes(targetCity));
    if (!target) return false;
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`);

  if (!clicked) {
    throw new Error(`在途商旅未找到城市 ${city}`);
  }

  await page.waitForTimeout(800);
}

async function selectZtripFlightDate(page: BrowserPage, travelDate: string) {
  const day = String(Number(travelDate.slice(8, 10)));
  await page.locator("input[placeholder=\"YYYY-MM-DD\"]").first().click({ timeout: 8_000 });
  await page.waitForTimeout(500);

  const dateValue = JSON.stringify(travelDate);
  const dayValue = JSON.stringify(day);
  const clicked = await page.evaluate<boolean>(`(() => {
    const targetDate = ${dateValue};
    const targetDay = ${dayValue};
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const cells = Array.from(document.querySelectorAll(".ivu-date-picker-cells-cell"))
      .filter((element) => {
        const className = element.getAttribute("class") || "";
        return isVisible(element) && !className.includes("disabled");
      });
    const target = cells.find((element) => (element.getAttribute("title") || "").includes(targetDate))
      ?? cells.find((element) => {
        const className = element.getAttribute("class") || "";
        return (element.textContent || "").trim() === targetDay && !className.includes("prev-month") && !className.includes("next-month");
      })
      ?? cells.find((element) => (element.textContent || "").trim() === targetDay);
    if (!target) return false;
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`);

  if (!clicked) {
    throw new Error(`在途商旅未找到日期 ${travelDate}`);
  }

  await page.waitForTimeout(800);
}

async function findReadyZtripFlightResultPage(context: BrowserContext, route: PilotRoute) {
  const resultPages = context.pages().filter((page) => page.url().includes("z-trip.cn") && page.url().includes("/flight/multiList"));
  const sameDatePages = resultPages.filter((page) => page.url().includes(`fromDate=${route.travelDate}`));
  const orderedPages = [...sameDatePages, ...resultPages.filter((page) => !sameDatePages.includes(page))].sort((a, b) => {
    const aScore = a.url().includes("/v/pg/flight/multiList") ? 0 : 1;
    const bScore = b.url().includes("/v/pg/flight/multiList") ? 0 : 1;
    return aScore - bScore;
  });

  for (const resultPage of orderedPages) {
    const bodyText = await resultPage.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
    if (/共\s*\d+\s*个航班|CNY|暂无符合条件|无航班/i.test(bodyText)) {
      return resultPage;
    }
  }

  return null;
}

async function searchZtripFlightRoute(page: BrowserPage, route: PilotRoute, context: BrowserContext) {
  await openZtripBookingEntry(page);
  await page.waitForTimeout(1_000);
  await selectZtripFlightCity(page, "请选择出发城市", route.origin);
  await selectZtripFlightCity(page, "请选择到达城市", route.destination);
  await selectZtripFlightDate(page, route.travelDate);

  try {
    await page.getByRole("button", { name: "因公出行" }).click({ timeout: 8_000 });
  } catch {
    const clicked = await page.evaluate<boolean>(`(() => {
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const button = Array.from(document.querySelectorAll("button, .ivu-btn"))
        .find((element) => isVisible(element) && (element.textContent || "").includes("因公出行"));
      if (!button) return false;
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    })()`);

    if (!clicked) {
      throw new Error("在途商旅未找到因公出行搜索按钮");
    }
  }

  for (let attempt = 0; attempt < 45; attempt += 1) {
    await page.waitForTimeout(1_000);
    const resultPage = await findReadyZtripFlightResultPage(context, route);
    if (resultPage) {
      return resultPage;
    }

    const bodyText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");

    if (/共\s*\d+\s*个航班/.test(bodyText) || /暂无符合条件|无航班|flight\/multiList/i.test(bodyText) || page.url().includes("/flight/multiList")) {
      return page;
    }
  }

  throw new Error("在途商旅航班搜索超时");
}

async function findReadyZtripInternationalFlightResultPage(context: BrowserContext, route: PilotRoute) {
  const resultPages = context.pages().filter((page) => page.url().includes("z-trip.cn") && page.url().includes("/flight/intlList"));

  for (const resultPage of resultPages) {
    const bodyText = await resultPage.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
    const compactText = bodyText.replace(/\s+/g, "");
    if (
      compactText.includes(`${route.origin}-${route.destination}`) &&
      (/共\s*\d+\s*个航班/.test(bodyText) || /暂无符合条件|无航班|没有可预订航班/i.test(bodyText))
    ) {
      return resultPage;
    }
  }

  return null;
}

async function selectZtripInternationalFlightProduct(page: BrowserPage) {
  await page.getByText("国际/中国港澳台机票", { exact: true }).click({ timeout: 8_000 });
  await page.waitForTimeout(800);
}

async function searchZtripInternationalFlightRoute(page: BrowserPage, route: PilotRoute, context: BrowserContext) {
  await openZtripBookingEntry(page);
  await page.waitForTimeout(1_000);
  await selectZtripInternationalFlightProduct(page);
  await selectZtripFlightCity(page, "请选择出发城市", route.origin);
  await selectZtripFlightCity(page, "请选择到达城市", route.destination);
  await selectZtripFlightDate(page, route.travelDate);

  try {
    await page.locator("button.btm-btn-search").first().click({ timeout: 8_000 });
  } catch {
    await page.getByRole("button", { name: "因公出行" }).click({ timeout: 8_000 });
  }

  for (let attempt = 0; attempt < 45; attempt += 1) {
    await page.waitForTimeout(1_000);
    const resultPage = await findReadyZtripInternationalFlightResultPage(context, route);
    if (resultPage) {
      return resultPage;
    }

    const bodyText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
    if (/共\s*\d+\s*个航班/.test(bodyText) || /暂无符合条件|无航班|没有可预订航班/i.test(bodyText)) {
      return page;
    }
  }

  throw new Error("在途商旅国际航班搜索超时");
}

async function waitForZtripFlightResultText(page: BrowserPage) {
  let latestText = "";

  for (let attempt = 0; attempt < 60; attempt += 1) {
    latestText = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => latestText);

    if (/共\s*[1-9]\d*\s*个航班/i.test(latestText) && /CNY\s*\n?\s*\d{2,5}/i.test(latestText)) {
      return latestText;
    }

    if (/暂无符合条件|无航班|没有可预订航班/i.test(latestText)) {
      return latestText;
    }

    await page.waitForTimeout(1_000);
  }

  return latestText;
}

function ztripHotelListUrl(query: ZtripHotelQuery) {
  const cityId = ztripHotelCityIds[query.city];
  if (!cityId) {
    throw new Error(`未配置在途商旅酒店城市 ID：${query.city}`);
  }

  const params = new URLSearchParams({
    travelType: "BUSINESS",
    travelExpress: "1",
    cityId,
    cityName: query.city,
    countryType: "domestic",
    fromDate: query.checkInDate,
    toDate: query.checkOutDate,
    traceId: ""
  });

  return `https://www.z-trip.cn/v/pg/hotel/hotelList?${params.toString()}`;
}

async function openZtripHotelSearchResult(page: BrowserPage, query: ZtripHotelQuery) {
  await page.goto(ztripHotelListUrl(query), { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState?.("networkidle", { timeout: 15_000 }).catch(() => undefined);

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const bodyText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
    if (/查看详情/.test(bodyText) && /[¥￥]\d+起/.test(bodyText)) {
      return;
    }
    await page.waitForTimeout(1_000);
  }

  throw new Error("在途商旅酒店搜索结果加载超时");
}

async function openFirstZtripHotelDetail(page: BrowserPage) {
  const detailButton = page.locator(".seeRoom").first();
  if ((await detailButton.count().catch(() => 0)) === 0) {
    throw new Error("在途商旅酒店结果页未找到查看详情入口");
  }

  await detailButton.click({ timeout: 8_000 });

  for (let attempt = 0; attempt < 35; attempt += 1) {
    const roomCount = await page.locator(".room-list").count().catch(() => 0);
    const bodyText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
    if (roomCount > 0 || (/大床|双床/.test(bodyText) && /CNY\s*\d+/.test(bodyText))) {
      return;
    }
    await page.waitForTimeout(1_000);
  }

  throw new Error("在途商旅酒店详情房型加载超时");
}

export function normalizeHotelSearchKeywords(hotelName: string) {
  const withoutBracket = hotelName.replace(/[（(].*?[）)]/g, "").trim();
  const withoutHotelSuffix = withoutBracket.replace(/酒店$/, "").trim();
  const metroIndex = withoutHotelSuffix.lastIndexOf("地铁站");
  const metroKeyword = metroIndex >= 2 ? withoutHotelSuffix.slice(metroIndex - 2) : "";
  const fragments = withoutHotelSuffix
    .replace(/^广州/, "")
    .split(/[·\s-]+/)
    .filter(Boolean);
  const tailFragments = fragments
    .map((_, index) => fragments.slice(index).join(""))
    .filter((value) => value.length >= 4);
  const brandFallbackKeywords = /如家|商旅/.test(hotelName) ? ["如家商旅"] : [];

  return Array.from(new Set([hotelName, withoutBracket, withoutHotelSuffix, ...tailFragments, metroKeyword, ...brandFallbackKeywords].filter(Boolean)));
}

function extractHotelRoadKeyword(address: string) {
  const doorPlate = extractHotelDoorPlate(address);
  if (!doorPlate) return null;
  return doorPlate.replace(/\d+(?:[-－]\d+)?号.*$/, "");
}

function extractHotelRoadDoorKeyword(address: string) {
  const doorPlate = extractHotelDoorPlate(address);
  const doorNumber = extractHotelDoorNumber(address);
  const roadKeyword = extractHotelRoadKeyword(address);
  if (roadKeyword && doorNumber) return `${roadKeyword}${doorNumber}`;
  return doorPlate;
}

export function buildCtripHotelCoreKeywords(hotelName: string) {
  const bracketText = hotelName.match(/[（(]([^）)]*)[）)]/)?.[1] ?? "";
  const cleanedBracketText = bracketText
    .replace(/^广州/, "")
    .replace(/酒店|如家|商旅|地铁站|店|金标/g, "")
    .trim();
  const fragments = cleanedBracketText
    .split(/[·\s-]+/)
    .map((value) => value.trim())
    .filter((value) => value.length >= 2);
  const combined = fragments.join("");
  const knownLocationTokens = ["永庆坊", "荔湾湖公园", "珠江新城", "杨箕东", "上下九", "京溪南方医院", "白云山", "东圃", "科学城", "珠吉"];
  const matchedLocationTokens = knownLocationTokens.filter((token) => combined.includes(token));
  return Array.from(new Set([combined, ...matchedLocationTokens, ...fragments].filter((value) => value.length >= 2)));
}

export function buildCtripHotelSearchKeywords(candidate: QingmaoHotelCandidate) {
  const doorPlate = extractHotelDoorPlate(candidate.address);
  const roadKeyword = extractHotelRoadKeyword(candidate.address);
  const coreKeywords = buildCtripHotelCoreKeywords(candidate.hotelName);
  const brandFallbackKeywords = /如家|商旅/.test(candidate.hotelName) ? ["如家商旅"] : [];
  return Array.from(new Set([
    candidate.hotelName,
    ...coreKeywords,
    ...brandFallbackKeywords,
    doorPlate,
    roadKeyword,
    candidate.address
  ].filter((keyword): keyword is string => Boolean(keyword && keyword.trim()))));
}

function detectAliHotelBrandKeyword(value: string) {
  if (/如家商旅/.test(value)) return "如家商旅";
  if (/亚朵/.test(value)) return "亚朵";
  if (/全季/.test(value)) return "全季";
  if (/维也纳/.test(value)) return "维也纳";
  if (/城市便捷/.test(value)) return "城市便捷";
  if (/如家/.test(value)) return "如家";
  return "";
}

export function buildAliHotelSearchKeywords(_query: QingmaoHotelCandidateQuery, candidate: QingmaoHotelCandidate) {
  const doorPlate = extractHotelRoadDoorKeyword(candidate.address);
  const doorNumber = extractHotelDoorNumber(candidate.address);
  const roadKeyword = extractHotelRoadKeyword(candidate.address);
  const normalizedNameKeywords = normalizeHotelSearchKeywords(candidate.hotelName);
  const brandName = /如家/.test(candidate.hotelName) ? "如家" : detectAliHotelBrandKeyword(candidate.hotelName);
  const brandRoadKeyword = brandName && roadKeyword ? `${brandName}${roadKeyword}` : "";
  const brandDoorPlateKeyword = brandName && doorPlate ? `${brandName}${doorPlate}` : "";
  const brandDoorNumberKeyword = brandName && doorNumber ? `${brandName}${doorNumber}` : "";
  return Array.from(new Set([
    candidate.hotelName,
    doorPlate,
    brandRoadKeyword,
    brandDoorPlateKeyword,
    brandDoorNumberKeyword,
    roadKeyword,
    ...normalizedNameKeywords
  ].filter((keyword): keyword is string => Boolean(keyword && keyword.trim()))));
}

export interface AliHotelSearchKeywordPlanItem {
  keyword: string;
  mode: "normal" | "brand-fallback";
  maxScreens: number;
  maxCards: number;
  maxDurationMs: number;
}

function buildAliHotelBrandFallbackKeywords(query: QingmaoHotelCandidateQuery, candidate: QingmaoHotelCandidate) {
  const brandName = detectAliHotelBrandKeyword(candidate.hotelName) || query.keyword.trim();
  if (!brandName) return [];
  const keywords = brandName === "亚朵" ? ["亚朵酒店", "亚朵"] : [`${brandName}酒店`, brandName];
  return Array.from(new Set(keywords.filter(Boolean)));
}

export function buildAliHotelSearchKeywordPlan(query: QingmaoHotelCandidateQuery, candidate: QingmaoHotelCandidate): AliHotelSearchKeywordPlanItem[] {
  const normalKeywords = buildAliHotelSearchKeywords(query, candidate);
  const normalItems = normalKeywords.map((keyword) => ({
    keyword,
    mode: "normal" as const,
    maxScreens: 8,
    maxCards: 80,
    maxDurationMs: 45_000
  }));
  const fallbackItems = buildAliHotelBrandFallbackKeywords(query, candidate)
    .map((keyword) => ({
      keyword,
      mode: "brand-fallback" as const,
      maxScreens: 20,
      maxCards: 120,
      maxDurationMs: 90_000
    }));
  return [...normalItems, ...fallbackItems];
}

export function matchAliHotelListCandidateText(candidate: QingmaoHotelCandidate, text: string, queryCity = "") {
  const strictMatch = matchHotelByBrandCoreCityDoorNumber(candidate, text, queryCity);
  if (strictMatch.matched) {
    return strictMatch;
  }
  const parsed = parseAliHotelListCardText(text);
  const normalizedText = normalizeAddressForMatch(text);
  const doorPlate = extractHotelDoorPlate(candidate.address);
  const roadKeyword = extractHotelRoadKeyword(candidate.address);
  const coreKeywords = buildCtripHotelCoreKeywords(candidate.hotelName).map(normalizeAddressForMatch);
  const brandMatched = /如家/.test(candidate.hotelName) ? normalizedText.includes("如家") : true;
  const roadMatched = Boolean(roadKeyword && normalizedText.includes(normalizeAddressForMatch(roadKeyword)));
  const coreMatched = coreKeywords.some((keyword) => keyword.length >= 2 && normalizedText.includes(keyword));
  const addressMatched = Boolean(doorPlate && normalizedText.includes(doorPlate));
  const looseMatched = brandMatched && roadMatched && coreMatched;

  return {
    matched: false,
    reason: strictMatch.reason || (addressMatched ? "doorplate-without-city-core" : looseMatched ? "missing-door-number" : "not-matched"),
    addressMatched,
    brandMatched,
    roadMatched,
    coreMatched,
    hotelName: parsed.hotelName,
    address: parsed.address,
    doorNumber: parsed.doorNumber,
    price: parsed.price
  };
}

export function matchAliHotelListCandidateForDetail(candidate: QingmaoHotelCandidate, text: string, queryCity = "") {
  const parsed = parseAliHotelListCardText(text);
  const normalizedCard = normalizeAddressForMatch(text);
  const normalizedCardName = normalizeHotelNameForMatch(parsed.hotelName || text);
  const normalizedCandidateName = normalizeAddressForMatch(candidate.hotelName);
  const brandKeyword = detectAliHotelBrandKeyword(candidate.hotelName);
  const brandMatched = brandKeyword ? normalizedCard.includes(brandKeyword) : normalizedCandidateName.slice(0, 2) ? normalizedCard.includes(normalizedCandidateName.slice(0, 2)) : false;
  const city = queryCity.replace(/市$/, "");
  const cityMatched = !city || normalizedCard.includes(city) || candidate.hotelName.includes(queryCity);
  const exactNameMatched = scoreHotelNameMatch(candidate.hotelName, parsed.hotelName || text) >= Math.min(8, normalizeHotelNameForMatch(candidate.hotelName).length);
  const coreKeywords = buildCtripHotelCoreKeywords(candidate.hotelName)
    .map((keyword) => normalizeAddressForMatch(keyword))
    .filter((keyword) => keyword.length >= 2 && !/如家商旅|酒店|广州/.test(keyword));
  const roadKeyword = extractHotelRoadKeyword(candidate.address);
  const normalizedRoadKeyword = roadKeyword ? normalizeAddressForMatch(roadKeyword) : "";
  const coreNameMatched = exactNameMatched
    || coreKeywords.some((keyword) => normalizedCardName.includes(keyword) || normalizedCard.includes(keyword))
    || Boolean(normalizedRoadKeyword && normalizedCard.includes(normalizedRoadKeyword));
  const strictMatch = matchHotelByBrandCoreCityDoorNumber(candidate, text, queryCity);
  const matched = brandMatched && coreNameMatched && cityMatched;
  const reason = matched
    ? "阿里列表候选：品牌+核心店名，待详情门牌确认"
    : strictMatch.reason === "door-number-not-matched"
      ? "core-name-not-matched"
      : strictMatch.reason;

  return {
    matched,
    reason,
    sameHotelConfirmed: false,
    hotelName: parsed.hotelName,
    address: parsed.address,
    doorNumber: parsed.doorNumber,
    price: parsed.price,
    brandMatched,
    coreNameMatched,
    exactNameMatched,
    cityMatched,
    rawText: text
  };
}

export function extractHotelDoorNumber(text: string) {
  const normalized = normalizeAddressForMatch(text);
  const matches = Array.from(normalized.matchAll(/(\d+(?:[-－]\d+)?号)/g)).map((match) => match[1]);
  return matches.length ? matches[matches.length - 1] : null;
}

function extractAliHotelDetailAddressText(queryCity: string, rawText: string, expectedDoorNumber: string | null) {
  if (!expectedDoorNumber) return "";
  const city = queryCity.replace(/市$/, "");
  const textCandidates = rawText
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.includes(expectedDoorNumber));
  if (!textCandidates.length) {
    const compactText = rawText.replace(/\s+/g, " ").trim();
    if (compactText.includes(expectedDoorNumber)) textCandidates.push(compactText);
  }

  for (const text of textCandidates) {
    const doorIndex = text.indexOf(expectedDoorNumber);
    if (doorIndex < 0) continue;
    const prefix = text.slice(Math.max(0, doorIndex - 80), doorIndex);
    const startMarkers = [
      `${city}市`,
      city,
      "北京市",
      "上海市",
      "天津市",
      "重庆市"
    ].filter(Boolean);
    let startIndex = -1;
    for (const marker of startMarkers) {
      const markerIndex = prefix.lastIndexOf(marker);
      if (markerIndex >= 0) {
        startIndex = markerIndex;
        break;
      }
    }
    if (startIndex < 0) {
      const districtMatch = prefix.match(/[^\s|｜:：，,。]*?(?:区|县|市)[^\s|｜:：，,。]*$/);
      startIndex = districtMatch?.index ?? -1;
    }
    const addressPrefix = (startIndex >= 0 ? prefix.slice(startIndex) : prefix)
      .replace(/^.*?(?=[\u4e00-\u9fa5]{1,}(?:省|市|区|县|路|街|大道|道))/, "")
      .trim();
    const address = `${addressPrefix}${expectedDoorNumber}`.trim();
    if (address && /(?:市|区|县|路|街|大道|道)/.test(address)) return address;
  }

  return "";
}

function extractAliHotelAnyDetailAddressText(queryCity: string, rawText: string) {
  const city = queryCity.replace(/市$/, "");
  const chunks = rawText
    .split(/[\n|｜]/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const matchedChunk = chunks.find((chunk) =>
    /\d+(?:[-－]\d+)?号/.test(chunk)
    && /(?:市|区|县|路|街|大道|道)/.test(chunk)
    && (!city || chunk.includes(city))
    && !/备案|ICP|许可证|营业执照/.test(chunk)
  );
  return matchedChunk ?? "";
}

export function parseAliHotelListCardText(text: string) {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const compactText = text.replace(/\s+/g, " ").trim();
  const hotelName = lines.find((line) => /如家商旅|酒店|宾馆/.test(line) && !/酒店列表|酒店预订|我的订单/.test(line))
    ?? compactText.match(/如家商旅(?:[（(]金标[）)])?[-－][^￥¥|]+?店/)?.[0]?.trim()
    ?? "";
  const address = lines.find((line) => /号/.test(line) && /广州|区|县|市|路|大道|街|巷|弄|道/.test(line))
    ?? compactText.match(/[\u4e00-\u9fa5A-Za-z0-9|/()（）·\-－]+?\d+(?:[-－]\d+)?号(?:\s*[|｜][^￥¥]+)?/)?.[0]?.trim()
    ?? "";
  const priceMatch = compactText.match(/[￥¥]\s*(\d{2,5})(?:\s*起)?/);

  return {
    hotelName,
    address,
    doorNumber: extractHotelDoorNumber(address || text),
    price: priceMatch ? Number(priceMatch[1]) : null,
    rawText: text
  };
}

export function matchHotelByBrandCoreCityDoorNumber(candidate: QingmaoHotelCandidate, cardText: string, queryCity = "") {
  const parsed = parseAliHotelListCardText(cardText);
  const normalizedCard = normalizeAddressForMatch(cardText);
  const normalizedCandidateName = normalizeAddressForMatch(candidate.hotelName);
  const normalizedCardName = normalizeAddressForMatch(parsed.hotelName || cardText);
  const brandKeyword = detectAliHotelBrandKeyword(candidate.hotelName);
  const brandMatched = brandKeyword ? normalizedCard.includes(brandKeyword) : normalizedCandidateName.slice(0, 2) ? normalizedCard.includes(normalizedCandidateName.slice(0, 2)) : false;
  const city = queryCity.replace(/市$/, "");
  const cityMatched = !city || normalizedCard.includes(city);
  const candidateDoorNumber = extractHotelDoorNumber(candidate.address);
  const cardDoorNumber = parsed.doorNumber;
  const doorNumberMatched = Boolean(candidateDoorNumber && cardDoorNumber && candidateDoorNumber === cardDoorNumber);
  const exactNameMatched = scoreHotelNameMatch(candidate.hotelName, parsed.hotelName || cardText) >= Math.min(8, normalizeHotelNameForMatch(candidate.hotelName).length);
  const coreKeywords = buildCtripHotelCoreKeywords(candidate.hotelName)
    .map((keyword) => normalizeAddressForMatch(keyword))
    .filter((keyword) => keyword.length >= 4 && !/如家商旅|酒店|广州/.test(keyword));
  const coreNameMatched = exactNameMatched || coreKeywords.some((keyword) => normalizedCardName.includes(keyword) || normalizedCard.includes(keyword));

  let reason = "not-matched";
  if (!cardDoorNumber) reason = "candidate-card-missing-door-number";
  else if (!brandMatched) reason = "brand-not-matched";
  else if (!coreNameMatched) reason = "core-name-not-matched";
  else if (!cityMatched) reason = "city-not-matched";
  else if (!doorNumberMatched) reason = "door-number-not-matched";
  else reason = "阿里列表候选：品牌+核心店名+门牌数字";

  return {
    matched: brandMatched && coreNameMatched && cityMatched && doorNumberMatched,
    reason,
    hotelName: parsed.hotelName,
    address: parsed.address,
    price: parsed.price,
    candidateDoorNumber,
    cardDoorNumber,
    doorNumber: cardDoorNumber,
    brandMatched,
    coreNameMatched,
    cityMatched,
    doorNumberMatched,
    exactNameMatched,
    rawText: cardText
  };
}

export function confirmAliHotelDetailDoorPlate(queryCity: string, candidate: QingmaoHotelCandidate, detailText: string) {
  const expectedDoorNumber = extractHotelDoorNumber(candidate.address);
  const detailAddress = extractAliHotelDetailAddressText(queryCity, detailText, expectedDoorNumber)
    || extractAliHotelAnyDetailAddressText(queryCity, detailText)
    || extractHotelAddressFromPageText(detailText, expectedDoorNumber, "");
  const actualDoorNumber = detailAddress ? extractHotelDoorNumber(detailAddress) : null;
  const normalizedDetail = normalizeAddressForMatch(detailAddress || detailText);
  const city = queryCity.replace(/市$/, "");
  const cityMatched = !city || normalizedDetail.includes(city);

  if (!expectedDoorNumber) {
    return {
      sameHotel: false,
      matchBasis: "青猫候选缺少可提取门牌号",
      detailAddress,
      expectedDoorNumber,
      detailDoorNumber: actualDoorNumber,
      failureReason: "青猫候选缺少可提取门牌号"
    };
  }
  if (!actualDoorNumber) {
    return {
      sameHotel: false,
      matchBasis: "阿里详情页未提取到地址",
      detailAddress,
      expectedDoorNumber,
      detailDoorNumber: actualDoorNumber,
      failureReason: "阿里详情页未提取到地址"
    };
  }
  if (cityMatched && actualDoorNumber === expectedDoorNumber) {
    return {
      sameHotel: true,
      matchBasis: "阿里详情确认：列表品牌+核心店名，详情门牌数字",
      detailAddress,
      expectedDoorNumber,
      detailDoorNumber: actualDoorNumber,
      failureReason: ""
    };
  }
  return {
    sameHotel: false,
    matchBasis: `阿里详情门牌不匹配：期望 ${expectedDoorNumber}，实际 ${actualDoorNumber}`,
    detailAddress,
    expectedDoorNumber,
    detailDoorNumber: actualDoorNumber,
    failureReason: `阿里详情门牌不匹配：期望 ${expectedDoorNumber}，实际 ${actualDoorNumber}`
  };
}

export function applyAliHotelDetailDiagnosisToTrace(
  trace: AliHotelKeywordTrace,
  detailFinalUrl: string,
  detail: ReturnType<typeof confirmAliHotelDetailDoorPlate>
) {
  trace.detailFinalUrl = detailFinalUrl;
  trace.detailAddress = detail.detailAddress;
  trace.detailDoorNumber = detail.detailDoorNumber;
  trace.detailSameHotel = detail.sameHotel;
  trace.detailMatchBasis = detail.matchBasis;
  trace.detailFailureReason = detail.failureReason;
  return trace;
}

export function resolveAliHotelSameHotelAfterFailure(rawSameHotel: boolean, failureReason: string) {
  if (/阿里详情门牌不匹配|阿里详情页未提取到地址|阿里列表未找到|详情页加载超时|门牌不匹配/.test(failureReason)) {
    return false;
  }
  return rawSameHotel;
}

export interface AliHotelListCardText {
  index: number;
  text: string;
  screenIndex?: number;
}

export interface AliHotelListMatchedCard extends AliHotelListCardText {
  match: ReturnType<typeof matchAliHotelListCandidateForDetail>;
}

export interface AliHotelListMatchSelection {
  selector: string;
  cardCount: number;
  screensRead?: number;
  maxScreens?: number;
  maxCards?: number;
  foundExactNameCard?: boolean;
  cards: AliHotelListMatchedCard[];
  detailCandidates: AliHotelDetailCandidateTrace[];
  matched: boolean;
  matchedCard: AliHotelListMatchedCard | null;
  failureReason: string;
}

export interface AliHotelDetailCandidateTrace {
  rank: number;
  cardIndex: number;
  screenIndex?: number;
  cardText: string;
  matchScore: number;
  listMatchReason: string;
  clickedDetail: boolean;
  detailFinalUrl?: string;
  detailAddress?: string;
  detailDoorNumber?: string | null;
  detailSameHotel?: boolean;
  detailMatchBasis?: string;
  failureReason?: string;
  detailScreenshotPath?: string;
}

export interface AliHotelKeywordTrace extends AliHotelListMatchSelection {
  keyword: string;
  keywordMode?: AliHotelSearchKeywordPlanItem["mode"];
  brandFallback?: boolean;
  finalUrl: string;
  listScreenshotPath?: string;
  detailScreenshotPath?: string;
  detailCandidates: AliHotelDetailCandidateTrace[];
  selectedAsCandidate?: boolean;
  clickedDetail?: boolean;
  detailFinalUrl?: string;
  detailAddress?: string;
  detailDoorNumber?: string | null;
  detailSameHotel?: boolean;
  detailMatchBasis?: string;
  detailFailureReason?: string;
}

export interface AliHotelCardReadPage {
  evaluate(pageFunction: string): Promise<unknown>;
  waitForTimeout(timeout: number): Promise<unknown>;
}

function scoreAliHotelDetailCandidate(candidate: QingmaoHotelCandidate, match: ReturnType<typeof matchAliHotelListCandidateForDetail>) {
  const expectedDoorNumber = extractHotelDoorNumber(candidate.address);
  let score = 0;
  if (match.exactNameMatched) score += 100;
  if (match.brandMatched) score += 30;
  if (match.coreNameMatched) score += 40;
  if (match.cityMatched) score += 10;
  if (typeof match.price === "number") score += 1;
  if (expectedDoorNumber && match.doorNumber === expectedDoorNumber) score += 80;
  else if (!match.doorNumber) score += 20;
  else score -= 30;
  return score;
}

export function rankAliHotelDetailCandidateCards(
  candidate: QingmaoHotelCandidate,
  queryCity: string,
  cards: AliHotelListCardText[],
  limit = 3
): AliHotelDetailCandidateTrace[] {
  return cards
    .map((card, sourceOrder) => {
      const match = matchAliHotelListCandidateForDetail(candidate, card.text, queryCity);
      return {
        card,
        sourceOrder,
        match,
        score: scoreAliHotelDetailCandidate(candidate, match)
      };
    })
    .filter((item) => item.match.matched)
    .sort((left, right) => right.score - left.score || left.sourceOrder - right.sourceOrder)
    .slice(0, limit)
    .map((item, index) => ({
      rank: index + 1,
      cardIndex: item.card.index,
      screenIndex: item.card.screenIndex,
      cardText: item.card.text.trim(),
      matchScore: item.score,
      listMatchReason: item.match.reason,
      clickedDetail: false
    }));
}

export function applyAliHotelDetailDiagnosisToCandidateTrace(
  trace: AliHotelDetailCandidateTrace,
  detailFinalUrl: string,
  detail: ReturnType<typeof confirmAliHotelDetailDoorPlate>
) {
  trace.clickedDetail = true;
  trace.detailFinalUrl = detailFinalUrl;
  trace.detailAddress = detail.detailAddress;
  trace.detailDoorNumber = detail.detailDoorNumber;
  trace.detailSameHotel = detail.sameHotel;
  trace.detailMatchBasis = detail.matchBasis;
  trace.failureReason = detail.failureReason;
  return trace;
}

export function formatAliHotelDetailCandidateFailure(attempts: AliHotelDetailCandidateTrace[]) {
  const failureItems = attempts
    .slice(0, 3)
    .map((attempt) => `第${attempt.rank}候选 ${attempt.failureReason || attempt.detailMatchBasis || "详情确认失败"}`);
  return `阿里同关键词前 3 个详情候选均未匹配：${failureItems.join("；")}`;
}

export function resolveAliHotelDetailCandidateAttempts(
  queryCity: string,
  candidate: QingmaoHotelCandidate,
  attempts: Array<AliHotelDetailCandidateTrace & { detailText: string; detailFinalUrl?: string }>
) {
  const resolvedAttempts = attempts.map((attempt) => {
    const detail = confirmAliHotelDetailDoorPlate(queryCity, candidate, attempt.detailText);
    return applyAliHotelDetailDiagnosisToCandidateTrace(
      { ...attempt },
      attempt.detailFinalUrl ?? "",
      detail
    );
  });
  const matchedCandidate = resolvedAttempts.find((attempt) => attempt.detailSameHotel === true) ?? null;
  return {
    matched: Boolean(matchedCandidate),
    matchedCandidate,
    attempts: resolvedAttempts,
    failureReason: matchedCandidate ? "" : formatAliHotelDetailCandidateFailure(resolvedAttempts)
  };
}

export function selectAliHotelListMatchFromCards(
  candidate: QingmaoHotelCandidate,
  queryCity: string,
  cards: AliHotelListCardText[]
): AliHotelListMatchSelection {
  const matchedCards = cards.map((card) => ({
    ...card,
    text: card.text.trim(),
    match: matchAliHotelListCandidateForDetail(candidate, card.text, queryCity)
  }));
  const detailCandidates = rankAliHotelDetailCandidateCards(candidate, queryCity, cards);
  const firstDetailCandidate = detailCandidates[0] ?? null;
  const matchedCard = firstDetailCandidate
    ? matchedCards.find((card) => card.index === firstDetailCandidate.cardIndex && card.text === firstDetailCandidate.cardText) ?? null
    : null;
  const selection: AliHotelListMatchSelection = {
    selector: ALI_HOTEL_LIST_CARD_SELECTOR,
    cardCount: matchedCards.length,
    foundExactNameCard: matchedCards.some((card) => card.match.exactNameMatched),
    cards: matchedCards,
    detailCandidates,
    matched: Boolean(matchedCard),
    matchedCard,
    failureReason: ""
  };
  selection.failureReason = matchedCard ? "" : formatAliHotelListMatchFailure(candidate, selection);
  return selection;
}

export function formatAliHotelListMatchFailure(candidate: QingmaoHotelCandidate, selection: AliHotelListMatchSelection) {
  const candidateDoorNumber = extractHotelDoorNumber(candidate.address);
  const scrollSummary = selection.screensRead
    ? `滚动 ${selection.screensRead} 屏，收集 ${selection.cardCount} 张唯一卡片，`
    : "";
  const hasCoreMatch = (card: AliHotelListMatchedCard) => {
    return Boolean(card.match.coreNameMatched);
  };
  if (selection.cardCount === 0) {
    return `${scrollSummary}阿里列表卡片 selector 0 张：${selection.selector}`;
  }

  const cardsWithDoor = selection.cards.filter((card) => Boolean(card.match.doorNumber));
  const cardsWithTargetDoor = candidateDoorNumber
    ? selection.cards.filter((card) => card.match.doorNumber === candidateDoorNumber)
    : [];
  const cardsWithCore = selection.cards.filter(hasCoreMatch);
  const cardsWithCoreNoDoor = cardsWithCore.filter((card) => card.match.doorNumber !== candidateDoorNumber);

  if (cardsWithTargetDoor.length > 0 && cardsWithTargetDoor.every((card) => !hasCoreMatch(card))) {
    return `${scrollSummary}阿里列表读取了 ${selection.cardCount} 张卡片，有目标门牌但核心店名不匹配：${candidateDoorNumber}`;
  }
  if (cardsWithCore.length > 0 && cardsWithCoreNoDoor.length > 0) {
    return `${scrollSummary}阿里列表读取了 ${selection.cardCount} 张卡片，有品牌+核心店名候选但未进入详情确认：目标 ${candidateDoorNumber ?? "未知"}`;
  }
  if (cardsWithDoor.length > 0) {
    return `${scrollSummary}阿里列表读取了 ${selection.cardCount} 张卡片，但没有目标门牌：${candidateDoorNumber ?? "未知"}`;
  }
  const exactNameFailure = selection.foundExactNameCard === false ? "未找到酒店名一致的阿里候选，" : "";
  return `${scrollSummary}${exactNameFailure}阿里列表未找到品牌+核心店名候选：已读取 ${selection.cardCount} 张卡片，目标 ${candidateDoorNumber ?? "未知"}`;
}

function dedupeAliHotelCards(cards: AliHotelListCardText[]) {
  const seen = new Set<string>();
  const uniqueCards: AliHotelListCardText[] = [];
  for (const card of cards) {
    const key = card.text.replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniqueCards.push(card);
  }
  return uniqueCards;
}

async function readVisibleAliHotelCards(page: AliHotelCardReadPage, screenIndex: number) {
  const cards = await page.evaluate(`(() => {
    const selector = ${JSON.stringify(ALI_HOTEL_LIST_CARD_SELECTOR)};
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    return Array.from(document.querySelectorAll(selector))
      .map((element, index) => ({ element, index }))
      .filter(({ element }) => isVisible(element))
      .map(({ element, index }) => ({ index, text: (element.textContent || "").trim() }));
  })()`) as AliHotelListCardText[];
  return cards.map((card) => ({ ...card, screenIndex }));
}

async function scrollAliHotelListPage(page: AliHotelCardReadPage) {
  await page.evaluate(`(() => {
    const scrollingElement = document.scrollingElement || document.documentElement || document.body;
    scrollingElement.scrollBy({ top: Math.max(window.innerHeight * 0.75, 500), behavior: "instant" });
  })()`).catch(() => undefined);
}

export async function collectAliHotelListCardsForMatching(
  page: AliHotelCardReadPage,
  candidate: QingmaoHotelCandidate,
  queryCity: string,
  options: { maxScreens?: number; maxCards?: number; maxDurationMs?: number; waitMs?: number } = {}
) {
  const maxScreens = options.maxScreens ?? 8;
  const maxCards = options.maxCards ?? Number.MAX_SAFE_INTEGER;
  const maxDurationMs = options.maxDurationMs ?? Number.MAX_SAFE_INTEGER;
  const waitMs = options.waitMs ?? 800;
  const collectedCards: AliHotelListCardText[] = [];
  const startedAt = Date.now();
  let screensRead = 0;

  for (let screenIndex = 0; screenIndex < maxScreens; screenIndex += 1) {
    if (screenIndex === 0) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const firstCards = await readVisibleAliHotelCards(page, screenIndex);
        if (firstCards.length > 0) {
          collectedCards.push(...firstCards);
          break;
        }
        await page.waitForTimeout(waitMs);
      }
    } else {
      await scrollAliHotelListPage(page);
      await page.waitForTimeout(waitMs);
      collectedCards.push(...await readVisibleAliHotelCards(page, screenIndex));
    }
    screensRead = screenIndex + 1;
    const uniqueCards = dedupeAliHotelCards(collectedCards).slice(0, maxCards);
    const selection = selectAliHotelListMatchFromCards(candidate, queryCity, uniqueCards);
    selection.screensRead = screensRead;
    selection.maxScreens = maxScreens;
    selection.maxCards = maxCards === Number.MAX_SAFE_INTEGER ? undefined : maxCards;
    selection.foundExactNameCard = selection.cards.some((card) => card.match.exactNameMatched);
    selection.failureReason = selection.matched ? "" : formatAliHotelListMatchFailure(candidate, selection);
    if (selection.matched || uniqueCards.length >= maxCards || Date.now() - startedAt >= maxDurationMs) {
      return selection;
    }
  }

  const uniqueCards = dedupeAliHotelCards(collectedCards).slice(0, maxCards);
  const selection = selectAliHotelListMatchFromCards(candidate, queryCity, uniqueCards);
  selection.screensRead = screensRead;
  selection.maxScreens = maxScreens;
  selection.maxCards = maxCards === Number.MAX_SAFE_INTEGER ? undefined : maxCards;
  selection.foundExactNameCard = selection.cards.some((card) => card.match.exactNameMatched);
  selection.failureReason = selection.matched ? "" : formatAliHotelListMatchFailure(candidate, selection);
  return selection;
}

export function isHotelCandidateRelevantForQuery(candidate: QingmaoHotelCandidate, query: QingmaoHotelCandidateQuery) {
  const keyword = query.keyword.trim();
  if (!keyword) return true;

  return candidate.hotelName.includes(keyword);
}

export function extractCtripHotelIdWithSourceFromUrl(url: string) {
  const parsed = new URL(url);
  const explicitHotelId = parsed.searchParams.get("hotelId") ?? parsed.searchParams.get("hotelIdStr");
  if (explicitHotelId) return { hotelId: explicitHotelId, source: parsed.searchParams.get("hotelId") ? "hotelId" : "hotelIdStr" };

  for (const key of ["selectedSearchItem", "searchFilter"]) {
    const rawValue = parsed.searchParams.get(key);
    if (!rawValue) continue;
    try {
      const value = JSON.parse(rawValue) as { matchFilterId?: string; sourceId?: string };
      const idText = value.matchFilterId ?? value.sourceId ?? "";
      const match = idText.match(/HOTEL\.HOTEL\.(\d+)/);
      if (match) return { hotelId: match[1], source: key };
    } catch {
      const match = rawValue.match(/HOTEL\.HOTEL\.(\d+)/);
      if (match) return { hotelId: match[1], source: key };
    }
  }

  return null;
}

function extractCtripHotelIdFromUrl(url: string) {
  return extractCtripHotelIdWithSourceFromUrl(url)?.hotelId ?? null;
}

function normalizeHotelNameForMatch(value: string) {
  return value
    .replace(/\([^)]*?\)|（[^）]*?）/g, (match) => match.replace(/[()（）]/g, ""))
    .replace(/金标|酒店|如家|商旅|广州|地铁站|店|分店|旗舰|协议|可开专票/g, "")
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "")
    .trim();
}

function longestCommonSubstringLength(left: string, right: string) {
  let best = 0;
  const dp = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      if (left[i - 1] === right[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
        best = Math.max(best, dp[i][j]);
      }
    }
  }
  return best;
}

export function scoreHotelNameMatch(sourceName: string, targetName: string) {
  const source = normalizeHotelNameForMatch(sourceName);
  const target = normalizeHotelNameForMatch(targetName);
  if (!source || !target) return 0;
  if (source.includes(target) || target.includes(source)) return Math.min(source.length, target.length);
  return longestCommonSubstringLength(source, target);
}

function normalizeAddressForMatch(value: string) {
  const chineseDigits: Record<string, string> = {
    零: "0",
    一: "1",
    二: "2",
    三: "3",
    四: "4",
    五: "5",
    六: "6",
    七: "7",
    八: "8",
    九: "9"
  };
  return value
    .replace(/\s+/g, "")
    .replace(/[()（）,，。；;：:]/g, "")
    .replace(/[零一二三四五六七八九]+(?=号)/g, (match) => match.split("").map((char) => chineseDigits[char] ?? char).join(""));
}

export function extractHotelDoorPlate(address: string) {
  const normalized = normalizeAddressForMatch(address);
  const addressBody = normalized.replace(/^.*[区县市]/, "") || normalized;
  const matches = Array.from(
    addressBody.matchAll(/([\u4e00-\u9fa5A-Za-z0-9]{1,24}(?:大道|大街|横路|横街|路|街|巷|弄|道|里|村)[东南西北中]?\d+(?:[-－]\d+)?号(?:之?\d+)?)/g)
  ).map((match) => match[1]);
  return matches.length ? matches[matches.length - 1] : null;
}

export function isSameHotelByCityAndDoorPlate(queryCity: string, sourceAddress: string, targetText: string) {
  const doorPlate = extractHotelDoorPlate(sourceAddress);
  if (!doorPlate) return false;

  const normalizedTarget = normalizeAddressForMatch(targetText);
  const cityMatched = !queryCity || normalizedTarget.includes(queryCity.replace(/市$/, ""));
  return cityMatched && normalizedTarget.includes(doorPlate);
}

export function selectLockedQingmaoHotelCandidate(candidates: QingmaoHotelCandidate[], query: QingmaoHotelCandidateQuery) {
  const candidate = candidates.find((item) => isHotelCandidateRelevantForQuery(item, query) && Boolean(item.price && item.price > 0));
  if (!candidate) {
    throw new Error(`未找到${query.city}/${query.keyword}可用青猫酒店候选`);
  }
  if (!candidate.address) {
    throw new Error(`${candidate.hotelName} 缺少地址`);
  }
  if (!extractHotelDoorPlate(candidate.address)) {
    throw new Error(`${candidate.hotelName} 缺少可提取门牌号：${candidate.address}`);
  }
  return candidate;
}

function diagnoseDoorPlateMatch(queryCity: string, sourceAddress: string, targetText: string) {
  const sourceDoorPlate = extractHotelDoorPlate(sourceAddress);
  const targetDoorPlate = extractHotelDoorPlate(targetText);
  const normalizedTarget = normalizeAddressForMatch(targetText);
  const cityName = queryCity.replace(/市$/, "");
  const cityMatched = !cityName || normalizedTarget.includes(cityName);

  if (!sourceDoorPlate) {
    return {
      sameHotel: false,
      matchBasis: "青猫候选缺少可提取门牌号",
      sourceDoorPlate,
      targetDoorPlate
    };
  }
  if (!cityMatched) {
    return {
      sameHotel: false,
      matchBasis: "城市不一致或页面未出现目标城市",
      sourceDoorPlate,
      targetDoorPlate
    };
  }
  if (normalizedTarget.includes(sourceDoorPlate)) {
    return {
      sameHotel: true,
      matchBasis: "同城市同门牌号",
      sourceDoorPlate,
      targetDoorPlate: sourceDoorPlate
    };
  }
  if (!targetDoorPlate) {
    return {
      sameHotel: false,
      matchBasis: "竞品页面缺少可提取门牌号",
      sourceDoorPlate,
      targetDoorPlate
    };
  }
  return {
    sameHotel: false,
    matchBasis: "门牌号不一致",
    sourceDoorPlate,
    targetDoorPlate
  };
}

function assertAliHotelSameAddress(query: QingmaoHotelCandidateQuery, candidate: QingmaoHotelCandidate, bodyText: string) {
  const doorPlate = extractHotelDoorPlate(candidate.address);
  if (!doorPlate) {
    throw new Error(`阿里商旅同店校验失败：青猫候选缺少门牌号 ${candidate.address || candidate.hotelName}`);
  }
  if (!isSameHotelByCityAndDoorPlate(query.city, candidate.address, bodyText)) {
    throw new Error(`阿里商旅同店校验失败：未匹配到同城市同门牌号 ${query.city} ${doorPlate}`);
  }
}

async function waitForZtripHotelKeywordInput(page: BrowserPage) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const count = await page.locator('input[placeholder*="酒店名称"]').count().catch(() => 0);
    if (count > 0) return;
    await page.waitForTimeout(1_000);
  }

  throw new Error("在途商旅酒店搜索框加载超时");
}

async function clickZtripSearchButton(page: BrowserPage) {
  const clicked = await page.evaluate<boolean>(`(() => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const target = Array.from(document.querySelectorAll("button,span,div,a"))
      .find((element) => isVisible(element) && (element.textContent || "").trim() === "搜索");
    if (!target) return false;
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`);

  if (!clicked) {
    throw new Error("在途商旅未找到酒店搜索按钮");
  }
}

async function clickZtripHotelSuggestion(page: BrowserPage, hotelName: string) {
  const hotelValue = JSON.stringify(hotelName);
  return await page.evaluate<boolean>(`(() => {
    const hotelName = ${hotelValue};
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const elements = Array.from(document.querySelectorAll("*"))
      .filter((element) => isVisible(element) && (element.textContent || "").trim() === hotelName);
    const target = elements[0];
    if (!target) return false;
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`);
}

async function isZtripHotelDetailLoaded(page: BrowserPage) {
  const bodyText = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
  return /相册|封面|客房/.test(bodyText) && /大床|双床/.test(bodyText) && /CNY\s*\d+/.test(bodyText);
}

async function openMatchingZtripHotelDetail(page: BrowserPage, hotelName: string) {
  if (await isZtripHotelDetailLoaded(page)) return;

  const hotelValue = JSON.stringify(hotelName);
  const clicked = await page.evaluate<boolean>(`(() => {
    const hotelName = ${hotelValue};
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const nameNode = Array.from(document.querySelectorAll("*"))
      .find((element) => isVisible(element) && (element.textContent || "").trim() === hotelName);
    const candidates = [];
    let current = nameNode;
    while (current && current !== document.body) {
      if ((current.textContent || "").includes("查看详情")) candidates.push(current);
      current = current.parentElement;
    }
    const container = candidates[0] || document.body;
    const detailButton = Array.from(container.querySelectorAll(".seeRoom,button,span,a,div"))
      .find((element) => isVisible(element) && (element.textContent || "").trim() === "查看详情");
    if (!detailButton) return false;
    detailButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    detailButton.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    detailButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`);

  if (!clicked) {
    throw new Error(`在途商旅酒店结果页未找到同酒店详情入口：${hotelName}`);
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await isZtripHotelDetailLoaded(page)) return;
    await page.waitForTimeout(1_000);
  }

  throw new Error("在途商旅同酒店详情房型加载超时");
}

async function openZtripHotelSearchResultByHotel(page: BrowserPage, query: ZtripHotelQuery, hotelName: string) {
  await page.goto(ztripHotelListUrl(query), { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState?.("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await waitForZtripHotelKeywordInput(page);

  for (const keyword of normalizeHotelSearchKeywords(hotelName)) {
    await page.locator('input[placeholder*="酒店名称"]').first().fill(keyword);
    await page.waitForTimeout(300);
    await clickZtripSearchButton(page);
    await page.waitForTimeout(1_500);

    const suggestionText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
    if (!suggestionText.includes(hotelName)) {
      continue;
    }

    await clickZtripHotelSuggestion(page, hotelName);
    for (let attempt = 0; attempt < 15; attempt += 1) {
      if (await isZtripHotelDetailLoaded(page)) return;
      await page.waitForTimeout(1_000);
    }

    await openMatchingZtripHotelDetail(page, hotelName);
    return;
  }

  throw new Error(`在途商旅未搜索到同酒店：${hotelName}`);
}

async function clickZtripHotelFilter(page: BrowserPage, label: string) {
  const labelValue = JSON.stringify(label);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const clicked = await page.evaluate<boolean>(`(() => {
      const label = ${labelValue};
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const elements = Array.from(document.querySelectorAll(".condition-tab span"))
        .filter((element) => isVisible(element) && (element.textContent || "").trim() === label);
      const target = elements[0];
      if (!target) return false;
      const className = target.getAttribute("class") || "";
      if (/active|select|checked|current/i.test(className)) return true;
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    })()`);

    if (clicked) {
      await page.waitForTimeout(1_500);
      return;
    }

    await page.waitForTimeout(500);
  }

  throw new Error(`在途商旅酒店未找到筛选项 ${label}`);
}

async function filterZtripHotelBigBedDoubleBreakfast(page: BrowserPage) {
  for (const label of ["大床", "双份早餐"]) {
    await clickZtripHotelFilter(page, label);
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const bodyText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
    const rates = parseZtripHotelRatesText(bodyText);
    if (rates.length > 0) {
      return;
    }
    await page.waitForTimeout(1_000);
  }
}

async function filterZtripHotelRatePlan(page: BrowserPage, ratePlan: HotelRatePlanLabel) {
  await clickZtripHotelFilter(page, hotelRatePlanBedType(ratePlan));
  if (hotelRatePlanBreakfast(ratePlan) === "有早餐") {
    await clickZtripHotelFilter(page, "含早餐").catch(async () => {
      await clickZtripHotelFilter(page, "双份早餐");
    });
  }

  await page.waitForTimeout(1_500);
}

async function expandZtripRoomCards(page: BrowserPage) {
  for (let round = 0; round < 3; round += 1) {
    const clickedCount = await page.evaluate<number>(`(() => {
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const badAfter = Array.from(document.querySelectorAll("*"))
        .find((element) => isVisible(element) && (element.textContent || "").trim() === "不满足筛选条件的产品");
      const badTop = badAfter ? badAfter.getBoundingClientRect().top : Number.POSITIVE_INFINITY;
      const candidates = Array.from(document.querySelectorAll("div,li,section,article"))
        .filter((element) => {
          if (!isVisible(element)) return false;
          const rect = element.getBoundingClientRect();
          if (rect.top >= badTop) return false;
          const text = (element.textContent || "").replace(/\\s+/g, " ").trim();
          if (!text || text.length > 140) return false;
          if (!/房/.test(text) || /住客评价|酒店亮点|酒店政策|早餐一流|查看其他更多价格/.test(text)) return false;
          if (/CNY\\s*\\d+/i.test(text)) return false;
          return /大床|双床|房A|房B|房C|安心睡|商务|高级|特色|零压|安睡/.test(text);
        });
      const seen = new Set();
      let clicked = 0;
      for (const element of candidates) {
        const text = (element.textContent || "").replace(/\\s+/g, " ").trim();
        if (seen.has(text)) continue;
        seen.add(text);
        element.scrollIntoView({ block: "center" });
        element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        clicked += 1;
        if (clicked >= 8) break;
      }
      return clicked;
    })()`);
    if (clickedCount === 0) break;
    await page.waitForTimeout(900);
  }
}

function findQingmaoHotelFrame(page: BrowserPage) {
  return page.frames().find((frame) => frame.url().includes("mrs.tmctrip.com") && /hotel|proxy-book-index/i.test(frame.url())) ?? null;
}

async function waitForQingmaoHotelFrame(page: BrowserPage) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const frame = findQingmaoHotelFrame(page);
    if (frame) return frame;
    await page.waitForTimeout(500);
  }

  throw new Error("未找到青猫酒店 iframe");
}

async function waitForQingmaoHotelSearchFrame(page: BrowserPage) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const frame = findQingmaoHotelFrame(page);
    const citySelectorCount = await frame?.locator(".el-select.w-187 .el-select__wrapper").count().catch(() => 0) ?? 0;
    const searchButtonCount = await frame?.getByRole("button", { name: "搜索酒店" }).count().catch(() => 0) ?? 0;
    if (frame && citySelectorCount > 0 && searchButtonCount > 0) return frame;
    await page.waitForTimeout(500);
  }

  throw new Error("未找到青猫酒店搜索表单");
}

async function openQingmaoDomesticHotelTab(page: BrowserPage) {
  if (!/TravelBooking/i.test(page.url())) {
    await page.getByText("差旅预订", { exact: true }).first().click({ timeout: 8_000 });
    await page.waitForTimeout(3_000);
  }

  const currentHotelFrame = findQingmaoHotelFrame(page);
  if (currentHotelFrame) {
    await currentHotelFrame.evaluate(`(() => {
      window.location.href = "https://mrs.tmctrip.com/#/proxy-book-index";
    })()`).catch(() => undefined);
    await page.waitForTimeout(3_000);
  }

  await page.getByText("国内酒店", { exact: true }).click({ timeout: 8_000 }).catch(async () => {
    await page.evaluate<boolean>(`(() => {
      const target = Array.from(document.querySelectorAll("*"))
        .find((element) => (element.textContent || "").trim() === "国内酒店");
      if (!target) return false;
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    })()`);
  });

  try {
    return await waitForQingmaoHotelSearchFrame(page);
  } catch (error) {
    await page.goto(platformUrls.青猫差旅, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
    await page.waitForLoadState?.("networkidle", { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(3_000);
    await page.getByText("差旅预订", { exact: true }).first().click({ timeout: 8_000 }).catch(() => undefined);
    await page.waitForTimeout(2_000);
    await page.getByText("国内酒店", { exact: true }).click({ timeout: 8_000 }).catch(() => undefined);
    return await waitForQingmaoHotelSearchFrame(page);
  }
}

async function clickQingmaoHotelFrameElement(frame: BrowserFrame, selector: string) {
  const selectorValue = JSON.stringify(selector);
  const clicked = await frame.evaluate<boolean>(`(() => {
    const selector = ${selectorValue};
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const target = Array.from(document.querySelectorAll(selector)).find((element) => isVisible(element));
    if (!target) return false;
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`);

  if (!clicked) {
    throw new Error(`青猫酒店未找到可点击元素 ${selector}`);
  }
}

async function selectQingmaoHotelCity(frame: BrowserFrame, city: string) {
  const currentCityText = await frame.locator(".el-select.w-187").first().innerText({ timeout: 2_000 }).catch(() => "");
  if (currentCityText.includes(city)) {
    return;
  }

  await clickQingmaoHotelFrameElement(frame, ".el-select.w-187 .el-select__wrapper");
  await frame.waitForTimeout(500);
  await frame.locator(".el-select.w-187 input").first().fill(city);
  await frame.waitForTimeout(1_000);

  const cityValue = JSON.stringify(city);
  const selected = await frame.evaluate<boolean>(`(() => {
    const city = ${cityValue};
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const target = Array.from(document.querySelectorAll(".el-select-dropdown__item.keyword-selection"))
      .find((element) => isVisible(element) && (element.textContent || "").replace(/\\s+/g, "").trim() === city + "城市")
      ?? Array.from(document.querySelectorAll(".el-select-dropdown__item"))
        .find((element) => isVisible(element) && (element.textContent || "").includes(city));
    if (!target) return false;
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`);

  if (!selected) {
    throw new Error(`青猫酒店未找到城市 ${city}`);
  }

  await frame.waitForTimeout(1_000);
}

async function selectQingmaoHotelKeyword(frame: BrowserFrame, keyword: string) {
  await clickQingmaoHotelFrameElement(frame, ".el-select.w-303 .el-select__wrapper");
  await frame.waitForTimeout(500);
  await frame.locator(".el-select.w-303 input").first().fill("");
  await frame.waitForTimeout(300);
  await frame.locator(".el-select.w-303 input").first().fill(keyword);
  await frame.waitForTimeout(1_200);

  const keywordValue = JSON.stringify(keyword);
  const selected = await frame.evaluate<boolean>(`(() => {
    const keyword = ${keywordValue};
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const items = Array.from(document.querySelectorAll(".el-select-dropdown__item.keyword-selection"));
    const target = items
      .find((element) => isVisible(element) && (element.textContent || "").replace(/\\s+/g, "").trim() === keyword + "品牌")
      ?? items.find((element) => (element.textContent || "").replace(/\\s+/g, "").trim() === keyword + "品牌")
      ?? Array.from(document.querySelectorAll(".el-select-dropdown__item.keyword-selection"))
        .find((element) => isVisible(element) && (element.textContent || "").includes(keyword));
    if (!target) return false;
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`);

  const updatedKeywordValue = await frame
    .evaluate<string>(`(() => document.querySelector(".el-select.w-303 input")?.value || "")()`)
    .catch(() => "");
  if (!selected && !updatedKeywordValue.includes(keyword)) {
    throw new Error(`青猫酒店未找到关键词 ${keyword}`);
  }
  if (!selected) {
    await frame.locator(".el-select.w-303 input").first().press("Enter").catch(() => undefined);
  }

  await frame.waitForTimeout(1_000);
}

interface QingmaoHotelSearchStateSnapshot {
  cityText: string;
  checkInDate: string;
  checkOutDate: string;
  keywordText: string;
  keywordInputValue: string;
  bodyText: string;
}

async function readQingmaoHotelSearchState(frame: BrowserFrame): Promise<QingmaoHotelSearchStateSnapshot> {
  const dates = await frame
    .evaluate<string[]>(`(() => Array.from(document.querySelectorAll(".el-range-input")).map((input) => input.value || ""))()`)
    .then((items) => items ?? [])
    .catch(() => []);
  return {
    cityText: await frame.locator(".el-select.w-187").first().innerText({ timeout: 2_000 }).catch(() => ""),
    checkInDate: dates[0] ?? "",
    checkOutDate: dates[1] ?? "",
    keywordText: await frame.locator(".el-select.w-303").first().innerText({ timeout: 2_000 }).catch(() => ""),
    keywordInputValue: await frame
      .evaluate<string>(`(() => document.querySelector(".el-select.w-303 input")?.value || "")()`)
      .catch(() => ""),
    bodyText: await frame.locator("body").innerText({ timeout: 2_000 }).catch(() => "")
  };
}

function assertQingmaoHotelKeywordApplied(state: Pick<QingmaoHotelSearchStateSnapshot, "keywordText" | "keywordInputValue">, query: QingmaoHotelCandidateQuery) {
  const actualKeyword = [state.keywordText, state.keywordInputValue]
    .map((item) => item.replace(/\s+/g, "").trim())
    .find(Boolean) ?? "";
  if (!actualKeyword.includes(query.keyword)) {
    throw new Error(`青猫候选池关键词未生效：期望 ${query.keyword}，实际${actualKeyword ? ` ${actualKeyword}` : "为空"}`);
  }
}

export function validateQingmaoHotelCandidateSearchState(state: QingmaoHotelSearchStateSnapshot, query: QingmaoHotelCandidateQuery) {
  assertQingmaoHotelKeywordApplied(state, query);
  const candidates = parseQingmaoHotelCandidatesText(state.bodyText);
  const relevantCandidates = candidates.filter((candidate) => isHotelCandidateRelevantForQuery(candidate, query));
  if (relevantCandidates.length === 0) {
    throw new Error(`青猫候选池为空：${query.city} / ${query.keyword} / ${query.checkInDate} 至 ${query.checkOutDate} 未解析到候选酒店`);
  }
  return { candidates, relevantCandidates };
}

async function setQingmaoHotelDateRange(frame: BrowserFrame, query: QingmaoHotelCandidateQuery) {
  const currentDates = await frame
    .evaluate<string[]>(`(() => Array.from(document.querySelectorAll(".el-range-input")).map((input) => input.value || ""))()`)
    .then((dates) => dates ?? [])
    .catch(() => []);
  if (currentDates[0] === query.checkInDate && currentDates[1] === query.checkOutDate) {
    return;
  }

  await clickQingmaoHotelFrameElement(frame, ".el-date-editor");
  await frame.waitForTimeout(500);

  const clickDate = async (dateText: string) => {
    const payload = JSON.stringify({ dateText });
    return await frame.evaluate<boolean>(`(() => {
    const target = ${payload};
    const parse = (dateText) => {
      const [year, month, day] = dateText.split("-").map(Number);
      return { year, month, day };
    };
    const clickDate = (dateText) => {
      const date = parse(dateText);
      const monthText = date.year + " 年 " + date.month + " 月";
      const panels = Array.from(document.querySelectorAll(".el-date-range-picker__content"));
      const panel = panels.find((element) => (element.querySelector(".el-date-range-picker__header")?.textContent || "").includes(monthText));
      if (!panel) return false;
      const cells = Array.from(panel.querySelectorAll("td.available, td.today"));
      const cell = cells.find((element) => {
        if (element.classList.contains("prev-month") || element.classList.contains("next-month") || element.classList.contains("disabled")) return false;
        return (element.querySelector(".el-date-table-cell__text")?.textContent || "").trim() === String(date.day);
      });
      if (!cell) return false;
      cell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      cell.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    };
    return clickDate(target.dateText);
  })()`);
  };

  const selectedStart = await clickDate(query.checkInDate);
  await frame.waitForTimeout(700);
  const selectedEnd = await clickDate(query.checkOutDate);
  await frame.waitForTimeout(800);
  const updatedDates = await frame
    .evaluate<string[]>(`(() => Array.from(document.querySelectorAll(".el-range-input")).map((input) => input.value || ""))()`)
    .then((dates) => dates ?? [])
    .catch(() => []);

  if (!selectedStart || !selectedEnd || updatedDates[0] !== query.checkInDate || updatedDates[1] !== query.checkOutDate) {
    throw new Error(`青猫酒店未能选择日期 ${query.checkInDate} 至 ${query.checkOutDate}`);
  }
}

async function searchQingmaoHotelCandidates(page: BrowserPage, query: QingmaoHotelCandidateQuery) {
  let frame = await openQingmaoDomesticHotelTab(page);
  await selectQingmaoHotelCity(frame, query.city);
  await setQingmaoHotelDateRange(frame, query);
  await selectQingmaoHotelKeyword(frame, query.keyword);
  assertQingmaoHotelKeywordApplied(await readQingmaoHotelSearchState(frame), query);
  await frame.getByRole("button", { name: "搜索酒店" }).click({ timeout: 8_000 });

  for (let attempt = 0; attempt < 45; attempt += 1) {
    await page.waitForTimeout(1_000);
    frame = findQingmaoHotelFrame(page) ?? frame;
    const state = await readQingmaoHotelSearchState(frame);
    const bodyText = state.bodyText;
    if (bodyText.includes(query.checkInDate) && /共\s*\d+\s*家酒店/.test(bodyText) && /查看详情/.test(bodyText)) {
      validateQingmaoHotelCandidateSearchState(state, query);
      return frame;
    }
    if (/暂无内容|未找到|暂无酒店/.test(bodyText) && attempt > 5) {
      validateQingmaoHotelCandidateSearchState(state, query);
      return frame;
    }
  }

  throw new Error("青猫酒店候选池搜索超时");
}

async function clickQingmaoHotelCandidateDetail(frame: BrowserFrame, candidate: QingmaoHotelCandidate, index: number) {
  const hotelNameValue = JSON.stringify(candidate.hotelName);
  const clickedByName = await frame.evaluate<boolean>(`(() => {
    const hotelName = ${hotelNameValue};
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const nameElement = Array.from(document.querySelectorAll("*"))
      .find((element) => isVisible(element) && (element.textContent || "").trim() === hotelName);
    if (!nameElement) return false;
    let container = nameElement;
    for (let depth = 0; container && depth < 8; depth += 1) {
      const detail = Array.from(container.querySelectorAll("*"))
        .find((element) => isVisible(element) && (element.textContent || "").trim() === "查看详情");
      if (detail) {
        detail.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        detail.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        detail.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        return true;
      }
      container = container.parentElement;
    }
    return false;
  })()`);

  if (clickedByName) return;

  const detailButtons = frame.locator("text=查看详情");
  const count = await detailButtons.count().catch(() => 0);
  if (index >= count) {
    throw new Error(`青猫酒店候选池没有第 ${index + 1} 个详情入口`);
  }

  await detailButtons.nth(index).click({ timeout: 8_000 });
}

async function waitForQingmaoHotelDetailFrame(page: BrowserPage, expectedHotelName?: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const detailFrames = page.frames().filter((candidate) => candidate.url().includes("mrs.tmctrip.com") && candidate.url().includes("proxy-book-hotel-detail"));
    const frame = detailFrames[detailFrames.length - 1] ?? null;
    if (frame) {
      if (!expectedHotelName) return frame;
      const bodyText = await frame.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
      if (bodyText.includes(expectedHotelName)) return frame;
    }
    await page.waitForTimeout(500);
  }

  throw new Error("未找到青猫酒店详情页 iframe");
}

async function waitForQingmaoHotelDetailText(frame: BrowserFrame, expectedHotelName: string, ratePlan: HotelRatePlanLabel = HOTEL_VALIDATION_RATE_PLAN) {
  let latestText = "";
  let lastStableKey = "";
  let stableCount = 0;
  for (let attempt = 0; attempt < 35; attempt += 1) {
    await frame.evaluate<boolean>(`(() => {
      window.scrollTo(0, Math.min(document.body.scrollHeight, 900));
      return true;
    })()`).catch(() => false);
    latestText = await frame.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
    const hasExpectedHotel = latestText.includes(expectedHotelName);
    const hasParsedRate = parseQingmaoHotelMainRatesText(latestText, ratePlan).some((rate) => rate.status === "available" && typeof rate.price === "number");
    const hasVisibleSignal = qingmaoHasVisibleRatePlanBlockSignal(latestText, ratePlan);
    const stableKey = buildHotelPageTextSummary(latestText, 800);
    stableCount = stableKey && stableKey === lastStableKey ? stableCount + 1 : 1;
    lastStableKey = stableKey;
    if (hasExpectedHotel && (hasParsedRate || hasVisibleSignal) && stableCount >= 2) {
      return latestText;
    }
    await frame.waitForTimeout(1_000);
  }

  return latestText;
}

async function clickQingmaoHotelDetailText(frame: BrowserFrame, text: string) {
  const textValue = JSON.stringify(text);
  return await frame.evaluate<boolean>(`(() => {
    const text = ${textValue};
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const targets = Array.from(document.querySelectorAll("*"))
      .filter((element) => isVisible(element) && (element.textContent || "").trim() === text);
    const target = targets[targets.length - 1];
    if (!target) return false;
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`);
}

async function filterQingmaoHotelMainRate(frame: BrowserFrame, expectedHotelName?: string, ratePlan: HotelRatePlanLabel = HOTEL_VALIDATION_RATE_PLAN) {
  await clickQingmaoHotelDetailText(frame, "含早餐");
  await frame.waitForTimeout(2_500);
  await clickQingmaoHotelDetailText(frame, "大床房");
  if (expectedHotelName) {
    await waitForQingmaoHotelDetailText(frame, expectedHotelName, ratePlan);
  } else {
    await frame.waitForTimeout(1_500);
  }
}

function hotelRatePlanBreakfastPattern(ratePlan: HotelRatePlanLabel) {
  if (ratePlan.endsWith("无早餐")) return /无早餐|无早/;
  return /含早餐|含早|1份早餐|单份早餐|单早|2份早餐|双份早餐|双早/;
}

function hotelRatePlanBreakfast(ratePlan: HotelRatePlanLabel): ZtripHotelRate["breakfast"] {
  return ratePlan.endsWith("无早餐") ? "无早餐" : "有早餐";
}

function hotelRatePlanBedType(ratePlan: HotelRatePlanLabel): "大床" | "双床" {
  return ratePlan.startsWith("双床") ? "双床" : "大床";
}

function hotelRatePlanBedPattern(ratePlan: HotelRatePlanLabel) {
  return hotelRatePlanBedType(ratePlan) === "双床" ? /双床/ : /大床/;
}

function hotelRatePlanEvidenceName(platform: PlatformName, ratePlan: HotelRatePlanLabel) {
  return `${platform}-酒店主口径${ratePlan}.png`;
}

function isLikelyHotelRoomHeader(line: string) {
  return /房/.test(line) && /大床|双床/.test(line) && !/[㎡米]|可住|早餐|取消|[￥¥]|CNY|在线预订|剩\d|查看更多价格/.test(line);
}

function boundedHotelRoomSnippet(lines: string[], startIndex: number, maxLines: number) {
  let endIndex = Math.min(lines.length, startIndex + maxLines);
  for (let index = startIndex + 1; index < endIndex; index += 1) {
    if (index > startIndex + 1 && isLikelyHotelRoomHeader(lines[index])) {
      endIndex = index;
      break;
    }
  }
  return lines.slice(startIndex, endIndex);
}

function buildPendingHotelQuote(platform: PlatformName, reason: string, candidate: QingmaoHotelCandidate | null, ratePlan: HotelRatePlanLabel = HOTEL_VALIDATION_RATE_PLAN): HotelMainRateQuote {
  return {
    platform,
    status: "pending",
    price: null,
    hotelName: candidate?.hotelName ?? "",
    roomType: "",
    ratePlan,
    error: reason
  };
}

function buildZtripHotelMainRateQuote(
  rate: ZtripHotelRate,
  page: BrowserPage,
  screenshotPath: string,
  candidate: QingmaoHotelCandidate,
  ratePlan: HotelRatePlanLabel = HOTEL_VALIDATION_RATE_PLAN
): HotelMainRateQuote {
  return {
    platform: "在途商旅",
    status: "available",
    price: rate.price,
    hotelName: candidate.hotelName,
    roomType: rate.roomType,
    ratePlan,
    finalUrl: page.url(),
    screenshotPath,
    rawText: rate.rawText
  };
}

function buildFailedHotelQuote(platform: PlatformName, reason: string, candidate: QingmaoHotelCandidate | null, ratePlan: HotelRatePlanLabel = HOTEL_VALIDATION_RATE_PLAN): HotelMainRateQuote {
  return {
    platform,
    status: "failed",
    price: null,
    hotelName: candidate?.hotelName ?? "",
    roomType: "",
    ratePlan,
    error: reason
  };
}

function ctripHotelDetailUrl(query: QingmaoHotelCandidateQuery, candidate: QingmaoHotelCandidate, hotelId: string) {
  const params = new URLSearchParams({
    corpLocale: "zh-CN",
    isInt: "0",
    corpPayType: "public",
    geoId: "32",
    geoCategoryName: query.city,
    geoCategoryId: "3",
    offset: "480",
    checkIn: query.checkInDate,
    checkOut: query.checkOutDate,
    isHMT: "false",
    roomQuantity: "1",
    adultQuantity: "1",
    hotelId,
    hotelIdStr: hotelId,
    hotelIdFrom: "sso",
    cityName: query.city,
    hotelName: candidate.hotelName,
    emergencyBook: "false",
    approvalSubNo: ""
  });

  return `https://ct.ctrip.com/corp-hotel-booking/hotelDetail?${params.toString()}`;
}

export const CTRIP_SEARCH_STATE_STALE_ERROR = "携程搜索参数未生效，仍停留旧页面";
export const CTRIP_LIST_NOT_LOADED_ERROR = "携程列表结果未加载完成";
export const CTRIP_LIST_TARGET_NOT_FOUND_ERROR = "携程列表未命中目标酒店候选";
export const CTRIP_SUGGESTION_NOT_SELECTED_ERROR = "携程酒店建议项未选中，未提交搜索";

interface CtripSuggestionSelectionResult {
  clicked: boolean;
  selected: boolean;
  text?: string;
}

export function buildCtripHotelSuggestionKeywords(candidate: QingmaoHotelCandidate) {
  return [candidate.hotelName];
}

export function canSubmitCtripHotelSearchAfterSuggestionSelection(selection: CtripSuggestionSelectionResult) {
  return selection.clicked && selection.selected;
}

export function shouldRetryCtripHotelSuggestionSelection(selection: CtripSuggestionSelectionResult, attempt: number, maxAttempts: number) {
  return !canSubmitCtripHotelSearchAfterSuggestionSelection(selection) && attempt < maxAttempts;
}

export function shouldUseCtripListKeywordFallback(query: QingmaoHotelCandidateQuery, finalUrl: string, bodyText: string) {
  return /\/corp-hotel-booking\/hotelList/i.test(finalUrl) && Boolean(validateStrictCtripHotelSearchState(query, finalUrl, bodyText));
}

export function buildStrictCtripHotelSearchUrl(query: QingmaoHotelCandidateQuery, keyword: string) {
  const geoId = ctripHotelCityIds[query.city];
  if (!geoId) {
    throw new Error(`未配置携程商旅酒店城市 ID：${query.city}`);
  }

  const params = new URLSearchParams({
    corpLocale: "zh-CN",
    isInt: "0",
    corpPayType: "public",
    geoId,
    geoCategoryName: query.city,
    geoCategoryId: "3",
    offset: "480",
    checkIn: query.checkInDate,
    checkOut: query.checkOutDate,
    isHMT: "false",
    moduleType: "KEYWORD",
    keyword
  });

  return `https://ct.ctrip.com/corp-hotel-booking/hotelList?${params.toString()}`;
}

export function validateStrictCtripHotelSearchState(query: QingmaoHotelCandidateQuery, finalUrl: string, bodyText: string) {
  const expectedCity = query.city.replace(/市$/, "");
  const expected = `${query.city} ${query.checkInDate} 至 ${query.checkOutDate}`;
  const mismatch = (actual: string) => `${CTRIP_SEARCH_STATE_STALE_ERROR}：期望 ${expected}，实际 ${actual}`;

  try {
    const parsed = new URL(finalUrl);
    const actualCity = parsed.searchParams.get("geoCategoryName") ?? parsed.searchParams.get("cityName");
    const actualCheckIn = parsed.searchParams.get("checkIn");
    const actualCheckOut = parsed.searchParams.get("checkOut");
    if (actualCity || actualCheckIn || actualCheckOut) {
      const cityMatched = !actualCity || actualCity.replace(/市$/, "") === expectedCity;
      const checkInMatched = !actualCheckIn || actualCheckIn === query.checkInDate;
      const checkOutMatched = !actualCheckOut || actualCheckOut === query.checkOutDate;
      if (!cityMatched || !checkInMatched || !checkOutMatched) {
        return mismatch(`${actualCity ?? "未知城市"} ${actualCheckIn ?? "未知入住日期"} 至 ${actualCheckOut ?? "未知离店日期"}`);
      }
      return null;
    }
  } catch {
    // Fall through to visible text validation.
  }

  const normalizedText = normalizeAddressForMatch(bodyText);
  const dateTokens = [query.checkInDate, query.checkOutDate].map((date) => {
    const [, month, day] = date.split("-");
    return [`${Number(month)}月${Number(day)}日`, `${month}-${day}`, date];
  });
  const cityMatched = !expectedCity || normalizedText.includes(expectedCity);
  const datesMatched = dateTokens.every((tokens) => tokens.some((token) => normalizedText.includes(token)));
  if (!cityMatched || !datesMatched) {
    return mismatch("页面内容未体现本轮城市或日期");
  }

  return null;
}

export function matchCtripHotelListCandidateText(candidate: QingmaoHotelCandidate, text: string) {
  const normalizedText = normalizeAddressForMatch(text);
  const doorPlate = extractHotelDoorPlate(candidate.address);
  const coreKeywords = buildCtripHotelCoreKeywords(candidate.hotelName).map(normalizeAddressForMatch);
  const hotelName = normalizeAddressForMatch(candidate.hotelName);
  const nameMatched = normalizedText.includes(hotelName) || coreKeywords.some((keyword) => keyword.length >= 2 && normalizedText.includes(keyword));
  const addressMatched = Boolean(doorPlate && normalizedText.includes(doorPlate));

  return {
    matched: nameMatched || addressMatched,
    strong: addressMatched || (nameMatched && Boolean(doorPlate && normalizedText.includes(doorPlate))),
    nameMatched,
    addressMatched
  };
}

export function classifyCtripHotelListReadiness(bodyText: string, candidate: QingmaoHotelCandidate) {
  if (/暂无|未找到|无搜索结果|没有找到|没有符合条件/.test(bodyText)) return "ready";
  if (matchCtripHotelListCandidateText(candidate, bodyText).matched) return "ready";
  if ((/[¥￥]\s*\d{2,5}|条点评|选择|推荐排序/.test(bodyText)) && /酒店|宾馆|如家|商旅/.test(bodyText)) return "ready";
  return "loading";
}

export function matchCtripHotelSuggestionText(candidate: QingmaoHotelCandidate, text: string) {
  const compactText = normalizeAddressForMatch(text);
  const hotelName = normalizeAddressForMatch(candidate.hotelName);
  if (!compactText.includes(hotelName)) return false;
  if (/筛选|位置区域|价格\/星级|推荐排序|差旅标准|清空|热门/.test(text)) return false;
  if (/关键词/.test(text) && !/搜索结果|中国-广东-广州/.test(text)) return false;
  return /搜索结果|中国-广东-广州|酒店/.test(text);
}

async function clickCtripHotelTab(page: BrowserPage) {
  await page.getByText("酒店", { exact: true }).first().click({ timeout: 10_000 });
  await page.waitForTimeout(1_000);
}

async function waitForCtripHotelKeywordInput(page: BrowserPage) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const count = await page.locator('input[placeholder="关键字/位置/品牌/酒店"]').count().catch(() => 0);
    if (count > 0) return;
    await page.waitForTimeout(1_000);
  }

  throw new Error("携程商旅酒店关键词输入框加载超时");
}

async function tryClickCtripHotelSuggestion(page: BrowserPage, query: QingmaoHotelCandidateQuery, candidate: QingmaoHotelCandidate) {
  const hotelValue = JSON.stringify(candidate.hotelName);
  const cityValue = JSON.stringify(query.city.replace(/市$/, ""));
  return page.evaluate<CtripSuggestionSelectionResult>(`(() => {
    const hotelName = ${hotelValue};
    const city = ${cityValue};
    const normalizeAddress = (value) => String(value || "").replace(/\\s+/g, "").replace(/[()（）,，。；;：:]/g, "");
    const isSuggestionText = (text) => {
      const compactText = normalizeAddress(text);
      const compactHotelName = normalizeAddress(hotelName);
      if (!compactText.includes(compactHotelName)) return false;
      if (/筛选|位置区域|价格\\/星级|推荐排序|差旅标准|清空|热门/.test(text)) return false;
      if (/关键词/.test(text) && !/搜索结果|中国-广东-广州/.test(text)) return false;
      return /搜索结果|中国-广东-广州|酒店/.test(text);
    };
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const input = Array.from(document.querySelectorAll('input[placeholder="关键字/位置/品牌/酒店"], input[placeholder*="关键字"]')).find(isVisible);
    const inputRect = input?.getBoundingClientRect?.();
    const normalizedHotelName = normalizeAddress(hotelName);
    const candidates = Array.from(document.querySelectorAll("*"))
      .map((element) => ({ element, text: (element.textContent || "").replace(/\\s+/g, " ").trim(), normalizedText: normalizeAddress(element.textContent || ""), rect: element.getBoundingClientRect() }))
      .filter(({ element, text }) => isVisible(element) && text)
      .filter(({ rect }) => !inputRect || (rect.top >= inputRect.bottom - 4 && rect.top <= inputRect.bottom + 360))
      .filter(({ text }) => text.length <= 300)
      .filter(({ text, normalizedText }) => {
        if (isSuggestionText(text)) return true;
        if (text === hotelName || normalizedText === normalizedHotelName) return true;
        return normalizedHotelName.length >= 8 && normalizedText.includes(normalizedHotelName) && (!city || normalizedText.includes(city));
      });
    const best = candidates
      .sort((left, right) => left.text.length - right.text.length)[0];
    const target = best?.element;
    if (!target) return { clicked: false, selected: false };
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return { clicked: true, selected: Boolean(best && isSuggestionText(best.text)), text: best?.text?.slice(0, 200) };
  })()`);
}

async function waitForCtripHotelList(page: BrowserPage) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const bodyText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
    if (page.url().includes("/corp-hotel-booking/hotelList") || /酒店积分|推荐排序|位置区域|价格\/星级/.test(bodyText)) return;
    await page.waitForTimeout(1_000);
  }

  throw new Error("携程商旅酒店列表页加载超时");
}

async function clickCtripHotelListSearchButton(page: BrowserPage) {
  const clicked = await page.evaluate<boolean>(`(() => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const input = Array.from(document.querySelectorAll('input[placeholder="关键字/位置/品牌/酒店"], input[placeholder*="关键字"]')).find(isVisible);
    const inputRect = input?.getBoundingClientRect?.();
    const buttons = Array.from(document.querySelectorAll("button,[role='button'],.ant-btn,.btn"))
      .filter(isVisible)
      .map((element) => ({ element, text: (element.textContent || "").replace(/\\s+/g, " ").trim(), rect: element.getBoundingClientRect() }));
    const target = buttons.find(({ text }) => /搜索/.test(text))
      ?? buttons.find(({ rect }) => inputRect && rect.left >= inputRect.right - 8 && Math.abs((rect.top + rect.bottom) / 2 - (inputRect.top + inputRect.bottom) / 2) <= 80)
      ?? null;
    if (!target) return false;
    target.element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    target.element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    target.element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`);
  if (!clicked) {
    throw new Error("携程列表页搜索按钮未找到");
  }
}

async function retryCtripHotelSearchFromListKeywordBar(page: BrowserPage, query: QingmaoHotelCandidateQuery, candidate: QingmaoHotelCandidate, keyword: string): Promise<CtripSingleHotelTrace> {
  await waitForCtripHotelKeywordInput(page);
  const keywordInput = page.locator('input[placeholder="关键字/位置/品牌/酒店"]').first();
  let selection: CtripSuggestionSelectionResult = { clicked: false, selected: false };

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await keywordInput.click({ timeout: 8_000 });
    await keywordInput.fill("");
    await page.waitForTimeout(200);
    await keywordInput.fill(keyword);
    await page.waitForTimeout(1_000);
    selection = await tryClickCtripHotelSuggestion(page, query, candidate).catch(() => ({ clicked: false, selected: false }));
    if (canSubmitCtripHotelSearchAfterSuggestionSelection(selection)) break;
    if (!shouldRetryCtripHotelSuggestionSelection(selection, attempt, 3)) break;
    await keywordInput.click({ timeout: 8_000 }).catch(() => undefined);
    await keywordInput.fill("").catch(() => undefined);
    await page.waitForTimeout(500);
  }

  if (!canSubmitCtripHotelSearchAfterSuggestionSelection(selection)) {
    throw new Error(CTRIP_SUGGESTION_NOT_SELECTED_ERROR);
  }

  await page.waitForTimeout(500);
  await clickCtripHotelListSearchButton(page);
  await waitForCtripHotelList(page);
  await page.waitForTimeout(1_000);
  const hotelIdResult = extractCtripHotelIdWithSourceFromUrl(page.url());
  return {
    ctripSearchKeywordUsed: keyword,
    ctripFinalUrl: page.url(),
    ctripExtractedHotelId: hotelIdResult?.hotelId,
    ctripHotelIdSource: hotelIdResult?.source
  };
}

async function resolveCtripHotelIdFromSearchSuggestion(
  page: BrowserPage,
  query: QingmaoHotelCandidateQuery,
  candidate: QingmaoHotelCandidate,
  keyword: string
): Promise<CtripSingleHotelTrace | null> {
  await page.goto("https://ct.ctrip.com/online/home", { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(2_000);
  await clickCtripHotelTab(page);
  await waitForCtripHotelKeywordInput(page);
  const keywordInput = page.locator('input[placeholder="关键字/位置/品牌/酒店"]').first();

  let selection: CtripSuggestionSelectionResult = { clicked: false, selected: false };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await keywordInput.click({ timeout: 8_000 });
    await keywordInput.fill("");
    await page.waitForTimeout(200);
    await keywordInput.fill(keyword);
    await page.waitForTimeout(1_000);
    selection = await tryClickCtripHotelSuggestion(page, query, candidate).catch(() => ({ clicked: false, selected: false }));
    if (canSubmitCtripHotelSearchAfterSuggestionSelection(selection)) break;
    await keywordInput.click({ timeout: 8_000 }).catch(() => undefined);
    await keywordInput.fill("").catch(() => undefined);
    await page.waitForTimeout(500);
  }
  if (!canSubmitCtripHotelSearchAfterSuggestionSelection(selection)) return null;

  await page.waitForTimeout(800);
  await clickVisibleText(page, "因公出行").catch(() => undefined);
  await waitForCtripHotelList(page).catch(() => undefined);
  await page.waitForTimeout(1_000);
  const hotelIdResult = extractCtripHotelIdWithSourceFromUrl(page.url());

  return {
    ctripSearchKeywordUsed: keyword,
    ctripFinalUrl: page.url(),
    ctripExtractedHotelId: hotelIdResult?.hotelId,
    ctripHotelIdSource: hotelIdResult?.source
  };
}

async function clickMatchingCtripHotelFromList(page: BrowserPage, _query: QingmaoHotelCandidateQuery, candidate: QingmaoHotelCandidate) {
  const candidateValue = JSON.stringify(candidate.hotelName);
  const doorPlateValue = JSON.stringify(extractHotelDoorPlate(candidate.address) ?? "");
  const coreKeywordsValue = JSON.stringify(buildCtripHotelCoreKeywords(candidate.hotelName));
  const result = await page.evaluate<{ clicked: boolean; reason: string; text: string }>(`(() => {
    const candidateName = ${candidateValue};
    const doorPlate = ${doorPlateValue};
    const coreKeywords = ${coreKeywordsValue};
    const normalizeAddress = (value) => String(value || "").replace(/\\s+/g, "").replace(/[()（）,，。；;：:]/g, "");
    const normalizeName = (value) => String(value || "")
      .replace(/\([^)]*?\)|（[^）]*?）/g, (match) => match.replace(/[()（）]/g, ""))
      .replace(/金标|酒店|如家|商旅|广州|地铁站|店|分店|旗舰|协议|可开专票/g, "")
      .replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "")
      .trim();
    const lcs = (left, right) => {
      let best = 0;
      const dp = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
      for (let i = 1; i <= left.length; i += 1) {
        for (let j = 1; j <= right.length; j += 1) {
          if (left[i - 1] === right[j - 1]) {
            dp[i][j] = dp[i - 1][j - 1] + 1;
            best = Math.max(best, dp[i][j]);
          }
        }
      }
      return best;
    };
    const score = (targetName) => {
      const source = normalizeName(candidateName);
      const target = normalizeName(targetName);
      if (!source || !target) return 0;
      if (source.includes(target) || target.includes(source)) return Math.min(source.length, target.length);
      return lcs(source, target);
    };
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const all = Array.from(document.querySelectorAll("a,button,[role='button'],div,li,section,article"))
      .filter(isVisible)
      .map((element) => {
        const text = (element.textContent || "").replace(/\\s+/g, " ").trim();
        const normalizedText = normalizeAddress(text);
        const addressMatched = Boolean(doorPlate && normalizedText.includes(doorPlate));
        const coreMatched = coreKeywords.some((keyword) => keyword && normalizedText.includes(normalizeAddress(keyword)));
        return { element, text, addressMatched, coreMatched, nameScore: score(text) };
      })
      .filter((item) => item.text.length >= 8 && item.text.length <= 800);
    const best = all
      .filter((item) => item.addressMatched || item.coreMatched || item.nameScore >= 6)
      .sort((left, right) => Number(right.addressMatched) - Number(left.addressMatched) || Number(right.coreMatched) - Number(left.coreMatched) || right.nameScore - left.nameScore || left.text.length - right.text.length)[0];
    if (!best) return { clicked: false, reason: "no-target-candidate", text: "" };
    const clickTarget = Array.from(best.element.querySelectorAll("button,[role='button'],a,div,span"))
      .filter(isVisible)
      .find((element) => /选择|查看详情|预订/.test((element.textContent || "").trim()))
      || best.element.closest("a,button,[role='button']")
      || best.element;
    clickTarget.scrollIntoView({ block: "center" });
    clickTarget.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    clickTarget.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    clickTarget.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return { clicked: true, reason: best.addressMatched ? "address" : "strong-name", text: best.text.slice(0, 200) };
  })()`);

  if (!result.clicked) {
    throw new Error(`${CTRIP_LIST_TARGET_NOT_FOUND_ERROR}：${candidate.hotelName}`);
  }
}

async function waitForStrictCtripHotelList(page: BrowserPage, candidate: QingmaoHotelCandidate) {
  let latestText = "";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    latestText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => latestText);
    if (classifyCtripHotelListReadiness(latestText, candidate) === "ready") return latestText;
    await page.waitForTimeout(1_000);
  }

  throw new Error(CTRIP_LIST_NOT_LOADED_ERROR);
}

async function openCtripHotelListByKeyword(page: BrowserPage, query: QingmaoHotelCandidateQuery, candidate: QingmaoHotelCandidate, keyword: string) {
  await page.goto("https://ct.ctrip.com/online/home", { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(3_000);
  await clickCtripHotelTab(page);
  await waitForCtripHotelKeywordInput(page);
  const keywordInput = page.locator('input[placeholder="关键字/位置/品牌/酒店"]').first();
  await keywordInput.click({ timeout: 8_000 });
  await keywordInput.fill(keyword);
  await page.waitForTimeout(1_500);
  await tryClickCtripHotelSuggestion(page, query, candidate);
  await page.waitForTimeout(800);
  await clickVisibleText(page, "因公出行");
  await waitForCtripHotelList(page);
}

async function openCtripHotelDetailByHotel(page: BrowserPage, query: QingmaoHotelCandidateQuery, candidate: QingmaoHotelCandidate) {
  let lastError = "";

  for (const keyword of buildCtripHotelSearchKeywords(candidate)) {
    try {
      await openCtripHotelListByKeyword(page, query, candidate, keyword);
      let hotelId = extractCtripHotelIdFromUrl(page.url());
      if (!hotelId || !isSameHotelByCityAndDoorPlate(query.city, candidate.address, await page.locator("body").innerText({ timeout: 3_000 }).catch(() => ""))) {
        await clickMatchingCtripHotelFromList(page, query, candidate);
        await page.waitForTimeout(1_500);
        hotelId = extractCtripHotelIdFromUrl(page.url());
      }
      if (!hotelId) {
        throw new Error("携程商旅酒店列表页未解析到 hotelId");
      }

      await page.goto(ctripHotelDetailUrl(query, candidate, hotelId), { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForLoadState?.("networkidle", { timeout: 15_000 }).catch(() => undefined);
      const bodyText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
      if (!isSameHotelByCityAndDoorPlate(query.city, candidate.address, bodyText) && scoreHotelNameMatch(candidate.hotelName, bodyText) < 6) {
        throw new Error(`携程商旅同店校验失败：未匹配到同城市同门牌号 ${query.city} ${extractHotelDoorPlate(candidate.address) ?? candidate.address}`);
      }
      return;
    } catch (error) {
      lastError = `${keyword}: ${errorMessage(error)}`;
    }
  }

  throw new Error(lastError || `携程商旅未找到同酒店：${candidate.hotelName}`);
}

interface CtripSingleHotelTrace {
  ctripHotelIdSource?: string;
  ctripExtractedHotelId?: string;
  ctripFinalUrl?: string;
  ctripSearchKeywordUsed?: string;
}

async function openCtripHotelDetailByHotelForSingleDiagnosis(page: BrowserPage, query: QingmaoHotelCandidateQuery, candidate: QingmaoHotelCandidate): Promise<CtripSingleHotelTrace> {
  let lastError = "";
  let latestTrace: CtripSingleHotelTrace = {};

  for (const keyword of buildCtripHotelSuggestionKeywords(candidate)) {
    try {
      latestTrace = { ctripSearchKeywordUsed: keyword };
      const suggestionTrace = await resolveCtripHotelIdFromSearchSuggestion(page, query, candidate, keyword);
      if (suggestionTrace) {
        latestTrace = suggestionTrace;
        if (suggestionTrace.ctripExtractedHotelId) {
          await page.goto(ctripHotelDetailUrl(query, candidate, suggestionTrace.ctripExtractedHotelId), { waitUntil: "domcontentloaded", timeout: 45_000 });
          await page.waitForLoadState?.("networkidle", { timeout: 15_000 }).catch(() => undefined);
          latestTrace.ctripFinalUrl = page.url();
        }

        let detailText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
        if (!page.url().includes("/corp-hotel-booking/hotelDetail") && !isSameHotelByCityAndDoorPlate(query.city, candidate.address, detailText)) {
          detailText = await waitForStrictCtripHotelList(page, candidate);
          await clickMatchingCtripHotelFromList(page, query, candidate);
          await page.waitForTimeout(1_500);
          const hotelIdResult = extractCtripHotelIdWithSourceFromUrl(page.url());
          latestTrace = {
            ...latestTrace,
            ctripFinalUrl: page.url(),
            ctripExtractedHotelId: latestTrace.ctripExtractedHotelId ?? hotelIdResult?.hotelId,
            ctripHotelIdSource: latestTrace.ctripHotelIdSource ?? hotelIdResult?.source
          };
          if (hotelIdResult?.hotelId) {
            await page.goto(ctripHotelDetailUrl(query, candidate, hotelIdResult.hotelId), { waitUntil: "domcontentloaded", timeout: 45_000 });
            await page.waitForLoadState?.("networkidle", { timeout: 15_000 }).catch(() => undefined);
            latestTrace.ctripFinalUrl = page.url();
          }
        }

        detailText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
        const detailStaleReason = validateStrictCtripHotelSearchState(query, page.url(), detailText);
        if (detailStaleReason) {
          if (!shouldUseCtripListKeywordFallback(query, page.url(), detailText)) {
            throw new Error(detailStaleReason);
          }
          latestTrace = {
            ...latestTrace,
            ...(await retryCtripHotelSearchFromListKeywordBar(page, query, candidate, keyword))
          };
          detailText = await waitForStrictCtripHotelList(page, candidate);
          const fallbackStaleReason = validateStrictCtripHotelSearchState(query, page.url(), detailText);
          if (fallbackStaleReason) {
            throw new Error(fallbackStaleReason);
          }
          if (!page.url().includes("/corp-hotel-booking/hotelDetail") && !isSameHotelByCityAndDoorPlate(query.city, candidate.address, detailText)) {
            await clickMatchingCtripHotelFromList(page, query, candidate);
            await page.waitForTimeout(1_500);
          }
          const hotelIdResult = extractCtripHotelIdWithSourceFromUrl(page.url());
          latestTrace = {
            ...latestTrace,
            ctripFinalUrl: page.url(),
            ctripExtractedHotelId: latestTrace.ctripExtractedHotelId ?? hotelIdResult?.hotelId,
            ctripHotelIdSource: latestTrace.ctripHotelIdSource ?? hotelIdResult?.source
          };
          if (hotelIdResult?.hotelId) {
            await page.goto(ctripHotelDetailUrl(query, candidate, hotelIdResult.hotelId), { waitUntil: "domcontentloaded", timeout: 45_000 });
            await page.waitForLoadState?.("networkidle", { timeout: 15_000 }).catch(() => undefined);
            latestTrace.ctripFinalUrl = page.url();
          }
          detailText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
        }
        if (isSameHotelByCityAndDoorPlate(query.city, candidate.address, detailText)) {
          return latestTrace;
        }
      }
      throw new Error(CTRIP_SUGGESTION_NOT_SELECTED_ERROR);
    } catch (error) {
      lastError = `${keyword}: ${errorMessage(error)}`;
    }
  }

  const error = new Error(lastError || `携程商旅未找到同酒店：${candidate.hotelName}`) as Error & { ctripTrace?: CtripSingleHotelTrace };
  error.ctripTrace = latestTrace;
  throw error;
}

async function waitForCtripHotelDetailRooms(page: BrowserPage) {
  for (let attempt = 0; attempt < 35; attempt += 1) {
    const bodyText = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
    if (/房间|床型|早餐/.test(bodyText) && /¥\s*\d{2,5}/.test(bodyText) && /大床/.test(bodyText)) {
      return bodyText;
    }
    await page.waitForTimeout(1_000);
  }

  throw new Error("携程商旅酒店详情房型加载超时");
}

async function searchCtripHotelMainRateQuote(
  context: BrowserContext,
  artifactDir: string,
  query: QingmaoHotelCandidateQuery,
  candidate: QingmaoHotelCandidate,
  ratePlan: HotelRatePlanLabel = HOTEL_VALIDATION_RATE_PLAN
): Promise<HotelMainRateQuote> {
  const page = await context.newPage();
  const startedAt = Date.now();

  try {
    await openCtripHotelDetailByHotel(page, query, candidate);
    const bodyText = await waitForCtripHotelDetailRooms(page);
    const rates = parseCtripHotelMainRatesText(bodyText, ratePlan);
    const selectedRate = rates.find((rate) => rate.status === "available" && typeof rate.price === "number") ?? null;
    const screenshotPath = path.join(artifactDir, hotelRatePlanEvidenceName("携程商旅", ratePlan));
    const evidencePath = await savePageEvidence(page, screenshotPath, {
      platform: "携程商旅",
      finalUrl: page.url(),
      bodyText,
      price: selectedRate?.price ?? null,
      rawText: selectedRate?.rawText
    });

    if (!selectedRate) {
      return {
        platform: "携程商旅",
        status: "not-found",
        price: null,
        hotelName: candidate.hotelName,
        roomType: "",
        ratePlan,
        finalUrl: page.url(),
        screenshotPath: evidencePath,
        durationMs: Date.now() - startedAt,
        error: `携程商旅同酒店详情页未解析到${ratePlan}价格`
      };
    }

    return {
      ...selectedRate,
      finalUrl: page.url(),
      screenshotPath: evidencePath,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      ...buildFailedHotelQuote("携程商旅", errorMessage(error), candidate, ratePlan),
      durationMs: Date.now() - startedAt
    };
  }
}

async function createAliHotelItineraryNo(context: BrowserContext, page: BrowserPage) {
  const bookUser = await readAliBookUser(page);
  const identity = await readAliIdentityParams(page);
  const userId = bookUser.userId || identity.userId;
  const name = bookUser.realName || bookUser.userName;

  if (!userId || !name) {
    throw new Error("阿里商旅缺少入住人信息，无法生成酒店行程单号");
  }

  const extParam = JSON.stringify({
    spm: "",
    itineraryEntry: false,
    pcHomePage: "true",
    pcHomeParams: JSON.stringify({ dingAppId: "1692", source: "pc" })
  });
  const response = await callAliMtopRaw(context, page, "mtop.alitrip.btriphome.pre.select.save", {
    category: "hotel",
    itineraryNo: "",
    bookUsers: JSON.stringify([{ realName: name, userName: name, userId, userType: 1 }]),
    fromComponent: true,
    extParam
  });
  const itineraryNo = parseAliItineraryNoFromPreSaveText(JSON.stringify(response));

  if (!itineraryNo) {
    throw new Error("阿里商旅未返回酒店行程单号");
  }

  return itineraryNo;
}

async function openAliHotelList(
  context: BrowserContext,
  page: BrowserPage,
  query: QingmaoHotelCandidateQuery,
  keyword: string
) {
  const identity = await readAliIdentityParams(page);
  const bookUser = await readAliBookUser(page);
  const cityCode = aliHotelCityCodes[query.city];
  if (!cityCode) {
    throw new Error(`阿里商旅暂未配置酒店城市代码：${query.city}`);
  }
  if (!identity.corpId || !identity.userId) {
    throw new Error("阿里商旅酒店查询缺少企业或用户参数");
  }

  const itineraryId = await createAliHotelItineraryNo(context, page);
  const staffId = bookUser.userId || identity.userId;
  const params = new URLSearchParams({
    spm: "181",
    corpId: identity.corpId,
    ttid: "12ali0000603",
    ihotelTab: "false",
    keyWords: keyword,
    isMultiRoom: "true",
    roomNumber: "1",
    cityCode,
    source: "pc",
    dingUserId: identity.userId,
    dingAppId: "1692",
    checkInStaffId: staffId,
    checkIn: query.checkInDate,
    cityName: query.city,
    itineraryId,
    checkOut: query.checkOutDate,
    ihotelAvailable: "true"
  });

  await page.goto(`https://travel.alibtrip.com/hotel-demeter?${params.toString()}#/list`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(6_000);
}

async function writeAliHotelListDiagnosis(artifactDir: string | undefined, traces: AliHotelKeywordTrace[]) {
  if (!artifactDir) return;
  await fsp.mkdir(artifactDir, { recursive: true }).catch(() => undefined);
  await fsp.writeFile(
    path.join(artifactDir, "alibtrip-list-diagnosis.json"),
    JSON.stringify({ selector: ALI_HOTEL_LIST_CARD_SELECTOR, traces }, null, 2),
    "utf8"
  ).catch(() => undefined);
}

function aliHotelKeywordScreenshotPath(artifactDir: string | undefined, keywordIndex: number, kind: "list" | "detail", candidateRank?: number) {
  if (!artifactDir) return "";
  const rankSuffix = kind === "detail" && candidateRank ? `-${String(candidateRank).padStart(2, "0")}` : "";
  return path.join(artifactDir, `alibtrip-keyword-${String(keywordIndex).padStart(2, "0")}-${kind}${rankSuffix}.png`);
}

async function clickAliHotelDetailCandidateCard(page: BrowserPage, detailCandidate: AliHotelDetailCandidateTrace) {
  await page.evaluate(`(() => {
    const scrollingElement = document.scrollingElement || document.documentElement || document.body;
    scrollingElement.scrollTo({ top: 0, behavior: "instant" });
  })()`).catch(() => undefined);
  await page.waitForTimeout(500);

  for (let screenIndex = 0; screenIndex < 8; screenIndex += 1) {
    const clicked = await page.evaluate<boolean>(`((targetText) => {
      const selector = ${JSON.stringify(ALI_HOTEL_LIST_CARD_SELECTOR)};
      const normalize = (value) => String(value || "").replace(/\\s+/g, "");
      const expected = normalize(targetText);
      const cards = Array.from(document.querySelectorAll(selector));
      const target = cards.find((card) => {
        const text = normalize(card.textContent || "");
        return text === expected || text.includes(expected) || (text.length > 20 && expected.includes(text));
      });
      if (!target) return false;
      target.scrollIntoView({ block: "center" });
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    })(${JSON.stringify(detailCandidate.cardText)})`);
    if (clicked) return true;
    await scrollAliHotelListPage(page);
    await page.waitForTimeout(500);
  }

  return false;
}

async function clickMatchingAliHotelCard(
  context: BrowserContext,
  page: BrowserPage,
  query: QingmaoHotelCandidateQuery,
  candidate: QingmaoHotelCandidate,
  trace?: { keyword: string; keywordMode?: AliHotelSearchKeywordPlanItem["mode"]; traces: AliHotelKeywordTrace[]; artifactDir?: string },
  collectOptions: { maxScreens?: number; maxCards?: number; maxDurationMs?: number } = {}
) {
  const seenDetailPages = new Set(
    context.pages()
      .filter((candidatePage) => candidatePage.url().includes("hotel-demeter") && candidatePage.url().includes("#/detail"))
  );
  const selection = await collectAliHotelListCardsForMatching(page, candidate, query.city, collectOptions);
  const keywordIndex = trace ? trace.traces.length + 1 : 0;
  const listScreenshotPath = aliHotelKeywordScreenshotPath(trace?.artifactDir, keywordIndex, "list");
  if (listScreenshotPath) {
    await savePageScreenshot(page, listScreenshotPath).catch(() => false);
  }
  const keywordTrace: AliHotelKeywordTrace | null = trace ? {
    ...selection,
    keyword: trace.keyword,
    keywordMode: trace.keywordMode,
    brandFallback: trace.keywordMode === "brand-fallback",
    finalUrl: page.url(),
    listScreenshotPath: listScreenshotPath || undefined,
    selectedAsCandidate: selection.detailCandidates.length > 0,
    clickedDetail: false
  } : null;
  if (trace && keywordTrace) {
    trace.traces.push(keywordTrace);
    await writeAliHotelListDiagnosis(trace.artifactDir, trace.traces);
  }

  if (selection.detailCandidates.length === 0) {
    throw new Error(selection.failureReason || `阿里商旅未找到同城市同门牌号候选：${candidate.hotelName}`);
  }

  for (const detailCandidate of selection.detailCandidates) {
    const matchedCard = selection.cards.find((card) => card.index === detailCandidate.cardIndex && card.text === detailCandidate.cardText) ?? null;
    if (!matchedCard) {
      detailCandidate.failureReason = "阿里候选卡片已消失，无法点击详情";
      continue;
    }

    const clicked = await clickAliHotelDetailCandidateCard(page, detailCandidate);
    if (!clicked) {
      detailCandidate.failureReason = "阿里候选卡片已消失，无法点击详情";
      if (trace) await writeAliHotelListDiagnosis(trace.artifactDir, trace.traces);
      continue;
    }
    detailCandidate.clickedDetail = true;
    if (trace && keywordTrace) {
      keywordTrace.clickedDetail = true;
      await writeAliHotelListDiagnosis(trace.artifactDir, trace.traces);
    }

    let openedDetailPage: BrowserPage | null = null;
    let openedDetailText = "";
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const detailPages = context.pages().filter((candidatePage) => candidatePage.url().includes("hotel-demeter") && candidatePage.url().includes("#/detail"));
      for (const detailPage of detailPages) {
        if (seenDetailPages.has(detailPage)) continue;
        const bodyText = await detailPage.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
        if (/酒店详情|预订/.test(bodyText) || scoreHotelNameMatch(candidate.hotelName, bodyText) >= 5) {
          seenDetailPages.add(detailPage);
          openedDetailPage = detailPage;
          openedDetailText = bodyText;
          break;
        }
      }
      if (openedDetailPage) break;
      await page.waitForTimeout(1_000);
    }

    if (!openedDetailPage) {
      detailCandidate.failureReason = `阿里商旅点击第${detailCandidate.rank}候选后详情页加载超时：${detailCandidate.listMatchReason}`;
      if (trace) await writeAliHotelListDiagnosis(trace.artifactDir, trace.traces);
      continue;
    }

    openedDetailText = await waitForAliHotelDetailIdentityText(openedDetailPage, query, candidate, openedDetailText);
    const detailScreenshotPath = aliHotelKeywordScreenshotPath(trace?.artifactDir, keywordIndex, "detail", detailCandidate.rank);
    if (detailScreenshotPath) {
      await savePageScreenshot(openedDetailPage, detailScreenshotPath).catch(() => false);
      detailCandidate.detailScreenshotPath = detailScreenshotPath;
    }
    const detail = confirmAliHotelDetailDoorPlate(query.city, candidate, openedDetailText);
    applyAliHotelDetailDiagnosisToCandidateTrace(detailCandidate, openedDetailPage.url(), detail);
    if (trace && keywordTrace) {
      keywordTrace.finalUrl = openedDetailPage.url();
      keywordTrace.detailScreenshotPath = detailCandidate.detailScreenshotPath;
      applyAliHotelDetailDiagnosisToTrace(keywordTrace, openedDetailPage.url(), detail);
      await writeAliHotelListDiagnosis(trace.artifactDir, trace.traces);
    }

    if (detail.sameHotel) {
      return { detailPage: openedDetailPage, listMatch: matchedCard.match, keywordTrace };
    }

    await openedDetailPage.close?.({ runBeforeUnload: false }).catch(() => undefined);
  }

  throw new Error(formatAliHotelDetailCandidateFailure(selection.detailCandidates));
}

async function waitForAliHotelDetailIdentityText(
  page: BrowserPage,
  query: QingmaoHotelCandidateQuery,
  candidate: QingmaoHotelCandidate,
  initialText = ""
) {
  let bodyText = initialText;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const detail = confirmAliHotelDetailDoorPlate(query.city, candidate, bodyText);
    if (detail.detailDoorNumber || (/酒店详情|预订/.test(bodyText) && scoreHotelNameMatch(candidate.hotelName, bodyText) >= 5 && attempt >= 2)) {
      return bodyText;
    }
    await page.waitForTimeout(500);
    bodyText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => bodyText);
  }
  return bodyText;
}

async function waitForAliHotelDetailRooms(page: BrowserPage) {
  for (let attempt = 0; attempt < 35; attempt += 1) {
    const bodyText = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
    if (/酒店详情|预订/.test(bodyText) && /早餐/.test(bodyText) && /[￥¥]\s*\d{2,5}/.test(bodyText)) {
      return bodyText;
    }
    await page.waitForTimeout(1_000);
  }

  throw new Error("阿里商旅酒店详情房型加载超时");
}

async function searchAliHotelMainRateQuote(
  context: BrowserContext,
  artifactDir: string,
  query: QingmaoHotelCandidateQuery,
  candidate: QingmaoHotelCandidate,
  ratePlan: HotelRatePlanLabel = HOTEL_VALIDATION_RATE_PLAN
): Promise<HotelMainRateQuote> {
  const page = await context.newPage();
  const startedAt = Date.now();

  try {
    await page.goto("https://travel.alibtrip.com/index.html#/hotel", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(3_000);
    let lastError = "";
    let detailPage: BrowserPage | null = null;
    let bodyText = "";
    for (const keywordPlan of buildAliHotelSearchKeywordPlan(query, candidate)) {
      try {
        await openAliHotelList(context, page, query, keywordPlan.keyword);
        const aliSelection = await clickMatchingAliHotelCard(context, page, query, candidate, undefined, keywordPlan);
        detailPage = aliSelection.detailPage;
        bodyText = await waitForAliHotelDetailRooms(detailPage);
        const match = confirmAliHotelDetailDoorPlate(query.city, candidate, bodyText);
        if (!match.sameHotel) {
          throw new Error(match.failureReason || match.matchBasis);
        }
        lastError = "";
        break;
      } catch (error) {
        lastError = errorMessage(error);
        if (detailPage && typeof detailPage.close === "function") {
          await detailPage.close({ runBeforeUnload: false }).catch(() => undefined);
        }
        detailPage = null;
        bodyText = "";
      }
    }
    if (lastError) {
      throw new Error(lastError);
    }
    if (!detailPage) {
      throw new Error("阿里商旅同酒店详情页未打开");
    }

    const rates = parseAliHotelMainRatesText(bodyText, ratePlan);
    const selectedRate = rates.find((rate) => rate.status === "available" && typeof rate.price === "number") ?? null;
    const screenshotPath = path.join(artifactDir, hotelRatePlanEvidenceName("阿里商旅", ratePlan));
    const evidencePath = await savePageEvidence(detailPage, screenshotPath, {
      platform: "阿里商旅",
      finalUrl: detailPage.url(),
      bodyText,
      price: selectedRate?.price ?? null,
      rawText: selectedRate?.rawText
    });

    if (!selectedRate) {
      return {
        platform: "阿里商旅",
        status: "not-found",
        price: null,
        hotelName: candidate.hotelName,
        roomType: "",
        ratePlan,
        finalUrl: detailPage.url(),
        screenshotPath: evidencePath,
        durationMs: Date.now() - startedAt,
        error: `阿里商旅同酒店详情页未解析到${ratePlan}价格`
      };
    }

    return {
      ...selectedRate,
      finalUrl: detailPage.url(),
      screenshotPath: evidencePath,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      ...buildFailedHotelQuote("阿里商旅", errorMessage(error), candidate, ratePlan),
      durationMs: Date.now() - startedAt
    };
  }
}

async function searchZtripHotelMainRateQuote(
  context: BrowserContext,
  artifactDir: string,
  query: ZtripHotelQuery,
  candidate: QingmaoHotelCandidate,
  ratePlan: HotelRatePlanLabel = HOTEL_VALIDATION_RATE_PLAN
): Promise<HotelMainRateQuote> {
  const page = await context.newPage();
  const startedAt = Date.now();

  try {
    await openZtripHotelSearchResultByHotel(page, query, candidate.hotelName);
    await filterZtripHotelRatePlan(page, ratePlan);
    await expandZtripRoomCards(page);
    const bodyText = await page.locator("body").innerText({ timeout: 8_000 }).catch(() => "");
    const rates = parseZtripHotelRatesTextForRatePlan(bodyText, ratePlan);
    const selectedRate = rates
      .filter((rate) => rate.bedType === hotelRatePlanBedType(ratePlan) && rate.breakfast === hotelRatePlanBreakfast(ratePlan) && typeof rate.price === "number")
      .sort((left, right) => (left.price ?? Number.MAX_SAFE_INTEGER) - (right.price ?? Number.MAX_SAFE_INTEGER))[0] ?? null;
    const screenshotPath = path.join(artifactDir, hotelRatePlanEvidenceName("在途商旅", ratePlan));
    const evidencePath = await savePageEvidence(page, screenshotPath, {
      platform: "在途商旅",
      finalUrl: page.url(),
      bodyText,
      price: selectedRate?.price ?? null,
      rawText: selectedRate?.rawText
    });

    if (!selectedRate) {
      return {
        platform: "在途商旅",
        status: "not-found",
        price: null,
        hotelName: candidate.hotelName,
        roomType: "",
        ratePlan,
        finalUrl: page.url(),
        screenshotPath: evidencePath,
        durationMs: Date.now() - startedAt,
        error: `在途商旅同酒店详情页未解析到${ratePlan}价格`
      };
    }

    return {
      ...buildZtripHotelMainRateQuote(selectedRate, page, evidencePath, candidate, ratePlan),
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      ...buildFailedHotelQuote("在途商旅", errorMessage(error), candidate, ratePlan),
      durationMs: Date.now() - startedAt
    };
  }
}

const HOTEL_SINGLE_DIAGNOSIS_PLATFORMS: PlatformName[] = ["青猫差旅", "携程商旅", "阿里商旅", "在途商旅"];

function hotelSingleDiagnosisQueryFromInput(input: HotelSingleDiagnosisInput): QingmaoHotelCandidateQuery {
  const checkIn = new Date(`${input.checkInDate}T00:00:00`);
  const checkOut = new Date(`${input.checkOutDate}T00:00:00`);
  const nights = Number.isFinite(checkIn.getTime()) && Number.isFinite(checkOut.getTime())
    ? Math.max(1, Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000))
    : 1;

  return {
    city: input.city,
    keyword: input.keyword,
    checkInDate: input.checkInDate,
    checkOutDate: input.checkOutDate,
    nights
  };
}

function aliHotelSingleVerifyQueryFromInput(input: AliHotelSingleVerifyInput): QingmaoHotelCandidateQuery {
  return hotelSingleDiagnosisQueryFromInput({
    city: input.city,
    keyword: input.hotelName,
    checkInDate: input.checkInDate,
    checkOutDate: input.checkOutDate,
    ratePlan: input.ratePlan
  });
}

function aliHotelSingleVerifyCandidateFromInput(input: AliHotelSingleVerifyInput): QingmaoHotelCandidate {
  return {
    hotelName: input.hotelName,
    level: "",
    score: "",
    area: input.city,
    address: input.address,
    price: null,
    rawText: `${input.hotelName} ${input.address}`
  };
}

function emptyHotelCalibrationOtherRates(): HotelCalibrationOtherRates {
  return {
    大床无早餐: null,
    双床有早餐: null,
    双床无早餐: null
  };
}

export function buildHotelPageTextSummary(rawText: string, maxLength = 360) {
  const summary = rawText.replace(/\s+/g, " ").trim();
  return summary.length > maxLength ? `${summary.slice(0, maxLength)}...` : summary;
}

export function classifyHotelCalibrationFailureType(reason: string, platform: PlatformName): HotelCalibrationFailureType {
  if (platform === "青猫差旅" && /候选池关键词未生效/.test(reason)) return "qingmao_candidate_keyword_not_applied";
  if (platform === "青猫差旅" && /候选池为空|候选池无有效样本/.test(reason)) return "qingmao_candidate_pool_empty";
  if (platform === "青猫差旅" && /无.*大床有早餐|未找到.*大床有早餐|青猫无/.test(reason)) return "qingmao_no_main_rate";
  if (/登录|权限|未找到.*已登录|login/i.test(reason)) return "login_or_permission_failed";
  if (/超时|timeout/i.test(reason)) return "page_load_timeout";
  if (/旧日期|旧城市|日期|城市错误|页面状态|stale/i.test(reason)) return "stale_page_or_wrong_date";
  if (/门牌号|同酒店|同店|未匹配到同城市同门牌号|不是同一家/.test(reason)) return "competitor_no_same_hotel";
  if (/未找到.*大床有早餐|无.*大床有早餐|未解析到.*大床有早餐|未找到同口径价格/.test(reason)) return "competitor_no_main_rate";
  if (/解析|疑似/.test(reason)) return "parser_suspected_failed";
  if (/弹窗|遮挡|异常|页面|状态/.test(reason)) return "platform_page_state_error";
  return "unknown_technical_failure";
}

function extractHotelNameFromPageText(rawText: string, fallback: string) {
  const line = rawText
    .split(/\n+/)
    .map((item) => item.trim())
    .find((item) => item.length >= 4 && /酒店|宾馆|旅馆|公寓/.test(item) && !/酒店详情|酒店预订|酒店信息|酒店列表|附近酒店|广州 酒店/.test(item));
  return line ?? fallback;
}

function extractHotelAddressFromPageText(rawText: string, doorPlate: string | null, fallback: string) {
  const lines = rawText.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  if (doorPlate) {
    const matchedLine = lines.find((line) => normalizeAddressForMatch(line).includes(normalizeAddressForMatch(doorPlate)));
    if (matchedLine) return matchedLine;
  }
  return fallback;
}

function hotelRateParsersForPlatform(platform: PlatformName) {
  if (platform === "青猫差旅") return parseQingmaoHotelMainRatesText;
  if (platform === "携程商旅") return parseCtripHotelMainRatesText;
  if (platform === "阿里商旅") return parseAliHotelMainRatesText;
  return (rawText: string, ratePlan: HotelRatePlanLabel): HotelMainRateQuote[] =>
    parseZtripHotelRatesTextForRatePlan(rawText, ratePlan).map((rate) => ({
      platform: "在途商旅",
      status: typeof rate.price === "number" ? "available" : "not-found",
      price: rate.price,
      hotelName: rate.hotelName,
      roomType: rate.roomType,
      ratePlan,
      rawText: rate.rawText
    }));
}

export function readHotelCalibrationRatesFromText(platform: PlatformName, rawText: string) {
  const parseRates = hotelRateParsersForPlatform(platform);
  const priceFor = (ratePlan: HotelRatePlanLabel) => {
    const quotes = parseRates(rawText, ratePlan);
    return quotes
      .filter((quote) => quote.status === "available" && typeof quote.price === "number")
      .sort((left, right) => (left.price ?? Number.MAX_SAFE_INTEGER) - (right.price ?? Number.MAX_SAFE_INTEGER))[0]?.price ?? null;
  };

  return {
    mainRatePrice: priceFor(HOTEL_CALIBRATION_MAIN_RATE_PLAN),
    otherRates: HOTEL_CALIBRATION_OTHER_RATE_PLANS.reduce((rates, ratePlan) => ({
      ...rates,
      [ratePlan]: priceFor(ratePlan)
    }), emptyHotelCalibrationOtherRates())
  };
}

function buildHotelCalibrationPlatformResult(input: {
  platform: PlatformName;
  startedAt: number;
  sameHotel: boolean | null;
  matchBasis: string;
  sourceAddress: string;
  rawText: string;
  fallbackHotelName: string;
  screenshotPath?: string;
  finalUrl: string;
  failureReason?: string;
  failureType?: HotelCalibrationFailureType | null;
}): HotelCalibrationPlatformResult {
  const targetDoorPlate = extractHotelDoorPlate(input.rawText);
  const rates = input.sameHotel === false ? { mainRatePrice: null, otherRates: emptyHotelCalibrationOtherRates() } : readHotelCalibrationRatesFromText(input.platform, input.rawText);
  const failureReason = input.failureReason ?? "";
  const failureType = input.failureType === undefined && failureReason
    ? classifyHotelCalibrationFailureType(failureReason, input.platform)
    : input.failureType ?? null;

  return {
    platform: input.platform,
    sameHotel: input.sameHotel,
    matchBasis: input.matchBasis,
    platformHotelName: extractHotelNameFromPageText(input.rawText, input.fallbackHotelName),
    platformAddress: extractHotelAddressFromPageText(input.rawText, targetDoorPlate, input.sameHotel === true ? input.sourceAddress : ""),
    platformDoorPlate: targetDoorPlate,
    hasMainRate: typeof rates.mainRatePrice === "number",
    mainRatePrice: rates.mainRatePrice,
    otherRates: rates.otherRates,
    durationMs: Date.now() - input.startedAt,
    failureType,
    failureReason,
    screenshotPath: input.screenshotPath,
    finalUrl: input.finalUrl,
    pageTextSummary: buildHotelPageTextSummary(input.rawText)
  };
}

function buildPendingHotelSingleDiagnosisPlatform(platform: PlatformName): HotelSingleDiagnosisPlatformResult {
  return {
    platform,
    step: "pending",
    sameHotel: null,
    matchBasis: "",
    sourceDoorPlate: null,
    targetDoorPlate: null,
    durationMs: null,
    price: null
  };
}

function hotelSingleDiagnosisEvidencePath(artifactDir: string, platform: PlatformName) {
  return path.join(artifactDir, `${safeFilename(platform)}.png`);
}

async function saveHotelSingleDiagnosisEvidence(
  page: BrowserPage,
  artifactDir: string,
  platform: PlatformName,
  snapshot: EvidenceSnapshot
) {
  return await savePageEvidence(page, hotelSingleDiagnosisEvidencePath(artifactDir, platform), snapshot);
}

function failedHotelSingleDiagnosisPlatform(
  platform: PlatformName,
  startedAt: number,
  reason: string,
  sourceDoorPlate: string | null,
  targetDoorPlate: string | null,
  matchBasis: string,
  screenshotPath?: string,
  finalUrl?: string
): HotelSingleDiagnosisPlatformResult {
  return {
    platform,
    step: "failed",
    sameHotel: false,
    matchBasis,
    sourceDoorPlate,
    targetDoorPlate,
    durationMs: Date.now() - startedAt,
    price: null,
    error: reason,
    screenshotPath,
    finalUrl
  };
}

async function diagnoseQingmaoSingleHotel(
  qingmaoPage: BrowserPage,
  artifactDir: string,
  query: QingmaoHotelCandidateQuery,
  ratePlan: HotelRatePlanLabel,
  onUpdate: (platform: PlatformName, patch: Partial<HotelSingleDiagnosisPlatformResult>) => void
): Promise<{ candidate: QingmaoHotelCandidate | null; result: HotelSingleDiagnosisPlatformResult }> {
  const startedAt = Date.now();
  const platform: PlatformName = "青猫差旅";
  let candidate: QingmaoHotelCandidate | null = null;
  let qingmaoFrame: BrowserFrame | null = null;
  let bodyText = "";
  let screenshotPath: string | undefined;

  try {
    onUpdate(platform, { step: "searching-hotel", matchBasis: "读取青猫候选池" });
    const listFrame = await searchQingmaoHotelCandidates(qingmaoPage, query);
    const listText = await listFrame.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
    const candidates = parseQingmaoHotelCandidatesText(listText);
    candidate = selectLockedQingmaoHotelCandidate(candidates, query);
    const candidateIndex = Math.max(0, candidates.findIndex((item) => item === candidate));
    const sourceDoorPlate = extractHotelDoorPlate(candidate.address);
    onUpdate(platform, {
      step: "matching-hotel",
      sameHotel: true,
      matchBasis: "青猫候选源酒店",
      sourceDoorPlate,
      targetDoorPlate: sourceDoorPlate
    });

    await clickQingmaoHotelCandidateDetail(listFrame, candidate, candidateIndex);
    qingmaoFrame = await waitForQingmaoHotelDetailFrame(qingmaoPage, candidate.hotelName);
    bodyText = await waitForQingmaoHotelDetailText(qingmaoFrame, candidate.hotelName);
    let rates = parseQingmaoHotelMainRatesText(bodyText, ratePlan);
    if (!rates.some((item) => item.status === "available" && typeof item.price === "number")) {
      await filterQingmaoHotelMainRate(qingmaoFrame, candidate.hotelName, ratePlan);
      bodyText = await waitForQingmaoHotelDetailText(qingmaoFrame, candidate.hotelName, ratePlan);
      rates = parseQingmaoHotelMainRatesText(bodyText, ratePlan);
    }

    onUpdate(platform, { step: "checking-rate-plan", matchBasis: "青猫候选源酒店" });
    const selectedRate = rates.find((item) => item.status === "available" && typeof item.price === "number") ?? null;
    screenshotPath = await saveHotelSingleDiagnosisEvidence(qingmaoPage, artifactDir, platform, {
      platform,
      finalUrl: qingmaoFrame.url(),
      bodyText,
      price: selectedRate?.price ?? null,
      rawText: selectedRate?.rawText
    });

    if (!selectedRate) {
      return {
        candidate,
        result: failedHotelSingleDiagnosisPlatform(
          platform,
          startedAt,
          `青猫未找到${ratePlan}价格`,
          sourceDoorPlate,
          sourceDoorPlate,
          "青猫候选源酒店",
          screenshotPath,
          qingmaoFrame.url()
        )
      };
    }

    return {
      candidate,
      result: {
        platform,
        step: "success",
        sameHotel: true,
        matchBasis: "青猫候选源酒店",
        sourceDoorPlate,
        targetDoorPlate: sourceDoorPlate,
        durationMs: Date.now() - startedAt,
        price: selectedRate.price,
        screenshotPath,
        finalUrl: qingmaoFrame.url(),
        roomType: selectedRate.roomType,
        rawText: selectedRate.rawText
      }
    };
  } catch (error) {
    if (!screenshotPath) {
      screenshotPath = await saveHotelSingleDiagnosisEvidence(qingmaoPage, artifactDir, platform, {
        platform,
        finalUrl: qingmaoFrame?.url() ?? qingmaoPage.url(),
        bodyText,
        error: errorMessage(error)
      }).catch(() => undefined);
    }
    return {
      candidate,
      result: failedHotelSingleDiagnosisPlatform(
        platform,
        startedAt,
        errorMessage(error),
        candidate ? extractHotelDoorPlate(candidate.address) : null,
        candidate ? extractHotelDoorPlate(candidate.address) : null,
        candidate ? "青猫候选源酒店" : "青猫候选锁定失败",
        screenshotPath,
        qingmaoFrame?.url() ?? qingmaoPage.url()
      )
    };
  }
}

async function diagnoseCtripSingleHotel(
  context: BrowserContext,
  artifactDir: string,
  query: QingmaoHotelCandidateQuery,
  candidate: QingmaoHotelCandidate,
  ratePlan: HotelRatePlanLabel,
  onUpdate: (platform: PlatformName, patch: Partial<HotelSingleDiagnosisPlatformResult>) => void
): Promise<HotelSingleDiagnosisPlatformResult> {
  const platform: PlatformName = "携程商旅";
  const startedAt = Date.now();
  const sourceDoorPlate = extractHotelDoorPlate(candidate.address);
  const page = await context.newPage();
  let bodyText = "";
  let screenshotPath: string | undefined;
  let ctripTrace: CtripSingleHotelTrace = {};

  try {
    onUpdate(platform, { step: "searching-hotel", sourceDoorPlate, matchBasis: "从携程商旅首页重新搜索酒店" });
    ctripTrace = await openCtripHotelDetailByHotelForSingleDiagnosis(page, query, candidate);
    onUpdate(platform, { step: "matching-hotel", sourceDoorPlate, matchBasis: "按同城市同门牌号校验携程详情页", ...ctripTrace });
    bodyText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
    const match = diagnoseDoorPlateMatch(query.city, candidate.address, bodyText);
    if (!match.sameHotel) {
      screenshotPath = await saveHotelSingleDiagnosisEvidence(page, artifactDir, platform, {
        platform,
        finalUrl: page.url(),
        bodyText,
        error: match.matchBasis
      });
      return {
        ...failedHotelSingleDiagnosisPlatform(platform, startedAt, match.matchBasis, match.sourceDoorPlate, match.targetDoorPlate, match.matchBasis, screenshotPath, page.url()),
        ...ctripTrace
      };
    }

    onUpdate(platform, { step: "checking-rate-plan", sameHotel: true, sourceDoorPlate, targetDoorPlate: match.targetDoorPlate, matchBasis: match.matchBasis, ...ctripTrace });
    bodyText = await waitForCtripHotelDetailRooms(page);
    const rates = parseCtripHotelMainRatesText(bodyText, ratePlan);
    const selectedRate = rates.find((item) => item.status === "available" && typeof item.price === "number") ?? null;
    screenshotPath = await saveHotelSingleDiagnosisEvidence(page, artifactDir, platform, {
      platform,
      finalUrl: page.url(),
      bodyText,
      price: selectedRate?.price ?? null,
      rawText: selectedRate?.rawText
    });
    if (!selectedRate) {
      return {
        ...failedHotelSingleDiagnosisPlatform(platform, startedAt, `携程商旅未找到${ratePlan}价格`, match.sourceDoorPlate, match.targetDoorPlate, match.matchBasis, screenshotPath, page.url()),
        ...ctripTrace
      };
    }

    return {
      platform,
      step: "success",
      sameHotel: true,
      matchBasis: match.matchBasis,
      sourceDoorPlate: match.sourceDoorPlate,
      targetDoorPlate: match.targetDoorPlate,
      durationMs: Date.now() - startedAt,
      price: selectedRate.price,
      screenshotPath,
      finalUrl: page.url(),
      ...ctripTrace,
      ctripFinalUrl: page.url(),
      roomType: selectedRate.roomType,
      rawText: selectedRate.rawText
    };
  } catch (error) {
    ctripTrace = { ...ctripTrace, ...((error as Error & { ctripTrace?: CtripSingleHotelTrace }).ctripTrace ?? {}) };
    if (!screenshotPath) {
      bodyText = bodyText || await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
      screenshotPath = await saveHotelSingleDiagnosisEvidence(page, artifactDir, platform, {
        platform,
        finalUrl: page.url(),
        bodyText,
        error: errorMessage(error)
      }).catch(() => undefined);
    }
    return {
      ...failedHotelSingleDiagnosisPlatform(platform, startedAt, errorMessage(error), sourceDoorPlate, extractHotelDoorPlate(bodyText), errorMessage(error), screenshotPath, page.url()),
      ...ctripTrace,
      ctripFinalUrl: page.url()
    };
  }
}

async function diagnoseAliSingleHotel(
  context: BrowserContext,
  artifactDir: string,
  query: QingmaoHotelCandidateQuery,
  candidate: QingmaoHotelCandidate,
  ratePlan: HotelRatePlanLabel,
  onUpdate: (platform: PlatformName, patch: Partial<HotelSingleDiagnosisPlatformResult>) => void
): Promise<HotelSingleDiagnosisPlatformResult> {
  const platform: PlatformName = "阿里商旅";
  const startedAt = Date.now();
  const sourceDoorPlate = extractHotelDoorPlate(candidate.address);
  const page = await context.newPage();
  let detailPage: BrowserPage | null = null;
  let bodyText = "";
  let screenshotPath: string | undefined;

  try {
    onUpdate(platform, { step: "searching-hotel", sourceDoorPlate, matchBasis: "从阿里商旅酒店首页重新生成本轮行程单并搜索" });
    await page.goto("https://travel.alibtrip.com/index.html#/hotel", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(3_000);
    let lastError = "";
    for (const keywordPlan of buildAliHotelSearchKeywordPlan(query, candidate)) {
      try {
        await openAliHotelList(context, page, query, keywordPlan.keyword);
        onUpdate(platform, { step: "matching-hotel", sourceDoorPlate, matchBasis: "按同城市同门牌号校验阿里详情页" });
        const aliSelection = await clickMatchingAliHotelCard(context, page, query, candidate, undefined, keywordPlan);
        detailPage = aliSelection.detailPage;
        bodyText = await waitForAliHotelDetailRooms(detailPage);
        const match = confirmAliHotelDetailDoorPlate(query.city, candidate, bodyText);
        if (!match.sameHotel) {
          lastError = match.failureReason || match.matchBasis;
          await detailPage.close?.({ runBeforeUnload: false }).catch(() => undefined);
          detailPage = null;
          continue;
        }

        onUpdate(platform, { step: "checking-rate-plan", sameHotel: true, sourceDoorPlate, targetDoorPlate: extractHotelDoorPlate(bodyText), matchBasis: match.matchBasis });
        const rates = parseAliHotelMainRatesText(bodyText, ratePlan);
        const selectedRate = rates.find((item) => item.status === "available" && typeof item.price === "number") ?? null;
        screenshotPath = await saveHotelSingleDiagnosisEvidence(detailPage, artifactDir, platform, {
          platform,
          finalUrl: detailPage.url(),
          bodyText,
          price: selectedRate?.price ?? null,
          rawText: selectedRate?.rawText
        });
        if (!selectedRate) {
          return failedHotelSingleDiagnosisPlatform(platform, startedAt, `阿里商旅未找到${ratePlan}价格`, sourceDoorPlate, extractHotelDoorPlate(bodyText), match.matchBasis, screenshotPath, detailPage.url());
        }

        return {
          platform,
          step: "success",
          sameHotel: true,
          matchBasis: match.matchBasis,
          sourceDoorPlate,
          targetDoorPlate: extractHotelDoorPlate(bodyText),
          durationMs: Date.now() - startedAt,
          price: selectedRate.price,
          screenshotPath,
          finalUrl: detailPage.url(),
          roomType: selectedRate.roomType,
          rawText: selectedRate.rawText
        };
      } catch (error) {
        lastError = errorMessage(error);
        if (detailPage && typeof detailPage.close === "function") {
          await detailPage.close({ runBeforeUnload: false }).catch(() => undefined);
        }
        detailPage = null;
      }
    }
    throw new Error(lastError || "阿里商旅未匹配到同酒店");
  } catch (error) {
    const evidencePage = detailPage ?? page;
    bodyText = bodyText || await evidencePage.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
    screenshotPath = await saveHotelSingleDiagnosisEvidence(evidencePage, artifactDir, platform, {
      platform,
      finalUrl: evidencePage.url(),
      bodyText,
      error: errorMessage(error)
    }).catch(() => undefined);
    const match = diagnoseDoorPlateMatch(query.city, candidate.address, bodyText);
    return failedHotelSingleDiagnosisPlatform(platform, startedAt, errorMessage(error), match.sourceDoorPlate, match.targetDoorPlate, match.matchBasis || errorMessage(error), screenshotPath, evidencePage.url());
  }
}

async function diagnoseZtripSingleHotel(
  context: BrowserContext,
  artifactDir: string,
  query: QingmaoHotelCandidateQuery,
  candidate: QingmaoHotelCandidate,
  ratePlan: HotelRatePlanLabel,
  onUpdate: (platform: PlatformName, patch: Partial<HotelSingleDiagnosisPlatformResult>) => void
): Promise<HotelSingleDiagnosisPlatformResult> {
  const platform: PlatformName = "在途商旅";
  const startedAt = Date.now();
  const sourceDoorPlate = extractHotelDoorPlate(candidate.address);
  const page = await context.newPage();
  let bodyText = "";
  let screenshotPath: string | undefined;

  try {
    onUpdate(platform, { step: "searching-hotel", sourceDoorPlate, matchBasis: "从在途商旅酒店页重新搜索酒店" });
    await openZtripHotelSearchResultByHotel(page, buildZtripHotelQueryFromQingmao(query), candidate.hotelName);
    onUpdate(platform, { step: "matching-hotel", sourceDoorPlate, matchBasis: "按同城市同门牌号校验在途详情页" });
    bodyText = await page.locator("body").innerText({ timeout: 8_000 }).catch(() => "");
    const match = diagnoseDoorPlateMatch(query.city, candidate.address, bodyText);
    if (!match.sameHotel) {
      screenshotPath = await saveHotelSingleDiagnosisEvidence(page, artifactDir, platform, {
        platform,
        finalUrl: page.url(),
        bodyText,
        error: match.matchBasis
      });
      return failedHotelSingleDiagnosisPlatform(platform, startedAt, match.matchBasis, match.sourceDoorPlate, match.targetDoorPlate, match.matchBasis, screenshotPath, page.url());
    }

    onUpdate(platform, { step: "checking-rate-plan", sameHotel: true, sourceDoorPlate, targetDoorPlate: match.targetDoorPlate, matchBasis: match.matchBasis });
    await filterZtripHotelRatePlan(page, ratePlan);
    await expandZtripRoomCards(page);
    bodyText = await page.locator("body").innerText({ timeout: 8_000 }).catch(() => "");
    const rates = parseZtripHotelRatesTextForRatePlan(bodyText, ratePlan);
    const selectedRate = rates
      .filter((item) => item.bedType === hotelRatePlanBedType(ratePlan) && item.breakfast === hotelRatePlanBreakfast(ratePlan) && typeof item.price === "number")
      .sort((left, right) => (left.price ?? Number.MAX_SAFE_INTEGER) - (right.price ?? Number.MAX_SAFE_INTEGER))[0] ?? null;
    screenshotPath = await saveHotelSingleDiagnosisEvidence(page, artifactDir, platform, {
      platform,
      finalUrl: page.url(),
      bodyText,
      price: selectedRate?.price ?? null,
      rawText: selectedRate?.rawText
    });
    if (!selectedRate) {
      return failedHotelSingleDiagnosisPlatform(platform, startedAt, `在途商旅未找到${ratePlan}价格`, match.sourceDoorPlate, match.targetDoorPlate, match.matchBasis, screenshotPath, page.url());
    }

    return {
      platform,
      step: "success",
      sameHotel: true,
      matchBasis: match.matchBasis,
      sourceDoorPlate: match.sourceDoorPlate,
      targetDoorPlate: match.targetDoorPlate,
      durationMs: Date.now() - startedAt,
      price: selectedRate.price,
      screenshotPath,
      finalUrl: page.url(),
      roomType: selectedRate.roomType,
      rawText: selectedRate.rawText
    };
  } catch (error) {
    bodyText = bodyText || await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
    screenshotPath = await saveHotelSingleDiagnosisEvidence(page, artifactDir, platform, {
      platform,
      finalUrl: page.url(),
      bodyText,
      error: errorMessage(error)
    }).catch(() => undefined);
    const match = diagnoseDoorPlateMatch(query.city, candidate.address, bodyText);
    return failedHotelSingleDiagnosisPlatform(platform, startedAt, errorMessage(error), match.sourceDoorPlate, match.targetDoorPlate, match.matchBasis || errorMessage(error), screenshotPath, page.url());
  }
}

async function diagnoseQingmaoHotelCalibration(
  qingmaoPage: BrowserPage,
  artifactDir: string,
  query: QingmaoHotelCandidateQuery,
  candidate: QingmaoHotelCandidate
): Promise<{ candidate: QingmaoHotelCandidate; result: HotelCalibrationPlatformResult; hasMainRate: boolean }> {
  const platform: PlatformName = "青猫差旅";
  const startedAt = Date.now();
  let qingmaoFrame: BrowserFrame | null = null;
  let bodyText = "";
  let screenshotPath: string | undefined;
  const sourceDoorPlate = extractHotelDoorPlate(candidate.address);

  try {
    const listFrame = await searchQingmaoHotelCandidates(qingmaoPage, query);
    const listText = await listFrame.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
    const candidates = parseQingmaoHotelCandidatesText(listText);
    const candidateIndex = candidates.findIndex((item) => item.hotelName === candidate.hotelName);
    const lockedCandidate = candidateIndex >= 0 ? candidates[candidateIndex] : candidate;

    await clickQingmaoHotelCandidateDetail(listFrame, lockedCandidate, candidateIndex >= 0 ? candidateIndex : 0);
    qingmaoFrame = await waitForQingmaoHotelDetailFrame(qingmaoPage, lockedCandidate.hotelName);
    bodyText = await waitForQingmaoHotelDetailText(qingmaoFrame, lockedCandidate.hotelName);
    if (readHotelCalibrationRatesFromText(platform, bodyText).mainRatePrice === null) {
      await filterQingmaoHotelMainRate(qingmaoFrame, lockedCandidate.hotelName, HOTEL_CALIBRATION_MAIN_RATE_PLAN);
      bodyText = await waitForQingmaoHotelDetailText(qingmaoFrame, lockedCandidate.hotelName, HOTEL_CALIBRATION_MAIN_RATE_PLAN);
    }

    const rates = readHotelCalibrationRatesFromText(platform, bodyText);
    screenshotPath = await saveHotelSingleDiagnosisEvidence(qingmaoPage, artifactDir, platform, {
      platform,
      finalUrl: qingmaoFrame.url(),
      bodyText,
      price: rates.mainRatePrice
    });
    const parserSuspected = rates.mainRatePrice === null && qingmaoHasVisibleRatePlanSignal(bodyText, HOTEL_CALIBRATION_MAIN_RATE_PLAN);
    const failureReason = rates.mainRatePrice === null
      ? parserSuspected
        ? `青猫解析疑似失败：页面可见${HOTEL_CALIBRATION_MAIN_RATE_PLAN}价格`
        : `青猫未找到${HOTEL_CALIBRATION_MAIN_RATE_PLAN}价格`
      : "";

    return {
      candidate: lockedCandidate,
      hasMainRate: rates.mainRatePrice !== null,
      result: buildHotelCalibrationPlatformResult({
        platform,
        startedAt,
        sameHotel: true,
        matchBasis: "青猫候选源酒店",
        sourceAddress: lockedCandidate.address,
        rawText: bodyText,
        fallbackHotelName: lockedCandidate.hotelName,
        screenshotPath,
        finalUrl: qingmaoFrame.url(),
        failureReason,
        failureType: failureReason ? classifyHotelCalibrationFailureType(failureReason, platform) : null
      })
    };
  } catch (error) {
    if (!screenshotPath) {
      screenshotPath = await saveHotelSingleDiagnosisEvidence(qingmaoPage, artifactDir, platform, {
        platform,
        finalUrl: qingmaoFrame?.url() ?? qingmaoPage.url(),
        bodyText,
        error: errorMessage(error)
      }).catch(() => undefined);
    }

    return {
      candidate,
      hasMainRate: false,
      result: buildHotelCalibrationPlatformResult({
        platform,
        startedAt,
        sameHotel: true,
        matchBasis: "青猫候选源酒店",
        sourceAddress: candidate.address,
        rawText: bodyText,
        fallbackHotelName: candidate.hotelName,
        screenshotPath,
        finalUrl: qingmaoFrame?.url() ?? qingmaoPage.url(),
        failureReason: errorMessage(error),
        failureType: classifyHotelCalibrationFailureType(errorMessage(error), platform)
      })
    };
  }
}

async function diagnoseAliHotelCalibration(
  context: BrowserContext,
  artifactDir: string,
  query: QingmaoHotelCandidateQuery,
  candidate: QingmaoHotelCandidate
): Promise<HotelCalibrationPlatformResult> {
  const platform: PlatformName = "阿里商旅";
  const startedAt = Date.now();
  const page = await context.newPage();
  let detailPage: BrowserPage | null = null;
  let bodyText = "";
  let screenshotPath: string | undefined;
  let lastError = "";
  const aliKeywordTraces: AliHotelKeywordTrace[] = [];

  try {
    await page.goto("https://travel.alibtrip.com/index.html#/hotel", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(3_000);
    for (const keywordPlan of buildAliHotelSearchKeywordPlan(query, candidate)) {
      try {
        await openAliHotelList(context, page, query, keywordPlan.keyword);
        const aliSelection = await clickMatchingAliHotelCard(context, page, query, candidate, {
          keyword: keywordPlan.keyword,
          keywordMode: keywordPlan.mode,
          traces: aliKeywordTraces,
          artifactDir
        }, keywordPlan);
        detailPage = aliSelection.detailPage;
        bodyText = await waitForAliHotelDetailRooms(detailPage);
        const match = confirmAliHotelDetailDoorPlate(query.city, candidate, bodyText);
        if (aliSelection.keywordTrace) {
          applyAliHotelDetailDiagnosisToTrace(aliSelection.keywordTrace, detailPage.url(), match);
          await writeAliHotelListDiagnosis(artifactDir, aliKeywordTraces);
        }
        if (!match.sameHotel) {
          lastError = match.failureReason || match.matchBasis;
          await detailPage.close?.({ runBeforeUnload: false }).catch(() => undefined);
          detailPage = null;
          continue;
        }

        const rates = readHotelCalibrationRatesFromText(platform, bodyText);
        screenshotPath = await saveHotelSingleDiagnosisEvidence(detailPage, artifactDir, platform, {
          platform,
          finalUrl: detailPage.url(),
          bodyText,
          price: rates.mainRatePrice
        });
        const failureReason = rates.mainRatePrice === null ? `阿里商旅未找到${HOTEL_CALIBRATION_MAIN_RATE_PLAN}价格` : "";
        return buildHotelCalibrationPlatformResult({
          platform,
          startedAt,
          sameHotel: true,
          matchBasis: match.matchBasis,
          sourceAddress: candidate.address,
          rawText: bodyText,
          fallbackHotelName: candidate.hotelName,
          screenshotPath,
          finalUrl: detailPage.url(),
          failureReason,
          failureType: failureReason ? "competitor_no_main_rate" : null
        });
      } catch (error) {
        lastError = errorMessage(error);
        if (detailPage && typeof detailPage.close === "function") {
          await detailPage.close({ runBeforeUnload: false }).catch(() => undefined);
        }
        detailPage = null;
      }
    }
    throw new Error(lastError || "阿里商旅未匹配到同酒店");
  } catch (error) {
    const evidencePage = detailPage ?? page;
    bodyText = bodyText || await evidencePage.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
    await writeAliHotelListDiagnosis(artifactDir, aliKeywordTraces);
    screenshotPath = await saveHotelSingleDiagnosisEvidence(evidencePage, artifactDir, platform, {
      platform,
      finalUrl: evidencePage.url(),
      bodyText,
      error: errorMessage(error)
    }).catch(() => undefined);
    const match = diagnoseDoorPlateMatch(query.city, candidate.address, bodyText);
    const cardLevelMatchBasis = lastError && /阿里列表|阿里详情|selector|目标门牌|核心店名|门牌不匹配|详情页加载超时|品牌\+核心/.test(lastError)
      ? lastError
      : "";
    const failureReason = cardLevelMatchBasis || errorMessage(error);
    return buildHotelCalibrationPlatformResult({
      platform,
      startedAt,
      sameHotel: resolveAliHotelSameHotelAfterFailure(match.sameHotel, failureReason),
      matchBasis: cardLevelMatchBasis || match.matchBasis || errorMessage(error),
      sourceAddress: candidate.address,
      rawText: bodyText,
      fallbackHotelName: candidate.hotelName,
      screenshotPath,
      finalUrl: evidencePage.url(),
      failureReason,
      failureType: classifyHotelCalibrationFailureType(failureReason, platform)
    });
  }
}

async function diagnoseZtripHotelCalibration(
  context: BrowserContext,
  artifactDir: string,
  query: QingmaoHotelCandidateQuery,
  candidate: QingmaoHotelCandidate
): Promise<HotelCalibrationPlatformResult> {
  const platform: PlatformName = "在途商旅";
  const startedAt = Date.now();
  const page = await context.newPage();
  let bodyText = "";
  let screenshotPath: string | undefined;

  try {
    await openZtripHotelSearchResultByHotel(page, buildZtripHotelQueryFromQingmao(query), candidate.hotelName);
    bodyText = await page.locator("body").innerText({ timeout: 8_000 }).catch(() => "");
    const match = diagnoseDoorPlateMatch(query.city, candidate.address, bodyText);
    if (!match.sameHotel) {
      screenshotPath = await saveHotelSingleDiagnosisEvidence(page, artifactDir, platform, {
        platform,
        finalUrl: page.url(),
        bodyText,
        error: match.matchBasis
      });
      return buildHotelCalibrationPlatformResult({
        platform,
        startedAt,
        sameHotel: false,
        matchBasis: match.matchBasis,
        sourceAddress: candidate.address,
        rawText: bodyText,
        fallbackHotelName: candidate.hotelName,
        screenshotPath,
        finalUrl: page.url(),
        failureReason: match.matchBasis,
        failureType: "competitor_no_same_hotel"
      });
    }

    await filterZtripHotelRatePlan(page, HOTEL_CALIBRATION_MAIN_RATE_PLAN);
    await expandZtripRoomCards(page);
    bodyText = await page.locator("body").innerText({ timeout: 8_000 }).catch(() => "");
    const rates = readHotelCalibrationRatesFromText(platform, bodyText);
    screenshotPath = await saveHotelSingleDiagnosisEvidence(page, artifactDir, platform, {
      platform,
      finalUrl: page.url(),
      bodyText,
      price: rates.mainRatePrice
    });
    const failureReason = rates.mainRatePrice === null ? `在途商旅未找到${HOTEL_CALIBRATION_MAIN_RATE_PLAN}价格` : "";

    return buildHotelCalibrationPlatformResult({
      platform,
      startedAt,
      sameHotel: true,
      matchBasis: match.matchBasis,
      sourceAddress: candidate.address,
      rawText: bodyText,
      fallbackHotelName: candidate.hotelName,
      screenshotPath,
      finalUrl: page.url(),
      failureReason,
      failureType: failureReason ? "competitor_no_main_rate" : null
    });
  } catch (error) {
    bodyText = bodyText || await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
    screenshotPath = await saveHotelSingleDiagnosisEvidence(page, artifactDir, platform, {
      platform,
      finalUrl: page.url(),
      bodyText,
      error: errorMessage(error)
    }).catch(() => undefined);
    const match = diagnoseDoorPlateMatch(query.city, candidate.address, bodyText);
    return buildHotelCalibrationPlatformResult({
      platform,
      startedAt,
      sameHotel: match.sameHotel,
      matchBasis: match.matchBasis || errorMessage(error),
      sourceAddress: candidate.address,
      rawText: bodyText,
      fallbackHotelName: candidate.hotelName,
      screenshotPath,
      finalUrl: page.url(),
      failureReason: errorMessage(error),
      failureType: classifyHotelCalibrationFailureType(errorMessage(error), platform)
    });
  }
}

async function diagnoseCtripHotelCalibration(
  context: BrowserContext,
  artifactDir: string,
  query: QingmaoHotelCandidateQuery,
  candidate: QingmaoHotelCandidate
): Promise<HotelCalibrationPlatformResult> {
  const platform: PlatformName = "携程商旅";
  const startedAt = Date.now();
  const page = await context.newPage();
  let bodyText = "";
  let screenshotPath: string | undefined;

  try {
    await openCtripHotelDetailByHotelForSingleDiagnosis(page, query, candidate);
    bodyText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
    const match = diagnoseDoorPlateMatch(query.city, candidate.address, bodyText);
    if (!match.sameHotel) {
      screenshotPath = await saveHotelSingleDiagnosisEvidence(page, artifactDir, platform, {
        platform,
        finalUrl: page.url(),
        bodyText,
        error: match.matchBasis
      });
      return buildHotelCalibrationPlatformResult({
        platform,
        startedAt,
        sameHotel: false,
        matchBasis: match.matchBasis,
        sourceAddress: candidate.address,
        rawText: bodyText,
        fallbackHotelName: candidate.hotelName,
        screenshotPath,
        finalUrl: page.url(),
        failureReason: match.matchBasis,
        failureType: "competitor_no_same_hotel"
      });
    }

    bodyText = await waitForCtripHotelDetailRooms(page);
    const rates = readHotelCalibrationRatesFromText(platform, bodyText);
    screenshotPath = await saveHotelSingleDiagnosisEvidence(page, artifactDir, platform, {
      platform,
      finalUrl: page.url(),
      bodyText,
      price: rates.mainRatePrice
    });
    const failureReason = rates.mainRatePrice === null ? `携程商旅未找到${HOTEL_CALIBRATION_MAIN_RATE_PLAN}价格` : "";

    return buildHotelCalibrationPlatformResult({
      platform,
      startedAt,
      sameHotel: true,
      matchBasis: match.matchBasis,
      sourceAddress: candidate.address,
      rawText: bodyText,
      fallbackHotelName: candidate.hotelName,
      screenshotPath,
      finalUrl: page.url(),
      failureReason,
      failureType: failureReason ? "competitor_no_main_rate" : null
    });
  } catch (error) {
    bodyText = bodyText || await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
    screenshotPath = await saveHotelSingleDiagnosisEvidence(page, artifactDir, platform, {
      platform,
      finalUrl: page.url(),
      bodyText,
      error: errorMessage(error)
    }).catch(() => undefined);
    const match = diagnoseDoorPlateMatch(query.city, candidate.address, bodyText);
    return buildHotelCalibrationPlatformResult({
      platform,
      startedAt,
      sameHotel: match.sameHotel,
      matchBasis: match.matchBasis || errorMessage(error),
      sourceAddress: candidate.address,
      rawText: bodyText,
      fallbackHotelName: candidate.hotelName,
      screenshotPath,
      finalUrl: page.url(),
      failureReason: errorMessage(error),
      failureType: classifyHotelCalibrationFailureType(errorMessage(error), platform)
    });
  }
}

async function runHotelMainRateForQuery(
  context: BrowserContext,
  qingmaoPage: BrowserPage,
  artifactDir: string,
  query: QingmaoHotelCandidateQuery,
  ratePlan: HotelRatePlanLabel = HOTEL_VALIDATION_RATE_PLAN,
  maxAttempts = 12,
  onProgress?: (message: string) => void
): Promise<{ status: "completed" | "partial"; selectedCandidate: QingmaoHotelCandidate; quotes: HotelMainRateQuote[]; message: string; skipped: string[] }> {
  await fsp.mkdir(artifactDir, { recursive: true });
  let selectedCandidate: QingmaoHotelCandidate | null = null;
  let qingmaoQuote: HotelMainRateQuote | null = null;
  let ctripQuote: HotelMainRateQuote | null = null;
  let aliQuote: HotelMainRateQuote | null = null;
  let ztripQuote: HotelMainRateQuote | null = null;
  let qingmaoFrame: BrowserFrame | null = null;
  let fallbackCandidate: QingmaoHotelCandidate | null = null;
  let fallbackQingmaoQuote: HotelMainRateQuote | null = null;
  let fallbackQingmaoFrame: BrowserFrame | null = null;
  let fallbackCompetitorQuotes: HotelMainRateQuote[] = [];
  const skipped: string[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const listFrame = await searchQingmaoHotelCandidates(qingmaoPage, query);
    const listText = await listFrame.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
    const candidates = parseQingmaoHotelCandidatesText(listText);
    const candidate = candidates[attempt];
    if (!candidate) {
      onProgress?.(`青猫候选不足：只找到 ${candidates.length} 家`);
      break;
    }
    onProgress?.(`尝试第 ${attempt + 1}/${maxAttempts} 家：${candidate.hotelName}`);
    if (!isHotelCandidateRelevantForQuery(candidate, query)) {
      skipped.push(`${candidate.hotelName}: 不属于${query.keyword}候选`);
      continue;
    }
    if (!candidate.price || candidate.price <= 0) {
      skipped.push(`${candidate.hotelName}: 候选起价为空`);
      continue;
    }

    const qingmaoStartedAt = Date.now();
    await clickQingmaoHotelCandidateDetail(listFrame, candidate, attempt);
    qingmaoFrame = await waitForQingmaoHotelDetailFrame(qingmaoPage, candidate.hotelName);
    const detailText = await waitForQingmaoHotelDetailText(qingmaoFrame, candidate.hotelName);
    let rates = parseQingmaoHotelMainRatesText(detailText, ratePlan);
    if (!rates.some((item) => item.status === "available" && typeof item.price === "number")) {
      await filterQingmaoHotelMainRate(qingmaoFrame, candidate.hotelName, ratePlan);
      const filteredText = await waitForQingmaoHotelDetailText(qingmaoFrame, candidate.hotelName, ratePlan);
      rates = parseQingmaoHotelMainRatesText(filteredText, ratePlan);
    }
    const rate = rates.find((item) => item.status === "available" && typeof item.price === "number") ?? null;
    if (!rate) {
      skipped.push(`${candidate.hotelName}: 青猫无${ratePlan}`);
      continue;
    }

    const qingmaoDurationMs = Date.now() - qingmaoStartedAt;
    const pagesBeforeCandidate = snapshotBrowserPages(context);
    onProgress?.(`${candidate.hotelName}：青猫有${ratePlan}，开始查携程`);
    const nextCtripQuote = await searchCtripHotelMainRateQuote(context, artifactDir, query, candidate, ratePlan);
    onProgress?.(`${candidate.hotelName}：携程完成，开始查阿里`);
    const nextAliQuote = await searchAliHotelMainRateQuote(context, artifactDir, query, candidate, ratePlan);
    onProgress?.(`${candidate.hotelName}：阿里完成，开始查在途`);
    const nextZtripQuote = await searchZtripHotelMainRateQuote(context, artifactDir, buildZtripHotelQueryFromQingmao(query), candidate, ratePlan);
    onProgress?.(`${candidate.hotelName}：在途完成，开始判断完整性`);
    const competitorQuotes = [nextCtripQuote, nextAliQuote, nextZtripQuote];

    if (!fallbackCandidate) {
      fallbackCandidate = candidate;
      fallbackQingmaoQuote = { ...rate, durationMs: qingmaoDurationMs };
      fallbackQingmaoFrame = qingmaoFrame;
      fallbackCompetitorQuotes = competitorQuotes;
    }

    const unavailable = competitorQuotes.filter((quote) => quote.status !== "available" || typeof quote.price !== "number");
    if (!unavailable.length) {
      selectedCandidate = candidate;
      qingmaoQuote = { ...rate, durationMs: qingmaoDurationMs };
      ctripQuote = nextCtripQuote;
      aliQuote = nextAliQuote;
      ztripQuote = nextZtripQuote;
      await closeCreatedBrowserPages(context, pagesBeforeCandidate, new Set([qingmaoPage]));
      break;
    }

    skipped.push(`${candidate.hotelName}: ${unavailable.map((quote) => `${quote.platform}${quote.error ? ` ${quote.error}` : `无${ratePlan}`}`).join("，")}`);
    await closeCreatedBrowserPages(context, pagesBeforeCandidate, new Set([qingmaoPage]));
  }

  const isComplete = Boolean(selectedCandidate && qingmaoQuote && qingmaoFrame && ctripQuote && aliQuote && ztripQuote);
  if (!isComplete && fallbackCandidate && fallbackQingmaoQuote && fallbackQingmaoFrame) {
    selectedCandidate = fallbackCandidate;
    qingmaoQuote = fallbackQingmaoQuote;
    qingmaoFrame = fallbackQingmaoFrame;
    [ctripQuote, aliQuote, ztripQuote] = fallbackCompetitorQuotes;
  }

  if (!selectedCandidate || !qingmaoQuote || !qingmaoFrame || !ctripQuote || !aliQuote || !ztripQuote) {
    throw new Error(`未找到青猫${ratePlan}可用酒店${skipped.length ? `：${skipped.slice(0, 6).join("；")}` : ""}`);
  }

  const screenshotPath = path.join(artifactDir, hotelRatePlanEvidenceName("青猫差旅", ratePlan));
  const bodyText = await waitForQingmaoHotelDetailText(qingmaoFrame, selectedCandidate.hotelName);
  const evidencePath = await savePageEvidence(qingmaoPage, screenshotPath, {
    platform: "青猫差旅",
    finalUrl: qingmaoFrame.url(),
    bodyText,
    price: qingmaoQuote.price,
    rawText: qingmaoQuote.rawText
  });
  const quotes: HotelMainRateQuote[] = [
    {
      ...qingmaoQuote,
      finalUrl: qingmaoFrame.url(),
      screenshotPath: evidencePath
    },
    ctripQuote,
    aliQuote,
    ztripQuote
  ];
  const complete = quotes.every((quote) => quote.status === "available" && typeof quote.price === "number");
  const ctripMessage = ctripQuote.status === "available" ? `携程商旅 ¥${ctripQuote.price}` : `携程商旅未完成：${ctripQuote.error ?? "未找到同口径价格"}`;
  const aliMessage = aliQuote.status === "available" ? `阿里商旅 ¥${aliQuote.price}` : `阿里商旅未完成：${aliQuote.error ?? "未找到同口径价格"}`;
  const ztripMessage = ztripQuote.status === "available" ? `在途商旅 ¥${ztripQuote.price}` : `在途商旅未完成：${ztripQuote.error ?? "未找到同口径价格"}`;

  return {
    status: complete ? "completed" : "partial",
    selectedCandidate,
    quotes,
    message: `已找到酒店${ratePlan}口径锚点：${selectedCandidate.hotelName}，青猫 ¥${qingmaoQuote.price}，${ctripMessage}，${aliMessage}，${ztripMessage}`,
    skipped
  };
}

async function selectHotelCandidateForQuery(
  qingmaoPage: BrowserPage,
  query: QingmaoHotelCandidateQuery
): Promise<QingmaoHotelCandidate> {
  const listFrame = await searchQingmaoHotelCandidates(qingmaoPage, query);
  const listText = await listFrame.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  const candidates = parseQingmaoHotelCandidatesText(listText);
  const selected = candidates.find((candidate) => isHotelCandidateRelevantForQuery(candidate, query) && Boolean(candidate.price && candidate.price > 0));
  if (!selected) {
    throw new Error(`未找到${query.keyword}可用酒店候选`);
  }
  return selected;
}

function shuffledItems<T>(items: T[], randomValue: () => number) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.min(index, Math.floor(randomValue() * (index + 1)));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

async function selectHotelCandidatesForQuery(
  qingmaoPage: BrowserPage,
  query: QingmaoHotelCandidateQuery,
  limit: number,
  randomValue: () => number
): Promise<QingmaoHotelCandidate[]> {
  const listFrame = await searchQingmaoHotelCandidates(qingmaoPage, query);
  const listText = await listFrame.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  const candidates = parseQingmaoHotelCandidatesText(listText)
    .filter((candidate) => isHotelCandidateRelevantForQuery(candidate, query) && Boolean(candidate.price && candidate.price > 0));
  return shuffledItems(candidates, randomValue).slice(0, limit);
}

async function readQingmaoHotelRatePlanPresence(
  qingmaoPage: BrowserPage,
  query: QingmaoHotelCandidateQuery,
  lockedCandidate: QingmaoHotelCandidate
): Promise<HotelMainRateQuote[]> {
  const listFrame = await searchQingmaoHotelCandidates(qingmaoPage, query);
  const listText = await listFrame.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  const candidates = parseQingmaoHotelCandidatesText(listText);
  const candidateIndex = candidates.findIndex((candidate) => candidate.hotelName === lockedCandidate.hotelName && candidate.address === lockedCandidate.address);
  const candidate = candidateIndex >= 0 ? candidates[candidateIndex] : lockedCandidate;
  const clickIndex = candidateIndex >= 0 ? candidateIndex : 0;

  const qingmaoStartedAt = Date.now();
  await clickQingmaoHotelCandidateDetail(listFrame, candidate, clickIndex);
  const qingmaoFrame = await waitForQingmaoHotelDetailFrame(qingmaoPage, candidate.hotelName);
  const detailText = await waitForQingmaoHotelDetailText(qingmaoFrame, candidate.hotelName);

  return HOTEL_RATE_PLAN_LABELS.flatMap((ratePlan) => {
    const rate = parseQingmaoHotelMainRatesText(detailText, ratePlan)
      .find((item) => item.status === "available" && typeof item.price === "number");
    return rate ? [{ ...rate, finalUrl: qingmaoFrame.url() }] : [];
  });
}

async function runHotelRatePlanForCandidate(
  context: BrowserContext,
  qingmaoPage: BrowserPage,
  artifactDir: string,
  query: QingmaoHotelCandidateQuery,
  lockedCandidate: QingmaoHotelCandidate,
  ratePlan: HotelRatePlanLabel
): Promise<{ status: "completed" | "partial"; selectedCandidate: QingmaoHotelCandidate; quotes: HotelMainRateQuote[]; message: string }> {
  await fsp.mkdir(artifactDir, { recursive: true });
  const listFrame = await searchQingmaoHotelCandidates(qingmaoPage, query);
  const listText = await listFrame.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  const candidates = parseQingmaoHotelCandidatesText(listText);
  const candidateIndex = candidates.findIndex((candidate) => candidate.hotelName === lockedCandidate.hotelName);
  const candidate = candidateIndex >= 0 ? candidates[candidateIndex] : lockedCandidate;
  const clickIndex = candidateIndex >= 0 ? candidateIndex : 0;

  const qingmaoStartedAt = Date.now();
  await clickQingmaoHotelCandidateDetail(listFrame, candidate, clickIndex);
  const qingmaoFrame = await waitForQingmaoHotelDetailFrame(qingmaoPage, candidate.hotelName);
  const detailText = await waitForQingmaoHotelDetailText(qingmaoFrame, candidate.hotelName);
  let rates = parseQingmaoHotelMainRatesText(detailText, ratePlan);
  if (!rates.some((item) => item.status === "available" && typeof item.price === "number")) {
    await filterQingmaoHotelMainRate(qingmaoFrame, candidate.hotelName, ratePlan);
    const filteredText = await waitForQingmaoHotelDetailText(qingmaoFrame, candidate.hotelName, ratePlan);
    rates = parseQingmaoHotelMainRatesText(filteredText, ratePlan);
  }
  const qingmaoQuote = rates.find((item) => item.status === "available" && typeof item.price === "number") ?? null;
  if (!qingmaoQuote) {
    throw new Error(`青猫无${ratePlan}`);
  }

  const qingmaoDurationMs = Date.now() - qingmaoStartedAt;
  const pagesBeforeCandidate = snapshotBrowserPages(context);
  try {
    const ctripQuote = await searchCtripHotelMainRateQuote(context, artifactDir, query, candidate, ratePlan);
    const aliQuote = await searchAliHotelMainRateQuote(context, artifactDir, query, candidate, ratePlan);
    const ztripQuote = await searchZtripHotelMainRateQuote(context, artifactDir, buildZtripHotelQueryFromQingmao(query), candidate, ratePlan);
    const screenshotPath = path.join(artifactDir, hotelRatePlanEvidenceName("青猫差旅", ratePlan));
    const bodyText = await waitForQingmaoHotelDetailText(qingmaoFrame, candidate.hotelName);
    const evidencePath = await savePageEvidence(qingmaoPage, screenshotPath, {
      platform: "青猫差旅",
      finalUrl: qingmaoFrame.url(),
      bodyText,
      price: qingmaoQuote.price,
      rawText: qingmaoQuote.rawText
    });
    const quotes: HotelMainRateQuote[] = [
      {
        ...qingmaoQuote,
        finalUrl: qingmaoFrame.url(),
        screenshotPath: evidencePath,
        durationMs: qingmaoDurationMs
      },
      ctripQuote,
      aliQuote,
      ztripQuote
    ];
    const complete = quotes.every((quote) => quote.status === "available" && typeof quote.price === "number");
    const missing = quotes
      .filter((quote) => quote.status !== "available" || typeof quote.price !== "number")
      .map((quote) => `${quote.platform}${quote.error ? ` ${quote.error}` : ""}`);

    return {
      status: complete ? "completed" : "partial",
      selectedCandidate: candidate,
      quotes,
      message: complete ? `${candidate.hotelName} ${ratePlan}四平台完整` : `${candidate.hotelName} ${ratePlan}不完整：${missing.join("，")}`
    };
  } finally {
    await closeCreatedBrowserPages(context, pagesBeforeCandidate, new Set([qingmaoPage]));
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

function resolveBrowserExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? "",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  ];

  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function launchOptions(headless: boolean) {
  const executablePath = resolveBrowserExecutable();
  const options: Record<string, unknown> = {
    headless,
    viewport: { width: 1440, height: 960 }
  };

  if (executablePath) {
    options.executablePath = executablePath;
  }

  return options;
}

function openChromeLoginWindow(profileDir: string, urls: string[], debuggingPort: number) {
  const executablePath = resolveBrowserExecutable();
  if (!executablePath) {
    throw new Error("未找到本机 Chrome、Edge 或 Chromium");
  }

  const child = spawn(executablePath, [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${debuggingPort}`,
    "--remote-allow-origins=*",
    "--new-window",
    ...urls
  ], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

function missingPlaywrightResult(base: PilotResult, error: unknown): PilotResult {
  return {
    ...base,
    status: "failed",
    updatedAt: new Date().toISOString(),
    message: "Playwright 启动失败，请先安装浏览器运行环境",
    platforms: base.platforms.map((platform) => ({
      ...platform,
      outcome: "failed",
      note: "需要执行 npm install playwright 并安装 Chromium",
      error: errorMessage(error)
    }))
  };
}

export function createPlaywrightPilotCollector(options: PilotCollectorOptions): PilotCollector {
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;
  const remoteDebuggingPort = options.remoteDebuggingPort ?? 9223;
  let loginContext: BrowserContext | null = null;
  let latest: PilotResult = {
    status: "idle",
    route: buildPilotRoute(now()),
    profileDir: options.profileDir,
    platforms: buildPlatformStatus(),
    updatedAt: null,
    message: "等待打开登录浏览器"
  };
  let latestQingmaoCandidates: QingmaoCandidateProbeResult = {
    status: "idle",
    route: buildPilotRoute(now()),
    candidates: [],
    totalFlights: null,
    updatedAt: null,
    message: "等待读取青猫航班候选池"
  };
  let latestSameFlightComparison: SameFlightComparisonProbeResult = {
    status: "idle",
    route: buildPilotRoute(now()),
    selectedFlight: null,
    quotes: [],
    updatedAt: null,
    message: "等待随机抽取同航班并查询竞品"
  };
  let latestQingmaoHotelCandidates: QingmaoHotelCandidateProbeResult = buildInitialQingmaoHotelCandidateProbeResult(now());
  let latestHotelMainRate: HotelMainRateProbeResult = buildInitialHotelMainRateProbeResult(now());
  let latestHotelGroupMainRate: HotelGroupMainRateProbeResult = buildInitialHotelGroupMainRateProbeResult();
  let latestHotelSingleDiagnosis: HotelSingleDiagnosisProbeResult = buildInitialHotelSingleDiagnosisResult();
  let latestAliHotelSingleVerify: AliHotelSingleVerifyResult = buildInitialAliHotelSingleVerifyResult();
  let latestAliHotelMatch: AliHotelMatchProbeResult = buildInitialAliHotelMatchProbeResult();
  let latestHotelRatePlanProbe: HotelRatePlanProbeResult = buildInitialHotelRatePlanProbeResult();
  let latestHotelAllRatePlan: HotelAllRatePlanProbeResult = buildInitialHotelAllRatePlanProbeResult(now());
  let latestHotelCalibration: HotelCalibrationResult = buildInitialHotelCalibrationResult(now());
  let latestZtrip: ZtripProbeResult = buildInitialZtripProbeResult();
  let latestZtripFlight: ZtripFlightProbeResult = buildInitialZtripFlightProbeResult(now());
  let latestZtripHotel: ZtripHotelProbeResult = buildInitialZtripHotelProbeResult(now());

  return {
    getStatus() {
      return latest;
    },

    getQingmaoCandidateStatus() {
      return latestQingmaoCandidates;
    },

    getQingmaoHotelCandidateStatus() {
      return latestQingmaoHotelCandidates;
    },

    getHotelMainRateStatus() {
      return latestHotelMainRate;
    },

    getHotelGroupMainRateStatus() {
      return latestHotelGroupMainRate;
    },

    getHotelSingleDiagnosisStatus() {
      return latestHotelSingleDiagnosis;
    },

    getAliHotelSingleVerifyStatus() {
      return latestAliHotelSingleVerify;
    },

    getAliHotelMatchStatus() {
      return latestAliHotelMatch;
    },

    getHotelRatePlanProbeStatus() {
      return latestHotelRatePlanProbe;
    },

    getHotelAllRatePlanStatus() {
      return latestHotelAllRatePlan;
    },

    getHotelCalibrationStatus() {
      return latestHotelCalibration;
    },

    getSameFlightComparisonStatus() {
      return latestSameFlightComparison;
    },

    getZtripStatus() {
      return latestZtrip;
    },

    getZtripFlightStatus() {
      return latestZtripFlight;
    },

    getZtripHotelStatus() {
      return latestZtripHotel;
    },

    async openLoginSession() {
      const base: PilotResult = {
        ...latest,
        status: "login-browser-open",
        route: buildPilotRoute(now()),
        updatedAt: new Date().toISOString(),
        message: "请在弹出的浏览器中完成四平台人工登录"
      };

      try {
        if (loginContext) {
          await loginContext.close();
          loginContext = null;
        }

        await fsp.mkdir(options.profileDir, { recursive: true });
        const platforms = buildPlatformStatus();
        const loginUrls = platforms
          .filter((platform) => platform.configured && platform.loginUrl)
          .map((platform) => platform.loginUrl as string);

        await (options.openLoginWindow ?? (async (profileDir, urls, debuggingPort) => openChromeLoginWindow(profileDir, urls, debuggingPort)))(
          options.profileDir,
          loginUrls,
          remoteDebuggingPort
        );

        const openedPlatforms: PilotPlatformState[] = [];
        for (const platform of platforms) {
          if (!platform.configured || !platform.loginUrl) {
            openedPlatforms.push({ ...platform, outcome: "needs-config", note: "请先配置该平台入口地址" });
            continue;
          }

          openedPlatforms.push({ ...platform, outcome: "opened", note: "已用普通 Chrome 打开，请人工登录；登录完成后保持窗口打开，再运行附着探测" });
        }

        latest = { ...base, platforms: openedPlatforms };
        return latest;
      } catch (error) {
        latest = missingPlaywrightResult(base, error);
        return latest;
      }
    },

    async runSilentProbe() {
      const base: PilotResult = {
        ...latest,
        status: "running",
        route: buildPilotRoute(now()),
        updatedAt: new Date().toISOString(),
        message: "正在后台静默探测四平台页面"
      };
      latest = base;

      try {
        if (loginContext) {
          await loginContext.close();
          loginContext = null;
        }

        await fsp.mkdir(options.profileDir, { recursive: true });
        await fsp.mkdir(options.artifactDir, { recursive: true });
        const chromium = await loadChromium();
        const context = await chromium.launchPersistentContext(options.profileDir, launchOptions(true));
        const platforms: PilotPlatformState[] = [];

        platforms.push(...(await probePlatformsInContext(context, options.artifactDir, "后台页面可访问", "后台静默访问失败")));

        await context.close();
        latest = {
          ...base,
          status: platforms.some((platform) => platform.outcome === "failed") ? "failed" : "completed",
          platforms,
          updatedAt: new Date().toISOString(),
          message: "后台静默探测完成"
        };
        return latest;
      } catch (error) {
        latest = missingPlaywrightResult(base, error);
        return latest;
      }
    },

    async runAttachedProbe() {
      const base: PilotResult = {
        ...latest,
        status: "running",
        route: buildPilotRoute(now()),
        updatedAt: new Date().toISOString(),
        message: "正在附着到已打开的 Chrome 登录窗口"
      };
      latest = base;

      try {
        await fsp.mkdir(options.artifactDir, { recursive: true });
        const chromium = await loadChromium();
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`);
        const context = browser.contexts()[0];

        if (!context) {
          await browser.disconnect?.();
          throw new Error("未找到可附着的 Chrome 浏览器上下文");
        }

        const platforms = await probePlatformsInContext(context, options.artifactDir, "已附着到登录窗口", "附着窗口访问失败");
        await browser.disconnect?.();

        latest = {
          ...base,
          status: platforms.some((platform) => platform.outcome === "failed") ? "failed" : "completed",
          platforms,
          updatedAt: new Date().toISOString(),
          message: "附着探测完成"
        };
        return latest;
      } catch (error) {
        latest = {
          ...base,
          status: "failed",
          updatedAt: new Date().toISOString(),
          message: "附着探测失败，请确认登录窗口保持打开",
          platforms: buildPlatformStatus().map((platform) => ({
            ...platform,
            outcome: "failed",
            note: "无法附着到普通 Chrome 登录窗口",
            error: errorMessage(error)
          }))
        };
        return latest;
      }
    },

    async runQingmaoCandidateProbe() {
      const base: QingmaoCandidateProbeResult = {
        ...latestQingmaoCandidates,
        status: "running",
        route: buildPilotRoute(now()),
        candidates: [],
        totalFlights: null,
        updatedAt: new Date().toISOString(),
        message: "正在读取青猫差旅候选航班"
      };
      latestQingmaoCandidates = base;

      try {
        await fsp.mkdir(options.artifactDir, { recursive: true });
        const chromium = await loadChromium();
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`);
        const context = browser.contexts()[0];

        if (!context) {
          await browser.disconnect?.();
          throw new Error("未找到可附着的 Chrome 浏览器上下文");
        }

        const page = findExistingPage(context, platformUrls.青猫差旅);
        if (!page) {
          await browser.disconnect?.();
          throw new Error("未找到青猫差旅已登录页面，请先打开登录浏览器并保持窗口打开");
        }

        const route = buildPilotRoute(now());
        await openQingmaoDomesticFlightTab(page);
        const frame = findQingmaoFlightFrame(page);

        if (!frame) {
          await browser.disconnect?.();
          throw new Error("未找到青猫机票 iframe，可能页面尚未加载完成或入口结构变化");
        }

        await searchQingmaoFlightRoute(frame, route);
        const candidates = await extractQingmaoFlightCandidates(frame);
        const totalFlights = await readQingmaoTotalFlightCount(frame);
        const screenshotPath = path.join(options.artifactDir, "青猫差旅-候选航班.png");
        await page.screenshot({ path: screenshotPath, fullPage: true });
        await browser.disconnect?.();

        latestQingmaoCandidates = {
          ...base,
          status: "completed",
          route,
          candidates,
          totalFlights,
          screenshotPath,
          finalUrl: page.url(),
          updatedAt: new Date().toISOString(),
          message: candidates.length > 0 ? `已读取青猫差旅 ${candidates.length} 条候选航班` : "青猫差旅页面可搜索，但未读取到候选航班"
        };
        return latestQingmaoCandidates;
      } catch (error) {
        latestQingmaoCandidates = {
          ...base,
          status: "failed",
          updatedAt: new Date().toISOString(),
          message: "青猫候选航班读取失败",
          error: errorMessage(error)
        };
        return latestQingmaoCandidates;
      }
    },

    async runQingmaoHotelCandidateProbe() {
      const query = buildQingmaoHotelCandidateQuery(now());
      const base: QingmaoHotelCandidateProbeResult = {
        ...latestQingmaoHotelCandidates,
        status: "running",
        query,
        candidates: [],
        selectedCandidate: null,
        totalHotels: null,
        updatedAt: new Date().toISOString(),
        message: "正在读取青猫酒店候选池"
      };
      latestQingmaoHotelCandidates = base;

      let browser: BrowserConnection | null = null;

      try {
        await fsp.mkdir(options.artifactDir, { recursive: true });
        const chromium = await loadChromium();
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`);
        const context = browser.contexts()[0];

        if (!context) {
          throw new Error("未找到可附着的 Chrome 浏览器上下文");
        }

        const qingmaoPage = findExistingPage(context, platformUrls.青猫差旅);
        if (!qingmaoPage) {
          throw new Error("未找到青猫差旅已登录页面，请先打开登录浏览器并保持窗口打开");
        }

        const frame = await searchQingmaoHotelCandidates(qingmaoPage, query);
        const bodyText = await frame.locator("body").innerText({ timeout: 8_000 }).catch(() => "");
        const candidates = parseQingmaoHotelCandidatesText(bodyText).slice(0, 20);
        const totalHotels = readQingmaoHotelTotalCount(bodyText);
        const selectedCandidate = candidates.find((candidate) => typeof candidate.price === "number" && candidate.price > 0) ?? null;
        const screenshotPath = path.join(options.artifactDir, "青猫差旅-酒店候选池.png");
        const evidencePath = await savePageEvidence(qingmaoPage, screenshotPath, {
          platform: "青猫差旅",
          finalUrl: qingmaoPage.url(),
          bodyText,
          price: selectedCandidate?.price ?? null,
          rawText: selectedCandidate?.rawText
        });

        latestQingmaoHotelCandidates = {
          ...base,
          status: selectedCandidate ? "completed" : "failed",
          query,
          candidates,
          selectedCandidate,
          totalHotels,
          screenshotPath: evidencePath,
          finalUrl: qingmaoPage.url(),
          updatedAt: new Date().toISOString(),
          message: selectedCandidate
            ? `已读取青猫酒店候选池：${query.city} / ${query.keyword}，共 ${totalHotels ?? candidates.length} 家，解析 ${candidates.length} 家`
            : "青猫酒店候选池已打开，但未解析到可用酒店价格",
          error: selectedCandidate ? undefined : "未解析到酒店名称和价格"
        };
        return latestQingmaoHotelCandidates;
      } catch (error) {
        latestQingmaoHotelCandidates = {
          ...base,
          status: "failed",
          updatedAt: new Date().toISOString(),
          message: "青猫酒店候选池读取失败",
          error: errorMessage(error)
        };
        return latestQingmaoHotelCandidates;
      } finally {
        await browser?.disconnect?.();
      }
    },

    async runHotelMainRateProbe() {
      const query = buildQingmaoHotelCandidateQuery(now());
      const base: HotelMainRateProbeResult = {
        ...latestHotelMainRate,
        status: "running",
        query,
        selectedCandidate: null,
        quotes: [],
        updatedAt: new Date().toISOString(),
        message: `正在验证酒店当前口径${HOTEL_VALIDATION_RATE_PLAN}`
      };
      latestHotelMainRate = base;

      let browser: BrowserConnection | null = null;

      try {
        await fsp.mkdir(options.artifactDir, { recursive: true });
        const chromium = await loadChromium();
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`);
        const context = browser.contexts()[0];

        if (!context) {
          throw new Error("未找到可附着的 Chrome 浏览器上下文");
        }

        const qingmaoPage = findExistingPage(context, platformUrls.青猫差旅);
        if (!qingmaoPage) {
          throw new Error("未找到青猫差旅已登录页面，请先打开登录浏览器并保持窗口打开");
        }

        let selectedCandidate: QingmaoHotelCandidate | null = null;
        let qingmaoQuote: HotelMainRateQuote | null = null;
        let ctripQuote: HotelMainRateQuote | null = null;
        let aliQuote: HotelMainRateQuote | null = null;
        let ztripQuote: HotelMainRateQuote | null = null;
        let qingmaoFrame: BrowserFrame | null = null;
        let fallbackCandidate: QingmaoHotelCandidate | null = null;
        let fallbackQingmaoQuote: HotelMainRateQuote | null = null;
        let fallbackQingmaoFrame: BrowserFrame | null = null;
        let fallbackCompetitorQuotes: HotelMainRateQuote[] = [];
        let skipped: string[] = [];

        for (let attempt = 0; attempt < 12; attempt += 1) {
          const listFrame = await searchQingmaoHotelCandidates(qingmaoPage, query);
          const listText = await listFrame.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
          const candidates = parseQingmaoHotelCandidatesText(listText);
          const candidate = candidates[attempt];
          if (!candidate) break;
          if (!isHotelCandidateRelevantForQuery(candidate, query)) {
            skipped.push(`${candidate.hotelName}: 不属于${query.keyword}候选`);
            continue;
          }
          if (!candidate.price || candidate.price <= 0) {
            skipped.push(`${candidate.hotelName}: 候选起价为空`);
            continue;
          }

          const qingmaoStartedAt = Date.now();
          await clickQingmaoHotelCandidateDetail(listFrame, candidate, attempt);
          qingmaoFrame = await waitForQingmaoHotelDetailFrame(qingmaoPage, candidate.hotelName);
          const detailText = await waitForQingmaoHotelDetailText(qingmaoFrame, candidate.hotelName);
          let rates = parseQingmaoHotelMainRatesText(detailText);
          if (!rates.some((item) => item.status === "available" && typeof item.price === "number")) {
            await filterQingmaoHotelMainRate(qingmaoFrame, candidate.hotelName, HOTEL_VALIDATION_RATE_PLAN);
            const filteredText = await qingmaoFrame.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
            rates = parseQingmaoHotelMainRatesText(filteredText);
          }
          const rate = rates.find((item) => item.status === "available" && typeof item.price === "number") ?? null;
          if (rate) {
            const qingmaoDurationMs = Date.now() - qingmaoStartedAt;
            const pagesBeforeCandidate = snapshotBrowserPages(context);
            const nextCtripQuote = await searchCtripHotelMainRateQuote(context, options.artifactDir, query, candidate);
            const nextAliQuote = await searchAliHotelMainRateQuote(context, options.artifactDir, query, candidate);
            const nextZtripQuote = await searchZtripHotelMainRateQuote(context, options.artifactDir, buildZtripHotelQuery(now()), candidate);
            const competitorQuotes = [nextCtripQuote, nextAliQuote, nextZtripQuote];

            if (!fallbackCandidate) {
              fallbackCandidate = candidate;
              fallbackQingmaoQuote = { ...rate, durationMs: qingmaoDurationMs };
              fallbackQingmaoFrame = qingmaoFrame;
              fallbackCompetitorQuotes = competitorQuotes;
            }

            const unavailable = competitorQuotes.filter((quote) => quote.status !== "available" || typeof quote.price !== "number");
            if (!unavailable.length) {
              selectedCandidate = candidate;
              qingmaoQuote = { ...rate, durationMs: qingmaoDurationMs };
              ctripQuote = nextCtripQuote;
              aliQuote = nextAliQuote;
              ztripQuote = nextZtripQuote;
              await closeCreatedBrowserPages(context, pagesBeforeCandidate, new Set([qingmaoPage]));
              break;
            }

            skipped.push(`${candidate.hotelName}: ${unavailable.map((quote) => `${quote.platform}${quote.error ? ` ${quote.error}` : `无${HOTEL_VALIDATION_RATE_PLAN}`}`).join("，")}`);
            await closeCreatedBrowserPages(context, pagesBeforeCandidate, new Set([qingmaoPage]));
            continue;
          }

          skipped.push(`${candidate.hotelName}: 青猫无${HOTEL_VALIDATION_RATE_PLAN}`);
        }

        const isComplete = Boolean(selectedCandidate && qingmaoQuote && qingmaoFrame && ctripQuote && aliQuote && ztripQuote);
        if (!isComplete && fallbackCandidate && fallbackQingmaoQuote && fallbackQingmaoFrame) {
          selectedCandidate = fallbackCandidate;
          qingmaoQuote = fallbackQingmaoQuote;
          qingmaoFrame = fallbackQingmaoFrame;
          [ctripQuote, aliQuote, ztripQuote] = fallbackCompetitorQuotes;
        }

        if (!selectedCandidate || !qingmaoQuote || !qingmaoFrame || !ctripQuote || !aliQuote || !ztripQuote) {
          throw new Error(`未找到青猫${HOTEL_VALIDATION_RATE_PLAN}可用酒店${skipped.length ? `：${skipped.slice(0, 6).join("；")}` : ""}`);
        }

        const screenshotPath = path.join(options.artifactDir, hotelRatePlanEvidenceName("青猫差旅", HOTEL_VALIDATION_RATE_PLAN));
        const bodyText = await qingmaoFrame.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
        const evidencePath = await savePageEvidence(qingmaoPage, screenshotPath, {
          platform: "青猫差旅",
          finalUrl: qingmaoFrame.url(),
          bodyText,
          price: qingmaoQuote.price,
          rawText: qingmaoQuote.rawText
        });

        const quotes: HotelMainRateQuote[] = [
          {
      ...qingmaoQuote,
      finalUrl: qingmaoFrame.url(),
      screenshotPath: evidencePath
          },
          ctripQuote,
          aliQuote,
          ztripQuote
        ];
        const ctripMessage = ctripQuote.status === "available" ? `携程商旅 ¥${ctripQuote.price}` : `携程商旅未完成：${ctripQuote.error ?? "未找到同口径价格"}`;
        const aliMessage = aliQuote.status === "available" ? `阿里商旅 ¥${aliQuote.price}` : `阿里商旅未完成：${aliQuote.error ?? "未找到同口径价格"}`;
        const ztripMessage = ztripQuote.status === "available" ? `在途商旅 ¥${ztripQuote.price}` : `在途商旅未完成：${ztripQuote.error ?? "未找到同口径价格"}`;
        const complete = quotes.every((quote) => quote.status === "available" && typeof quote.price === "number");

        latestHotelMainRate = {
          ...base,
          status: complete ? "completed" : "partial",
          selectedCandidate,
          quotes,
          updatedAt: new Date().toISOString(),
          message: `已找到酒店当前口径锚点：${selectedCandidate.hotelName}，青猫 ¥${qingmaoQuote.price}，${ctripMessage}，${aliMessage}，${ztripMessage}`,
          error: undefined
        };
        return latestHotelMainRate;
      } catch (error) {
        latestHotelMainRate = {
          ...base,
          status: "failed",
          updatedAt: new Date().toISOString(),
          message: "酒店主口径验证失败",
          error: errorMessage(error)
        };
        return latestHotelMainRate;
      } finally {
        await browser?.disconnect?.();
      }
    },

    async runHotelGroupMainRateProbe() {
      const base: HotelGroupMainRateProbeResult = {
        status: "running",
        samples: [],
        updatedAt: new Date().toISOString(),
        message: "正在验证每个集团 1 家酒店主口径"
      };
      latestHotelGroupMainRate = base;

      let browser: BrowserConnection | null = null;

      try {
        await fsp.mkdir(options.artifactDir, { recursive: true });
        const chromium = await loadChromium();
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`);
        const context = browser.contexts()[0];

        if (!context) {
          throw new Error("未找到可附着的 Chrome 浏览器上下文");
        }

        const qingmaoPage = findExistingPage(context, platformUrls.青猫差旅);
        if (!qingmaoPage) {
          throw new Error("未找到青猫差旅已登录页面，请先打开登录浏览器并保持窗口打开");
        }

        const samples: HotelGroupMainRateSample[] = [];
        for (const [groupIndex, config] of hotelGroupPilotQueries.entries()) {
          const query = buildHotelCandidateQuery(now(), config.keyword, config.city ?? "广州");
          const groupArtifactDir = path.join(options.artifactDir, "hotel-groups", safeFilename(config.group));
          const pagesBeforeGroup = snapshotBrowserPages(context);
          const updateGroupProgress = (detail: string) => {
            latestHotelGroupMainRate = {
              ...base,
              status: "running",
              samples,
              updatedAt: new Date().toISOString(),
              message: `正在验证每个集团 1 家酒店主口径：${config.group}（${groupIndex + 1}/${hotelGroupPilotQueries.length}），${detail}`
            };
          };

          updateGroupProgress(`每组最多尝试 ${HOTEL_GROUP_MAIN_RATE_MAX_ATTEMPTS} 家`);

          try {
            const result = await runHotelMainRateForQuery(
              context,
              qingmaoPage,
              groupArtifactDir,
              query,
              HOTEL_VALIDATION_RATE_PLAN,
              HOTEL_GROUP_MAIN_RATE_MAX_ATTEMPTS,
              updateGroupProgress
            );
            samples.push({
              group: config.group,
              query,
              status: result.status,
              selectedCandidate: result.selectedCandidate,
              quotes: result.quotes,
              message: result.message
            });
          } catch (error) {
            samples.push({
              group: config.group,
              query,
              status: "failed",
              selectedCandidate: null,
              quotes: [],
              message: `${config.group} 酒店主口径验证失败`,
              error: errorMessage(error)
            });
          } finally {
            await closeCreatedBrowserPages(context, pagesBeforeGroup, new Set([qingmaoPage]));
          }

          latestHotelGroupMainRate = {
            ...base,
            status: "running",
            samples,
            updatedAt: new Date().toISOString(),
            message: `正在验证每个集团 1 家酒店主口径：已处理 ${samples.length}/${hotelGroupPilotQueries.length}`
          };
        }

        const completed = samples.filter((sample) => sample.status === "completed").length;
        const partial = samples.filter((sample) => sample.status === "partial").length;
        latestHotelGroupMainRate = {
          status: completed === samples.length ? "completed" : completed + partial > 0 ? "partial" : "failed",
          samples,
          updatedAt: new Date().toISOString(),
          message: `已完成每个集团 1 家酒店主口径验证：完整 ${completed}/${samples.length}，部分 ${partial}/${samples.length}`
        };
        return latestHotelGroupMainRate;
      } catch (error) {
        latestHotelGroupMainRate = {
          ...base,
          status: "failed",
          updatedAt: new Date().toISOString(),
          message: "每个集团 1 家酒店主口径验证失败",
          error: errorMessage(error)
        };
        return latestHotelGroupMainRate;
      } finally {
        await browser?.disconnect?.();
      }
    },

    async runHotelSingleDiagnosisProbe(input: HotelSingleDiagnosisInput) {
      const query = hotelSingleDiagnosisQueryFromInput(input);
      const runId = `single-hotel-${formatBatchTimestamp(now())}`;
      const artifactDir = path.join(options.artifactDir, "hotel-single-diagnosis", runId);
      let platforms = HOTEL_SINGLE_DIAGNOSIS_PLATFORMS.map(buildPendingHotelSingleDiagnosisPlatform);
      latestHotelSingleDiagnosis = {
        status: "running",
        input,
        selectedCandidate: null,
        platforms,
        updatedAt: new Date().toISOString(),
        message: `正在严格诊断单酒店：${input.city}/${input.keyword}/${input.ratePlan}`
      };

      const updatePlatform = (platform: PlatformName, patch: Partial<HotelSingleDiagnosisPlatformResult>) => {
        platforms = platforms.map((item) => (item.platform === platform ? { ...item, ...patch } : item));
        latestHotelSingleDiagnosis = {
          ...latestHotelSingleDiagnosis,
          platforms,
          updatedAt: new Date().toISOString()
        };
      };
      const finishPlatform = (result: HotelSingleDiagnosisPlatformResult) => {
        updatePlatform(result.platform, result);
      };

      let browser: BrowserConnection | null = null;
      let pagesBeforeRun: Set<BrowserPage> | null = null;
      let qingmaoPage: BrowserPage | null = null;

      try {
        await fsp.mkdir(artifactDir, { recursive: true });
        const chromium = await loadChromium();
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`);
        const context = browser.contexts()[0];
        if (!context) {
          throw new Error("未找到可附着的 Chrome 浏览器上下文");
        }

        pagesBeforeRun = snapshotBrowserPages(context);
        qingmaoPage = findExistingPage(context, platformUrls.青猫差旅);
        if (!qingmaoPage) {
          throw new Error("未找到青猫差旅已登录页面，请先打开登录浏览器并保持窗口打开");
        }

        const qingmaoDiagnosis = await diagnoseQingmaoSingleHotel(qingmaoPage, artifactDir, query, input.ratePlan, updatePlatform);
        finishPlatform(qingmaoDiagnosis.result);
        latestHotelSingleDiagnosis = {
          ...latestHotelSingleDiagnosis,
          selectedCandidate: qingmaoDiagnosis.candidate,
          updatedAt: new Date().toISOString()
        };

        const candidate = qingmaoDiagnosis.candidate;
        const qingmaoReady = candidate && qingmaoDiagnosis.result.step === "success" && typeof qingmaoDiagnosis.result.price === "number";
        if (!candidate || !qingmaoReady) {
          const sourceDoorPlate = candidate ? extractHotelDoorPlate(candidate.address) : null;
          for (const platform of ["携程商旅", "阿里商旅", "在途商旅"] as PlatformName[]) {
            finishPlatform({
              platform,
              step: "failed",
              sameHotel: null,
              matchBasis: "青猫未形成有效源酒店",
              sourceDoorPlate,
              targetDoorPlate: null,
              durationMs: 0,
              price: null,
              error: qingmaoDiagnosis.result.error ?? `青猫未找到${input.ratePlan}价格`
            });
          }
        } else {
          finishPlatform(await diagnoseCtripSingleHotel(context, artifactDir, query, candidate, input.ratePlan, updatePlatform));
          finishPlatform(await diagnoseAliSingleHotel(context, artifactDir, query, candidate, input.ratePlan, updatePlatform));
          finishPlatform(await diagnoseZtripSingleHotel(context, artifactDir, query, candidate, input.ratePlan, updatePlatform));
        }

        latestHotelSingleDiagnosis = {
          status: "completed",
          input,
          selectedCandidate: candidate,
          platforms,
          updatedAt: new Date().toISOString(),
          message: `严格单酒店诊断完成：${candidate?.hotelName ?? "未锁定青猫酒店"}`
        };
        return latestHotelSingleDiagnosis;
      } catch (error) {
        latestHotelSingleDiagnosis = {
          ...latestHotelSingleDiagnosis,
          status: "failed",
          updatedAt: new Date().toISOString(),
          message: "严格单酒店诊断失败",
          error: errorMessage(error)
        };
        return latestHotelSingleDiagnosis;
      } finally {
        if (browser) {
          const context = browser.contexts()[0];
          if (context && pagesBeforeRun) {
            await closeCreatedBrowserPages(context, pagesBeforeRun, qingmaoPage ? new Set([qingmaoPage]) : new Set()).catch(() => undefined);
          }
        }
        await browser?.disconnect?.();
      }
    },

    async runAliHotelSingleVerifyProbe(input: AliHotelSingleVerifyInput) {
      const query = aliHotelSingleVerifyQueryFromInput(input);
      const candidate = aliHotelSingleVerifyCandidateFromInput(input);
      const runId = `ali-hotel-single-${formatBatchTimestamp(now())}`;
      const artifactDir = path.join(options.artifactDir, "ali-hotel-single", runId);
      const diagnosisPath = path.join(artifactDir, "alibtrip-list-diagnosis.json");
      latestAliHotelSingleVerify = {
        status: "running",
        input,
        selectedCandidate: candidate,
        result: null,
        artifactDir,
        diagnosisPath,
        updatedAt: new Date().toISOString(),
        message: `正在阿里-only复验：${input.city}/${input.hotelName}/${input.ratePlan}`
      };

      let browser: BrowserConnection | null = null;
      let pagesBeforeRun: Set<BrowserPage> | null = null;

      try {
        await fsp.mkdir(artifactDir, { recursive: true });
        const chromium = await loadChromium();
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`);
        const context = browser.contexts()[0];
        if (!context) {
          throw new Error("未找到可附着的 Chrome 浏览器上下文");
        }

        pagesBeforeRun = snapshotBrowserPages(context);
        const result = await diagnoseAliHotelCalibration(context, artifactDir, query, candidate);
        latestAliHotelSingleVerify = {
          status: "completed",
          input,
          selectedCandidate: candidate,
          result,
          artifactDir,
          diagnosisPath,
          updatedAt: new Date().toISOString(),
          message: `阿里-only复验完成：${input.hotelName}`
        };
        return latestAliHotelSingleVerify;
      } catch (error) {
        latestAliHotelSingleVerify = {
          ...latestAliHotelSingleVerify,
          status: "failed",
          updatedAt: new Date().toISOString(),
          message: "阿里-only复验失败",
          error: errorMessage(error)
        };
        return latestAliHotelSingleVerify;
      } finally {
        if (browser) {
          const context = browser.contexts()[0];
          if (context && pagesBeforeRun) {
            await closeCreatedBrowserPages(context, pagesBeforeRun).catch(() => undefined);
          }
        }
        await browser?.disconnect?.();
      }
    },

    async runAliHotelMatchProbe(limit = 3) {
      const query = buildHotelCandidateQuery(now(), "如家商旅", "广州");
      const base: AliHotelMatchProbeResult = {
        status: "running",
        samples: [],
        updatedAt: new Date().toISOString(),
        message: `正在验证阿里商旅同店匹配：0/${limit}`
      };
      latestAliHotelMatch = base;

      let browser: BrowserConnection | null = null;

      try {
        await fsp.mkdir(options.artifactDir, { recursive: true });
        const chromium = await loadChromium();
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`);
        const context = browser.contexts()[0];
        if (!context) {
          throw new Error("未找到可附着的 Chrome 浏览器上下文");
        }

        const qingmaoPage = findExistingPage(context, platformUrls.青猫差旅);
        if (!qingmaoPage) {
          throw new Error("未找到青猫差旅已登录页面，请先打开登录浏览器并保持窗口打开");
        }

        const listFrame = await searchQingmaoHotelCandidates(qingmaoPage, query);
        const listText = await listFrame.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
        const candidates = parseQingmaoHotelCandidatesText(listText)
          .filter((candidate) => isHotelCandidateRelevantForQuery(candidate, query) && Boolean(candidate.price && candidate.price > 0))
          .slice(0, limit);
        const samples: AliHotelMatchProbeSample[] = [];

        for (const [index, candidate] of candidates.entries()) {
          const pagesBeforeCandidate = snapshotBrowserPages(context);
          latestAliHotelMatch = {
            ...base,
            samples,
            updatedAt: new Date().toISOString(),
            message: `正在验证阿里商旅同店匹配：第 ${index + 1}/${candidates.length} 家 ${candidate.hotelName}`
          };

          try {
            await clickQingmaoHotelCandidateDetail(listFrame, candidate, index);
            const qingmaoFrame = await waitForQingmaoHotelDetailFrame(qingmaoPage, candidate.hotelName);
            const detailText = await waitForQingmaoHotelDetailText(qingmaoFrame, candidate.hotelName);
            const qingmaoQuote = parseQingmaoHotelMainRatesText(detailText, HOTEL_VALIDATION_RATE_PLAN)
              .find((item) => item.status === "available" && typeof item.price === "number") ?? null;
            if (!qingmaoQuote) {
              samples.push({
                query,
                selectedCandidate: candidate,
                qingmaoQuote: null,
                aliQuote: null,
                status: "failed",
                message: `${candidate.hotelName} 青猫无${HOTEL_VALIDATION_RATE_PLAN}`,
                error: `青猫无${HOTEL_VALIDATION_RATE_PLAN}`
              });
              continue;
            }

            const aliQuote = await searchAliHotelMainRateQuote(context, path.join(options.artifactDir, "ali-hotel-match"), query, candidate, HOTEL_VALIDATION_RATE_PLAN);
            const completed = aliQuote.status === "available" && typeof aliQuote.price === "number";
            samples.push({
              query,
              selectedCandidate: candidate,
              qingmaoQuote,
              aliQuote,
              status: completed ? "completed" : "partial",
              message: completed
                ? `${candidate.hotelName} 阿里同店成功，阿里 ¥${aliQuote.price}`
                : `${candidate.hotelName} 阿里未完成：${aliQuote.error ?? "未找到同口径价格"}`
            });
          } catch (error) {
            samples.push({
              query,
              selectedCandidate: candidate,
              qingmaoQuote: null,
              aliQuote: null,
              status: "failed",
              message: `${candidate.hotelName} 阿里单平台验证失败`,
              error: errorMessage(error)
            });
          } finally {
            await closeCreatedBrowserPages(context, pagesBeforeCandidate, new Set([qingmaoPage]));
          }

          latestAliHotelMatch = {
            ...base,
            samples,
            updatedAt: new Date().toISOString(),
            message: `正在验证阿里商旅同店匹配：已处理 ${samples.length}/${candidates.length}`
          };
        }

        const completed = samples.filter((sample) => sample.status === "completed").length;
        latestAliHotelMatch = {
          status: completed === samples.length ? "completed" : completed > 0 ? "partial" : "failed",
          samples,
          updatedAt: new Date().toISOString(),
          message: `阿里商旅同店匹配验证完成：成功 ${completed}/${samples.length}`
        };
        return latestAliHotelMatch;
      } catch (error) {
        latestAliHotelMatch = {
          ...base,
          status: "failed",
          updatedAt: new Date().toISOString(),
          message: "阿里商旅同店匹配验证失败",
          error: errorMessage(error)
        };
        return latestAliHotelMatch;
      } finally {
        await browser?.disconnect?.();
      }
    },

    async runHotelRatePlanProbe() {
      const base: HotelRatePlanProbeResult = {
        status: "running",
        plans: [],
        recommendedRatePlan: null,
        updatedAt: new Date().toISOString(),
        message: "正在按 5 个集团随机抽样酒店，统计 4 个房型早餐口径占比"
      };
      latestHotelRatePlanProbe = base;

      let browser: BrowserConnection | null = null;

      try {
        await fsp.mkdir(options.artifactDir, { recursive: true });
        const chromium = await loadChromium();
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`);
        const context = browser.contexts()[0];

        if (!context) {
          throw new Error("未找到可附着的 Chrome 浏览器上下文");
        }

        const qingmaoPage = findExistingPage(context, platformUrls.青猫差旅);
        if (!qingmaoPage) {
          throw new Error("未找到青猫差旅已登录页面，请先打开登录浏览器并保持窗口打开");
        }

        const sampledHotels: Array<{
          group: HotelGroupName;
          query: QingmaoHotelCandidateQuery;
          candidate: QingmaoHotelCandidate | null;
          quotes: HotelMainRateQuote[];
          durationMs: number;
          error?: string;
        }> = [];
        const sampleLimitPerGroup = 10;

        for (const config of hotelGroupPilotQueries) {
          const query = buildHotelCandidateQuery(now(), config.keyword, config.city ?? "广州");
          const pagesBeforeGroup = snapshotBrowserPages(context);
          try {
            const candidates = await selectHotelCandidatesForQuery(qingmaoPage, query, sampleLimitPerGroup, random);
            if (!candidates.length) {
              sampledHotels.push({
                group: config.group,
                query,
                candidate: null,
                quotes: [],
                durationMs: 0,
                error: `未找到${config.keyword}可用酒店候选`
              });
            }

            for (const candidate of candidates) {
              const sampleStartedAt = Date.now();
              const pagesBeforeHotel = snapshotBrowserPages(context);
              try {
                const quotes = await readQingmaoHotelRatePlanPresence(qingmaoPage, query, candidate);
                sampledHotels.push({
                  group: config.group,
                  query,
                  candidate,
                  quotes,
                  durationMs: Date.now() - sampleStartedAt
                });
              } catch (error) {
                sampledHotels.push({
                  group: config.group,
                  query,
                  candidate,
                  quotes: [],
                  durationMs: Date.now() - sampleStartedAt,
                  error: errorMessage(error)
                });
              } finally {
                await closeCreatedBrowserPages(context, pagesBeforeHotel, new Set([qingmaoPage]));
              }

              latestHotelRatePlanProbe = {
                ...base,
                updatedAt: new Date().toISOString(),
                message: `正在统计${config.group}口径占比：已处理 ${Math.min(candidates.indexOf(candidate) + 1, candidates.length)}/${candidates.length}，累计 ${sampledHotels.length} 家`
              };
            }
          } catch (error) {
            sampledHotels.push({
              group: config.group,
              query,
              candidate: null,
              quotes: [],
              durationMs: 0,
              error: errorMessage(error)
            });
          } finally {
            await closeCreatedBrowserPages(context, pagesBeforeGroup, new Set([qingmaoPage]));
          }
        }

        const plans: HotelRatePlanProbeSummary[] = [];
        for (const ratePlan of HOTEL_RATE_PLAN_LABELS) {
          const planStartedAt = Date.now();
          const samples: HotelRatePlanProbeSample[] = sampledHotels.map((item) => {
            const quote = item.quotes.find((candidateQuote) => candidateQuote.ratePlan === ratePlan) ?? null;
            return {
              group: item.group,
              query: item.query,
              selectedCandidate: item.candidate,
              status: quote ? "completed" : "failed",
              quotes: quote ? [quote] : [],
              durationMs: item.durationMs,
              message: quote
                ? `${item.candidate?.hotelName ?? item.group} 存在${ratePlan}`
                : `${item.candidate?.hotelName ?? item.group} 未发现${ratePlan}`,
              error: quote ? undefined : item.error ?? `未发现${ratePlan}`
            };
          });

          const completedCount = samples.filter((sample) => sample.status === "completed").length;
          const partialCount = samples.filter((sample) => sample.status === "partial").length;
          const failedCount = samples.filter((sample) => sample.status === "failed").length;
          plans.push({
            ratePlan,
            status: completedCount === samples.length ? "completed" : completedCount + partialCount > 0 ? "partial" : "failed",
            completedCount,
            partialCount,
            failedCount,
            completeRate: samples.length ? completedCount / samples.length : 0,
            durationMs: Date.now() - planStartedAt,
            samples
          });
        }

        const bestCompleted = Math.max(...plans.map((plan) => plan.completedCount));
        const bestPlans = plans.filter((plan) => plan.completedCount === bestCompleted);
        const recommendedRatePlan = bestCompleted > 0 && bestPlans.length === 1 ? bestPlans[0].ratePlan : null;
        const summaryText = plans.map((plan) => `${plan.ratePlan}出现 ${plan.completedCount}/${plan.samples.length}`).join("，");

        latestHotelRatePlanProbe = {
          status: plans.every((plan) => plan.status === "completed") ? "completed" : plans.some((plan) => plan.completedCount > 0 || plan.partialCount > 0) ? "partial" : "failed",
          plans,
          recommendedRatePlan,
          updatedAt: new Date().toISOString(),
          message: recommendedRatePlan
            ? `集团口径占比探针完成：${summaryText}；按出现率建议 ${recommendedRatePlan}`
            : `集团口径占比探针完成：${summaryText}；最高出现率并列，暂不确定默认主口径`
        };
        return latestHotelRatePlanProbe;
      } catch (error) {
        latestHotelRatePlanProbe = {
          ...base,
          status: "failed",
          updatedAt: new Date().toISOString(),
          message: "酒店口径探针失败",
          error: errorMessage(error)
        };
        return latestHotelRatePlanProbe;
      } finally {
        await browser?.disconnect?.();
      }
    },

    async runHotelAllRatePlanProbe() {
      const query = buildHotelCandidateQuery(now(), "如家商旅", "广州");
      const base: HotelAllRatePlanProbeResult = {
        status: "running",
        query,
        selectedCandidate: null,
        samples: [],
        updatedAt: new Date().toISOString(),
        message: "正在从青猫候选酒店中选择 1 家，并采集四平台四口径价格"
      };
      latestHotelAllRatePlan = base;

      let browser: BrowserConnection | null = null;

      try {
        await fsp.mkdir(options.artifactDir, { recursive: true });
        const chromium = await loadChromium();
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`);
        const context = browser.contexts()[0];
        if (!context) {
          throw new Error("未找到可附着的 Chrome 浏览器上下文");
        }

        const qingmaoPage = findExistingPage(context, platformUrls.青猫差旅);
        if (!qingmaoPage) {
          throw new Error("未找到青猫差旅已登录页面，请先打开登录浏览器并保持窗口打开");
        }

        const listFrame = await searchQingmaoHotelCandidates(qingmaoPage, query);
        const listText = await listFrame.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
        const selectedCandidate = parseQingmaoHotelCandidatesText(listText)
          .find((candidate) => isHotelCandidateRelevantForQuery(candidate, query) && typeof candidate.price === "number" && candidate.price > 0) ?? null;
        if (!selectedCandidate) {
          throw new Error("青猫候选池未找到可用酒店");
        }

        const samples: HotelAllRatePlanSample[] = [];
        latestHotelAllRatePlan = {
          ...base,
          selectedCandidate,
          message: `已选青猫候选酒店：${selectedCandidate.hotelName}，开始采集 4 个口径`
        };

        for (const ratePlan of HOTEL_RATE_PLAN_LABELS) {
          const startedAt = Date.now();
          try {
            const result = await runHotelRatePlanForCandidate(context, qingmaoPage, options.artifactDir, query, selectedCandidate, ratePlan);
            const sample: HotelAllRatePlanSample = {
              ratePlan,
              status: result.status,
              selectedCandidate: result.selectedCandidate,
              quotes: result.quotes,
              durationMs: Date.now() - startedAt,
              message: result.message
            };
            samples.push(sample);
          } catch (error) {
            samples.push({
              ratePlan,
              status: "failed",
              selectedCandidate,
              quotes: [],
              durationMs: Date.now() - startedAt,
              message: `${selectedCandidate.hotelName} ${ratePlan}采集失败`,
              error: errorMessage(error)
            });
          }

          latestHotelAllRatePlan = {
            ...base,
            selectedCandidate,
            samples,
            updatedAt: new Date().toISOString(),
            message: `正在采集四平台四口径：已完成 ${samples.length}/${HOTEL_RATE_PLAN_LABELS.length}`
          };
        }

        const completed = samples.filter((sample) => sample.status === "completed").length;
        latestHotelAllRatePlan = {
          status: completed === samples.length ? "completed" : samples.some((sample) => sample.status !== "failed") ? "partial" : "failed",
          query,
          selectedCandidate,
          samples,
          updatedAt: new Date().toISOString(),
          message: `四平台四口径采集完成：完整 ${completed}/${samples.length}`
        };
        return latestHotelAllRatePlan;
      } catch (error) {
        latestHotelAllRatePlan = {
          ...base,
          status: "failed",
          updatedAt: new Date().toISOString(),
          message: "四平台四口径采集失败",
          error: errorMessage(error)
        };
        return latestHotelAllRatePlan;
      } finally {
        await browser?.disconnect?.();
      }
    },

    async runHotelCalibrationProbe(input: HotelCalibrationInput = {}) {
      const query = buildHotelCalibrationQuery(now(), input);
      const platformOrder = resolveHotelCalibrationPlatformOrder(input);
      const competitorPlatforms = platformOrder.filter((platform) => platform !== "青猫差旅");
      const base: HotelCalibrationResult = {
        status: "running",
        mode: "calibration",
        limit: HOTEL_CALIBRATION_LIMIT,
        mainRatePlan: HOTEL_CALIBRATION_MAIN_RATE_PLAN,
        platformOrder,
        query,
        samples: [],
        updatedAt: new Date().toISOString(),
        message: "正在执行 3 家酒店校准测试"
      };
      latestHotelCalibration = base;

      let browser: BrowserConnection | null = null;
      let qingmaoPage: BrowserPage | null = null;
      let pagesBeforeRun: Set<BrowserPage> | null = null;

      try {
        const runId = `hotel-calibration-${formatBatchTimestamp(now())}`;
        const artifactDir = path.join(options.artifactDir, "hotel-calibration", runId);
        await fsp.mkdir(artifactDir, { recursive: true });

        const chromium = await loadChromium();
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`);
        const context = browser.contexts()[0];
        if (!context) {
          throw new Error("未找到可附着的 Chrome 浏览器上下文");
        }

        pagesBeforeRun = snapshotBrowserPages(context);
        qingmaoPage = findExistingPage(context, platformUrls.青猫差旅);
        if (!qingmaoPage) {
          throw new Error("未找到青猫差旅已登录页面，请先打开登录浏览器并保持窗口打开");
        }

        const listFrame = await searchQingmaoHotelCandidates(qingmaoPage, query);
        const listText = await listFrame.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
        const candidates = parseQingmaoHotelCandidatesText(listText)
          .filter((candidate) => isHotelCandidateRelevantForQuery(candidate, query) && Boolean(candidate.price && candidate.price > 0))
          .slice(0, HOTEL_CALIBRATION_LIMIT);
        if (candidates.length === 0) {
          throw new Error(`青猫候选池为空：${query.city} / ${query.keyword} / ${query.checkInDate} 至 ${query.checkOutDate} 未解析到候选酒店`);
        }
        const samples: HotelCalibrationSample[] = [];

        for (const [index, candidate] of candidates.entries()) {
          const pagesBeforeSample = snapshotBrowserPages(context);
          const sampleArtifactDir = path.join(artifactDir, `hotel-${String(index + 1).padStart(2, "0")}`);
          await fsp.mkdir(sampleArtifactDir, { recursive: true });
          const platforms: HotelCalibrationPlatformResult[] = [];
          let lockedCandidate = candidate;

          try {
            const qingmaoDiagnosis = await diagnoseQingmaoHotelCalibration(qingmaoPage, sampleArtifactDir, query, candidate);
            lockedCandidate = qingmaoDiagnosis.candidate;
            platforms.push(qingmaoDiagnosis.result);

            if (qingmaoDiagnosis.hasMainRate) {
              if (competitorPlatforms.includes("阿里商旅")) {
                platforms.push(await diagnoseAliHotelCalibration(context, sampleArtifactDir, query, lockedCandidate));
              }
              if (competitorPlatforms.includes("在途商旅")) {
                platforms.push(await diagnoseZtripHotelCalibration(context, sampleArtifactDir, query, lockedCandidate));
              }
              if (competitorPlatforms.includes("携程商旅")) {
                platforms.push(await diagnoseCtripHotelCalibration(context, sampleArtifactDir, query, lockedCandidate));
              }
            }
          } catch (error) {
            platforms.push(buildHotelCalibrationPlatformResult({
              platform: "青猫差旅",
              startedAt: Date.now(),
              sameHotel: null,
              matchBasis: "青猫校准样本异常",
              sourceAddress: lockedCandidate.address,
              rawText: lockedCandidate.rawText,
              fallbackHotelName: lockedCandidate.hotelName,
              finalUrl: qingmaoPage.url(),
              failureReason: errorMessage(error),
              failureType: classifyHotelCalibrationFailureType(errorMessage(error), "青猫差旅")
            }));
          } finally {
            await closeCreatedBrowserPages(context, pagesBeforeSample, new Set([qingmaoPage]));
          }

          const complete = isHotelCalibrationSampleComplete(platforms, platformOrder);
          const hasAnyMainRate = platforms.some((platform) => platform.hasMainRate);
          samples.push({
            index: index + 1,
            status: complete ? "completed" : hasAnyMainRate ? "partial" : "failed",
            sourceHotel: {
              hotelName: lockedCandidate.hotelName,
              city: query.city,
              address: lockedCandidate.address,
              doorPlate: extractHotelDoorPlate(lockedCandidate.address),
              rawText: lockedCandidate.rawText
            },
            platforms,
            message: complete
              ? `${lockedCandidate.hotelName} 四平台主口径均已读取`
              : `${lockedCandidate.hotelName} 校准完成，存在平台缺失或失败`
          });

          latestHotelCalibration = {
            ...base,
            samples,
            updatedAt: new Date().toISOString(),
            message: `正在执行 3 家酒店校准测试：已完成 ${samples.length}/${HOTEL_CALIBRATION_LIMIT}`
          };
        }

        const completed = samples.filter((sample) => sample.status === "completed").length;
        latestHotelCalibration = {
          ...base,
          status: completed === HOTEL_CALIBRATION_LIMIT ? "completed" : samples.length > 0 ? "partial" : "failed",
          samples,
          updatedAt: new Date().toISOString(),
          message: `3 家酒店校准测试完成：完整 ${completed}/${samples.length}`
        };
        return latestHotelCalibration;
      } catch (error) {
        latestHotelCalibration = {
          ...base,
          status: "failed",
          updatedAt: new Date().toISOString(),
          message: "3 家酒店校准测试失败",
          error: errorMessage(error)
        };
        return latestHotelCalibration;
      } finally {
        if (browser) {
          const context = browser.contexts()[0];
          if (context && pagesBeforeRun) {
            await closeCreatedBrowserPages(context, pagesBeforeRun, qingmaoPage ? new Set([qingmaoPage]) : new Set()).catch(() => undefined);
          }
        }
        await browser?.disconnect?.();
      }
    },

    async cleanupBrowserPages() {
      let browser: BrowserConnection | null = null;
      const updatedAt = new Date().toISOString();

      try {
        const chromium = await loadChromium();
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`);
        const context = browser.contexts()[0];
        if (!context) {
          throw new Error("未找到可附着的 Chrome 浏览器上下文");
        }

        const beforeCount = context.pages().length;
        const openedRootCount = await ensurePlatformRootPages(context);
        const closedCount = await closeTemporaryHotelPages(context);
        const afterCount = context.pages().length;
        return {
          status: "completed" as const,
          beforeCount,
          closedCount,
          afterCount,
          updatedAt,
          message: openedRootCount > 0
            ? `已补齐 ${openedRootCount} 个平台基础页，关闭 ${closedCount} 个采集临时窗口`
            : `已关闭 ${closedCount} 个采集临时窗口`
        };
      } catch (error) {
        return {
          status: "failed" as const,
          beforeCount: 0,
          closedCount: 0,
          afterCount: 0,
          updatedAt,
          message: "清理采集临时窗口失败",
          error: errorMessage(error)
        };
      } finally {
        await browser?.disconnect?.();
      }
    },

    async runSameFlightComparisonProbe() {
      const route = buildPilotRoute(now());
      const base: SameFlightComparisonProbeResult = {
        ...latestSameFlightComparison,
        status: "running",
        route,
        selectedFlight: null,
        quotes: [],
        updatedAt: new Date().toISOString(),
        message: "正在随机抽取青猫航班，并查询携程商旅、阿里商旅、在途商旅同航班"
      };
      latestSameFlightComparison = base;

      try {
        const selectedFlight = pickRandomQingmaoCandidate(latestQingmaoCandidates.candidates, random);

        if (!selectedFlight) {
          throw new Error("青猫候选航班池为空，请先点击“读取青猫候选航班”");
        }

        await fsp.mkdir(options.artifactDir, { recursive: true });
        const chromium = await loadChromium();
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`);
        const context = browser.contexts()[0];

        if (!context) {
          await browser.disconnect?.();
          throw new Error("未找到可附着的 Chrome 浏览器上下文");
        }

        const quotes: SameFlightPlatformQuote[] = [
          buildQingmaoQuote(selectedFlight, latestQingmaoCandidates.screenshotPath),
          await searchCtripSameFlightQuote(context, options.artifactDir, route, selectedFlight),
          await searchAliSameFlightQuote(context, options.artifactDir, route, selectedFlight),
          await searchZtripSameFlightQuote(context, options.artifactDir, route, selectedFlight)
        ];

        await browser.disconnect?.();
        latestSameFlightComparison = {
          ...base,
          status: "completed",
          selectedFlight,
          quotes,
          updatedAt: new Date().toISOString(),
          message: `已随机抽取 ${selectedFlight.flightNo}，并完成四平台同航班价格读取`
        };
        return latestSameFlightComparison;
      } catch (error) {
        latestSameFlightComparison = {
          ...base,
          status: "failed",
          updatedAt: new Date().toISOString(),
          message: "同航班价格读取失败",
          error: errorMessage(error)
        };
        return latestSameFlightComparison;
      }
    },

    async runZtripProbe() {
      const base: ZtripProbeResult = {
        status: "running",
        loginUrl: platformUrls.在途商旅,
        checks: [],
        updatedAt: new Date().toISOString(),
        message: "正在验证在途商旅入口"
      };
      latestZtrip = base;

      let browser: BrowserConnection | null = null;
      let launchedContext: BrowserContext | null = null;

      try {
        await fsp.mkdir(options.profileDir, { recursive: true });
        await fsp.mkdir(options.artifactDir, { recursive: true });
        const chromium = await loadChromium();
        let context: BrowserContext | null = null;

        try {
          browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`);
          context = browser.contexts()[0] ?? null;
        } catch {
          launchedContext = await chromium.launchPersistentContext(options.profileDir, launchOptions(true));
          context = launchedContext;
        }

        if (!context) {
          throw new Error("未找到可用于验证在途商旅的浏览器上下文");
        }

        const existingPage = findExistingPage(context, platformUrls.在途商旅);
        const page = existingPage ?? await context.newPage();

        await page.goto(platformUrls.在途商旅, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await page.waitForLoadState?.("networkidle", { timeout: 15_000 }).catch(() => undefined);

        await page.waitForTimeout(5_000).catch(() => undefined);
        const bodyText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
        const screenshotPath = path.join(options.artifactDir, "在途商旅-入口页.png");
        const evidencePath = await savePageEvidence(page, screenshotPath, {
          platform: "在途商旅",
          finalUrl: page.url(),
          bodyText
        });
        const outcome = classifyZtripProbeOutcome(bodyText, page.url());
        const entryCheck: ZtripProbeCheck = {
          target: "入口页",
          outcome,
          note: outcome === "login-required" ? "页面可访问，但需要人工登录" : outcome === "reachable" ? "入口页可访问" : "入口页访问失败",
          pageTitle: await page.title().catch(() => ""),
          finalUrl: page.url(),
          screenshotPath: evidencePath
        };
        let bookingText = bodyText;
        let bookingScreenshotPath = evidencePath;

        if (outcome === "reachable") {
          await openZtripBookingEntry(page);
          bookingText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => bodyText);
          bookingScreenshotPath = await savePageEvidence(page, path.join(options.artifactDir, "在途商旅-预订页.png"), {
            platform: "在途商旅",
            finalUrl: page.url(),
            bodyText: bookingText
          });
        }

        const checks: ZtripProbeCheck[] = [
          entryCheck,
          ...classifyZtripProductEntries(bookingText, outcome).map((check) => ({
            ...check,
            finalUrl: outcome === "reachable" ? page.url() : undefined,
            screenshotPath: outcome === "reachable" ? bookingScreenshotPath : undefined
          }))
        ];

        latestZtrip = {
          ...base,
          status: outcome === "failed" ? "failed" : "completed",
          checks,
          updatedAt: new Date().toISOString(),
          message: outcome === "failed" ? "在途商旅入口验证失败" : "在途商旅入口验证完成"
        };
        return latestZtrip;
      } catch (error) {
        latestZtrip = {
          ...base,
          status: "failed",
          checks: [
            {
              target: "入口页",
              outcome: "failed",
              note: "无法打开或附着在途商旅页面",
              error: errorMessage(error)
            }
          ],
          updatedAt: new Date().toISOString(),
          message: "在途商旅入口验证失败",
          error: errorMessage(error)
        };
        return latestZtrip;
      } finally {
        await browser?.disconnect?.();
        await launchedContext?.close();
      }
    },

    async runZtripFlightProbe() {
      const route = buildPilotRoute(now());
      const base: ZtripFlightProbeResult = {
        ...latestZtripFlight,
        status: "running",
        route,
        selectedFlight: null,
        candidates: [],
        totalFlights: null,
        updatedAt: new Date().toISOString(),
        message: "正在采集在途商旅航班样本"
      };
      latestZtripFlight = base;

      let browser: BrowserConnection | null = null;

      try {
        await fsp.mkdir(options.artifactDir, { recursive: true });
        const chromium = await loadChromium();
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`);
        const context = browser.contexts()[0];

        if (!context) {
          throw new Error("未找到可附着的 Chrome 浏览器上下文");
        }

        const page = findExistingPage(context, platformUrls.在途商旅) ?? await context.newPage();
        if (!page.url().includes(domainFromUrl(platformUrls.在途商旅))) {
          await page.goto(platformUrls.在途商旅, { waitUntil: "domcontentloaded", timeout: 45_000 });
          await page.waitForLoadState?.("networkidle", { timeout: 15_000 }).catch(() => undefined);
        }

        const resultPage = await searchZtripFlightRoute(page, route, context);
        const bodyText = await waitForZtripFlightResultText(resultPage);
        const candidates = parseZtripFlightCandidatesText(bodyText).slice(0, 12);
        const totalFlights = readZtripTotalFlightCount(bodyText);
        const screenshotPath = path.join(options.artifactDir, "在途商旅-航班样本.png");
        const evidencePath = await savePageEvidence(resultPage, screenshotPath, {
          platform: "在途商旅",
          route,
          finalUrl: resultPage.url(),
          bodyText
        });
        const selectedFlight = candidates.find((candidate) => typeof candidate.price === "number" && candidate.flightNo) ?? null;

        latestZtripFlight = {
          ...base,
          status: selectedFlight ? "completed" : "failed",
          route,
          selectedFlight,
          candidates,
          totalFlights,
          screenshotPath: evidencePath,
          finalUrl: resultPage.url(),
          updatedAt: new Date().toISOString(),
          message: selectedFlight
            ? `已读取在途商旅 ${candidates.length} 条航班样本，首条为 ${selectedFlight.flightNo}`
            : "在途商旅航班页已打开，但未解析到可用航班价格",
          error: selectedFlight ? undefined : "未解析到航班号和价格"
        };
        return latestZtripFlight;
      } catch (error) {
        latestZtripFlight = {
          ...base,
          status: "failed",
          updatedAt: new Date().toISOString(),
          message: "在途商旅航班样本采集失败",
          error: errorMessage(error)
        };
        return latestZtripFlight;
      } finally {
        await browser?.disconnect?.();
      }
    },

    async runZtripHotelProbe() {
      const query = buildZtripHotelQuery(now());
      const base: ZtripHotelProbeResult = {
        ...latestZtripHotel,
        status: "running",
        query,
        selectedRate: null,
        rates: [],
        updatedAt: new Date().toISOString(),
        message: "正在采集在途商旅酒店样本"
      };
      latestZtripHotel = base;

      let browser: BrowserConnection | null = null;

      try {
        await fsp.mkdir(options.artifactDir, { recursive: true });
        const chromium = await loadChromium();
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`);
        const context = browser.contexts()[0];

        if (!context) {
          throw new Error("未找到可附着的 Chrome 浏览器上下文");
        }

        const page = findExistingPage(context, platformUrls.在途商旅) ?? await context.newPage();
        await openZtripHotelSearchResult(page, query);
        await openFirstZtripHotelDetail(page);
        await filterZtripHotelBigBedDoubleBreakfast(page);
        const bodyText = await page.locator("body").innerText({ timeout: 8_000 }).catch(() => "");
        const rates = parseZtripHotelRatesText(bodyText);
        const selectedRate = rates.find((rate) => rate.bedType === "大床" && rate.breakfast === "有早餐" && typeof rate.price === "number") ?? null;
        const screenshotPath = path.join(options.artifactDir, "在途商旅-酒店样本.png");
        const evidencePath = await savePageEvidence(page, screenshotPath, {
          platform: "在途商旅",
          finalUrl: page.url(),
          bodyText,
          price: selectedRate?.price ?? null,
          rawText: selectedRate?.rawText
        });

        latestZtripHotel = {
          ...base,
          status: selectedRate ? "completed" : "failed",
          query,
          selectedRate,
          rates,
          screenshotPath: evidencePath,
          finalUrl: page.url(),
          updatedAt: new Date().toISOString(),
          message: selectedRate
            ? `已读取在途商旅酒店大床有早餐样本：${selectedRate.hotelName} ${selectedRate.roomType}`
            : "在途商旅酒店页已打开，但未解析到大床有早餐价格",
          error: selectedRate ? undefined : "未解析到大床有早餐价格"
        };
        return latestZtripHotel;
      } catch (error) {
        latestZtripHotel = {
          ...base,
          status: "failed",
          updatedAt: new Date().toISOString(),
          message: "在途商旅酒店样本采集失败",
          error: errorMessage(error)
        };
        return latestZtripHotel;
      } finally {
        await browser?.disconnect?.();
      }
    },

    async runDomesticBatchCollection(limit) {
      const collectedAt = now();
      const batchId = `batch-${formatBatchTimestamp(collectedAt)}-real-domestic`;
      const batchArtifactDir = path.join(options.artifactDir, batchId);
      const outputRoot = path.dirname(options.artifactDir);
      const publicScreenshotDir = path.join(outputRoot, "screenshots", batchId);
      const targetSampleCount = typeof limit === "number" && limit > 0 ? Math.min(limit, 10) : 10;
      const routes = FIXED_ROUTES
        .filter((route) => route.scope === "国内")
        .slice(0, targetSampleCount);

      await fsp.mkdir(batchArtifactDir, { recursive: true });
      await fsp.mkdir(publicScreenshotDir, { recursive: true });

      const chromium = await loadChromium();
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`);
      const context = browser.contexts()[0];

      if (!context) {
        await browser.disconnect?.();
        throw new Error("未找到可附着的 Chrome 浏览器上下文");
      }

      const qingmaoPage = findExistingPage(context, platformUrls.青猫差旅);
      if (!qingmaoPage) {
        await browser.disconnect?.();
        throw new Error("未找到青猫差旅已登录页面，请先打开登录浏览器并保持窗口打开");
      }

      await openQingmaoDomesticFlightTab(qingmaoPage);
      const qingmaoFrame = findQingmaoFlightFrame(qingmaoPage);

      if (!qingmaoFrame) {
        await browser.disconnect?.();
        throw new Error("未找到青猫机票 iframe，可能页面尚未加载完成或入口结构变化");
      }

      const samples: FlightSample[] = [];
      const failureNotes: string[] = [];

      try {
        for (const routeConfig of routes) {
          if (samples.length >= targetSampleCount) {
            break;
          }

          const route = buildRouteFromConfig(routeConfig, collectedAt);
          const sampleIndex = samples.length + 1;
          const sampleId = `real-domestic-${String(sampleIndex).padStart(2, "0")}`;
          const sampleArtifactDir = path.join(batchArtifactDir, sampleId);
          await fsp.mkdir(sampleArtifactDir, { recursive: true });

          try {
            await searchQingmaoFlightRoute(qingmaoFrame, route);
            const candidates = await extractQingmaoFlightCandidates(qingmaoFrame);
            const selectedFlight = pickRandomQingmaoCandidate(candidates, random);

            if (!selectedFlight) {
              failureNotes.push(`${route.origin}-${route.destination}: 青猫候选航班为空`);
              continue;
            }

            const randomizedCandidates = shuffledQingmaoCandidates(candidates, random);
            const skippedFlights: string[] = [];
            let acceptedSample: FlightSample | null = null;

            for (const candidate of randomizedCandidates) {
              try {
                const ctripQuote = await searchCtripSameFlightQuote(context, sampleArtifactDir, route, candidate, `${sampleId}-${platformSlug("携程商旅")}.png`);
                const aliQuote = await searchAliSameFlightQuote(context, sampleArtifactDir, route, candidate, `${sampleId}-${platformSlug("阿里商旅")}.png`);
                const ztripQuote = await searchZtripSameFlightQuote(context, sampleArtifactDir, route, candidate, `${sampleId}-${platformSlug("在途商旅")}.png`);
                const sameFlightQuotes = [buildQingmaoQuote(candidate), ctripQuote, aliQuote, ztripQuote];

                if (!hasCompleteSameFlightQuotes(sameFlightQuotes)) {
                  skippedFlights.push(`${candidate.flightNo}: ${incompleteQuoteReason(sameFlightQuotes)}`);
                  continue;
                }

                const qingmaoScreenshot = path.join(publicScreenshotDir, `${sampleId}-${platformSlug("青猫差旅")}.png`);
                const qingmaoEvidencePath = await savePageEvidence(qingmaoPage, qingmaoScreenshot, {
                  platform: "青猫差旅",
                  route,
                  selectedFlight: candidate,
                  price: candidate.price,
                  bodyText: candidate.rawText
                });
                const quotes = [
                  mapSameFlightQuoteToPlatformQuote(buildQingmaoQuote(candidate, qingmaoEvidencePath), batchId, sampleId),
                  await persistSameFlightQuote(ctripQuote, publicScreenshotDir, batchId, sampleId),
                  await persistSameFlightQuote(aliQuote, publicScreenshotDir, batchId, sampleId),
                  await persistSameFlightQuote(ztripQuote, publicScreenshotDir, batchId, sampleId)
                ];
                acceptedSample = buildFlightSampleFromRealQuote(sampleId, routeConfig, route, candidate, quotes);
                break;
              } catch (error) {
                skippedFlights.push(`${candidate.flightNo}: ${errorMessage(error)}`);
              }
            }

            if (acceptedSample) {
              samples.push(acceptedSample);
            } else {
              failureNotes.push(`${route.origin}-${route.destination}: 已跳过 ${randomizedCandidates.length} 个航班，未找到四平台均可订同航班${skippedFlights.length ? `（${skippedFlights.slice(0, 3).join("；")}）` : ""}`);
            }
          } catch (error) {
            failureNotes.push(`${route.origin}-${route.destination}: ${errorMessage(error)}`);
          }
        }
      } finally {
        await browser.disconnect?.();
      }

      const failedCount = Math.max(targetSampleCount - samples.length, 0);

      if (samples.length === 0 && failureNotes.length > 0) {
        throw new Error(`国内真实采集未获得有效样本：${failureNotes.join("；")}`);
      }

      if (samples.length < targetSampleCount) {
        throw new Error(`国内真实采集未凑够 ${targetSampleCount} 条四平台完整样本，当前成功 ${samples.length} 条：${failureNotes.join("；")}`);
      }

      return {
        id: batchId,
        status: samples.length > 0 ? "ready" : "failed",
        generatedAt: collectedAt.toISOString(),
        sampleCount: samples.length,
        successCount: samples.length,
        failedCount,
        samples,
        failureNotes
      };
    },

    async runInternationalBatchCollection(limit) {
      const collectedAt = now();
      const batchId = `batch-${formatBatchTimestamp(collectedAt)}-real-international`;
      const batchArtifactDir = path.join(options.artifactDir, batchId);
      const outputRoot = path.dirname(options.artifactDir);
      const publicScreenshotDir = path.join(outputRoot, "screenshots", batchId);
      const targetSampleCount = typeof limit === "number" && limit > 0 ? Math.min(limit, 10) : 10;
      const primaryRoutes = FIXED_ROUTES
        .filter((route) => route.scope === "国际")
        .slice(0, targetSampleCount);
      const routes = [...primaryRoutes, ...INTERNATIONAL_FALLBACK_ROUTES];

      await fsp.mkdir(batchArtifactDir, { recursive: true });
      await fsp.mkdir(publicScreenshotDir, { recursive: true });

      const chromium = await loadChromium();
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`);
      const context = browser.contexts()[0];

      if (!context) {
        await browser.disconnect?.();
        throw new Error("未找到可附着的 Chrome 浏览器上下文");
      }

      const qingmaoPage = findExistingPage(context, platformUrls.青猫差旅);
      if (!qingmaoPage) {
        await browser.disconnect?.();
        throw new Error("未找到青猫差旅已登录页面，请先打开登录浏览器并保持窗口打开");
      }

      const samples: FlightSample[] = [];
      const failureNotes: string[] = [];

      try {
        for (const routeConfig of routes) {
          if (samples.length >= targetSampleCount) {
            break;
          }

          const route = buildRouteFromConfig(routeConfig, collectedAt);
          const sampleIndex = samples.length + 1;
          const sampleId = `real-international-${String(sampleIndex).padStart(2, "0")}`;
          const sampleArtifactDir = path.join(batchArtifactDir, sampleId);
          await fsp.mkdir(sampleArtifactDir, { recursive: true });

          try {
            const qingmaoFrame = await searchQingmaoInternationalFlightRoute(qingmaoPage, route);
            const candidates = await extractQingmaoFlightCandidates(qingmaoFrame);
            const selectedFlight = pickRandomQingmaoCandidate(candidates, random);

            if (!selectedFlight) {
              failureNotes.push(`已替换 ${route.origin}-${route.destination}: 青猫国际候选航班为空`);
              continue;
            }

            const randomizedCandidates = shuffledQingmaoCandidates(candidates, random);
            const skippedFlights: string[] = [];
            let acceptedSample: FlightSample | null = null;

            for (const candidate of randomizedCandidates) {
              try {
                const ctripQuote = await searchCtripSameFlightQuote(context, sampleArtifactDir, route, candidate, `${sampleId}-${platformSlug("携程商旅")}.png`);
                const aliQuote = await searchAliSameFlightQuote(context, sampleArtifactDir, route, candidate, `${sampleId}-${platformSlug("阿里商旅")}.png`);
                const ztripQuote = await searchZtripSameFlightQuote(context, sampleArtifactDir, route, candidate, `${sampleId}-${platformSlug("在途商旅")}.png`);
                const sameFlightQuotes = [buildQingmaoQuote(candidate), ctripQuote, aliQuote, ztripQuote];

                if (!hasCompleteSameFlightQuotes(sameFlightQuotes)) {
                  skippedFlights.push(`${candidate.flightNo}: ${incompleteQuoteReason(sameFlightQuotes)}`);
                  continue;
                }

                const qingmaoScreenshot = path.join(publicScreenshotDir, `${sampleId}-${platformSlug("青猫差旅")}.png`);
                const qingmaoEvidencePath = await savePageEvidence(qingmaoPage, qingmaoScreenshot, {
                  platform: "青猫差旅",
                  route,
                  selectedFlight: candidate,
                  price: candidate.price,
                  bodyText: candidate.rawText
                });
                const quotes = [
                  mapSameFlightQuoteToPlatformQuote(buildQingmaoQuote(candidate, qingmaoEvidencePath), batchId, sampleId),
                  await persistSameFlightQuote(ctripQuote, publicScreenshotDir, batchId, sampleId),
                  await persistSameFlightQuote(aliQuote, publicScreenshotDir, batchId, sampleId),
                  await persistSameFlightQuote(ztripQuote, publicScreenshotDir, batchId, sampleId)
                ];
                acceptedSample = buildFlightSampleFromRealQuote(sampleId, routeConfig, route, candidate, quotes);
                break;
              } catch (error) {
                skippedFlights.push(`${candidate.flightNo}: ${errorMessage(error)}`);
              }
            }

            if (acceptedSample) {
              samples.push(acceptedSample);
            } else {
              failureNotes.push(`已替换 ${route.origin}-${route.destination}: 已跳过 ${randomizedCandidates.length} 个航班，未找到四平台均可订同航班${skippedFlights.length ? `（${skippedFlights.slice(0, 3).join("；")}）` : ""}`);
            }
          } catch (error) {
            failureNotes.push(`已替换 ${route.origin}-${route.destination}: ${errorMessage(error)}`);
          }
        }
      } finally {
        await browser.disconnect?.();
      }

      const failedCount = Math.max(targetSampleCount - samples.length, 0);

      if (samples.length === 0 && failureNotes.length > 0) {
        throw new Error(`国际真实采集未获得有效样本：${failureNotes.join("；")}`);
      }

      if (samples.length < targetSampleCount) {
        throw new Error(`国际真实采集未凑够 ${targetSampleCount} 条四平台完整样本，当前成功 ${samples.length} 条：${failureNotes.join("；")}`);
      }

      return {
        id: batchId,
        status: samples.length > 0 ? "ready" : "failed",
        generatedAt: collectedAt.toISOString(),
        sampleCount: samples.length,
        successCount: samples.length,
        failedCount,
        samples,
        failureNotes
      };
    },

    async runFullBatchCollection() {
      const domesticBatch = await this.runDomesticBatchCollection(10);
      const internationalBatch = await this.runInternationalBatchCollection(10);
      const batchId = `batch-${formatBatchTimestamp(now())}-real-full`;
      const samples = [...domesticBatch.samples, ...internationalBatch.samples].map((sample, index) => {
        const nextId = `real-full-${String(index + 1).padStart(2, "0")}`;
        return {
          ...sample,
          id: nextId,
          quotes: sample.quotes.map((quote) => ({
            ...quote,
            evidencePath: quote.evidencePath
              .replace(`screenshots/${domesticBatch.id}/`, `screenshots/${batchId}/`)
              .replace(`screenshots/${internationalBatch.id}/`, `screenshots/${batchId}/`)
          }))
        };
      });
      const outputRoot = path.dirname(options.artifactDir);
      const publicScreenshotDir = path.join(outputRoot, "screenshots", batchId);
      await fsp.mkdir(publicScreenshotDir, { recursive: true });

      for (const sourceBatch of [domesticBatch, internationalBatch]) {
        const sourceDir = path.join(outputRoot, "screenshots", sourceBatch.id);
        if (!fs.existsSync(sourceDir)) continue;
        const files = await fsp.readdir(sourceDir);
        for (const file of files) {
          await fsp.copyFile(path.join(sourceDir, file), path.join(publicScreenshotDir, file));
        }
      }

      return {
        id: batchId,
        status: "ready",
        generatedAt: now().toISOString(),
        sampleCount: samples.length,
        successCount: samples.length,
        failedCount: 0,
        samples,
        failureNotes: [...(domesticBatch.failureNotes ?? []), ...(internationalBatch.failureNotes ?? [])]
      };
    }
  };
}

function domainFromUrl(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function findExistingPage(context: BrowserContext, loginUrl: string) {
  const domain = domainFromUrl(loginUrl);
  if (!domain) return null;
  return context.pages().find((page) => page.url().includes(domain)) ?? null;
}

async function probePlatformsInContext(
  context: BrowserContext,
  artifactDir: string,
  reachableNote: string,
  failedNote: string
): Promise<PilotPlatformState[]> {
  const platforms: PilotPlatformState[] = [];

  for (const platform of buildPlatformStatus()) {
    if (!platform.configured || !platform.loginUrl) {
      platforms.push({ ...platform, outcome: "needs-config", note: "请先配置该平台入口地址" });
      continue;
    }

    const existingPage = findExistingPage(context, platform.loginUrl);
    const page = existingPage ?? await context.newPage();
    const screenshotPath = path.join(artifactDir, `${safeFilename(platform.platform)}.png`);

    try {
      if (!existingPage) {
        await page.goto(platform.loginUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
      }

      await page.waitForTimeout(5_000).catch(() => undefined);
      const bodyText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const outcome = platform.platform === "在途商旅" ? classifyZtripProbeOutcome(bodyText, page.url()) : classifyProbeOutcome(bodyText, page.url());

      platforms.push({
        ...platform,
        outcome,
        note: outcome === "login-required" ? "页面可访问，但可能仍在登录页" : reachableNote,
        pageTitle: await page.title().catch(() => ""),
        finalUrl: page.url(),
        screenshotPath
      });
    } catch (error) {
      platforms.push({
        ...platform,
        outcome: "failed",
        note: failedNote,
        screenshotPath,
        error: errorMessage(error)
      });
    }
  }

  return platforms;
}

function cleanText(value: string) {
  return value.replace(/\s+/g, "").trim();
}

export function parseDurationMinutes(value: string): number | null {
  const hourMatch = value.match(/(\d+)小时/);
  const minuteMatch = value.match(/(\d+)分/);

  if (!hourMatch && !minuteMatch) return null;

  return (hourMatch ? Number(hourMatch[1]) * 60 : 0) + (minuteMatch ? Number(minuteMatch[1]) : 0);
}

function parseCompactDurationMinutes(value: string): number | null {
  const compact = value.match(/(?:(\d+)h)?(?:(\d+)m)?/i);
  if (!compact || (!compact[1] && !compact[2])) return parseDurationMinutes(value);

  return (compact[1] ? Number(compact[1]) * 60 : 0) + (compact[2] ? Number(compact[2]) : 0);
}

export function parseQingmaoFlightCandidateText(rawText: string): QingmaoFlightCandidate | null {
  const text = cleanText(rawText);
  const flightMatch = text.match(/^([\u4e00-\u9fa5A-Za-z]+)((?:[A-Z]{2}|[0-9][A-Z])\d{3,4})/);
  const timeMatches = Array.from(text.matchAll(/\d{2}:\d{2}/g));

  if (!flightMatch || timeMatches.length < 2) return null;

  const flightNo = flightMatch[2];
  const flightNoEnd = (flightMatch.index ?? 0) + flightMatch[0].length;
  const firstTime = timeMatches[0];
  const secondTime = timeMatches[1];
  const firstTimeIndex = firstTime.index ?? -1;
  const secondTimeIndex = secondTime.index ?? -1;

  if (firstTimeIndex < 0 || secondTimeIndex < 0) return null;

  const aircraft = text.slice(flightNoEnd, firstTimeIndex);
  const betweenTimes = text.slice(firstTimeIndex + firstTime[0].length, secondTimeIndex);
  const terminalDurationMatch = betweenTimes.match(/^(.*T[0-9A-Z])(\d+小时(?:\d+分)?|\d+分)$/);
  const plainDurationMatch = betweenTimes.match(/^(.*?)(\d+小时(?:\d+分)?|\d+分)$/);
  const durationText = terminalDurationMatch?.[2] ?? plainDurationMatch?.[2] ?? "";
  const originAirport = terminalDurationMatch?.[1] ?? plainDurationMatch?.[1] ?? "";
  const destinationAndRest = text.slice(secondTimeIndex + secondTime[0].length);
  const destinationAirport = destinationAndRest.split(/有餐食|无餐食|￥/)[0];
  const priceMatch = text.match(/￥(\d+)起/);
  const discountMatch = text.match(/经济舱(?:[\d.]+折|全价)/);
  const mealMatch = text.match(/有餐食|无餐食/);

  return {
    airline: flightMatch[1],
    flightNo,
    aircraft,
    departureTime: firstTime[0],
    arrivalTime: secondTime[0],
    originAirport,
    destinationAirport,
    durationMinutes: durationText ? parseDurationMinutes(durationText) : null,
    price: priceMatch ? Number(priceMatch[1]) : null,
    cabin: discountMatch ? "经济舱" : "",
    discount: discountMatch ? discountMatch[0] : "",
    meal: mealMatch ? mealMatch[0] : "",
    shared: aircraft.includes("共享"),
    rawText
  };
}

export function parseQingmaoInternationalFlightCandidatesText(rawText: string): QingmaoFlightCandidate[] {
  const lines = rawText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates: QingmaoFlightCandidate[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const flightMatch = lines[index].match(/^(.+?)\s+((?:[A-Z]{2}|[0-9][A-Z])\d{3,4})$/);
    if (!flightMatch) continue;

    const previousLines = lines.slice(Math.max(0, index - 8), index);
    const timeIndexes = previousLines
      .map((line, lineIndex) => (/^\d{2}:\d{2}$/.test(line) ? lineIndex : -1))
      .filter((lineIndex) => lineIndex >= 0);
    const priceMatch = (lines[index + 1] ?? "").match(/[￥¥]\s*(\d{2,5})/);

    if (timeIndexes.length < 2 || !priceMatch) continue;

    const departureIndex = timeIndexes[timeIndexes.length - 2];
    const arrivalIndex = timeIndexes[timeIndexes.length - 1];
    const durationIndex = previousLines.findIndex((line, lineIndex) => lineIndex > departureIndex && lineIndex < arrivalIndex && /^\d+h(?:\d+m)?$|^\d+m$/.test(line));
    const originParts = previousLines.slice(departureIndex + 1, durationIndex > -1 ? durationIndex : arrivalIndex);
    const destinationParts = previousLines.slice(arrivalIndex + 1);
    const rawCandidate = [...previousLines, lines[index], lines[index + 1] ?? ""].join(" ");

    candidates.push({
      airline: flightMatch[1].trim(),
      flightNo: flightMatch[2],
      aircraft: "",
      departureTime: previousLines[departureIndex],
      arrivalTime: previousLines[arrivalIndex],
      originAirport: originParts.join(""),
      destinationAirport: destinationParts.join(""),
      durationMinutes: durationIndex > -1 ? parseCompactDurationMinutes(previousLines[durationIndex]) : null,
      price: Number(priceMatch[1]),
      cabin: "经济舱",
      discount: "",
      meal: "",
      shared: /共享/.test(rawCandidate),
      rawText: rawCandidate
    });
  }

  return candidates;
}

export function readQingmaoHotelTotalCount(rawText: string): number | null {
  const match = rawText.match(/共\s*(\d+)\s*家酒店/);
  return match ? Number(match[1]) : null;
}

export function parseQingmaoHotelCandidatesText(rawText: string): QingmaoHotelCandidate[] {
  const lines = rawText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates: QingmaoHotelCandidate[] = [];
  const levelPattern = /^(经济型|舒适型|高档型|豪华型|五星|四星)$/;

  for (let index = 0; index < lines.length; index += 1) {
    const hotelName = lines[index];
    const level = lines[index + 1] ?? "";
    if (!/(酒店|宾馆|公寓|如家|旅店)/.test(hotelName) || hotelName.length < 6) continue;
    if (!levelPattern.test(level)) continue;

    const snippet = lines.slice(index, index + 14);
    const priceIndex = snippet.findIndex((line) => /^[￥¥]$/.test(line) || /^[￥¥]\s*\d+/.test(line));
    const detailIndex = snippet.findIndex((line) => line === "查看详情");
    if (priceIndex < 0 || detailIndex < 0) continue;

    const priceText = snippet[priceIndex].match(/\d+/)?.[0] ?? snippet[priceIndex + 1]?.match(/^\d+$/)?.[0] ?? null;
    const area = snippet.find((line) => /^距市中心/.test(line)) ?? "";
    const areaIndex = area ? snippet.indexOf(area) : -1;
    const address = areaIndex >= 0 ? snippet[areaIndex + 1] ?? "" : "";
    const score = snippet.find((line, lineIndex) => lineIndex > 1 && /^\d(?:\.\d)?$/.test(line)) ?? "";
    const rawCandidate = snippet.slice(0, detailIndex + 1).join(" ");

    candidates.push({
      hotelName,
      level,
      score,
      area,
      address,
      price: priceText ? Number(priceText) : null,
      rawText: rawCandidate
    });
  }

  return candidates;
}

export function parseQingmaoHotelMainRatesText(rawText: string, ratePlan: HotelRatePlanLabel = HOTEL_VALIDATION_RATE_PLAN): HotelMainRateQuote[] {
  const lines = rawText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const hotelName = lines[0] ?? "";
  return buildQingmaoHotelRoomBlocks(lines)
    .map((block) => qingmaoHotelRateFromRoomBlock(block, hotelName, ratePlan))
    .filter((quote): quote is HotelMainRateQuote => Boolean(quote));
}

function buildQingmaoHotelRoomBlocks(lines: string[]) {
  const blocks: string[][] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!isLikelyQingmaoHotelRoomHeader(lines[index])) continue;
    let endIndex = Math.min(lines.length, index + 30);
    for (let nextIndex = index + 1; nextIndex < endIndex; nextIndex += 1) {
      if (isLikelyQingmaoHotelRoomHeader(lines[nextIndex])) {
        endIndex = nextIndex;
        break;
      }
    }
    blocks.push(lines.slice(index, endIndex));
  }
  return blocks;
}

function qingmaoHotelRateFromRoomBlock(blockLines: string[], hotelName: string, ratePlan: HotelRatePlanLabel): HotelMainRateQuote | null {
  const rawText = blockLines.join(" ");
  const bedType = inferQingmaoHotelBedType(blockLines);
  const breakfast = inferQingmaoHotelBreakfast(blockLines);
  const price = parseQingmaoHotelRoomPrice(rawText);
  if (bedType !== hotelRatePlanBedType(ratePlan) || breakfast !== hotelRatePlanBreakfast(ratePlan) || typeof price !== "number") {
    return null;
  }

  return {
    platform: "青猫差旅",
    status: "available",
    price,
    hotelName,
    roomType: blockLines[0].replace(/^\d+$/, "").trim(),
    ratePlan,
    rawText
  };
}

function isLikelyQingmaoHotelRoomHeader(line: string) {
  return /房/.test(line) && /大床|双床/.test(line) && !/[㎡米]|可住|早餐|取消|[￥¥]|CNY|在线预订|剩\d|查看更多价格|房型价格/.test(line);
}

function inferQingmaoHotelBedType(blockLines: string[]): "大床" | "双床" | "" {
  const roomHeader = blockLines[0] ?? "";
  if (/大床/.test(roomHeader) && !/双床/.test(roomHeader)) return "大床";
  if (/双床/.test(roomHeader) && !/大床/.test(roomHeader)) return "双床";
  const blockText = blockLines.join(" ");
  if (/大床/.test(blockText) && !/双床/.test(blockText)) return "大床";
  if (/双床/.test(blockText) && !/大床/.test(blockText)) return "双床";
  return "";
}

function inferQingmaoHotelBreakfast(blockLines: string[]): "有早餐" | "无早餐" | "" {
  const breakfastLines = blockLines.filter((line) => /单早|双早|1份早餐|2份早餐|含早|含早餐|无早|不含早|无早餐/.test(line));
  const decisiveLine = breakfastLines[breakfastLines.length - 1] ?? "";
  if (/无早|不含早|无早餐/.test(decisiveLine)) return "无早餐";
  if (/单早|双早|1份早餐|2份早餐|含早|含早餐/.test(decisiveLine)) return "有早餐";
  return "";
}

function parseQingmaoHotelRoomPrice(rawText: string) {
  const match = rawText.match(/[￥¥]\s*(\d{2,5})(?:\s*起)?/) ?? rawText.match(/[￥¥]\s+(\d{2,5})(?:\s*起)?/);
  const price = match ? Number(match[1]) : null;
  return price && price >= 80 ? price : null;
}

function qingmaoHasVisibleRatePlanBlockSignal(rawText: string, ratePlan: HotelRatePlanLabel) {
  return buildQingmaoHotelRoomBlocks(rawText.split(/\n+/).map((line) => line.trim()).filter(Boolean))
    .some((block) => {
      const text = block.join(" ");
      return inferQingmaoHotelBedType(block) === hotelRatePlanBedType(ratePlan)
        && inferQingmaoHotelBreakfast(block) === hotelRatePlanBreakfast(ratePlan)
        && typeof parseQingmaoHotelRoomPrice(text) === "number";
    });
}

function qingmaoHasVisibleRatePlanSignal(rawText: string, ratePlan: HotelRatePlanLabel) {
  const text = rawText.replace(/\s+/g, " ");
  const hasBedType = hotelRatePlanBedType(ratePlan) === "双床" ? /双床/.test(text) : /大床/.test(text);
  const hasNoBreakfast = /无早|不含早|无早餐/.test(text);
  const hasBreakfast = /单早|双早|1份早餐|2份早餐|含早|含早餐/.test(text);
  const matchesBreakfast = ratePlan.endsWith("无早餐") ? hasNoBreakfast : hasBreakfast;
  return hasBedType && matchesBreakfast && /[￥¥]\s*\d{2,5}(?:\s*起)?/.test(text);
}

export function parseCtripHotelMainRatesText(rawText: string, ratePlan: HotelRatePlanLabel = HOTEL_VALIDATION_RATE_PLAN): HotelMainRateQuote[] {
  const lines = rawText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const hotelName = lines.find((line) => /如家商旅|酒店|宾馆/.test(line) && !/广州 酒店|当前登录|酒店信息|酒店套餐/.test(line)) ?? "";
  const quotes: HotelMainRateQuote[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const roomType = lines[index];
    const bedPattern = hotelRatePlanBedPattern(ratePlan);
    const excludedBed = hotelRatePlanBedType(ratePlan) === "大床" ? /多张床|三床房|双床/ : /大床|多张床|三床房/;
    if (!bedPattern.test(roomType) || /^(大床|双床|床型|不限)$/.test(roomType) || /床型|不限/.test(roomType) || excludedBed.test(roomType)) {
      continue;
    }

    const snippetLines = lines.slice(index, index + 18);
    const snippet = snippetLines.join(" ");
    if (!hotelRatePlanBreakfastPattern(ratePlan).test(snippet)) {
      continue;
    }

    const priceValues = Array.from(snippet.matchAll(/¥\s*(\d{2,5}(?:\.\d+)?)/g))
      .filter((match) => !isCtripDiscountPrice(snippet, match.index ?? 0))
      .map((match) => Number(match[1]))
      .filter((price) => price >= 80);
    const price = priceValues.length ? Math.min(...priceValues) : null;

    if (price) {
      quotes.push({
        platform: "携程商旅",
        status: "available",
        price,
        hotelName,
        roomType,
        ratePlan,
        rawText: snippet
      });
    }
  }

  return quotes;
}

function isCtripDiscountPrice(snippet: string, priceIndex: number) {
  const before = snippet.slice(Math.max(0, priceIndex - 12), priceIndex);
  return /(优惠|券减|立减|减免|返现|返|省|补贴)\s*$/.test(before);
}

export function parseAliHotelMainRatesText(rawText: string, ratePlan: HotelRatePlanLabel = HOTEL_VALIDATION_RATE_PLAN): HotelMainRateQuote[] {
  const lines = rawText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const hotelName = lines.find((line) => line.length > 4 && /如家|酒店|宾馆/.test(line) && !/酒店详情|酒店预订|广州酒店|附近酒店|酒店介绍/.test(line)) ?? "";
  const quotes: HotelMainRateQuote[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const roomType = lines[index];
    const bedPattern = hotelRatePlanBedPattern(ratePlan);
    const excludedBed = hotelRatePlanBedType(ratePlan) === "大床" ? /双床|多床/ : /大床|多床/;
    if (!bedPattern.test(roomType) || excludedBed.test(roomType) || roomType === "大床房" || roomType === "双床房") {
      continue;
    }

    const snippetLines = lines.slice(index, index + 24);
    const snippet = snippetLines.join(" ");
    const breakfastPattern = hotelRatePlanBreakfastPattern(ratePlan);
    if (!breakfastPattern.test(snippet) || !bedPattern.test(snippet)) {
      continue;
    }

    const breakfastIndex = snippetLines.findIndex((line) => breakfastPattern.test(line));
    if (breakfastIndex < 0) continue;
    const afterBreakfast = snippetLines.slice(breakfastIndex).join(" ");
    const priceValues = Array.from(afterBreakfast.matchAll(/[￥¥]\s*(\d{2,5}(?:\.\d+)?)/g))
      .map((match) => Number(match[1]))
      .filter((price) => price >= 80);
    const price = priceValues.length ? priceValues[0] : null;

    if (price) {
      quotes.push({
        platform: "阿里商旅",
        status: "available",
        price,
        hotelName,
        roomType,
        ratePlan,
        rawText: snippet
      });
    }
  }

  return quotes;
}

export function readZtripTotalFlightCount(rawText: string): number | null {
  const match = rawText.match(/共\s*(\d+)\s*个航班/);
  return match ? Number(match[1]) : null;
}

export function parseZtripFlightCandidatesText(rawText: string): QingmaoFlightCandidate[] {
  const lines = rawText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates: QingmaoFlightCandidate[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const flightMatch = lines[index].match(/^([\u4e00-\u9fa5A-Za-z]+)((?:[A-Z]{2}|[0-9][A-Z])\d{3,4})$/);
    if (!flightMatch) continue;

    const snippet = lines.slice(index, index + 14);
    const timeIndexes = snippet
      .map((line, lineIndex) => (/^\d{2}:\d{2}$/.test(line) ? lineIndex : -1))
      .filter((lineIndex) => lineIndex >= 0);

    if (timeIndexes.length < 2) continue;

    const cnyIndex = snippet.findIndex((line) => /^CNY$/i.test(line));
    const priceLine = cnyIndex >= 0 ? snippet.slice(cnyIndex + 1).find((line) => /^\d{2,5}$/.test(line)) : undefined;
    const discount = snippet.find((line) => /^(经济舱|公务舱|商务舱|头等舱).*/.test(line)) ?? "";
    const rawCandidate = snippet.join(" ");
    const departureIndex = timeIndexes[0];
    const arrivalIndex = timeIndexes[1];

    candidates.push({
      airline: flightMatch[1],
      flightNo: flightMatch[2],
      aircraft: snippet[1] ?? "",
      departureTime: snippet[departureIndex],
      arrivalTime: snippet[arrivalIndex],
      originAirport: snippet[departureIndex + 1] ?? "",
      destinationAirport: snippet[arrivalIndex + 1] ?? "",
      durationMinutes: null,
      price: priceLine ? Number(priceLine) : null,
      cabin: discount.includes("经济舱") ? "经济舱" : "",
      discount,
      meal: "",
      shared: /共享/.test(rawCandidate),
      rawText: rawCandidate
    });
  }

  return candidates;
}

function detectZtripHotelName(lines: string[]) {
  const ignored = new Set(["酒店", "国内酒店", "国际/中国港澳台酒店"]);
  const detailStart = lines.findIndex((line) => line === "相册" || line === "封面" || line === "公共区域");
  const searchStart = detailStart >= 0 ? detailStart : 0;
  const hotelName = lines
    .slice(searchStart)
    .find((line) => /酒店|宾馆|公寓|美居|全季|亚朵|宜尚|麗枫|智选假日/.test(line) && !ignored.has(line) && !/酒店最低价|酒店政策|酒店亮点/.test(line));

  return hotelName ?? "";
}

function normalizeZtripBreakfast(value: string): ZtripHotelRate["breakfast"] {
  if (/无早餐|无早/.test(value)) return "无早餐";
  if (/含早餐|含早|2份早餐|双份早餐|双早|1份早餐|单份早餐|单早/.test(value)) return "有早餐";
  return "";
}

export function parseZtripHotelRatesText(rawText: string): ZtripHotelRate[] {
  return parseZtripHotelRatesTextForRatePlan(rawText);
}

function isZtripRoomHeader(line: string) {
  return /房/.test(line)
    && !/[|｜]/.test(line)
    && !/CNY|￥|¥|\d+m²|\d+㎡|可住|早餐|取消|筛选|酒店最低价|住客评价|酒店亮点|酒店政策|订房须知|地处|附近|不错|洗衣房|健身房|会议厅|商务中心|客房|房间很大/.test(line)
    && line.length <= 36;
}

function priceFromZtripSnippet(snippet: string) {
  const match = snippet.match(/CNY\s*(\d{2,5})/i) ?? snippet.match(/[￥¥]\s*(\d{2,5})(?:\s*起)?/);
  return match ? Number(match[1]) : null;
}

function ztripRelevantLines(rawText: string) {
  const lines = rawText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const stopIndexCandidates = [
    lines.findIndex((line) => /不满足筛选条件的产品/.test(line)),
    lines.findIndex((line) => line === "住客评价"),
    lines.findIndex((line) => line === "酒店亮点"),
    lines.findIndex((line) => line === "酒店政策")
  ].filter((index) => index >= 0);
  const stopIndex = stopIndexCandidates.length ? Math.min(...stopIndexCandidates) : lines.length;
  const roomListStart = lines.findIndex((line) => line === "1间1人");
  const startIndex = roomListStart >= 0 ? roomListStart + 1 : 0;
  return lines.slice(startIndex, stopIndex);
}

function inferZtripBedType(snippet: string): ZtripHotelRate["bedType"] {
  if (/双床|2张[^|，,。]*床|两张[^|，,。]*床/.test(snippet)) return "双床";
  if (/大床|1张[^|，,。]*大床|双人床/.test(snippet)) return "大床";
  return "";
}

export function parseZtripHotelRatesTextForRatePlan(rawText: string, ratePlan?: HotelRatePlanLabel): ZtripHotelRate[] {
  const lines = rawText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const hotelName = detectZtripHotelName(lines);
  const rates: ZtripHotelRate[] = [];
  const relevantLines = ztripRelevantLines(rawText);

  for (let index = 0; index < relevantLines.length; index += 1) {
    const roomLine = relevantLines[index];
    if (
      (!isZtripRoomHeader(roomLine) && !/大床|双床/.test(roomLine)) ||
      /筛选|大床双床|可住/.test(roomLine) ||
      /^(大床|双床|双份早餐|含早餐|符合差标|酒店最低价)$/.test(roomLine) ||
      /^(含早餐|无早餐|免费取消|立即确认|符合差标)/.test(roomLine)
    ) {
      continue;
    }

    const snippetLines = boundedHotelRoomSnippet(relevantLines, index, 10);
    const snippet = snippetLines.join(" ");
    const bedType = inferZtripBedType(snippet);
    if (!bedType) {
      continue;
    }
    if (ratePlan && bedType !== hotelRatePlanBedType(ratePlan)) {
      continue;
    }
    const breakfastMatch = snippet.match(/含早餐|含早|2份早餐|双份早餐|双早|1份早餐|单份早餐|单早|无早餐|无早/);
    if (!breakfastMatch) {
      continue;
    }
    const breakfast = normalizeZtripBreakfast(breakfastMatch[0]);
    if (ratePlan && breakfast !== hotelRatePlanBreakfast(ratePlan)) {
      continue;
    }

    const afterBreakfast = breakfastMatch ? snippet.slice((breakfastMatch.index ?? 0) + breakfastMatch[0].length) : snippet;
    const price = priceFromZtripSnippet(afterBreakfast) ?? priceFromZtripSnippet(snippet);
    const roomType = roomLine.split(/\d+m²|CNY/i)[0].trim();

    if (bedType && breakfast) {
      rates.push({
        hotelName,
        roomType,
        bedType,
        breakfast,
        price,
        rawText: snippet
      });
    }
  }

  return rates;
}

async function openQingmaoDomesticFlightTab(page: BrowserPage) {
  if (!/TravelBooking/i.test(page.url())) {
    await page.getByText("差旅预订", { exact: true }).first().click({ timeout: 8_000 });
    await page.waitForTimeout(3_000);
  }

  const domesticTab = page.locator("#tab-101");
  if ((await domesticTab.count().catch(() => 0)) > 0) {
    await domesticTab.click({ timeout: 8_000 });
  } else {
    await page.getByText("国内机票", { exact: true }).first().click({ timeout: 8_000 });
  }

  await page.waitForTimeout(5_000);
}

function findQingmaoFlightFrame(page: BrowserPage) {
  return page.frames().find((frame) => frame.url().includes("mrs.tmctrip.com") && frame.url().includes("type=flight")) ?? null;
}

function findQingmaoTrafficFrame(page: BrowserPage) {
  return page.frames().find((frame) => frame.url().includes("mcqt.tmctrip.com")) ?? null;
}

async function waitForQingmaoIntegratedTrafficFrame(page: BrowserPage) {
  for (let index = 0; index < 30; index += 1) {
    const frame = page.frames().find((item) => item.url().includes("integratedTraffic"));
    const bodyText = await frame?.locator("body").innerText({ timeout: 1_000 }).catch(() => "") ?? "";
    if (frame && bodyText.includes("国际机票")) {
      return frame;
    }

    await page.waitForTimeout(500);
  }

  return null;
}

async function clickVisibleFrameElement(frame: BrowserFrame, selector: string, text?: string) {
  const selectorValue = JSON.stringify(selector);
  const textValue = JSON.stringify(text ?? "");
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const clicked = await frame.evaluate<boolean>(`(() => {
      const selector = ${selectorValue};
      const text = ${textValue};
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && rect.x >= 0 && rect.x < window.innerWidth && style.visibility !== "hidden" && style.display !== "none";
      };
      const elements = Array.from(document.querySelectorAll(selector)).filter((element) => {
        const matchesText = text ? (element.textContent || "").trim().includes(text) : true;
        return matchesText && isVisible(element);
      });
      const target = elements[0];
      if (target) target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return Boolean(target);
    })()`);

    if (clicked) return;
    await frame.waitForTimeout(500);
  }

  throw new Error(`未找到可点击的青猫页面元素 ${selector}`);
}

async function openQingmaoInternationalFlightTab(page: BrowserPage) {
  if (!/TravelBooking/i.test(page.url())) {
    await page.getByText("差旅预订", { exact: true }).first().click({ timeout: 8_000 });
    await page.waitForTimeout(3_000);
  }

  const currentFrame = findQingmaoTrafficFrame(page);
  if (currentFrame && !currentFrame.url().includes("integratedTraffic")) {
    await currentFrame.evaluate(`(() => {
      window.location.href = "https://mcqt.tmctrip.com/pages/product3.0/integratedTraffic/index?productType=5&fromHomePage=1";
    })()`);
    await waitForQingmaoIntegratedTrafficFrame(page);
  }

  const otherBookingTab = page.locator("#tab-16");
  if ((await otherBookingTab.count().catch(() => 0)) > 0) {
    await otherBookingTab.click({ timeout: 8_000 });
  } else {
    await page.getByText("其他预订", { exact: true }).first().click({ timeout: 8_000 });
  }
  await page.waitForTimeout(1_000);

  const frame = await waitForQingmaoIntegratedTrafficFrame(page);
  if (!frame) {
    throw new Error("未找到青猫其他预订 iframe");
  }

  await clickVisibleFrameElement(frame, ".tw-trapezoid-tabs-item", "国际机票");
  await frame.waitForTimeout(1_000);
}

function qingmaoCitySearchName(city: string) {
  return citySearchNames[city] ?? city;
}

async function selectQingmaoMobileCity(page: BrowserPage, areaSelector: ".departArea" | ".arriveArea", city: string) {
  let frame = findQingmaoTrafficFrame(page);
  if (!frame) {
    throw new Error("未找到青猫国际机票 iframe");
  }

  await clickVisibleFrameElement(frame, areaSelector);
  await page.waitForTimeout(800);
  frame = findQingmaoTrafficFrame(page);

  if (!frame || !frame.url().includes("cityAirport")) {
    throw new Error(`青猫国际未打开${areaSelector === ".departArea" ? "出发地" : "目的地"}城市选择页`);
  }

  const searchName = qingmaoCitySearchName(city);
  const tabText = aliInternationalCities.has(city) || aliInternationalCities.has(searchName) ? "国际/中国港澳台" : "国内";
  const tabValue = JSON.stringify(tabText);
  const clickedTab = await frame.evaluate<boolean>(`(() => {
    const targetTab = ${tabValue};
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const tab = Array.from(document.querySelectorAll("uni-view, uni-text, span"))
      .find((element) => (element.textContent || "").trim() === targetTab && isVisible(element));
    if (tab) {
      tab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    }
    return false;
  })()`);

  if (!clickedTab) {
    throw new Error(`青猫国际未找到城市标签 ${tabText}`);
  }

  await frame.waitForTimeout(500);
  await frame.locator("input.uni-input-input").first().fill(searchName);
  const cityName = JSON.stringify(searchName);
  let clicked = false;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await frame.waitForTimeout(500);
    clicked = await frame.evaluate<boolean>(`(() => {
      const cityName = ${cityName};
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const exactCity = Array.from(document.querySelectorAll("uni-view, uni-text, span"))
        .find((element) => (element.textContent || "").trim() === cityName && isVisible(element));
      const clickableRow = exactCity?.closest(".border-bottom-line, .search-list > uni-view, .a-pl-108") ?? null;
      const airportRow = Array.from(document.querySelectorAll(".search-list uni-view, uni-view"))
        .find((element) => {
          const text = (element.textContent || "").trim();
          return isVisible(element) && (text === cityName || text.includes(cityName + "白云国际机场") || text.includes(cityName));
        });
      const target = clickableRow || airportRow || exactCity;
      if (target) {
        target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      }
      return Boolean(target);
    })()`);

    if (clicked) {
      break;
    }
  }

  if (!clicked) {
    throw new Error(`青猫国际未找到城市 ${city}`);
  }

  await page.waitForTimeout(1_000);
}

async function selectQingmaoMobileDate(page: BrowserPage, travelDate: string) {
  let frame = findQingmaoTrafficFrame(page);
  if (!frame) {
    throw new Error("未找到青猫国际机票 iframe");
  }

  const [, monthRaw, dayRaw] = travelDate.split("-");
  const selectedDateTexts = [`${monthRaw}月${dayRaw}日`, `${Number(monthRaw)}月${Number(dayRaw)}日`];
  const currentBodyText = await frame.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
  if (selectedDateTexts.some((text) => currentBodyText.includes(text))) {
    return;
  }

  try {
    await frame
      .locator('.swiper-item:has-text("所选日期为航班起降当地日期") .p-30-0:has-text("所选日期为航班起降当地日期")')
      .first()
      .click({ timeout: 8_000 });
  } catch {
    await clickVisibleFrameElement(frame, "uni-view", "所选日期为航班起降当地日期");
  }
  await frame.waitForTimeout(500);
  const dateValue = JSON.stringify(travelDate);
  const dayText = String(Number(dayRaw));
  let clicked = false;
  try {
    await frame.locator(`.item-box:has-text("${dayText}")`).first().click({ timeout: 8_000 });
    clicked = true;
  } catch {
    clicked = await frame.evaluate<boolean>(`(() => {
    const [year, monthValue, dayValue] = ${dateValue}.split("-").map(Number);
    const monthText = year + "年" + monthValue + "月";
    const dayText = String(dayValue);
    const isVisibleEnough = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const monthHeaders = Array.from(document.querySelectorAll("uni-view, uni-text, span"))
      .filter((element) => (element.textContent || "").trim() === monthText && isVisibleEnough(element));
    const monthHeader = monthHeaders[0];
    if (!monthHeader) return false;
    const monthY = monthHeader.getBoundingClientRect().y;
    const nextMonthHeader = Array.from(document.querySelectorAll("uni-view, uni-text, span"))
      .filter((element) => /^\\d{4}年\\d+月$/.test((element.textContent || "").trim()) && element.getBoundingClientRect().y > monthY)
      .sort((left, right) => left.getBoundingClientRect().y - right.getBoundingClientRect().y)[0];
    const nextMonthY = nextMonthHeader ? nextMonthHeader.getBoundingClientRect().y : Number.POSITIVE_INFINITY;
    const day = Array.from(document.querySelectorAll(".item-box"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const text = (element.textContent || "").trim();
        return rect.y > monthY && rect.y < nextMonthY && text === dayText && isVisibleEnough(element);
      })[0];
    if (day) day.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return Boolean(day);
  })()`);
  }

  if (!clicked) {
    throw new Error(`青猫国际未找到日期 ${travelDate}`);
  }

  await page.waitForTimeout(800);
}

async function searchQingmaoInternationalFlightRoute(page: BrowserPage, route: PilotRoute) {
  await openQingmaoInternationalFlightTab(page);
  await selectQingmaoMobileCity(page, ".departArea", route.origin);
  await selectQingmaoMobileCity(page, ".arriveArea", route.destination);
  await selectQingmaoMobileDate(page, route.travelDate);

  let frame = findQingmaoTrafficFrame(page);
  if (!frame) {
    throw new Error("未找到青猫国际机票 iframe");
  }

  await clickVisibleFrameElement(frame, ".common-search-btn", "查询");

  for (let index = 0; index < 90; index += 1) {
    frame = findQingmaoTrafficFrame(page);
    const bodyText = await frame?.locator("body").innerText({ timeout: 2_000 }).catch(() => "") ?? "";

    if (/￥\d+/.test(bodyText) || /暂无|无航班/.test(bodyText)) {
      return frame as BrowserFrame;
    }

    await page.waitForTimeout(1_000);
  }

  frame = findQingmaoTrafficFrame(page);
  if (!frame) {
    throw new Error("青猫国际查询后未找到结果 iframe");
  }

  return frame;
}

async function selectQingmaoCity(frame: BrowserFrame, selectIndex: number, city: string) {
  const select = frame.locator(".el-select").nth(selectIndex);
  const currentText = await select.innerText({ timeout: 3_000 }).catch(() => "");
  if (currentText.includes(city)) {
    return;
  }

  const cityNameValue = JSON.stringify(city);
  const clickCityOption = async () => frame.evaluate<boolean>(`(() => {
      const cityName = ${cityNameValue};
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const item = Array.from(document.querySelectorAll(".el-select-dropdown__item, [role='option']"))
        .find((element) => {
          const text = (element.textContent || "").trim();
          return isVisible(element) && (text === cityName || text.includes(cityName));
        });
      if (!item) return false;
      item.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, cancelable: true, view: window }));
      item.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      item.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      item.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    })()`);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await select.click({ timeout: 8_000 });
    await frame.waitForTimeout(300);
    await frame.locator("input.el-select__input").nth(selectIndex).fill(city);

    for (let index = 0; index < 10; index += 1) {
      const clicked = await clickCityOption();
      if (clicked) {
        await frame.waitForTimeout(500);
        const selectedText = await select.innerText({ timeout: 2_000 }).catch(() => "");
        if (selectedText.includes(city)) return;
      }
      await frame.waitForTimeout(300);
    }

    const selectedText = await select.innerText({ timeout: 2_000 }).catch(() => "");
    if (selectedText.includes(city)) {
      return;
    }
  }

  throw new Error(`青猫国内未找到城市 ${city}`);
}

async function searchQingmaoFlightRoute(frame: BrowserFrame, route: PilotRoute) {
  await selectQingmaoCity(frame, 0, route.origin);
  await selectQingmaoCity(frame, 1, route.destination);

  const dateInput = frame.locator("input[placeholder=\"选择出发日期\"]");
  await dateInput.click({ timeout: 8_000 });
  await dateInput.fill(route.travelDate);
  await dateInput.press("Enter").catch(() => undefined);
  await frame.waitForTimeout(800);
  await frame.getByText("搜索航班", { exact: true }).click({ timeout: 8_000 });

  for (let index = 0; index < 70; index += 1) {
    const itemCount = await frame.locator(".list-item").count().catch(() => 0);
    const bodyText = await frame.locator("body").innerText({ timeout: 2_000 }).catch(() => "");

    if (itemCount > 0 || (/暂无符合条件的航班/.test(bodyText) && !/共\d+个航班/.test(bodyText))) {
      return;
    }

    await frame.waitForTimeout(1_000);
  }
}

async function extractQingmaoFlightCandidates(frame: BrowserFrame): Promise<QingmaoFlightCandidate[]> {
  const rawItems = await frame.evaluate<string[]>(`(() =>
    Array.from(document.querySelectorAll(".list-item"))
      .slice(0, 12)
      .map((item) => (item.textContent || "").replace(/\\s+/g, " ").trim())
  )()`);

  const domesticCandidates = rawItems
    .map((item) => parseQingmaoFlightCandidateText(item))
    .filter((candidate): candidate is QingmaoFlightCandidate => Boolean(candidate));

  if (domesticCandidates.length > 0) {
    return domesticCandidates;
  }

  const bodyText = await frame.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  return parseQingmaoInternationalFlightCandidatesText(bodyText).slice(0, 12);
}

async function readQingmaoTotalFlightCount(frame: BrowserFrame) {
  const bodyText = await frame.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  const match = bodyText.match(/共(\d+)个航班/);
  if (match) return Number(match[1]);

  const internationalCandidates = parseQingmaoInternationalFlightCandidatesText(bodyText);
  return internationalCandidates.length > 0 ? internationalCandidates.length : null;
}

function pickRandomQingmaoCandidate(candidates: QingmaoFlightCandidate[], random: () => number) {
  const selectable = candidates.filter((candidate) => candidate.flightNo && typeof candidate.price === "number" && !candidate.shared);
  if (!selectable.length) return null;

  const index = Math.min(selectable.length - 1, Math.floor(random() * selectable.length));
  return selectable[index];
}

function shuffledQingmaoCandidates(candidates: QingmaoFlightCandidate[], random: () => number) {
  const selectable = candidates.filter((candidate) => candidate.flightNo && typeof candidate.price === "number" && !candidate.shared);

  for (let index = selectable.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.min(index, Math.floor(random() * (index + 1)));
    [selectable[index], selectable[swapIndex]] = [selectable[swapIndex], selectable[index]];
  }

  return selectable;
}

function buildQingmaoQuote(candidate: QingmaoFlightCandidate, screenshotPath?: string): SameFlightPlatformQuote {
  return {
    platform: "青猫差旅",
    status: typeof candidate.price === "number" ? "available" : "not-found",
    price: candidate.price,
    screenshotPath,
    rawText: candidate.rawText
  };
}

const requiredPlatforms: PlatformName[] = ["青猫差旅", "携程商旅", "阿里商旅", "在途商旅"];

export function hasCompleteSameFlightQuotes(quotes: SameFlightPlatformQuote[]) {
  return requiredPlatforms.every((platform) =>
    quotes.some((quote) => quote.platform === platform && quote.status === "available" && typeof quote.price === "number")
  );
}

function incompleteQuoteReason(quotes: SameFlightPlatformQuote[]) {
  return requiredPlatforms
    .filter((platform) => !quotes.some((quote) => quote.platform === platform && quote.status === "available" && typeof quote.price === "number"))
    .map((platform) => {
      const quote = quotes.find((item) => item.platform === platform);
      if (!quote) return `${platform}未返回`;
      if (quote.error) return `${platform}${quote.status === "failed" ? "采集失败" : "无可订价格"}：${quote.error}`;
      if (quote.status === "not-found") return `${platform}无同航班`;
      return `${platform}无可订价格`;
    })
    .join("，");
}

function mapQuoteStatus(status: SameFlightQuoteStatus) {
  if (status === "available") return "可订" as const;
  if (status === "not-found") return "无同航班" as const;
  return "采集失败" as const;
}

function evidenceExtension(evidencePath?: string) {
  const extension = evidencePath ? path.extname(evidencePath) : "";
  return extension && /^\.[a-z0-9]+$/i.test(extension) ? extension : ".png";
}

function relativeScreenshotPath(batchId: string, sampleId: string, platform: PlatformName, extension = ".png") {
  return `screenshots/${batchId}/${sampleId}-${platformSlug(platform)}${extension}`;
}

function platformSlug(platform: PlatformName) {
  const slugs: Record<PlatformName, string> = {
    青猫差旅: "qingmao",
    携程商旅: "ctrip",
    阿里商旅: "alibtrip",
    在途商旅: "ztrip"
  };
  return slugs[platform];
}

function mapSameFlightQuoteToPlatformQuote(quote: SameFlightPlatformQuote, batchId: string, sampleId: string): PlatformQuote {
  return {
    platform: quote.platform,
    price: quote.status === "available" ? quote.price : null,
    refundRule: quote.status === "available" ? "以平台页面展示及航司规则为准" : quote.error ? `采集失败：${quote.error}` : "未展示同航班退改规则",
    baggageRule: quote.status === "available" ? "以平台页面展示及航司规则为准" : quote.error ? "采集失败，未读取行李规则" : "未展示同航班行李规则",
    available: quote.status === "available",
    status: mapQuoteStatus(quote.status),
    evidencePath: relativeScreenshotPath(batchId, sampleId, quote.platform, evidenceExtension(quote.screenshotPath)),
    sourceUrl: quote.finalUrl ?? ""
  };
}

async function persistSameFlightQuote(
  quote: SameFlightPlatformQuote,
  publicScreenshotDir: string,
  batchId: string,
  sampleId: string
): Promise<PlatformQuote> {
  const publicScreenshotPath = path.join(publicScreenshotDir, `${sampleId}-${platformSlug(quote.platform)}${evidenceExtension(quote.screenshotPath)}`);

  if (quote.screenshotPath && fs.existsSync(quote.screenshotPath)) {
    await fsp.copyFile(quote.screenshotPath, publicScreenshotPath).catch(() => undefined);
    return mapSameFlightQuoteToPlatformQuote({ ...quote, screenshotPath: publicScreenshotPath }, batchId, sampleId);
  }

  const fallbackPath = publicScreenshotPath.replace(/\.[^.]+$/, ".html");
  await writeEvidenceSnapshotHtml(fallbackPath, {
    platform: quote.platform,
    finalUrl: quote.finalUrl,
    rawText: quote.rawText,
    price: quote.price,
    error: quote.error ?? "截图文件未成功保存"
  });
  return mapSameFlightQuoteToPlatformQuote({ ...quote, screenshotPath: fallbackPath }, batchId, sampleId);
}

function buildFlightSampleFromRealQuote(
  sampleId: string,
  routeConfig: RouteConfig,
  route: PilotRoute,
  selectedFlight: QingmaoFlightCandidate,
  quotes: PlatformQuote[]
): FlightSample {
  return {
    id: sampleId,
    routeId: routeConfig.id,
    scope: route.scope,
    origin: route.origin,
    destination: route.destination,
    travelDate: route.travelDate,
    flightNo: selectedFlight.flightNo,
    airline: selectedFlight.airline,
    cabin: "经济舱",
    directType: "直飞",
    transferCity: "",
    durationMinutes: selectedFlight.durationMinutes ?? 0,
    quotes
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractSameFlightQuoteFromText(bodyText: string, flightNo: string) {
  const text = bodyText.replace(/\s+/g, " ").trim();
  const flightPattern = new RegExp(escapeRegExp(flightNo), "i");
  const match = flightPattern.exec(text);

  if (!match || match.index === undefined) {
    return {
      status: "not-found" as SameFlightQuoteStatus,
      price: null,
      rawText: ""
    };
  }

  const snippet = text.slice(match.index, match.index + 900);
  const priceMatch = snippet.match(/[￥¥]\s*(\d{2,5})(?:\s*起)?/);

  return {
    status: priceMatch ? "available" as SameFlightQuoteStatus : "not-found" as SameFlightQuoteStatus,
    price: priceMatch ? Number(priceMatch[1]) : null,
    rawText: snippet.slice(0, 900)
  };
}

async function getOrCreatePlatformPage(context: BrowserContext, url: string) {
  return findExistingPage(context, url) ?? await context.newPage();
}

function snapshotBrowserPages(context: BrowserContext) {
  return new Set(context.pages());
}

function isTemporaryHotelPage(page: BrowserPage) {
  const url = page.url();
  if (!url || url === "about:blank") return true;
  if (/g\.alicdn\.com\/platform\/xdomain-storage/.test(url)) return true;
  if (/travel\.alibtrip\.com\/hotel-demeter/i.test(url)) return true;
  if (/ct\.ctrip\.com\/corp-hotel-booking\/hotel/i.test(url)) return true;
  if (/www\.z-trip\.cn\/v\/pg\/hotel\//i.test(url)) return true;
  return false;
}

function platformRootKey(url: string) {
  if (/booking\.tmctrip\.com\/TravelBooking/i.test(url)) return "qingmao";
  if (/ct\.ctrip\.com\/(?:online\/home|login)/i.test(url)) return "ctrip";
  if (/travel\.alibtrip\.com\/index\.html/i.test(url)) return "alibtrip";
  if (/www\.z-trip\.cn\/v\/vcommon\/home/i.test(url)) return "ztrip";
  return "";
}

function platformRootScore(url: string) {
  if (/booking\.tmctrip\.com\/TravelBooking/i.test(url)) return 3;
  if (/ct\.ctrip\.com\/online\/home\?language=zh-CN/i.test(url)) return 3;
  if (/ct\.ctrip\.com\/online\/home/i.test(url)) return 2;
  if (/travel\.alibtrip\.com\/index\.html#\/hotel/i.test(url)) return 3;
  if (/www\.z-trip\.cn\/v\/vcommon\/home/i.test(url)) return 3;
  if (/login/i.test(url)) return 1;
  return 2;
}

async function ensurePlatformRootPages(context: BrowserContext) {
  const roots = [
    { key: "qingmao", url: platformUrls.青猫差旅 },
    { key: "ctrip", url: "https://ct.ctrip.com/online/home" },
    { key: "alibtrip", url: "https://travel.alibtrip.com/index.html#/hotel" },
    { key: "ztrip", url: platformUrls.在途商旅 }
  ];
  let openedCount = 0;

  for (const root of roots) {
    const bestExisting = context.pages()
      .filter((page) => platformRootKey(page.url()) === root.key)
      .sort((left, right) => platformRootScore(right.url()) - platformRootScore(left.url()))[0] ?? null;

    if (bestExisting && platformRootScore(bestExisting.url()) >= 2) continue;

    const page = await context.newPage();
    await page.goto(root.url, { waitUntil: "domcontentloaded", timeout: 45_000 }).then(() => {
      openedCount += 1;
    }).catch(async () => {
      if (typeof page.close === "function") {
        await page.close({ runBeforeUnload: false }).catch(() => undefined);
      }
    });
  }

  return openedCount;
}

async function closeTemporaryHotelPages(context: BrowserContext, keepPages: Set<BrowserPage> = new Set()) {
  let closedCount = 0;
  const preferredRoots = new Map<string, BrowserPage>();
  for (const page of context.pages()) {
    if (keepPages.has(page)) continue;
    const key = platformRootKey(page.url());
    if (!key) continue;
    const current = preferredRoots.get(key);
    if (!current || platformRootScore(page.url()) > platformRootScore(current.url())) {
      preferredRoots.set(key, page);
    }
  }

  for (const page of context.pages()) {
    const key = platformRootKey(page.url());
    const shouldCloseDuplicateRoot = Boolean(key && preferredRoots.get(key) !== page);
    if (keepPages.has(page) || (!isTemporaryHotelPage(page) && !shouldCloseDuplicateRoot) || typeof page.close !== "function") {
      continue;
    }
    await page.close({ runBeforeUnload: false }).then(() => {
      closedCount += 1;
    }).catch(() => undefined);
  }
  return closedCount;
}

async function closeCreatedBrowserPages(context: BrowserContext, pagesBeforeRun: Set<BrowserPage>, keepPages: Set<BrowserPage> = new Set()) {
  let closedCount = 0;
  for (const page of context.pages()) {
    if (pagesBeforeRun.has(page) || keepPages.has(page) || typeof page.close !== "function") {
      continue;
    }
    await page.close({ runBeforeUnload: false }).then(() => {
      closedCount += 1;
    }).catch(() => undefined);
  }
  return closedCount;
}

interface EvidenceSnapshot {
  platform: PlatformName;
  route?: PilotRoute;
  selectedFlight?: QingmaoFlightCandidate;
  price?: number | null;
  finalUrl?: string;
  bodyText?: string;
  rawText?: string;
  error?: string;
}

async function savePageScreenshot(page: BrowserPage, screenshotPath: string): Promise<boolean> {
  await fsp.mkdir(path.dirname(screenshotPath), { recursive: true });

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 10_000 });
    return await fileExistsWithContent(screenshotPath);
  } catch {
    await page.screenshot({ path: screenshotPath, timeout: 10_000 }).catch(() => undefined);
    return await fileExistsWithContent(screenshotPath);
  }
}

async function savePageEvidence(page: BrowserPage, screenshotPath: string, snapshot: EvidenceSnapshot): Promise<string> {
  if (await savePageScreenshot(page, screenshotPath)) {
    return screenshotPath;
  }

  const fallbackPath = screenshotPath.replace(/\.[^.]+$/, ".html");
  const bodyText = snapshot.bodyText ?? await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
  await writeEvidenceSnapshotHtml(fallbackPath, {
    ...snapshot,
    finalUrl: snapshot.finalUrl ?? page.url(),
    bodyText
  });
  return fallbackPath;
}

async function fileExistsWithContent(filePath: string) {
  try {
    return (await fsp.stat(filePath)).size > 0;
  } catch {
    return false;
  }
}

async function writeEvidenceSnapshotHtml(filePath: string, snapshot: EvidenceSnapshot) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const routeText = snapshot.route ? `${snapshot.route.origin} - ${snapshot.route.destination} / ${snapshot.route.travelDate}` : "";
  const flightText = snapshot.selectedFlight ? `${snapshot.selectedFlight.airline} ${snapshot.selectedFlight.flightNo}` : "";
  const bodyText = snapshot.bodyText ?? snapshot.rawText ?? "";
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(snapshot.platform)}网页截图</title>
  <style>
    body { margin: 0; padding: 32px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #0f2742; background: #f5f8fb; }
    main { max-width: 960px; margin: 0 auto; background: white; border: 1px solid #d9e2ef; border-radius: 12px; padding: 28px; box-shadow: 0 18px 45px rgba(15, 39, 66, 0.08); }
    h1 { margin: 0 0 18px; font-size: 28px; }
    dl { display: grid; grid-template-columns: 120px 1fr; gap: 10px 18px; margin: 0 0 24px; }
    dt { color: #65758c; }
    dd { margin: 0; font-weight: 650; }
    pre { white-space: pre-wrap; word-break: break-word; background: #f8fafc; border: 1px solid #d9e2ef; border-radius: 8px; padding: 16px; line-height: 1.7; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(snapshot.platform)}网页截图</h1>
    <dl>
      <dt>页面</dt><dd>${escapeHtml(snapshot.finalUrl ?? "")}</dd>
      <dt>航线</dt><dd>${escapeHtml(routeText)}</dd>
      <dt>航班</dt><dd>${escapeHtml(flightText)}</dd>
      <dt>价格</dt><dd>${snapshot.price == null ? "未读取" : `¥${snapshot.price}`}</dd>
      <dt>状态</dt><dd>${escapeHtml(snapshot.error ?? "页面截图保存异常，已保留采集时页面文本")}</dd>
    </dl>
    <pre>${escapeHtml(bodyText)}</pre>
  </main>
</body>
</html>`;
  await fsp.writeFile(filePath, html, "utf8");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

async function waitForSearchText(page: BrowserPage, flightNo: string, options: { returnOnGenericResult?: boolean } = {}) {
  const returnOnGenericResult = options.returnOnGenericResult ?? true;

  for (let index = 0; index < 45; index += 1) {
    const bodyText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
    if (bodyText.includes(flightNo) || /暂无|无航班|没有找到|出错了|异常/.test(bodyText)) {
      return bodyText;
    }

    if (returnOnGenericResult && /订票|预订|个航班/.test(bodyText)) {
      return bodyText;
    }

    await page.waitForTimeout(1_000);
  }

  return page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
}

async function clickVisibleText(page: BrowserPage, text: string) {
  const targetText = JSON.stringify(text);
  const clicked = await page.evaluate<boolean>(`(() => {
    const targetText = ${targetText};
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const score = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width * rect.height;
    };
    const buttons = Array.from(document.querySelectorAll("button, [role='button']"))
      .filter((element) => (element.textContent || "").includes(targetText) && isVisible(element))
      .sort((left, right) => score(right) - score(left));
    const elements = Array.from(document.querySelectorAll("a, div, span, li"))
      .filter((element) => (element.textContent || "").trim() === targetText && isVisible(element));
    const nearestButton = elements.map((element) => element.closest("button, [role='button']")).find(Boolean);
    const target = buttons[0] || nearestButton || elements[0];
    if (target) target.click();
    return Boolean(target);
  })()`);

  if (!clicked) {
    throw new Error(`未找到可点击的“${text}”`);
  }
}

async function selectCtripCity(page: BrowserPage, inputIndex: number, city: string) {
  const input = page.locator("input[placeholder=\"城市或机场\"]").nth(inputIndex);
  await input.click({ timeout: 10_000 });
  await input.fill(city);
  await page.waitForTimeout(1_000);
  await page.locator(".searchedCity").first().click({ timeout: 10_000 });
  await page.waitForTimeout(500);
}

async function selectCtripDate(page: BrowserPage, travelDate: string) {
  await page.locator("input[placeholder=\"选择日期\"]").click({ timeout: 10_000 });
  await page.waitForTimeout(500);
  const dateValue = JSON.stringify(travelDate);
  const clicked = await page.evaluate<boolean>(`(() => {
    const [year, monthValue, dayValue] = ${dateValue}.split("-").map(Number);
    const monthText = year + "年" + monthValue + "月";
    const dayText = String(dayValue);
    const months = Array.from(document.querySelectorAll(".c-calendar-month"));
    const month = months.find((element) => (element.textContent || "").includes(monthText));
    const day = Array.from(month ? month.querySelectorAll(".day") : [])
      .find((element) => (element.textContent || "").trim() === dayText);
    if (day) day.click();
    return Boolean(day);
  })()`);

  if (!clicked) {
    throw new Error(`携程商旅未找到日期 ${travelDate}`);
  }
}

async function searchCtripSameFlightQuote(
  context: BrowserContext,
  artifactDir: string,
  route: PilotRoute,
  selectedFlight: QingmaoFlightCandidate,
  screenshotFilename = "携程商旅-同航班.png"
): Promise<SameFlightPlatformQuote> {
  const page = await getOrCreatePlatformPage(context, "https://ct.ctrip.com");
  const screenshotPath = path.join(artifactDir, screenshotFilename);

  try {
    await page.goto("https://ct.ctrip.com/online/home", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(3_000);
    await selectCtripCity(page, 0, route.origin);
    await selectCtripCity(page, 1, route.destination);
    await selectCtripDate(page, route.travelDate);
    await clickVisibleText(page, "因公出行");
    await page.waitForLoadState?.("domcontentloaded", { timeout: 30_000 }).catch(() => undefined);
    const bodyText = await waitForSearchText(page, selectedFlight.flightNo);
    const extracted = extractSameFlightQuoteFromText(bodyText, selectedFlight.flightNo);
    const evidencePath = await savePageEvidence(page, screenshotPath, {
      platform: "携程商旅",
      route,
      selectedFlight,
      price: extracted.price,
      bodyText
    });

    return {
      platform: "携程商旅",
      status: extracted.status,
      price: extracted.price,
      finalUrl: page.url(),
      screenshotPath: evidencePath,
      rawText: extracted.rawText
    };
  } catch (error) {
    const errorText = errorMessage(error);
    const evidencePath = await savePageEvidence(page, screenshotPath, {
      platform: "携程商旅",
      route,
      selectedFlight,
      price: null,
      error: errorText
    });
    return {
      platform: "携程商旅",
      status: "failed",
      price: null,
      finalUrl: page.url(),
      screenshotPath: evidencePath,
      error: errorText
    };
  }
}

async function searchZtripSameFlightQuote(
  context: BrowserContext,
  artifactDir: string,
  route: PilotRoute,
  selectedFlight: QingmaoFlightCandidate,
  screenshotFilename = "在途商旅-同航班.png"
): Promise<SameFlightPlatformQuote> {
  const page = findExistingPage(context, platformUrls.在途商旅) ?? await context.newPage();
  const screenshotPath = path.join(artifactDir, screenshotFilename);

  try {
    if (!page.url().includes(domainFromUrl(platformUrls.在途商旅))) {
      await page.goto(platformUrls.在途商旅, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForLoadState?.("networkidle", { timeout: 15_000 }).catch(() => undefined);
    }

    const resultPage = route.scope === "国内"
      ? await searchZtripFlightRoute(page, route, context)
      : await searchZtripInternationalFlightRoute(page, route, context);
    const bodyText = await waitForZtripFlightResultText(resultPage);
    const matchedFlight = parseZtripFlightCandidatesText(bodyText).find((candidate) => candidate.flightNo === selectedFlight.flightNo);
    const evidencePath = await savePageEvidence(resultPage, screenshotPath, {
      platform: "在途商旅",
      route,
      selectedFlight,
      price: matchedFlight?.price ?? null,
      bodyText,
      rawText: matchedFlight?.rawText
    });

    return {
      platform: "在途商旅",
      status: matchedFlight && typeof matchedFlight.price === "number" ? "available" : "not-found",
      price: matchedFlight?.price ?? null,
      finalUrl: resultPage.url(),
      screenshotPath: evidencePath,
      rawText: matchedFlight?.rawText ?? bodyText.slice(0, 500)
    };
  } catch (error) {
    const errorText = errorMessage(error);
    const evidencePath = await savePageEvidence(page, screenshotPath, {
      platform: "在途商旅",
      route,
      selectedFlight,
      price: null,
      error: errorText
    });
    return {
      platform: "在途商旅",
      status: "failed",
      price: null,
      finalUrl: page.url(),
      screenshotPath: evidencePath,
      error: errorText
    };
  }
}

function isAliFlightHomeUrl(urlValue: string) {
  return /travel\.alibtrip\.com\/index\.html.*#\/flight/i.test(urlValue);
}

function explainAliInternationalSubmitFailure(bodyText: string, preSaveText: string) {
  if (/DOMESTIC/.test(preSaveText)) {
    return "阿里商旅国际查询未进入结果页：平台预提交返回国内机票链路，自动化未成功切到国际航班状态";
  }

  if (/缺少业务参数btripCorpId|供应商搜索异常|当前页面停留时间太久/.test(bodyText)) {
    return "阿里商旅国际查询未进入有效结果页：" + (bodyText.match(/缺少业务参数btripCorpId|供应商搜索异常|当前页面停留时间太久/)?.[0] ?? "页面异常");
  }

  return "阿里商旅国际查询提交后仍停留在首页，未进入国际机票结果页";
}

function readAliItineraryIdFromUrl(urlValue: string) {
  try {
    return new URL(urlValue).searchParams.get("itineraryId");
  } catch {
    return null;
  }
}

function buildAliSearchListUrl(baseUrl: string, route: PilotRoute, itineraryId: string) {
  const base = new URL(baseUrl);
  const params = new URLSearchParams(base.search);
  params.set("tripType", "0");
  params.set("itineraryId", itineraryId);
  params.set("agg", "false");
  params.set("depCityName", route.origin);
  params.set("depCityCode", cityCodes[route.origin] ?? route.origin);
  params.set("arrCityName", route.destination);
  params.set("arrCityCode", cityCodes[route.destination] ?? route.destination);
  params.set("closeAgreementPrice", "false");
  params.set("leaveDate", route.travelDate);
  params.set("searchParamKey", crypto.randomUUID());
  params.set("sessionKey", `flightSession_${crypto.randomUUID().replace(/-/g, "")}`);
  params.set("pnc", "1,0,0");

  return `https://travel.alibtrip.com/flight-2025?${params.toString()}#/search-list`;
}

function parseAliItineraryNoFromPreSaveText(preSaveText: string) {
  try {
    const parsed = JSON.parse(preSaveText) as { data?: { bookingUrl?: string; componentResult?: Array<{ itineraryNo?: string }> } };
    const bookingUrl = parsed.data?.bookingUrl;
    if (bookingUrl) {
      const itineraryId = new URL(bookingUrl).searchParams.get("itineraryId");
      if (itineraryId) return itineraryId;
    }

    return parsed.data?.componentResult?.find((item) => item.itineraryNo)?.itineraryNo ?? null;
  } catch {
    return null;
  }
}

async function readAliIdentityParams(page: BrowserPage) {
  return page.evaluate<{ corpId: string; userId: string; fpt: string }>(`(() => {
    const defaults = { corpId: "", userId: "", fpt: "bIdentify(main.newpc.newpc.c)" };
    const readFromUrl = (urlValue) => {
      try {
        const params = new URL(urlValue).searchParams;
        return {
          corpId: params.get("corpId") || "",
          userId: params.get("userId") || "",
          fpt: params.get("fpt") || ""
        };
      } catch {
        return { corpId: "", userId: "", fpt: "" };
      }
    };
    const current = readFromUrl(location.href);
    if (current.corpId && current.userId) {
      return { ...defaults, ...current, fpt: current.fpt || defaults.fpt };
    }

    try {
      const menus = JSON.parse(localStorage.getItem("SFS_BTRIP_PC_NAVIGATION_MENU_LIST_CACHE") || "[]");
      const flightMenu = menus.find((item) => item && item.label === "机票" && item.url);
      const fromMenu = readFromUrl(flightMenu?.url || "");
      if (fromMenu.corpId && fromMenu.userId) {
        return { ...defaults, ...fromMenu, fpt: fromMenu.fpt || defaults.fpt };
      }
    } catch {
      // Ignore malformed platform cache and continue to corp cache.
    }

    try {
      const corps = JSON.parse(localStorage.getItem("SFS_BTRIP_PC_NAVIGATION_CORP_LIST_CACHE") || "[]");
      const corp = corps.find((item) => item && item.corpId && item.userId);
      if (corp) {
        return { ...defaults, corpId: String(corp.corpId), userId: String(corp.userId) };
      }
    } catch {
      // Ignore malformed platform cache.
    }

    return defaults;
  })()`);
}

async function callAliMtop(
  context: BrowserContext,
  page: BrowserPage,
  api: string,
  data: Record<string, unknown>
) {
  const parsed = await callAliMtopRaw(context, page, api, data);
  if (!parsed.ret?.some((item) => item.includes("SUCCESS")) || !parsed.data?.result) {
    throw new Error(`阿里商旅接口调用失败：${parsed.ret?.join(",") ?? JSON.stringify(parsed).slice(0, 120)}`);
  }

  return parsed.data.result;
}

async function callAliMtopRaw(
  context: BrowserContext,
  page: BrowserPage,
  api: string,
  data: Record<string, unknown>
) {
  const cookies = await context.cookies?.(["https://h5api.m.alibtrip.com", "https://travel.alibtrip.com"]);
  const tokenCookie = cookies?.find((cookie) => cookie.name === "_m_h5_tk")?.value;
  const token = tokenCookie?.split("_")[0];

  if (!token) {
    throw new Error("阿里商旅 MTop token 不存在，请确认阿里登录窗口仍保持打开");
  }

  const appKey = "12574478";
  const timestamp = String(Date.now());
  const dataText = JSON.stringify(data);
  const sign = crypto.createHash("md5").update(`${token}&${timestamp}&${appKey}&${dataText}`).digest("hex");
  const params = new URLSearchParams({
    jsv: "2.6.1",
    appKey,
    t: timestamp,
    sign,
    api,
    dataType: "json",
    timeout: "15000",
    v: "1.0",
    type: "originaljson",
    ttid: "12ali0000603"
  });
  const url = `https://h5api.m.alibtrip.com/h5/${api}/1.0?${params.toString()}`;
  const urlValue = JSON.stringify(url);
  const dataTextValue = JSON.stringify(dataText);
  const responseText = await page.evaluate<string>(`(async () => {
    const url = ${urlValue};
    const dataText = ${dataTextValue};
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(dataText)
    });
    return response.text();
  })()`);
  const parsed = JSON.parse(responseText) as { ret?: string[]; data?: { result?: string; bookingUrl?: string; componentResult?: Array<{ itineraryNo?: string }> } };

  if (!parsed.ret?.some((item) => item.includes("SUCCESS"))) {
    throw new Error(`阿里商旅接口调用失败：${parsed.ret?.join(",") ?? responseText.slice(0, 120)}`);
  }

  return parsed;
}

async function readAliBookUser(page: BrowserPage) {
  return page.evaluate<{ realName: string; userName: string; userId: string; userType: number }>(`(() => {
    try {
      const corps = JSON.parse(localStorage.getItem("SFS_BTRIP_PC_NAVIGATION_CORP_LIST_CACHE") || "[]");
      const corp = corps.find((item) => item && (item.userId || item.employeeId));
      if (corp) {
        const name = String(corp.userNick || corp.nickName || "");
        return {
          realName: name,
          userName: name,
          userId: String(corp.userId || corp.employeeId),
          userType: 1
        };
      }
    } catch {
      // Ignore malformed platform cache.
    }

    try {
      const userInfo = JSON.parse(localStorage.getItem("SFS_BTRIP_PC_NAVIGATION_USER_INFO_CACHE") || "{}");
      const name = String(userInfo.nickName || "");
      return { realName: name, userName: name, userId: "", userType: 1 };
    } catch {
      return { realName: "", userName: "", userId: "", userType: 1 };
    }
  })()`);
}

async function createAliFlightItineraryNo(context: BrowserContext, page: BrowserPage) {
  const bookUser = await readAliBookUser(page);
  const identity = await readAliIdentityParams(page);
  const userId = bookUser.userId || identity.userId;
  const name = bookUser.realName || bookUser.userName;

  if (!userId || !name) {
    throw new Error("阿里商旅缺少出行人信息，无法生成行程单号");
  }

  const extParam = JSON.stringify({
    spm: "",
    itineraryEntry: false,
    pcHomePage: "true",
    pcHomeParams: JSON.stringify({ dingAppId: "1692", source: "pc" })
  });
  const response = await callAliMtopRaw(context, page, "mtop.alitrip.btriphome.pre.select.save", {
    category: "flight",
    itineraryNo: "",
    bookUsers: JSON.stringify([{ realName: name, userName: name, userId, userType: 1 }]),
    fromComponent: true,
    extParam
  });
  const itineraryNo = parseAliItineraryNoFromPreSaveText(JSON.stringify(response));

  if (!itineraryNo) {
    throw new Error("阿里商旅未返回行程单号");
  }

  return itineraryNo;
}

async function navigateAliInternationalSearchList(
  context: BrowserContext,
  page: BrowserPage,
  route: PilotRoute,
  itineraryNo: string
) {
  const identity = await readAliIdentityParams(page);
  if (!identity.corpId || !identity.userId) {
    throw new Error("阿里商旅国际查询缺少企业或用户参数");
  }

  const searchJourneys = [{
    arrCityCode: cityCodes[route.destination] ?? route.destination,
    arrCityName: route.destination,
    arrAirportCode: "",
    depCityCode: cityCodes[route.origin] ?? route.origin,
    depCityName: route.origin,
    depAirportCode: "",
    depDate: route.travelDate,
    itineraryNo,
    depCityRegion: aliInternationalCities.has(route.origin) ? 1 : 0,
    arrCityRegion: aliInternationalCities.has(route.destination) ? 1 : 0
  }];
  const searchCondition = {
    adultPassengerNum: 1,
    childPassengerNum: 0,
    searchCabinType: 0
  };
  const sessionKey = await callAliMtop(context, page, "mtop.btrip.sparta.flight.save.session", {
    sessionValue: JSON.stringify({ intlAdjustPriceGrey: false })
  });
  const searchParamKey = await callAliMtop(context, page, "mtop.btrip.sparta.intl.flight.searchparam.save", {
    searchParamJsonStr: JSON.stringify({ searchCondition, searchJourneys }),
    isOldApi: false
  });
  const params = new URLSearchParams({
    spm: "181",
    corpId: identity.corpId,
    userId: identity.userId,
    fpt: identity.fpt || "bIdentify(main.newpc.newpc.c)",
    currentJourneyIndex: "0",
    tripType: "0",
    itineraryNo,
    searchParamKey,
    depCityName: route.origin,
    arrCityName: route.destination,
    sessionKey
  });

  await page.goto(`https://travel.alibtrip.com/flight-new?${params.toString()}#/i-search-list`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(5_000);
}

async function searchAliSameFlightQuote(
  context: BrowserContext,
  artifactDir: string,
  route: PilotRoute,
  selectedFlight: QingmaoFlightCandidate,
  screenshotFilename = "阿里商旅-同航班.png"
): Promise<SameFlightPlatformQuote> {
  const page = await getOrCreatePlatformPage(context, "https://travel.alibtrip.com");
  const screenshotPath = path.join(artifactDir, screenshotFilename);
  const preExistingItineraryId = readAliItineraryIdFromUrl(page.url());

  try {
    await page.goto("https://travel.alibtrip.com/index.html#/flight", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(3_000);

    if (route.scope === "国际") {
      const itineraryNo = await createAliFlightItineraryNo(context, page);
      await navigateAliInternationalSearchList(context, page, route, itineraryNo);
      const bodyText = await waitForSearchText(page, selectedFlight.flightNo, { returnOnGenericResult: false });
      if (!bodyText.includes(selectedFlight.flightNo) && /出错了|异常/.test(bodyText)) {
        throw new Error(explainAliInternationalSubmitFailure(bodyText, ""));
      }
      const extracted = extractSameFlightQuoteFromText(bodyText, selectedFlight.flightNo);
      const evidencePath = await savePageEvidence(page, screenshotPath, {
        platform: "阿里商旅",
        route,
        selectedFlight,
        price: extracted.price,
        bodyText
      });

      return {
        platform: "阿里商旅",
        status: extracted.status,
        price: extracted.price,
        finalUrl: page.url(),
        screenshotPath: evidencePath,
        rawText: extracted.rawText
      };
    }

    const itineraryId = preExistingItineraryId ?? await createAliFlightItineraryNo(context, page);
    await page.goto(buildAliSearchListUrl(page.url(), route, itineraryId), { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(5_000);

    const bodyText = await waitForSearchText(page, selectedFlight.flightNo);
    const extracted = extractSameFlightQuoteFromText(bodyText, selectedFlight.flightNo);
    const evidencePath = await savePageEvidence(page, screenshotPath, {
      platform: "阿里商旅",
      route,
      selectedFlight,
      price: extracted.price,
      bodyText
    });

    return {
      platform: "阿里商旅",
      status: extracted.status,
      price: extracted.price,
      finalUrl: page.url(),
      screenshotPath: evidencePath,
      rawText: extracted.rawText
    };
  } catch (error) {
    const errorText = errorMessage(error);
    const evidencePath = await savePageEvidence(page, screenshotPath, {
      platform: "阿里商旅",
      route,
      selectedFlight,
      price: null,
      error: errorText
    });
    return {
      platform: "阿里商旅",
      status: "failed",
      price: null,
      finalUrl: page.url(),
      screenshotPath: evidencePath,
      error: errorText
    };
  }
}
