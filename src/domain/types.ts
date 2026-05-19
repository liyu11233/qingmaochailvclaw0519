export type RouteScope = "国内" | "国际";

export type PlatformName = "青猫差旅" | "携程商旅" | "阿里商旅";

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

export interface CollectionBatch {
  id: string;
  status: "ready" | "failed" | "running";
  generatedAt: string;
  sampleCount: number;
  successCount: number;
  failedCount: number;
  samples: FlightSample[];
  failureNotes?: string[];
}

export interface FlightSummary {
  sampleId: string;
  lowestPlatform: PlatformName | "";
  qingmaoGap: number | null;
  availablePlatformCount: number;
  evidenceCount: number;
  conclusion: string;
}
