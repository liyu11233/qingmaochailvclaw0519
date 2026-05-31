export type RouteScope = "国内" | "国际";

export type PlatformName = "青猫差旅" | "携程商旅" | "阿里商旅" | "在途商旅";

export type QuoteStatus = "可订" | "无同航班" | "未展示" | "不可订" | "采集失败";

export interface RouteConfig {
  id: string;
  scope: RouteScope;
  origin: string;
  destination: string;
  directRule: "直飞" | "优先直飞";
}

export interface PlatformQuote {
  platform: PlatformName;
  price: number | null;
  refundRule: string;
  baggageRule: string;
  available: boolean;
  status: QuoteStatus;
  evidencePath: string;
  sourceUrl: string;
  rawHotelName?: string;
  rawRoomName?: string;
  normalizedRoomLabel?: HotelRatePlanLabel;
  missingReason?: string;
}

export interface FlightSample {
  id: string;
  routeId: string;
  scope: RouteScope;
  origin: string;
  destination: string;
  travelDate: string;
  flightNo: string;
  airline: string;
  cabin: "经济舱";
  directType: "直飞" | "中转";
  transferCity: string;
  durationMinutes: number;
  quotes: PlatformQuote[];
}

export type HotelGroup = "如家集团" | "锦江集团" | "华住集团" | "东呈集团" | "亚朵集团";

export type HotelRatePlanLabel = "大床无早餐" | "大床有早餐" | "双床无早餐" | "双床有早餐";

export type HotelCoverImageStatus = "saved" | "missing" | "failed";

export interface HotelCoverImageFields {
  coverImageUrl?: string;
  coverImagePath?: string;
  coverImageSource?: PlatformName;
  coverImageStatus?: HotelCoverImageStatus;
  coverImageFailureReason?: string;
}

export interface HotelRatePlan {
  label: HotelRatePlanLabel;
  quotes: PlatformQuote[];
  isFourPlatformComplete?: boolean;
  pricedPlatformCount?: number;
  missingPlatforms?: PlatformName[];
}

export interface HotelSample extends HotelCoverImageFields {
  id: string;
  group: HotelGroup;
  brand: string;
  hotelName: string;
  city: string;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  primaryRatePlan: HotelRatePlanLabel;
  defaultRatePlan?: HotelRatePlanLabel | null;
  defaultRatePlanReason?: string;
  salesDisplayEligible?: boolean;
  salesDisplayReason?: string;
  completeRatePlanCount?: number;
  ratePlans: HotelRatePlan[];
}

export interface CollectionBatch {
  id: string;
  status: "ready" | "failed" | "running";
  generatedAt: string;
  sampleCount: number;
  successCount: number;
  failedCount: number;
  samples: FlightSample[];
  hotels?: HotelSample[];
  failureNotes?: string[];
}

export interface FlightSummary {
  sampleId: string;
  lowestPlatform: PlatformName | "";
  qingmaoGap: number | null;
  comparisonBasis: "lowestCompetitor" | "unavailable";
  comparisonLabel: string;
  availablePlatformCount: number;
  evidenceCount: number;
  conclusion: string;
}

export interface PriceComparisonSummary {
  lowestPlatform: PlatformName | "";
  qingmaoGap: number | null;
  comparisonBasis: "lowestCompetitor" | "unavailable";
  comparisonLabel: string;
  conclusion: string;
  competitorCount: number;
}
