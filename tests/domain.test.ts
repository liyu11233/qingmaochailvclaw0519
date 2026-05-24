import { describe, expect, it } from "vitest";
import { FIXED_ROUTES, buildFakeBatch } from "../src/domain/fakeBatch";
import { summarizeFlight } from "../src/domain/comparison";
import { enrichHotelSampleDisplayDecision, resolveHotelDisplayDecision } from "../src/domain/hotelRatePlans";
import type { HotelRatePlan, PlatformName, PlatformQuote } from "../src/domain/types";

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
    missingReason: typeof price === "number" ? undefined : "该口径暂无价格"
  };
}

function hotelRatePlan(label: HotelRatePlan["label"], prices: Array<number | null>): HotelRatePlan {
  return {
    label,
    quotes: hotelPlatforms.map((platform, index) => hotelQuote(platform, prices[index]))
  };
}

describe("fake batch generation", () => {
  it("builds one current batch with 20 fixed route samples and 4 platform quotes each", () => {
    const batch = buildFakeBatch(new Date("2026-05-18T10:00:00+08:00"));

    expect(FIXED_ROUTES).toHaveLength(20);
    expect(batch.samples).toHaveLength(20);
    expect(batch.status).toBe("ready");
    expect(batch.generatedAt).toMatch("2026-05-18");

    for (const sample of batch.samples) {
      expect(sample.travelDate).toBe("2026-05-21");
      expect(sample.cabin).toBe("经济舱");
      expect(sample.quotes.map((quote) => quote.platform)).toEqual([
        "青猫差旅",
        "携程商旅",
        "阿里商旅",
        "在途商旅"
      ]);
      expect(sample.quotes).toHaveLength(4);
      expect(sample.quotes.every((quote) => quote.available && typeof quote.price === "number" && quote.status === "可订" && quote.evidencePath)).toBe(true);
    }
  });

  it("builds hotel demo data by group with four visible rate plans", () => {
    const batch = buildFakeBatch(new Date("2026-05-18T10:00:00+08:00"));

    expect(batch.hotels).toHaveLength(40);
    expect(new Set(batch.hotels?.map((hotel) => hotel.group))).toEqual(new Set(["如家集团", "锦江集团", "华住集团", "东呈集团", "亚朵集团"]));

    for (const hotel of batch.hotels ?? []) {
      expect(hotel.checkInDate).toBe("2026-05-19");
      expect(hotel.checkOutDate).toBe("2026-05-20");
      expect(hotel.nights).toBe(1);
      expect(hotel.ratePlans).toHaveLength(4);
      expect(hotel.primaryRatePlan).toBe("大床有早餐");
      expect(hotel.defaultRatePlan).toBe("大床有早餐");
      expect(hotel.salesDisplayEligible).toBe(true);
      expect(hotel.completeRatePlanCount).toBe(4);
      expect(hotel.ratePlans.find((rate) => rate.label === "大床有早餐")?.quotes).toHaveLength(4);
      expect(hotel.ratePlans.every((rate) => rate.quotes.every((quote) => quote.platform && quote.evidencePath))).toBe(true);
    }
  });

  it("selects the hotel default rate plan by completeness before display priority", () => {
    const decision = resolveHotelDisplayDecision([
      hotelRatePlan("大床有早餐", [320, 330, 340, null]),
      hotelRatePlan("大床无早餐", [300, 310, 315, 305]),
      hotelRatePlan("双床有早餐", [350, 360, 370, 355]),
      hotelRatePlan("双床无早餐", [280, 290, null, null])
    ]);

    expect(decision.defaultRatePlan).toBe("大床无早餐");
    expect(decision.salesDisplayEligible).toBe(true);
    expect(decision.completeRatePlanCount).toBe(2);
  });

  it("keeps hotels out of sales display when no rate plan has four platform prices", () => {
    const batch = buildFakeBatch(new Date("2026-05-18T10:00:00+08:00"));
    const hotel = enrichHotelSampleDisplayDecision({
      ...batch.hotels![0],
      ratePlans: [
        hotelRatePlan("大床有早餐", [320, 330, 340, null]),
        hotelRatePlan("大床无早餐", [300, 310, null, null]),
        hotelRatePlan("双床有早餐", [350, null, null, null]),
        hotelRatePlan("双床无早餐", [280, null, null, null])
      ]
    });

    expect(hotel.primaryRatePlan).toBe("大床有早餐");
    expect(hotel.salesDisplayEligible).toBe(false);
    expect(hotel.salesDisplayReason).toContain("只进入后台留痕");
  });

  it("uses time in the batch id so manual collections on the same day do not overwrite each other", () => {
    const morning = buildFakeBatch(new Date("2026-05-18T10:00:00+08:00"));
    const afternoon = buildFakeBatch(new Date("2026-05-18T15:30:12+08:00"));

    expect(morning.id).not.toBe(afternoon.id);
    expect(morning.id).toMatch(/batch-2026-05-18-\d{6}-demo/);
  });
});

describe("flight comparison summary", () => {
  it("compares Qingmao against the highest competitor price when Qingmao is lowest", () => {
    const batch = buildFakeBatch(new Date("2026-05-18T10:00:00+08:00"));
    const summary = summarizeFlight(batch.samples[0]);

    expect(summary.lowestPlatform).toBe("青猫差旅");
    expect(summary.qingmaoGap).toBe(-103);
    expect(summary.comparisonBasis).toBe("highestCompetitor");
    expect(summary.conclusion).toContain("对比另外3家平台最高价低了103元");
    expect(summary.evidenceCount).toBe(4);
  });

  it("compares Qingmao against the average competitor price when Qingmao is not lowest", () => {
    const batch = buildFakeBatch(new Date("2026-05-18T10:00:00+08:00"));
    const sample = {
      ...batch.samples[0],
      quotes: batch.samples[0].quotes.map((quote) =>
        quote.platform === "青猫差旅"
          ? { ...quote, price: 160 }
          : quote.platform === "携程商旅"
            ? { ...quote, price: 90 }
            : quote.platform === "阿里商旅"
              ? { ...quote, price: 120 }
              : { ...quote, price: 150 }
      )
    };

    const summary = summarizeFlight(sample);

    expect(summary.lowestPlatform).toBe("携程商旅");
    expect(summary.qingmaoGap).toBe(40);
    expect(summary.comparisonBasis).toBe("averageCompetitor");
    expect(summary.conclusion).toContain("对比另外3家平台平均价高了40元");
  });

  it("keeps missing same-flight quotes out of the lowest-price calculation", () => {
    const batch = buildFakeBatch(new Date("2026-05-18T10:00:00+08:00"));
    const sample = {
      ...batch.samples[0],
      quotes: batch.samples[0].quotes.map((quote) =>
        quote.platform === "阿里商旅"
          ? { ...quote, available: false, price: null, status: "无同航班" as const }
          : quote
      )
    };

    const summary = summarizeFlight(sample);

    expect(summary.availablePlatformCount).toBe(3);
    expect(summary.conclusion).not.toContain("阿里商旅最低");
  });
});
