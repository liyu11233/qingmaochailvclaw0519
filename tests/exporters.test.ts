import { existsSync, statSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFakeBatch } from "../src/domain/fakeBatch";
import { buildThirdVersionDeliveryBatch } from "../src/domain/thirdVersionStrategy";
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
      formula: 'IF(OR(I5="",COUNT(J5:L5)<3),"",I5-MIN(J5:L5))',
      result: -63
    });
    expect(hotelSummaryGapCell?.value).toMatchObject({
      formula: 'IF(OR(I5="",COUNT(J5:L5)<3),"",I5-MIN(J5:L5))',
      result: -20
    });
    expect(hotelDetailGapCell?.value).toMatchObject({
      formula: 'IF(OR(P5="",COUNT(Q5:S5)<3),"",P5-MIN(Q5:S5))',
      result: -20
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
    expect(flightSheet?.getRow(5).getCell(15).value).toContain("对比另外3家平台最低价低了63元");
    expect(hotelSummarySheet?.getRow(5).getCell(15).value).toContain("对比另外3家平台最低价低了20元");
    expect(hotelDetailHeaderValues).toContain("归一口径");
    expect(hotelGroupDetailSheet?.getRow(5).values).toContain("大床有早餐");
    expect(flightEvidenceSheet?.getRow(4).values).not.toContain("证据相对路径");
    expect(hotelEvidenceSheet?.getRow(4).values).not.toContain("证据相对路径");
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
    expect(flightEvidenceSheet?.getRow(4).values).not.toContain("证据相对路径");
    expect(flightEvidenceSheet?.getRow(5).values).not.toContain("screenshots/embedded-qingmao.png");
  }, 15_000);

  it("marks batch-level notes as source notes instead of collection failures", async () => {
    const batch = buildFakeBatch(new Date("2026-05-18T10:00:00+08:00"));
    batch.samples = batch.samples.slice(0, 1);
    batch.hotels = [];
    batch.sampleCount = 1;
    batch.successCount = 1;
    batch.failureNotes = ["航班来源批次：batch-source，四平台完整样本 20 条。"];

    const result = await exportBatchWorkbook(batch, outputDir);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(result.path);
    const failureSheet = workbook.getWorksheet("失败记录页");

    expect(failureSheet?.getRow(5).values).toContain("批次说明");
    expect(failureSheet?.getRow(5).values).toContain("说明");
    expect(failureSheet?.getRow(5).values).not.toContain("采集失败");
  }, 15_000);

  it("exports a customer-facing offline web package with flights and hotels", async () => {
    const batch = buildFakeBatch(new Date("2026-05-18T10:00:00+08:00"));
    batch.samples = batch.samples.slice(0, 4);
    batch.samples[0] = {
      ...batch.samples[0],
      quotes: batch.samples[0].quotes.map((quote) =>
        quote.platform === "青猫差旅"
          ? { ...quote, price: 160 }
          : quote.platform === "携程商旅"
            ? { ...quote, price: 90 }
            : quote.platform === "阿里商旅"
              ? { ...quote, price: 120 }
              : { ...quote, price: 200 }
      )
    };
    batch.sampleCount = 4;
    batch.successCount = 4;
    batch.hotels = batch.hotels?.slice(0, 10);
    const result = await exportOfflinePackage(batch, outputDir);
    const offlineHtml = await readFile(result.path, "utf8");

    expect(result.filename.endsWith(".html")).toBe(true);
    expect(existsSync(result.path)).toBe(true);
    expect(statSync(result.path).size).toBeGreaterThan(5_000);
    expect(offlineHtml).toContain("<style>");
    expect(offlineHtml).not.toContain('rel="stylesheet"');
    expect(offlineHtml).toContain('id="single-home"');
    expect(offlineHtml).toContain('id="single-flights"');
    expect(offlineHtml).toContain('id="single-hotels"');
    expect(offlineHtml).toContain("航班价格");
    expect(offlineHtml).toContain("酒店价格");
    expect(offlineHtml).toContain("data:image/jpeg;base64");
    expect(offlineHtml).toContain("航班青猫低价");
    expect(offlineHtml).toContain("酒店青猫低价");
    expect(offlineHtml).toContain("对比另外3家平台");
    expect(offlineHtml).not.toContain("开始采集");
    expect(offlineHtml).not.toContain("href=\"../evidence/");
    expect(offlineHtml).not.toContain("href=\"evidence/");
    expect(offlineHtml).not.toContain("内部留存");
    expect(offlineHtml).toContain("青猫差旅航班价格对比");
    expect(offlineHtml).toContain("平台价格对比");
    expect(offlineHtml).toContain("在途商旅");
    expect(offlineHtml).toContain("compare-visual");
    expect(offlineHtml).toContain("按竞品最低价口径");
    expect(offlineHtml).toContain("高70元");
    expect(offlineHtml).toContain("对比另外3家平台最高价低了40元");
    expect(offlineHtml).not.toContain("需结合企业协议价复核");
    expect(offlineHtml).toContain("酒店价格对比");
    expect(offlineHtml).toContain("首旅如家");
    expect(offlineHtml).toContain("酒店数量");
    expect(offlineHtml).toContain("主对比口径");
    expect(offlineHtml).toContain("最具价格优势且四平台可比");
    expect(offlineHtml).toContain("大床有早餐");
    expect(offlineHtml).toContain("双床有早餐");
    expect(offlineHtml).toContain("hotel-photo-fallback");
    expect(offlineHtml).not.toContain("hotel-identity");
    expect(existsSync(path.join(result.directory, "assets", "styles.css"))).toBe(false);
  });

  it("keeps internal evidence out of the customer-facing offline web package", async () => {
    const batch = buildFakeBatch(new Date("2026-05-18T10:00:00+08:00"));
    batch.samples = batch.samples.slice(0, 1);
    batch.sampleCount = 1;
    batch.successCount = 1;
    batch.hotels = batch.hotels?.slice(0, 1);
    const flightEvidencePath = batch.samples[0].quotes[0].evidencePath;
    const hotelEvidencePath = batch.hotels![0].ratePlans[0].quotes[0].evidencePath;
    await mkdir(path.dirname(path.join(outputDir, flightEvidencePath)), { recursive: true });
    await mkdir(path.dirname(path.join(outputDir, hotelEvidencePath)), { recursive: true });
    await writeFile(path.join(outputDir, flightEvidencePath), "flight evidence");
    await writeFile(path.join(outputDir, hotelEvidencePath), "hotel evidence");

    const result = await exportOfflinePackage(batch, outputDir);
    const packageHtml = await readFile(result.path, "utf8");

    expect(existsSync(path.join(outputDir, flightEvidencePath))).toBe(true);
    expect(existsSync(path.join(outputDir, hotelEvidencePath))).toBe(true);
    expect(packageHtml).not.toContain("flight evidence");
    expect(packageHtml).not.toContain("hotel evidence");
    expect(packageHtml).not.toContain('href="evidence/');
    expect(packageHtml).not.toContain('href="../evidence/');
  });

  it("renders hotel metrics by active group and rate plan", async () => {
    const batch = buildFakeBatch(new Date("2026-05-18T10:00:00+08:00"));
    batch.samples = batch.samples.slice(0, 1);
    batch.sampleCount = 1;
    batch.successCount = 1;
    batch.hotels = batch.hotels?.slice(0, 2);
    batch.hotels![0] = {
      ...batch.hotels![0],
      group: "如家集团",
      primaryRatePlan: "大床有早餐",
      ratePlans: [
        hotelRatePlan("大床有早餐", [100, 120, 130, 140]),
        hotelRatePlan("大床无早餐", [null, 200, 210, 220])
      ]
    };
    batch.hotels![1] = {
      ...batch.hotels![1],
      group: "锦江集团",
      primaryRatePlan: "大床有早餐",
      ratePlans: [
        hotelRatePlan("大床有早餐", [400, 420, 430, 440]),
        hotelRatePlan("大床无早餐", [390, 450, 460, 470])
      ]
    };

    const result = await exportOfflinePackage(batch, outputDir);
    const hotelHtml = await readFile(result.path, "utf8");
    const metricsJson = hotelHtml.match(/<script type="application\/json" id="hotel-metrics-data">(.+?)<\/script>/s)?.[1] ?? "";
    const metrics = JSON.parse(metricsJson) as Record<string, Record<string, { hotelCount: number; lowestPrice: number | null; averageSaving: number | null; qingmaoLowestShare: number }>>;

    expect(hotelHtml).toContain('data-metric="hotel-count"');
    expect(hotelHtml).toContain("updateHotelMetrics");
    expect(metrics["如家集团"].__default).toMatchObject({
      hotelCount: 1,
      lowestPrice: 100,
      averageSaving: 20,
      qingmaoLowestShare: 100
    });
    expect(metrics["如家集团"]["大床无早餐"]).toMatchObject({
      hotelCount: 0,
      lowestPrice: null,
      averageSaving: null,
      qingmaoLowestShare: 0
    });
    expect(metrics["锦江集团"]["大床无早餐"]).toMatchObject({
      hotelCount: 1,
      lowestPrice: 390,
      averageSaving: 60,
      qingmaoLowestShare: 100
    });
  });

  it("uses a saved hotel cover image in the offline hotel page when available", async () => {
    const batch = buildFakeBatch(new Date("2026-05-18T10:00:00+08:00"));
    batch.samples = batch.samples.slice(0, 1);
    batch.sampleCount = 1;
    batch.successCount = 1;
    batch.hotels = batch.hotels?.slice(0, 1);
    const coverPath = path.join(outputDir, "covers", "hotel-cover.png");
    await mkdir(path.dirname(coverPath), { recursive: true });
    await writeFile(coverPath, ONE_PIXEL_PNG);
    batch.hotels![0] = {
      ...batch.hotels![0],
      coverImageUrl: "https://hotelimages.ceekee.com/hotel-cover.jpg",
      coverImagePath: coverPath,
      coverImageSource: "青猫差旅",
      coverImageStatus: "saved"
    };

    const result = await exportOfflinePackage(batch, outputDir);
    const hotelHtml = await readFile(result.path, "utf8");

    expect(hotelHtml).toContain("hotel-cover");
    expect(hotelHtml).toContain("data:image/png;base64");
    expect(hotelHtml).not.toContain("hotel-identity");
    expect(hotelHtml).not.toContain("covers/hotel-01/hotel-cover.png");
  });

  it("uses each hotel's Qingmao-lowest complete rate plan as the default sales display", async () => {
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
    const hotelHtml = await readFile(packageResult.path, "utf8");

    expect(hotelHtml).toContain('data-plan="__default"');
    expect(hotelHtml).toContain('class="hotel-plan-view active" data-plan="大床无早餐" data-default="true"');
    expect(hotelHtml).toContain("<strong>暂无</strong>");
  }, 15_000);

  it("uses third-version export names and keeps the selected comparison mode out of competing customer columns", async () => {
    const sourceBatch = buildFakeBatch(new Date("2026-05-18T10:00:00+08:00"));
    sourceBatch.samples = sourceBatch.samples.slice(0, 1);
    sourceBatch.hotels = sourceBatch.hotels?.slice(0, 1);
    sourceBatch.sampleCount = 2;
    sourceBatch.successCount = 2;
    sourceBatch.samples[0].quotes = sourceBatch.samples[0].quotes.map((quote) =>
      quote.platform === "阿里商旅"
        ? { ...quote, price: null, available: false, status: "未展示", missingReason: "阿里商旅暂无同航班价格" }
        : quote
    );
    sourceBatch.hotels![0].ratePlans = sourceBatch.hotels![0].ratePlans.map((ratePlan, ratePlanIndex) => ({
      ...ratePlan,
      quotes: ratePlan.quotes.map((quote) =>
        ratePlanIndex === 1 && quote.platform === "阿里商旅"
          ? { ...quote, price: null, available: false, status: "未展示", missingReason: "阿里商旅暂无该口径价格" }
          : quote
      )
    }));

    const deliveryBatch = buildThirdVersionDeliveryBatch(sourceBatch, {
      hotelDisplayLimit: 2,
      flightDisplayLimit: 2,
      generationMode: "qingmao_advantage",
      targetAdvantageRatio: 95,
      comparisonMode: "specified_platform",
      specifiedPlatform: "阿里商旅"
    }, {
      random: () => 0.5
    });

    const workbookResult = await exportBatchWorkbook(deliveryBatch, outputDir);
    const packageResult = await exportOfflinePackage(deliveryBatch, outputDir);

    expect(workbookResult.filename).toBe(`${deliveryBatch.thirdVersion!.status.exportBaseName}.xlsx`);
    expect(packageResult.filename).toBe(`${deliveryBatch.thirdVersion!.status.exportBaseName}.html`);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookResult.path);
    const overviewSheet = workbook.getWorksheet("总览页");
    const flightSheet = workbook.getWorksheet("航班汇总页");
    const traceSheet = workbook.getWorksheet("内部留痕页");
    const failureSheet = workbook.getWorksheet("失败记录页");

    expect(workbookResult.filename).not.toContain("未达标");
    expect(packageResult.filename).not.toContain("未达标");
    expect(workbookResult.filename).toMatch(/优势\d+%\.xlsx$/);
    expect(packageResult.filename).toMatch(/优势\d+%\.html$/);
    expect(overviewSheet?.getRow(5).values).toContain("第三版模式");
    expect(overviewSheet?.getRow(6).values).toContain("指定平台");
    expect(overviewSheet?.getRow(7).getCell(3).text).toContain("优势");
    expect(flightSheet?.getRow(5).getCell(11).value).toBe("暂无");
    expect(flightSheet?.getRow(5).getCell(15).value).toContain("阿里商旅暂无可比价格");
    expect(flightSheet?.getRow(5).getCell(15).value).not.toContain("对比另外3家平台");
    const traceHeader = traceSheet?.getRow(4).values;
    expect(traceHeader).toContain("第三版筛选");
    expect(traceHeader).toContain("比价口径");
    expect(traceHeader).toContain("竞品最低价");
    expect(traceHeader).toContain("竞品平均价");
    expect(traceHeader).toContain("竞品最高价");
    expect(traceHeader).toContain("是否计入青猫优势");
    expect(traceHeader).toContain("航班是否达标");
    expect(traceHeader).toContain("酒店是否达标");
    expect(traceHeader).toContain("截图索引");
    expect(failureSheet?.getColumn(2).values.join(" ")).toContain("第三版策略");

    const indexHtml = await readFile(packageResult.path, "utf8");
    const flightHtml = indexHtml;
    const hotelHtml = indexHtml;
    expect(indexHtml).toContain("当前口径：指定平台");
    expect(flightHtml).toContain("阿里商旅暂无可比价格");
    expect(hotelHtml).toContain("暂无");
    expect(hotelHtml).toContain("阿里商旅");
    expect(indexHtml).not.toContain("青猫优势模式");
    expect(indexHtml).not.toContain("高级验证");
    expect(flightHtml).not.toContain("对比另外3家平台");
  }, 15_000);
});
