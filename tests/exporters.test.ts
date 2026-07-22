import ExcelJS from "exceljs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { exportBatchWorkbook } from "../server/exporters/excel";
import { exportOfflinePackage } from "../server/exporters/offlinePackage";
import { buildFakeBatch } from "../src/domain/fakeBatch";
import { buildThirdVersionDeliveryBatch } from "../src/domain/thirdVersionStrategy";
import type { CollectionBatch, PlatformName } from "../src/domain/types";

const collectionDates = {
  mode: "manual" as const,
  flightTravelDate: "2026-06-20",
  hotelCheckInDate: "2026-06-10",
  hotelCheckOutDate: "2026-06-11",
  hotelNights: 1 as const
};

async function tempOutputDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "qingmao-export-test-"));
}

function batchWithDates(): CollectionBatch {
  const batch = buildFakeBatch(new Date("2026-06-03T10:00:00+08:00"));
  return {
    ...batch,
    collectionDates,
    failureNotes: [
      "深圳-洛杉矶: 青猫候选航班为空",
      ...(batch.failureNotes ?? [])
    ],
    samples: batch.samples.map((sample, sampleIndex) => ({
      ...sample,
      travelDate: collectionDates.flightTravelDate,
      quotes: sample.quotes.map((quote, quoteIndex) => sampleIndex === 0 && quoteIndex === 1
        ? { ...quote, available: false, price: null, status: "采集失败", missingReason: "测试航班缺失价格" }
        : quote)
    })),
    hotels: (batch.hotels ?? []).map((hotel, hotelIndex) => ({
      ...hotel,
      checkInDate: collectionDates.hotelCheckInDate,
      checkOutDate: collectionDates.hotelCheckOutDate,
      nights: collectionDates.hotelNights,
      ratePlans: hotel.ratePlans.map((ratePlan, ratePlanIndex) => ({
        ...ratePlan,
        quotes: ratePlan.quotes.map((quote, quoteIndex) => hotelIndex === 0 && ratePlanIndex === 0 && quoteIndex === 1
          ? { ...quote, available: false, price: null, status: "采集失败", missingReason: "测试酒店缺失价格" }
          : quote)
      }))
    }))
  };
}

function sheetText(sheet: ExcelJS.Worksheet) {
  const values: string[] = [];
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      const value = cell.value;
      if (value === null || value === undefined) return;
      values.push(typeof value === "object" ? JSON.stringify(value) : String(value));
    });
  });
  return values.join("\n");
}

async function readWorkbookText(filePath: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return Object.fromEntries(workbook.worksheets.map((sheet) => [sheet.name, sheetText(sheet)]));
}

describe("fourth-version date exports", () => {
  it("writes collectionDates into Excel overview, summary, internal trace, and failure records", async () => {
    const outputDir = await tempOutputDir();
    const result = await exportBatchWorkbook(batchWithDates(), outputDir);
    const text = await readWorkbookText(result.path);

    expect(text["总览页"]).toContain("本次目标查询日期");
    expect(text["总览页"]).toContain("航班出行 2026-06-20");
    expect(text["总览页"]).toContain("酒店 2026-06-10 入住，2026-06-11 离店，固定 1 晚");
    expect(text["总览页"]).toContain("manual（手动指定）");

    expect(text["航班汇总页"]).toContain("2026-06-20");
    expect(text["酒店汇总页"]).toContain("2026-06-10");
    expect(text["酒店汇总页"]).toContain("2026-06-11");

    expect(text["内部留痕页"]).toContain("collectionDates.mode");
    expect(text["内部留痕页"]).toContain("flightTravelDate");
    expect(text["内部留痕页"]).toContain("hotelCheckInDate");
    expect(text["内部留痕页"]).toContain("hotelCheckOutDate");
    expect(text["内部留痕页"]).toContain("hotelNights");

    expect(text["失败记录页"]).toContain("本次目标查询日期");
    expect(text["失败记录页"]).toContain("目标航班出行日期 2026-06-20");
    expect(text["失败记录页"]).toContain("目标酒店入住 2026-06-10，离店 2026-06-11，1 晚");
  });

  it("writes collectionDates into the offline page and tolerates old batches without collectionDates", async () => {
    const outputDir = await tempOutputDir();
    const dated = await exportOfflinePackage(batchWithDates(), outputDir);
    const datedHtml = await fsp.readFile(dated.path, "utf8");

    expect(datedHtml).toContain("本次目标查询日期");
    expect(datedHtml).toContain("航班出行：2026-06-20");
    expect(datedHtml).toContain("酒店：2026-06-10 入住 / 2026-06-11 离店 / 固定 1 晚");

    const oldBatch = buildFakeBatch(new Date("2026-06-03T10:00:00+08:00"));
    const oldWorkbook = await exportBatchWorkbook(oldBatch, outputDir);
    const oldWorkbookText = await readWorkbookText(oldWorkbook.path);
    const oldOffline = await exportOfflinePackage(oldBatch, outputDir);
    const oldHtml = await fsp.readFile(oldOffline.path, "utf8");

    expect(oldWorkbookText["总览页"]).toContain("本批次未记录统一目标查询日期");
    expect(oldWorkbookText["失败记录页"]).toContain("本批次未记录统一目标查询日期");
    expect(oldHtml).toContain("本批次未记录统一目标查询日期");
  });

  it("preserves third-version export naming and the four-platform list while carrying collection dates", () => {
    const deliveryBatch = buildThirdVersionDeliveryBatch(batchWithDates(), {
      hotelDisplayLimit: 5,
      flightDisplayLimit: 4,
      generationMode: "real_random",
      targetAdvantageRatio: 70,
      comparisonMode: "internal_discussion"
    }, { random: () => 0.5 });
    const platforms: PlatformName[] = ["青猫差旅", "携程商旅", "阿里商旅", "在途商旅"];

    expect(deliveryBatch.collectionDates).toEqual(collectionDates);
    expect(deliveryBatch.thirdVersion?.status.exportBaseName).toBe("【随】青猫差旅一体化比价-酒店5-航班4-优势75%");
    expect(platforms).toEqual(["青猫差旅", "携程商旅", "阿里商旅", "在途商旅"]);
  });
});
