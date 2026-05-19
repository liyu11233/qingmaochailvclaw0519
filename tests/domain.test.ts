import { describe, expect, it } from "vitest";
import { FIXED_ROUTES, buildFakeBatch } from "../src/domain/fakeBatch";
import { summarizeFlight } from "../src/domain/comparison";

describe("fake batch generation", () => {
  it("builds one current batch with 20 fixed route samples and 3 platform quotes each", () => {
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
        "阿里商旅"
      ]);
      expect(sample.quotes).toHaveLength(3);
    }
  });

  it("uses time in the batch id so manual collections on the same day do not overwrite each other", () => {
    const morning = buildFakeBatch(new Date("2026-05-18T10:00:00+08:00"));
    const afternoon = buildFakeBatch(new Date("2026-05-18T15:30:12+08:00"));

    expect(morning.id).not.toBe(afternoon.id);
    expect(morning.id).toMatch(/batch-2026-05-18-\d{6}-demo/);
  });
});

describe("flight comparison summary", () => {
  it("compares Qingmao against the lowest competitor price", () => {
    const batch = buildFakeBatch(new Date("2026-05-18T10:00:00+08:00"));
    const summary = summarizeFlight(batch.samples[0]);

    expect(summary.lowestPlatform).toBe("携程商旅");
    expect(summary.qingmaoGap).toBe(-63);
    expect(summary.conclusion).toContain("低63元");
    expect(summary.evidenceCount).toBe(3);
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

    expect(summary.availablePlatformCount).toBe(2);
    expect(summary.conclusion).not.toContain("阿里商旅最低");
  });
});
