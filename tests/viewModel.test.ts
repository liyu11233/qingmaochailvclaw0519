import { describe, expect, it } from "vitest";
import { buildFakeBatch } from "../src/domain/fakeBatch";
import { buildDashboardView, formatMoney } from "../src/ui/viewModel";

describe("dashboard view model", () => {
  it("builds management metrics from the latest batch", () => {
    const batch = buildFakeBatch(new Date("2026-05-18T10:00:00+08:00"));
    const view = buildDashboardView(batch);

    expect(view.sampleCount).toBe(20);
    expect(view.domesticCount).toBe(10);
    expect(view.internationalCount).toBe(10);
    expect(view.notHigherThanLowestCount).toBeGreaterThan(0);
    expect(view.higherThanLowestCount).toBeGreaterThan(0);
    expect(view.samples[0].routeLabel).toBe("广州-上海");
    expect(view.samples[0].gapLabel).toBe("低63元");
    expect(view.samples[0].gapTone).toBe("advantage");
  });

  it("formats platform money safely", () => {
    expect(formatMoney(1234)).toBe("¥1,234");
    expect(formatMoney(null, "无同航班")).toBe("无同航班");
  });
});
