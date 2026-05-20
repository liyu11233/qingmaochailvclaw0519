import { summarizeFlight } from "../domain/comparison";
import type { CollectionBatch, FlightSample, PlatformQuote } from "../domain/types";

export interface ArtifactLinks {
  excel: string;
  salesSnapshot: string;
}

export interface QuoteView {
  platform: PlatformQuote["platform"];
  priceLabel: string;
  status: PlatformQuote["status"];
  evidencePath: string;
  isQingmao: boolean;
  available: boolean;
}

export interface SampleView {
  id: string;
  scope: FlightSample["scope"];
  routeLabel: string;
  travelDate: string;
  flightNo: string;
  airline: string;
  cabin: FlightSample["cabin"];
  directType: FlightSample["directType"];
  transferLabel: string;
  durationLabel: string;
  quotes: QuoteView[];
  lowestPlatform: string;
  qingmaoGap: number | null;
  gapLabel: string;
  gapTone: "advantage" | "neutral" | "higher" | "unknown";
  conclusion: string;
}

export interface DashboardView {
  batchId: string;
  generatedAt: string;
  sampleCount: number;
  successCount: number;
  failedCount: number;
  domesticCount: number;
  internationalCount: number;
  advantageCount: number;
  neutralCount: number;
  notHigherThanLowestCount: number;
  higherThanLowestCount: number;
  evidenceCount: number;
  failureNotes: string[];
  samples: SampleView[];
}

const moneyFormatter = new Intl.NumberFormat("zh-CN");

export function formatMoney(value: number | null, fallback = "暂无价格") {
  return typeof value === "number" ? `¥${moneyFormatter.format(value)}` : fallback;
}

export function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}小时${rest}分` : `${rest}分`;
}

function formatGap(gap: number | null) {
  if (gap === null) return "无可比价格";
  if (gap < 0) return `低${Math.abs(gap)}元`;
  if (gap === 0) return "持平";
  return `高${gap}元`;
}

function gapTone(gap: number | null): SampleView["gapTone"] {
  if (gap === null) return "unknown";
  if (gap < 0) return "advantage";
  if (gap === 0) return "neutral";
  return "higher";
}

export function buildSampleView(sample: FlightSample): SampleView {
  const summary = summarizeFlight(sample);
  const transferLabel = sample.directType === "中转" && sample.transferCity ? `中转${sample.transferCity}` : sample.directType;

  return {
    id: sample.id,
    scope: sample.scope,
    routeLabel: `${sample.origin}-${sample.destination}`,
    travelDate: sample.travelDate,
    flightNo: sample.flightNo,
    airline: sample.airline,
    cabin: sample.cabin,
    directType: sample.directType,
    transferLabel,
    durationLabel: formatDuration(sample.durationMinutes),
    quotes: sample.quotes.map((quote) => ({
      platform: quote.platform,
      priceLabel: formatMoney(quote.price, quote.status),
      status: quote.status,
      evidencePath: quote.evidencePath,
      isQingmao: quote.platform === "青猫差旅",
      available: quote.available
    })),
    lowestPlatform: summary.lowestPlatform || "无",
    qingmaoGap: summary.qingmaoGap,
    gapLabel: formatGap(summary.qingmaoGap),
    gapTone: gapTone(summary.qingmaoGap),
    conclusion: summary.conclusion
  };
}

export function buildDashboardView(batch: CollectionBatch): DashboardView {
  const samples = batch.samples.map(buildSampleView);

  return {
    batchId: batch.id,
    generatedAt: batch.generatedAt,
    sampleCount: batch.sampleCount,
    successCount: batch.successCount,
    failedCount: batch.failedCount,
    domesticCount: samples.filter((sample) => sample.scope === "国内").length,
    internationalCount: samples.filter((sample) => sample.scope === "国际").length,
    advantageCount: samples.filter((sample) => sample.gapTone === "advantage").length,
    neutralCount: samples.filter((sample) => sample.gapTone === "neutral").length,
    notHigherThanLowestCount: samples.filter((sample) => sample.qingmaoGap !== null && sample.qingmaoGap <= 0).length,
    higherThanLowestCount: samples.filter((sample) => sample.qingmaoGap !== null && sample.qingmaoGap > 0).length,
    evidenceCount: samples.reduce((count, sample) => count + sample.quotes.filter((quote) => quote.evidencePath).length, 0),
    failureNotes: batch.failureNotes ?? [],
    samples
  };
}
