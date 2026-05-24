import type { HotelRatePlan, HotelRatePlanLabel, HotelSample, PlatformName } from "./types";

export const HOTEL_DISPLAY_RATE_PLAN_PRIORITY: HotelRatePlanLabel[] = [
  "大床有早餐",
  "大床无早餐",
  "双床有早餐",
  "双床无早餐"
];

export const HOTEL_COMPARISON_PLATFORMS: PlatformName[] = ["青猫差旅", "携程商旅", "阿里商旅", "在途商旅"];

export interface HotelRatePlanCompleteness {
  pricedPlatformCount: number;
  missingPlatforms: PlatformName[];
  isFourPlatformComplete: boolean;
}

export interface HotelDisplayDecision {
  defaultRatePlan: HotelRatePlanLabel | null;
  defaultRatePlanReason: string;
  salesDisplayEligible: boolean;
  salesDisplayReason: string;
  completeRatePlanCount: number;
}

export function analyzeHotelRatePlanCompleteness(ratePlan: HotelRatePlan): HotelRatePlanCompleteness {
  const pricedPlatforms = new Set(
    ratePlan.quotes
      .filter((quote) => quote.available && typeof quote.price === "number")
      .map((quote) => quote.platform)
  );
  const missingPlatforms = HOTEL_COMPARISON_PLATFORMS.filter((platform) => !pricedPlatforms.has(platform));

  return {
    pricedPlatformCount: pricedPlatforms.size,
    missingPlatforms,
    isFourPlatformComplete: missingPlatforms.length === 0
  };
}

function priorityIndex(label: HotelRatePlanLabel) {
  const index = HOTEL_DISPLAY_RATE_PLAN_PRIORITY.indexOf(label);
  return index >= 0 ? index : HOTEL_DISPLAY_RATE_PLAN_PRIORITY.length;
}

export function resolveHotelDisplayDecision(ratePlans: HotelRatePlan[]): HotelDisplayDecision {
  if (!ratePlans.length) {
    return {
      defaultRatePlan: null,
      defaultRatePlanReason: "未采集到酒店房型早餐口径",
      salesDisplayEligible: false,
      salesDisplayReason: "4 个口径均未采集到四平台完整价格",
      completeRatePlanCount: 0
    };
  }

  const ranked = ratePlans
    .map((ratePlan) => ({
      ratePlan,
      completeness: analyzeHotelRatePlanCompleteness(ratePlan)
    }))
    .sort((left, right) => {
      if (left.completeness.pricedPlatformCount !== right.completeness.pricedPlatformCount) {
        return right.completeness.pricedPlatformCount - left.completeness.pricedPlatformCount;
      }
      return priorityIndex(left.ratePlan.label) - priorityIndex(right.ratePlan.label);
    });
  const completeRatePlans = ranked.filter((item) => item.completeness.isFourPlatformComplete);
  const defaultPlan = ranked[0];

  return {
    defaultRatePlan: defaultPlan.ratePlan.label,
    defaultRatePlanReason: completeRatePlans.length
      ? `${defaultPlan.ratePlan.label}为当前最完整可比口径；同完整度时按展示优先级选择`
      : `${defaultPlan.ratePlan.label}为当前价格平台数最多的口径，但未达到四平台完整`,
    salesDisplayEligible: completeRatePlans.length > 0,
    salesDisplayReason: completeRatePlans.length
      ? `至少 ${completeRatePlans.length} 个口径四平台都有价格`
      : "4 个口径均没有四平台完整价格，只进入后台留痕",
    completeRatePlanCount: completeRatePlans.length
  };
}

export function resolveHotelPrimaryRatePlan(hotel: HotelSample): HotelRatePlan | undefined {
  const decision = resolveHotelDisplayDecision(hotel.ratePlans);
  return hotel.ratePlans.find((ratePlan) => ratePlan.label === decision.defaultRatePlan)
    ?? hotel.ratePlans.find((ratePlan) => ratePlan.label === hotel.primaryRatePlan)
    ?? hotel.ratePlans[0];
}

export function enrichHotelSampleDisplayDecision<T extends HotelSample>(hotel: T): T {
  const decision = resolveHotelDisplayDecision(hotel.ratePlans);
  const ratePlans = hotel.ratePlans.map((ratePlan) => {
    const completeness = analyzeHotelRatePlanCompleteness(ratePlan);
    return {
      ...ratePlan,
      isFourPlatformComplete: completeness.isFourPlatformComplete,
      pricedPlatformCount: completeness.pricedPlatformCount,
      missingPlatforms: completeness.missingPlatforms
    };
  });

  return {
    ...hotel,
    primaryRatePlan: decision.defaultRatePlan ?? hotel.primaryRatePlan,
    defaultRatePlan: decision.defaultRatePlan,
    defaultRatePlanReason: decision.defaultRatePlanReason,
    salesDisplayEligible: decision.salesDisplayEligible,
    salesDisplayReason: decision.salesDisplayReason,
    completeRatePlanCount: decision.completeRatePlanCount,
    ratePlans
  };
}
