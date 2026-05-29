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
type HotelSmallBatchStatus = "idle" | "running" | "partial" | "completed" | "failed";
type HotelScaleValidationStatus = "idle" | "running" | "partial" | "completed" | "failed";
type HotelScaleValidationSampleStatus = "completed" | "partial" | "failed" | "skipped" | "timeout";
type HotelScaleValidationEvidenceStatus = "complete" | "evidence_missing" | "evidence_save_failed";
type HotelSingleDiagnosisStatus = "idle" | "running" | "completed" | "failed";
type HotelSingleDiagnosisStep = "pending" | "searching-hotel" | "matching-hotel" | "checking-rate-plan" | "success" | "failed";
type HotelRatePlanProbeStatus = "idle" | "running" | "partial" | "completed" | "failed";
type HotelCalibrationStatus = "idle" | "running" | "partial" | "completed" | "failed";
type HotelRatePlanLabel = "大床无早餐" | "大床有早餐" | "双床无早餐" | "双床有早餐";
const HOTEL_RATE_PLAN_LABELS: HotelRatePlanLabel[] = ["大床无早餐", "大床有早餐", "双床无早餐", "双床有早餐"];
const HOTEL_DISPLAY_RATE_PLAN_PRIORITY: HotelRatePlanLabel[] = ["大床有早餐", "大床无早餐", "双床有早餐", "双床无早餐"];
const HOTEL_VALIDATION_RATE_PLAN = readHotelValidationRatePlan();
const HOTEL_CALIBRATION_LIMIT = 3;
const HOTEL_CALIBRATION_MAIN_RATE_PLAN = "大床有早餐";
const HOTEL_CALIBRATION_OTHER_RATE_PLANS: HotelRatePlanLabel[] = ["大床无早餐", "双床有早餐", "双床无早餐"];
const HOTEL_CALIBRATION_PLATFORM_ORDER: PlatformName[] = ["青猫差旅", "阿里商旅", "在途商旅", "携程商旅"];
const HOTEL_CALIBRATION_COMPETITOR_PLATFORM_ORDER: PlatformName[] = ["阿里商旅", "在途商旅", "携程商旅"];
const HOTEL_SINGLE_ALL_RATE_PLANS_PLATFORM_ORDER: PlatformName[] = ["青猫差旅", "携程商旅", "阿里商旅", "在途商旅"];
const ALI_HOTEL_LIST_CARD_SELECTOR = ".room-list-hotel-card-block";
const HOTEL_GROUP_MAIN_RATE_MAX_ATTEMPTS = 5;
const HOTEL_SMALL_BATCH_TARGET_PER_GROUP = 2;
const HOTEL_SMALL_BATCH_MAX_ATTEMPTS_PER_SAMPLE = 12;
const HOTEL_SMALL_BATCH_MAX_ATTEMPTS_PER_GROUP: number | null = null;
const HOTEL_SMALL_BATCH_GROUP_BUDGET_MS: number | null = null;
const HOTEL_SMALL_BATCH_TOTAL_BUDGET_MS = 90 * 60 * 1000;
const HOTEL_SCALE_VALIDATION_TARGET_PER_GROUP = 8;
const HOTEL_SCALE_VALIDATION_TOTAL_TARGET = 40;
const HOTEL_SCALE_VALIDATION_GROUP_BUDGET_MS = 25 * 60 * 1000;
const HOTEL_SCALE_VALIDATION_TOTAL_BUDGET_MS = 120 * 60 * 1000;
const HOTEL_SCALE_VALIDATION_MAX_ATTEMPTS_PER_GROUP = 24;
const HOTEL_SCALE_VALIDATION_PLATFORM_ORDER: PlatformName[] = ["青猫差旅", "阿里商旅", "携程商旅", "在途商旅"];
const HOTEL_SCALE_VALIDATION_COMPETITOR_PLATFORM_ORDER: PlatformName[] = ["阿里商旅", "携程商旅", "在途商旅"];
const HOTEL_SCALE_VALIDATION_CITY_POOL = ["北京", "广州", "杭州", "上海", "深圳", "武汉", "佛山", "成都", "厦门"] as const;
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

export type HotelScaleValidationFailureType =
  | HotelCalibrationFailureType
  | "qingmao_candidate_shortage"
  | "rate_row_excluded_bed_assignment"
  | "budget_stop"
  | "evidence_missing"
  | "evidence_save_failed";

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
  status: "available" | "not-found" | "platform-no-rate" | "parser-suspected-failed" | "failed" | "pending";
  price: number | null;
  hotelName: string;
  roomType: string;
  ratePlan: HotelRatePlanLabel;
  finalUrl?: string;
  screenshotPath?: string;
  screenshotUrl?: string;
  diagnosisPath?: string;
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

export interface HotelSmallBatchSample {
  group: HotelGroupName;
  groupIndex: number;
  sampleIndex: number;
  query: QingmaoHotelCandidateQuery;
  status: "completed" | "partial" | "failed" | "skipped";
  selectedCandidate: QingmaoHotelCandidate | null;
  quotes: HotelMainRateQuote[];
  message: string;
  failureReason?: string;
  failurePlatform?: PlatformName;
  skipReason?: string;
  timeoutBudget?: boolean;
  error?: string;
}

export interface HotelSmallBatchGroupResult {
  group: HotelGroupName;
  query: QingmaoHotelCandidateQuery;
  targetCount: number;
  maxAttempts: number | null;
  budgetMs: number | null;
  attemptedCount: number;
  completedCount: number;
  partialCount: number;
  failedCount: number;
  skippedCount: number;
  unattemptedCount: number;
  timeoutBudget: boolean;
  budgetStopReason?: string;
  samples: HotelSmallBatchSample[];
}

export interface HotelSmallBatchProbeResult {
  status: HotelSmallBatchStatus;
  city: "广州";
  targetTotal: 10;
  targetPerGroup: 2;
  mainRatePlan: "大床有早餐";
  completedCount: number;
  failedCount: number;
  partialCount: number;
  skippedCount: number;
  unattemptedCount: number;
  timeoutBudget: boolean;
  stoppedGroup?: HotelGroupName;
  budget: {
    totalMs: number;
    perGroupMs: number | null;
    maxAttemptsPerGroup: number | null;
  };
  groups: HotelSmallBatchGroupResult[];
  updatedAt: string | null;
  message: string;
  recommendation?: string;
  error?: string;
}

export interface HotelScaleValidationInput {
  checkInDate?: string;
  checkOutDate?: string;
  limit?: number;
  disableBudgets?: boolean;
}

export interface HotelScaleValidationResolvedInput {
  checkInDate: string;
  checkOutDate: string;
  nights: number;
}

export interface HotelScaleValidationPathRecord {
  platform: PlatformName;
  step: string;
  status: "completed" | "failed" | "skipped" | "timeout";
  startedAt: string;
  endedAt: string;
  durationMs: number;
  finalUrl?: string;
  screenshotPath?: string;
  diagnosisPath?: string;
  failureType?: HotelScaleValidationFailureType;
  failureReason?: string;
}

export interface HotelScaleValidationAliEvidence {
  listScreenshotPath?: string;
  candidateScreenshotPath?: string;
  detailScreenshotPath?: string;
  failureScreenshotPath?: string;
}

export interface HotelScaleValidationQingmaoEvidence {
  candidateListScreenshotPath?: string;
  candidatesRead?: QingmaoHotelCandidate[];
}

export interface HotelScaleValidationExcludedRateRow {
  platform: PlatformName;
  reason: string;
  rawText: string;
}

export interface HotelScaleValidationEvidenceInput {
  status: HotelScaleValidationSampleStatus;
  currentPlatform?: PlatformName;
  currentStep?: string;
  failureType?: HotelScaleValidationFailureType;
  failureReason?: string;
  finalUrl?: string;
  screenshotPath?: string;
  htmlSnapshotPath?: string;
  diagnosisPath?: string;
  resultPath?: string;
  pageTextSummary?: string;
  pathRecords?: HotelScaleValidationPathRecord[];
  aliEvidence?: HotelScaleValidationAliEvidence;
  qingmaoEvidence?: HotelScaleValidationQingmaoEvidence;
  excludedRateRows?: HotelScaleValidationExcludedRateRow[];
  evidenceSaveFailed?: boolean;
}

export interface HotelScaleValidationEvidenceResult {
  evidenceStatus: HotelScaleValidationEvidenceStatus;
  evidenceIssues: string[];
}

export interface HotelScaleValidationSample extends HotelScaleValidationEvidenceInput {
  group?: HotelGroupName;
  groupIndex?: number;
  sampleIndex?: number;
  attemptIndex?: number;
  query?: QingmaoHotelCandidateQuery;
  selectedCandidate?: QingmaoHotelCandidate | null;
  quotes?: HotelMainRateQuote[];
  message?: string;
  evidenceStatus?: HotelScaleValidationEvidenceStatus;
  evidenceIssues?: string[];
}

export interface HotelScaleValidationPlannedQuery extends QingmaoHotelCandidateQuery {
  group: HotelGroupName;
}

export interface HotelScaleValidationGroupResult {
  group: HotelGroupName;
  query?: QingmaoHotelCandidateQuery;
  cityPool?: string[];
  keywords?: string[];
  plannedQueries?: HotelScaleValidationPlannedQuery[];
  targetCount: number;
  maxAttempts?: number;
  budgetMs?: number | null;
  attemptedCount: number;
  completedCount: number;
  partialCount: number;
  failedCount: number;
  skippedCount: number;
  timeoutCount?: number;
  unattemptedCount: number;
  timeoutBudget: boolean;
  budgetStopReason?: string;
  samples: HotelScaleValidationSample[];
  summaryPath?: string;
}

export interface HotelScaleValidationTimingPlatformSummary {
  platform: PlatformName;
  count: number;
  totalMs: number;
  averageMs: number;
  p95Ms: number;
}

export interface HotelScaleValidationTimingStepSummary {
  step: string;
  count: number;
  totalMs: number;
  averageMs: number;
  p95Ms: number;
}

export interface HotelScaleValidationSlowStep {
  group?: HotelGroupName;
  sampleIndex?: number;
  platform: PlatformName;
  step: string;
  status: HotelScaleValidationPathRecord["status"];
  durationMs: number;
  startedAt: string;
  endedAt: string;
  finalUrl?: string;
}

export interface HotelScaleValidationTimeoutSample {
  group?: HotelGroupName;
  sampleIndex?: number;
  currentPlatform?: PlatformName;
  currentStep?: string;
  failureReason?: string;
  finalUrl?: string;
}

export interface HotelScaleValidationTimingSummary {
  platforms: HotelScaleValidationTimingPlatformSummary[];
  steps: HotelScaleValidationTimingStepSummary[];
  slowestSteps: HotelScaleValidationSlowStep[];
  timeoutSamples: HotelScaleValidationTimeoutSample[];
}

export interface HotelScaleValidationSummary {
  status: "completed" | "partial" | "failed";
  targetTotal: number;
  completedCount: number;
  partialCount: number;
  failedCount: number;
  skippedCount: number;
  timeoutCount: number;
  unattemptedCount: number;
  evidenceCompleteCount: number;
  evidenceMissingCount: number;
  evidenceSaveFailedCount: number;
  evidenceCompleteRate: number;
  timeoutBudget: boolean;
  timing: HotelScaleValidationTimingSummary;
}

export interface HotelScaleValidationResult extends HotelScaleValidationResolvedInput {
  status: HotelScaleValidationStatus;
  mode: "scale-validation";
  targetTotal: number;
  targetPerGroup: number;
  mainRatePlan: "大床有早餐";
  budget: {
    totalMs: number | null;
    perGroupMs: number | null;
    maxAttemptsPerGroup: number;
  };
  platformOrder: PlatformName[];
  cityPool: string[];
  groups: HotelScaleValidationGroupResult[];
  completedCount: number;
  failedCount: number;
  partialCount: number;
  skippedCount: number;
  timeoutCount: number;
  unattemptedCount: number;
  evidenceCompleteCount: number;
  evidenceMissingCount: number;
  evidenceSaveFailedCount: number;
  evidenceCompleteRate: number;
  timeoutBudget: boolean;
  stoppedGroup?: HotelGroupName;
  artifactDir?: string;
  summaryPath?: string;
  diagnosticReviewPath?: string;
  timing: HotelScaleValidationTimingSummary;
  updatedAt: string | null;
  message: string;
  recommendation?: string;
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

export interface HotelSingleAllRatePlansInput {
  city: string;
  keyword: string;
  checkInDate: string;
  checkOutDate: string;
}

export interface HotelSingleAllRatePlansResult {
  status: HotelCalibrationStatus;
  mode: "single-all-rate-plans";
  input: HotelSingleAllRatePlansInput | null;
  query: QingmaoHotelCandidateQuery | null;
  selectedCandidate: QingmaoHotelCandidate | null;
  sourceHotel: {
    hotelName: string;
    city: string;
    address: string;
    doorPlate: string | null;
    rawText: string;
  } | null;
  platformOrder: PlatformName[];
  platforms: HotelCalibrationPlatformResult[];
  completeRatePlans: HotelRatePlanLabel[];
  artifactDir?: string;
  resultPath?: string;
  resultUrl?: string;
  diagnosticReviewPath?: string;
  diagnosticReviewUrl?: string;
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
export type HotelCalibrationRatePrices = Record<HotelRatePlanLabel, number | null>;

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
  ratePrices?: HotelCalibrationRatePrices;
  durationMs: number;
  failureType: HotelCalibrationFailureType | null;
  failureReason: string;
  screenshotPath?: string;
  screenshotUrl?: string;
  diagnosisPath?: string;
  finalUrl: string;
  pathRecords?: AliHotelPathRecord[];
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
  getHotelSmallBatchStatus(): HotelSmallBatchProbeResult;
  getHotelScaleValidationStatus(): HotelScaleValidationResult;
  getHotelSingleDiagnosisStatus(): HotelSingleDiagnosisProbeResult;
  getHotelSingleAllRatePlansStatus(): HotelSingleAllRatePlansResult;
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
  runHotelSmallBatchProbe(): Promise<HotelSmallBatchProbeResult>;
  runHotelScaleValidationProbe(input?: HotelScaleValidationInput): Promise<HotelScaleValidationResult>;
  runHotelSingleDiagnosisProbe(input: HotelSingleDiagnosisInput): Promise<HotelSingleDiagnosisProbeResult>;
  runHotelSingleAllRatePlansProbe(input: HotelSingleAllRatePlansInput): Promise<HotelSingleAllRatePlansResult>;
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
  return selectHotelCalibrationDefaultRatePlan(platforms, expectedPlatformOrder) !== null;
}

function emptyHotelCalibrationRatePrices(): HotelCalibrationRatePrices {
  return {
    大床无早餐: null,
    大床有早餐: null,
    双床无早餐: null,
    双床有早餐: null
  };
}

export function selectHotelCalibrationDefaultRatePlan(platforms: HotelCalibrationPlatformResult[], expectedPlatformOrder: PlatformName[]) {
  const completePlans = HOTEL_RATE_PLAN_LABELS.filter((ratePlan) =>
    expectedPlatformOrder.every((expectedPlatform) =>
      platforms.some((platform) =>
        platform.platform === expectedPlatform
        && platform.sameHotel === true
        && typeof hotelCalibrationRatePrice(platform, ratePlan) === "number"
      )
    )
  );

  return HOTEL_DISPLAY_RATE_PLAN_PRIORITY.find((ratePlan) => completePlans.includes(ratePlan)) ?? null;
}

function selectCompleteHotelCalibrationRatePlans(platforms: HotelCalibrationPlatformResult[], expectedPlatformOrder: PlatformName[]) {
  return HOTEL_RATE_PLAN_LABELS.filter((ratePlan) =>
    expectedPlatformOrder.every((expectedPlatform) =>
      platforms.some((platform) =>
        platform.platform === expectedPlatform
        && platform.sameHotel === true
        && typeof hotelCalibrationRatePrice(platform, ratePlan) === "number"
      )
    )
  );
}

function hotelCalibrationRatePrice(platform: HotelCalibrationPlatformResult, ratePlan: HotelRatePlanLabel) {
  if (platform.ratePrices) return platform.ratePrices[ratePlan];
  if (ratePlan === HOTEL_CALIBRATION_MAIN_RATE_PLAN) return platform.mainRatePrice;
  return platform.otherRates[ratePlan as keyof HotelCalibrationOtherRates] ?? null;
}

interface HotelGroupPilotQueryConfig {
  group: HotelGroupName;
  keyword: string;
  city?: string;
}

interface HotelSmallBatchPilotQueryConfig {
  group: HotelGroupName;
  keywords: string[];
  city?: string;
}

const hotelGroupPilotQueries: HotelGroupPilotQueryConfig[] = [
  { group: "首旅如家", keyword: "如家商旅" },
  { group: "华住", keyword: "全季" },
  { group: "锦江", keyword: "维也纳" },
  { group: "东呈", keyword: "城市便捷" },
  { group: "亚朵", keyword: "亚朵" }
];

const hotelSmallBatchPilotQueries: HotelSmallBatchPilotQueryConfig[] = hotelGroupPilotQueries.map((config) => ({
  group: config.group,
  keywords: config.group === "东呈"
    ? ["城市便捷", "宜尚", "柏曼", "怡程"]
    : config.group === "华住"
      ? ["全季", "汉庭", "桔子", "美居", "海友", "你好", "星程"]
      : [config.keyword],
  city: config.city
}));

const hotelScaleValidationPilotQueries: HotelSmallBatchPilotQueryConfig[] = hotelGroupPilotQueries.map((config) => ({
  group: config.group,
  keywords: config.group === "东呈"
    ? ["城市便捷", "宜尚", "柏曼", "怡程"]
    : config.group === "华住"
      ? ["全季", "汉庭", "桔子", "美居", "海友", "你好", "星程"]
      : config.group === "首旅如家"
        ? ["如家商旅", "如家精选", "如家酒店"]
        : config.group === "锦江"
          ? ["维也纳", "锦江之星", "麗枫"]
          : ["亚朵", "亚朵S"],
  city: config.city
}));

export function getHotelSmallBatchGroupSearchKeywords(group: HotelGroupName) {
  return hotelSmallBatchPilotQueries.find((config) => config.group === group)?.keywords ?? [];
}

export function getHotelScaleValidationGroupSearchKeywords(group: HotelGroupName) {
  return hotelScaleValidationPilotQueries.find((config) => config.group === group)?.keywords ?? [];
}

function buildHotelSmallBatchGroupDisplayQuery(date: Date, config: HotelSmallBatchPilotQueryConfig) {
  return buildHotelCandidateQuery(date, config.keywords.join(" / "), config.city ?? "广州");
}

function buildHotelSmallBatchKeywordQueries(date: Date, config: HotelSmallBatchPilotQueryConfig) {
  return config.keywords.map((keyword) => buildHotelCandidateQuery(date, keyword, config.city ?? "广州"));
}

function orderedHotelSmallBatchKeywordQueries(date: Date, config: HotelSmallBatchPilotQueryConfig, sampleIndex: number) {
  const queries = buildHotelSmallBatchKeywordQueries(date, config);
  if (queries.length <= 1) return queries;
  const startIndex = sampleIndex % queries.length;
  return [...queries.slice(startIndex), ...queries.slice(0, startIndex)];
}

function parseLocalDateString(dateText: string) {
  return new Date(`${dateText}T00:00:00`);
}

function dateDiffDays(startDate: string, endDate: string) {
  const startedAt = parseLocalDateString(startDate).getTime();
  const endedAt = parseLocalDateString(endDate).getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) {
    return 1;
  }
  return Math.max(1, Math.round((endedAt - startedAt) / 86_400_000));
}

export function buildHotelScaleValidationInput(now: Date, input: HotelScaleValidationInput = {}): HotelScaleValidationResolvedInput {
  const checkInDate = input.checkInDate ?? formatDate(addDays(now, 1));
  const checkOutDate = input.checkOutDate ?? formatDate(addDays(now, 2));
  return {
    checkInDate,
    checkOutDate,
    nights: dateDiffDays(checkInDate, checkOutDate)
  };
}

function resolveHotelScaleValidationTargetTotal(input: HotelScaleValidationInput = {}) {
  return input.limit ?? HOTEL_SCALE_VALIDATION_TOTAL_TARGET;
}

function resolveHotelScaleValidationGroupTargets(input: HotelScaleValidationInput = {}) {
  const targetTotal = resolveHotelScaleValidationTargetTotal(input);
  const groupCount = hotelScaleValidationPilotQueries.length;
  const baseTarget = Math.floor(targetTotal / groupCount);
  const remainder = targetTotal % groupCount;
  return hotelScaleValidationPilotQueries.map((_, index) => baseTarget + (index < remainder ? 1 : 0));
}

function buildHotelScaleValidationQuery(input: HotelScaleValidationResolvedInput, city: string, keyword: string): QingmaoHotelCandidateQuery {
  return {
    city,
    keyword,
    checkInDate: input.checkInDate,
    checkOutDate: input.checkOutDate,
    nights: input.nights
  };
}

function buildHotelScaleValidationPlannedQueries(input: HotelScaleValidationResolvedInput, config: HotelSmallBatchPilotQueryConfig): HotelScaleValidationPlannedQuery[] {
  return HOTEL_SCALE_VALIDATION_CITY_POOL.flatMap((city) =>
    config.keywords.map((keyword) => ({
      ...buildHotelScaleValidationQuery(input, city, keyword),
      group: config.group
    }))
  );
}

function buildHotelScaleValidationGroupDisplayQuery(input: HotelScaleValidationResolvedInput, config: HotelSmallBatchPilotQueryConfig) {
  return buildHotelScaleValidationQuery(input, HOTEL_SCALE_VALIDATION_CITY_POOL.join(" / "), config.keywords.join(" / "));
}

function orderedHotelScaleValidationQueries(input: HotelScaleValidationResolvedInput, config: HotelSmallBatchPilotQueryConfig, sampleIndex: number, attemptIndex: number) {
  const queries = buildHotelScaleValidationPlannedQueries(input, config);
  if (queries.length <= 1) return queries;
  const startIndex = (sampleIndex * 3 + attemptIndex) % queries.length;
  return [...queries.slice(startIndex), ...queries.slice(0, startIndex)];
}

const previousHotelGroupAnchorNames = [
  "如家商旅酒店(广州永庆坊荔湾湖公园店)",
  "全季酒店(广州上下九步行街陈家祠店)",
  "维也纳酒店(广州火车站小北地铁站店)",
  "城市便捷酒店(珠江夜游广州塔中大码头中山大学店)",
  "广州塔琶洲会展亚朵S酒店"
];

function normalizeHotelIdentity(value: string) {
  return value.replace(/\s+/g, "").replace(/[（）]/g, (char) => char === "（" ? "(" : ")").trim();
}

export function buildPreviousHotelGroupAnchorSet() {
  return new Set(previousHotelGroupAnchorNames.map(normalizeHotelIdentity));
}

export function shouldSkipHotelSmallBatchCandidate(
  candidate: QingmaoHotelCandidate,
  query: QingmaoHotelCandidateQuery,
  usedHotelNames: Set<string> = new Set(),
  previousAnchorNames: Set<string> = buildPreviousHotelGroupAnchorSet()
) {
  const normalizedName = normalizeHotelIdentity(candidate.hotelName);
  if (!isHotelCandidateRelevantForQuery(candidate, query)) {
    return `不属于${query.keyword}候选`;
  }
  if (!candidate.price || candidate.price <= 0) {
    return "候选起价为空";
  }
  if (!candidate.address.trim()) {
    return "地址为空";
  }
  if (!extractHotelDoorPlate(candidate.address)) {
    return "未提取到门牌号";
  }
  if (previousAnchorNames.has(normalizedName)) {
    return "上一轮5集团锚点酒店";
  }
  if (usedHotelNames.has(normalizedName)) {
    return "本轮小放量重复酒店";
  }
  return null;
}

export function summarizeHotelSmallBatchGroups(groups: HotelSmallBatchGroupResult[]) {
  const samples = groups.flatMap((group) => group.samples);
  const completedCount = samples.filter((sample) => sample.status === "completed").length;
  const partialCount = samples.filter((sample) => sample.status === "partial").length;
  const hardFailedCount = samples.filter((sample) => sample.status === "failed").length;
  const skippedCount = samples.filter((sample) => sample.status === "skipped").length;
  const failedCount = partialCount + hardFailedCount;
  const targetTotal = groups.reduce((total, group) => total + group.targetCount, 0);
  const unattemptedCount = groups.reduce((total, group) => total + Math.max(0, group.targetCount - group.completedCount - group.partialCount - group.failedCount), 0);
  const timeoutBudget = groups.some((group) => group.timeoutBudget);
  return {
    completedCount,
    partialCount,
    failedCount,
    skippedCount,
    unattemptedCount,
    targetTotal,
    timeoutBudget,
    status: completedCount === targetTotal ? "completed" as const : samples.length > 0 || timeoutBudget ? "partial" as const : "failed" as const
  };
}

function emptyHotelScaleValidationTimingSummary(): HotelScaleValidationTimingSummary {
  return {
    platforms: [],
    steps: [],
    slowestSteps: [],
    timeoutSamples: []
  };
}

function hasExplicitMainRoomBedType(text: string) {
  return /大床|双床/.test(text);
}

export function isHotelRateLineExcludedByBedAssignment(rawText: string, options: { mainRoomTypeText?: string } = {}) {
  const checks = [
    "到店随机分配床型",
    "随机床型",
    "房型待定",
    "到店安排"
  ];
  const reason = checks.find((item) => rawText.includes(item)) ?? "";
  if (reason && options.mainRoomTypeText && hasExplicitMainRoomBedType(options.mainRoomTypeText)) {
    return {
      excluded: false,
      reason: ""
    };
  }
  return {
    excluded: Boolean(reason),
    reason
  };
}

export function extractExcludedHotelRateRowsFromText(platform: PlatformName, rawText: string): HotelScaleValidationExcludedRateRow[] {
  const lines = rawText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const rows: HotelScaleValidationExcludedRateRow[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const excluded = isHotelRateLineExcludedByBedAssignment(lines[index]);
    if (!excluded.excluded) continue;
    const snippet = lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 4)).join(" ");
    rows.push({
      platform,
      reason: excluded.reason,
      rawText: snippet
    });
  }
  return rows;
}

export function resolveHotelScaleValidationBudgetStop(rule: HotelSmallBatchBudgetRule) {
  if (rule.maxAttempts !== null && rule.maxAttempts <= 0) {
    return "达到本集团候选尝试上限";
  }
  if (rule.budgetMs !== null && rule.nowMs - rule.startedAtMs >= rule.budgetMs) {
    return "达到本集团时间预算";
  }
  return null;
}

export function resolveHotelScaleValidationOverallBudgetStop(startedAtMs: number, nowMs: number, budgetMs: number | null = HOTEL_SCALE_VALIDATION_TOTAL_BUDGET_MS) {
  if (budgetMs === null) return null;
  return nowMs - startedAtMs >= budgetMs ? "达到40家放量验证整体时间预算" : null;
}

export function evaluateHotelScaleValidationEvidence(input: HotelScaleValidationEvidenceInput): HotelScaleValidationEvidenceResult {
  if (input.status === "completed") {
    return { evidenceStatus: "complete", evidenceIssues: [] };
  }
  if (input.evidenceSaveFailed) {
    return {
      evidenceStatus: "evidence_save_failed",
      evidenceIssues: ["截图和 HTML 快照均保存失败"]
    };
  }

  const issues: string[] = [];
  if (!input.failureType) issues.push("failureType 缺失");
  if (!input.failureReason) issues.push("failureReason 缺失");
  if (!input.currentPlatform) issues.push("currentPlatform 缺失");
  if (!input.currentStep) issues.push("currentStep 缺失");
  if (!input.finalUrl) issues.push("finalUrl 缺失");
  if (!input.screenshotPath && !input.htmlSnapshotPath) issues.push("screenshotPath 缺失");
  if (!input.diagnosisPath && !input.resultPath) issues.push("diagnosisPath 或 result.json 缺失");
  if (!input.pageTextSummary) issues.push("pageTextSummary 缺失");
  if (!input.pathRecords?.length) issues.push("pathRecords 缺失");

  if (input.currentPlatform === "阿里商旅") {
    if (!input.aliEvidence?.listScreenshotPath) issues.push("阿里列表页截图缺失");
    if (!input.aliEvidence?.candidateScreenshotPath) issues.push("阿里候选卡片截图缺失");
    if (!input.aliEvidence?.detailScreenshotPath && !input.aliEvidence?.failureScreenshotPath) {
      issues.push("阿里详情页截图或失败页截图缺失");
    }
  }

  if (input.failureType === "qingmao_candidate_shortage") {
    if (!input.qingmaoEvidence?.candidateListScreenshotPath) issues.push("青猫候选页截图缺失");
    if (!input.qingmaoEvidence?.candidatesRead) issues.push("青猫已读取候选列表缺失");
  }

  if (input.failureType === "rate_row_excluded_bed_assignment" && !input.excludedRateRows?.length) {
    issues.push("随机床型/房型待定原始价格行缺失");
  }

  return {
    evidenceStatus: issues.length ? "evidence_missing" : "complete",
    evidenceIssues: issues
  };
}

function percentile95(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index];
}

function average(values: number[]) {
  if (!values.length) return 0;
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

export function aggregateHotelScaleValidationTimings(samples: HotelScaleValidationSample[]): HotelScaleValidationTimingSummary {
  const records = samples.flatMap((sample) =>
    (sample.pathRecords ?? []).map((record) => ({
      sample,
      record
    }))
  );

  const platforms = HOTEL_SCALE_VALIDATION_PLATFORM_ORDER
    .map((platform) => {
      const durations = records
        .filter(({ record }) => record.platform === platform)
        .map(({ record }) => record.durationMs);
      return {
        platform,
        count: durations.length,
        totalMs: durations.reduce((total, duration) => total + duration, 0),
        averageMs: average(durations),
        p95Ms: percentile95(durations)
      };
    })
    .filter((item) => item.count > 0);

  const steps = Array.from(new Set(records.map(({ record }) => record.step)))
    .sort((left, right) => left.localeCompare(right, "zh-CN"))
    .map((step) => {
      const durations = records
        .filter(({ record }) => record.step === step)
        .map(({ record }) => record.durationMs);
      return {
        step,
        count: durations.length,
        totalMs: durations.reduce((total, duration) => total + duration, 0),
        averageMs: average(durations),
        p95Ms: percentile95(durations)
      };
    });

  const slowestSteps = records
    .map(({ sample, record }) => ({
      group: sample.group,
      sampleIndex: sample.sampleIndex,
      platform: record.platform,
      step: record.step,
      status: record.status,
      durationMs: record.durationMs,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      finalUrl: record.finalUrl
    }))
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, 10);

  const timeoutSamples = samples
    .filter((sample) => sample.status === "timeout")
    .map((sample) => ({
      group: sample.group,
      sampleIndex: sample.sampleIndex,
      currentPlatform: sample.currentPlatform,
      currentStep: sample.currentStep,
      failureReason: sample.failureReason,
      finalUrl: sample.finalUrl
    }));

  return {
    platforms,
    steps,
    slowestSteps,
    timeoutSamples
  };
}

export function summarizeHotelScaleValidationGroups(groups: HotelScaleValidationGroupResult[]): HotelScaleValidationSummary {
  const samples = groups.flatMap((group) => group.samples);
  const targetTotal = groups.reduce((total, group) => total + group.targetCount, 0);
  const completedCount = groups.reduce((total, group) => total + group.completedCount, 0);
  const partialCount = groups.reduce((total, group) => total + group.partialCount, 0);
  const failedCount = groups.reduce((total, group) => total + group.failedCount, 0);
  const skippedCount = groups.reduce((total, group) => total + group.skippedCount, 0);
  const timeoutCount = groups.reduce((total, group) => total + (group.timeoutCount ?? group.samples.filter((sample) => sample.status === "timeout").length), 0);
  const unattemptedCount = groups.reduce((total, group) => total + group.unattemptedCount, 0);
  const evidenceCompleteCount = samples.filter((sample) => sample.evidenceStatus === "complete").length;
  const evidenceMissingCount = samples.filter((sample) => sample.evidenceStatus === "evidence_missing").length;
  const evidenceSaveFailedCount = samples.filter((sample) => sample.evidenceStatus === "evidence_save_failed").length;
  const evidenceTotal = evidenceCompleteCount + evidenceMissingCount + evidenceSaveFailedCount;
  const timeoutBudget = groups.some((group) => group.timeoutBudget);
  const status = completedCount === targetTotal
    ? "completed"
    : samples.length > 0 || timeoutBudget || partialCount > 0 || failedCount > 0 || skippedCount > 0 || timeoutCount > 0
      ? "partial"
      : "failed";

  return {
    status,
    targetTotal,
    completedCount,
    partialCount,
    failedCount,
    skippedCount,
    timeoutCount,
    unattemptedCount,
    evidenceCompleteCount,
    evidenceMissingCount,
    evidenceSaveFailedCount,
    evidenceCompleteRate: evidenceTotal ? evidenceCompleteCount / evidenceTotal : 0,
    timeoutBudget,
    timing: aggregateHotelScaleValidationTimings(samples)
  };
}

export interface HotelSmallBatchBudgetRule {
  maxAttempts: number | null;
  budgetMs: number | null;
  startedAtMs: number;
  nowMs: number;
}

export function resolveHotelSmallBatchBudgetStop(rule: HotelSmallBatchBudgetRule) {
  if (rule.maxAttempts !== null && rule.maxAttempts <= 0) {
    return "达到本集团候选尝试上限";
  }
  if (rule.budgetMs !== null && rule.nowMs - rule.startedAtMs >= rule.budgetMs) {
    return "达到本集团时间预算";
  }
  return null;
}

export function resolveHotelSmallBatchOverallBudgetStop(startedAtMs: number, nowMs: number, budgetMs = HOTEL_SMALL_BATCH_TOTAL_BUDGET_MS) {
  return nowMs - startedAtMs >= budgetMs ? "达到小放量整体时间预算" : null;
}

export function firstUnavailableHotelMainRateQuote(quotes: HotelMainRateQuote[]) {
  return quotes.find((quote) => quote.status !== "available" || typeof quote.price !== "number") ?? null;
}

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

