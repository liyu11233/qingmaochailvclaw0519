import type { CollectionDateConfig, CollectionDateMode } from "./types";
import type { CollectionBatch } from "./types";

export interface CollectionDateRequest {
  mode?: unknown;
  flightTravelDate?: unknown;
  hotelCheckInDate?: unknown;
  hotelCheckOutDate?: unknown;
}

export type CollectionDateParseResult = {
  ok: true;
  value: CollectionDateConfig;
} | {
  ok: false;
  error: string;
};

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

export function formatDateInput(date: Date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function parseDateInput(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.match(DATE_ONLY_PATTERN);
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

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function buildManualCollectionDateConfig(mode: CollectionDateMode, flightTravelDate: string, hotelCheckInDate: string): CollectionDateConfig {
  return {
    mode,
    flightTravelDate,
    hotelCheckInDate,
    hotelCheckOutDate: formatDateInput(addDays(parseDateInput(hotelCheckInDate) as Date, 1)),
    hotelNights: 1
  };
}

export function buildDefaultCollectionDates(now = new Date()): CollectionDateConfig {
  const hotelCheckInDate = formatDateInput(addDays(now, 1));
  return buildManualCollectionDateConfig("default", formatDateInput(addDays(now, 3)), hotelCheckInDate);
}

export function parseCollectionDates(value: unknown, now = new Date()): CollectionDateParseResult {
  if (value === undefined || value === null) {
    return { ok: true, value: buildDefaultCollectionDates(now) };
  }
  if (!isRecord(value)) {
    return { ok: false, error: "collectionDates 必须是对象" };
  }

  const mode = value.mode;
  if (mode !== "default" && mode !== "manual") {
    return { ok: false, error: "collectionDates.mode 只能是 default 或 manual" };
  }
  if (mode === "default") {
    return { ok: true, value: buildDefaultCollectionDates(now) };
  }

  const flightDate = parseDateInput(value.flightTravelDate);
  if (!flightDate) {
    return { ok: false, error: "flightTravelDate 必须是有效的 YYYY-MM-DD 日期" };
  }
  const hotelCheckIn = parseDateInput(value.hotelCheckInDate);
  if (!hotelCheckIn) {
    return { ok: false, error: "hotelCheckInDate 必须是有效的 YYYY-MM-DD 日期" };
  }

  return {
    ok: true,
    value: buildManualCollectionDateConfig("manual", formatDateInput(flightDate), formatDateInput(hotelCheckIn))
  };
}

export function collectionDatesFromRequestBody(body: unknown, now = new Date()) {
  const rawDates = isRecord(body) ? body.collectionDates : undefined;
  return parseCollectionDates(rawDates, now);
}

export function describeCollectionDates(config: CollectionDateConfig) {
  return `本次目标查询日期：航班出行 ${config.flightTravelDate}；酒店 ${config.hotelCheckInDate} 入住，${config.hotelCheckOutDate} 离店，固定 ${config.hotelNights} 晚；来源 ${config.mode === "manual" ? "手动指定" : "系统默认"}`;
}

export function collectionDateModeLabel(mode: CollectionDateMode) {
  return mode === "manual" ? "manual（手动指定）" : "default（系统默认）";
}

export function describeBatchCollectionDates(batch: Pick<CollectionBatch, "collectionDates" | "samples" | "hotels">) {
  if (batch.collectionDates) {
    return describeCollectionDates(batch.collectionDates);
  }

  const sampleFlightDate = batch.samples[0]?.travelDate;
  const sampleHotel = batch.hotels?.[0];
  const fallbackParts = [
    sampleFlightDate ? `航班样本出行日期 ${sampleFlightDate}` : "",
    sampleHotel ? `酒店样本 ${sampleHotel.checkInDate} 入住，${sampleHotel.checkOutDate} 离店，${sampleHotel.nights} 晚` : ""
  ].filter(Boolean);

  return fallbackParts.length
    ? `本批次未记录统一目标查询日期；已按样本行日期降级展示：${fallbackParts.join("；")}`
    : "本批次未记录统一目标查询日期";
}
