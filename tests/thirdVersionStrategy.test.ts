import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { summarizeFlight, summarizeQuoteSet } from "../src/domain/comparison";
import {
  applyThirdVersionStrategy,
  buildThirdVersionDeliveryBatch,
  buildThirdVersionExportBaseName,
  buildThirdVersionPlatformRegressionReport,
  DEFAULT_THIRD_VERSION_OPTIONS
} from "../src/domain/thirdVersionStrategy";
import type { CollectionBatch, FlightSample, HotelGroup, HotelRatePlan, HotelRatePlanLabel, HotelSample, PlatformName, PlatformQuote } from "../src/domain/types";

const platforms: PlatformName[] = ["青猫差旅", "携程商旅", "阿里商旅", "在途商旅"];
const ratePlanLabels: HotelRatePlanLabel[] = ["大床有早餐", "大床无早餐", "双床有早餐", "双床无早餐"];

function quote(platform: PlatformName, price: number | null): PlatformQuote {
  return {
    platform,
    price,
    refundRule: "",
    baggageRule: "",
    available: typeof price === "number",
    status: typeof price === "number" ? "可订" : "未展示",
    evidencePath: `evidence/${platform}.html`,
    sourceUrl: "https://example.com",
    missingReason: typeof price === "number" ? undefined : "暂无价格"
  };
}

function quotes(qingmaoPrice: number, competitorPrices: Array<number | null>): PlatformQuote[] {
  return platforms.map((platform, index) => quote(platform, index === 0 ? qingmaoPrice : competitorPrices[index - 1]));
}

function flight(id: string, qingmaoPrice: number, competitorPrices: Array<number | null>): FlightSample {
  return {
    id,
    routeId: id,
    scope: "国内",
    origin: "广州",
    destination: "上海",
    travelDate: "2026-06-04",
    flightNo: id.toUpperCase(),
    airline: "测试航司",
    cabin: "经济舱",
    directType: "直飞",
    transferCity: "",
    durationMinutes: 120,
    quotes: quotes(qingmaoPrice, competitorPrices)
  };
}

function hotelRatePlan(label: HotelRatePlanLabel, qingmaoPrice: number, competitorPrices: Array<number | null>): HotelRatePlan {
  return {
    label,
    quotes: quotes(qingmaoPrice, competitorPrices)
  };
}

function hotel(id: string, group: HotelGroup, defaultRatePlan: HotelRatePlanLabel, qingmaoPrice: number, competitorPrices: Array<number | null>): HotelSample {
  const ratePlans = ratePlanLabels.map((label) =>
    label === defaultRatePlan
      ? hotelRatePlan(label, qingmaoPrice, competitorPrices)
      : hotelRatePlan(label, qingmaoPrice + 20, competitorPrices.map((price) => (typeof price === "number" ? price + 20 : null)))
  );

  return {
    id,
    group,
    brand: "测试品牌",
    hotelName: `${id}酒店`,
    city: "广州",
    checkInDate: "2026-06-02",
    checkOutDate: "2026-06-03",
    nights: 1,
    primaryRatePlan: defaultRatePlan,
    defaultRatePlan,
    salesDisplayEligible: true,
    completeRatePlanCount: 4,
    ratePlans
  };
}

function batch(flights: FlightSample[], hotels: HotelSample[]): CollectionBatch {
  return {
    id: "batch-v3-strategy-demo",
    status: "ready",
    generatedAt: "2026-06-01T10:00:00+08:00",
    sampleCount: flights.length,
    successCount: flights.length,
    failedCount: 0,
    samples: flights,
    hotels
  };
}