function buildInitialHotelSmallBatchProbeResult(date: Date): HotelSmallBatchProbeResult {
  return {
    status: "idle",
    city: "广州",
    targetTotal: 10,
    targetPerGroup: HOTEL_SMALL_BATCH_TARGET_PER_GROUP,
    mainRatePlan: "大床有早餐",
    completedCount: 0,
    failedCount: 0,
    partialCount: 0,
    skippedCount: 0,
    unattemptedCount: 10,
    timeoutBudget: false,
    budget: {
      totalMs: HOTEL_SMALL_BATCH_TOTAL_BUDGET_MS,
      perGroupMs: HOTEL_SMALL_BATCH_GROUP_BUDGET_MS,
      maxAttemptsPerGroup: HOTEL_SMALL_BATCH_MAX_ATTEMPTS_PER_GROUP
    },
    groups: hotelSmallBatchPilotQueries.map((config) => ({
      group: config.group,
      query: buildHotelSmallBatchGroupDisplayQuery(date, config),
      targetCount: HOTEL_SMALL_BATCH_TARGET_PER_GROUP,
      maxAttempts: HOTEL_SMALL_BATCH_MAX_ATTEMPTS_PER_GROUP,
      budgetMs: HOTEL_SMALL_BATCH_GROUP_BUDGET_MS,
      attemptedCount: 0,
      completedCount: 0,
      partialCount: 0,
      failedCount: 0,
      skippedCount: 0,
      unattemptedCount: HOTEL_SMALL_BATCH_TARGET_PER_GROUP,
      timeoutBudget: false,
      samples: []
    })),
    updatedAt: null,
    message: "等待执行 10 家酒店小放量"
  };
}

