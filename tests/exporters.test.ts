import { existsSync, statSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFakeBatch } from "../src/domain/fakeBatch";
import { exportBatchWorkbook } from "../server/exporters/excel";
import { exportOfflinePackage } from "../server/exporters/offlinePackage";
import type { HotelRatePlan, PlatformName, PlatformQuote } from "../src/domain/types";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

let outputDir: string;

const hotelPlatforms: PlatformName[] = ["青猫差旅", "携程商旅", "阿里商旅", "在途商旅"];

function hotelQuote(platform: PlatformName, price: number | null): PlatformQuote {
  return {
    platform,
    price,
    refundRule: "",
    baggageRule: "",
    available: typeof price === "number",
    status: typeof price === "number" ? "可订" : "未展示",
    evidencePath: `evidence/${platform}.html`,
    sourceUrl: "https://example.com",
    rawHotelName: `${platform}测试酒店`,
    rawRoomName: `${platform}测试房型`,
    missingReason: typeof price === "number" ? undefined : "该口径暂无价格"
  };
}

function hotelRatePlan(label: HotelRatePlan["label"], prices: Array<number | null>): HotelRatePlan {
  return {
    label,
    quotes: hotelPlatforms.map((platform, index) => hotelQuote(platform, prices[index]))
  };
}

beforeEach(async () => {
  outputDir = await mkdtemp(path.join(tmpdir(), "qingmao-export-"));
});

afterEach(async () => {
  await rm(outputDir, { recursive: true, force: true });
});