function loadRealSnapshotFixture(): CollectionBatch {
  const fixturePath = path.join(process.cwd(), "tests", "fixtures", "third-version-real-batch-snapshot.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { batch: CollectionBatch };
  return fixture.batch;
}

function primaryHotelQuotes(sample: HotelSample): PlatformQuote[] {
  return sample.ratePlans.find((ratePlan) => ratePlan.label === sample.primaryRatePlan)?.quotes ?? sample.ratePlans[0].quotes;
}

describe("third version strategy model", () => {
  it("uses frozen third-version defaults for fake data strategy runs", () => {
    expect(DEFAULT_THIRD_VERSION_OPTIONS).toMatchObject({
      hotelDisplayLimit: 40,
      flightDisplayLimit: 20,
      generationMode: "real_random",
      targetAdvantageRatio: 70,
      comparisonMode: "internal_discussion"
    });
  });

  it("applies real random display limits without sorting for Qingmao advantage", () => {
    const sourceBatch = batch(
      [
        flight("flight-low-1", 90, [120, 130, 140]),
        flight("flight-high-1", 150, [100, 110, 120]),
        flight("flight-low-2", 92, [120, 122, 124]),
        flight("flight-high-2", 160, [100, 105, 110])
      ],
      [
        hotel("hotel-low-1", "如家集团", "大床有早餐", 220, [250, 260, 270]),
        hotel("hotel-high-1", "锦江集团", "大床有早餐", 320, [250, 260, 270]),
        hotel("hotel-low-2", "华住集团", "大床有早餐", 230, [250, 260, 270])
      ]
    );

    const result = applyThirdVersionStrategy(sourceBatch, {
      hotelDisplayLimit: 2,
      flightDisplayLimit: 2,
      generationMode: "real_random",
      targetAdvantageRatio: 70,
      comparisonMode: "internal_discussion"
    }, {
      random: () => 0
    });

    expect(result.flights.map((sample) => sample.id)).toEqual(["flight-high-1", "flight-low-2"]);
    expect(result.hotels.map((sample) => sample.id)).toEqual(["hotel-high-1", "hotel-low-2"]);
    expect(result.status.rawFlightCandidates).toBe(4);
    expect(result.status.rawHotelCandidates).toBe(3);
    expect(result.status.flightDisplayed).toBe(2);
    expect(result.status.hotelDisplayed).toBe(2);
    expect(result.status.flightAdvantageRatio).toBe(50);
    expect(result.status.hotelAdvantageRatio).toBe(50);
    expect(result.status.exportPrefix).toBe("【随】");
  });

  it("prioritizes Qingmao advantage samples and calculates flight and hotel ratios separately", () => {
    const sourceBatch = batch(
      [
        flight("flight-advantage-1", 90, [120, 130, 140]),
        flight("flight-disadvantage-1", 160, [120, 130, 140]),
        flight("flight-advantage-2", 110, [120, null, 160])
      ],
      [
        hotel("hotel-advantage-1", "如家集团", "大床有早餐", 210, [250, 260, 270]),
        hotel("hotel-disadvantage-1", "锦江集团", "大床有早餐", 290, [250, 260, 270]),
        hotel("hotel-advantage-2", "华住集团", "双床有早餐", 230, [250, null, 270])
      ]
    );

    const result = applyThirdVersionStrategy(sourceBatch, {
      hotelDisplayLimit: 2,
      flightDisplayLimit: 2,
      generationMode: "qingmao_advantage",
      targetAdvantageRatio: 70,
      comparisonMode: "internal_discussion"
    }, {
      random: () => 0.99
    });

    expect(result.flights.map((sample) => sample.id)).toEqual(["flight-advantage-1", "flight-advantage-2"]);
    expect(result.hotels.map((sample) => sample.id)).toEqual(["hotel-advantage-1", "hotel-advantage-2"]);
    expect(result.status.flightAdvantageCount).toBe(2);
    expect(result.status.hotelAdvantageCount).toBe(2);
    expect(result.status.flightAdvantageRatio).toBe(100);
    expect(result.status.hotelAdvantageRatio).toBe(100);
    expect(result.status.flightTargetMet).toBe(true);
    expect(result.status.hotelTargetMet).toBe(true);
    expect(result.status.exportPrefix).toBe("【青】");
    expect(result.status.exportStatus).toBe("达标");
    expect(result.status.exportAdvantageRatio).toBe(100);
    expect(result.status.exportNamePreview).toBe("【青】青猫差旅一体化比价-酒店2-航班2-优势100%.zip");
  });

  it("caps Qingmao advantage selection to twice the display count before strategy filtering", () => {
    const sourceBatch = batch(
      [
        flight("flight-disadvantage-1", 180, [120, 130, 140]),
        flight("flight-disadvantage-2", 181, [120, 130, 140]),
        flight("flight-advantage-in-cap", 90, [120, 130, 140]),
        flight("flight-disadvantage-3", 182, [120, 130, 140]),
        flight("flight-advantage-outside-cap-1", 91, [120, 130, 140]),
        flight("flight-advantage-outside-cap-2", 92, [120, 130, 140])
      ],
      [
        hotel("hotel-disadvantage-1", "如家集团", "大床有早餐", 320, [250, 260, 270]),
        hotel("hotel-disadvantage-2", "锦江集团", "大床有早餐", 321, [250, 260, 270]),
        hotel("hotel-advantage-in-cap", "华住集团", "大床有早餐", 210, [250, 260, 270]),
        hotel("hotel-disadvantage-3", "东呈集团", "大床有早餐", 322, [250, 260, 270]),
        hotel("hotel-advantage-outside-cap-1", "亚朵集团", "大床有早餐", 211, [250, 260, 270]),
        hotel("hotel-advantage-outside-cap-2", "如家集团", "大床有早餐", 212, [250, 260, 270])
      ]
    );

    const result = applyThirdVersionStrategy(sourceBatch, {
      hotelDisplayLimit: 2,
      flightDisplayLimit: 2,
      generationMode: "qingmao_advantage",
      targetAdvantageRatio: 70,
      comparisonMode: "internal_discussion"
    }, {
      random: () => 0
    });

    expect(result.status.rawFlightCandidates).toBe(6);
    expect(result.status.rawHotelCandidates).toBe(6);
    expect(result.status.flightStrategyCandidateLimit).toBe(4);
    expect(result.status.hotelStrategyCandidateLimit).toBe(4);
    expect(result.status.flightStrategyCandidates).toBe(4);
    expect(result.status.hotelStrategyCandidates).toBe(4);
    expect(result.flights.map((sample) => sample.id)).toContain("flight-advantage-in-cap");
    expect(result.hotels.map((sample) => sample.id)).toContain("hotel-advantage-in-cap");
    expect(result.flights.map((sample) => sample.id)).not.toContain("flight-advantage-outside-cap-1");
    expect(result.flights.map((sample) => sample.id)).not.toContain("flight-advantage-outside-cap-2");
    expect(result.hotels.map((sample) => sample.id)).not.toContain("hotel-advantage-outside-cap-1");
    expect(result.hotels.map((sample) => sample.id)).not.toContain("hotel-advantage-outside-cap-2");
  });

  it("marks underfilled and not-met exports without blocking fake data output", () => {
    const sourceBatch = batch(
      [
        flight("flight-disadvantage-1", 180, [120, 130, 140]),
        flight("flight-advantage-1", 100, [120, 130, 140])
      ],
      [
        hotel("hotel-disadvantage-1", "如家集团", "大床有早餐", 310, [250, 260, 270])
      ]
    );

    const result = applyThirdVersionStrategy(sourceBatch, {
      hotelDisplayLimit: 3,
      flightDisplayLimit: 4,
      generationMode: "qingmao_advantage",
      targetAdvantageRatio: 70,
      comparisonMode: "internal_discussion"
    });

    expect(result.status.flightFull).toBe(false);
    expect(result.status.hotelFull).toBe(false);
    expect(result.status.flightAdvantageRatio).toBe(50);
    expect(result.status.hotelAdvantageRatio).toBe(0);
    expect(result.status.flightTargetMet).toBe(false);
    expect(result.status.hotelTargetMet).toBe(false);
    expect(result.status.exportPrefix).toBe("【随】");
    expect(result.status.exportStatus).toBe("未满量未达标");
    expect(result.status.exportAdvantageRatio).toBe(0);
    expect(result.status.exportNamePreview).toBe("【随】青猫差旅一体化比价-酒店1-航班2-优势0%.zip");
  });

  it("builds customer-safe export file base names with advantage ratio instead of not-met wording", () => {
    expect(buildThirdVersionExportBaseName({ exportPrefix: "【青】", hotelDisplayed: 40, flightDisplayed: 20, exportStatus: "达标", exportAdvantageRatio: 100 })).toBe("【青】青猫差旅一体化比价-酒店40-航班20-优势100%");
    expect(buildThirdVersionExportBaseName({ exportPrefix: "【青】", hotelDisplayed: 35, flightDisplayed: 18, exportStatus: "未满量", exportAdvantageRatio: 80 })).toBe("【青】青猫差旅一体化比价-酒店35-航班18-优势80%");
    expect(buildThirdVersionExportBaseName({ exportPrefix: "【随】", hotelDisplayed: 40, flightDisplayed: 20, exportStatus: "未达标", exportAdvantageRatio: 40 })).toBe("【随】青猫差旅一体化比价-酒店40-航班20-优势40%");
    expect(buildThirdVersionExportBaseName({ exportPrefix: "【随】", hotelDisplayed: 35, flightDisplayed: 18, exportStatus: "未满量未达标", exportAdvantageRatio: 25 })).toBe("【随】青猫差旅一体化比价-酒店35-航班18-优势25%");
  });

  it("accepts a fixed real historical second-version batch snapshot without running collectors", () => {
    const realBatch = loadRealSnapshotFixture();
    const result = applyThirdVersionStrategy(realBatch, {
      hotelDisplayLimit: 40,
      flightDisplayLimit: 20,
      generationMode: "qingmao_advantage",
      targetAdvantageRatio: 70,
      comparisonMode: "internal_discussion"
    }, {
      random: () => 0.5
    });

    expect(realBatch.id).toBe("batch-2026-06-01-045652-second-version-final-acceptance");
    expect(result.status.rawFlightCandidates).toBe(20);
    expect(result.status.rawHotelCandidates).toBe(40);
    expect(result.status.flightDisplayed).toBe(20);
    expect(result.status.hotelDisplayed).toBe(40);
    expect(result.status.flightFull).toBe(true);
    expect(result.status.hotelFull).toBe(true);
    expect(result.status.flightAdvantageDenominator).toBe(20);
    expect(result.status.hotelAdvantageDenominator).toBe(40);
    expect(result.status.flightAdvantageRatio).toBeGreaterThanOrEqual(0);
    expect(result.status.flightAdvantageRatio).toBeLessThanOrEqual(100);
    expect(result.status.hotelAdvantageRatio).toBeGreaterThanOrEqual(0);
    expect(result.status.hotelAdvantageRatio).toBeLessThanOrEqual(100);
    expect(result.status.exportNamePreview).toMatch(/^【(青|随)】青猫差旅一体化比价-酒店40-航班20-优势\d+%\.zip$/);
    expect(result.status.exportNamePreview).not.toContain("未达标");
    expect(result.flights.every((sample) => sample.quotes.length === 4)).toBe(true);
    expect(result.hotels.every((sample) => sample.ratePlans.length > 0)).toBe(true);
  });

  it("builds a third-version delivery batch from a historical second-version batch while preserving raw trace data", () => {
    const realBatch = loadRealSnapshotFixture();
    const deliveryBatch = buildThirdVersionDeliveryBatch(realBatch, {
      hotelDisplayLimit: 8,
      flightDisplayLimit: 4,
      generationMode: "real_random",
      targetAdvantageRatio: 70,
      comparisonMode: "external_sales"
    }, {
      random: () => 0.5
    });

    expect(deliveryBatch.samples).toHaveLength(4);
    expect(deliveryBatch.hotels).toHaveLength(8);
    expect(deliveryBatch.sampleCount).toBe(12);
    expect(deliveryBatch.thirdVersion?.sourceBatchId).toBe(realBatch.id);
    expect(deliveryBatch.thirdVersion?.rawSamples).toHaveLength(20);
    expect(deliveryBatch.thirdVersion?.rawHotels).toHaveLength(40);
    expect(deliveryBatch.thirdVersion?.status.rawFlightCandidates).toBe(20);
    expect(deliveryBatch.thirdVersion?.status.rawHotelCandidates).toBe(40);
    expect(deliveryBatch.failureNotes?.some((note) => note.includes("第三版策略来源批次"))).toBe(true);
    expect(deliveryBatch.failureNotes?.some((note) => note.includes("比价口径：对外销售"))).toBe(true);

    const rebuiltFromDeliveryBatch = buildThirdVersionDeliveryBatch(deliveryBatch, {
      hotelDisplayLimit: 6,
      flightDisplayLimit: 3,
      generationMode: "real_random",
      targetAdvantageRatio: 70,
      comparisonMode: "internal_discussion"
    }, {
      random: () => 0.5
    });

    expect(rebuiltFromDeliveryBatch.thirdVersion?.rawSamples).toHaveLength(20);
    expect(rebuiltFromDeliveryBatch.thirdVersion?.rawHotels).toHaveLength(40);
    expect(rebuiltFromDeliveryBatch.samples).toHaveLength(3);
    expect(rebuiltFromDeliveryBatch.hotels).toHaveLength(6);
  });

  it("produces a four-platform lightweight regression report from the historical real batch", () => {
    const realBatch = loadRealSnapshotFixture();
    const report = buildThirdVersionPlatformRegressionReport(realBatch);

    expect(report.passed).toBe(true);
    expect(report.platforms.map((platform) => platform.platform)).toEqual(["青猫差旅", "携程商旅", "阿里商旅", "在途商旅"]);
    for (const platform of report.platforms) {
      expect(platform.rawFlightQuoteCount).toBe(20);
      expect(platform.rawHotelQuoteCount).toBeGreaterThan(0);
      expect(platform.evidenceCount).toBeGreaterThan(0);
      expect(platform.priceOrFailureCount).toBe(platform.rawFlightQuoteCount + platform.rawHotelQuoteCount);
    }
    expect(report.notes.some((note) => note.includes("第三版策略层未删除四平台原始报价"))).toBe(true);
  });
});

describe("third version comparison modes", () => {
  it("uses external sales wording against competitor average when Qingmao is lowest for flights and hotels", () => {
    const flightSample = flight("flight-sales-lowest", 90, [120, 150, 180]);
    const hotelSample = hotel("hotel-sales-lowest", "东呈集团", "大床有早餐", 90, [120, 150, 180]);
    const options = { comparisonMode: "external_sales" as const };

    const flightSummary = summarizeFlight(flightSample, options);
    const hotelSummary = summarizeQuoteSet(primaryHotelQuotes(hotelSample), options);

    for (const summary of [flightSummary, hotelSummary]) {
      expect(summary.comparisonBasis).toBe("competitorAverage");
      expect(summary.qingmaoGap).toBe(-60);
      expect(summary.comparisonLabel).toBe("低于竞品平均价60元");
      expect(summary.conclusion).toContain("青猫差旅低于竞品平均价60元");
    }
  });

  it("uses external sales wording against competitor range when Qingmao is between competitors for flights and hotels", () => {
    const flightSample = flight("flight-sales-middle", 150, [100, 170, 200]);
    const hotelSample = hotel("hotel-sales-middle", "东呈集团", "大床有早餐", 150, [100, 170, 200]);
    const options = { comparisonMode: "external_sales" as const };

    const flightSummary = summarizeFlight(flightSample, options);
    const hotelSummary = summarizeQuoteSet(primaryHotelQuotes(hotelSample), options);

    for (const summary of [flightSummary, hotelSummary]) {
      expect(summary.comparisonBasis).toBe("competitorRange");
      expect(summary.qingmaoGap).toBe(50);
      expect(summary.comparisonLabel).toBe("高于竞品最低价50元，同时低于竞品最高价50元");
      expect(summary.conclusion).toContain("青猫差旅高于竞品最低价50元，同时低于竞品最高价50元");
    }
  });

  it("uses external sales wording against competitor average when Qingmao is highest for flights and hotels", () => {
    const flightSample = flight("flight-sales-highest", 210, [120, 150, 180]);
    const hotelSample = hotel("hotel-sales-highest", "东呈集团", "大床有早餐", 210, [120, 150, 180]);
    const options = { comparisonMode: "external_sales" as const };

    const flightSummary = summarizeFlight(flightSample, options);
    const hotelSummary = summarizeQuoteSet(primaryHotelQuotes(hotelSample), options);

    for (const summary of [flightSummary, hotelSummary]) {
      expect(summary.comparisonBasis).toBe("competitorAverage");
      expect(summary.qingmaoGap).toBe(60);
      expect(summary.comparisonLabel).toBe("高于竞品平均价60元");
      expect(summary.conclusion).toContain("青猫差旅高于竞品平均价60元");
    }
  });

  it("compares only the selected competitor when specified platform has a price for flights and hotels", () => {
    const flightSample = flight("flight-specified-priced", 140, [100, 160, 180]);
    const hotelSample = hotel("hotel-specified-priced", "东呈集团", "大床有早餐", 140, [100, 160, 180]);
    const options = { comparisonMode: "specified_platform" as const, specifiedPlatform: "阿里商旅" as const };

    const flightSummary = summarizeFlight(flightSample, options);
    const hotelSummary = summarizeQuoteSet(primaryHotelQuotes(hotelSample), options);

    for (const summary of [flightSummary, hotelSummary]) {
      expect(summary.comparisonBasis).toBe("specifiedPlatform");
      expect(summary.competitorCount).toBe(1);
      expect(summary.qingmaoGap).toBe(-20);
      expect(summary.comparisonLabel).toBe("对比阿里商旅低了20元");
      expect(summary.conclusion).toContain("青猫差旅对比阿里商旅低了20元");
    }
  });

  it("shows unavailable for a missing specified platform price and excludes it from advantage metrics", () => {
    const sourceBatch = batch(
      [flight("flight-specified-missing", 140, [100, null, 180])],
      [hotel("hotel-specified-missing", "东呈集团", "大床有早餐", 140, [100, null, 180])]
    );
    const options = { comparisonMode: "specified_platform" as const, specifiedPlatform: "阿里商旅" as const };

    const flightSummary = summarizeFlight(sourceBatch.samples[0], options);
    const hotelSummary = summarizeQuoteSet(primaryHotelQuotes(sourceBatch.hotels![0]), options);
    const strategyResult = applyThirdVersionStrategy(sourceBatch, {
      hotelDisplayLimit: 1,
      flightDisplayLimit: 1,
      generationMode: "qingmao_advantage",
      targetAdvantageRatio: 70,
      ...options
    });

    for (const summary of [flightSummary, hotelSummary]) {
      expect(summary.comparisonBasis).toBe("specifiedPlatformUnavailable");
      expect(summary.qingmaoGap).toBeNull();
      expect(summary.comparisonLabel).toBe("暂无");
      expect(summary.conclusion).toBe("阿里商旅暂无可比价格。");
    }
    expect(strategyResult.status.flightAdvantageDenominator).toBe(0);
    expect(strategyResult.status.hotelAdvantageDenominator).toBe(0);
    expect(strategyResult.status.flightAdvantageRatio).toBe(0);
    expect(strategyResult.status.hotelAdvantageRatio).toBe(0);
  });
});