export function buildInitialHotelScaleValidationResult(date: Date, input: HotelScaleValidationInput = {}): HotelScaleValidationResult {
  const resolvedInput = buildHotelScaleValidationInput(date, input);
  const groupTargets = resolveHotelScaleValidationGroupTargets(input);
  const targetTotal = groupTargets.reduce((total, targetCount) => total + targetCount, 0);
  const targetPerGroup = groupTargets.every((targetCount) => targetCount === groupTargets[0]) ? groupTargets[0] : Math.max(...groupTargets);
  const totalBudgetMs = input.disableBudgets ? null : HOTEL_SCALE_VALIDATION_TOTAL_BUDGET_MS;
  const groupBudgetMs = input.disableBudgets ? null : HOTEL_SCALE_VALIDATION_GROUP_BUDGET_MS;
  const groups: HotelScaleValidationGroupResult[] = hotelScaleValidationPilotQueries.map((config, index) => ({
    group: config.group,
    query: buildHotelScaleValidationGroupDisplayQuery(resolvedInput, config),
    cityPool: [...HOTEL_SCALE_VALIDATION_CITY_POOL],
    keywords: [...config.keywords],
    plannedQueries: buildHotelScaleValidationPlannedQueries(resolvedInput, config),
    targetCount: groupTargets[index],
    maxAttempts: HOTEL_SCALE_VALIDATION_MAX_ATTEMPTS_PER_GROUP,
    budgetMs: groupBudgetMs,
    attemptedCount: 0,
    completedCount: 0,
    partialCount: 0,
    failedCount: 0,
    skippedCount: 0,
    timeoutCount: 0,
    unattemptedCount: groupTargets[index],
    timeoutBudget: false,
    samples: []
  }));

  return {
    status: "idle",
    mode: "scale-validation",
    targetTotal,
    targetPerGroup,
    mainRatePlan: "大床有早餐",
    ...resolvedInput,
    budget: {
      totalMs: totalBudgetMs,
      perGroupMs: groupBudgetMs,
      maxAttemptsPerGroup: HOTEL_SCALE_VALIDATION_MAX_ATTEMPTS_PER_GROUP
    },
    platformOrder: HOTEL_SCALE_VALIDATION_PLATFORM_ORDER,
    cityPool: [...HOTEL_SCALE_VALIDATION_CITY_POOL],
    groups,
    completedCount: 0,
    failedCount: 0,
    partialCount: 0,
    skippedCount: 0,
    timeoutCount: 0,
    unattemptedCount: targetTotal,
    evidenceCompleteCount: 0,
    evidenceMissingCount: 0,
    evidenceSaveFailedCount: 0,
    evidenceCompleteRate: 0,
    timeoutBudget: false,
    timing: emptyHotelScaleValidationTimingSummary(),
    updatedAt: null,
    message: `等待执行 ${targetTotal} 家酒店放量验证 / 准生产诊断跑`
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

function buildInitialHotelSingleAllRatePlansResult(): HotelSingleAllRatePlansResult {
  return {
    status: "idle",
    mode: "single-all-rate-plans",
    input: null,
    query: null,
    selectedCandidate: null,
    sourceHotel: null,
    platformOrder: HOTEL_SINGLE_ALL_RATE_PLANS_PLATFORM_ORDER,
    platforms: [],
    completeRatePlans: [],
    updatedAt: null,
    message: "等待指定单酒店一次性四口径复验"
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

const hotelMatchCityNames = ["北京", "上海", "深圳", "广州", "杭州", "成都", "重庆", "天津", "南京", "武汉", "长沙", "厦门", "福州", "青岛", "西安", "苏州", "佛山", "东莞", "珠海"];

function stripLeadingHotelCity(value: string, queryCity = "") {
  let normalized = value.trim();
  const cityCandidates = Array.from(new Set([queryCity.replace(/市$/, ""), ...hotelMatchCityNames].filter(Boolean)))
    .sort((left, right) => right.length - left.length);
  for (const city of cityCandidates) {
    normalized = normalized.replace(new RegExp(`^${city}市?`), "");
  }
  return normalized;
}

function stripAliHotelCoreNoise(value: string, queryCity = "") {
  return normalizeAddressForMatch(stripLeadingHotelCity(value, queryCity))
    .replace(/酒店|宾馆|民宿|公寓|客栈|如家|商旅|金标|旗舰|店/g, "")
    .trim();
}

function withoutAliWeakLocationQualifiers(value: string) {
  return value
    .replace(/风景区|旅游区|度假区|景区|商圈|附近|周边/g, "")
    .trim();
}

function isMeaningfulAliCoreKeyword(value: string) {
  if (value.length < 2) return false;
  if (/^(酒店|宾馆|民宿|公寓|客栈|景区|商圈|附近|周边|中心|国际|高档|舒适|经济)$/.test(value)) return false;
  return true;
}

function addAliHotelCoreKeyword(target: Set<string>, value: string, queryCity = "") {
  const normalized = stripAliHotelCoreNoise(value, queryCity);
  if (isMeaningfulAliCoreKeyword(normalized)) target.add(normalized);
  const withoutWeak = withoutAliWeakLocationQualifiers(normalized);
  if (isMeaningfulAliCoreKeyword(withoutWeak)) target.add(withoutWeak);
  const shortCoreLocations = ["千岛湖", "滨江", "下沙", "萧山", "白云山", "永庆坊", "荔湾湖", "上下九", "北京路", "越秀公园", "琶洲", "金融城"];
  for (const token of shortCoreLocations) {
    if (normalized.includes(token)) target.add(token);
  }

  const locationPattern = /([\u4e00-\u9fa5A-Za-z0-9]{2,10})(?:风景区|旅游区|度假区|景区|商圈|地铁站|步行街|公园|广场|中心|机场|火车站|高铁站|大道|路|街)/g;
  for (const match of normalized.matchAll(locationPattern)) {
    const fullToken = stripAliHotelCoreNoise(match[0], queryCity);
    const prefixToken = stripAliHotelCoreNoise(match[1] ?? "", queryCity);
    if (isMeaningfulAliCoreKeyword(fullToken)) target.add(fullToken);
    if (isMeaningfulAliCoreKeyword(prefixToken)) target.add(prefixToken);
    const softenedFullToken = withoutAliWeakLocationQualifiers(fullToken);
    if (isMeaningfulAliCoreKeyword(softenedFullToken)) target.add(softenedFullToken);
  }
}

function aliHotelBracketText(hotelName: string) {
  return hotelName.match(/[（(]([^）)]*)[）)]/)?.[1] ?? "";
}

function aliHotelNamePrefixBeforeBracket(hotelName: string) {
  return hotelName.split(/[（(]/)[0]?.trim() || hotelName.trim();
}

function buildAliHotelCoreLocationKeywords(
  candidate: QingmaoHotelCandidate,
  queryCity = "",
  options: { includeAddress?: boolean; includeNameWithoutBracket?: boolean } = {}
) {
  const includeAddress = options.includeAddress ?? true;
  const includeNameWithoutBracket = options.includeNameWithoutBracket ?? true;
  const target = new Set<string>();
  const bracketText = aliHotelBracketText(candidate.hotelName);
  if (bracketText) {
    addAliHotelCoreKeyword(target, bracketText, queryCity);
  }

  const roadKeyword = extractHotelRoadKeyword(candidate.address);
  if (includeAddress && roadKeyword) {
    addAliHotelCoreKeyword(target, roadKeyword, queryCity);
  }

  if (!bracketText && includeNameWithoutBracket) {
    const brandName = detectAliHotelBrandKeyword(candidate.hotelName);
    const withoutBrand = brandName
      ? candidate.hotelName.replace(new RegExp(`${brandName}(?:酒店)?`), "")
      : candidate.hotelName;
    addAliHotelCoreKeyword(target, withoutBrand, queryCity);
  }

  return Array.from(target);
}

function buildAliHotelNameWithCoreKeywords(candidate: QingmaoHotelCandidate, queryCity = "") {
  const prefix = aliHotelNamePrefixBeforeBracket(candidate.hotelName);
  const coreKeywords = buildAliHotelCoreLocationKeywords(candidate, queryCity, {
    includeAddress: false,
    includeNameWithoutBracket: false
  });
  return coreKeywords
    .map((keyword) => `${prefix}${keyword}`)
    .filter((keyword) => keyword !== candidate.hotelName);
}

function isAliPureBrandKeyword(keyword: string, brandName: string) {
  if (!brandName) return false;
  const normalizedKeyword = normalizeAddressForMatch(keyword).replace(/酒店|店/g, "");
  const normalizedBrand = normalizeAddressForMatch(brandName).replace(/酒店|店/g, "");
  return normalizedKeyword === normalizedBrand;
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

function hotelBrandFallbackKeywords(candidate: QingmaoHotelCandidate) {
  const brandName = /如家/.test(candidate.hotelName) ? "如家" : detectAliHotelBrandKeyword(candidate.hotelName);
  if (!brandName) return [];
  return brandName === "亚朵" ? ["亚朵酒店", "亚朵"] : [`${brandName}酒店`, brandName];
}

function buildHotelCoreSearchKeywords(candidate: QingmaoHotelCandidate, queryCity = "") {
  const target = new Set<string>();
  const add = (value: string | null | undefined) => {
    const normalized = value?.trim();
    if (normalized && normalized.length >= 2) target.add(normalized);
  };

  for (const keyword of buildCtripHotelCoreKeywords(candidate.hotelName)) add(keyword);
  for (const keyword of buildAliHotelCoreLocationKeywords(candidate, queryCity)) add(keyword);
  add(extractHotelRoadKeyword(candidate.address));
  add(extractHotelRoadDoorKeyword(candidate.address));
  add(extractHotelDoorPlate(candidate.address));
  return Array.from(target);
}

export function buildHotelSearchKeywords(query: Pick<QingmaoHotelCandidateQuery, "city">, candidate: QingmaoHotelCandidate) {
  const brandName = /如家/.test(candidate.hotelName) ? "如家" : detectAliHotelBrandKeyword(candidate.hotelName);
  const brandHotelName = brandName ? `${brandName}酒店` : "";
  const doorPlate = extractHotelRoadDoorKeyword(candidate.address);
  const doorNumber = extractHotelDoorNumber(candidate.address);
  const roadKeyword = extractHotelRoadKeyword(candidate.address);
  const coreLocationKeywords = buildAliHotelCoreLocationKeywords(candidate, query.city, {
    includeAddress: false,
    includeNameWithoutBracket: false
  });
  const nameWithCoreKeywords = buildAliHotelNameWithCoreKeywords(candidate, query.city);
  const brandCoreKeywords = brandName
    ? coreLocationKeywords.flatMap((keyword) => Array.from(new Set([
      brandHotelName ? `${brandHotelName}${keyword}` : "",
      `${brandName}${keyword}`
    ].filter(Boolean))))
    : [];
  const normalizedNameKeywords = normalizeHotelSearchKeywords(candidate.hotelName);
  const brandRoadKeyword = brandName && roadKeyword ? `${brandName}${roadKeyword}` : "";
  const brandDoorPlateKeyword = brandName && doorPlate ? `${brandName}${doorPlate}` : "";
  const brandDoorNumberKeyword = brandName && doorNumber ? `${brandName}${doorNumber}` : "";

  return Array.from(new Set([
    candidate.hotelName,
    ...nameWithCoreKeywords,
    ...brandCoreKeywords,
    doorPlate,
    brandRoadKeyword,
    brandDoorPlateKeyword,
    brandDoorNumberKeyword,
    roadKeyword,
    candidate.address,
    ...normalizedNameKeywords,
    ...hotelBrandFallbackKeywords(candidate)
  ].filter((keyword): keyword is string => {
    const value = keyword?.trim();
    if (!value) return false;
    return !brandName || !isAliPureBrandKeyword(value, brandName) || hotelBrandFallbackKeywords(candidate).includes(value);
  })));
}

function extractHotelRoadKeyword(address: string) {
  const doorPlate = extractHotelDoorPlate(address);
  if (!doorPlate) return null;
  return doorPlate.replace(/\d+(?:(?:[-－~～]|至)\d+)?号.*$/, "");
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
  return buildHotelSearchKeywords({ city: "" }, candidate);
}

function detectAliHotelBrandKeyword(value: string) {
  if (/如家商旅/.test(value)) return "如家商旅";
  if (/亚朵/.test(value)) return "亚朵";
  if (/全季/.test(value)) return "全季";
  if (/维也纳/.test(value)) return "维也纳";
  if (/城市便捷/.test(value)) return "城市便捷";
  if (/宜尚/.test(value)) return "宜尚";
  if (/柏曼/.test(value)) return "柏曼";
  if (/怡程/.test(value)) return "怡程";
  if (/汉庭/.test(value)) return "汉庭";
  if (/桔子/.test(value)) return "桔子";
  if (/美居/.test(value)) return "美居";
  if (/海友/.test(value)) return "海友";
  if (/你好/.test(value)) return "你好";
  if (/星程/.test(value)) return "星程";
  if (/如家/.test(value)) return "如家";
  return "";
}

function addAliHotelCoreAliases(target: Set<string>, normalizedSource: string, aliases: Array<[string, string[]]>) {
  for (const [marker, markerAliases] of aliases) {
    if (normalizedSource.includes(normalizeAddressForMatch(marker))) {
      for (const alias of markerAliases) target.add(normalizeAddressForMatch(alias));
    }
  }
}

function addAliHotelKnownLocationSignals(target: Set<string>, normalizedSource: string) {
  const knownLocationTokens = [
    "白云国际机场",
    "白云机场",
    "T2航站楼",
    "越秀公园地铁站",
    "越秀公园",
    "北京路步行街",
    "北京路",
    "盘福路",
    "上下九步行街",
    "上下九",
    "永庆坊",
    "荔湾湖公园",
    "广州塔",
    "琶洲会展",
    "琶洲",
    "金融城",
    "临江大道",
    "白云山",
    "东圃",
    "科学城",
    "珠吉",
    "火车东站",
    "广州东站",
    "体育中心",
    "珠江新城"
  ];
  for (const token of knownLocationTokens) {
    const normalizedToken = normalizeAddressForMatch(token);
    if (normalizedToken.length >= 2 && normalizedSource.includes(normalizedToken)) {
      target.add(normalizedToken);
    }
  }
}

function addAliHotelBracketLocationSignals(target: Set<string>, hotelName: string) {
  const bracketText = aliHotelBracketText(hotelName);
  const normalizedBracket = normalizeAddressForMatch(bracketText)
    .replace(/^广州/, "")
    .replace(/酒店|店|如家|商旅|金标/g, "");
  const patterns = [
    /([\u4e00-\u9fa5A-Za-z0-9]{2,8})地铁站/g,
    /([\u4e00-\u9fa5A-Za-z0-9]{2,8})步行街/g,
    /([\u4e00-\u9fa5A-Za-z0-9]{2,8})(?:公园|机场|大道|路|街|广场|商圈|码头|大学|医院|科学园|会展中心|火车站|体育中心)/g
  ];
  for (const pattern of patterns) {
    for (const match of normalizedBracket.matchAll(pattern)) {
      const token = normalizeAddressForMatch(match[0]);
      const prefixToken = normalizeAddressForMatch(match[1] ?? "");
      if (token.length >= 2) target.add(token);
      if (prefixToken.length >= 2) target.add(prefixToken);
    }
  }
}

function buildAliHotelDetailCoreSignals(candidate: QingmaoHotelCandidate, queryCity = "") {
  const sourceText = `${candidate.hotelName} ${candidate.address}`;
  const normalizedSource = normalizeAddressForMatch(sourceText);
  const primaryKeywords = new Set(
    [
      ...buildCtripHotelCoreKeywords(candidate.hotelName),
      ...buildAliHotelCoreLocationKeywords(candidate, queryCity)
    ]
      .map((keyword) => normalizeAddressForMatch(keyword))
      .filter((keyword) => keyword.length >= 2 && !/如家商旅|酒店|广州/.test(keyword))
  );
  const strongLandmarks = new Set<string>();
  const auxiliaryKeywords = new Set<string>();
  addAliHotelKnownLocationSignals(strongLandmarks, normalizedSource);
  addAliHotelBracketLocationSignals(strongLandmarks, candidate.hotelName);
  addAliHotelCoreAliases(strongLandmarks, normalizedSource, [
    ["白云国际机场", ["白云国际机场", "白云机场"]],
    ["白云机场", ["白云机场", "白云国际机场"]],
    ["T2航站楼", ["T2航站楼", "T2"]],
    ["空港大道", ["空港大道", "空港"]],
    ["花都大道", ["花都大道"]],
    ["白云山", ["白云山"]]
  ]);
  addAliHotelCoreAliases(auxiliaryKeywords, normalizedSource, [
    ["花东镇", ["花东镇", "花东"]],
    ["花都区", ["花都"]],
    ["花都大道", ["花都"]],
    ["白云机场", ["机场"]],
    ["白云国际机场", ["机场"]]
  ]);
  const allKeywords = new Set([...primaryKeywords, ...strongLandmarks, ...auxiliaryKeywords]);
  return {
    primaryKeywords: Array.from(primaryKeywords),
    strongLandmarks: Array.from(strongLandmarks),
    auxiliaryKeywords: Array.from(auxiliaryKeywords),
    allKeywords: Array.from(allKeywords)
  };
}

function buildAliHotelDetailCoreKeywords(candidate: QingmaoHotelCandidate, queryCity = "") {
  return buildAliHotelDetailCoreSignals(candidate, queryCity).allKeywords;
}

function buildAliHotelLooseDetailLandmarkTokens(candidate: QingmaoHotelCandidate, queryCity = "") {
  const target = new Set<string>();
  const addTailTokens = (value: string) => {
    const normalized = stripAliHotelCoreNoise(value, queryCity);
    const withoutWeak = withoutAliWeakLocationQualifiers(normalized);
    const source = withoutWeak || normalized;
    const compactLandmarkPattern = /([\u4e00-\u9fa5A-Za-z0-9]{2,12}(?:园|城|湾|码头))/g;
    for (const match of source.matchAll(compactLandmarkPattern)) {
      const fullToken = stripAliHotelCoreNoise(match[1] ?? "", queryCity);
      const tailLengths = fullToken.endsWith("码头") ? [4, 5, 6] : [3, 4, 5];
      for (const length of tailLengths) {
        if (fullToken.length < length) continue;
        const tailToken = fullToken.slice(-length);
        if (isMeaningfulAliCoreKeyword(tailToken)) target.add(tailToken);
      }
    }
  };

  addTailTokens(aliHotelBracketText(candidate.hotelName));
  addTailTokens(candidate.hotelName);
  return Array.from(target);
}

function aliHotelKeywordMatched(keyword: string, normalizedCardName: string, normalizedCard: string) {
  return normalizedCardName.includes(keyword) || normalizedCard.includes(keyword);
}

export function buildAliHotelSearchKeywords(query: QingmaoHotelCandidateQuery, candidate: QingmaoHotelCandidate) {
  const doorPlate = extractHotelRoadDoorKeyword(candidate.address);
  const doorNumber = extractHotelDoorNumber(candidate.address);
  const roadKeyword = extractHotelRoadKeyword(candidate.address);
  const normalizedNameKeywords = normalizeHotelSearchKeywords(candidate.hotelName);
  const brandName = /如家/.test(candidate.hotelName) ? "如家" : detectAliHotelBrandKeyword(candidate.hotelName);
  const brandHotelName = brandName ? `${brandName}酒店` : "";
  const coreLocationKeywords = buildAliHotelCoreLocationKeywords(candidate, query.city, {
    includeAddress: false,
    includeNameWithoutBracket: false
  });
  const nameWithCoreKeywords = buildAliHotelNameWithCoreKeywords(candidate, query.city);
  const brandCoreKeywords = brandName
    ? coreLocationKeywords.flatMap((keyword) => Array.from(new Set([
      brandHotelName ? `${brandHotelName}${keyword}` : "",
      `${brandName}${keyword}`
    ].filter(Boolean))))
    : [];
  const brandRoadKeyword = brandName && roadKeyword ? `${brandName}${roadKeyword}` : "";
  const brandDoorPlateKeyword = brandName && doorPlate ? `${brandName}${doorPlate}` : "";
  const brandDoorNumberKeyword = brandName && doorNumber ? `${brandName}${doorNumber}` : "";
  return Array.from(new Set([
    candidate.hotelName,
    ...nameWithCoreKeywords,
    ...brandCoreKeywords,
    doorPlate,
    brandRoadKeyword,
    brandDoorPlateKeyword,
    brandDoorNumberKeyword,
    roadKeyword,
    ...normalizedNameKeywords
  ].filter((keyword): keyword is string => {
    const value = keyword?.trim();
    if (!value) return false;
    return !isAliPureBrandKeyword(value, brandName);
  })));
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
  const otherCityMatched = /(北京|上海|深圳|杭州|成都|重庆|天津|南京|武汉|长沙|厦门|福州|青岛|西安|苏州|佛山|东莞|珠海)/.test(normalizedCard.replace(city, ""));
  const cityMatched = !city || normalizedCard.includes(city) || candidate.hotelName.includes(queryCity) || (!parsed.address && !otherCityMatched);
  const exactNameMatched = scoreHotelNameMatch(candidate.hotelName, parsed.hotelName || text) >= Math.min(8, normalizeHotelNameForMatch(candidate.hotelName).length);
  const coreSignals = buildAliHotelDetailCoreSignals(candidate, queryCity);
  const roadKeyword = extractHotelRoadKeyword(candidate.address);
  const normalizedRoadKeyword = roadKeyword ? normalizeAddressForMatch(roadKeyword) : "";
  const primaryCoreMatched = coreSignals.primaryKeywords.some((keyword) => aliHotelKeywordMatched(keyword, normalizedCardName, normalizedCard));
  const strongLandmarkMatched = coreSignals.strongLandmarks.some((keyword) => aliHotelKeywordMatched(keyword, normalizedCardName, normalizedCard));
  const auxiliaryMatchedCount = coreSignals.auxiliaryKeywords.filter((keyword) => aliHotelKeywordMatched(keyword, normalizedCardName, normalizedCard)).length;
  const looseDetailLandmarkMatched = buildAliHotelLooseDetailLandmarkTokens(candidate, queryCity)
    .some((keyword) => aliHotelKeywordMatched(keyword, normalizedCardName, normalizedCard));
  const coreNameMatched = exactNameMatched
    || primaryCoreMatched
    || strongLandmarkMatched
    || looseDetailLandmarkMatched
    || Boolean(normalizedRoadKeyword && normalizedCard.includes(normalizedRoadKeyword))
    || auxiliaryMatchedCount >= 2;
  const strictMatch = matchHotelByBrandCoreCityDoorNumber(candidate, text, queryCity);
  const matched = brandMatched && coreNameMatched && cityMatched;
  const reason = matched
    ? "阿里列表候选：品牌+核心店名，待详情门牌确认"
    : !brandMatched
      ? "brand-not-matched"
      : !coreNameMatched
        ? "core-name-not-matched"
        : !cityMatched
          ? "city-not-matched"
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
    primaryCoreMatched,
    strongLandmarkMatched,
    looseDetailLandmarkMatched,
    auxiliaryMatchedCount,
    exactNameMatched,
    cityMatched,
    rawText: text
  };
}

export function matchAliHotelSearchSuggestionText(candidate: QingmaoHotelCandidate, text: string, queryCity = "") {
  const match = matchAliHotelListCandidateForDetail(candidate, text, queryCity);
  return {
    matched: match.matched,
    reason: match.reason,
    hotelName: match.hotelName,
    brandMatched: match.brandMatched,
    coreNameMatched: match.coreNameMatched,
    cityMatched: match.cityMatched,
    rawText: text
  };
}

function isLikelyHotelDoorNumber(value: string | null) {
  if (!value) return false;
  const normalized = value.replace(/[－]/g, "-");
  const numericParts = normalized.match(/\d+/g) ?? [];
  if (!numericParts.length) return false;
  return numericParts.every((part) => part.length <= 5);
}

function extractHotelDoorNumbers(text: string) {
  const normalized = normalizeAddressForMatch(text);
  return Array.from(normalized.matchAll(/(\d+(?:(?:[-－~～]|至)\d+)?号)(?!线)/g))
    .map((match) => match[1].replace(/[－~～]|至/g, "-"))
    .filter(isLikelyHotelDoorNumber);
}

export function extractHotelDoorNumber(text: string) {
  const doorPlate = extractHotelDoorPlate(text);
  if (doorPlate) {
    return [...extractHotelDoorNumbers(doorPlate)].reverse()[0] ?? null;
  }
  return [...extractHotelDoorNumbers(text)].reverse()[0] ?? null;
}

function hotelDoorNumberRange(value: string | null) {
  if (!value) return null;
  const match = value.replace(/[－]/g, "-").match(/^(\d+)(?:-(\d+))?号$/);
  if (!match) return null;
  const first = Number(match[1]);
  let second = Number(match[2] ?? match[1]);
  if (match[2] && match[2].length < match[1].length && second < first) {
    const prefix = match[1].slice(0, match[1].length - match[2].length);
    second = Number(`${prefix}${match[2]}`);
  }
  return {
    start: Math.min(first, second),
    end: Math.max(first, second)
  };
}

function areHotelDoorNumbersCompatible(expected: string | null, actual: string | null) {
  if (!expected || !actual) return false;
  if (expected === actual) return true;
  const expectedRange = hotelDoorNumberRange(expected);
  const actualRange = hotelDoorNumberRange(actual);
  if (!expectedRange || !actualRange) return false;
  return expectedRange.start <= actualRange.end && actualRange.start <= expectedRange.end;
}

function extractAliHotelDetailAddressText(queryCity: string, rawText: string, expectedDoorNumber: string | null) {
  if (!expectedDoorNumber) return "";
  const city = queryCity.replace(/市$/, "");
  const textCandidates = rawText
    .split(/\n+/)
    .map((line) => normalizeAddressForMatch(line).replace(/\s+/g, " ").trim())
    .filter((line) => extractHotelDoorNumbers(line).some((doorNumber) => areHotelDoorNumbersCompatible(expectedDoorNumber, doorNumber)));
  if (!textCandidates.length) {
    const compactText = normalizeAddressForMatch(rawText).replace(/\s+/g, " ").trim();
    if (extractHotelDoorNumbers(compactText).some((doorNumber) => areHotelDoorNumbersCompatible(expectedDoorNumber, doorNumber))) {
      textCandidates.push(compactText);
    }
  }

  for (const text of textCandidates) {
    const matchedDoorNumber = [...extractHotelDoorNumbers(text)]
      .reverse()
      .find((doorNumber) => areHotelDoorNumbersCompatible(expectedDoorNumber, doorNumber));
    if (!matchedDoorNumber) continue;
    const doorIndex = text.lastIndexOf(matchedDoorNumber);
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
    let addressPrefix = (startIndex >= 0 ? prefix.slice(startIndex) : prefix).trim();
    const hotelNameEnd = Math.max(addressPrefix.lastIndexOf("酒店"), addressPrefix.lastIndexOf("宾馆"));
    if (hotelNameEnd >= 0 && hotelNameEnd < addressPrefix.length - 2) {
      addressPrefix = addressPrefix.slice(hotelNameEnd + 2).trim();
    }
    if (!/^\d/.test(addressPrefix)) {
      addressPrefix = addressPrefix
        .replace(/^.*?(?=[\u4e00-\u9fa5]{1,}(?:省|市|区|县|路|街|大道|道))/, "")
        .trim();
    }
    const address = `${addressPrefix}${matchedDoorNumber}`.trim();
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
    /\d+(?:[-－]\d+)?号(?!线)/.test(chunk)
    && /(?:市|区|县|路|街|大道|道)/.test(chunk)
    && (!city || chunk.includes(city))
    && !/备案|ICP|许可证|营业执照/.test(chunk)
    && Boolean(extractHotelDoorNumber(chunk))
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
  const doorNumberMatched = areHotelDoorNumbersCompatible(candidateDoorNumber, cardDoorNumber);
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
  const normalizedFullDetail = normalizeAddressForMatch(detailText);
  const city = queryCity.replace(/市$/, "");
  const doorNumberMatched = areHotelDoorNumbersCompatible(expectedDoorNumber, actualDoorNumber);
  const localAddressMatched = Boolean(detailAddress && doorNumberMatched && /(?:市|区|县|路|街|大道|道)/.test(detailAddress));
  const cityMatched = !city || normalizedDetail.includes(city) || normalizedFullDetail.includes(city) || localAddressMatched;

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
  if (cityMatched && doorNumberMatched) {
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
  selectedCardScreenshotPath?: string;
  detailFinalUrl?: string;
  detailAddress?: string;
  detailDoorNumber?: string | null;
  detailSameHotel?: boolean;
  detailMatchBasis?: string;
  failureReason?: string;
  detailScreenshotPath?: string;
  failureScreenshotPath?: string;
  pathRecords?: AliHotelPathRecord[];
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
  failureScreenshotPath?: string;
  pathRecords: AliHotelPathRecord[];
}

export type AliHotelPathRecordStatus = "completed" | "failed" | "skipped";

export type AliHotelPathStep =
  | "open-hotel-home"
  | "select-search-suggestion"
  | "open-search-result"
  | "read-candidate-cards"
  | "rank-candidates"
  | "save-search-result-screenshot"
  | "save-selected-candidate-screenshot"
  | "click-candidate"
  | "wait-detail-page"
  | "read-detail-identity"
  | "save-detail-screenshot"
  | "confirm-same-hotel"
  | "read-main-rate"
  | "save-main-rate-screenshot"
  | "save-failure-screenshot"
  | "keyword-attempt";

export interface AliHotelPathRecord {
  step: AliHotelPathStep;
  status: AliHotelPathRecordStatus;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  keyword?: string;
  keywordMode?: AliHotelSearchKeywordPlanItem["mode"];
  finalUrl?: string;
  screenshotPath?: string;
  diagnosisPath?: string;
  candidateRank?: number;
  candidateCardIndex?: number;
  candidateCardText?: string;
  selectedCandidate?: boolean;
  detailHotelName?: string;
  detailAddress?: string;
  extractedDoorNumber?: string | null;
  sameHotel?: boolean;
  matchBasis?: string;
  ratePlan?: HotelRatePlanLabel;
  price?: number | null;
  failureReason?: string;
  details?: Record<string, unknown>;
}

export interface AliHotelCardReadPage {
  evaluate(pageFunction: string): Promise<unknown>;
  waitForTimeout(timeout: number): Promise<unknown>;
}

export function buildAliHotelPathRecord(input: {
  step: AliHotelPathStep;
  status: AliHotelPathRecordStatus;
  startedAtMs: number;
  endedAtMs?: number;
  keyword?: string;
  keywordMode?: AliHotelSearchKeywordPlanItem["mode"];
  finalUrl?: string;
  screenshotPath?: string;
  diagnosisPath?: string;
  candidateRank?: number;
  candidateCardIndex?: number;
  candidateCardText?: string;
  selectedCandidate?: boolean;
  detailHotelName?: string;
  detailAddress?: string;
  extractedDoorNumber?: string | null;
  sameHotel?: boolean;
  matchBasis?: string;
  ratePlan?: HotelRatePlanLabel;
  price?: number | null;
  failureReason?: string;
  details?: Record<string, unknown>;
}): AliHotelPathRecord {
  const endedAtMs = input.endedAtMs ?? Date.now();
  return {
    step: input.step,
    status: input.status,
    startedAt: new Date(input.startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    durationMs: Math.max(0, endedAtMs - input.startedAtMs),
    keyword: input.keyword,
    keywordMode: input.keywordMode,
    finalUrl: input.finalUrl,
    screenshotPath: input.screenshotPath,
    diagnosisPath: input.diagnosisPath,
    candidateRank: input.candidateRank,
    candidateCardIndex: input.candidateCardIndex,
    candidateCardText: input.candidateCardText,
    selectedCandidate: input.selectedCandidate,
    detailHotelName: input.detailHotelName,
    detailAddress: input.detailAddress,
    extractedDoorNumber: input.extractedDoorNumber,
    sameHotel: input.sameHotel,
    matchBasis: input.matchBasis,
    ratePlan: input.ratePlan,
    price: input.price,
    failureReason: input.failureReason,
    details: input.details
  };
}

export function appendAliHotelPathRecord(
  records: AliHotelPathRecord[],
  input: Parameters<typeof buildAliHotelPathRecord>[0]
) {
  const record = buildAliHotelPathRecord(input);
  records.push(record);
  return record;
}

function scoreAliHotelDetailCandidate(candidate: QingmaoHotelCandidate, match: ReturnType<typeof matchAliHotelListCandidateForDetail>) {
  const expectedDoorNumber = extractHotelDoorNumber(candidate.address);
  let score = 0;
  if (match.exactNameMatched) score += 100;
  if (match.brandMatched) score += 30;
  if (match.coreNameMatched) score += 40;
  if (match.strongLandmarkMatched) score += 20;
  if (match.auxiliaryMatchedCount >= 2) score += 10;
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
    addressBody.matchAll(/([\u4e00-\u9fa5A-Za-z0-9]{1,24}(?:大道|大街|横路|横街|路|街|巷|弄|道|里|村)[东南西北中]?\d+(?:(?:[-－~～]|至)\d+)?号)/g)
  ).map((match) => match[1]);
  return matches.length ? matches[matches.length - 1] : null;
}

function areHotelDoorPlatesCompatible(sourceDoorPlate: string | null, targetDoorPlate: string | null, targetText = "") {
  if (!sourceDoorPlate) return false;
  const normalizedTarget = normalizeAddressForMatch(targetText);
  if (normalizedTarget.includes(normalizeAddressForMatch(sourceDoorPlate))) return true;
  const sourceRoad = extractHotelRoadKeyword(sourceDoorPlate) ?? "";
  const targetRoad = targetDoorPlate ? extractHotelRoadKeyword(targetDoorPlate) ?? "" : "";
  const sourceDoorNumber = extractHotelDoorNumber(sourceDoorPlate);
  const targetDoorNumber = targetDoorPlate ? extractHotelDoorNumber(targetDoorPlate) : extractHotelDoorNumber(targetText);
  const roadMatched = Boolean(sourceRoad && (normalizedTarget.includes(normalizeAddressForMatch(sourceRoad)) || (targetRoad && normalizeAddressForMatch(sourceRoad) === normalizeAddressForMatch(targetRoad))));
  return roadMatched && areHotelDoorNumbersCompatible(sourceDoorNumber, targetDoorNumber);
}

export function isSameHotelByCityAndDoorPlate(queryCity: string, sourceAddress: string, targetText: string) {
  const doorPlate = extractHotelDoorPlate(sourceAddress);
  if (!doorPlate) return false;

  const normalizedTarget = normalizeAddressForMatch(targetText);
  const cityMatched = !queryCity || normalizedTarget.includes(queryCity.replace(/市$/, ""));
  return cityMatched && areHotelDoorPlatesCompatible(doorPlate, extractHotelDoorPlate(targetText), targetText);
}

export function selectLockedQingmaoHotelCandidate(candidates: QingmaoHotelCandidate[], query: QingmaoHotelCandidateQuery) {
  const candidate = candidates.find((item) => isHotelCandidateRelevantForQuery(item, query) && Boolean(item.price && item.price > 0));
  if (!candidate) {
    throw new Error(`未找到${query.city}/${query.keyword}可用青猫酒店候选`);
  }
  const stabilityFailure = qingmaoSourceCandidateStabilityFailure(candidate);
  if (stabilityFailure) {
    throw new Error(`${candidate.hotelName} ${stabilityFailure}`);
  }
  return candidate;
}

export function qingmaoSourceCandidateStabilityFailure(candidate: QingmaoHotelCandidate) {
  if (!candidate.address) return "青猫候选缺少地址";
  if (!extractHotelDoorPlate(candidate.address)) return `青猫候选缺少可提取门牌号：${candidate.address}`;
  return null;
}

export function diagnoseDoorPlateMatch(queryCity: string, sourceAddress: string, targetText: string) {
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
  if (areHotelDoorPlatesCompatible(sourceDoorPlate, targetDoorPlate, targetText)) {
    return {
      sameHotel: true,
      matchBasis: "同城市同道路且门牌号兼容",
      sourceDoorPlate,
      targetDoorPlate: targetDoorPlate ?? sourceDoorPlate
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

export function assertCompetitorHotelDetailSameByDoorPlate(platform: PlatformName, query: QingmaoHotelCandidateQuery, candidate: QingmaoHotelCandidate, bodyText: string) {
  const match = diagnoseDoorPlateMatch(query.city, candidate.address, bodyText);
  if (!match.sameHotel) {
    throw new Error(`${platform}同店命中失败：${match.matchBasis}；青猫门牌=${match.sourceDoorPlate ?? (candidate.address || "未提取")}；竞品门牌=${match.targetDoorPlate ?? "未提取"}`);
  }
  return match;
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

function ztripHotelTextHasCandidateSignal(queryCity: string, candidate: QingmaoHotelCandidate, text: string) {
  const normalizedText = normalizeAddressForMatch(text);
  const normalizedHotelName = normalizeAddressForMatch(candidate.hotelName);
  const brandName = detectAliHotelBrandKeyword(candidate.hotelName);
  const normalizedBrand = normalizeAddressForMatch(brandName);
  const doorPlate = extractHotelDoorPlate(candidate.address);
  const roadKeyword = extractHotelRoadKeyword(candidate.address);
  const coreKeywords = buildHotelCoreSearchKeywords(candidate, queryCity).map(normalizeAddressForMatch);
  if (normalizedHotelName && normalizedText.includes(normalizedHotelName)) return true;
  if (doorPlate && normalizedText.includes(normalizeAddressForMatch(doorPlate))) return true;
  if (roadKeyword && normalizedText.includes(normalizeAddressForMatch(roadKeyword)) && normalizedBrand && normalizedText.includes(normalizedBrand)) return true;
  return Boolean(normalizedBrand && normalizedText.includes(normalizedBrand) && coreKeywords.some((keyword) => keyword.length >= 2 && normalizedText.includes(keyword)));
}

export function classifyZtripHotelSearchReadiness(queryCity: string, candidate: QingmaoHotelCandidate, text: string) {
  if (/加载中|请稍等|loading/i.test(text)) return "loading";
  if (ztripHotelTextHasCandidateSignal(queryCity, candidate, text)) return "target-candidate";
  if (/暂无|未找到|无搜索结果|没有找到|没有符合条件/.test(text)) return "empty";
  if ((/查看详情|CNY\s*\d+|[¥￥]\s*\d+起/.test(text)) && /酒店|宾馆|公寓|客栈/.test(text)) return "finished-without-target";
  return "loading";
}

async function waitForZtripHotelSearchReadiness(page: BrowserPage, query: ZtripHotelQuery, candidate: QingmaoHotelCandidate, keyword: string) {
  let latestText = "";
  for (let attempt = 0; attempt < 45; attempt += 1) {
    latestText = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => latestText);
    const readiness = classifyZtripHotelSearchReadiness(query.city, candidate, latestText);
    if (readiness !== "loading") {
      return { readiness, text: latestText };
    }
    await page.waitForTimeout(1_000);
  }

  throw new Error(`在途商旅酒店搜索结果加载超时：${keyword}`);
}

async function clickZtripHotelSuggestion(page: BrowserPage, candidate: QingmaoHotelCandidate, queryCity: string) {
  const hotelValue = JSON.stringify(candidate.hotelName);
  const doorPlateValue = JSON.stringify(extractHotelDoorPlate(candidate.address) ?? "");
  const roadKeywordValue = JSON.stringify(extractHotelRoadKeyword(candidate.address) ?? "");
  const brandValue = JSON.stringify(detectAliHotelBrandKeyword(candidate.hotelName));
  const coreKeywordsValue = JSON.stringify(buildHotelCoreSearchKeywords(candidate, queryCity));
  return await page.evaluate<boolean>(`(() => {
    const hotelName = ${hotelValue};
    const doorPlate = ${doorPlateValue};
    const roadKeyword = ${roadKeywordValue};
    const brand = ${brandValue};
    const coreKeywords = ${coreKeywordsValue};
    const normalizeAddress = (value) => String(value || "").replace(/\\s+/g, "").replace(/[()（）,，。；;：:]/g, "");
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const normalizedHotelName = normalizeAddress(hotelName);
    const normalizedBrand = normalizeAddress(brand);
    const normalizedDoorPlate = normalizeAddress(doorPlate);
    const normalizedRoadKeyword = normalizeAddress(roadKeyword);
    const normalizedCoreKeywords = coreKeywords.map(normalizeAddress).filter((keyword) => keyword.length >= 2);
    const score = (text) => {
      const normalizedText = normalizeAddress(text);
      if (!normalizedText || /筛选|价格|排序|热门|清空|入住|离店/.test(text)) return 0;
      if (normalizedHotelName && normalizedText.includes(normalizedHotelName)) return 100;
      if (normalizedDoorPlate && normalizedText.includes(normalizedDoorPlate)) return 90;
      if (normalizedBrand && normalizedRoadKeyword && normalizedText.includes(normalizedBrand) && normalizedText.includes(normalizedRoadKeyword)) return 80;
      if (normalizedBrand && normalizedText.includes(normalizedBrand) && normalizedCoreKeywords.some((keyword) => normalizedText.includes(keyword))) return 70;
      return 0;
    };
    const elements = Array.from(document.querySelectorAll("*"))
      .map((element) => ({ element, text: (element.textContent || "").replace(/\\s+/g, " ").trim() }))
      .filter(({ element, text }) => isVisible(element) && text.length >= 4 && text.length <= 300)
      .map((item) => ({ ...item, score: score(item.text) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.text.length - right.text.length);
    const target = elements[0]?.element;
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

async function openMatchingZtripHotelDetail(page: BrowserPage, candidate: QingmaoHotelCandidate, queryCity: string) {
  if (await isZtripHotelDetailLoaded(page)) return;

  const hotelValue = JSON.stringify(candidate.hotelName);
  const doorPlateValue = JSON.stringify(extractHotelDoorPlate(candidate.address) ?? "");
  const roadKeywordValue = JSON.stringify(extractHotelRoadKeyword(candidate.address) ?? "");
  const brandValue = JSON.stringify(detectAliHotelBrandKeyword(candidate.hotelName));
  const coreKeywordsValue = JSON.stringify(buildHotelCoreSearchKeywords(candidate, queryCity));
  const clicked = await page.evaluate<boolean>(`(() => {
    const hotelName = ${hotelValue};
    const doorPlate = ${doorPlateValue};
    const roadKeyword = ${roadKeywordValue};
    const brand = ${brandValue};
    const coreKeywords = ${coreKeywordsValue};
    const normalizeAddress = (value) => String(value || "").replace(/\\s+/g, "").replace(/[()（）,，。；;：:]/g, "");
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const normalizedHotelName = normalizeAddress(hotelName);
    const normalizedBrand = normalizeAddress(brand);
    const normalizedDoorPlate = normalizeAddress(doorPlate);
    const normalizedRoadKeyword = normalizeAddress(roadKeyword);
    const normalizedCoreKeywords = coreKeywords.map(normalizeAddress).filter((keyword) => keyword.length >= 2);
    const score = (text) => {
      const normalizedText = normalizeAddress(text);
      if (!normalizedText || !/查看详情|CNY|¥|￥|酒店/.test(text)) return 0;
      if (normalizedHotelName && normalizedText.includes(normalizedHotelName)) return 100;
      if (normalizedDoorPlate && normalizedText.includes(normalizedDoorPlate)) return 90;
      if (normalizedBrand && normalizedRoadKeyword && normalizedText.includes(normalizedBrand) && normalizedText.includes(normalizedRoadKeyword)) return 80;
      if (normalizedBrand && normalizedText.includes(normalizedBrand) && normalizedCoreKeywords.some((keyword) => normalizedText.includes(keyword))) return 70;
      return 0;
    };
    const nameNode = Array.from(document.querySelectorAll("*"))
      .map((element) => ({ element, text: (element.textContent || "").replace(/\\s+/g, " ").trim() }))
      .filter(({ element, text }) => isVisible(element) && text.length >= 4 && text.length <= 800)
      .map((item) => ({ ...item, score: score(item.text) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.text.length - right.text.length)[0]?.element;
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
    throw new Error(`在途商旅同店命中失败：结果页未找到同酒店详情入口：${candidate.hotelName}`);
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await isZtripHotelDetailLoaded(page)) return;
    await page.waitForTimeout(1_000);
  }

  throw new Error("在途商旅同酒店详情房型加载超时");
}

async function openZtripHotelSearchResultByHotel(page: BrowserPage, query: ZtripHotelQuery, candidate: QingmaoHotelCandidate) {
  await page.goto(ztripHotelListUrl(query), { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState?.("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await waitForZtripHotelKeywordInput(page);

  for (const keyword of buildHotelSearchKeywords({ city: query.city }, candidate)) {
    const timeoutNotes: string[] = [];
    const submitSearch = async () => {
      await waitForZtripHotelKeywordInput(page);
      await page.locator('input[placeholder*="酒店名称"]').first().fill(keyword);
      await page.waitForTimeout(300);
      await clickZtripSearchButton(page);
      await page.waitForTimeout(1_500);
    };
    await submitSearch();

    let searchState: Awaited<ReturnType<typeof waitForZtripHotelSearchReadiness>>;
    try {
      searchState = await waitForZtripHotelSearchReadiness(page, query, candidate, keyword);
    } catch (firstError) {
      timeoutNotes.push(`首次等待失败：${errorMessage(firstError)}`);
      await page.goto(page.url(), { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
      await page.waitForLoadState?.("networkidle", { timeout: 15_000 }).catch(() => undefined);
      try {
        await submitSearch();
        searchState = await waitForZtripHotelSearchReadiness(page, query, candidate, keyword);
      } catch (refreshError) {
        timeoutNotes.push(`刷新后等待失败：${errorMessage(refreshError)}`);
        await page.goto(ztripHotelListUrl(query), { waitUntil: "domcontentloaded", timeout: 45_000 });
        await page.waitForLoadState?.("networkidle", { timeout: 15_000 }).catch(() => undefined);
        await submitSearch();
        try {
          searchState = await waitForZtripHotelSearchReadiness(page, query, candidate, keyword);
        } catch (reopenError) {
          timeoutNotes.push(`重进在途酒店页后等待失败：${errorMessage(reopenError)}`);
          throw new Error(`在途商旅酒店搜索结果加载超时：${keyword}；${timeoutNotes.join("；")}`);
        }
      }
    }
    if (searchState.readiness !== "target-candidate") {
      continue;
    }

    await clickZtripHotelSuggestion(page, candidate, query.city);
    for (let attempt = 0; attempt < 15; attempt += 1) {
      if (await isZtripHotelDetailLoaded(page)) return;
      await page.waitForTimeout(1_000);
    }

    await openMatchingZtripHotelDetail(page, candidate, query.city);
    return;
  }

  throw new Error(`在途商旅同店命中失败：多轮关键词未搜索到同一家酒店：${candidate.hotelName}`);
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

export function shouldDowngradeZtripRatePlanFilterFailure(error: unknown) {
  return /在途商旅酒店未找到筛选项/.test(errorMessage(error));
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
  const labels = ztripHotelFilterLabelsForRatePlan(ratePlan);
  await clickZtripHotelFilter(page, labels[0]);
  if (hotelRatePlanBreakfast(ratePlan) === "有早餐") {
    await clickZtripHotelFilter(page, "含早餐").catch(async () => {
      await clickZtripHotelFilter(page, "双份早餐");
    });
  } else {
    await clickZtripHotelFilter(page, "无早餐").catch(async () => {
      await clickZtripHotelFilter(page, "不含早").catch(() => undefined);
    });
  }

  await page.waitForTimeout(1_500);
}

function ztripHotelFilterLabelsForRatePlan(ratePlan: HotelRatePlanLabel) {
  return [
    hotelRatePlanBedType(ratePlan),
    hotelRatePlanBreakfast(ratePlan) === "有早餐" ? "含早餐" : "无早餐"
  ];
}

export function buildZtripSingleAllRatePlanReadSteps() {
  return HOTEL_RATE_PLAN_LABELS.map((ratePlan) => ({
    ratePlan,
    clearFilters: true,
    filterLabels: ztripHotelFilterLabelsForRatePlan(ratePlan),
    expandRoomCards: true,
    stopAtUnmatchedProducts: true
  }));
}

async function clearZtripHotelRatePlanFilters(page: BrowserPage) {
  const labels = ["大床", "双床", "含早餐", "双份早餐", "无早餐", "不含早"];
  const clicked = await page.evaluate<number>(`((labels) => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const looksSelected = (element) => {
      const chain = [element, element.parentElement, element.parentElement?.parentElement].filter(Boolean);
      return chain.some((target) => {
        const className = target.getAttribute("class") || "";
        const ariaChecked = target.getAttribute("aria-checked") || "";
        const ariaSelected = target.getAttribute("aria-selected") || "";
        return /active|selected|select|checked|current/i.test(className)
          || ariaChecked === "true"
          || ariaSelected === "true";
      });
    };
    const candidates = Array.from(document.querySelectorAll("button,span,div,li,a"))
      .filter((element) => {
        if (!isVisible(element)) return false;
        const text = (element.textContent || "").replace(/\\s+/g, "").trim();
        return labels.includes(text) && looksSelected(element);
      });
    let clickedCount = 0;
    const seen = new Set();
    for (const element of candidates) {
      const text = (element.textContent || "").replace(/\\s+/g, "").trim();
      if (seen.has(text)) continue;
      seen.add(text);
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      clickedCount += 1;
    }
    return clickedCount;
  })(${JSON.stringify(labels)})`).catch(() => 0);
  if (clicked > 0) {
    await page.waitForTimeout(900);
  }
}

export function shouldExpandZtripRoomCardForLowestRate(input: {
  currentLowestPrice: number | null;
  outerPrice: number | null;
  ratePlanClear: boolean;
}) {
  if (!input.ratePlanClear) return true;
  if (typeof input.outerPrice !== "number") return true;
  if (typeof input.currentLowestPrice !== "number") return true;
  return input.outerPrice < input.currentLowestPrice;
}

async function expandZtripRoomCards(page: BrowserPage, ratePlan?: HotelRatePlanLabel) {
  for (let round = 0; round < 3; round += 1) {
    const currentLowestPrice = ratePlan
      ? selectZtripHotelRateForRatePlan(parseZtripHotelRatesTextForRatePlan(await page.locator("body").innerText({ timeout: 2_000 }).catch(() => ""), ratePlan), ratePlan)?.price ?? null
      : null;
    const input = {
      currentLowestPrice,
      ratePlanBedType: ratePlan ? hotelRatePlanBedType(ratePlan) : "",
      ratePlanBreakfast: ratePlan ? hotelRatePlanBreakfast(ratePlan) : ""
    };
    const clickedCount = await page.evaluate<number>(`((input) => {
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const priceFromText = (text) => {
        const prices = Array.from(text.matchAll(/(?:CNY|￥|¥)\\s*(\\d{2,5})/gi))
          .map((match) => Number(match[1]))
          .filter((price) => price >= 80);
        return prices.length ? Math.min(...prices) : null;
      };
      const hasBreakfast = (text) => /含早餐|含早|1份早餐|单份早餐|单早|2份早餐|双份早餐|双早/.test(text);
      const hasNoBreakfast = (text) => /无早餐|无早|不含早|无餐食/.test(text);
      const isRatePlanClear = (text) => {
        if (!input.ratePlanBedType || !input.ratePlanBreakfast) return false;
        const bedClear = input.ratePlanBedType === "双床"
          ? /双床/.test(text) && !/大床/.test(text)
          : /大床/.test(text) && !/双床/.test(text);
        const breakfastClear = input.ratePlanBreakfast === "无早餐"
          ? hasNoBreakfast(text)
          : hasBreakfast(text);
        return bedClear && breakfastClear;
      };
      const shouldExpand = (text) => {
        const outerPrice = priceFromText(text);
        const ratePlanClear = isRatePlanClear(text);
        if (!ratePlanClear) return true;
        if (typeof outerPrice !== "number") return true;
        if (typeof input.currentLowestPrice !== "number") return true;
        return outerPrice < input.currentLowestPrice;
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
          if (!text || text.length > 220) return false;
          if (!/房/.test(text) || /住客评价|酒店亮点|酒店政策|早餐一流|查看其他更多价格/.test(text)) return false;
          if (!shouldExpand(text)) return false;
          return /大床|双床|房A|房B|房C|安心睡|商务|高级|特色|零压|安睡/.test(text);
        })
        .sort((left, right) => {
          const leftText = (left.textContent || "").replace(/\\s+/g, " ").trim();
          const rightText = (right.textContent || "").replace(/\\s+/g, " ").trim();
          const leftRandom = /到店随机分配床型|随机床型|房型待定|到店安排/.test(leftText) ? 1 : 0;
          const rightRandom = /到店随机分配床型|随机床型|房型待定|到店安排/.test(rightText) ? 1 : 0;
          if (leftRandom !== rightRandom) return leftRandom - rightRandom;
          const leftExplicit = /大床房|双床房/.test(leftText) ? 0 : 1;
          const rightExplicit = /大床房|双床房/.test(rightText) ? 0 : 1;
          return leftExplicit - rightExplicit;
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
    })(${JSON.stringify(input)})`);
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

async function scrollQingmaoHotelCandidateList(frame: BrowserFrame, direction: "top" | "down" = "down") {
  await frame.evaluate(`(() => {
    const visibleScrollable = Array.from(document.querySelectorAll("*"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 240
          && rect.height > 240
          && style.visibility !== "hidden"
          && style.display !== "none"
          && element.scrollHeight > element.clientHeight + 80;
      })
      .sort((left, right) => (right.scrollHeight - right.clientHeight) - (left.scrollHeight - left.clientHeight));
    const target = visibleScrollable[0] || document.scrollingElement || document.documentElement || document.body;
    if (!target) return false;
    if (${JSON.stringify(direction)} === "top") {
      target.scrollTop = 0;
    } else {
      target.scrollTop += Math.max(target.clientHeight * 0.8, 520);
    }
    target.dispatchEvent(new Event("scroll", { bubbles: true }));
    return true;
  })()`).catch(() => undefined);
}

async function collectQingmaoHotelCandidatesFromFrame(frame: BrowserFrame, maxScrolls = 10) {
  const rawTexts: string[] = [];
  let lastMergedCount = 0;
  let stableScreens = 0;
  await scrollQingmaoHotelCandidateList(frame, "top");
  await frame.waitForTimeout(300);
  for (let screenIndex = 0; screenIndex < maxScrolls; screenIndex += 1) {
    rawTexts.push(await frame.locator("body").innerText({ timeout: 5_000 }).catch(() => ""));
    const merged = mergeQingmaoHotelCandidatesFromTexts(rawTexts);
    if (merged.length === lastMergedCount) {
      stableScreens += 1;
    } else {
      stableScreens = 0;
      lastMergedCount = merged.length;
    }
    if (screenIndex >= 2 && stableScreens >= 2) {
      return merged;
    }
    await scrollQingmaoHotelCandidateList(frame, "down");
    await frame.waitForTimeout(450);
  }
  return mergeQingmaoHotelCandidatesFromTexts(rawTexts);
}

async function clickQingmaoHotelCandidateDetail(frame: BrowserFrame, candidate: QingmaoHotelCandidate, index: number) {
  const hotelNameValue = JSON.stringify(candidate.hotelName);
  const clickByName = async () => await frame.evaluate<boolean>(`(() => {
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

  await scrollQingmaoHotelCandidateList(frame, "top");
  await frame.waitForTimeout(300);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const clickedByName = await clickByName();
    if (clickedByName) return;
    await scrollQingmaoHotelCandidateList(frame, "down");
    await frame.waitForTimeout(350);
  }

  const clickedByName = await clickByName();
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

async function clickFirstQingmaoHotelDetailText(frame: BrowserFrame, texts: string[]) {
  for (const text of texts) {
    if (await clickQingmaoHotelDetailText(frame, text).catch(() => false)) {
      return text;
    }
  }
  return null;
}

async function filterQingmaoHotelMainRate(frame: BrowserFrame, expectedHotelName?: string, ratePlan: HotelRatePlanLabel = HOTEL_VALIDATION_RATE_PLAN) {
  const breakfastLabels = ratePlan.endsWith("无早餐") ? ["无早餐", "无早", "不含早"] : ["含早餐", "含早"];
  await clickFirstQingmaoHotelDetailText(frame, breakfastLabels);
  await frame.waitForTimeout(2_500);
  const bedLabels = ratePlan.startsWith("双床") ? ["双床房"] : ["大床房"];
  await clickFirstQingmaoHotelDetailText(frame, bedLabels);
  if (expectedHotelName) {
    await waitForQingmaoHotelDetailText(frame, expectedHotelName, ratePlan);
  } else {
    await frame.waitForTimeout(1_500);
  }
}

function hotelRatePlanBreakfastPattern(ratePlan: HotelRatePlanLabel) {
  if (ratePlan.endsWith("无早餐")) return /无早餐|无早|不含早|无餐食/;
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

export function buildFailedAliHotelMainRateQuote(input: {
  candidate: QingmaoHotelCandidate;
  ratePlan: HotelRatePlanLabel;
  error: string;
  durationMs: number;
  finalUrl?: string;
  screenshotPath?: string;
  diagnosisPath?: string;
}): HotelMainRateQuote {
  return {
    platform: "阿里商旅",
    status: "failed",
    price: null,
    hotelName: input.candidate.hotelName,
    roomType: "",
    ratePlan: input.ratePlan,
    finalUrl: input.finalUrl,
    screenshotPath: input.screenshotPath,
    diagnosisPath: input.diagnosisPath,
    durationMs: input.durationMs,
    error: input.error
  };
}

export interface HotelMainRateCompetitorCollector {
  platform: PlatformName;
  beforeMessage: string;
  collect: () => Promise<HotelMainRateQuote>;
  pendingQuote: (reason: string) => HotelMainRateQuote;
}

function hasSameHotelFailureEvidence(quote: HotelMainRateQuote) {
  return Boolean(quote.finalUrl || quote.screenshotPath || quote.diagnosisPath || quote.rawText);
}

function isHotelSameHotelHitFailureQuote(quote: HotelMainRateQuote) {
  if (quote.status === "available" && typeof quote.price === "number") return false;
  const failureType = classifyHotelCalibrationFailureType(quote.error ?? "", quote.platform);
  return failureType === "competitor_no_same_hotel" && hasSameHotelFailureEvidence(quote);
}

export function shouldStopHotelAllRatePlanCollectionAfterQuoteFailure(quote: HotelMainRateQuote) {
  return isHotelSameHotelHitFailureQuote(quote);
}

export async function collectHotelMainRateCompetitorQuotes(
  collectors: HotelMainRateCompetitorCollector[],
  options: { stopOnFirstCompetitorFailure?: boolean; onProgress?: (message: string) => void } = {}
) {
  const quotes: HotelMainRateQuote[] = [];
  let stoppedByFailure: HotelMainRateQuote | null = null;

  for (const [index, collector] of collectors.entries()) {
    options.onProgress?.(collector.beforeMessage);
    const quote = await collector.collect();
    quotes.push(quote);
    if (options.stopOnFirstCompetitorFailure && isHotelSameHotelHitFailureQuote(quote)) {
      stoppedByFailure = quote;
      const reason = `${quote.platform}同店命中失败，已跳过剩余竞品：${quote.error ?? "多轮关键词和详情页判断未命中同一家酒店"}`;
      for (const remaining of collectors.slice(index + 1)) {
        quotes.push(remaining.pendingQuote(reason));
      }
      break;
    }
  }

  return { quotes, stoppedByFailure };
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

export function buildCtripHotelSuggestionKeywords(candidate: QingmaoHotelCandidate, query: Pick<QingmaoHotelCandidateQuery, "city"> = { city: "" }) {
  return buildHotelSearchKeywords(query, candidate);
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

export function matchCtripHotelListCandidateText(candidate: QingmaoHotelCandidate, text: string, queryCity = "") {
  const normalizedText = normalizeAddressForMatch(text);
  const doorPlate = extractHotelDoorPlate(candidate.address);
  const coreKeywords = buildHotelCoreSearchKeywords(candidate, queryCity).map(normalizeAddressForMatch);
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

async function clickMatchingCtripHotelFromList(page: BrowserPage, query: QingmaoHotelCandidateQuery, candidate: QingmaoHotelCandidate) {
  const candidateValue = JSON.stringify(candidate.hotelName);
  const doorPlateValue = JSON.stringify(extractHotelDoorPlate(candidate.address) ?? "");
  const coreKeywordsValue = JSON.stringify(buildHotelCoreSearchKeywords(candidate, query.city));
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

export function evaluateCtripHotelDetailKeywordAttempt(query: QingmaoHotelCandidateQuery, candidate: QingmaoHotelCandidate, keyword: string, bodyText: string) {
  const match = diagnoseDoorPlateMatch(query.city, candidate.address, bodyText);
  const failureReason = match.sameHotel
    ? ""
    : `携程商旅同店命中失败：${match.matchBasis} ${query.city} ${match.sourceDoorPlate ?? extractHotelDoorPlate(candidate.address) ?? candidate.address}`;
  return {
    keyword,
    ...match,
    shouldTryNextKeyword: !match.sameHotel,
    failureReason
  };
}

async function openCtripHotelDetailByHotel(page: BrowserPage, query: QingmaoHotelCandidateQuery, candidate: QingmaoHotelCandidate) {
  let lastError = "";

  for (const keyword of buildHotelSearchKeywords(query, candidate)) {
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
      const detailAttempt = evaluateCtripHotelDetailKeywordAttempt(query, candidate, keyword, bodyText);
      if (!detailAttempt.sameHotel) {
        throw new Error(detailAttempt.failureReason);
      }
      return;
    } catch (error) {
      lastError = `${keyword}: ${errorMessage(error)}`;
    }
  }

  throw new Error(lastError || `携程商旅同店命中失败：多轮关键词未找到同一家酒店：${candidate.hotelName}`);
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

  for (const keyword of buildCtripHotelSuggestionKeywords(candidate, query)) {
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

  const error = new Error(lastError || `携程商旅同店命中失败：多轮关键词未找到同一家酒店：${candidate.hotelName}`) as Error & { ctripTrace?: CtripSingleHotelTrace };
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
    const selectedRate = selectLowestHotelMainRateQuote(rates);
    const excludedRows = extractExcludedHotelRateRowsFromText("携程商旅", bodyText);
    const screenshotPath = path.join(artifactDir, hotelRatePlanEvidenceName("携程商旅", ratePlan));
    const evidencePath = await savePageEvidence(page, screenshotPath, {
      platform: "携程商旅",
      finalUrl: page.url(),
      bodyText,
      price: selectedRate?.price ?? null,
      rawText: selectedRate?.rawText ?? excludedRows[0]?.rawText
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
        rawText: excludedRows[0]?.rawText,
        error: excludedRows.length
          ? `携程商旅${ratePlan}价格行已过滤：${excludedRows.map((row) => row.reason).join("、")}`
          : `携程商旅同酒店详情页未解析到${ratePlan}价格`
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

interface AliHotelSearchOpenResult {
  source: "suggestion" | "direct-url";
  suggestionAttempted: boolean;
  suggestionSelected: boolean;
  selectedSuggestionText?: string;
  suggestionFailureReason?: string;
  finalUrl: string;
}

async function tryOpenAliHotelListFromSearchSuggestion(
  page: BrowserPage,
  query: QingmaoHotelCandidateQuery,
  candidate: QingmaoHotelCandidate,
  keyword: string
): Promise<Omit<AliHotelSearchOpenResult, "source" | "finalUrl">> {
  const setInputResult = await page.evaluate<{ attempted: boolean; failureReason?: string }>(`((keyword) => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const inputs = Array.from(document.querySelectorAll("input, textarea, [contenteditable='true']"))
      .filter((element) => isVisible(element));
    const target = inputs.find((element) => {
      const text = [
        element.getAttribute("placeholder"),
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("value"),
        element.textContent
      ].filter(Boolean).join("");
      return /酒店|关键|关键词|名称|搜索|目的地/.test(text);
    }) ?? inputs.find((element) => {
      const text = [
        element.getAttribute("placeholder"),
        element.getAttribute("aria-label"),
        element.getAttribute("title")
      ].filter(Boolean).join("");
      return !/入住|离店|日期|城市/.test(text);
    });
    if (!target) return { attempted: false, failureReason: "未找到阿里酒店关键词输入框" };
    target.scrollIntoView({ block: "center" });
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    target.focus?.();
    if ("value" in target) {
      target.value = "";
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.value = keyword;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      target.textContent = keyword;
      target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: keyword }));
    }
    target.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter" }));
    return { attempted: true };
  })(${JSON.stringify(keyword)})`).catch((error) => ({
    attempted: false,
    failureReason: errorMessage(error)
  }));

  if (!setInputResult.attempted) {
    return {
      suggestionAttempted: false,
      suggestionSelected: false,
      suggestionFailureReason: setInputResult.failureReason
    };
  }

  await page.waitForTimeout(1_200).catch(() => undefined);

  const optionTexts = await page.evaluate<Array<{ index: number; text: string }>>(`(() => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const selectors = [
      "[role='option']",
      "li",
      "[class*='suggest']",
      "[class*='Suggest']",
      "[class*='dropdown']",
      "[class*='Dropdown']",
      "[class*='option']",
      "[class*='Option']",
      "[class*='popover']",
      "[class*='Popover']"
    ];
    const elements = Array.from(new Set(selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)))))
      .filter((element) => isVisible(element));
    return elements
      .map((element, index) => ({
        index,
        text: (element.textContent || "").replace(/\\s+/g, " ").trim()
      }))
      .filter((item) => item.text.length >= 2 && item.text.length <= 180);
  })()`).catch(() => []);

  const matchedOption = optionTexts.find((option) => matchAliHotelSearchSuggestionText(candidate, option.text, query.city).matched) ?? null;
  if (!matchedOption) {
    return {
      suggestionAttempted: true,
      suggestionSelected: false,
      suggestionFailureReason: optionTexts.length
        ? "阿里关键词推荐卡片未命中品牌+核心地名候选"
        : "阿里关键词栏未出现推荐卡片"
    };
  }

  const clicked = await page.evaluate<boolean>(`((targetText) => {
    const normalize = (value) => String(value || "").replace(/\\s+/g, "");
    const expected = normalize(targetText);
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const selectors = [
      "[role='option']",
      "li",
      "[class*='suggest']",
      "[class*='Suggest']",
      "[class*='dropdown']",
      "[class*='Dropdown']",
      "[class*='option']",
      "[class*='Option']",
      "[class*='popover']",
      "[class*='Popover']"
    ];
    const elements = Array.from(new Set(selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)))))
      .filter((element) => isVisible(element));
    const target = elements.find((element) => {
      const text = normalize(element.textContent || "");
      return text === expected || text.includes(expected) || expected.includes(text);
    });
    if (!target) return false;
    target.scrollIntoView({ block: "center" });
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  })(${JSON.stringify(matchedOption.text)})`).catch(() => false);

  if (!clicked) {
    return {
      suggestionAttempted: true,
      suggestionSelected: false,
      selectedSuggestionText: matchedOption.text,
      suggestionFailureReason: "阿里关键词推荐卡片命中但点击失败"
    };
  }

  await page.waitForTimeout(1_500).catch(() => undefined);
  if (!/#\/list/.test(page.url())) {
    const searchClicked = await page.evaluate<boolean>(`(() => {
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const buttons = Array.from(document.querySelectorAll("button, [role='button'], a"))
        .filter((element) => isVisible(element));
      const target = buttons.find((element) => /搜索/.test(element.textContent || ""));
      if (!target) return false;
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    })()`).catch(() => false);
    if (searchClicked) await page.waitForTimeout(3_000).catch(() => undefined);
  }

  return {
    suggestionAttempted: true,
    suggestionSelected: true,
    selectedSuggestionText: matchedOption.text,
    suggestionFailureReason: /#\/list/.test(page.url()) ? undefined : "已点击阿里关键词推荐卡片，但未进入列表页，继续使用直达列表兜底"
  };
}

async function openAliHotelList(
  context: BrowserContext,
  page: BrowserPage,
  query: QingmaoHotelCandidateQuery,
  keyword: string,
  candidate?: QingmaoHotelCandidate
): Promise<AliHotelSearchOpenResult> {
  let suggestionResult: Omit<AliHotelSearchOpenResult, "source" | "finalUrl"> = {
    suggestionAttempted: false,
    suggestionSelected: false
  };
  if (candidate) {
    suggestionResult = await tryOpenAliHotelListFromSearchSuggestion(page, query, candidate, keyword);
    if (suggestionResult.suggestionSelected && /#\/list/.test(page.url())) {
      return {
        source: "suggestion",
        ...suggestionResult,
        finalUrl: page.url()
      };
    }
  }

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
  return {
    source: "direct-url",
    ...suggestionResult,
    finalUrl: page.url()
  };
}

function aliHotelListDiagnosisPath(artifactDir: string | undefined) {
  return artifactDir ? path.join(artifactDir, "alibtrip-list-diagnosis.json") : "";
}

async function writeAliHotelListDiagnosis(
  artifactDir: string | undefined,
  traces: AliHotelKeywordTrace[],
  pathRecords: AliHotelPathRecord[] = []
) {
  if (!artifactDir) return;
  await fsp.mkdir(artifactDir, { recursive: true }).catch(() => undefined);
  await fsp.writeFile(
    aliHotelListDiagnosisPath(artifactDir),
    JSON.stringify({ selector: ALI_HOTEL_LIST_CARD_SELECTOR, pathRecords, traces }, null, 2),
    "utf8"
  ).catch(() => undefined);
}

function aliHotelKeywordScreenshotPath(
  artifactDir: string | undefined,
  keywordIndex: number,
  kind: "list" | "detail" | "selected-card" | "failure",
  candidateRank?: number
) {
  if (!artifactDir) return "";
  const rankSuffix = kind !== "list" && candidateRank ? `-${String(candidateRank).padStart(2, "0")}` : "";
  return path.join(artifactDir, `alibtrip-keyword-${String(keywordIndex).padStart(2, "0")}-${kind}${rankSuffix}.png`);
}

async function saveAliHotelViewportEvidence(page: BrowserPage, screenshotPath: string) {
  if (!screenshotPath) return undefined;
  await fsp.mkdir(path.dirname(screenshotPath), { recursive: true }).catch(() => undefined);
  try {
    await page.screenshot({ path: screenshotPath, timeout: 10_000 });
    if (await fileExistsWithContent(screenshotPath)) return screenshotPath;
  } catch {
    // Fall back to the normal evidence snapshot below.
  }

  return savePageEvidence(page, screenshotPath, {
    platform: "阿里商旅",
    finalUrl: page.url(),
    bodyText: await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "")
  }).catch(() => undefined);
}

async function saveAliHotelSelectedCandidateCardEvidence(
  page: BrowserPage,
  detailCandidate: AliHotelDetailCandidateTrace,
  screenshotPath: string
) {
  if (!screenshotPath) return undefined;
  await page.evaluate(`((targetText) => {
    const selector = ${JSON.stringify(ALI_HOTEL_LIST_CARD_SELECTOR)};
    const normalize = (value) => String(value || "").replace(/\\s+/g, "");
    const expected = normalize(targetText);
    const cards = Array.from(document.querySelectorAll(selector));
    const target = cards.find((card) => {
      const text = normalize(card.textContent || "");
      return text === expected || text.includes(expected) || (text.length > 20 && expected.includes(text));
    });
    target?.scrollIntoView?.({ block: "center" });
  })(${JSON.stringify(detailCandidate.cardText)})`).catch(() => undefined);
  await page.waitForTimeout(300).catch(() => undefined);
  return saveAliHotelViewportEvidence(page, screenshotPath);
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
  trace?: {
    keyword: string;
    keywordMode?: AliHotelSearchKeywordPlanItem["mode"];
    traces: AliHotelKeywordTrace[];
    artifactDir?: string;
    pathRecords?: AliHotelPathRecord[];
  },
  collectOptions: { maxScreens?: number; maxCards?: number; maxDurationMs?: number } = {}
) {
  const seenDetailPages = new Set(
    context.pages()
      .filter((candidatePage) => candidatePage.url().includes("hotel-demeter") && candidatePage.url().includes("#/detail"))
  );
  const keywordPathRecords: AliHotelPathRecord[] = [];
  const diagnosisPath = aliHotelListDiagnosisPath(trace?.artifactDir) || undefined;
  const appendKeywordRecord = (input: Parameters<typeof appendAliHotelPathRecord>[1]) => {
    const record = appendAliHotelPathRecord(keywordPathRecords, input);
    trace?.pathRecords?.push(record);
    return record;
  };

  const readCardsStartedAt = Date.now();
  const selection = await collectAliHotelListCardsForMatching(page, candidate, query.city, collectOptions);
  appendKeywordRecord({
    step: "read-candidate-cards",
    status: "completed",
    startedAtMs: readCardsStartedAt,
    keyword: trace?.keyword,
    keywordMode: trace?.keywordMode,
    finalUrl: page.url(),
    diagnosisPath,
    details: {
      cardCount: selection.cardCount,
      screensRead: selection.screensRead,
      maxScreens: selection.maxScreens,
      maxCards: selection.maxCards,
      foundExactNameCard: selection.foundExactNameCard,
      cards: selection.cards.map((card) => ({
        index: card.index,
        screenIndex: card.screenIndex,
        text: card.text,
        matchReason: card.match.reason
      }))
    }
  });
  const keywordIndex = trace ? trace.traces.length + 1 : 0;
  const listScreenshotPath = aliHotelKeywordScreenshotPath(trace?.artifactDir, keywordIndex, "list");
  const listScreenshotStartedAt = Date.now();
  let savedListScreenshotPath: string | undefined;
  if (listScreenshotPath) {
    savedListScreenshotPath = await savePageEvidence(page, listScreenshotPath, {
      platform: "阿里商旅",
      finalUrl: page.url(),
      bodyText: await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "")
    }).catch(() => undefined);
  }
  appendKeywordRecord({
    step: "save-search-result-screenshot",
    status: savedListScreenshotPath ? "completed" : "skipped",
    startedAtMs: listScreenshotStartedAt,
    keyword: trace?.keyword,
    keywordMode: trace?.keywordMode,
    finalUrl: page.url(),
    screenshotPath: savedListScreenshotPath,
    diagnosisPath
  });
  const rankStartedAt = Date.now();
  appendKeywordRecord({
    step: "rank-candidates",
    status: selection.detailCandidates.length > 0 ? "completed" : "failed",
    startedAtMs: rankStartedAt,
    keyword: trace?.keyword,
    keywordMode: trace?.keywordMode,
    finalUrl: page.url(),
    diagnosisPath,
    failureReason: selection.detailCandidates.length > 0 ? undefined : selection.failureReason,
    details: {
      detailCandidates: selection.detailCandidates.map((item) => ({
        rank: item.rank,
        cardIndex: item.cardIndex,
        screenIndex: item.screenIndex,
        cardText: item.cardText,
        matchScore: item.matchScore,
        listMatchReason: item.listMatchReason
      }))
    }
  });
  const keywordTrace: AliHotelKeywordTrace | null = trace ? {
    ...selection,
    keyword: trace.keyword,
    keywordMode: trace.keywordMode,
    brandFallback: trace.keywordMode === "brand-fallback",
    finalUrl: page.url(),
    listScreenshotPath: savedListScreenshotPath || undefined,
    selectedAsCandidate: selection.detailCandidates.length > 0,
    clickedDetail: false,
    pathRecords: keywordPathRecords
  } : null;
  if (trace && keywordTrace) {
    trace.traces.push(keywordTrace);
    await writeAliHotelListDiagnosis(trace.artifactDir, trace.traces, trace.pathRecords);
  }

  if (selection.detailCandidates.length === 0) {
    const failureReason = selection.failureReason || `阿里商旅未找到同城市同门牌号候选：${candidate.hotelName}`;
    const failureStartedAt = Date.now();
    const failureScreenshotPath = await savePageEvidence(page, aliHotelKeywordScreenshotPath(trace?.artifactDir, keywordIndex, "failure"), {
      platform: "阿里商旅",
      finalUrl: page.url(),
      bodyText: await page.locator("body").innerText({ timeout: 3_000 }).catch(() => ""),
      error: failureReason
    }).catch(() => undefined);
    appendKeywordRecord({
      step: "save-failure-screenshot",
      status: failureScreenshotPath ? "completed" : "failed",
      startedAtMs: failureStartedAt,
      keyword: trace?.keyword,
      keywordMode: trace?.keywordMode,
      finalUrl: page.url(),
      screenshotPath: failureScreenshotPath,
      diagnosisPath,
      failureReason
    });
    if (keywordTrace) keywordTrace.failureScreenshotPath = failureScreenshotPath;
    if (trace) await writeAliHotelListDiagnosis(trace.artifactDir, trace.traces, trace.pathRecords);
    throw new Error(failureReason);
  }

  for (const detailCandidate of selection.detailCandidates) {
    const matchedCard = selection.cards.find((card) => card.index === detailCandidate.cardIndex && card.text === detailCandidate.cardText) ?? null;
    if (!matchedCard) {
      detailCandidate.failureReason = "阿里候选卡片已消失，无法点击详情";
      const failureScreenshotPath = await savePageEvidence(page, aliHotelKeywordScreenshotPath(trace?.artifactDir, keywordIndex, "failure", detailCandidate.rank), {
        platform: "阿里商旅",
        finalUrl: page.url(),
        bodyText: await page.locator("body").innerText({ timeout: 3_000 }).catch(() => ""),
        error: detailCandidate.failureReason
      }).catch(() => undefined);
      detailCandidate.failureScreenshotPath = failureScreenshotPath;
      const missingCardRecord = appendKeywordRecord({
        step: "click-candidate",
        status: "failed",
        startedAtMs: Date.now(),
        keyword: trace?.keyword,
        keywordMode: trace?.keywordMode,
        finalUrl: page.url(),
        screenshotPath: failureScreenshotPath,
        diagnosisPath,
        candidateRank: detailCandidate.rank,
        candidateCardIndex: detailCandidate.cardIndex,
        candidateCardText: detailCandidate.cardText,
        failureReason: detailCandidate.failureReason
      });
      detailCandidate.pathRecords = [...(detailCandidate.pathRecords ?? []), missingCardRecord];
      continue;
    }

    const selectedCardStartedAt = Date.now();
    const selectedCardScreenshotPath = await saveAliHotelSelectedCandidateCardEvidence(
      page,
      detailCandidate,
      aliHotelKeywordScreenshotPath(trace?.artifactDir, keywordIndex, "selected-card", detailCandidate.rank)
    );
    detailCandidate.selectedCardScreenshotPath = selectedCardScreenshotPath;
    const selectedCardRecord = appendKeywordRecord({
      step: "save-selected-candidate-screenshot",
      status: selectedCardScreenshotPath ? "completed" : "failed",
      startedAtMs: selectedCardStartedAt,
      keyword: trace?.keyword,
      keywordMode: trace?.keywordMode,
      finalUrl: page.url(),
      screenshotPath: selectedCardScreenshotPath,
      diagnosisPath,
      candidateRank: detailCandidate.rank,
      candidateCardIndex: detailCandidate.cardIndex,
      candidateCardText: detailCandidate.cardText,
      selectedCandidate: true
    });
    detailCandidate.pathRecords = [...(detailCandidate.pathRecords ?? []), selectedCardRecord];

    const clickStartedAt = Date.now();
    const clicked = await clickAliHotelDetailCandidateCard(page, detailCandidate);
    if (!clicked) {
      detailCandidate.failureReason = "阿里候选卡片已消失，无法点击详情";
      const failureScreenshotPath = await savePageEvidence(page, aliHotelKeywordScreenshotPath(trace?.artifactDir, keywordIndex, "failure", detailCandidate.rank), {
        platform: "阿里商旅",
        finalUrl: page.url(),
        bodyText: await page.locator("body").innerText({ timeout: 3_000 }).catch(() => ""),
        error: detailCandidate.failureReason
      }).catch(() => undefined);
      detailCandidate.failureScreenshotPath = failureScreenshotPath;
      const clickRecord = appendKeywordRecord({
        step: "click-candidate",
        status: "failed",
        startedAtMs: clickStartedAt,
        keyword: trace?.keyword,
        keywordMode: trace?.keywordMode,
        finalUrl: page.url(),
        screenshotPath: failureScreenshotPath,
        diagnosisPath,
        candidateRank: detailCandidate.rank,
        candidateCardIndex: detailCandidate.cardIndex,
        candidateCardText: detailCandidate.cardText,
        selectedCandidate: true,
        failureReason: detailCandidate.failureReason
      });
      detailCandidate.pathRecords = [...(detailCandidate.pathRecords ?? []), clickRecord];
      if (trace) await writeAliHotelListDiagnosis(trace.artifactDir, trace.traces, trace.pathRecords);
      continue;
    }
    detailCandidate.clickedDetail = true;
    const clickRecord = appendKeywordRecord({
      step: "click-candidate",
      status: "completed",
      startedAtMs: clickStartedAt,
      keyword: trace?.keyword,
      keywordMode: trace?.keywordMode,
      finalUrl: page.url(),
      screenshotPath: selectedCardScreenshotPath,
      diagnosisPath,
      candidateRank: detailCandidate.rank,
      candidateCardIndex: detailCandidate.cardIndex,
      candidateCardText: detailCandidate.cardText,
      selectedCandidate: true
    });
    detailCandidate.pathRecords = [...(detailCandidate.pathRecords ?? []), clickRecord];
    if (trace && keywordTrace) {
      keywordTrace.clickedDetail = true;
      await writeAliHotelListDiagnosis(trace.artifactDir, trace.traces, trace.pathRecords);
    }

    let openedDetailPage: BrowserPage | null = null;
    let openedDetailText = "";
    const waitDetailStartedAt = Date.now();
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
      const failureScreenshotPath = await savePageEvidence(page, aliHotelKeywordScreenshotPath(trace?.artifactDir, keywordIndex, "failure", detailCandidate.rank), {
        platform: "阿里商旅",
        finalUrl: page.url(),
        bodyText: await page.locator("body").innerText({ timeout: 3_000 }).catch(() => ""),
        error: detailCandidate.failureReason
      }).catch(() => undefined);
      detailCandidate.failureScreenshotPath = failureScreenshotPath;
      const waitRecord = appendKeywordRecord({
        step: "wait-detail-page",
        status: "failed",
        startedAtMs: waitDetailStartedAt,
        keyword: trace?.keyword,
        keywordMode: trace?.keywordMode,
        finalUrl: page.url(),
        screenshotPath: failureScreenshotPath,
        diagnosisPath,
        candidateRank: detailCandidate.rank,
        candidateCardIndex: detailCandidate.cardIndex,
        candidateCardText: detailCandidate.cardText,
        selectedCandidate: true,
        failureReason: detailCandidate.failureReason
      });
      detailCandidate.pathRecords = [...(detailCandidate.pathRecords ?? []), waitRecord];
      if (trace) await writeAliHotelListDiagnosis(trace.artifactDir, trace.traces, trace.pathRecords);
      continue;
    }
    const waitRecord = appendKeywordRecord({
      step: "wait-detail-page",
      status: "completed",
      startedAtMs: waitDetailStartedAt,
      keyword: trace?.keyword,
      keywordMode: trace?.keywordMode,
      finalUrl: openedDetailPage.url(),
      diagnosisPath,
      candidateRank: detailCandidate.rank,
      candidateCardIndex: detailCandidate.cardIndex,
      candidateCardText: detailCandidate.cardText,
      selectedCandidate: true
    });
    detailCandidate.pathRecords = [...(detailCandidate.pathRecords ?? []), waitRecord];

    const readIdentityStartedAt = Date.now();
    openedDetailText = await waitForAliHotelDetailIdentityText(openedDetailPage, query, candidate, openedDetailText);
    const detail = confirmAliHotelDetailDoorPlate(query.city, candidate, openedDetailText);
    const detailHotelName = extractHotelNameFromPageText(openedDetailText, candidate.hotelName);
    const readIdentityRecord = appendKeywordRecord({
      step: "read-detail-identity",
      status: "completed",
      startedAtMs: readIdentityStartedAt,
      keyword: trace?.keyword,
      keywordMode: trace?.keywordMode,
      finalUrl: openedDetailPage.url(),
      diagnosisPath,
      candidateRank: detailCandidate.rank,
      candidateCardIndex: detailCandidate.cardIndex,
      candidateCardText: detailCandidate.cardText,
      selectedCandidate: true,
      detailHotelName,
      detailAddress: detail.detailAddress,
      extractedDoorNumber: detail.detailDoorNumber,
      details: {
        pageTextSummary: buildHotelPageTextSummary(openedDetailText)
      }
    });
    detailCandidate.pathRecords = [...(detailCandidate.pathRecords ?? []), readIdentityRecord];
    const detailScreenshotPath = aliHotelKeywordScreenshotPath(trace?.artifactDir, keywordIndex, "detail", detailCandidate.rank);
    const detailScreenshotStartedAt = Date.now();
    let savedDetailScreenshotPath: string | undefined;
    if (detailScreenshotPath) {
      savedDetailScreenshotPath = await savePageEvidence(openedDetailPage, detailScreenshotPath, {
        platform: "阿里商旅",
        finalUrl: openedDetailPage.url(),
        bodyText: openedDetailText
      }).catch(() => undefined);
      detailCandidate.detailScreenshotPath = savedDetailScreenshotPath;
    }
    const detailScreenshotRecord = appendKeywordRecord({
      step: "save-detail-screenshot",
      status: savedDetailScreenshotPath ? "completed" : "failed",
      startedAtMs: detailScreenshotStartedAt,
      keyword: trace?.keyword,
      keywordMode: trace?.keywordMode,
      finalUrl: openedDetailPage.url(),
      screenshotPath: savedDetailScreenshotPath,
      diagnosisPath,
      candidateRank: detailCandidate.rank,
      candidateCardIndex: detailCandidate.cardIndex,
      candidateCardText: detailCandidate.cardText,
      selectedCandidate: true
    });
    detailCandidate.pathRecords = [...(detailCandidate.pathRecords ?? []), detailScreenshotRecord];
    applyAliHotelDetailDiagnosisToCandidateTrace(detailCandidate, openedDetailPage.url(), detail);
    const confirmRecord = appendKeywordRecord({
      step: "confirm-same-hotel",
      status: detail.sameHotel ? "completed" : "failed",
      startedAtMs: Date.now(),
      keyword: trace?.keyword,
      keywordMode: trace?.keywordMode,
      finalUrl: openedDetailPage.url(),
      screenshotPath: savedDetailScreenshotPath,
      diagnosisPath,
      candidateRank: detailCandidate.rank,
      candidateCardIndex: detailCandidate.cardIndex,
      candidateCardText: detailCandidate.cardText,
      selectedCandidate: true,
      detailHotelName,
      detailAddress: detail.detailAddress,
      extractedDoorNumber: detail.detailDoorNumber,
      sameHotel: detail.sameHotel,
      matchBasis: detail.matchBasis,
      failureReason: detail.failureReason
    });
    detailCandidate.pathRecords = [...(detailCandidate.pathRecords ?? []), confirmRecord];
    if (trace && keywordTrace) {
      keywordTrace.finalUrl = openedDetailPage.url();
      keywordTrace.detailScreenshotPath = detailCandidate.detailScreenshotPath;
      applyAliHotelDetailDiagnosisToTrace(keywordTrace, openedDetailPage.url(), detail);
      await writeAliHotelListDiagnosis(trace.artifactDir, trace.traces, trace.pathRecords);
    }

    if (detail.sameHotel) {
      return { detailPage: openedDetailPage, listMatch: matchedCard.match, keywordTrace };
    }

    await openedDetailPage.close?.({ runBeforeUnload: false }).catch(() => undefined);
  }

  const failureReason = formatAliHotelDetailCandidateFailure(selection.detailCandidates);
  const failureStartedAt = Date.now();
  const failureScreenshotPath = await savePageEvidence(page, aliHotelKeywordScreenshotPath(trace?.artifactDir, keywordIndex, "failure"), {
    platform: "阿里商旅",
    finalUrl: page.url(),
    bodyText: await page.locator("body").innerText({ timeout: 3_000 }).catch(() => ""),
    error: failureReason
  }).catch(() => undefined);
  appendKeywordRecord({
    step: "save-failure-screenshot",
    status: failureScreenshotPath ? "completed" : "failed",
    startedAtMs: failureStartedAt,
    keyword: trace?.keyword,
    keywordMode: trace?.keywordMode,
    finalUrl: page.url(),
    screenshotPath: failureScreenshotPath,
    diagnosisPath,
    failureReason
  });
  if (keywordTrace) keywordTrace.failureScreenshotPath = failureScreenshotPath;
  if (trace) await writeAliHotelListDiagnosis(trace.artifactDir, trace.traces, trace.pathRecords);
  throw new Error(failureReason);
}

export async function waitForAliHotelDetailIdentityText(
  page: BrowserPage,
  query: QingmaoHotelCandidateQuery,
  candidate: QingmaoHotelCandidate,
  initialText = ""
) {
  let bodyText = initialText;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const detail = confirmAliHotelDetailDoorPlate(query.city, candidate, bodyText);
    if (detail.detailDoorNumber) {
      return bodyText;
    }
    if (attempt >= 2) {
      await page.evaluate(`window.scrollBy(0, Math.max(500, Math.floor(window.innerHeight * 0.75)))`).catch(() => undefined);
    }
    await page.waitForTimeout(500);
    bodyText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => bodyText);
  }
  return bodyText;
}

interface AliHotelDetailRoomsRead {
  bodyText: string;
  stable: boolean;
  signature: string;
  expansionClicks: number;
}

async function readAliHotelDetailRooms(page: BrowserPage): Promise<AliHotelDetailRoomsRead> {
  let bodyText = "";
  let loaded = false;
  for (let attempt = 0; attempt < 35; attempt += 1) {
    bodyText = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
    if (/酒店详情|预订/.test(bodyText) && /早餐/.test(bodyText) && /[￥¥]\s*\d{2,5}/.test(bodyText)) {
      loaded = true;
      break;
    }
    await page.waitForTimeout(1_000);
  }

  if (!loaded) {
    throw new Error("阿里商旅酒店详情房型加载超时");
  }

  let bestBodyText = bodyText;
  let lastSignature = "";
  let stableRounds = 0;
  let expansionClicks = 0;

  for (let attempt = 0; attempt < 16; attempt += 1) {
    expansionClicks += Number(await expandAliHotelDetailOffers(page));
    await page.evaluate(`window.scrollBy(0, Math.max(600, Math.floor(window.innerHeight * 0.85)))`).catch(() => undefined);
    await page.waitForTimeout(700).catch(() => undefined);
    bodyText = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => bodyText);
    if (bodyText.length > bestBodyText.length) {
      bestBodyText = bodyText;
    }

    const signature = aliHotelDetailRateTextSignature(bodyText);
    if (signature === lastSignature && signature !== "0:0:0") {
      stableRounds += 1;
    } else {
      stableRounds = 0;
    }
    lastSignature = signature;

    if (stableRounds >= 2) {
      return {
        bodyText,
        stable: true,
        signature,
        expansionClicks
      };
    }
  }

  return {
    bodyText: bestBodyText,
    stable: false,
    signature: aliHotelDetailRateTextSignature(bestBodyText),
    expansionClicks
  };
}

async function waitForAliHotelDetailRooms(page: BrowserPage) {
  return (await readAliHotelDetailRooms(page)).bodyText;
}

async function expandAliHotelDetailOffers(page: BrowserPage): Promise<number> {
  const result = await page.evaluate(`(() => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const labels = /加载更多报价|更多报价|更多价格|查看其他更多价格|展开更多|展开报价/;
    let clicked = 0;
    for (const element of Array.from(document.querySelectorAll("button,a,div,span"))) {
      const text = (element.textContent || "").replace(/\\s+/g, " ").trim();
      if (!text || text.length > 40 || !labels.test(text) || !isVisible(element)) continue;
      try {
        element.scrollIntoView?.({ block: "center" });
        element.click?.();
        clicked += 1;
      } catch {}
    }
    return clicked;
  })()`).catch(() => 0);
  return typeof result === "number" ? result : 0;
}

function aliHotelDetailRateTextSignature(rawText: string) {
  const compact = rawText.replace(/\s+/g, " ").trim();
  const priceCount = Array.from(compact.matchAll(/[￥¥]\s*\d{2,5}/g)).length;
  const breakfastCount = Array.from(compact.matchAll(/含早餐|含早|1份早餐|单份早餐|单早|2份早餐|双份早餐|双早|无早餐|无早|不含早|无餐食/g)).length;
  return `${breakfastCount}:${priceCount}:${compact.length}`;
}

async function scrollAliHotelDetailToRateEvidence(page: BrowserPage, ratePlan: HotelRatePlanLabel) {
  const bedType = hotelRatePlanBedType(ratePlan);
  const breakfast = hotelRatePlanBreakfast(ratePlan);
  await page.evaluate(`((bedType, breakfast) => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const hasBreakfast = (text) => breakfast === "有早餐"
      ? /含早餐|含早|1份早餐|2份早餐|单早|双早/.test(text)
      : /无早餐|无早|无餐食|不含早/.test(text);
    const candidates = Array.from(document.querySelectorAll("div,li,section,article,tr"))
      .filter((element) => {
        if (!isVisible(element)) return false;
        const text = (element.textContent || "").replace(/\\s+/g, " ").trim();
        if (!text || text.length > 500) return false;
        if (!/[￥¥]\\s*\\d{2,5}/.test(text)) return false;
        if (bedType === "大床" && !/大床|双人床|1张[^ ]*大床/.test(text)) return false;
        if (bedType === "双床" && !/双床|2张|两张/.test(text)) return false;
        return hasBreakfast(text);
      });
    const target = candidates[0] || Array.from(document.querySelectorAll("div,li,section,article,tr"))
      .find((element) => isVisible(element) && /[￥¥]\\s*\\d{2,5}/.test((element.textContent || "")));
    target?.scrollIntoView?.({ block: "center" });
  })(${JSON.stringify(bedType)}, ${JSON.stringify(breakfast)})`).catch(() => undefined);
  await page.waitForTimeout(700).catch(() => undefined);
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
  const aliKeywordTraces: AliHotelKeywordTrace[] = [];
  const diagnosisPath = path.join(artifactDir, "alibtrip-list-diagnosis.json");
  let detailPage: BrowserPage | null = null;
  let bodyText = "";
  let detailRoomsRead: AliHotelDetailRoomsRead | null = null;

  try {
    await page.goto("https://travel.alibtrip.com/index.html#/hotel", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(3_000);
    let lastError = "";
    for (const keywordPlan of buildAliHotelSearchKeywordPlan(query, candidate)) {
      try {
        await openAliHotelList(context, page, query, keywordPlan.keyword, candidate);
        const aliSelection = await clickMatchingAliHotelCard(context, page, query, candidate, {
          keyword: keywordPlan.keyword,
          keywordMode: keywordPlan.mode,
          traces: aliKeywordTraces,
          artifactDir
        }, keywordPlan);
        detailPage = aliSelection.detailPage;
        detailRoomsRead = await readAliHotelDetailRooms(detailPage);
        bodyText = detailRoomsRead.bodyText;
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
        detailRoomsRead = null;
      }
    }
    if (lastError) {
      throw new Error(lastError);
    }
    if (!detailPage) {
      throw new Error("阿里商旅同酒店详情页未打开");
    }

    const rates = parseAliHotelMainRatesText(bodyText, ratePlan);
    const selectedRate = selectLowestHotelMainRateQuote(rates);
    const excludedRows = extractExcludedHotelRateRowsFromText("阿里商旅", bodyText);
    const ratePlanDiagnosticText = buildAliHotelRatePlanDiagnosticText(bodyText, ratePlan);
    const fallbackRawText = ratePlanDiagnosticText || excludedRows[0]?.rawText;
    const screenshotPath = path.join(artifactDir, hotelRatePlanEvidenceName("阿里商旅", ratePlan));
    await scrollAliHotelDetailToRateEvidence(detailPage, ratePlan);
    const evidencePath = await savePageEvidence(detailPage, screenshotPath, {
      platform: "阿里商旅",
      finalUrl: detailPage.url(),
      bodyText,
      price: selectedRate?.price ?? null,
      rawText: selectedRate?.rawText ?? fallbackRawText
    });

    if (!selectedRate) {
      const status = detailRoomsRead?.stable ? "platform-no-rate" : "parser-suspected-failed";
      const sidecarPath = screenshotPath.replace(/\.[^.]+$/, ".html");
      await writeEvidenceSnapshotHtml(sidecarPath, {
        platform: "阿里商旅",
        finalUrl: detailPage.url(),
        bodyText,
        price: null,
        rawText: fallbackRawText,
        error: status === "platform-no-rate"
          ? `阿里商旅完整展开后未找到${ratePlan}价格`
          : `阿里商旅报价区未稳定，未能确认${ratePlan}价格`
      }).catch(() => undefined);
      return {
        platform: "阿里商旅",
        status,
        price: null,
        hotelName: candidate.hotelName,
        roomType: "",
        ratePlan,
        finalUrl: detailPage.url(),
        screenshotPath: evidencePath,
        diagnosisPath: sidecarPath,
        durationMs: Date.now() - startedAt,
        rawText: fallbackRawText,
        error: excludedRows.length
          ? `阿里商旅${ratePlan}价格行已过滤：${excludedRows.map((row) => row.reason).join("、")}`
          : status === "platform-no-rate"
            ? `阿里商旅完整展开后未找到${ratePlan}价格`
            : `阿里商旅报价区未稳定，未能确认${ratePlan}价格`
      };
    }

    return {
      ...selectedRate,
      finalUrl: detailPage.url(),
      screenshotPath: evidencePath,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    await writeAliHotelListDiagnosis(artifactDir, aliKeywordTraces);
    const evidencePage = detailPage ?? page;
    const evidenceBodyText = bodyText || await evidencePage.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
    const screenshotPath = path.join(artifactDir, hotelRatePlanEvidenceName("阿里商旅", ratePlan));
    if (detailPage) await scrollAliHotelDetailToRateEvidence(detailPage, ratePlan);
    const evidencePath = await savePageEvidence(evidencePage, screenshotPath, {
      platform: "阿里商旅",
      finalUrl: evidencePage.url(),
      bodyText: evidenceBodyText,
      error: errorMessage(error)
    }).catch(() => undefined);
    return buildFailedAliHotelMainRateQuote({
      candidate,
      ratePlan,
      error: errorMessage(error),
      durationMs: Date.now() - startedAt,
      finalUrl: evidencePage.url(),
      screenshotPath: evidencePath,
      diagnosisPath
    });
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
    await openZtripHotelSearchResultByHotel(page, query, candidate);
    const detailIdentityText = await page.locator("body").innerText({ timeout: 8_000 }).catch(() => "");
    assertCompetitorHotelDetailSameByDoorPlate("在途商旅", {
      city: query.city,
      keyword: candidate.hotelName,
      checkInDate: query.checkInDate,
      checkOutDate: query.checkOutDate,
      nights: query.nights
    }, candidate, detailIdentityText);
    await filterZtripHotelRatePlan(page, ratePlan);
    await expandZtripRoomCards(page, ratePlan);
    const bodyText = await page.locator("body").innerText({ timeout: 8_000 }).catch(() => detailIdentityText);
    const rates = parseZtripHotelRatesTextForRatePlan(bodyText, ratePlan);
    const selectedRate = selectZtripHotelRateForRatePlan(rates, ratePlan);
    const excludedRows = extractExcludedHotelRateRowsFromText("在途商旅", bodyText);
    const screenshotPath = path.join(artifactDir, hotelRatePlanEvidenceName("在途商旅", ratePlan));
    const evidencePath = await savePageEvidence(page, screenshotPath, {
      platform: "在途商旅",
      finalUrl: page.url(),
      bodyText,
      price: selectedRate?.price ?? null,
      rawText: selectedRate?.rawText ?? excludedRows[0]?.rawText
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
        rawText: excludedRows[0]?.rawText,
        error: excludedRows.length
          ? `在途商旅${ratePlan}价格行已过滤：${excludedRows.map((row) => row.reason).join("、")}`
          : `在途商旅同酒店详情页未解析到${ratePlan}价格`
      };
    }

    return {
      ...buildZtripHotelMainRateQuote(selectedRate, page, evidencePath, candidate, ratePlan),
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    const bodyText = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
    const screenshotPath = path.join(artifactDir, `在途商旅-酒店失败-${safeFilename(ratePlan)}.png`);
    const evidencePath = await savePageEvidence(page, screenshotPath, {
      platform: "在途商旅",
      finalUrl: page.url(),
      bodyText,
      error: errorMessage(error)
    }).catch(() => undefined);
    if (shouldDowngradeZtripRatePlanFilterFailure(error)) {
      return {
        platform: "在途商旅",
        status: "not-found",
        price: null,
        hotelName: candidate.hotelName,
        roomType: "",
        ratePlan,
        finalUrl: page.url(),
        screenshotPath: evidencePath,
        rawText: bodyText,
        durationMs: Date.now() - startedAt,
        error: `${errorMessage(error)}，按${ratePlan}记为暂无`
      };
    }
    return {
      ...buildFailedHotelQuote("在途商旅", errorMessage(error), candidate, ratePlan),
      finalUrl: page.url(),
      screenshotPath: evidencePath,
      rawText: bodyText,
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

function hotelSingleAllRatePlansQueryFromInput(input: HotelSingleAllRatePlansInput): QingmaoHotelCandidateQuery {
  return hotelSingleDiagnosisQueryFromInput({
    ...input,
    ratePlan: HOTEL_CALIBRATION_MAIN_RATE_PLAN
  });
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
  if (/门牌|同店命中失败|未匹配同店|未匹配到同城市同门牌号|不是同一家/.test(reason)) return "competitor_no_same_hotel";
  if (/报价区未稳定|解析不可靠|未能确认/.test(reason)) return "parser_suspected_failed";
  if (/在途商旅酒店未找到筛选项/.test(reason)) return "competitor_no_main_rate";
  if (/完整展开后未找到/.test(reason)) return "competitor_no_main_rate";
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
  const ratePrices = HOTEL_RATE_PLAN_LABELS.reduce((prices, ratePlan) => ({
    ...prices,
    [ratePlan]: priceFor(ratePlan)
  }), emptyHotelCalibrationRatePrices());

  return {
    mainRatePrice: ratePrices[HOTEL_CALIBRATION_MAIN_RATE_PLAN],
    otherRates: HOTEL_CALIBRATION_OTHER_RATE_PLANS.reduce((rates, ratePlan) => ({
      ...rates,
      [ratePlan]: ratePrices[ratePlan]
    }), emptyHotelCalibrationOtherRates()),
    ratePrices
  };
}

function hotelCalibrationRatesFromRatePrices(ratePrices: HotelCalibrationRatePrices) {
  return {
    mainRatePrice: ratePrices[HOTEL_CALIBRATION_MAIN_RATE_PLAN],
    otherRates: HOTEL_CALIBRATION_OTHER_RATE_PLANS.reduce((rates, ratePlan) => ({
      ...rates,
      [ratePlan]: ratePrices[ratePlan]
    }), emptyHotelCalibrationOtherRates()),
    ratePrices
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
  diagnosisPath?: string;
  pathRecords?: AliHotelPathRecord[];
  failureReason?: string;
  failureType?: HotelCalibrationFailureType | null;
  ratePricesOverride?: HotelCalibrationRatePrices;
}): HotelCalibrationPlatformResult {
  const targetDoorPlate = extractHotelDoorPlate(input.rawText);
  const rates = input.sameHotel === false
    ? { mainRatePrice: null, otherRates: emptyHotelCalibrationOtherRates(), ratePrices: emptyHotelCalibrationRatePrices() }
    : input.ratePricesOverride
      ? hotelCalibrationRatesFromRatePrices(input.ratePricesOverride)
    : readHotelCalibrationRatesFromText(input.platform, input.rawText);
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
    ratePrices: rates.ratePrices,
    durationMs: Date.now() - input.startedAt,
    failureType,
    failureReason,
    screenshotPath: input.screenshotPath,
    diagnosisPath: input.diagnosisPath,
    finalUrl: input.finalUrl,
    pathRecords: input.pathRecords,
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
    const selectedRate = selectLowestHotelMainRateQuote(rates);
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
    const selectedRate = selectLowestHotelMainRateQuote(rates);
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
        const selectedRate = selectLowestHotelMainRateQuote(rates);
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
    await openZtripHotelSearchResultByHotel(page, buildZtripHotelQueryFromQingmao(query), candidate);
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
    await expandZtripRoomCards(page, ratePlan);
    bodyText = await page.locator("body").innerText({ timeout: 8_000 }).catch(() => "");
    const rates = parseZtripHotelRatesTextForRatePlan(bodyText, ratePlan);
    const selectedRate = selectZtripHotelRateForRatePlan(rates, ratePlan);
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

async function diagnoseQingmaoHotelSingleAllRatePlans(
  qingmaoPage: BrowserPage,
  artifactDir: string,
  query: QingmaoHotelCandidateQuery
): Promise<{ candidate: QingmaoHotelCandidate; result: HotelCalibrationPlatformResult }> {
  const platform: PlatformName = "青猫差旅";
  const startedAt = Date.now();
  let candidate: QingmaoHotelCandidate | null = null;
  let qingmaoFrame: BrowserFrame | null = null;
  let bodyText = "";
  let screenshotPath: string | undefined;

  try {
    const listFrame = await searchQingmaoHotelCandidates(qingmaoPage, query);
    const listText = await listFrame.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
    const candidates = parseQingmaoHotelCandidatesText(listText);
    candidate = selectLockedQingmaoHotelCandidate(candidates, query);
    const candidateIndex = Math.max(0, candidates.findIndex((item) =>
      item.hotelName === candidate?.hotelName && item.address === candidate?.address
    ));

    await clickQingmaoHotelCandidateDetail(listFrame, candidate, candidateIndex);
    qingmaoFrame = await waitForQingmaoHotelDetailFrame(qingmaoPage, candidate.hotelName);
    bodyText = await waitForQingmaoHotelDetailText(qingmaoFrame, candidate.hotelName);
    const rates = readHotelCalibrationRatesFromText(platform, bodyText);
    const hasAnyRate = HOTEL_RATE_PLAN_LABELS.some((ratePlan) => typeof rates.ratePrices[ratePlan] === "number");
    screenshotPath = await saveHotelSingleDiagnosisEvidence(qingmaoPage, artifactDir, platform, {
      platform,
      finalUrl: qingmaoFrame.url(),
      bodyText,
      price: rates.mainRatePrice
    });
    const failureReason = hasAnyRate ? "" : "青猫差旅未找到四口径可订价格";

    return {
      candidate,
      result: buildHotelCalibrationPlatformResult({
        platform,
        startedAt,
        sameHotel: true,
        matchBasis: "青猫候选源酒店",
        sourceAddress: candidate.address,
        rawText: bodyText,
        fallbackHotelName: candidate.hotelName,
        screenshotPath,
        finalUrl: qingmaoFrame.url(),
        failureReason,
        failureType: failureReason ? "competitor_no_main_rate" : null
      })
    };
  } catch (error) {
    if (!candidate) {
      throw error;
    }
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
  const pathRecords: AliHotelPathRecord[] = [];
  const diagnosisPath = aliHotelListDiagnosisPath(artifactDir);

  try {
    const openHomeStartedAt = Date.now();
    await page.goto("https://travel.alibtrip.com/index.html#/hotel", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(3_000);
    appendAliHotelPathRecord(pathRecords, {
      step: "open-hotel-home",
      status: "completed",
      startedAtMs: openHomeStartedAt,
      finalUrl: page.url(),
      diagnosisPath
    });
    await writeAliHotelListDiagnosis(artifactDir, aliKeywordTraces, pathRecords);
    for (const keywordPlan of buildAliHotelSearchKeywordPlan(query, candidate)) {
      const keywordAttemptStartedAt = Date.now();
      try {
        const openListStartedAt = Date.now();
        const openResult = await openAliHotelList(context, page, query, keywordPlan.keyword, candidate);
        appendAliHotelPathRecord(pathRecords, {
          step: "select-search-suggestion",
          status: openResult.suggestionSelected ? "completed" : openResult.suggestionAttempted ? "skipped" : "skipped",
          startedAtMs: openListStartedAt,
          keyword: keywordPlan.keyword,
          keywordMode: keywordPlan.mode,
          finalUrl: openResult.finalUrl,
          diagnosisPath,
          failureReason: openResult.suggestionSelected ? "" : openResult.suggestionFailureReason,
          details: {
            source: openResult.source,
            selectedSuggestionText: openResult.selectedSuggestionText
          }
        });
        appendAliHotelPathRecord(pathRecords, {
          step: "open-search-result",
          status: "completed",
          startedAtMs: openListStartedAt,
          keyword: keywordPlan.keyword,
          keywordMode: keywordPlan.mode,
          finalUrl: page.url(),
          diagnosisPath
        });
        const aliSelection = await clickMatchingAliHotelCard(context, page, query, candidate, {
          keyword: keywordPlan.keyword,
          keywordMode: keywordPlan.mode,
          traces: aliKeywordTraces,
          artifactDir,
          pathRecords
        }, keywordPlan);
        detailPage = aliSelection.detailPage;
        const mainRateStartedAt = Date.now();
        bodyText = await waitForAliHotelDetailRooms(detailPage);
        const match = confirmAliHotelDetailDoorPlate(query.city, candidate, bodyText);
        if (aliSelection.keywordTrace) {
          applyAliHotelDetailDiagnosisToTrace(aliSelection.keywordTrace, detailPage.url(), match);
          await writeAliHotelListDiagnosis(artifactDir, aliKeywordTraces, pathRecords);
        }
        if (!match.sameHotel) {
          lastError = match.failureReason || match.matchBasis;
          appendAliHotelPathRecord(pathRecords, {
            step: "confirm-same-hotel",
            status: "failed",
            startedAtMs: mainRateStartedAt,
            keyword: keywordPlan.keyword,
            keywordMode: keywordPlan.mode,
            finalUrl: detailPage.url(),
            diagnosisPath,
            detailHotelName: extractHotelNameFromPageText(bodyText, candidate.hotelName),
            detailAddress: match.detailAddress,
            extractedDoorNumber: match.detailDoorNumber,
            sameHotel: false,
            matchBasis: match.matchBasis,
            failureReason: lastError
          });
          await writeAliHotelListDiagnosis(artifactDir, aliKeywordTraces, pathRecords);
          await detailPage.close?.({ runBeforeUnload: false }).catch(() => undefined);
          detailPage = null;
          continue;
        }

        const rates = readHotelCalibrationRatesFromText(platform, bodyText);
        appendAliHotelPathRecord(pathRecords, {
          step: "read-main-rate",
          status: rates.mainRatePrice === null ? "failed" : "completed",
          startedAtMs: mainRateStartedAt,
          keyword: keywordPlan.keyword,
          keywordMode: keywordPlan.mode,
          finalUrl: detailPage.url(),
          diagnosisPath,
          detailHotelName: extractHotelNameFromPageText(bodyText, candidate.hotelName),
          detailAddress: match.detailAddress,
          extractedDoorNumber: match.detailDoorNumber,
          sameHotel: true,
          matchBasis: match.matchBasis,
          ratePlan: HOTEL_CALIBRATION_MAIN_RATE_PLAN,
          price: rates.mainRatePrice,
          failureReason: rates.mainRatePrice === null ? `阿里商旅未找到${HOTEL_CALIBRATION_MAIN_RATE_PLAN}价格` : "",
          details: {
            otherRates: rates.otherRates,
            pageTextSummary: buildHotelPageTextSummary(bodyText)
          }
        });
        screenshotPath = await saveHotelSingleDiagnosisEvidence(detailPage, artifactDir, platform, {
          platform,
          finalUrl: detailPage.url(),
          bodyText,
          price: rates.mainRatePrice
        });
        appendAliHotelPathRecord(pathRecords, {
          step: "save-main-rate-screenshot",
          status: screenshotPath ? "completed" : "failed",
          startedAtMs: Date.now(),
          keyword: keywordPlan.keyword,
          keywordMode: keywordPlan.mode,
          finalUrl: detailPage.url(),
          screenshotPath,
          diagnosisPath,
          ratePlan: HOTEL_CALIBRATION_MAIN_RATE_PLAN,
          price: rates.mainRatePrice
        });
        await writeAliHotelListDiagnosis(artifactDir, aliKeywordTraces, pathRecords);
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
          diagnosisPath,
          pathRecords,
          failureReason,
          failureType: failureReason ? "competitor_no_main_rate" : null
        });
      } catch (error) {
        lastError = errorMessage(error);
        const failurePage = detailPage ?? page;
        const failureScreenshotPath = await savePageEvidence(failurePage, aliHotelKeywordScreenshotPath(artifactDir, Math.max(1, aliKeywordTraces.length), "failure"), {
          platform,
          finalUrl: failurePage.url(),
          bodyText: await failurePage.locator("body").innerText({ timeout: 3_000 }).catch(() => ""),
          error: lastError
        }).catch(() => undefined);
        appendAliHotelPathRecord(pathRecords, {
          step: "keyword-attempt",
          status: "failed",
          startedAtMs: keywordAttemptStartedAt,
          keyword: keywordPlan.keyword,
          keywordMode: keywordPlan.mode,
          finalUrl: failurePage.url(),
          screenshotPath: failureScreenshotPath,
          diagnosisPath,
          failureReason: lastError
        });
        await writeAliHotelListDiagnosis(artifactDir, aliKeywordTraces, pathRecords);
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
    appendAliHotelPathRecord(pathRecords, {
      step: "save-failure-screenshot",
      status: screenshotPath ? "completed" : "failed",
      startedAtMs: Date.now(),
      finalUrl: evidencePage.url(),
      screenshotPath,
      diagnosisPath,
      failureReason: errorMessage(error)
    });
    await writeAliHotelListDiagnosis(artifactDir, aliKeywordTraces, pathRecords);
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
      diagnosisPath,
      pathRecords,
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
    await openZtripHotelSearchResultByHotel(page, buildZtripHotelQueryFromQingmao(query), candidate);
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
    await expandZtripRoomCards(page, HOTEL_CALIBRATION_MAIN_RATE_PLAN);
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

async function readZtripSingleAllRatePlanPrices(page: BrowserPage) {
  const ratePrices = emptyHotelCalibrationRatePrices();
  const textSections: string[] = [];
  const summaries: string[] = [];

  for (const step of buildZtripSingleAllRatePlanReadSteps()) {
    try {
      await clearZtripHotelRatePlanFilters(page);
      await filterZtripHotelRatePlan(page, step.ratePlan);
      await expandZtripRoomCards(page, step.ratePlan);
      const ratePlanText = await page.locator("body").innerText({ timeout: 8_000 }).catch(() => "");
      const selectedRate = selectZtripHotelRateForRatePlan(parseZtripHotelRatesTextForRatePlan(ratePlanText, step.ratePlan), step.ratePlan);
      ratePrices[step.ratePlan] = selectedRate?.price ?? null;
      textSections.push(`【${step.ratePlan}】\n${ratePlanText}`);
      summaries.push(`${step.ratePlan}:${selectedRate?.price ?? "未找到"}`);
    } catch (error) {
      if (!shouldDowngradeZtripRatePlanFilterFailure(error)) {
        throw error;
      }
      const ratePlanText = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
      ratePrices[step.ratePlan] = null;
      textSections.push(`【${step.ratePlan}】\n${ratePlanText}\n${errorMessage(error)}，按${step.ratePlan}记为暂无`);
      summaries.push(`${step.ratePlan}:暂无(${errorMessage(error)})`);
    }
  }

  return {
    ratePrices,
    rawText: textSections.join("\n\n"),
    summary: summaries.join("；")
  };
}

async function diagnoseZtripHotelSingleAllRatePlans(
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
    await openZtripHotelSearchResultByHotel(page, buildZtripHotelQueryFromQingmao(query), candidate);
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

    const ratePlanRead = await readZtripSingleAllRatePlanPrices(page);
    bodyText = ratePlanRead.rawText;
    const hasAnyRate = HOTEL_RATE_PLAN_LABELS.some((ratePlan) => typeof ratePlanRead.ratePrices[ratePlan] === "number");
    screenshotPath = await saveHotelSingleDiagnosisEvidence(page, artifactDir, platform, {
      platform,
      finalUrl: page.url(),
      bodyText,
      price: ratePlanRead.ratePrices[HOTEL_CALIBRATION_MAIN_RATE_PLAN]
    });
    const failureReason = hasAnyRate ? "" : `在途商旅未找到四口径可订价格：${ratePlanRead.summary}`;

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
      failureType: failureReason ? "competitor_no_main_rate" : null,
      ratePricesOverride: ratePlanRead.ratePrices
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
  onProgress?: (message: string) => void,
  shouldSkipCandidate?: (candidate: QingmaoHotelCandidate) => string | null,
  runOptions: { stopOnFirstCompetitorFailure?: boolean; competitorOrder?: PlatformName[] } = {}
): Promise<{ status: "completed" | "partial"; selectedCandidate: QingmaoHotelCandidate; quotes: HotelMainRateQuote[]; message: string; skipped: string[]; attemptsUsed: number; failurePlatform?: PlatformName }> {
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
  let failurePlatform: PlatformName | undefined;
  const skipped: string[] = [];
  let attemptsUsed = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const listFrame = await searchQingmaoHotelCandidates(qingmaoPage, query);
    const candidates = await collectQingmaoHotelCandidatesFromFrame(listFrame);
    const candidate = candidates[attempt];
    if (!candidate) {
      onProgress?.(`青猫候选不足：只找到 ${candidates.length} 家`);
      break;
    }
    attemptsUsed += 1;
    onProgress?.(`尝试第 ${attempt + 1}/${maxAttempts} 家：${candidate.hotelName}`);
    if (!isHotelCandidateRelevantForQuery(candidate, query)) {
      skipped.push(`${candidate.hotelName}: 不属于${query.keyword}候选`);
      continue;
    }
    if (!candidate.price || candidate.price <= 0) {
      skipped.push(`${candidate.hotelName}: 候选起价为空`);
      continue;
    }
    const stabilityFailure = qingmaoSourceCandidateStabilityFailure(candidate);
    if (stabilityFailure) {
      skipped.push(`${candidate.hotelName}: ${stabilityFailure}`);
      continue;
    }
    const samplingSkipReason = shouldSkipCandidate?.(candidate);
    if (samplingSkipReason) {
      skipped.push(`${candidate.hotelName}: ${samplingSkipReason}`);
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
    const rate = selectLowestHotelMainRateQuote(rates);
    if (!rate) {
      const excludedRows = extractExcludedHotelRateRowsFromText("青猫差旅", detailText);
      skipped.push(excludedRows.length
        ? `${candidate.hotelName}: 青猫${ratePlan}价格行已过滤：${excludedRows.map((row) => `${row.reason}=${row.rawText}`).join("；")}`
        : `${candidate.hotelName}: 青猫无${ratePlan}`);
      continue;
    }

    const qingmaoDurationMs = Date.now() - qingmaoStartedAt;
    const pagesBeforeCandidate = snapshotBrowserPages(context);
    const competitorCollectors: Partial<Record<PlatformName, HotelMainRateCompetitorCollector>> = {
      携程商旅: {
        platform: "携程商旅",
        beforeMessage: `${candidate.hotelName}：青猫有${ratePlan}，开始查携程`,
        collect: () => searchCtripHotelMainRateQuote(context, artifactDir, query, candidate, ratePlan),
        pendingQuote: (reason) => buildPendingHotelQuote("携程商旅", reason, candidate, ratePlan)
      },
      阿里商旅: {
        platform: "阿里商旅",
        beforeMessage: `${candidate.hotelName}：开始查阿里`,
        collect: () => searchAliHotelMainRateQuote(context, artifactDir, query, candidate, ratePlan),
        pendingQuote: (reason) => buildPendingHotelQuote("阿里商旅", reason, candidate, ratePlan)
      },
      在途商旅: {
        platform: "在途商旅",
        beforeMessage: `${candidate.hotelName}：开始查在途`,
        collect: () => searchZtripHotelMainRateQuote(context, artifactDir, buildZtripHotelQueryFromQingmao(query), candidate, ratePlan),
        pendingQuote: (reason) => buildPendingHotelQuote("在途商旅", reason, candidate, ratePlan)
      }
    };
    const competitorOrder = (runOptions.competitorOrder ?? ["携程商旅", "阿里商旅", "在途商旅"])
      .filter((platform) => platform !== "青猫差旅");
    const competitorRun = await collectHotelMainRateCompetitorQuotes(competitorOrder.map((platform) => {
      const collector = competitorCollectors[platform];
      if (!collector) {
        throw new Error(`不支持的酒店竞品平台：${platform}`);
      }
      return collector;
    }), {
      stopOnFirstCompetitorFailure: runOptions.stopOnFirstCompetitorFailure,
      onProgress
    });
    const quoteByPlatform = new Map(competitorRun.quotes.map((quote) => [quote.platform, quote]));
    const nextCtripQuote = quoteByPlatform.get("携程商旅");
    const nextAliQuote = quoteByPlatform.get("阿里商旅");
    const nextZtripQuote = quoteByPlatform.get("在途商旅");
    if (!nextCtripQuote || !nextAliQuote || !nextZtripQuote) {
      throw new Error("竞品采集结果不完整");
    }
    onProgress?.(`${candidate.hotelName}：在途完成，开始判断完整性`);
    const competitorQuotes = [nextCtripQuote, nextAliQuote, nextZtripQuote];
    if (competitorRun.stoppedByFailure) {
      failurePlatform = competitorRun.stoppedByFailure.platform;
    }

    if (!fallbackCandidate) {
      fallbackCandidate = candidate;
      fallbackQingmaoQuote = { ...rate, durationMs: qingmaoDurationMs };
      fallbackQingmaoFrame = qingmaoFrame;
      fallbackCompetitorQuotes = competitorQuotes;
    }

    const unavailable = competitorQuotes.filter((quote) => quote.status !== "available" || typeof quote.price !== "number");
    const sameHotelHitFailure = unavailable.find(isHotelSameHotelHitFailureQuote);
    if (runOptions.stopOnFirstCompetitorFailure && sameHotelHitFailure) {
      selectedCandidate = candidate;
      qingmaoQuote = { ...rate, durationMs: qingmaoDurationMs };
      ctripQuote = nextCtripQuote;
      aliQuote = nextAliQuote;
      ztripQuote = nextZtripQuote;
      skipped.push(`${candidate.hotelName}: ${sameHotelHitFailure.platform}同店命中失败${sameHotelHitFailure.error ? ` ${sameHotelHitFailure.error}` : ""}`);
      await closeCreatedBrowserPages(context, pagesBeforeCandidate, new Set([qingmaoPage]));
      break;
    }
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
    skipped,
    attemptsUsed,
    failurePlatform
  };
}

function hotelScaleValidationRunId(date: Date) {
  return `hotel-scale-validation-${formatBatchTimestamp(date)}`;
}

async function writeJsonArtifact(filePath: string, value: unknown) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function buildHotelScaleValidationPathRecordsFromQuotes(quotes: HotelMainRateQuote[], sampleStartedAtMs: number): HotelScaleValidationPathRecord[] {
  let cursorMs = sampleStartedAtMs;
  const orderedQuotes = quotes.length > HOTEL_SCALE_VALIDATION_PLATFORM_ORDER.length
    ? quotes.map((quote) => ({ platform: quote.platform, quote }))
    : HOTEL_SCALE_VALIDATION_PLATFORM_ORDER.map((platform) => ({ platform, quote: quotes.find((item) => item.platform === platform) }));
  return orderedQuotes.map(({ platform, quote }) => {
    const durationMs = Math.max(0, quote?.durationMs ?? 0);
    const startedAt = new Date(cursorMs).toISOString();
    cursorMs += durationMs;
    const endedAt = new Date(cursorMs).toISOString();
    const failed = quote && (quote.status !== "available" || typeof quote.price !== "number");
    return {
      platform,
      step: `${platform === "青猫差旅" ? "qingmao-rate" : "read-rate"}:${quote?.ratePlan ?? HOTEL_CALIBRATION_MAIN_RATE_PLAN}`,
      status: quote ? failed ? "failed" : "completed" : "skipped",
      startedAt,
      endedAt,
      durationMs,
      finalUrl: quote?.finalUrl,
      screenshotPath: quote?.screenshotPath,
      diagnosisPath: quote?.diagnosisPath,
      failureType: failed ? classifyHotelCalibrationFailureType(quote.error ?? "未读取到大床有早餐价格", platform) : undefined,
      failureReason: failed ? quote.error ?? `未读取到${quote.ratePlan}` : undefined
    };
  });
}

function buildHotelScalePageTextSummary(quotes: HotelMainRateQuote[]) {
  return quotes
    .map((quote) => `${quote.platform}:${quote.status}:${quote.hotelName}:${quote.roomType}:${quote.rawText ?? quote.error ?? ""}`)
    .join("\n")
    .slice(0, 1200);
}

function quoteNeedsHumanScreenshotCheck(quote: HotelMainRateQuote) {
  return quote.status === "parser-suspected-failed" || /未解析到|没读到|未读取到|未能确认/.test(quote.error ?? "");
}

function describeHotelDiagnosticQuote(quote: HotelMainRateQuote | undefined) {
  if (!quote) {
    return {
      label: "未执行",
      tone: "pending",
      reason: "这一个平台没有实际查询到，不能人工验收，建议复跑。"
    };
  }
  if (quote.status === "available" && typeof quote.price === "number") {
    return {
      label: "查到价格",
      tone: "ok",
      reason: `${quote.roomType || "页面价格"}，¥${quote.price}`
    };
  }
  if (quote.status === "platform-no-rate") {
    return { label: "平台没找到这个口径", tone: "missing", reason: quote.error ?? "完整展开后没有该口径报价。" };
  }
  if (quote.status === "parser-suspected-failed") {
    return { label: "需要人工确认", tone: "review", reason: quote.error ?? "报价区未稳定，不能判定平台没有。" };
  }

  const reason = quote.error ?? "未说明原因";
  if (/随机分配床型|到店随机|房型待定|到店安排/.test(reason)) {
    return { label: "按规则排除", tone: "excluded", reason };
  }
  if (quoteNeedsHumanScreenshotCheck(quote)) {
    return { label: "需要人工确认", tone: "review", reason: "系统没读到价格，请人工看截图。" };
  }
  if (/同店命中失败|未匹配同店|门牌号|不是同一家/.test(reason)) {
    return { label: "同酒店没命中", tone: "failed", reason };
  }
  if (/timeout|超时|加载/.test(reason)) {
    return { label: "页面超时", tone: "failed", reason };
  }
  if (/青猫无|未找到.*价格|无.*价格|未发现/.test(reason)) {
    return { label: "平台没找到这个口径", tone: "missing", reason };
  }
  return { label: "采集失败", tone: "failed", reason };
}

function diagnosticAssetUrl(filePath: string | undefined, htmlPath: string | undefined) {
  if (!filePath) return "";
  const baseDir = htmlPath ? path.dirname(htmlPath) : "";
  const displayPath = baseDir ? path.relative(baseDir, filePath) : filePath;
  return encodeURI(displayPath.split(path.sep).join("/"));
}

function diagnosticEvidenceThumb(filePath: string | undefined, label: string, htmlPath: string | undefined) {
  const assetUrl = diagnosticAssetUrl(filePath, htmlPath);
  if (!filePath || !assetUrl) return "";
  const isHtmlEvidence = filePath.endsWith(".html");
  return `<button type="button" class="process-shot" data-lightbox-src="${escapeHtml(assetUrl)}" data-lightbox-type="${isHtmlEvidence ? "iframe" : "image"}" data-lightbox-title="${escapeHtml(label)}">
    ${isHtmlEvidence
      ? `<iframe title="${escapeHtml(label)}" src="${escapeHtml(assetUrl)}"></iframe>`
      : `<img alt="${escapeHtml(label)}" src="${escapeHtml(assetUrl)}" loading="lazy" />`}
    <span>${escapeHtml(label)}</span>
  </button>`;
}

function pickLatestDiagnosticFile(names: string[], pattern: RegExp) {
  return names.filter((name) => pattern.test(name)).sort().at(-1);
}

function aliDiagnosticProcessEvidence(quote: HotelMainRateQuote | undefined, htmlPath: string | undefined) {
  if (quote?.platform !== "阿里商旅" || !quote.screenshotPath) return "";
  const evidenceDir = path.dirname(quote.screenshotPath);
  let names: string[] = [];
  try {
    names = fs.readdirSync(evidenceDir);
  } catch {
    return "";
  }
  const fileFor = (pattern: RegExp) => {
    const name = pickLatestDiagnosticFile(names, pattern);
    return name ? path.join(evidenceDir, name) : undefined;
  };
  const assets = [
    { label: "搜索列表", filePath: fileFor(/^alibtrip-keyword-\d+-list\.(png|html)$/i) },
    { label: "命中酒店卡片", filePath: fileFor(/^alibtrip-keyword-\d+-selected-card-\d+\.(png|html)$/i) },
    { label: "详情页截图", filePath: fileFor(/^alibtrip-keyword-\d+-detail-\d+\.(png|html)$/i) },
    { label: "失败页截图", filePath: fileFor(/^alibtrip-keyword-\d+-failure(?:-\d+)?\.(png|html)$/i) }
  ].filter((asset) => asset.filePath);
  if (!assets.length) return "";

  return `<div class="process-evidence">
    <strong>阿里过程证据</strong>
    <div class="process-grid">
      ${assets.map((asset) => diagnosticEvidenceThumb(asset.filePath, asset.label, htmlPath)).join("")}
    </div>
  </div>`;
}

function hotelDiagnosticQuoteCard(quote: HotelMainRateQuote | undefined, platform: PlatformName, ratePlan: HotelRatePlanLabel, htmlPath?: string) {
  const detail = describeHotelDiagnosticQuote(quote);
  const screenshotPath = quote?.screenshotPath;
  const screenshotUrl = diagnosticAssetUrl(screenshotPath, htmlPath);
  const isHtmlEvidence = screenshotPath?.endsWith(".html");
  const processEvidence = aliDiagnosticProcessEvidence(quote, htmlPath);
  const media = screenshotUrl
    ? isHtmlEvidence
      ? `<div class="snapshot-wrap">
        <iframe title="${escapeHtml(platform)}页面快照" src="${escapeHtml(screenshotUrl)}"></iframe>
        <button type="button" class="snapshot-open" data-lightbox-src="${escapeHtml(screenshotUrl)}" data-lightbox-type="iframe" data-lightbox-title="${escapeHtml(`${platform} ${ratePlan}页面快照`)}">点击看大图</button>
      </div>`
      : `<button type="button" class="shot-trigger" data-lightbox-src="${escapeHtml(screenshotUrl)}" data-lightbox-type="image" data-lightbox-title="${escapeHtml(`${platform} ${ratePlan}截图`)}">
        <img alt="${escapeHtml(platform)} ${escapeHtml(ratePlan)}截图" src="${escapeHtml(screenshotUrl)}" loading="lazy" />
        <span>点击看大图</span>
      </button>`
    : `<div class="no-shot">没有截图，需要复跑补证据</div>`;
  return `<article class="platform-card ${escapeHtml(detail.tone)}">
    <div class="platform-head">
      <strong>${escapeHtml(platform)}</strong>
      <span>${escapeHtml(detail.label)}</span>
    </div>
    <p>${escapeHtml(detail.reason)}</p>
    ${media}
    ${processEvidence}
  </article>`;
}

function hotelDiagnosticSampleStats(sample: HotelScaleValidationSample) {
  const quotes = sample.quotes ?? [];
  const available = quotes.filter((quote) => quote.status === "available" && typeof quote.price === "number").length;
  const review = quotes.filter(quoteNeedsHumanScreenshotCheck).length;
  const excluded = quotes.filter((quote) => /随机分配床型|到店随机|房型待定|到店安排/.test(quote.error ?? "")).length;
  const missing = Math.max(0, HOTEL_RATE_PLAN_LABELS.length * HOTEL_SCALE_VALIDATION_PLATFORM_ORDER.length - available - review - excluded);
  return { available, review, excluded, missing };
}

export function buildHotelDiagnosticReviewHtml(result: HotelScaleValidationResult, options: { htmlPath?: string } = {}) {
  const samples = result.groups.flatMap((group) => group.samples.map((sample) => ({ group: group.group, sample })));
  const totalCells = samples.length * HOTEL_RATE_PLAN_LABELS.length * HOTEL_SCALE_VALIDATION_PLATFORM_ORDER.length;
  const allQuotes = samples.flatMap(({ sample }) => sample.quotes ?? []);
  const availableCells = allQuotes.filter((quote) => quote.status === "available" && typeof quote.price === "number").length;
  const reviewCells = allQuotes.filter(quoteNeedsHumanScreenshotCheck).length;
  const excludedCells = allQuotes.filter((quote) => /随机分配床型|到店随机|房型待定|到店安排/.test(quote.error ?? "")).length;
  const missingCells = Math.max(0, totalCells - availableCells - reviewCells - excludedCells);
  const sampleCards = samples.map(({ group, sample }) => {
    const candidate = sample.selectedCandidate;
    const stats = hotelDiagnosticSampleStats(sample);
    const quoteFor = (ratePlan: HotelRatePlanLabel, platform: PlatformName) =>
      (sample.quotes ?? []).find((quote) => quote.ratePlan === ratePlan && quote.platform === platform);
    const rateSections = HOTEL_RATE_PLAN_LABELS.map((ratePlan) => `<section class="rate-section">
      <h3>${escapeHtml(ratePlan)}</h3>
      <div class="platform-grid">
        ${HOTEL_SCALE_VALIDATION_PLATFORM_ORDER.map((platform) => hotelDiagnosticQuoteCard(quoteFor(ratePlan, platform), platform, ratePlan, options.htmlPath)).join("")}
      </div>
    </section>`).join("");

    return `<section class="hotel-card">
      <div class="hotel-title">
        <div>
          <span>${escapeHtml(group)} · 第 ${sample.sampleIndex ?? ""} 家</span>
          <h2>${escapeHtml(candidate?.hotelName ?? "未选中酒店")}</h2>
          <p>${escapeHtml(candidate?.address ?? sample.failureReason ?? sample.message ?? "")}</p>
        </div>
        <div class="status ${escapeHtml(sample.status ?? "partial")}">${escapeHtml(sample.status ?? "partial")}</div>
      </div>
      <div class="hotel-stats">
        <span>查到价格 ${stats.available}</span>
        <span>需人工确认 ${stats.review}</span>
        <span>按规则排除 ${stats.excluded}</span>
        <span>没查到/未执行 ${stats.missing}</span>
      </div>
      ${rateSections}
    </section>`;
  }).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>酒店诊断人工验收页</title>
  <style>
    body { margin: 0; background: #f6f7f9; color: #172033; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    header { padding: 28px 32px 18px; background: #fff; border-bottom: 1px solid #dfe3ea; position: sticky; top: 0; z-index: 2; }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 26px; }
    header p { margin-top: 8px; color: #667085; }
    main { padding: 24px 32px 48px; }
    .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 22px; }
    .summary div, .hotel-card { background: #fff; border: 1px solid #dfe3ea; border-radius: 8px; }
    .summary div { padding: 16px; }
    .summary strong { display: block; font-size: 24px; margin-bottom: 4px; }
    .summary span, .hotel-title p, .platform-card p { color: #667085; }
    .hotel-card { margin-bottom: 26px; padding: 22px; }
    .hotel-title { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; border-bottom: 1px solid #edf0f4; padding-bottom: 16px; }
    .hotel-title span { color: #42526b; font-weight: 700; }
    .hotel-title h2 { font-size: 22px; margin: 8px 0; }
    .status { border-radius: 999px; padding: 6px 12px; background: #eef2f7; color: #344054; font-weight: 700; white-space: nowrap; }
    .status.completed { background: #e7f7ee; color: #087443; }
    .status.partial { background: #fff5df; color: #8a5a00; }
    .status.failed, .status.timeout { background: #fdecec; color: #b42318; }
    .hotel-stats { display: flex; flex-wrap: wrap; gap: 10px; margin: 16px 0 18px; }
    .hotel-stats span { background: #f2f4f7; border-radius: 6px; padding: 8px 10px; font-weight: 650; }
    .rate-section { margin-top: 20px; }
    .rate-section h3 { font-size: 18px; margin-bottom: 10px; }
    .platform-grid { display: grid; grid-template-columns: repeat(4, minmax(260px, 1fr)); gap: 12px; overflow-x: auto; }
    .platform-card { border: 1px solid #dfe3ea; border-radius: 8px; padding: 12px; min-width: 0; background: #fff; }
    .platform-card.ok { border-color: #9ed7b7; background: #f1fbf5; }
    .platform-card.review { border-color: #f3c969; background: #fff9e8; }
    .platform-card.excluded { border-color: #c6d2e1; background: #f6f8fb; }
    .platform-card.failed { border-color: #f3b7b1; background: #fff5f4; }
    .platform-card.missing, .platform-card.pending { border-style: dashed; }
    .platform-head { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
    .platform-head span { font-weight: 700; font-size: 13px; }
    .platform-card p { min-height: 42px; line-height: 1.45; }
    .shot-trigger { display: block; width: 100%; margin-top: 10px; padding: 0; border: 0; background: transparent; cursor: zoom-in; position: relative; text-align: left; }
    .shot-trigger img, .snapshot-wrap iframe { width: 100%; height: 220px; object-fit: contain; background: #fff; border: 1px solid #e5e7eb; border-radius: 6px; display: block; }
    .snapshot-wrap iframe { object-fit: initial; margin-top: 10px; }
    .shot-trigger span, .snapshot-open { position: absolute; right: 10px; bottom: 10px; border: 1px solid #cbd5e1; border-radius: 6px; background: rgba(255,255,255,0.94); color: #172033; padding: 6px 9px; font-size: 13px; font-weight: 700; box-shadow: 0 4px 14px rgba(15, 23, 42, 0.12); }
    .snapshot-wrap { position: relative; }
    .snapshot-open { cursor: zoom-in; }
    .process-evidence { margin-top: 12px; border-top: 1px solid #e5e7eb; padding-top: 10px; }
    .process-evidence strong { display: block; margin-bottom: 8px; color: #344054; }
    .process-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .process-shot { display: block; position: relative; width: 100%; border: 0; background: transparent; padding: 0; cursor: zoom-in; text-align: left; }
    .process-shot img, .process-shot iframe { display: block; width: 100%; height: 120px; object-fit: contain; border: 1px solid #e5e7eb; border-radius: 6px; background: #fff; }
    .process-shot span { position: absolute; left: 6px; bottom: 6px; max-width: calc(100% - 12px); border-radius: 5px; background: rgba(255,255,255,0.94); color: #172033; padding: 4px 6px; font-size: 12px; font-weight: 700; }
    .no-shot { height: 220px; display: grid; place-items: center; margin-top: 10px; border: 1px dashed #cbd5e1; border-radius: 6px; color: #667085; background: #f8fafc; text-align: center; padding: 12px; }
    .lightbox { position: fixed; inset: 0; z-index: 20; display: none; }
    .lightbox.open { display: block; }
    .lightbox-backdrop { position: absolute; inset: 0; border: 0; background: rgba(15, 23, 42, 0.78); cursor: zoom-out; }
    .lightbox-panel { position: absolute; inset: 28px; display: flex; flex-direction: column; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 24px 80px rgba(15, 23, 42, 0.42); }
    .lightbox-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 14px; border-bottom: 1px solid #e5e7eb; }
    .lightbox-head button { border: 1px solid #cbd5e1; background: #fff; border-radius: 6px; padding: 7px 11px; cursor: pointer; font-weight: 700; }
    .lightbox-body { flex: 1; min-height: 0; background: #f8fafc; display: grid; place-items: center; }
    .lightbox-body img, .lightbox-body iframe { width: 100%; height: 100%; border: 0; object-fit: contain; background: #fff; }
    @media (max-width: 900px) { header, main { padding-left: 16px; padding-right: 16px; } .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } .platform-grid { grid-template-columns: 1fr; } }
    @media (max-width: 900px) { .lightbox-panel { inset: 10px; } }
  </style>
</head>
<body>
  <header>
    <h1>酒店诊断人工验收页</h1>
    <p>${escapeHtml(result.checkInDate)} 入住，${escapeHtml(result.checkOutDate)} 离店。每家酒店按 4 个口径、4 个平台逐格验收。</p>
  </header>
  <main>
    <section class="summary">
      <div><strong>${samples.length}</strong><span>酒店数量</span></div>
      <div><strong>${availableCells}</strong><span>查到价格</span></div>
      <div><strong>${reviewCells}</strong><span>需要人工看截图</span></div>
      <div><strong>${missingCells + excludedCells}</strong><span>没查到或排除</span></div>
    </section>
    ${sampleCards || "<p>还没有酒店诊断结果。</p>"}
  </main>
  <div class="lightbox" id="imageLightbox" aria-hidden="true">
    <button class="lightbox-backdrop" type="button" data-lightbox-close aria-label="关闭大图"></button>
    <div class="lightbox-panel" role="dialog" aria-modal="true" aria-labelledby="lightboxTitle">
      <div class="lightbox-head">
        <strong id="lightboxTitle">截图大图</strong>
        <button type="button" data-lightbox-close>关闭</button>
      </div>
      <div class="lightbox-body" id="lightboxBody"></div>
    </div>
  </div>
  <script>
    (() => {
      const lightbox = document.getElementById("imageLightbox");
      const body = document.getElementById("lightboxBody");
      const title = document.getElementById("lightboxTitle");
      if (!lightbox || !body || !title) return;
      const close = () => {
        lightbox.classList.remove("open");
        lightbox.setAttribute("aria-hidden", "true");
        body.innerHTML = "";
      };
      document.querySelectorAll("[data-lightbox-src]").forEach((trigger) => {
        trigger.addEventListener("click", () => {
          const src = trigger.getAttribute("data-lightbox-src");
          if (!src) return;
          const type = trigger.getAttribute("data-lightbox-type") || "image";
          title.textContent = trigger.getAttribute("data-lightbox-title") || "截图大图";
          body.innerHTML = type === "iframe"
            ? '<iframe title="页面快照大图" src="' + src.replace(/"/g, "&quot;") + '"></iframe>'
            : '<img alt="截图大图" src="' + src.replace(/"/g, "&quot;") + '" />';
          lightbox.classList.add("open");
          lightbox.setAttribute("aria-hidden", "false");
        });
      });
      document.querySelectorAll("[data-lightbox-close]").forEach((button) => button.addEventListener("click", close));
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") close();
      });
    })();
  </script>
</body>
</html>`;
}

export function buildHotelSingleAllRatePlansReviewHtml(result: HotelSingleAllRatePlansResult, options: { htmlPath?: string } = {}) {
  const platformFor = (platformName: PlatformName) => result.platforms.find((platform) => platform.platform === platformName);
  const priceCell = (platformName: PlatformName, ratePlan: HotelRatePlanLabel) => {
    const platform = platformFor(platformName);
    if (!platform) return `<td class="missing">未执行</td>`;
    if (platform.sameHotel !== true) return `<td class="failed">同店未通过<br><small>${escapeHtml(platform.failureReason || platform.matchBasis)}</small></td>`;
    const price = hotelCalibrationRatePrice(platform, ratePlan);
    if (typeof price === "number") return `<td class="ok">¥${price}</td>`;
    return `<td class="missing">${escapeHtml(platform.failureReason || "未读取到价格")}</td>`;
  };
  const rateRows = HOTEL_RATE_PLAN_LABELS.map((ratePlan) => `<tr>
    <th>${escapeHtml(ratePlan)}</th>
    ${result.platformOrder.map((platform) => priceCell(platform, ratePlan)).join("")}
  </tr>`).join("");
  const evidenceCards = result.platformOrder.map((platformName) => {
    const platform = platformFor(platformName);
    const shotUrl = diagnosticAssetUrl(platform?.screenshotPath, options.htmlPath);
    const isHtmlEvidence = platform?.screenshotPath?.endsWith(".html");
    const media = shotUrl
      ? isHtmlEvidence
        ? `<div class="snapshot-wrap">
          <iframe title="${escapeHtml(platformName)}页面快照" src="${escapeHtml(shotUrl)}"></iframe>
          <button type="button" class="snapshot-open" data-lightbox-src="${escapeHtml(shotUrl)}" data-lightbox-type="iframe" data-lightbox-title="${escapeHtml(`${platformName} 页面快照`)}">点击看大图</button>
        </div>`
        : `<button type="button" class="shot-trigger" data-lightbox-src="${escapeHtml(shotUrl)}" data-lightbox-type="image" data-lightbox-title="${escapeHtml(`${platformName} 截图`)}">
          <img alt="${escapeHtml(platformName)}截图" src="${escapeHtml(shotUrl)}" loading="lazy" />
          <span>点击看大图</span>
        </button>`
      : `<div class="no-shot">没有截图</div>`;
    return `<article>
      <h3>${escapeHtml(platformName)}</h3>
      <p>${escapeHtml(platform?.sameHotel === true ? platform.matchBasis : platform?.failureReason || platform?.matchBasis || "未执行")}</p>
      ${media}
    </article>`;
  }).join("");
  const completeText = result.completeRatePlans.length
    ? result.completeRatePlans.join("、")
    : "暂无四平台完整口径";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>指定单酒店四口径验收页</title>
  <style>
    body { margin: 0; background: #f6f7f9; color: #172033; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    header, main { max-width: 1180px; margin: 0 auto; padding: 28px 24px; }
    header { background: #fff; border-bottom: 1px solid #dfe3ea; max-width: none; }
    header > div { max-width: 1180px; margin: 0 auto; }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 26px; }
    header p { margin-top: 8px; color: #667085; line-height: 1.6; }
    .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 20px; }
    .summary div, .panel, article { background: #fff; border: 1px solid #dfe3ea; border-radius: 8px; }
    .summary div { padding: 14px 16px; }
    .summary strong { display: block; font-size: 20px; margin-bottom: 4px; }
    .summary span, article p { color: #667085; }
    .panel { padding: 18px; margin-bottom: 22px; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 820px; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 12px; text-align: left; vertical-align: top; }
    th { background: #f8fafc; white-space: nowrap; }
    td.ok { color: #087443; font-weight: 750; }
    td.failed { color: #b42318; }
    td.missing { color: #8a5a00; }
    td small { color: #667085; }
    .evidence { display: grid; grid-template-columns: repeat(4, minmax(220px, 1fr)); gap: 12px; }
    article { padding: 12px; min-width: 0; }
    article h3 { font-size: 16px; margin-bottom: 8px; }
    article p { min-height: 42px; line-height: 1.45; }
    article img, article iframe, .no-shot { width: 100%; height: 210px; margin-top: 10px; border: 1px solid #e5e7eb; border-radius: 6px; background: #fff; object-fit: contain; display: block; }
    .no-shot { display: grid; place-items: center; color: #667085; background: #f8fafc; }
    .shot-trigger { display: block; width: 100%; margin: 0; padding: 0; border: 0; background: transparent; cursor: zoom-in; position: relative; text-align: left; }
    .shot-trigger span, .snapshot-open { position: absolute; right: 10px; bottom: 10px; border: 1px solid #cbd5e1; border-radius: 6px; background: rgba(255,255,255,0.95); color: #172033; padding: 6px 9px; font-size: 13px; font-weight: 700; box-shadow: 0 4px 14px rgba(15, 23, 42, 0.12); }
    .snapshot-wrap { position: relative; }
    .snapshot-open { cursor: zoom-in; }
    .lightbox { position: fixed; inset: 0; z-index: 20; display: none; }
    .lightbox.open { display: block; }
    .lightbox-backdrop { position: absolute; inset: 0; border: 0; background: rgba(15, 23, 42, 0.78); cursor: zoom-out; }
    .lightbox-panel { position: absolute; inset: 28px; display: flex; flex-direction: column; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 24px 80px rgba(15, 23, 42, 0.42); }
    .lightbox-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 14px; border-bottom: 1px solid #e5e7eb; }
    .lightbox-head button { border: 1px solid #cbd5e1; background: #fff; border-radius: 6px; padding: 7px 11px; cursor: pointer; font-weight: 700; }
    .lightbox-body { flex: 1; min-height: 0; background: #f8fafc; display: grid; place-items: center; }
    .lightbox-body img, .lightbox-body iframe { width: 100%; height: 100%; border: 0; object-fit: contain; background: #fff; }
    @media (max-width: 900px) { header, main { padding-left: 16px; padding-right: 16px; } .summary { grid-template-columns: 1fr; } .evidence { grid-template-columns: 1fr; } }
    @media (max-width: 900px) { .lightbox-panel { inset: 10px; } }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>指定单酒店四口径验收页</h1>
      <p>${escapeHtml(result.input?.city ?? result.query?.city ?? "")} / ${escapeHtml(result.input?.keyword ?? result.selectedCandidate?.hotelName ?? "未指定酒店")}，${escapeHtml(result.input?.checkInDate ?? result.query?.checkInDate ?? "")} 入住，${escapeHtml(result.input?.checkOutDate ?? result.query?.checkOutDate ?? "")} 离店。</p>
    </div>
  </header>
  <main>
    <section class="summary">
      <div><strong>${escapeHtml(result.status)}</strong><span>复验状态</span></div>
      <div><strong>${result.platforms.filter((platform) => platform.sameHotel === true).length}/${result.platformOrder.length}</strong><span>同店确认通过平台</span></div>
      <div><strong>${escapeHtml(completeText)}</strong><span>四平台完整口径</span></div>
    </section>
    <section class="panel">
      <h2>${escapeHtml(result.selectedCandidate?.hotelName ?? "未锁定酒店")}</h2>
      <p>${escapeHtml(result.sourceHotel?.address ?? result.selectedCandidate?.address ?? result.message)}</p>
      <table>
        <thead>
          <tr>
            <th>口径</th>
            ${result.platformOrder.map((platform) => `<th>${escapeHtml(platform)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>${rateRows}</tbody>
      </table>
    </section>
    <section class="evidence">${evidenceCards}</section>
  </main>
  <div class="lightbox" id="imageLightbox" aria-hidden="true">
    <button class="lightbox-backdrop" type="button" data-lightbox-close aria-label="关闭大图"></button>
    <div class="lightbox-panel" role="dialog" aria-modal="true" aria-labelledby="lightboxTitle">
      <div class="lightbox-head">
        <strong id="lightboxTitle">截图大图</strong>
        <button type="button" data-lightbox-close>关闭</button>
      </div>
      <div class="lightbox-body" id="lightboxBody"></div>
    </div>
  </div>
  <script>
    (() => {
      const lightbox = document.getElementById("imageLightbox");
      const body = document.getElementById("lightboxBody");
      const title = document.getElementById("lightboxTitle");
      if (!lightbox || !body || !title) return;
      const close = () => {
        lightbox.classList.remove("open");
        lightbox.setAttribute("aria-hidden", "true");
        body.innerHTML = "";
      };
      document.querySelectorAll("[data-lightbox-src]").forEach((trigger) => {
        trigger.addEventListener("click", () => {
          const src = trigger.getAttribute("data-lightbox-src");
          if (!src) return;
          const type = trigger.getAttribute("data-lightbox-type") || "image";
          title.textContent = trigger.getAttribute("data-lightbox-title") || "截图大图";
          body.innerHTML = type === "iframe"
            ? '<iframe title="页面快照大图" src="' + src.replace(/"/g, "&quot;") + '"></iframe>'
            : '<img alt="截图大图" src="' + src.replace(/"/g, "&quot;") + '" />';
          lightbox.classList.add("open");
          lightbox.setAttribute("aria-hidden", "false");
        });
      });
      document.querySelectorAll("[data-lightbox-close]").forEach((button) => button.addEventListener("click", close));
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") close();
      });
    })();
  </script>
</body>
</html>`;
}

function collectExcludedHotelRateRows(quotes: HotelMainRateQuote[]) {
  return quotes.flatMap((quote) => {
    if (!quote.rawText) return [];
    const excluded = isHotelRateLineExcludedByBedAssignment(quote.rawText, {
      mainRoomTypeText: quote.platform === "在途商旅" ? quote.roomType : undefined
    });
    return excluded.excluded
      ? [{ platform: quote.platform, reason: excluded.reason, rawText: quote.rawText }]
      : [];
  });
}

async function collectAliScaleEvidencePaths(sampleArtifactDir: string): Promise<HotelScaleValidationAliEvidence> {
  const names: string[] = [];
  const collect = async (dir: string, prefix = "") => {
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const relative = prefix ? path.join(prefix, entry.name) : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await collect(full, relative);
      } else {
        names.push(relative);
      }
    }
  };
  await collect(sampleArtifactDir);
  const fullPath = (match: (name: string) => boolean) => {
    const name = names.find(match);
    return name ? path.join(sampleArtifactDir, name) : undefined;
  };
  return {
    listScreenshotPath: fullPath((name) => /alibtrip.*list\.(png|html)$/i.test(name)),
    candidateScreenshotPath: fullPath((name) => /alibtrip.*(selected-card|card)\.(png|html)$/i.test(name)),
    detailScreenshotPath: fullPath((name) => /alibtrip.*detail\.(png|html)$/i.test(name)),
    failureScreenshotPath: fullPath((name) => /alibtrip.*failure\.(png|html)$/i.test(name))
  };
}

async function buildHotelScaleValidationFailedEvidenceFromQingmaoPage(
  qingmaoPage: BrowserPage,
  sampleArtifactDir: string,
  failureReason: string
): Promise<Pick<HotelScaleValidationSample, "finalUrl" | "screenshotPath" | "htmlSnapshotPath" | "pageTextSummary" | "qingmaoEvidence" | "evidenceSaveFailed">> {
  const bodyText = await qingmaoPage.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
  const screenshotTarget = path.join(sampleArtifactDir, "qingmao-candidate-failure.png");
  try {
    const evidencePath = await savePageEvidence(qingmaoPage, screenshotTarget, {
      platform: "青猫差旅",
      finalUrl: qingmaoPage.url(),
      bodyText,
      error: failureReason
    });
    const isHtmlSnapshot = evidencePath.endsWith(".html");
    return {
      finalUrl: qingmaoPage.url(),
      screenshotPath: isHtmlSnapshot ? undefined : evidencePath,
      htmlSnapshotPath: isHtmlSnapshot ? evidencePath : undefined,
      pageTextSummary: buildHotelPageTextSummary(bodyText),
      qingmaoEvidence: {
        candidateListScreenshotPath: evidencePath,
        candidatesRead: parseQingmaoHotelCandidatesText(bodyText)
      }
    };
  } catch {
    return {
      finalUrl: qingmaoPage.url(),
      pageTextSummary: buildHotelPageTextSummary(bodyText),
      qingmaoEvidence: {
        candidatesRead: parseQingmaoHotelCandidatesText(bodyText)
      },
      evidenceSaveFailed: true
    };
  }
}

async function finalizeHotelScaleValidationSample(sample: HotelScaleValidationSample, resultPath: string) {
  const evaluated = evaluateHotelScaleValidationEvidence({
    ...sample,
    resultPath
  });
  const finalized = {
    ...sample,
    resultPath,
    evidenceStatus: sample.evidenceStatus ?? evaluated.evidenceStatus,
    evidenceIssues: sample.evidenceIssues ?? evaluated.evidenceIssues
  };
  await writeJsonArtifact(resultPath, finalized);
  return finalized;
}

function refreshHotelScaleValidationGroupCounts(groupResult: HotelScaleValidationGroupResult) {
  groupResult.completedCount = groupResult.samples.filter((sample) => sample.status === "completed").length;
  groupResult.partialCount = groupResult.samples.filter((sample) => sample.status === "partial").length;
  groupResult.failedCount = groupResult.samples.filter((sample) => sample.status === "failed").length;
  groupResult.skippedCount = groupResult.samples.filter((sample) => sample.status === "skipped").length;
  groupResult.timeoutCount = groupResult.samples.filter((sample) => sample.status === "timeout").length;
  groupResult.attemptedCount = groupResult.samples.filter((sample) => sample.status !== "skipped").length;
  groupResult.unattemptedCount = Math.max(
    0,
    groupResult.targetCount - groupResult.completedCount - groupResult.partialCount - groupResult.failedCount - (groupResult.timeoutCount ?? 0)
  );
}

async function selectHotelCandidateForQuery(
  qingmaoPage: BrowserPage,
  query: QingmaoHotelCandidateQuery
): Promise<QingmaoHotelCandidate> {
  const listFrame = await searchQingmaoHotelCandidates(qingmaoPage, query);
  const listText = await listFrame.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  const candidates = parseQingmaoHotelCandidatesText(listText);
  return selectLockedQingmaoHotelCandidate(candidates, query);
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
    .filter((candidate) =>
      isHotelCandidateRelevantForQuery(candidate, query)
      && Boolean(candidate.price && candidate.price > 0)
      && !qingmaoSourceCandidateStabilityFailure(candidate)
    );
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
  const stabilityFailure = qingmaoSourceCandidateStabilityFailure(candidate);
  if (stabilityFailure) {
    throw new Error(stabilityFailure);
  }

  const qingmaoStartedAt = Date.now();
  await clickQingmaoHotelCandidateDetail(listFrame, candidate, clickIndex);
  const qingmaoFrame = await waitForQingmaoHotelDetailFrame(qingmaoPage, candidate.hotelName);
  const detailText = await waitForQingmaoHotelDetailText(qingmaoFrame, candidate.hotelName);

  return HOTEL_RATE_PLAN_LABELS.flatMap((ratePlan) => {
    const rate = selectLowestHotelMainRateQuote(parseQingmaoHotelMainRatesText(detailText, ratePlan));
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
  const stabilityFailure = qingmaoSourceCandidateStabilityFailure(candidate);
  if (stabilityFailure) {
    throw new Error(stabilityFailure);
  }

  const qingmaoStartedAt = Date.now();
  await clickQingmaoHotelCandidateDetail(listFrame, candidate, clickIndex);
  const qingmaoFrame = await waitForQingmaoHotelDetailFrame(qingmaoPage, candidate.hotelName);
  let bodyText = await waitForQingmaoHotelDetailText(qingmaoFrame, candidate.hotelName, ratePlan);
  let rates = parseQingmaoHotelMainRatesText(bodyText, ratePlan);
  if (!rates.some((item) => item.status === "available" && typeof item.price === "number")) {
    await filterQingmaoHotelMainRate(qingmaoFrame, candidate.hotelName, ratePlan);
    bodyText = await waitForQingmaoHotelDetailText(qingmaoFrame, candidate.hotelName, ratePlan);
    rates = parseQingmaoHotelMainRatesText(bodyText, ratePlan);
  }
  const qingmaoQuote = selectLowestHotelMainRateQuote(rates);
  const qingmaoDurationMs = Date.now() - qingmaoStartedAt;
  const qingmaoError = qingmaoQuote ? "" : `青猫无${ratePlan}`;
  const qingmaoEvidencePath = await savePageEvidence(qingmaoPage, path.join(artifactDir, hotelRatePlanEvidenceName("青猫差旅", ratePlan)), {
    platform: "青猫差旅",
    finalUrl: qingmaoFrame.url(),
    bodyText,
    price: qingmaoQuote?.price ?? null,
    rawText: qingmaoQuote?.rawText,
    error: qingmaoError || undefined
  });
  const qingmaoResultQuote: HotelMainRateQuote = qingmaoQuote
    ? {
      ...qingmaoQuote,
      finalUrl: qingmaoFrame.url(),
      screenshotPath: qingmaoEvidencePath,
      durationMs: qingmaoDurationMs
    }
    : {
      platform: "青猫差旅",
      status: "not-found",
      price: null,
      hotelName: candidate.hotelName,
      roomType: "",
      ratePlan,
      finalUrl: qingmaoFrame.url(),
      screenshotPath: qingmaoEvidencePath,
      rawText: bodyText.slice(0, 1200),
      durationMs: qingmaoDurationMs,
      error: qingmaoError
    };

  const pagesBeforeCandidate = snapshotBrowserPages(context);
  try {
    const ctripQuote = await searchCtripHotelMainRateQuote(context, artifactDir, query, candidate, ratePlan);
    const aliQuote = await searchAliHotelMainRateQuote(context, artifactDir, query, candidate, ratePlan);
    const ztripQuote = await searchZtripHotelMainRateQuote(context, artifactDir, buildZtripHotelQueryFromQingmao(query), candidate, ratePlan);
    const quotes: HotelMainRateQuote[] = [
      qingmaoResultQuote,
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

async function waitForQingmaoHotelDetailAnyRateText(frame: BrowserFrame, expectedHotelName: string) {
  let latestText = "";
  let lastStableKey = "";
  let stableCount = 0;
  for (let attempt = 0; attempt < 18; attempt += 1) {
    await frame.evaluate<boolean>(`(() => {
      window.scrollTo(0, Math.min(document.body.scrollHeight, 900));
      return true;
    })()`).catch(() => false);
    latestText = await frame.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
    const hasExpectedHotel = latestText.includes(expectedHotelName);
    const hasAnyRoomSignal = /大床|双床/.test(latestText) && /[￥¥]\s*\d{2,5}|无早餐|无早|含早餐|含早|早餐/.test(latestText);
    const stableKey = buildHotelPageTextSummary(latestText, 800);
    stableCount = stableKey && stableKey === lastStableKey ? stableCount + 1 : 1;
    lastStableKey = stableKey;
    if (hasExpectedHotel && hasAnyRoomSignal && stableCount >= 2) {
      return latestText;
    }
    await frame.waitForTimeout(1_000);
  }
  return latestText;
}

function hotelPlatformNoRateStatus(platform: PlatformName, stable = true): HotelMainRateQuote["status"] {
  if (platform === "阿里商旅" && !stable) return "parser-suspected-failed";
  return platform === "阿里商旅" ? "platform-no-rate" : "not-found";
}

function hotelPlatformNoRateError(platform: PlatformName, ratePlan: HotelRatePlanLabel, stable = true) {
  if (platform === "阿里商旅" && !stable) return `阿里商旅报价区未稳定，未能确认${ratePlan}价格`;
  if (platform === "阿里商旅") return `阿里商旅完整展开后未找到${ratePlan}价格`;
  return `${platform}同酒店详情页未解析到${ratePlan}价格`;
}

async function saveFailureEvidenceForAllRatePlans(
  page: BrowserPage,
  artifactDir: string,
  platform: PlatformName,
  candidate: QingmaoHotelCandidate,
  reason: string,
  startedAt: number,
  diagnosisPath?: string
) {
  const bodyText = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
  const quotes: HotelMainRateQuote[] = [];
  for (const [index, ratePlan] of HOTEL_RATE_PLAN_LABELS.entries()) {
    const screenshotPath = path.join(artifactDir, hotelRatePlanEvidenceName(platform, ratePlan));
    const evidencePath = await savePageEvidence(page, screenshotPath, {
      platform,
      finalUrl: page.url(),
      bodyText,
      error: reason
    }).catch(() => undefined);
    quotes.push({
      ...buildFailedHotelQuote(platform, reason, candidate, ratePlan),
      finalUrl: page.url(),
      screenshotPath: evidencePath,
      diagnosisPath,
      rawText: bodyText,
      durationMs: index === 0 ? Date.now() - startedAt : 0
    });
  }
  return quotes;
}

async function collectQingmaoHotelAllRatePlanQuotes(
  qingmaoPage: BrowserPage,
  artifactDir: string,
  listFrame: BrowserFrame,
  candidate: QingmaoHotelCandidate,
  clickIndex: number
) {
  const startedAt = Date.now();
  await clickQingmaoHotelCandidateDetail(listFrame, candidate, clickIndex);
  const qingmaoFrame = await waitForQingmaoHotelDetailFrame(qingmaoPage, candidate.hotelName);
  let bodyText = await waitForQingmaoHotelDetailAnyRateText(qingmaoFrame, candidate.hotelName);
  const quotes: HotelMainRateQuote[] = [];

  for (const [index, ratePlan] of HOTEL_RATE_PLAN_LABELS.entries()) {
    let rates = parseQingmaoHotelMainRatesText(bodyText, ratePlan);
    if (!rates.some((item) => item.status === "available" && typeof item.price === "number")) {
      await filterQingmaoHotelMainRate(qingmaoFrame, candidate.hotelName, ratePlan);
      bodyText = await waitForQingmaoHotelDetailText(qingmaoFrame, candidate.hotelName, ratePlan);
      rates = parseQingmaoHotelMainRatesText(bodyText, ratePlan);
    }
    const selectedRate = selectLowestHotelMainRateQuote(rates);
    const screenshotPath = path.join(artifactDir, hotelRatePlanEvidenceName("青猫差旅", ratePlan));
    const evidencePath = await savePageEvidence(qingmaoPage, screenshotPath, {
      platform: "青猫差旅",
      finalUrl: qingmaoFrame.url(),
      bodyText,
      price: selectedRate?.price ?? null,
      rawText: selectedRate?.rawText,
      error: selectedRate ? undefined : `青猫无${ratePlan}`
    });
    quotes.push(selectedRate
      ? {
        ...selectedRate,
        finalUrl: qingmaoFrame.url(),
        screenshotPath: evidencePath,
        durationMs: index === 0 ? Date.now() - startedAt : 0
      }
      : {
        platform: "青猫差旅",
        status: "not-found",
        price: null,
        hotelName: candidate.hotelName,
        roomType: "",
        ratePlan,
        finalUrl: qingmaoFrame.url(),
        screenshotPath: evidencePath,
        rawText: bodyText.slice(0, 1200),
        durationMs: index === 0 ? Date.now() - startedAt : 0,
        error: `青猫无${ratePlan}`
      });
  }

  return quotes;
}

async function collectCtripHotelAllRatePlanQuotes(
  context: BrowserContext,
  artifactDir: string,
  query: QingmaoHotelCandidateQuery,
  candidate: QingmaoHotelCandidate
) {
  const page = await context.newPage();
  const startedAt = Date.now();
  try {
    await openCtripHotelDetailByHotel(page, query, candidate);
    const bodyText = await waitForCtripHotelDetailRooms(page);
    const quotes: HotelMainRateQuote[] = [];
    for (const [index, ratePlan] of HOTEL_RATE_PLAN_LABELS.entries()) {
      const rates = parseCtripHotelMainRatesText(bodyText, ratePlan);
      const selectedRate = selectLowestHotelMainRateQuote(rates);
      const excludedRows = extractExcludedHotelRateRowsFromText("携程商旅", bodyText);
      const screenshotPath = path.join(artifactDir, hotelRatePlanEvidenceName("携程商旅", ratePlan));
      const evidencePath = await savePageEvidence(page, screenshotPath, {
        platform: "携程商旅",
        finalUrl: page.url(),
        bodyText,
        price: selectedRate?.price ?? null,
        rawText: selectedRate?.rawText ?? excludedRows[0]?.rawText
      });
      quotes.push(selectedRate
        ? { ...selectedRate, finalUrl: page.url(), screenshotPath: evidencePath, durationMs: index === 0 ? Date.now() - startedAt : 0 }
        : {
          platform: "携程商旅",
          status: "not-found",
          price: null,
          hotelName: candidate.hotelName,
          roomType: "",
          ratePlan,
          finalUrl: page.url(),
          screenshotPath: evidencePath,
          durationMs: index === 0 ? Date.now() - startedAt : 0,
          rawText: excludedRows[0]?.rawText,
          error: excludedRows.length
            ? `携程商旅${ratePlan}价格行已过滤：${excludedRows.map((row) => row.reason).join("、")}`
            : hotelPlatformNoRateError("携程商旅", ratePlan)
        });
    }
    return quotes;
  } catch (error) {
    return saveFailureEvidenceForAllRatePlans(page, artifactDir, "携程商旅", candidate, errorMessage(error), startedAt);
  }
}

async function collectAliHotelAllRatePlanQuotes(
  context: BrowserContext,
  artifactDir: string,
  query: QingmaoHotelCandidateQuery,
  candidate: QingmaoHotelCandidate
) {
  const page = await context.newPage();
  const startedAt = Date.now();
  const aliKeywordTraces: AliHotelKeywordTrace[] = [];
  const diagnosisPath = path.join(artifactDir, "alibtrip-list-diagnosis.json");
  let detailPage: BrowserPage | null = null;
  let bodyText = "";
  let detailRoomsRead: AliHotelDetailRoomsRead | null = null;

  try {
    await page.goto("https://travel.alibtrip.com/index.html#/hotel", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(3_000);
    let lastError = "";
    for (const keywordPlan of buildAliHotelSearchKeywordPlan(query, candidate)) {
      try {
        await openAliHotelList(context, page, query, keywordPlan.keyword, candidate);
        const aliSelection = await clickMatchingAliHotelCard(context, page, query, candidate, {
          keyword: keywordPlan.keyword,
          keywordMode: keywordPlan.mode,
          traces: aliKeywordTraces,
          artifactDir
        }, keywordPlan);
        detailPage = aliSelection.detailPage;
        detailRoomsRead = await readAliHotelDetailRooms(detailPage);
        bodyText = detailRoomsRead.bodyText;
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
        detailRoomsRead = null;
      }
    }
    if (lastError) throw new Error(lastError);
    if (!detailPage) throw new Error("阿里商旅同酒店详情页未打开");

    const quotes: HotelMainRateQuote[] = [];
    for (const [index, ratePlan] of HOTEL_RATE_PLAN_LABELS.entries()) {
      const rates = parseAliHotelMainRatesText(bodyText, ratePlan);
      const selectedRate = selectLowestHotelMainRateQuote(rates);
      const excludedRows = extractExcludedHotelRateRowsFromText("阿里商旅", bodyText);
      const ratePlanDiagnosticText = buildAliHotelRatePlanDiagnosticText(bodyText, ratePlan);
      const fallbackRawText = ratePlanDiagnosticText || excludedRows[0]?.rawText;
      const screenshotPath = path.join(artifactDir, hotelRatePlanEvidenceName("阿里商旅", ratePlan));
      await scrollAliHotelDetailToRateEvidence(detailPage, ratePlan);
      const evidencePath = await savePageEvidence(detailPage, screenshotPath, {
        platform: "阿里商旅",
        finalUrl: detailPage.url(),
        bodyText,
        price: selectedRate?.price ?? null,
        rawText: selectedRate?.rawText ?? fallbackRawText
      });
      if (selectedRate) {
        quotes.push({ ...selectedRate, finalUrl: detailPage.url(), screenshotPath: evidencePath, durationMs: index === 0 ? Date.now() - startedAt : 0 });
        continue;
      }
      const status = hotelPlatformNoRateStatus("阿里商旅", Boolean(detailRoomsRead?.stable));
      const sidecarPath = screenshotPath.replace(/\.[^.]+$/, ".html");
      await writeEvidenceSnapshotHtml(sidecarPath, {
        platform: "阿里商旅",
        finalUrl: detailPage.url(),
        bodyText,
        price: null,
        rawText: fallbackRawText,
        error: hotelPlatformNoRateError("阿里商旅", ratePlan, Boolean(detailRoomsRead?.stable))
      }).catch(() => undefined);
      quotes.push({
        platform: "阿里商旅",
        status,
        price: null,
        hotelName: candidate.hotelName,
        roomType: "",
        ratePlan,
        finalUrl: detailPage.url(),
        screenshotPath: evidencePath,
        diagnosisPath: sidecarPath,
        durationMs: index === 0 ? Date.now() - startedAt : 0,
        rawText: fallbackRawText,
        error: excludedRows.length
          ? `阿里商旅${ratePlan}价格行已过滤：${excludedRows.map((row) => row.reason).join("、")}`
          : hotelPlatformNoRateError("阿里商旅", ratePlan, Boolean(detailRoomsRead?.stable))
      });
    }
    return quotes;
  } catch (error) {
    await writeAliHotelListDiagnosis(artifactDir, aliKeywordTraces);
    const evidencePage = detailPage ?? page;
    return saveFailureEvidenceForAllRatePlans(evidencePage, artifactDir, "阿里商旅", candidate, errorMessage(error), startedAt, diagnosisPath);
  }
}

async function collectZtripHotelAllRatePlanQuotes(
  context: BrowserContext,
  artifactDir: string,
  query: ZtripHotelQuery,
  candidate: QingmaoHotelCandidate
) {
  const page = await context.newPage();
  const startedAt = Date.now();
  try {
    await openZtripHotelSearchResultByHotel(page, query, candidate);
    const detailIdentityText = await page.locator("body").innerText({ timeout: 8_000 }).catch(() => "");
    assertCompetitorHotelDetailSameByDoorPlate("在途商旅", {
      city: query.city,
      keyword: candidate.hotelName,
      checkInDate: query.checkInDate,
      checkOutDate: query.checkOutDate,
      nights: query.nights
    }, candidate, detailIdentityText);

    const quotes: HotelMainRateQuote[] = [];
    for (const [index, ratePlan] of HOTEL_RATE_PLAN_LABELS.entries()) {
      try {
        await clearZtripHotelRatePlanFilters(page);
        await filterZtripHotelRatePlan(page, ratePlan);
        await expandZtripRoomCards(page, ratePlan);
        const bodyText = await page.locator("body").innerText({ timeout: 8_000 }).catch(() => detailIdentityText);
        const rates = parseZtripHotelRatesTextForRatePlan(bodyText, ratePlan);
        const selectedRate = selectZtripHotelRateForRatePlan(rates, ratePlan);
        const excludedRows = extractExcludedHotelRateRowsFromText("在途商旅", bodyText);
        const screenshotPath = path.join(artifactDir, hotelRatePlanEvidenceName("在途商旅", ratePlan));
        const evidencePath = await savePageEvidence(page, screenshotPath, {
          platform: "在途商旅",
          finalUrl: page.url(),
          bodyText,
          price: selectedRate?.price ?? null,
          rawText: selectedRate?.rawText ?? excludedRows[0]?.rawText
        });
        quotes.push(selectedRate
          ? { ...buildZtripHotelMainRateQuote(selectedRate, page, evidencePath, candidate, ratePlan), durationMs: index === 0 ? Date.now() - startedAt : 0 }
          : {
            platform: "在途商旅",
            status: "not-found",
            price: null,
            hotelName: candidate.hotelName,
            roomType: "",
            ratePlan,
            finalUrl: page.url(),
            screenshotPath: evidencePath,
            durationMs: index === 0 ? Date.now() - startedAt : 0,
            rawText: excludedRows[0]?.rawText,
            error: excludedRows.length
              ? `在途商旅${ratePlan}价格行已过滤：${excludedRows.map((row) => row.reason).join("、")}`
              : hotelPlatformNoRateError("在途商旅", ratePlan)
          });
      } catch (ratePlanError) {
        if (!shouldDowngradeZtripRatePlanFilterFailure(ratePlanError)) {
          throw ratePlanError;
        }
        const bodyText = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => detailIdentityText);
        const screenshotPath = path.join(artifactDir, hotelRatePlanEvidenceName("在途商旅", ratePlan));
        const evidencePath = await savePageEvidence(page, screenshotPath, {
          platform: "在途商旅",
          finalUrl: page.url(),
          bodyText,
          error: errorMessage(ratePlanError)
        }).catch(() => undefined);
        quotes.push({
          platform: "在途商旅",
          status: "not-found",
          price: null,
          hotelName: candidate.hotelName,
          roomType: "",
          ratePlan,
          finalUrl: page.url(),
          screenshotPath: evidencePath,
          durationMs: index === 0 ? Date.now() - startedAt : 0,
          rawText: bodyText,
          error: `${errorMessage(ratePlanError)}，按${ratePlan}记为暂无`
        });
      }
    }
    return quotes;
  } catch (error) {
    return saveFailureEvidenceForAllRatePlans(page, artifactDir, "在途商旅", candidate, errorMessage(error), startedAt);
  }
}

function isHotelRatePlanComplete(quotes: HotelMainRateQuote[], ratePlan: HotelRatePlanLabel) {
  return HOTEL_SCALE_VALIDATION_PLATFORM_ORDER.every((platform) =>
    quotes.some((quote) =>
      quote.platform === platform
      && quote.ratePlan === ratePlan
      && quote.status === "available"
      && typeof quote.price === "number"
    )
  );
}

async function runHotelAllRatePlansForQuery(
  context: BrowserContext,
  qingmaoPage: BrowserPage,
  artifactDir: string,
  query: QingmaoHotelCandidateQuery,
  maxAttempts: number,
  onProgress?: (message: string) => void,
  shouldSkipCandidate?: (candidate: QingmaoHotelCandidate) => string | null
): Promise<{ status: "completed" | "partial"; selectedCandidate: QingmaoHotelCandidate; quotes: HotelMainRateQuote[]; message: string; skipped: string[]; attemptsUsed: number; failurePlatform?: PlatformName }> {
  await fsp.mkdir(artifactDir, { recursive: true });
  const skipped: string[] = [];
  let attemptsUsed = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const listFrame = await searchQingmaoHotelCandidates(qingmaoPage, query);
    const candidates = await collectQingmaoHotelCandidatesFromFrame(listFrame);
    const candidate = candidates[attempt];
    if (!candidate) {
      onProgress?.(`青猫候选不足：只找到 ${candidates.length} 家`);
      break;
    }
    attemptsUsed += 1;
    onProgress?.(`尝试第 ${attempt + 1}/${maxAttempts} 家：${candidate.hotelName}，开始采集 4 个口径`);
    if (!isHotelCandidateRelevantForQuery(candidate, query)) {
      skipped.push(`${candidate.hotelName}: 不属于${query.keyword}候选`);
      continue;
    }
    if (!candidate.price || candidate.price <= 0) {
      skipped.push(`${candidate.hotelName}: 候选起价为空`);
      continue;
    }
    const stabilityFailure = qingmaoSourceCandidateStabilityFailure(candidate);
    if (stabilityFailure) {
      skipped.push(`${candidate.hotelName}: ${stabilityFailure}`);
      continue;
    }
    const samplingSkipReason = shouldSkipCandidate?.(candidate);
    if (samplingSkipReason) {
      skipped.push(`${candidate.hotelName}: ${samplingSkipReason}`);
      continue;
    }

    const quotes: HotelMainRateQuote[] = [];
    let failurePlatform: PlatformName | undefined;
    let sawSameHotelFailure = false;

    try {
      onProgress?.(`${candidate.hotelName}：青猫锁店并读取 4 个口径`);
      quotes.push(...await collectQingmaoHotelAllRatePlanQuotes(qingmaoPage, artifactDir, listFrame, candidate, attempt));
    } catch (error) {
      skipped.push(`${candidate.hotelName}: 青猫锁店或读取 4 个口径失败 ${errorMessage(error)}`);
      continue;
    }

    for (const platform of HOTEL_SCALE_VALIDATION_COMPETITOR_PLATFORM_ORDER) {
      onProgress?.(`${candidate.hotelName}：${platform}同店命中并读取 4 个口径`);
      const platformArtifactDir = path.join(artifactDir, safeFilename(platform));
      let platformQuotes: HotelMainRateQuote[] = [];
      if (platform === "阿里商旅") {
        platformQuotes = await collectAliHotelAllRatePlanQuotes(context, platformArtifactDir, query, candidate);
      } else if (platform === "携程商旅") {
        platformQuotes = await collectCtripHotelAllRatePlanQuotes(context, platformArtifactDir, query, candidate);
      } else if (platform === "在途商旅") {
        platformQuotes = await collectZtripHotelAllRatePlanQuotes(context, platformArtifactDir, buildZtripHotelQueryFromQingmao(query), candidate);
      }
      quotes.push(...platformQuotes);

      const sameHotelFailure = platformQuotes.find(isHotelSameHotelHitFailureQuote);
      if (sameHotelFailure) {
        failurePlatform = sameHotelFailure.platform;
        skipped.push(`${candidate.hotelName}: ${sameHotelFailure.platform}同店命中失败 ${sameHotelFailure.error ?? ""}`.trim());
        sawSameHotelFailure = true;
        if (shouldStopHotelAllRatePlanCollectionAfterQuoteFailure(sameHotelFailure)) {
          break;
        }
      }
    }

    const completeRatePlans = HOTEL_RATE_PLAN_LABELS.filter((ratePlan) => isHotelRatePlanComplete(quotes, ratePlan));
    if (completeRatePlans.length || quotes.length) {
      return {
        status: completeRatePlans.length ? "completed" : "partial",
        selectedCandidate: candidate,
        quotes,
        message: completeRatePlans.length
          ? `${candidate.hotelName} 已形成 ${completeRatePlans.length} 个四平台完整口径：${completeRatePlans.join("、")}`
          : sawSameHotelFailure
            ? `${candidate.hotelName} 4 个口径已全部尝试；存在同店命中失败，仅进入后台留痕`
            : `${candidate.hotelName} 4 个口径均未形成四平台完整价格，仅进入后台留痕`,
        skipped,
        attemptsUsed,
        failurePlatform
      };
    }
  }

  throw new Error(`未找到可诊断酒店${skipped.length ? `：${skipped.slice(0, 6).join("；")}` : ""}`);
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
  let latestHotelSmallBatch: HotelSmallBatchProbeResult = buildInitialHotelSmallBatchProbeResult(now());
  let latestHotelScaleValidation: HotelScaleValidationResult = buildInitialHotelScaleValidationResult(now());
  let latestHotelSingleDiagnosis: HotelSingleDiagnosisProbeResult = buildInitialHotelSingleDiagnosisResult();
  let latestHotelSingleAllRatePlans: HotelSingleAllRatePlansResult = buildInitialHotelSingleAllRatePlansResult();
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
    getHotelSmallBatchStatus() {
      return latestHotelSmallBatch;
    },

    getHotelScaleValidationStatus() {
      return latestHotelScaleValidation;
    },

    getHotelSingleDiagnosisStatus() {
      return latestHotelSingleDiagnosis;
    },

    getHotelSingleAllRatePlansStatus() {
      return latestHotelSingleAllRatePlans;
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
          const rate = selectLowestHotelMainRateQuote(rates);
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

    async runHotelSmallBatchProbe() {
      const base: HotelSmallBatchProbeResult = {
        status: "running",
        city: "广州",
        targetTotal: 10,
        targetPerGroup: HOTEL_SMALL_BATCH_TARGET_PER_GROUP,
        mainRatePlan: "大床有早餐",
        completedCount: 0,
        failedCount: 0,
        partialCount: 0,
        skippedCount: 0,
        unattemptedCount: 10,
        timeoutBudget: false,
        budget: {
          totalMs: HOTEL_SMALL_BATCH_TOTAL_BUDGET_MS,
          perGroupMs: HOTEL_SMALL_BATCH_GROUP_BUDGET_MS,
          maxAttemptsPerGroup: HOTEL_SMALL_BATCH_MAX_ATTEMPTS_PER_GROUP
        },
        groups: [],
        updatedAt: new Date().toISOString(),
        message: "正在执行 10 家酒店小放量"
      };
      latestHotelSmallBatch = base;

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

        const groups: HotelSmallBatchGroupResult[] = [];
        const previousAnchors = buildPreviousHotelGroupAnchorSet();
        const usedHotelNames = new Set<string>();
        const startedAtMs = Date.now();
        let stoppedGroup: HotelGroupName | undefined;
        let stoppedByOverallBudget = false;

        const refreshGroupCounts = (groupResult: HotelSmallBatchGroupResult) => {
          groupResult.attemptedCount = groupResult.samples.filter((sample) => sample.status !== "skipped").length;
          groupResult.completedCount = groupResult.samples.filter((sample) => sample.status === "completed").length;
          groupResult.partialCount = groupResult.samples.filter((sample) => sample.status === "partial").length;
          groupResult.failedCount = groupResult.samples.filter((sample) => sample.status === "failed").length;
          groupResult.skippedCount = groupResult.samples.filter((sample) => sample.status === "skipped").length;
          groupResult.unattemptedCount = Math.max(0, groupResult.targetCount - groupResult.completedCount - groupResult.partialCount - groupResult.failedCount);
        };

        for (const [groupIndex, config] of hotelSmallBatchPilotQueries.entries()) {
          const overallStopReason = resolveHotelSmallBatchOverallBudgetStop(startedAtMs, Date.now());
          if (overallStopReason) {
            stoppedGroup = config.group;
            stoppedByOverallBudget = true;
            const query = buildHotelSmallBatchGroupDisplayQuery(now(), config);
            const groupResult: HotelSmallBatchGroupResult = {
              group: config.group,
              query,
              targetCount: HOTEL_SMALL_BATCH_TARGET_PER_GROUP,
              maxAttempts: HOTEL_SMALL_BATCH_MAX_ATTEMPTS_PER_GROUP,
              budgetMs: HOTEL_SMALL_BATCH_GROUP_BUDGET_MS,
              attemptedCount: 0,
              completedCount: 0,
              partialCount: 0,
              failedCount: 0,
              skippedCount: HOTEL_SMALL_BATCH_TARGET_PER_GROUP,
              unattemptedCount: HOTEL_SMALL_BATCH_TARGET_PER_GROUP,
              timeoutBudget: true,
              budgetStopReason: overallStopReason,
              samples: Array.from({ length: HOTEL_SMALL_BATCH_TARGET_PER_GROUP }, (_, sampleIndex) => ({
                group: config.group,
                groupIndex: groupIndex + 1,
                sampleIndex: sampleIndex + 1,
                query,
                status: "skipped" as const,
                selectedCandidate: null,
                quotes: [],
                message: `${config.group} 未开始：${overallStopReason}`,
                skipReason: overallStopReason,
                timeoutBudget: true
              }))
            };
            groups.push(groupResult);
            break;
          }

          const query = buildHotelSmallBatchGroupDisplayQuery(now(), config);
          const groupArtifactDir = path.join(options.artifactDir, "hotel-small-batch", safeFilename(config.group));
          const samples: HotelSmallBatchSample[] = [];
          const groupStartedAtMs = Date.now();
          let groupAttemptedCandidates = 0;
          const groupResult: HotelSmallBatchGroupResult = {
            group: config.group,
            query,
            targetCount: HOTEL_SMALL_BATCH_TARGET_PER_GROUP,
            maxAttempts: HOTEL_SMALL_BATCH_MAX_ATTEMPTS_PER_GROUP,
            budgetMs: HOTEL_SMALL_BATCH_GROUP_BUDGET_MS,
            attemptedCount: 0,
            completedCount: 0,
            partialCount: 0,
            failedCount: 0,
            skippedCount: 0,
            unattemptedCount: HOTEL_SMALL_BATCH_TARGET_PER_GROUP,
            timeoutBudget: false,
            samples
          };
          groups.push(groupResult);

          while (groupResult.completedCount < HOTEL_SMALL_BATCH_TARGET_PER_GROUP) {
            const groupBudgetStopReason = resolveHotelSmallBatchBudgetStop({
              maxAttempts: HOTEL_SMALL_BATCH_MAX_ATTEMPTS_PER_GROUP === null
                ? null
                : HOTEL_SMALL_BATCH_MAX_ATTEMPTS_PER_GROUP - groupAttemptedCandidates,
              budgetMs: HOTEL_SMALL_BATCH_GROUP_BUDGET_MS,
              startedAtMs: groupStartedAtMs,
              nowMs: Date.now()
            });
            const totalBudgetStopReason = resolveHotelSmallBatchOverallBudgetStop(startedAtMs, Date.now());
            const budgetStopReason = groupBudgetStopReason ?? totalBudgetStopReason;
            if (budgetStopReason) {
              groupResult.timeoutBudget = true;
              groupResult.budgetStopReason = budgetStopReason;
              stoppedGroup = config.group;
              stoppedByOverallBudget = Boolean(totalBudgetStopReason);
              const skippedTargetCount = Math.max(0, HOTEL_SMALL_BATCH_TARGET_PER_GROUP - groupResult.completedCount - groupResult.partialCount - groupResult.failedCount);
              for (let offset = 0; offset < skippedTargetCount; offset += 1) {
                samples.push({
                  group: config.group,
                  groupIndex: groupIndex + 1,
                  sampleIndex: samples.length + 1,
                  query,
                  status: "skipped",
                  selectedCandidate: null,
                  quotes: [],
                  message: `${config.group} 已停止继续找新候选：${budgetStopReason}`,
                  skipReason: budgetStopReason,
                  timeoutBudget: true
                });
              }
              refreshGroupCounts(groupResult);
              break;
            }

            const pagesBeforeSample = snapshotBrowserPages(context);
            const sampleIndex = samples.length;
            const sampleArtifactDir = path.join(groupArtifactDir, `hotel-${String(sampleIndex + 1).padStart(2, "0")}`);
            const updateProgress = (detail: string) => {
              const summary = summarizeHotelSmallBatchGroups(groups);
              latestHotelSmallBatch = {
                ...base,
                status: "running",
                completedCount: summary.completedCount,
                failedCount: summary.failedCount,
                partialCount: summary.partialCount,
                skippedCount: summary.skippedCount,
                unattemptedCount: summary.unattemptedCount,
                timeoutBudget: summary.timeoutBudget,
                stoppedGroup,
                groups,
                updatedAt: new Date().toISOString(),
                message: `正在执行 10 家酒店小放量：${config.group} 完整 ${groupResult.completedCount}/${HOTEL_SMALL_BATCH_TARGET_PER_GROUP}，候选已尝试 ${groupAttemptedCandidates + 1}，${detail}`
              };
            };

            try {
              const keywordQueries = orderedHotelSmallBatchKeywordQueries(now(), config, sampleIndex);
              const keywordErrors: string[] = [];
              let resolvedSample = false;

              for (const [keywordIndex, keywordQuery] of keywordQueries.entries()) {
                const remainingAttempts = HOTEL_SMALL_BATCH_MAX_ATTEMPTS_PER_GROUP === null
                  ? HOTEL_SMALL_BATCH_MAX_ATTEMPTS_PER_SAMPLE
                  : Math.max(1, HOTEL_SMALL_BATCH_MAX_ATTEMPTS_PER_GROUP - groupAttemptedCandidates);
                const keywordAttemptLimit = keywordQueries.length > 1
                  ? Math.max(1, Math.min(2, remainingAttempts))
                  : Math.min(HOTEL_SMALL_BATCH_MAX_ATTEMPTS_PER_SAMPLE, remainingAttempts);
                try {
                  const result = await runHotelMainRateForQuery(
                    context,
                    qingmaoPage,
                    sampleArtifactDir,
                    keywordQuery,
                    HOTEL_CALIBRATION_MAIN_RATE_PLAN,
                    keywordAttemptLimit,
                    updateProgress,
                    (candidate) => shouldSkipHotelSmallBatchCandidate(candidate, keywordQuery, usedHotelNames, previousAnchors),
                    { stopOnFirstCompetitorFailure: true }
                  );
                  groupAttemptedCandidates += Math.max(1, result.attemptsUsed);
                  const normalizedName = normalizeHotelIdentity(result.selectedCandidate.hotelName);
                  usedHotelNames.add(normalizedName);
                  const status = result.status === "completed" ? "completed" : "partial";
                  const firstUnavailable = firstUnavailableHotelMainRateQuote(result.quotes);
                  const failureReason = status === "completed" ? undefined : result.skipped.slice(-1)[0] ?? firstUnavailable?.error ?? "四平台主口径未完整";
                  samples.push({
                    group: config.group,
                    groupIndex: groupIndex + 1,
                    sampleIndex: samples.length + 1,
                    query: keywordQuery,
                    status,
                    selectedCandidate: result.selectedCandidate,
                    quotes: result.quotes,
                    message: result.message,
                    failureReason,
                    failurePlatform: status === "completed" ? undefined : result.failurePlatform ?? firstUnavailable?.platform
                  });
                  resolvedSample = true;
                  break;
                } catch (error) {
                  groupAttemptedCandidates += 1;
                  keywordErrors.push(`${keywordQuery.keyword}: ${errorMessage(error)}`);
                  const noAttemptsLeft = HOTEL_SMALL_BATCH_MAX_ATTEMPTS_PER_GROUP !== null
                    && groupAttemptedCandidates >= HOTEL_SMALL_BATCH_MAX_ATTEMPTS_PER_GROUP;
                  if (noAttemptsLeft || keywordIndex === keywordQueries.length - 1) {
                    throw new Error(keywordErrors.join("；"));
                  }
                }
              }

              if (!resolvedSample) {
                throw new Error(`${config.group} 未找到符合小放量条件的候选`);
              }
            } catch (error) {
              samples.push({
                group: config.group,
                groupIndex: groupIndex + 1,
                sampleIndex: samples.length + 1,
                query,
                status: "failed",
                selectedCandidate: null,
                quotes: [],
                message: `${config.group} 第 ${samples.length + 1} 个候选酒店小放量失败`,
                failureReason: errorMessage(error),
                error: errorMessage(error)
              });
            } finally {
              await closeCreatedBrowserPages(context, pagesBeforeSample, new Set([qingmaoPage]));
            }

            refreshGroupCounts(groupResult);
            const summary = summarizeHotelSmallBatchGroups(groups);
            latestHotelSmallBatch = {
              ...base,
              status: "running",
              completedCount: summary.completedCount,
              failedCount: summary.failedCount,
              partialCount: summary.partialCount,
              skippedCount: summary.skippedCount,
              unattemptedCount: summary.unattemptedCount,
              timeoutBudget: summary.timeoutBudget,
              stoppedGroup,
              groups,
              updatedAt: new Date().toISOString(),
              message: `正在执行 10 家酒店小放量：完整 ${summary.completedCount}/${summary.targetTotal}，不完整 ${summary.failedCount}，未尝试 ${summary.unattemptedCount}`
            };
          }

          if (stoppedByOverallBudget) {
            break;
          }
        }

        if (stoppedByOverallBudget) {
          const existingGroups = new Set(groups.map((group) => group.group));
          for (const [groupIndex, config] of hotelSmallBatchPilotQueries.entries()) {
            if (existingGroups.has(config.group)) continue;
            const query = buildHotelSmallBatchGroupDisplayQuery(now(), config);
            groups.push({
              group: config.group,
              query,
              targetCount: HOTEL_SMALL_BATCH_TARGET_PER_GROUP,
              maxAttempts: HOTEL_SMALL_BATCH_MAX_ATTEMPTS_PER_GROUP,
              budgetMs: HOTEL_SMALL_BATCH_GROUP_BUDGET_MS,
              attemptedCount: 0,
              completedCount: 0,
              partialCount: 0,
              failedCount: 0,
              skippedCount: HOTEL_SMALL_BATCH_TARGET_PER_GROUP,
              unattemptedCount: HOTEL_SMALL_BATCH_TARGET_PER_GROUP,
              timeoutBudget: true,
              budgetStopReason: "达到小放量整体时间预算",
              samples: Array.from({ length: HOTEL_SMALL_BATCH_TARGET_PER_GROUP }, (_, sampleIndex) => ({
                group: config.group,
                groupIndex: groupIndex + 1,
                sampleIndex: sampleIndex + 1,
                query,
                status: "skipped" as const,
                selectedCandidate: null,
                quotes: [],
                message: `${config.group} 未开始：达到小放量整体时间预算`,
                skipReason: "达到小放量整体时间预算",
                timeoutBudget: true
              }))
            });
          }
        }

        const summary = summarizeHotelSmallBatchGroups(groups);
        latestHotelSmallBatch = {
          ...base,
          status: summary.status,
          completedCount: summary.completedCount,
          failedCount: summary.failedCount,
          partialCount: summary.partialCount,
          skippedCount: summary.skippedCount,
          unattemptedCount: summary.unattemptedCount,
          timeoutBudget: summary.timeoutBudget,
          stoppedGroup,
          groups,
          updatedAt: new Date().toISOString(),
          message: summary.status === "completed"
            ? `10 家酒店小放量完成：完整 ${summary.completedCount}/${summary.targetTotal}`
            : `10 家酒店小放量返回 partial：完整 ${summary.completedCount}/${summary.targetTotal}，不完整 ${summary.failedCount}，未尝试 ${summary.unattemptedCount}${stoppedGroup ? `，预算停止于${stoppedGroup}` : ""}`,
          recommendation: summary.status === "completed"
            ? "可进入结果复核。"
            : "先复核失败平台和预算停止集团；如需再次真实小放量，应在确认登录态后只调用一次小放量入口。"
        };
        return latestHotelSmallBatch;
      } catch (error) {
        latestHotelSmallBatch = {
          ...base,
          status: "failed",
          updatedAt: new Date().toISOString(),
          message: "10 家酒店小放量失败",
          error: errorMessage(error)
        };
        return latestHotelSmallBatch;
      } finally {
        await browser?.disconnect?.();
      }
    },

    async runHotelScaleValidationProbe(input: HotelScaleValidationInput = {}) {
      const runStartedAt = now();
      const runArtifactDir = path.join(options.artifactDir, "hotel-scale-validation", hotelScaleValidationRunId(runStartedAt));
      const base: HotelScaleValidationResult = {
        ...buildInitialHotelScaleValidationResult(runStartedAt, input),
        status: "running",
        artifactDir: runArtifactDir,
        updatedAt: new Date().toISOString(),
        message: `正在执行 ${buildInitialHotelScaleValidationResult(runStartedAt, input).targetTotal} 家酒店放量验证 / 准生产诊断跑`
      };
      latestHotelScaleValidation = base;

      let browser: BrowserConnection | null = null;

      try {
        await fsp.mkdir(runArtifactDir, { recursive: true });
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

        const groups: HotelScaleValidationGroupResult[] = base.groups.map((group) => ({ ...group, samples: [] }));
        const previousAnchors = buildPreviousHotelGroupAnchorSet();
        const usedHotelNames = new Set<string>();
        const startedAtMs = Date.now();
        let stoppedGroup: HotelGroupName | undefined;
        let stoppedByOverallBudget = false;

        const publishProgress = (detail: string) => {
          const summary = summarizeHotelScaleValidationGroups(groups);
          latestHotelScaleValidation = {
            ...base,
            status: "running",
            groups,
            completedCount: summary.completedCount,
            failedCount: summary.failedCount,
            partialCount: summary.partialCount,
            skippedCount: summary.skippedCount,
            timeoutCount: summary.timeoutCount,
            unattemptedCount: summary.unattemptedCount,
            evidenceCompleteCount: summary.evidenceCompleteCount,
            evidenceMissingCount: summary.evidenceMissingCount,
            evidenceSaveFailedCount: summary.evidenceSaveFailedCount,
            evidenceCompleteRate: summary.evidenceCompleteRate,
            timeoutBudget: summary.timeoutBudget,
            stoppedGroup,
            timing: summary.timing,
            updatedAt: new Date().toISOString(),
            message: `正在执行 ${base.targetTotal} 家酒店放量验证 / 准生产诊断跑：完整 ${summary.completedCount}/${summary.targetTotal}，${detail}`
          };
        };

        for (const [groupIndex, config] of hotelScaleValidationPilotQueries.entries()) {
          const groupResult = groups[groupIndex];
          const groupArtifactDir = path.join(runArtifactDir, safeFilename(config.group));
          const groupStartedAtMs = Date.now();
          let groupAttemptedCandidates = 0;

          while (groupResult.completedCount < groupResult.targetCount) {
            const totalBudgetStopReason = resolveHotelScaleValidationOverallBudgetStop(startedAtMs, Date.now(), base.budget.totalMs);
            const groupBudgetStopReason = resolveHotelScaleValidationBudgetStop({
              maxAttempts: HOTEL_SCALE_VALIDATION_MAX_ATTEMPTS_PER_GROUP - groupAttemptedCandidates,
              budgetMs: base.budget.perGroupMs,
              startedAtMs: groupStartedAtMs,
              nowMs: Date.now()
            });
            const budgetStopReason = totalBudgetStopReason ?? groupBudgetStopReason;

            if (budgetStopReason) {
              groupResult.timeoutBudget = true;
              groupResult.budgetStopReason = budgetStopReason;
              stoppedGroup = config.group;
              stoppedByOverallBudget = Boolean(totalBudgetStopReason);
              const remaining = Math.max(0, groupResult.targetCount - groupResult.completedCount - groupResult.partialCount - groupResult.failedCount - (groupResult.timeoutCount ?? 0));
              for (let offset = 0; offset < remaining; offset += 1) {
                const sampleIndex = groupResult.samples.length + 1;
                const sampleDir = path.join(groupArtifactDir, `hotel-${String(sampleIndex).padStart(2, "0")}`);
                const resultPath = path.join(sampleDir, "result.json");
                const evidence = await buildHotelScaleValidationFailedEvidenceFromQingmaoPage(qingmaoPage, sampleDir, budgetStopReason);
                const nowIso = new Date().toISOString();
                const sample = await finalizeHotelScaleValidationSample({
                  group: config.group,
                  groupIndex: groupIndex + 1,
                  sampleIndex,
                  query: groupResult.query,
                  status: totalBudgetStopReason ? "skipped" : "timeout",
                  selectedCandidate: null,
                  quotes: [],
                  message: `${config.group} 已停止继续找新候选：${budgetStopReason}`,
                  currentPlatform: "青猫差旅",
                  currentStep: "budget-stop",
                  failureType: "budget_stop",
                  failureReason: budgetStopReason,
                  pathRecords: [{
                    platform: "青猫差旅",
                    step: "budget-stop",
                    status: totalBudgetStopReason ? "skipped" : "timeout",
                    startedAt: nowIso,
                    endedAt: nowIso,
                    durationMs: 0,
                    finalUrl: evidence.finalUrl,
                    screenshotPath: evidence.screenshotPath,
                    failureType: "budget_stop",
                    failureReason: budgetStopReason
                  }],
                  ...evidence
                }, resultPath);
                groupResult.samples.push(sample);
              }
              refreshHotelScaleValidationGroupCounts(groupResult);
              break;
            }

            const sampleIndex = groupResult.samples.length + 1;
            const sampleArtifactDir = path.join(groupArtifactDir, `hotel-${String(sampleIndex).padStart(2, "0")}`);
            const resultPath = path.join(sampleArtifactDir, "result.json");
            const pagesBeforeSample = snapshotBrowserPages(context);
            publishProgress(`${config.group} 第 ${sampleIndex} 家候选启动`);

            try {
              const keywordQueries = orderedHotelScaleValidationQueries(base, config, sampleIndex - 1, groupAttemptedCandidates);
              const keywordErrors: string[] = [];
              let resolved = false;

              for (const keywordQuery of keywordQueries) {
                const remainingAttempts = Math.max(1, HOTEL_SCALE_VALIDATION_MAX_ATTEMPTS_PER_GROUP - groupAttemptedCandidates);
                const sampleStartedAtMs = Date.now();
                try {
                  const result = await runHotelAllRatePlansForQuery(
                    context,
                    qingmaoPage,
                    sampleArtifactDir,
                    keywordQuery,
                    Math.min(remainingAttempts, HOTEL_SMALL_BATCH_MAX_ATTEMPTS_PER_SAMPLE),
                    (detail) => publishProgress(`${config.group} 第 ${sampleIndex} 家：${detail}`),
                    (candidate) => shouldSkipHotelSmallBatchCandidate(candidate, keywordQuery, usedHotelNames, previousAnchors)
                  );
                  groupAttemptedCandidates += Math.max(1, result.attemptsUsed);
                  usedHotelNames.add(normalizeHotelIdentity(result.selectedCandidate.hotelName));

                  const pathRecords = buildHotelScaleValidationPathRecordsFromQuotes(result.quotes, sampleStartedAtMs);
                  const unavailable = result.status === "completed"
                    ? null
                    : result.quotes.find(isHotelSameHotelHitFailureQuote) ?? firstUnavailableHotelMainRateQuote(result.quotes);
                  const excludedRateRows = result.status === "completed" ? [] : collectExcludedHotelRateRows(result.quotes);
                  const failureRecord = unavailable
                    ? pathRecords.find((record) => record.platform === unavailable.platform && record.status === "failed")
                    : undefined;
                  const sample = await finalizeHotelScaleValidationSample({
                    group: config.group,
                    groupIndex: groupIndex + 1,
                    sampleIndex,
                    attemptIndex: groupAttemptedCandidates,
                    query: keywordQuery,
                    status: result.status,
                    selectedCandidate: result.selectedCandidate,
                    quotes: result.quotes,
                    message: result.message,
                    currentPlatform: unavailable?.platform,
                    currentStep: unavailable ? "read-main-rate" : undefined,
                    failureType: excludedRateRows.length ? "rate_row_excluded_bed_assignment" : failureRecord?.failureType,
                    failureReason: unavailable?.error ?? failureRecord?.failureReason,
                    finalUrl: unavailable?.finalUrl,
                    screenshotPath: unavailable?.screenshotPath,
                    diagnosisPath: unavailable?.diagnosisPath,
                    pageTextSummary: buildHotelScalePageTextSummary(result.quotes),
                    pathRecords,
                    aliEvidence: unavailable?.platform === "阿里商旅" ? await collectAliScaleEvidencePaths(sampleArtifactDir) : undefined,
                    excludedRateRows: excludedRateRows.length ? excludedRateRows : undefined,
                    evidenceStatus: result.status === "completed" ? "complete" : undefined
                  }, resultPath);
                  groupResult.samples.push(sample);
                  resolved = true;
                  break;
                } catch (error) {
                  groupAttemptedCandidates += 1;
                  keywordErrors.push(`${keywordQuery.city}/${keywordQuery.keyword}: ${errorMessage(error)}`);
                  if (groupAttemptedCandidates >= HOTEL_SCALE_VALIDATION_MAX_ATTEMPTS_PER_GROUP) {
                    throw new Error(keywordErrors.join("；"));
                  }
                }
              }

              if (!resolved) {
                throw new Error(`${config.group} 未找到符合 ${base.targetTotal} 家放量验证条件的候选`);
              }
            } catch (error) {
              const failureReason = errorMessage(error);
              const evidence = await buildHotelScaleValidationFailedEvidenceFromQingmaoPage(qingmaoPage, sampleArtifactDir, failureReason);
              const failureType: HotelScaleValidationFailureType = /候选不足|未找到青猫|未找到.*候选/.test(failureReason)
                ? "qingmao_candidate_shortage"
                : "unknown_technical_failure";
              const nowIso = new Date().toISOString();
              const sample = await finalizeHotelScaleValidationSample({
                group: config.group,
                groupIndex: groupIndex + 1,
                sampleIndex,
                query: groupResult.query,
                status: "failed",
                selectedCandidate: null,
                quotes: [],
                message: `${config.group} 第 ${sampleIndex} 家酒店放量验证失败`,
                currentPlatform: "青猫差旅",
                currentStep: failureType === "qingmao_candidate_shortage" ? "qingmao-candidate-search" : "run-sample",
                failureType,
                failureReason,
                pathRecords: [{
                  platform: "青猫差旅",
                  step: failureType === "qingmao_candidate_shortage" ? "qingmao-candidate-search" : "run-sample",
                  status: "failed",
                  startedAt: nowIso,
                  endedAt: nowIso,
                  durationMs: 0,
                  finalUrl: evidence.finalUrl,
                  screenshotPath: evidence.screenshotPath,
                  failureType,
                  failureReason
                }],
                ...evidence
              }, resultPath);
              groupResult.samples.push(sample);
            } finally {
              await closeCreatedBrowserPages(context, pagesBeforeSample, new Set([qingmaoPage]));
            }

            refreshHotelScaleValidationGroupCounts(groupResult);
            groupResult.summaryPath = path.join(groupArtifactDir, "group-summary.json");
            await writeJsonArtifact(groupResult.summaryPath, groupResult);
            publishProgress(`${config.group} 完整 ${groupResult.completedCount}/${groupResult.targetCount}，候选已尝试 ${groupAttemptedCandidates}/${HOTEL_SCALE_VALIDATION_MAX_ATTEMPTS_PER_GROUP}`);
          }

          groupResult.summaryPath = path.join(groupArtifactDir, "group-summary.json");
          await writeJsonArtifact(groupResult.summaryPath, groupResult);
          if (stoppedByOverallBudget) {
            break;
          }
        }

        const summary = summarizeHotelScaleValidationGroups(groups);
        const summaryPath = path.join(runArtifactDir, "summary.json");
        const diagnosticReviewPath = path.join(runArtifactDir, "diagnostic-review.html");
        latestHotelScaleValidation = {
          ...base,
          status: summary.status,
          groups,
          completedCount: summary.completedCount,
          failedCount: summary.failedCount,
          partialCount: summary.partialCount,
          skippedCount: summary.skippedCount,
          timeoutCount: summary.timeoutCount,
          unattemptedCount: summary.unattemptedCount,
          evidenceCompleteCount: summary.evidenceCompleteCount,
          evidenceMissingCount: summary.evidenceMissingCount,
          evidenceSaveFailedCount: summary.evidenceSaveFailedCount,
          evidenceCompleteRate: summary.evidenceCompleteRate,
          timeoutBudget: summary.timeoutBudget,
          stoppedGroup,
          summaryPath,
          diagnosticReviewPath,
          timing: summary.timing,
          updatedAt: new Date().toISOString(),
          message: summary.status === "completed"
            ? `${base.targetTotal} 家酒店放量验证 / 准生产诊断跑完成：完整 ${summary.completedCount}/${summary.targetTotal}`
            : `${base.targetTotal} 家酒店放量验证 / 准生产诊断跑返回 ${summary.status}：完整 ${summary.completedCount}/${summary.targetTotal}，证据完整率 ${Math.round(summary.evidenceCompleteRate * 100)}%`,
          recommendation: summary.status === "completed"
            ? "可复核 summary.json、各集团 group-summary.json 与每个样本 result.json 后，再讨论是否进入日常采集规则。"
            : "先复盘 evidence_missing / evidence_save_failed、超时样本和最慢步骤；证据链不完整时优先修证据链。"
        };
        await writeJsonArtifact(summaryPath, {
          ...summary,
          checkInDate: latestHotelScaleValidation.checkInDate,
          checkOutDate: latestHotelScaleValidation.checkOutDate,
          nights: latestHotelScaleValidation.nights,
          mode: latestHotelScaleValidation.mode,
          targetPerGroup: latestHotelScaleValidation.targetPerGroup,
          diagnosticReviewPath: latestHotelScaleValidation.diagnosticReviewPath,
          budget: latestHotelScaleValidation.budget,
          platformOrder: latestHotelScaleValidation.platformOrder,
          cityPool: latestHotelScaleValidation.cityPool,
          groups: groups.map((group) => ({
            group: group.group,
            targetCount: group.targetCount,
            attemptedCount: group.attemptedCount,
            completedCount: group.completedCount,
            partialCount: group.partialCount,
            failedCount: group.failedCount,
            skippedCount: group.skippedCount,
            timeoutCount: group.timeoutCount ?? 0,
            unattemptedCount: group.unattemptedCount,
            timeoutBudget: group.timeoutBudget,
            budgetStopReason: group.budgetStopReason,
            summaryPath: group.summaryPath
          }))
        });
        await fsp.writeFile(diagnosticReviewPath, buildHotelDiagnosticReviewHtml(latestHotelScaleValidation, { htmlPath: diagnosticReviewPath }), "utf8");
        return latestHotelScaleValidation;
      } catch (error) {
        latestHotelScaleValidation = {
          ...base,
          status: "failed",
          updatedAt: new Date().toISOString(),
          message: `${base.targetTotal} 家酒店放量验证 / 准生产诊断跑失败`,
          error: errorMessage(error)
        };
        return latestHotelScaleValidation;
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

    async runHotelSingleAllRatePlansProbe(input: HotelSingleAllRatePlansInput) {
      const query = hotelSingleAllRatePlansQueryFromInput(input);
      const runId = `single-hotel-all-rate-plans-${formatBatchTimestamp(now())}`;
      const artifactDir = path.join(options.artifactDir, "hotel-single-all-rate-plans", runId);
      const resultPath = path.join(artifactDir, "result.json");
      const diagnosticReviewPath = path.join(artifactDir, "diagnostic-review.html");
      const base: HotelSingleAllRatePlansResult = {
        status: "running",
        mode: "single-all-rate-plans",
        input,
        query,
        selectedCandidate: null,
        sourceHotel: null,
        platformOrder: HOTEL_SINGLE_ALL_RATE_PLANS_PLATFORM_ORDER,
        platforms: [],
        completeRatePlans: [],
        artifactDir,
        resultPath,
        diagnosticReviewPath,
        updatedAt: new Date().toISOString(),
        message: `正在指定单酒店一次性四口径复验：${input.city}/${input.keyword}`
      };
      latestHotelSingleAllRatePlans = base;

      let browser: BrowserConnection | null = null;
      let pagesBeforeRun: Set<BrowserPage> | null = null;
      let qingmaoPage: BrowserPage | null = null;

      const finalize = async (result: HotelSingleAllRatePlansResult) => {
        latestHotelSingleAllRatePlans = {
          ...result,
          updatedAt: new Date().toISOString()
        };
        await writeJsonArtifact(resultPath, latestHotelSingleAllRatePlans);
        await fsp.writeFile(
          diagnosticReviewPath,
          buildHotelSingleAllRatePlansReviewHtml(latestHotelSingleAllRatePlans, { htmlPath: diagnosticReviewPath }),
          "utf8"
        );
        return latestHotelSingleAllRatePlans;
      };

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

        const platforms: HotelCalibrationPlatformResult[] = [];
        const qingmaoDiagnosis = await diagnoseQingmaoHotelSingleAllRatePlans(qingmaoPage, artifactDir, query);
        const candidate = qingmaoDiagnosis.candidate;
        platforms.push(qingmaoDiagnosis.result);
        latestHotelSingleAllRatePlans = {
          ...base,
          selectedCandidate: candidate,
          sourceHotel: {
            hotelName: candidate.hotelName,
            city: query.city,
            address: candidate.address,
            doorPlate: extractHotelDoorPlate(candidate.address),
            rawText: candidate.rawText
          },
          platforms,
          updatedAt: new Date().toISOString(),
          message: `已锁定青猫源酒店：${candidate.hotelName}，开始一次性确认竞品同店并读取 4 个口径`
        };

        const pagesBeforeCompetitors = snapshotBrowserPages(context);
        try {
          platforms.push(await diagnoseCtripHotelCalibration(context, artifactDir, query, candidate));
          latestHotelSingleAllRatePlans = {
            ...latestHotelSingleAllRatePlans,
            platforms,
            updatedAt: new Date().toISOString(),
            message: `已完成携程商旅同店确认和四口径读取：${candidate.hotelName}`
          };
          platforms.push(await diagnoseAliHotelCalibration(context, artifactDir, query, candidate));
          latestHotelSingleAllRatePlans = {
            ...latestHotelSingleAllRatePlans,
            platforms,
            updatedAt: new Date().toISOString(),
            message: `已完成阿里商旅同店确认和四口径读取：${candidate.hotelName}`
          };
          platforms.push(await diagnoseZtripHotelSingleAllRatePlans(context, artifactDir, query, candidate));
        } finally {
          await closeCreatedBrowserPages(context, pagesBeforeCompetitors, new Set([qingmaoPage]));
        }

        const completeRatePlans = selectCompleteHotelCalibrationRatePlans(platforms, HOTEL_SINGLE_ALL_RATE_PLANS_PLATFORM_ORDER);
        const hasAnyRate = platforms.some((platform) => HOTEL_RATE_PLAN_LABELS.some((ratePlan) => typeof hotelCalibrationRatePrice(platform, ratePlan) === "number"));
        const allRatePlansComplete = completeRatePlans.length === HOTEL_RATE_PLAN_LABELS.length;
        return await finalize({
          ...base,
          status: allRatePlansComplete ? "completed" : hasAnyRate ? "partial" : "failed",
          selectedCandidate: candidate,
          sourceHotel: {
            hotelName: candidate.hotelName,
            city: query.city,
            address: candidate.address,
            doorPlate: extractHotelDoorPlate(candidate.address),
            rawText: candidate.rawText
          },
          platforms,
          completeRatePlans,
          message: allRatePlansComplete
            ? `${candidate.hotelName} 指定单酒店一次性四口径复验完成：4/4 个口径四平台完整`
            : `${candidate.hotelName} 指定单酒店一次性四口径复验完成：完整口径 ${completeRatePlans.length}/4`
        });
      } catch (error) {
        return await finalize({
          ...latestHotelSingleAllRatePlans,
          status: "failed",
          message: "指定单酒店一次性四口径复验失败",
          error: errorMessage(error)
        });
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
            const qingmaoQuote = selectLowestHotelMainRateQuote(parseQingmaoHotelMainRatesText(detailText, HOTEL_VALIDATION_RATE_PLAN));
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

            if (qingmaoDiagnosis.result.sameHotel === true) {
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

          const defaultRatePlan = selectHotelCalibrationDefaultRatePlan(platforms, platformOrder);
          const complete = defaultRatePlan !== null;
          const hasAnyPrice = platforms.some((platform) => HOTEL_RATE_PLAN_LABELS.some((ratePlan) => typeof hotelCalibrationRatePrice(platform, ratePlan) === "number"));
          samples.push({
            index: index + 1,
            status: complete ? "completed" : hasAnyPrice ? "partial" : "failed",
            sourceHotel: {
              hotelName: lockedCandidate.hotelName,
              city: query.city,
              address: lockedCandidate.address,
              doorPlate: extractHotelDoorPlate(lockedCandidate.address),
              rawText: lockedCandidate.rawText
            },
            platforms,
            message: complete
              ? `${lockedCandidate.hotelName} ${defaultRatePlan}四平台均有价格`
              : `${lockedCandidate.hotelName} 校准完成，4 个口径均未形成四平台完整价格`
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

export function mergeQingmaoHotelCandidatesFromTexts(rawTexts: string[]) {
  const candidates = new Map<string, QingmaoHotelCandidate>();
  for (const rawText of rawTexts) {
    for (const candidate of parseQingmaoHotelCandidatesText(rawText)) {
      const key = normalizeHotelIdentity(candidate.hotelName);
      if (!key || candidates.has(key)) continue;
      candidates.set(key, candidate);
    }
  }
  return Array.from(candidates.values());
}

export function parseQingmaoHotelMainRatesText(rawText: string, ratePlan: HotelRatePlanLabel = HOTEL_VALIDATION_RATE_PLAN): HotelMainRateQuote[] {
  const lines = rawText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const hotelName = lines[0] ?? "";
  return buildQingmaoHotelRoomBlocks(lines)
    .flatMap((block) => qingmaoHotelRatesFromRoomBlock(block, hotelName, ratePlan));
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
  if (isHotelRateLineExcludedByBedAssignment(rawText, { mainRoomTypeText: blockLines[0] ?? "" }).excluded) {
    return null;
  }
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

function qingmaoHotelRatesFromRoomBlock(blockLines: string[], hotelName: string, ratePlan: HotelRatePlanLabel): HotelMainRateQuote[] {
  const roomType = blockLines[0]?.replace(/^\d+$/, "").trim() ?? "";
  const rawText = blockLines.join(" ");
  if (isHotelRateLineExcludedByBedAssignment(rawText, { mainRoomTypeText: roomType }).excluded) {
    return [];
  }
  if (inferQingmaoHotelBedType(blockLines) !== hotelRatePlanBedType(ratePlan)) {
    return [];
  }

  const packageLines = splitQingmaoHotelRoomPackageLines(blockLines);
  const quotes = packageLines
    .map((lines) => qingmaoHotelRateFromRoomBlock(lines, hotelName, ratePlan))
    .filter((quote): quote is HotelMainRateQuote => Boolean(quote));

  if (quotes.length > 0) {
    return quotes;
  }

  const fallback = qingmaoHotelRateFromRoomBlock(blockLines, hotelName, ratePlan);
  return fallback ? [fallback] : [];
}

function splitQingmaoHotelRoomPackageLines(blockLines: string[]) {
  const priceStarts = blockLines
    .map((line, index) => (isQingmaoHotelRoomPackagePriceStart(blockLines, index) ? index : -1))
    .filter((index) => index >= 0);
  if (priceStarts.length <= 1) return [blockLines];

  const roomHeader = blockLines[0] ?? "";
  return priceStarts.map((priceStart, index) => {
    const previousPriceEnd = index > 0 ? qingmaoHotelRoomPackagePriceEnd(blockLines, priceStarts[index - 1]) : 0;
    const startIndex = Math.max(1, previousPriceEnd + 1);
    const endIndex = qingmaoHotelRoomPackagePriceEnd(blockLines, priceStart) + 1;
    return [roomHeader, ...blockLines.slice(startIndex, endIndex)].filter(Boolean);
  });
}

function isQingmaoHotelRoomPackagePriceStart(lines: string[], index: number) {
  const line = lines[index] ?? "";
  if (/[￥¥]\s*\d{2,5}/.test(line)) return true;
  return /^[￥¥]$/.test(line) && /^\d{2,5}$/.test(lines[index + 1] ?? "");
}

function qingmaoHotelRoomPackagePriceEnd(lines: string[], priceStartIndex: number) {
  let endIndex = priceStartIndex;
  if (/^[￥¥]$/.test(lines[priceStartIndex] ?? "") && /^\d{2,5}$/.test(lines[priceStartIndex + 1] ?? "")) {
    endIndex = priceStartIndex + 1;
  }
  if (/^起$/.test(lines[endIndex + 1] ?? "")) {
    endIndex += 1;
  }
  return endIndex;
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
  const breakfastLines = blockLines.filter((line) => /含早餐|含早|1份早餐|单份早餐|单早|2份早餐|双份早餐|双早|无早餐|无早|不含早|无餐食/.test(line));
  const decisiveLine = breakfastLines[breakfastLines.length - 1] ?? "";
  if (/无早餐|无早|不含早|无餐食/.test(decisiveLine)) return "无早餐";
  if (/含早餐|含早|1份早餐|单份早餐|单早|2份早餐|双份早餐|双早/.test(decisiveLine)) return "有早餐";
  return "";
}

function parseQingmaoHotelRoomPrice(rawText: string) {
  const prices = Array.from(rawText.matchAll(/[￥¥]\s*(\d{2,5})(?:\s*起)?/g))
    .map((match) => Number(match[1]))
    .filter((price) => price >= 80);
  return prices.length ? Math.min(...prices) : null;
}

function qingmaoHasVisibleRatePlanBlockSignal(rawText: string, ratePlan: HotelRatePlanLabel) {
  return parseQingmaoHotelMainRatesText(rawText, ratePlan)
    .some((rate) => rate.status === "available" && typeof rate.price === "number");
}

function qingmaoHasVisibleRatePlanSignal(rawText: string, ratePlan: HotelRatePlanLabel) {
  const text = rawText.replace(/\s+/g, " ");
  const hasBedType = hotelRatePlanBedType(ratePlan) === "双床" ? /双床/.test(text) : /大床/.test(text);
  const hasNoBreakfast = /无早餐|无早|不含早|无餐食/.test(text);
  const hasBreakfast = /含早餐|含早|1份早餐|单份早餐|单早|2份早餐|双份早餐|双早/.test(text);
  const matchesBreakfast = ratePlan.endsWith("无早餐") ? hasNoBreakfast : hasBreakfast;
  return hasBedType && matchesBreakfast && /[￥¥]\s*\d{2,5}(?:\s*起)?/.test(text);
}

export function selectLowestHotelMainRateQuote<T extends HotelMainRateQuote>(rates: T[]): T | null {
  return rates
    .filter((rate) => rate.status === "available" && typeof rate.price === "number")
    .sort((left, right) => (left.price ?? Number.MAX_SAFE_INTEGER) - (right.price ?? Number.MAX_SAFE_INTEGER))[0] ?? null;
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

    const snippetLines = boundedHotelRoomSnippet(lines, index, 18);
    const snippet = snippetLines.join(" ");
    const exclusionContext = [
      ...lines.slice(Math.max(0, index - 2), index),
      ...snippetLines
    ].join(" ");
    if (isHotelRateLineExcludedByBedAssignment(exclusionContext, { mainRoomTypeText: roomType }).excluded) {
      continue;
    }
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
  return buildAliHotelRoomBlocks(lines)
    .flatMap((blockLines) => aliHotelRatesFromRoomBlock(blockLines, hotelName, ratePlan));
}

function buildAliHotelRoomBlocks(lines: string[]) {
  const blocks: string[][] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!isLikelyAliHotelRoomHeader(lines, index)) continue;
    let endIndex = Math.min(lines.length, index + 36);
    for (let nextIndex = index + 1; nextIndex < endIndex; nextIndex += 1) {
      if (isLikelyAliHotelRoomHeader(lines, nextIndex)) {
        endIndex = nextIndex;
        break;
      }
    }
    blocks.push(lines.slice(index, endIndex));
  }
  return blocks;
}

function isLikelyAliHotelRoomHeader(lines: string[], index: number) {
  const line = lines[index]?.trim() ?? "";
  if (!line || line.length > 48 || /^\d+$/.test(line)) return false;
  if (/[￥¥]|早餐|取消|入住|个人支付|在线付|可开专票|立即确认|预计|仅剩|加载更多|更多详情|酒店详情|酒店介绍|预订|评论|消息中心/.test(line)) return false;

  const previousLine = lines[index - 1] ?? "";
  if (/含早餐|含早|1份早餐|单份早餐|单早|2份早餐|双份早餐|双早|无早餐|无早|不含早|无餐食/.test(previousLine)) {
    return false;
  }
  if (hasAliHotelRoomTitleBeforeOffer(lines, index) && /^(大床|双床|1张)/.test(line)) {
    return false;
  }

  if (isAliHotelRoomTitleLine(line)) return true;
  if (/^(大床|双床)$/.test(line)) return true;
  if (/^1张[^，,。|]*?(?:大床|双人床)$/.test(line)) return true;
  return false;
}

function isAliHotelRoomTitleLine(line: string) {
  return /房/.test(line) && /大床|双床|床房|客房|标间|套房/.test(line) && !/[㎡平方米]/.test(line);
}

function hasAliHotelRoomTitleBeforeOffer(lines: string[], index: number) {
  const minIndex = Math.max(0, index - 8);
  for (let currentIndex = index - 1; currentIndex >= minIndex; currentIndex -= 1) {
    const line = lines[currentIndex] ?? "";
    if (/[￥¥]|早餐|个人支付|在线付/.test(line)) return false;
    if (isAliHotelRoomTitleLine(line)) return true;
  }
  return false;
}

function aliHotelRatesFromRoomBlock(blockLines: string[], hotelName: string, ratePlan: HotelRatePlanLabel): HotelMainRateQuote[] {
  const roomType = blockLines[0]?.trim() ?? "";
  if (!roomType) return [];
  const contextLines = aliHotelRoomContextLines(blockLines);
  const roomBedType = inferAliHotelRoomBedType(contextLines);
  const offerLineGroups = splitAliHotelRoomOfferLines(blockLines);
  return offerLineGroups
    .map((offerLines) => aliHotelRateFromOfferLines(roomType, contextLines, offerLines, hotelName, ratePlan, roomBedType))
    .filter((quote): quote is HotelMainRateQuote => Boolean(quote));
}

function aliHotelRoomContextLines(blockLines: string[]) {
  const firstOfferIndex = blockLines.findIndex((line, index) => index > 0 && aliHotelBreakfastFromText(line));
  const contextEnd = firstOfferIndex >= 0 ? firstOfferIndex : Math.min(blockLines.length, 8);
  return blockLines.slice(0, contextEnd);
}

function splitAliHotelRoomOfferLines(blockLines: string[]) {
  const offerStarts = blockLines
    .map((line, index) => (index > 0 && aliHotelBreakfastFromText(line) ? index : -1))
    .filter((index) => index >= 0);
  if (!offerStarts.length) return [blockLines];

  return offerStarts.map((startIndex, position) => {
    const endIndex = position + 1 < offerStarts.length ? offerStarts[position + 1] : blockLines.length;
    return blockLines.slice(startIndex, endIndex);
  });
}

function aliHotelRateFromOfferLines(
  roomType: string,
  contextLines: string[],
  offerLines: string[],
  hotelName: string,
  ratePlan: HotelRatePlanLabel,
  roomBedType: "大床" | "双床" | ""
): HotelMainRateQuote | null {
  const rawText = [roomType, ...offerLines].join(" ");
  if (isHotelRateLineExcludedByBedAssignment([...contextLines, ...offerLines].join(" "), { mainRoomTypeText: roomType }).excluded) {
    return null;
  }

  const breakfast = aliHotelBreakfastFromText(offerLines.join(" "));
  const bedType = inferAliHotelOfferBedType(offerLines.join(" "), roomBedType);
  const price = parseAliHotelOfferPrice(offerLines.join(" "));
  if (bedType !== hotelRatePlanBedType(ratePlan) || breakfast !== hotelRatePlanBreakfast(ratePlan) || typeof price !== "number") {
    return null;
  }

  return {
    platform: "阿里商旅" as const,
    status: "available" as const,
    price,
    hotelName,
    roomType,
    ratePlan,
    rawText
  };
}

function inferAliHotelRoomBedType(lines: string[]): "大床" | "双床" | "" {
  const roomType = lines[0] ?? "";
  if (/双床/.test(roomType)) return "双床";
  if (/大床/.test(roomType) && !/双床/.test(roomType)) return "大床";
  const text = lines.join(" ");
  if (/双床|2张|两张/.test(text)) return "双床";
  if (/大床|1张[^，,。|]*?(?:大床|双人床)/.test(text)) return "大床";
  return "";
}

function inferAliHotelOfferBedType(offerText: string, roomBedType: "大床" | "双床" | ""): "大床" | "双床" | "" {
  if (/双床/.test(offerText)) return "双床";
  if (/大床/.test(offerText)) return "大床";
  if (/2张|两张/.test(offerText) && !/大床/.test(offerText)) return "双床";
  if (/多张床|多床/.test(offerText)) return roomBedType;
  return roomBedType;
}

function aliHotelBreakfastFromText(text: string): "有早餐" | "无早餐" | "" {
  if (/无早餐|无早|不含早|无餐食/.test(text)) return "无早餐";
  if (/含早餐|含早|1份早餐|单份早餐|单早|2份早餐|双份早餐|双早/.test(text)) return "有早餐";
  return "";
}

function parseAliHotelOfferPrice(text: string) {
  const priceValues = Array.from(text.matchAll(/[￥¥]\s*(\d{2,5}(?:\.\d+)?)/g))
    .map((match) => Number(match[1]))
    .filter((price) => price >= 80);
  return priceValues.length ? Math.min(...priceValues) : null;
}

function buildAliHotelRatePlanDiagnosticText(rawText: string, ratePlan: HotelRatePlanLabel) {
  const lines = rawText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const blocks = buildAliHotelRoomBlocks(lines);
  if (!blocks.length) return "";

  const targetBedType = hotelRatePlanBedType(ratePlan);
  const targetBreakfast = hotelRatePlanBreakfast(ratePlan);
  const rows = blocks.flatMap((blockLines) => {
    const roomType = blockLines[0] ?? "";
    const contextLines = aliHotelRoomContextLines(blockLines);
    const roomBedType = inferAliHotelRoomBedType(contextLines);
    return splitAliHotelRoomOfferLines(blockLines).map((offerLines) => {
      const offerText = offerLines.join(" ");
      const bedType = inferAliHotelOfferBedType(offerText, roomBedType);
      const breakfast = aliHotelBreakfastFromText(offerText);
      const price = parseAliHotelOfferPrice(offerText);
      const matched = bedType === targetBedType && breakfast === targetBreakfast && typeof price === "number";
      return `${matched ? "匹配候选" : "排除"} | 房型=${roomType || "未知"} | 床型=${bedType || "未识别"} | 早餐=${breakfast || "未识别"} | 价格=${price ?? "未识别"} | ${offerText}`;
    });
  });

  return rows.join("\n");
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
  if (/无早餐|无早|不含早|无餐食/.test(value)) return "无早餐";
  if (/含早餐|含早|2份早餐|双份早餐|双早|1份早餐|单份早餐|单早/.test(value)) return "有早餐";
  return "";
}

function ztripBreakfastPattern() {
  return /含早餐|含早|2份早餐|双份早餐|双早|1份早餐|单份早餐|单早|无早餐|无早|不含早|无餐食/g;
}

export function parseZtripHotelRatesText(rawText: string): ZtripHotelRate[] {
  return parseZtripHotelRatesTextForRatePlan(rawText);
}

function isZtripRoomHeader(line: string) {
  return /房/.test(line)
    && !/[|｜]/.test(line)
    && !/CNY|￥|¥|m²|㎡|可住|早餐|取消|筛选|酒店最低价|住客评价|酒店亮点|酒店政策|订房须知|地处|附近|不错|洗衣房|健身房|会议厅|商务中心|客房|房间很大/.test(line)
    && line.length <= 36;
}

function priceFromZtripSnippet(snippet: string) {
  const prices = [
    ...Array.from(snippet.matchAll(/CNY\s*(\d{2,5})/gi)),
    ...Array.from(snippet.matchAll(/[￥¥]\s*(\d{2,5})(?:\s*起)?/g))
  ]
    .map((match) => Number(match[1]))
    .filter((price) => price >= 80);
  return prices.length ? Math.min(...prices) : null;
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

function buildZtripHotelRateFromRoomSection(input: {
  hotelName: string;
  roomLine: string;
  bedType: ZtripHotelRate["bedType"];
  breakfast: ZtripHotelRate["breakfast"];
  price: number | null;
  rawText: string;
}): ZtripHotelRate | null {
  if (!input.bedType || !input.breakfast) return null;
  if (isHotelRateLineExcludedByBedAssignment(input.rawText, { mainRoomTypeText: input.roomLine }).excluded) return null;
  return {
    hotelName: input.hotelName,
    roomType: input.roomLine.split(/\d+m²|CNY/i)[0].trim(),
    bedType: input.bedType,
    breakfast: input.breakfast,
    price: input.price,
    rawText: input.rawText
  };
}

function parseZtripExpandedPackageRows(input: {
  hotelName: string;
  roomLine: string;
  snippetLines: string[];
  requestedBedType?: ZtripHotelRate["bedType"];
  requestedBreakfast?: ZtripHotelRate["breakfast"];
}) {
  const rates: ZtripHotelRate[] = [];
  const bedType = inferZtripBedType(input.snippetLines.join(" ")) || input.requestedBedType || "";
  if (!bedType) return rates;
  if (input.requestedBedType && bedType !== input.requestedBedType) return rates;

  for (let index = 1; index < input.snippetLines.length; index += 1) {
    const line = input.snippetLines[index];
    const breakfastMatch = line.match(ztripBreakfastPattern())?.at(-1);
    const breakfast = breakfastMatch ? normalizeZtripBreakfast(breakfastMatch) : "";
    if (!breakfast) continue;
    if (input.requestedBreakfast && breakfast !== input.requestedBreakfast) continue;

    let endIndex = input.snippetLines.length;
    for (let nextIndex = index + 1; nextIndex < endIndex; nextIndex += 1) {
      if (input.snippetLines[nextIndex].match(ztripBreakfastPattern())) {
        endIndex = nextIndex;
        break;
      }
    }
    const packageLines = input.snippetLines.slice(index, endIndex);
    const rawText = [input.roomLine, ...packageLines].join(" ");
    const rate = buildZtripHotelRateFromRoomSection({
      hotelName: input.hotelName,
      roomLine: input.roomLine,
      bedType,
      breakfast,
      price: priceFromZtripSnippet(packageLines.join(" ")),
      rawText
    });
    if (rate) rates.push(rate);
  }

  return rates;
}

function detectZtripSelectedFilters(rawText: string): Pick<ZtripHotelRate, "bedType" | "breakfast"> {
  const relevantLines = ztripRelevantLines(rawText);
  const firstRoomIndex = relevantLines.findIndex((line) =>
    isZtripRoomHeader(line) && !/^(大床|双床|双份早餐|含早餐|无早餐|符合差标|酒店最低价)$/.test(line)
  );
  const filterText = relevantLines.slice(0, firstRoomIndex >= 0 ? firstRoomIndex : relevantLines.length).join(" ");
  const bedType = /双床/.test(filterText) && !/大床/.test(filterText)
    ? "双床"
    : /大床/.test(filterText) && !/双床/.test(filterText)
      ? "大床"
      : "";
  const breakfast = /无早餐|无早|不含早|无餐食/.test(filterText)
    ? "无早餐"
    : /含早餐|含早|2份早餐|双份早餐|双早|1份早餐|单份早餐|单早/.test(filterText)
      ? "有早餐"
      : "";

  return { bedType, breakfast };
}

export function parseZtripHotelRatesTextForRatePlan(rawText: string, ratePlan?: HotelRatePlanLabel): ZtripHotelRate[] {
  const lines = rawText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const hotelName = detectZtripHotelName(lines);
  const rates: ZtripHotelRate[] = [];
  const relevantLines = ztripRelevantLines(rawText);
  const selectedFilters: Pick<ZtripHotelRate, "bedType" | "breakfast"> = ratePlan ? { bedType: "", breakfast: "" } : detectZtripSelectedFilters(rawText);
  const requestedBedType: ZtripHotelRate["bedType"] = ratePlan ? hotelRatePlanBedType(ratePlan) : "";
  const requestedBreakfast: ZtripHotelRate["breakfast"] = ratePlan ? hotelRatePlanBreakfast(ratePlan) : "";

  for (let index = 0; index < relevantLines.length; index += 1) {
    const roomLine = relevantLines[index];
    if (
      (!isZtripRoomHeader(roomLine) && !/大床|双床/.test(roomLine)) ||
      /筛选|大床双床|可住|m²|㎡/.test(roomLine) ||
      /^(大床|双床|双份早餐|含早餐|符合差标|酒店最低价)$/.test(roomLine) ||
      /^(含早餐|无早餐|免费取消|立即确认|符合差标)/.test(roomLine)
    ) {
      continue;
    }

    const snippetLines = boundedHotelRoomSnippet(relevantLines, index, 14);
    const snippet = snippetLines.join(" ");
    const expandedRates = parseZtripExpandedPackageRows({
      hotelName,
      roomLine,
      snippetLines,
      requestedBedType: requestedBedType || undefined,
      requestedBreakfast: requestedBreakfast || undefined
    });
    if (expandedRates.length > 0) {
      rates.push(...expandedRates);
      continue;
    }
    const explicitBedType = inferZtripBedType(snippet);
    const bedType: ZtripHotelRate["bedType"] = explicitBedType || requestedBedType || selectedFilters.bedType;
    if (!bedType) {
      continue;
    }
    if (ratePlan && bedType !== requestedBedType) {
      continue;
    }
    if (ratePlan && !explicitBedType && !inferZtripBedType(roomLine)) {
      continue;
    }
    const breakfastMatches = Array.from(snippet.matchAll(ztripBreakfastPattern()));
    const breakfastMatch = breakfastMatches.at(-1);
    const explicitBreakfast = breakfastMatch ? normalizeZtripBreakfast(breakfastMatch[0]) : "";
    if (ratePlan && explicitBreakfast && selectedFilters.breakfast && explicitBreakfast !== selectedFilters.breakfast) {
      continue;
    }
    const breakfast: ZtripHotelRate["breakfast"] = explicitBreakfast || requestedBreakfast || selectedFilters.breakfast;
    if (!breakfast) {
      continue;
    }
    if (ratePlan && breakfast !== requestedBreakfast) {
      continue;
    }

    const afterBreakfast = breakfastMatch ? snippet.slice((breakfastMatch.index ?? 0) + breakfastMatch[0].length) : snippet;
    const price = priceFromZtripSnippet(afterBreakfast) ?? priceFromZtripSnippet(snippet);
    const rate = buildZtripHotelRateFromRoomSection({
      hotelName,
      roomLine,
      bedType,
      breakfast,
      price,
      rawText: snippet
    });

    if (rate) {
      rates.push(rate);
    }
  }

  return rates;
}

function hasExplicitZtripBreakfastText(rate: ZtripHotelRate) {
  return /含早餐|含早|2份早餐|双份早餐|双早|1份早餐|单份早餐|单早|无早餐|无早|不含早|无餐食/.test(rate.rawText);
}

export function selectZtripHotelRateForRatePlan(rates: ZtripHotelRate[], ratePlan: HotelRatePlanLabel) {
  const requestedBedType = hotelRatePlanBedType(ratePlan);
  const requestedBreakfast = hotelRatePlanBreakfast(ratePlan);
  const matchingRates = rates
    .filter((rate) => rate.bedType === requestedBedType && rate.breakfast === requestedBreakfast && typeof rate.price === "number");
  const explicitBreakfastRates = matchingRates.filter((rate) => hasExplicitZtripBreakfastText(rate));
  return (explicitBreakfastRates.length ? explicitBreakfastRates : matchingRates)
    .sort((left, right) => {
      const leftExplicitBreakfast = hasExplicitZtripBreakfastText(left) ? 0 : 1;
      const rightExplicitBreakfast = hasExplicitZtripBreakfastText(right) ? 0 : 1;
      const priceDiff = (left.price ?? Number.MAX_SAFE_INTEGER) - (right.price ?? Number.MAX_SAFE_INTEGER);
      return priceDiff !== 0 ? priceDiff : leftExplicitBreakfast - rightExplicitBreakfast;
    })[0] ?? null;
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