describe("export artifacts", () => {
  it("exports the second-version Excel workbook with overview, summaries, evidence indexes, trace, and failure sheets", async () => {
    const batch = buildFakeBatch(new Date("2026-05-18T10:00:00+08:00"));
    const result = await exportBatchWorkbook(batch, outputDir);

    expect(result.filename.endsWith(".xlsx")).toBe(true);
    expect(existsSync(result.path)).toBe(true);
    expect(statSync(result.path).size).toBeGreaterThan(10_000);
    expect(result.sheets).toEqual([
      "总览页",
      "航班汇总页",
      "酒店汇总页",
      "酒店集团明细页",
      "航班网页截图索引页",
      "酒店网页截图索引页",
      "内部留痕页",
      "失败记录页"
    ]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(result.path);
    const overviewSheet = workbook.getWorksheet("总览页");
    const flightSheet = workbook.getWorksheet("航班汇总页");
    const hotelSummarySheet = workbook.getWorksheet("酒店汇总页");
    const hotelGroupDetailSheet = workbook.getWorksheet("酒店集团明细页");
    const flightEvidenceSheet = workbook.getWorksheet("航班网页截图索引页");
    const hotelEvidenceSheet = workbook.getWorksheet("酒店网页截图索引页");
    const traceSheet = workbook.getWorksheet("内部留痕页");
    const failureSheet = workbook.getWorksheet("失败记录页");
    const flightHeaderValues = flightSheet?.getRow(4).values;
    const hotelSummaryHeaderValues = hotelSummarySheet?.getRow(4).values;
    const hotelDetailHeaderValues = hotelGroupDetailSheet?.getRow(4).values;
    const gapCell = flightSheet?.getRow(5).getCell(14);
    const hotelSummaryGapCell = hotelSummarySheet?.getRow(5).getCell(14);
    const hotelDetailGapCell = hotelGroupDetailSheet?.getRow(5).getCell(21);
    const qingmaoPriceCell = flightSheet?.getRow(5).getCell(9);
    const ctripPriceCell = flightSheet?.getRow(5).getCell(10);
    const alibPriceCell = flightSheet?.getRow(5).getCell(11);
    const ztripPriceCell = flightSheet?.getRow(5).getCell(12);

    expect(overviewSheet?.getCell("A1").value).toBe("青猫差旅价格对比总览");
    expect(flightSheet?.getCell("A1").value).toBe("航班四平台价格对比");
    expect(flightHeaderValues).toContain("在途商旅");
    expect(flightHeaderValues).toContain("最低价平台");
    expect(flightHeaderValues).not.toContain("竞品最低价平台");
    expect(flightHeaderValues).toContain("网页截图索引");
    expect(hotelSummaryHeaderValues).toContain("网页截图索引");
    expect(hotelDetailHeaderValues).toContain("是否推荐口径");
    expect(hotelDetailHeaderValues).toContain("青猫原始房型名");
    expect(hotelDetailHeaderValues).toContain("携程原始房型名");
    expect(hotelDetailHeaderValues).toContain("阿里原始房型名");
    expect(hotelDetailHeaderValues).toContain("在途原始房型名");
    expect(hotelDetailHeaderValues).toContain("青猫证据编号");
    expect(gapCell?.value).toMatchObject({
      formula: 'IF(OR(I5="",COUNT(J5:L5)=0),"",IF(I5<=MIN(J5:L5),I5-MAX(J5:L5),I5-ROUND(AVERAGE(J5:L5),0)))',
      result: -103
    });
    expect(hotelSummaryGapCell?.value).toMatchObject({
      formula: 'IF(OR(I5="",COUNT(J5:L5)=0),"",IF(I5<=MIN(J5:L5),I5-MAX(J5:L5),I5-ROUND(AVERAGE(J5:L5),0)))',
      result: -40
    });
    expect(hotelDetailGapCell?.value).toMatchObject({
      formula: 'IF(OR(P5="",COUNT(Q5:S5)=0),"",IF(P5<=MIN(Q5:S5),P5-MAX(Q5:S5),P5-ROUND(AVERAGE(Q5:S5),0)))',
      result: -40
    });
    expect(gapCell?.font).toMatchObject({ bold: true, color: { argb: "FFFFFFFF" } });
    expect(gapCell?.fill).toMatchObject({ fgColor: { argb: "FF0E8F7A" } });
    expect(qingmaoPriceCell?.fill).toMatchObject({ fgColor: { argb: "FFE8F7F0" } });
    expect(ctripPriceCell?.fill).toMatchObject({ fgColor: { argb: "FFEAF3FF" } });
    expect(alibPriceCell?.fill).toMatchObject({ fgColor: { argb: "FFFFF4E2" } });
    expect(ztripPriceCell?.fill).toMatchObject({ fgColor: { argb: "FFF1ECFF" } });
    expect(qingmaoPriceCell?.font).toMatchObject({ bold: true, size: 11, color: { argb: "FF0E8F7A" } });
    expect(ctripPriceCell?.font?.bold).not.toBe(true);
    expect(ctripPriceCell?.font?.size).toBe(11);
    expect(flightSheet?.getRow(5).getCell(13).value).toBe("青猫差旅");
    expect(flightSheet?.getRow(5).getCell(15).value).toContain("对比另外3家平台最高价低了103元");
    expect(hotelSummarySheet?.getRow(5).getCell(15).value).toContain("对比另外3家平台最高价低了40元");
    expect(hotelDetailHeaderValues).toContain("归一口径");
    expect(hotelGroupDetailSheet?.getRow(5).values).toContain("大床有早餐");
    expect(hotelGroupDetailSheet?.actualRowCount).toBeGreaterThan(160);
    expect(flightEvidenceSheet?.actualRowCount).toBeGreaterThan(80);
    expect(hotelEvidenceSheet?.actualRowCount).toBeGreaterThan(640);
    expect(traceSheet?.actualRowCount).toBeGreaterThan(700);
    expect(failureSheet?.getRow(5).values).toContain("暂无失败记录");
  }, 15_000);

  it("does not embed screenshots and keeps screenshot references as index rows", async () => {
    const batch = buildFakeBatch(new Date("2026-05-18T10:00:00+08:00"));
    batch.samples = batch.samples.slice(0, 1);
    batch.hotels = [];
    batch.sampleCount = 1;
    batch.successCount = 1;
    batch.samples[0].quotes[0].evidencePath = "screenshots/embedded-qingmao.png";
    await mkdir(path.join(outputDir, "screenshots"), { recursive: true });
    await writeFile(path.join(outputDir, "screenshots", "embedded-qingmao.png"), ONE_PIXEL_PNG);

    const result = await exportBatchWorkbook(batch, outputDir);
    const workbookZip = await readFile(result.path);
    const mediaMarker = Buffer.from("xl/media/image");

    expect(workbookZip.includes(mediaMarker)).toBe(false);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(result.path);
    const flightEvidenceSheet = workbook.getWorksheet("航班网页截图索引页");
    const hotelEvidenceSheet = workbook.getWorksheet("酒店网页截图索引页");
    expect(flightEvidenceSheet).toBeDefined();
    expect(hotelEvidenceSheet).toBeDefined();
    expect(flightEvidenceSheet?.getRow(5).values).toContain("screenshots/embedded-qingmao.png");
  }, 15_000);

  it("exports a customer-facing offline web package with flights and hotels", async () => {
    const batch = buildFakeBatch(new Date("2026-05-18T10:00:00+08:00"));
    batch.samples = batch.samples.slice(0, 4);
    batch.sampleCount = 4;
    batch.successCount = 4;
    batch.hotels = batch.hotels?.slice(0, 10);
    const result = await exportOfflinePackage(batch, outputDir);
    const indexHtml = await readFile(path.join(result.directory, "index.html"), "utf8");
    const flightHtml = await readFile(path.join(result.directory, "flights", "index.html"), "utf8");
    const hotelHtml = await readFile(path.join(result.directory, "hotels", "index.html"), "utf8");

    expect(result.filename.endsWith(".zip")).toBe(true);
    expect(existsSync(result.path)).toBe(true);
    expect(statSync(result.path).size).toBeGreaterThan(5_000);
    expect(indexHtml).toContain("航班价格");
    expect(indexHtml).toContain("酒店价格");
    expect(indexHtml).toContain("flight-photo.jpg");
    expect(indexHtml).toContain("hotel-photo.jpg");
    expect(indexHtml).toContain("航班青猫低价");
    expect(indexHtml).toContain("酒店青猫低价");
    expect(indexHtml).toContain("对比另外3家平台最高价");
    expect(indexHtml).not.toContain("开始采集");
    expect(flightHtml).not.toContain("查看网页截图");
    expect(hotelHtml).not.toContain("查看网页截图");
    expect(flightHtml).toContain("青猫差旅航班价格对比");
    expect(flightHtml).toContain("平台价格对比");
    expect(flightHtml).toContain("在途商旅");
    expect(flightHtml).toContain("compare-visual");
    expect(flightHtml).not.toContain("青猫最低时对比另外三家最高价");
    expect(hotelHtml).toContain("酒店价格对比");
    expect(hotelHtml).toContain("首旅如家");
    expect(hotelHtml).toContain("酒店数量");
    expect(hotelHtml).toContain("主对比口径");
    expect(hotelHtml).toContain("当前选择口径");
    expect(hotelHtml).toContain("大床有早餐");
    expect(hotelHtml).toContain("双床有早餐");
    expect(hotelHtml).toContain("hotel-photo.jpg");
    expect(existsSync(path.join(result.directory, "hotels", "index.html"))).toBe(true);
    expect(existsSync(path.join(result.directory, "assets", "flight-photo.jpg"))).toBe(true);
    expect(existsSync(path.join(result.directory, "assets", "hotel-photo.jpg"))).toBe(true);
  });

  it("uses each hotel's most complete comparable rate plan as the default sales display", async () => {
    const batch = buildFakeBatch(new Date("2026-05-18T10:00:00+08:00"));
    batch.samples = batch.samples.slice(0, 1);
    batch.sampleCount = 1;
    batch.successCount = 1;
    batch.hotels = batch.hotels?.slice(0, 2);
    batch.hotels![0] = {
      ...batch.hotels![0],
      primaryRatePlan: "大床有早餐",
      ratePlans: [
        hotelRatePlan("大床无早餐", [300, 310, 320, 305]),
        hotelRatePlan("大床有早餐", [330, 340, 350, null]),
        hotelRatePlan("双床无早餐", [280, null, null, null]),
        hotelRatePlan("双床有早餐", [360, 370, 380, 365])
      ]
    };

    const workbookResult = await exportBatchWorkbook(batch, outputDir);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookResult.path);
    const hotelSummarySheet = workbook.getWorksheet("酒店汇总页");
    const hotelDetailSheet = workbook.getWorksheet("酒店集团明细页");

    expect(hotelSummarySheet?.getRow(5).getCell(8).value).toBe("大床无早餐");
    expect(hotelDetailSheet?.getRow(5).values).toContain("大床无早餐");
    expect(hotelDetailSheet?.getRow(5).values).toContain("是");

    const packageResult = await exportOfflinePackage(batch, outputDir);
    const hotelHtml = await readFile(path.join(packageResult.directory, "hotels", "index.html"), "utf8");

    expect(hotelHtml).toContain('data-plan="__default"');
    expect(hotelHtml).toContain('class="hotel-plan-view active" data-plan="大床无早餐" data-default="true"');
    expect(hotelHtml).toContain("<strong>暂无</strong>");
  }, 15_000);
});
