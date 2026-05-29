import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  classifyProbeOutcome,
  classifyZtripProbeOutcome,
  classifyZtripProductEntries,
  classifyZtripHotelSearchReadiness,
  collectHotelMainRateCompetitorQuotes,
  assertCompetitorHotelDetailSameByDoorPlate,
  buildCtripHotelSearchKeywords,
  buildCtripHotelCoreKeywords,
  buildStrictCtripHotelSearchUrl,
  buildHotelSearchKeywords,
  buildAliHotelSearchKeywords,
  buildAliHotelSearchKeywordPlan,
  buildAliHotelPathRecord,
  appendAliHotelPathRecord,
  collectAliHotelListCardsForMatching,
  confirmAliHotelDetailDoorPlate,
  waitForAliHotelDetailIdentityText,
  applyAliHotelDetailDiagnosisToTrace,
  buildFailedAliHotelMainRateQuote,
  rankAliHotelDetailCandidateCards,
  resolveAliHotelDetailCandidateAttempts,
  resolveAliHotelSameHotelAfterFailure,
  formatAliHotelListMatchFailure,
  matchAliHotelListCandidateForDetail,
  matchAliHotelSearchSuggestionText,
  matchAliHotelListCandidateText,
  matchHotelByBrandCoreCityDoorNumber,
  selectAliHotelListMatchFromCards,
  parseAliHotelListCardText,
  classifyCtripHotelListReadiness,
  matchCtripHotelSuggestionText,
  CTRIP_SEARCH_STATE_STALE_ERROR,
  CTRIP_LIST_NOT_LOADED_ERROR,
  CTRIP_SUGGESTION_NOT_SELECTED_ERROR,
  buildHotelPageTextSummary,
  buildCtripHotelSuggestionKeywords,
  canSubmitCtripHotelSearchAfterSuggestionSelection,
  shouldRetryCtripHotelSuggestionSelection,
  shouldUseCtripListKeywordFallback,
  extractCtripHotelIdWithSourceFromUrl,
  extractSameFlightQuoteFromText,
  extractHotelDoorNumber,
  extractExcludedHotelRateRowsFromText,
  hasCompleteSameFlightQuotes,
  classifyHotelCalibrationFailureType,
  extractHotelDoorPlate,
  isHotelCandidateRelevantForQuery,
  isSameHotelByCityAndDoorPlate,
  matchCtripHotelListCandidateText,
  evaluateCtripHotelDetailKeywordAttempt,
  normalizeHotelSearchKeywords,
  parseAliHotelMainRatesText,
  parseCtripHotelMainRatesText,
  parseDurationMinutes,
  mergeQingmaoHotelCandidatesFromTexts,
  parseQingmaoHotelCandidatesText,
  parseQingmaoHotelMainRatesText,
  parseQingmaoFlightCandidateText,
  parseQingmaoInternationalFlightCandidatesText,
  readHotelCalibrationRatesFromText,
  resolveHotelCalibrationPlatformOrder,
  buildZtripSingleAllRatePlanReadSteps,
  isHotelCalibrationSampleComplete,
  selectHotelCalibrationDefaultRatePlan,
  selectLowestHotelMainRateQuote,
  selectZtripHotelRateForRatePlan,
  shouldDowngradeZtripRatePlanFilterFailure,
  shouldExpandZtripRoomCardForLowestRate,
  shouldStopHotelAllRatePlanCollectionAfterQuoteFailure,
  resolveHotelSmallBatchBudgetStop,
  resolveHotelSmallBatchOverallBudgetStop,
  getHotelSmallBatchGroupSearchKeywords,
  shouldSkipHotelSmallBatchCandidate,
  summarizeHotelSmallBatchGroups,
  aggregateHotelScaleValidationTimings,
  buildHotelDiagnosticReviewHtml,
  buildHotelSingleAllRatePlansReviewHtml,
  buildHotelScaleValidationInput,
  buildInitialHotelScaleValidationResult,
  collectHotelCoverImageFromPage,
  evaluateHotelScaleValidationEvidence,
  getHotelScaleValidationGroupSearchKeywords,
  isHotelRateLineExcludedByBedAssignment,
  resolveHotelScaleValidationBudgetStop,
  resolveHotelScaleValidationOverallBudgetStop,
  summarizeHotelScaleValidationGroups,
  parseZtripFlightCandidatesText,
  parseZtripHotelRatesText,
  parseZtripHotelRatesTextForRatePlan,
  readQingmaoHotelTotalCount,
  readZtripTotalFlightCount,
  scoreHotelNameMatch,
  selectLockedQingmaoHotelCandidate,
  validateQingmaoHotelCandidateSearchState,
  validateStrictCtripHotelSearchState
} from "../server/collectors/pilot";

describe("pilot collector", () => {
  function calibrationPlatform(platform: "青猫差旅" | "携程商旅" | "阿里商旅" | "在途商旅", prices: Record<string, number | null>) {
    return {
      platform,
      sameHotel: true,
      matchBasis: "同城市 + 同门牌号",
      platformHotelName: `${platform}测试酒店`,
      platformAddress: "广州市测试路1号",
      platformDoorPlate: "1号",
      hasMainRate: typeof prices["大床有早餐"] === "number",
      mainRatePrice: prices["大床有早餐"],
      otherRates: {
        大床无早餐: prices["大床无早餐"] ?? null,
        双床有早餐: prices["双床有早餐"] ?? null,
        双床无早餐: prices["双床无早餐"] ?? null
      },
      ratePrices: {
        大床无早餐: prices["大床无早餐"] ?? null,
        大床有早餐: prices["大床有早餐"] ?? null,
        双床无早餐: prices["双床无早餐"] ?? null,
        双床有早餐: prices["双床有早餐"] ?? null
      },
      durationMs: 1,
      failureType: null,
      failureReason: "",
      finalUrl: "https://example.com",
      pageTextSummary: "测试酒店"
    };
  }

  it("treats hotel calibration as complete when any one rate plan has four platform prices", () => {
    const platforms = [
      calibrationPlatform("青猫差旅", { 大床有早餐: 320, 大床无早餐: 300, 双床有早餐: 350, 双床无早餐: null }),
      calibrationPlatform("携程商旅", { 大床有早餐: 330, 大床无早餐: 310, 双床有早餐: 360, 双床无早餐: null }),
      calibrationPlatform("阿里商旅", { 大床有早餐: 340, 大床无早餐: 320, 双床有早餐: 370, 双床无早餐: null }),
      calibrationPlatform("在途商旅", { 大床有早餐: null, 大床无早餐: 305, 双床有早餐: 365, 双床无早餐: null })
    ];

    expect(isHotelCalibrationSampleComplete(platforms, ["青猫差旅", "携程商旅", "阿里商旅", "在途商旅"])).toBe(true);
    expect(selectHotelCalibrationDefaultRatePlan(platforms, ["青猫差旅", "携程商旅", "阿里商旅", "在途商旅"])).toBe("大床无早餐");
  });

  it("treats login urls as requiring login even when the visible text is sparse", () => {
    expect(classifyProbeOutcome("下载移动端 联系客服", "https://travel.alibtrip.com/index.html#/login")).toBe("login-required");
    expect(classifyProbeOutcome("欢迎使用携程商旅 密码登录 验证码登录", "https://ct.ctrip.com/login")).toBe("login-required");
    expect(classifyProbeOutcome("首页 差旅预订 国内机票 国内酒店", "https://booking.tmctrip.com/TravelBooking")).toBe("reachable");
    expect(classifyProbeOutcome("下载移动端 登录信息 机票 酒店", "https://travel.alibtrip.com/index.html?corpId=x#/flight")).toBe("reachable");
    expect(classifyProbeOutcome("阿里商旅 机票列表 登录信息", "https://travel.alibtrip.com/flight-new?corpId=x&userId=y#/i-search-list")).toBe("reachable");
    expect(classifyProbeOutcome("开启你的差旅行程 登录信息 机票", "https://ct.ctrip.com/online/home?language=zh-CN")).toBe("reachable");
  });

  it("classifies ztrip pages separately so login screens do not pass validation", () => {
    expect(classifyZtripProbeOutcome("在途商旅 密码登录 验证码登录", "https://www.z-trip.cn/v/vcommon/home")).toBe("login-required");
    expect(classifyZtripProbeOutcome("在途商旅 国内机票 国内酒店 差旅订单", "https://www.z-trip.cn/v/vcommon/home")).toBe("reachable");
    expect(classifyZtripProbeOutcome("Gateway Timeout", "https://www.z-trip.cn/v/vcommon/home")).toBe("failed");
    expect(classifyZtripProbeOutcome("loading...", "https://www.z-trip.cn/v/vcommon/home")).toBe("failed");
  });

  it("recognizes ztrip flight and hotel entries after opening booking", () => {
    const checks = classifyZtripProductEntries("机票 酒店 火车 用车 单程 往返 国内机票 国际/中国港澳台机票", "reachable");
    expect(checks).toEqual([
      { target: "航班入口", outcome: "reachable", note: "航班入口已在页面中出现" },
      { target: "酒店入口", outcome: "reachable", note: "酒店入口已在页面中出现" }
    ]);

    expect(classifyZtripProductEntries("首页 近期行程 我的订单", "reachable").map((check) => check.outcome)).toEqual(["failed", "failed"]);
  });

  it("parses qingmao flight candidate text from the DOM list", () => {
    const candidate = parseQingmaoFlightCandidateText(
      "春秋9C8930 空客321(中) 06:45 广州白云 T3 2小时25分 09:10 上海虹桥 T1 有餐食 ￥370起 经济舱1.6折 选择"
    );

    expect(candidate).toMatchObject({
      airline: "春秋",
      flightNo: "9C8930",
      aircraft: "空客321(中)",
      departureTime: "06:45",
      arrivalTime: "09:10",
      originAirport: "广州白云T3",
      destinationAirport: "上海虹桥T1",
      durationMinutes: 145,
      price: 370,
      cabin: "经济舱",
      discount: "经济舱1.6折",
      meal: "有餐食",
      shared: false
    });
  });

  it("parses shared flight and duration edge cases", () => {
    expect(parseDurationMinutes("2小时")).toBe(120);
    expect(parseDurationMinutes("45分")).toBe(45);

    const candidate = parseQingmaoFlightCandidateText(
      "东航MU3865 空客 A321-213(中)共享 06:40 广州白云 T3 2小时15分 08:55 上海虹桥 T2 有餐食 ￥960起 经济舱4.1折 选择"
    );

    expect(candidate).toMatchObject({
      airline: "东航",
      flightNo: "MU3865",
      aircraft: "空客A321-213(中)共享",
      shared: true,
      price: 960,
      durationMinutes: 135
    });
  });

  it("parses qingmao international result text from the mobile flight list", () => {
    const candidates = parseQingmaoInternationalFlightCandidatesText(`今天
05-19
周五
05-22
筛选
仅看直飞
09:40
广州白云
T2
3h
11:40
素万那普
T1
南方航空 CZ8079
￥1528
12:30
广州白云
T2
3h5m
14:35
素万那普
T1
南方航空 CZ3081
￥1538`);

    expect(candidates[0]).toMatchObject({
      airline: "南方航空",
      flightNo: "CZ8079",
      departureTime: "09:40",
      arrivalTime: "11:40",
      originAirport: "广州白云T2",
      destinationAirport: "素万那普T1",
      durationMinutes: 180,
      price: 1528,
      cabin: "经济舱"
    });
    expect(candidates[1]).toMatchObject({
      flightNo: "CZ3081",
      durationMinutes: 185,
      price: 1538
    });
  });

  it("extracts same-flight prices from business platform result text", () => {
    const ctrip = extractSameFlightQuoteFromText(
      "广州 上海 2026年5月21日 新海航 HU7431 空客320NEO 06:35 白云T3 09:00 浦东T2 ¥400 经济舱 订票",
      "HU7431"
    );
    const ali = extractSameFlightQuoteFromText(
      "广州 上海 2026年5月21日 周四 新海航|海南航空 HU7431 空客320NEO(中) 早餐 06:35 白云T3 09:00 浦东T2 ￥400起 经济舱2.1折 订票",
      "HU7431"
    );
    const missing = extractSameFlightQuoteFromText("广州 上海 仅展示 HO1854 ￥490起", "HU7431");

    expect(ctrip).toMatchObject({ status: "available", price: 400 });
    expect(ali).toMatchObject({ status: "available", price: 400 });
    expect(missing).toMatchObject({ status: "not-found", price: null, rawText: "" });
  });

  it("parses ztrip domestic flight result text", () => {
    const text = `【单程】广州 - 上海2026-05-23（共53个航班）
海南航空HU7431
空客320NEO(窄体) |
06:35
白云T3
08:55
浦东T2
协议航司
CNY
470
起
经济舱T 2.4折
吉祥航空HO1854
空客32A(中) |
06:40
白云T3
08:55
虹桥T2
CNY
490
起
经济舱Z 2.3折`;

    const candidates = parseZtripFlightCandidatesText(text);

    expect(readZtripTotalFlightCount(text)).toBe(53);
    expect(candidates[0]).toMatchObject({
      airline: "海南航空",
      flightNo: "HU7431",
      aircraft: "空客320NEO(窄体) |",
      departureTime: "06:35",
      arrivalTime: "08:55",
      originAirport: "白云T3",
      destinationAirport: "浦东T2",
      price: 470,
      cabin: "经济舱",
      discount: "经济舱T 2.4折"
    });
    expect(candidates[1]).toMatchObject({
      airline: "吉祥航空",
      flightNo: "HO1854",
      price: 490
    });
  });

  it("parses ztrip hotel big-bed with-breakfast rate text", () => {
    const rates = parseZtripHotelRatesText(`广州科尔海悦酒店
5月21日
明天
1晚
5月22日
周五
双份早餐
大床
符合差标
含早餐免费取消立即确认双床
酒店最低价
特惠房
CNY 368
精英大床房
2份早餐 | 不可取消
28m² | 1张1.8米大床 | 可住2人 | 部分有窗
酒店直销确认比较久
CNY 388
订
在线付
查看其他更多价格
高级大床房
32m² | 1张1.8米大床
CNY398
起`);

    const bigBedRate = rates.find((rate) => rate.bedType === "大床");

    expect(bigBedRate).toMatchObject({
      hotelName: "广州科尔海悦酒店",
      roomType: "精英大床房",
      breakfast: "有早餐",
      bedType: "大床",
      price: 388
    });
  });

  it("accepts ztrip random bed assignment rates when the room title names a bed type", () => {
    const rates = parseZtripHotelRatesText(`如家商旅酒店
亲子大床房
2份早餐 | 到店随机分配床型
CNY 240
商务大床房A
2份早餐 | 不可取消
20m² | 1张1.8米大床 | 可住2人
CNY 306`);

    expect(rates[0]).toMatchObject({
      roomType: "亲子大床房",
      breakfast: "有早餐",
      bedType: "大床",
      price: 240
    });
    expect(rates[1]).toMatchObject({
      roomType: "商务大床房A",
      breakfast: "有早餐",
      bedType: "大床",
      price: 306
    });
  });

  it("does not use ztrip filter labels as breakfast evidence", () => {
    const rates = parseZtripHotelRatesText(`如家商旅酒店
含早餐免费取消立即确认大床双份早餐
商务大床房
无早餐 | 05-23 18:00前可免费取消
12-15m² | 1张1.5×2.0米 | 可住2人
CNY 315
商务大床房
2份早餐 | 05-23 18:00前可免费取消
12-15m² | 1张1.5×2.0米 | 可住2人
CNY 336`);

    expect(rates[0]).toMatchObject({
      roomType: "商务大床房",
      breakfast: "无早餐",
      bedType: "大床",
      price: 315
    });
    expect(rates.find((rate) => rate.breakfast === "有早餐")).toMatchObject({
      roomType: "商务大床房",
      price: 336
    });
  });

  it("keeps ztrip matched products above the unmatched-products divider", () => {
    const rates = parseZtripHotelRatesTextForRatePlan(`如家商旅酒店
5月23日
1晚
含早餐
双床
亲子双床房
2份早餐
25m² | 到店随机分配床型
CNY 477
不满足筛选条件的产品
大床房A
大床 | 有窗
2份早餐
CNY 271
安心睡0压大床房
到店随机分配床型 | 无窗
2份早餐
CNY 280`, "双床有早餐");

    expect(rates).toHaveLength(1);
    expect(rates[0]).toMatchObject({
      roomType: "亲子双床房",
      breakfast: "有早餐",
      bedType: "双床",
      price: 477
    });
  });

  it("lets ztrip room cards inherit selected bed and breakfast filters above the unmatched divider", () => {
    const rates = parseZtripHotelRatesTextForRatePlan(`汉庭酒店
5月25日
1晚
1间1人
含早餐
大床
高级大床房
22m² | 1张1.8米大床 | 可住2人
CNY 420
不满足筛选条件的产品
高级大床房
无早餐
CNY 390`, "大床有早餐");

    expect(rates).toHaveLength(1);
    expect(rates[0]).toMatchObject({
      roomType: "高级大床房",
      breakfast: "有早餐",
      bedType: "大床",
      price: 420
    });
  });

  it("does not inherit selected ztrip breakfast when the room card explicitly contradicts it", () => {
    const rates = parseZtripHotelRatesTextForRatePlan(`汉庭酒店
5月25日
1晚
1间1人
含早餐
大床
高级大床房
无早餐 | 免费取消
22m² | 1张1.8米大床 | 可住2人
CNY 390`, "大床有早餐");

    expect(rates).toHaveLength(0);
  });

  it("accepts ztrip random-bed text when the main room type is explicit", () => {
    const rates = parseZtripHotelRatesTextForRatePlan(`柏曼酒店
5月25日
1晚
1间1人
标准大床房
到店随机分配床型 | 2份早餐
CNY 262`, "大床有早餐");

    expect(rates).toHaveLength(1);
    expect(rates[0]).toMatchObject({
      roomType: "标准大床房",
      breakfast: "有早餐",
      bedType: "大床",
      price: 262
    });
  });

  it("does not force ztrip big-bed rooms into twin-bed rate plans", () => {
    const rates = parseZtripHotelRatesTextForRatePlan(`如家商旅酒店
5月23日
1晚
含早餐
双床
安心睡0压大床房
2份早餐
20m² | 1张1.8米大床
CNY 255`, "双床有早餐");

    expect(rates).toEqual([]);
  });

  it("reads ztrip expanded room package rows as separate breakfast rate plans", () => {
    const rawText = `千淘商旅酒店
5月26日
今天
1晚
5月27日
明天
1间1人
大床
符合差标
含早餐
免费取消
标准大床房
16-18m² | 大床 | 无窗
CNY 223
标准大床房
无早餐 | 05-26 18:00前可免费取消
16-18m² | 大床 | 可住2人 | 无窗
千淘商旅
CNY 223
订
在线付
1份早餐 | 05-26 18:00前可免费取消
16-18m² | 大床 | 可住2人 | 无窗
千淘商旅
CNY 260
订
在线付`;

    expect(selectZtripHotelRateForRatePlan(parseZtripHotelRatesTextForRatePlan(rawText, "大床无早餐"), "大床无早餐")).toMatchObject({
      roomType: "标准大床房",
      bedType: "大床",
      breakfast: "无早餐",
      price: 223
    });
    expect(selectZtripHotelRateForRatePlan(parseZtripHotelRatesTextForRatePlan(rawText, "大床有早餐"), "大床有早餐")).toMatchObject({
      roomType: "标准大床房",
      bedType: "大床",
      breakfast: "有早餐",
      price: 260
    });
  });

  it("selects the lowest ztrip price within the same rate plan", () => {
    const rates = parseZtripHotelRatesTextForRatePlan(`如家商旅酒店
5月27日
1晚
1间1人
大床
符合差标
大床房A
到店随机分配床型 | 无窗 | 新风系统
CNY 505
大床房
1张1.5米双人床
CNY 511`, "大床无早餐");

    const selected = selectZtripHotelRateForRatePlan(rates, "大床无早餐");

    expect(selected).toMatchObject({
      roomType: "大床房A",
      breakfast: "无早餐",
      bedType: "大床",
      price: 505
    });
  });

  it("decides whether ztrip room cards need expansion by outer price and rate clarity", () => {
    expect(shouldExpandZtripRoomCardForLowestRate({
      currentLowestPrice: 260,
      outerPrice: 310,
      ratePlanClear: true
    })).toBe(false);
    expect(shouldExpandZtripRoomCardForLowestRate({
      currentLowestPrice: 260,
      outerPrice: null,
      ratePlanClear: true
    })).toBe(true);
    expect(shouldExpandZtripRoomCardForLowestRate({
      currentLowestPrice: 260,
      outerPrice: 240,
      ratePlanClear: true
    })).toBe(true);
    expect(shouldExpandZtripRoomCardForLowestRate({
      currentLowestPrice: 260,
      outerPrice: 310,
      ratePlanClear: false
    })).toBe(true);
  });

  it("treats compatible door-number ranges as the same hotel only with city and address context", () => {
    const candidate = {
      hotelName: "如家酒店(杭州富阳富春江店)",
      level: "",
      score: "",
      area: "杭州",
      address: "杭州市富阳区桂花路75-8号",
      price: 128,
      rawText: "如家酒店(杭州富阳富春江店) 杭州市富阳区桂花路75-8号"
    };

    const detail = confirmAliHotelDetailDoorPlate("杭州", candidate, `酒店详情
如家.neo-杭州富阳恩波广场桂花路店
杭州富阳区桂花路77号 | 富阳城区`);

    expect(detail.sameHotel).toBe(true);
    expect(detail.expectedDoorNumber).toBe("75-8号");
    expect(detail.detailDoorNumber).toBe("77号");
  });

  it("parses qingmao hotel candidate pool text", () => {
    const text = `行程： 广州
2026-05-21
(共9家酒店)
如家商旅酒店(广州白云山京溪南方医院地铁站店)
舒适型
4.7
很好
距市中心直线9.2公里·白云同和/龙洞地区·白云区
白云区广州大道北1420号
￥
228
起
查看详情
如家商旅酒店(广州永庆坊荔湾湖公园店)
舒适型
4.7
很好
距市中心直线2.8公里·永庆坊/上下九步行街·荔湾区
荔湾区黄沙大道144号
￥
338
起
查看详情`;

    const candidates = parseQingmaoHotelCandidatesText(text);

    expect(readQingmaoHotelTotalCount(text)).toBe(9);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      hotelName: "如家商旅酒店(广州白云山京溪南方医院地铁站店)",
      level: "舒适型",
      score: "4.7",
      price: 228
    });
  });

  it("detects qingmao hotel keyword not applied when keyword field is empty", () => {
    const query = { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-24", checkOutDate: "2026-05-25", nights: 1 };

    expect(() =>
      validateQingmaoHotelCandidateSearchState({
        cityText: "广州",
        checkInDate: "2026-05-24",
        checkOutDate: "2026-05-25",
        keywordText: "",
        keywordInputValue: "",
        bodyText: `行程： 广州 2026-05-24 (共23136家酒店)
广州十甫voco酒店
豪华型
4.6
荔湾区第十甫路188号
￥
743
起
查看详情`
      }, query)
    ).toThrow("青猫候选池关键词未生效：期望 如家商旅，实际为空");
  });

  it("detects qingmao hotel keyword not applied when keyword differs", () => {
    const query = { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-24", checkOutDate: "2026-05-25", nights: 1 };

    expect(() =>
      validateQingmaoHotelCandidateSearchState({
        cityText: "广州",
        checkInDate: "2026-05-24",
        checkOutDate: "2026-05-25",
        keywordText: "维也纳",
        keywordInputValue: "维也纳",
        bodyText: "行程： 广州 2026-05-24 (共20家酒店) 维也纳酒店 查看详情"
      }, query)
    ).toThrow("青猫候选池关键词未生效：期望 如家商旅，实际 维也纳");
  });

  it("accepts qingmao hotel search state when keyword and relevant candidates match", () => {
    const query = { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-24", checkOutDate: "2026-05-25", nights: 1 };
    const result = validateQingmaoHotelCandidateSearchState({
      cityText: "广州",
      checkInDate: "2026-05-24",
      checkOutDate: "2026-05-25",
      keywordText: "如家商旅",
      keywordInputValue: "如家商旅",
      bodyText: `行程： 广州
2026-05-24
(共9家酒店)
如家商旅酒店(广州永庆坊荔湾湖公园店)
舒适型
4.7
很好
距市中心直线2.8公里·永庆坊/上下九步行街·荔湾区
荔湾区黄沙大道144号
￥
338
起
查看详情`
    }, query);

    expect(result.relevantCandidates[0]).toMatchObject({
      hotelName: "如家商旅酒店(广州永庆坊荔湾湖公园店)"
    });
  });

  it("detects qingmao candidate pool empty when generic Guangzhou hotels are returned", () => {
    const query = { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-24", checkOutDate: "2026-05-25", nights: 1 };

    expect(() =>
      validateQingmaoHotelCandidateSearchState({
        cityText: "广州",
        checkInDate: "2026-05-24",
        checkOutDate: "2026-05-25",
        keywordText: "如家商旅",
        keywordInputValue: "如家商旅",
        bodyText: `行程： 广州
2026-05-24
(共23136家酒店)
广州十甫voco酒店
豪华型
4.6
很好
距市中心直线1.8公里·永庆坊/上下九步行街·荔湾区
荔湾区第十甫路188号
￥
743
起
查看详情`
      }, query)
    ).toThrow("青猫候选池为空");
  });

  it("parses qingmao hotel main big-bed with-breakfast rates", () => {
    const rates = parseQingmaoHotelMainRatesText(`如家商旅酒店(广州天河东圃科学城珠吉店)
舒适型
24
大床房
单早
免费取消
大床 1.8米 15㎡-18㎡
有窗 可住2人
￥
240
起
在线预订
24
大床房
大床 1.8米 15㎡-18㎡
有窗 可住2人
2份早餐
限时取消
早鸟价
￥
222
起
在线预订
2份早餐
免费取消
早鸟价
￥
237
起
在线预订`);

    expect(rates[0]).toMatchObject({
      platform: "青猫差旅",
      status: "available",
      hotelName: "如家商旅酒店(广州天河东圃科学城珠吉店)",
      roomType: "大床房",
      ratePlan: "大床有早餐",
      price: 240
    });
  });

  it("parses qingmao big-bed single-breakfast card with price suffix", () => {
    const rates = parseQingmaoHotelMainRatesText(`雅阁·维福顿轻居(广州北京路步行街西门口地铁站店)
房型价格
2026-05-24 - 2026-05-25
维雅特惠大床房
大床 2米 58㎡-62㎡ 有窗 可住2人
单早 免费取消
立即确认
¥407起
在线预订`);

    expect(rates[0]).toMatchObject({
      platform: "青猫差旅",
      status: "available",
      hotelName: "雅阁·维福顿轻居(广州北京路步行街西门口地铁站店)",
      roomType: "维雅特惠大床房",
      ratePlan: "大床有早餐",
      price: 407
    });
  });

  it("parses qingmao big-bed no-breakfast card", () => {
    const rates = parseQingmaoHotelMainRatesText(`雅阁·维福顿轻居(广州北京路步行街西门口地铁站店)
维雅特惠大床房
大床 2米 58㎡-62㎡ 有窗 可住2人
无早 限时取消
¥361起
在线预订`, "大床无早餐");

    expect(rates[0]).toMatchObject({
      roomType: "维雅特惠大床房",
      ratePlan: "大床无早餐",
      price: 361
    });
  });

  it("parses qingmao twin-bed breakfast card", () => {
    const rates = parseQingmaoHotelMainRatesText(`雅阁·维福顿轻居(广州北京路步行街西门口地铁站店)
高级双床房
双床 1.2米 30㎡ 有窗 可住2人
双早 免费取消
¥428起
在线预订`, "双床有早餐");

    expect(rates[0]).toMatchObject({
      roomType: "高级双床房",
      ratePlan: "双床有早餐",
      price: 428
    });
  });

  it("parses qingmao twin-bed no-breakfast card without strict line order", () => {
    const rates = parseQingmaoHotelMainRatesText(`雅阁·维福顿轻居(广州北京路步行街西门口地铁站店)
高级双床房
免费取消
￥399起
双床 1.2米 30㎡ 有窗 可住2人
不含早
在线预订`, "双床无早餐");

    expect(rates[0]).toMatchObject({
      roomType: "高级双床房",
      ratePlan: "双床无早餐",
      price: 399
    });
  });

  it("does not classify qingmao no-breakfast card as breakfast rate", () => {
    const rates = parseQingmaoHotelMainRatesText(`雅阁·维福顿轻居(广州北京路步行街西门口地铁站店)
维雅特惠大床房
大床 2米 58㎡-62㎡ 有窗 可住2人
无早
¥361起
在线预订`, "大床有早餐");

    expect(rates).toHaveLength(0);
  });

  it("locks the first eligible qingmao hotel candidate and does not skip ahead to find an easier sample", () => {
    const query = { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-23", checkOutDate: "2026-05-24", nights: 1 };
    const selected = selectLockedQingmaoHotelCandidate(
      [
        {
          hotelName: "如家商旅酒店(广州白云山京溪南方医院地铁站店)",
          level: "舒适型",
          score: "4.7",
          area: "白云区",
          address: "白云区广州大道北1420号",
          price: 228,
          rawText: "第一家候选"
        },
        {
          hotelName: "如家商旅酒店(广州永庆坊荔湾湖公园店)",
          level: "舒适型",
          score: "4.7",
          area: "荔湾区",
          address: "荔湾区黄沙大道144号",
          price: 338,
          rawText: "第二家候选"
        }
      ],
      query
    );

    expect(selected).toMatchObject({
      hotelName: "如家商旅酒店(广州白云山京溪南方医院地铁站店)",
      address: "白云区广州大道北1420号"
    });
  });

  it("rejects qingmao hotel candidates without a usable door plate", () => {
    const query = { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-23", checkOutDate: "2026-05-24", nights: 1 };

    expect(() =>
      selectLockedQingmaoHotelCandidate(
        [
          {
            hotelName: "如家商旅酒店(广州某店)",
            level: "舒适型",
            score: "4.7",
            area: "白云区",
            address: "白云区同和片区",
            price: 228,
            rawText: "缺少门牌号"
          }
        ],
        query
      )
    ).toThrow("缺少可提取门牌号");
  });

  it("does not let qingmao room parsing cross into the next room type", () => {
    const rates = parseQingmaoHotelMainRatesText(`城市便捷酒店(广州白云山店)
标准大床房I静谧空房
大床 1.8米 25㎡-30㎡
无窗 可住2人
1份早餐
限时取消
需等待确认(15分钟)
普票
￥
279
起
在线预订
剩6间
查看更多价格
7
标准双床房
双床 1.2米 25㎡
有窗 可住2人
无早
限时取消
需等待确认(15分钟)
普票
￥
315
起`, "大床无早餐");

    expect(rates).toHaveLength(0);
  });

  it("does not let qingmao twin-bed parsing cross into the next big-bed room type", () => {
    const rates = parseQingmaoHotelMainRatesText(`城市便捷酒店(广州白云山店)
双床房
10
标准大床房I静谧空房
大床 1.8米 25㎡-30㎡
无窗 可住2人
1份早餐
限时取消
需等待确认(15分钟)
普票
￥
279
起`, "双床有早餐");

    expect(rates).toHaveLength(0);
  });

  it("parses ctrip hotel main big-bed with-breakfast rates", () => {
    const rates = parseCtripHotelMainRatesText(`如家商旅酒店(广州白云山京溪南方医院地铁站店)
房间
含早餐
双份早餐
床型
大床
特色大床房
2份早餐
立即确认
2026年5月21日20:00前可免费取消
¥271
¥231
优惠¥40
商旅特惠
订
在线付
大床房A
2份早餐
立即确认
¥236
订`);

    expect(rates[0]).toMatchObject({
      platform: "携程商旅",
      status: "available",
      hotelName: "如家商旅酒店(广州白云山京溪南方医院地铁站店)",
      roomType: "特色大床房",
      ratePlan: "大床有早餐",
      price: 231
    });
  });

  it("does not treat ctrip discount amounts as room prices", () => {
    const rates = parseCtripHotelMainRatesText(`如家商旅酒店(广州永庆坊荔湾湖公园店)
高级大床房
25-30m²
1张1.8米大床
2份早餐
2026年5月24日18:00前可免费取消
¥522
¥427
特惠 | 优惠¥95
订
在线付`);

    expect(rates[0]).toMatchObject({
      platform: "携程商旅",
      roomType: "高级大床房",
      ratePlan: "大床有早餐",
      price: 427
    });
  });

  it("parses ctrip visible no-meal twin-bed rates as no-breakfast rates", () => {
    const rates = parseCtripHotelMainRatesText(`全季酒店(北京天安门广场前门地铁站店)
房间
套餐
双床房A（金可儿床垫+智能客控+小冰箱）
NH1351
无餐食
现磨咖啡-小季伴手礼
立即确认
¥619
订`, "双床无早餐");

    expect(rates[0]).toMatchObject({
      platform: "携程商旅",
      roomType: "双床房A（金可儿床垫+智能客控+小冰箱）",
      ratePlan: "双床无早餐",
      price: 619
    });
  });

  it("parses ctrip visible no-meal big-bed rates as no-breakfast rates", () => {
    const rates = parseCtripHotelMainRatesText(`海友酒店(北京南站店)
高级大床房
R3JHEY
无餐食
立即确认
¥303
订`, "大床无早餐");

    expect(rates[0]).toMatchObject({
      platform: "携程商旅",
      roomType: "高级大床房",
      ratePlan: "大床无早餐",
      price: 303
    });
  });

  it("parses ali hotel main big-bed with-breakfast rates", () => {
    const rates = parseAliHotelMainRatesText(`如家商旅(金标)-广州京溪南方医院地铁站店
预订
详情
评论
10
大床房A
15-18㎡
1张1.5米大床
无窗
禁烟
更多详情
无早餐
大床
2人入住
￥
226
个人支付
在线付
2份早餐
大床
2人入住
5月21日20点前可免费取消
立即确认
可开专票
￥
232
个人支付
在线付
4
商务大床房A
15-20㎡
1张1.8米大床
无窗
禁烟
2份早餐
大床
2人入住
￥
250
个人支付
在线付`);

    expect(rates[0]).toMatchObject({
      platform: "阿里商旅",
      status: "available",
      hotelName: "如家商旅(金标)-广州京溪南方医院地铁站店",
      roomType: "大床房A",
      ratePlan: "大床有早餐",
      price: 232
    });
  });

  it("keeps ali room-block offer rows separate and selects each rate-plan minimum", () => {
    const rawText = `锦江之星（广州荔湾西华路彩虹桥地铁站店）
标准双床房
1张1.35米小型双人床和1张1.1米单人床
21-25㎡
有窗
禁烟
更多详情
无早餐
双床
2人入住
5月28日12点前可免费取消
预计30分钟确认
￥
193
个人支付
在线付
1份早餐
多张床
3人入住
5月28日12点前可免费取消
立即确认
￥
200
个人支付
在线付
2份早餐
双床
2人入住
￥
240
个人支付
在线付`;

    const noBreakfast = selectLowestHotelMainRateQuote(parseAliHotelMainRatesText(rawText, "双床无早餐"));
    const withBreakfast = selectLowestHotelMainRateQuote(parseAliHotelMainRatesText(rawText, "双床有早餐"));

    expect(noBreakfast).toMatchObject({
      platform: "阿里商旅",
      roomType: "标准双床房",
      ratePlan: "双床无早餐",
      price: 193
    });
    expect(withBreakfast).toMatchObject({
      platform: "阿里商旅",
      roomType: "标准双床房",
      ratePlan: "双床有早餐",
      price: 200
    });
  });

  it("keeps random bed assignment text when the main room type confirms the bed type", () => {
    const qingmaoRates = parseQingmaoHotelMainRatesText(`如家商旅酒店
安心睡0压大床房
到店随机分配床型
大床 1.8米 有窗 可住2人
2份早餐
￥
280
起`, "大床有早餐");
    const ctripRates = parseCtripHotelMainRatesText(`如家商旅酒店
安心睡0压大床房
到店随机分配床型
1张1.8米大床
2份早餐
¥280
订`, "大床有早餐");
    const aliRates = parseAliHotelMainRatesText(`如家商旅酒店
安心睡0压大床房
到店随机分配床型
1张1.8米大床
2份早餐
￥
280
在线付`, "大床有早餐");

    expect(qingmaoRates[0]).toMatchObject({ platform: "青猫差旅", roomType: "安心睡0压大床房", price: 280 });
    expect(ctripRates[0]).toMatchObject({ platform: "携程商旅", roomType: "安心睡0压大床房", price: 280 });
    expect(aliRates[0]).toMatchObject({ platform: "阿里商旅", roomType: "安心睡0压大床房", price: 280 });
  });

  it("does not force a random-bed rate into a bed type when no bed signal exists", () => {
    const qingmaoRates = parseQingmaoHotelMainRatesText(`如家商旅酒店
特惠房
房型待定
2份早餐
￥280
起`, "大床有早餐");
    const ctripRates = parseCtripHotelMainRatesText(`如家商旅酒店
特惠房
到店随机分配床型
2份早餐
¥280
订`, "大床有早餐");
    const aliRates = parseAliHotelMainRatesText(`如家商旅酒店
特惠房
随机床型
2份早餐
￥
280
在线付`, "大床有早餐");

    expect(qingmaoRates).toEqual([]);
    expect(ctripRates).toEqual([]);
    expect(aliRates).toEqual([]);
  });

  it("selects the lowest available quote within the same hotel rate plan", () => {
    const qingmaoRates = parseQingmaoHotelMainRatesText(`如家商旅酒店
高级大床房
2份早餐
￥320
起
商务大床房
2份早餐
￥260
起`, "大床有早餐");
    const ctripRates = parseCtripHotelMainRatesText(`如家商旅酒店
高级大床房
2份早餐
¥380
订
商务大床房
2份早餐
¥260
订`, "大床有早餐");
    const aliRates = parseAliHotelMainRatesText(`如家商旅酒店
高级大床房
大床
2份早餐
￥
380
在线付
商务大床房
大床
2份早餐
￥
260
在线付`, "大床有早餐");

    expect(selectLowestHotelMainRateQuote(qingmaoRates)).toMatchObject({ platform: "青猫差旅", roomType: "商务大床房", price: 260 });
    expect(selectLowestHotelMainRateQuote(ctripRates)).toMatchObject({ platform: "携程商旅", roomType: "商务大床房", price: 260 });
    expect(selectLowestHotelMainRateQuote(aliRates)).toMatchObject({ platform: "阿里商旅", roomType: "商务大床房", price: 260 });
  });

  it("keeps qingmao no-breakfast and breakfast package prices separate inside one room card", () => {
    const rawText = `全季酒店(北京站店)
大床房
大床 1.51米 22㎡ 无窗 可住2人
无早
限时取消
￥ 494 起
在线预订
1份早餐
免费取消
￥ 534 起
在线预订`;

    expect(selectLowestHotelMainRateQuote(parseQingmaoHotelMainRatesText(rawText, "大床无早餐"))).toMatchObject({
      platform: "青猫差旅",
      roomType: "大床房",
      ratePlan: "大床无早餐",
      price: 494
    });
    expect(selectLowestHotelMainRateQuote(parseQingmaoHotelMainRatesText(rawText, "大床有早餐"))).toMatchObject({
      platform: "青猫差旅",
      roomType: "大床房",
      ratePlan: "大床有早餐",
      price: 534
    });
  });

  it("plans ztrip single-hotel all-rate read as clear filters then one filtered pass per rate plan", () => {
    expect(buildZtripSingleAllRatePlanReadSteps()).toEqual([
      { ratePlan: "大床无早餐", clearFilters: true, filterLabels: ["大床", "无早餐"], expandRoomCards: true, stopAtUnmatchedProducts: true },
      { ratePlan: "大床有早餐", clearFilters: true, filterLabels: ["大床", "含早餐"], expandRoomCards: true, stopAtUnmatchedProducts: true },
      { ratePlan: "双床无早餐", clearFilters: true, filterLabels: ["双床", "无早餐"], expandRoomCards: true, stopAtUnmatchedProducts: true },
      { ratePlan: "双床有早餐", clearFilters: true, filterLabels: ["双床", "含早餐"], expandRoomCards: true, stopAtUnmatchedProducts: true }
    ]);
  });

  it("reads calibration main and other rate prices from the same page text", () => {
    const rates = readHotelCalibrationRatesFromText("在途商旅", `如家商旅酒店
大床房A
无早餐
CNY 210
商务大床房
2份早餐
CNY 240
双床房
2份早餐
CNY 260`);

    expect(rates).toEqual({
      mainRatePrice: 240,
      otherRates: {
        大床无早餐: 210,
        双床有早餐: 260,
        双床无早餐: null
      },
      ratePrices: {
        大床无早餐: 210,
        大床有早餐: 240,
        双床无早餐: null,
        双床有早餐: 260
      }
    });
  });

  it("classifies hotel calibration failures with the frozen enum", () => {
    expect(classifyHotelCalibrationFailureType("青猫未找到大床有早餐价格", "青猫差旅")).toBe("qingmao_no_main_rate");
    expect(classifyHotelCalibrationFailureType("青猫解析疑似失败：页面可见大床有早餐价格", "青猫差旅")).toBe("parser_suspected_failed");
    expect(classifyHotelCalibrationFailureType("青猫候选池关键词未生效：期望 如家商旅，实际为空", "青猫差旅")).toBe("qingmao_candidate_keyword_not_applied");
    expect(classifyHotelCalibrationFailureType("青猫候选池为空：广州 / 如家商旅 / 2026-05-24 至 2026-05-25 未解析到候选酒店", "青猫差旅")).toBe("qingmao_candidate_pool_empty");
    expect(classifyHotelCalibrationFailureType("门牌号不一致", "阿里商旅")).toBe("competitor_no_same_hotel");
    expect(classifyHotelCalibrationFailureType("在途商旅未找到大床有早餐价格", "在途商旅")).toBe("competitor_no_main_rate");
    expect(classifyHotelCalibrationFailureType("页面加载 timeout", "携程商旅")).toBe("page_load_timeout");
  });

  it("builds bounded page text summaries for calibration evidence", () => {
    const summary = buildHotelPageTextSummary("酒店详情\n\n大床房   2份早餐   ￥240".repeat(20), 40);

    expect(summary.length).toBeLessThanOrEqual(43);
    expect(summary).toContain("酒店详情");
  });

  it("builds ztrip hotel search keywords from qingmao hotel names", () => {
    expect(normalizeHotelSearchKeywords("广州琶洲会展赤沙地铁站如家商旅酒店")).toEqual(
      expect.arrayContaining(["广州琶洲会展赤沙地铁站如家商旅酒店", "琶洲会展赤沙地铁站如家商旅", "赤沙地铁站如家商旅", "如家商旅"])
    );
    expect(normalizeHotelSearchKeywords("如家商旅酒店(广州天河东圃科学城珠吉店)")).toContain("如家商旅");
  });

  it("builds shared hotel search keywords with ali-style core location and address fallbacks", () => {
    const query = { city: "深圳", keyword: "维也纳", checkInDate: "2026-05-25", checkOutDate: "2026-05-26", nights: 1 };
    const candidate = {
      hotelName: "维也纳酒店(深圳福田福华路店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "福田区福华路73号",
      price: 341,
      rawText: ""
    };
    const keywords = buildHotelSearchKeywords(query, candidate);

    expect(keywords.slice(0, 3)).toEqual([
      "维也纳酒店(深圳福田福华路店)",
      "维也纳酒店福田福华路",
      "维也纳酒店福田福华"
    ]);
    expect(keywords).toEqual(expect.arrayContaining(["维也纳福华路", "维也纳福华路73号", "福华路", "福田区福华路73号"]));
    expect(keywords.indexOf("维也纳酒店")).toBeGreaterThan(keywords.indexOf("福华路"));
  });

  it("keeps ztrip hotel search waiting while the result list is still loading", () => {
    const candidate = {
      hotelName: "维也纳酒店(深圳福田福华路店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "福田区福华路73号",
      price: 341,
      rawText: ""
    };

    expect(classifyZtripHotelSearchReadiness("深圳", candidate, "加载中，请稍等... ¥146起 ¥154起")).toBe("loading");
    expect(classifyZtripHotelSearchReadiness("深圳", candidate, "维也纳酒店(深圳福田福华路店) 福华路73号 查看详情 CNY319")).toBe("target-candidate");
    expect(classifyZtripHotelSearchReadiness("深圳", candidate, "如家酒店深圳南山店 查看详情 CNY319")).toBe("finished-without-target");
  });

  it("downgrades missing ztrip rate filters to the current rate plan only", () => {
    expect(shouldDowngradeZtripRatePlanFilterFailure(new Error("在途商旅酒店未找到筛选项 双床"))).toBe(true);
    expect(shouldDowngradeZtripRatePlanFilterFailure(new Error("在途商旅酒店未找到筛选项 双份早餐"))).toBe(true);
    expect(shouldDowngradeZtripRatePlanFilterFailure(new Error("在途商旅酒店搜索结果加载超时：杭州西溪古墩路亚朵S酒店"))).toBe(false);
    expect(classifyHotelCalibrationFailureType("在途商旅酒店未找到筛选项 双床，按双床无早餐记为暂无", "在途商旅")).toBe("competitor_no_main_rate");
  });

  it("does not treat ztrip default recommended hotels as matched hotels", () => {
    const candidate = {
      hotelName: "如家商旅酒店(广州白云山京溪南方医院地铁站店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "白云区广州大道北1420号",
      price: 218,
      rawText: ""
    };

    expect(
      classifyZtripHotelSearchReadiness(
        "广州",
        candidate,
        "默认推荐酒店 如家商旅(金标)-广州东站燕塘店 天河区燕岭路13号 查看详情 CNY235"
      )
    ).toBe("finished-without-target");
  });

  it("rejects ztrip detail pages when the door plate differs", () => {
    const query = { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-24", checkOutDate: "2026-05-25", nights: 1 };
    const candidate = {
      hotelName: "如家商旅酒店(广州白云山京溪南方医院地铁站店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "白云区广州大道北1420号",
      price: 218,
      rawText: ""
    };

    expect(() =>
      assertCompetitorHotelDetailSameByDoorPlate(
        "在途商旅",
        query,
        candidate,
        "在途酒店详情 如家商旅(金标)-广州东站燕塘店 广州市天河区燕岭路13号 客房 大床 CNY299"
      )
    ).toThrow("门牌号不一致");
  });

  it("rejects ztrip detail pages when the door plate is missing", () => {
    const query = { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-24", checkOutDate: "2026-05-25", nights: 1 };
    const candidate = {
      hotelName: "如家商旅酒店(广州白云山京溪南方医院地铁站店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "白云区广州大道北1420号",
      price: 218,
      rawText: ""
    };

    expect(() =>
      assertCompetitorHotelDetailSameByDoorPlate(
        "在途商旅",
        query,
        candidate,
        "广州 如家商旅酒店(广州白云山京溪南方医院地铁站店) 白云同和/龙洞 客房 大床 CNY299"
      )
    ).toThrow("竞品页面缺少可提取门牌号");
  });

  it("puts ali hotel full-name and address keywords before loose fallback keywords", () => {
    const query = { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-23", checkOutDate: "2026-05-24", nights: 1 };
    const keywords = buildAliHotelSearchKeywords(query, {
      hotelName: "如家商旅酒店(广州永庆坊荔湾湖公园店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "荔湾区黄沙大道144号",
      price: 583,
      rawText: ""
    });

    expect(keywords.slice(0, 2)).toEqual([
      "如家商旅酒店(广州永庆坊荔湾湖公园店)",
      "如家商旅酒店永庆坊荔湾湖公园"
    ]);
    expect(keywords.indexOf("如家永庆坊荔湾湖公园")).toBeGreaterThan(keywords.indexOf("如家商旅酒店永庆坊荔湾湖公园"));
    expect(keywords.indexOf("黄沙大道144号")).toBeGreaterThan(keywords.indexOf("如家永庆坊荔湾湖公园"));
    expect(keywords.indexOf("如家黄沙大道144号")).toBeLessThan(keywords.indexOf("如家商旅"));
  });

  it("builds ali human-style core-location keywords before brand fallback", () => {
    const query = { city: "杭州", keyword: "柏曼", checkInDate: "2026-05-25", checkOutDate: "2026-05-26", nights: 1 };
    const keywords = buildAliHotelSearchKeywords(query, {
      hotelName: "柏曼酒店(杭州千岛湖景区银泰店)",
      level: "舒适型",
      score: "4.6",
      area: "",
      address: "千岛湖镇新安大街128号",
      price: 220,
      rawText: ""
    });

    expect(keywords.slice(0, 4)).toEqual([
      "柏曼酒店(杭州千岛湖景区银泰店)",
      "柏曼酒店千岛湖景区银泰",
      "柏曼酒店千岛湖银泰",
      "柏曼酒店千岛湖"
    ]);
    expect(keywords.indexOf("柏曼千岛湖景区银泰")).toBeGreaterThan(keywords.indexOf("柏曼酒店千岛湖"));
    expect(keywords.indexOf("柏曼千岛湖银泰")).toBeGreaterThan(keywords.indexOf("柏曼千岛湖景区银泰"));
    expect(keywords).toContain("千岛湖镇新安大街128号");
    expect(keywords).not.toContain("柏曼酒店");
    expect(keywords).not.toContain("柏曼");
  });

  it("does not confirm ali hotel list candidates without same-card door number", () => {
    const candidate = {
      hotelName: "如家商旅酒店(广州永庆坊荔湾湖公园店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "荔湾区黄沙大道144号",
      price: 583,
      rawText: ""
    };

    expect(
      matchAliHotelListCandidateText(
        candidate,
        "如家商旅(金标)-广州永庆坊黄沙大道店 4.6 很好 距黄沙大道步行140米 2分钟"
      )
    ).toMatchObject({
      matched: false,
      reason: "candidate-card-missing-door-number"
    });
    expect(
      matchAliHotelListCandidateText(
        candidate,
        "如家商旅(金标)-广州东站燕塘店 近广州东站·天河区燕岭路13号"
      ).matched
    ).toBe(false);
  });

  it("extracts comparable hotel door numbers from road address variants", () => {
    expect(extractHotelDoorNumber("广州市白云区广州大道路1420号")).toBe("1420号");
    expect(extractHotelDoorNumber("白云区广州大道北1420号")).toBe("1420号");
    expect(extractHotelDoorNumber("人民南路175-179号1F、2F-8F | 沙面岛/上下九步行街商圈")).toBe("175-179号");
    expect(extractHotelDoorNumber("6号大街6号，1层局部；3-9整层 | 下沙开发区 距地铁1号线文泽路站")).toBe("6号");
  });

  it("extracts road door plate before building numbers", () => {
    expect(extractHotelDoorPlate("海淀区永定路23号1幢3-5层及1层西侧大厅")).toBe("永定路23号");
    expect(extractHotelDoorNumber("海淀区永定路23号1幢3-5层及1层西侧大厅")).toBe("23号");
    expect(extractHotelDoorPlate("海淀区玉海园五里22号配套商业楼 (玉兴园) 1号楼1层101、2层、3层301")).toBe("玉海园五里22号");
    expect(extractHotelDoorNumber("海淀区玉海园五里22号配套商业楼 (玉兴园) 1号楼1层101、2层、3层301")).toBe("22号");
  });

  it("matches ali list card by brand core city and door number in the same card", () => {
    const candidate = {
      hotelName: "如家商旅酒店(广州白云山京溪南方医院地铁站店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "白云区广州大道北1420号",
      price: 218,
      rawText: ""
    };
    const cardText = `如家商旅(金标)-广州京溪南方医院地铁站店
舒适
4.7 很好 178条评价
广州市白云区广州大道路1420号 | 白云同和/龙洞查看地图
￥286起`;

    expect(parseAliHotelListCardText(cardText)).toMatchObject({
      hotelName: "如家商旅(金标)-广州京溪南方医院地铁站店",
      address: "广州市白云区广州大道路1420号 | 白云同和/龙洞查看地图",
      doorNumber: "1420号",
      price: 286
    });
    expect(matchHotelByBrandCoreCityDoorNumber(candidate, cardText, "广州")).toMatchObject({
      matched: true,
      reason: "阿里列表候选：品牌+核心店名+门牌数字",
      doorNumberMatched: true
    });
    expect(matchAliHotelListCandidateText(candidate, cardText, "广州")).toMatchObject({
      matched: true,
      reason: "阿里列表候选：品牌+核心店名+门牌数字",
      price: 286
    });
  });

  it("does not match ali list card without a door number", () => {
    const candidate = {
      hotelName: "如家商旅酒店(广州白云山京溪南方医院地铁站店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "白云区广州大道北1420号",
      price: 218,
      rawText: ""
    };

    expect(
      matchHotelByBrandCoreCityDoorNumber(
        candidate,
        "如家商旅(金标)-广州京溪南方医院地铁站店 广州市白云区广州大道 | 白云同和/龙洞 ￥286起",
        "广州"
      )
    ).toMatchObject({
      matched: false,
      reason: "candidate-card-missing-door-number"
    });
  });

  it("does not match ali list card with same brand but a different branch", () => {
    const candidate = {
      hotelName: "如家商旅酒店(广州白云山京溪南方医院地铁站店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "白云区广州大道北1420号",
      price: 218,
      rawText: ""
    };

    expect(
      matchHotelByBrandCoreCityDoorNumber(
        candidate,
        "如家商旅(金标)-广州天河龙洞植物园地铁站店 广州市天河区迎龙路1420号 ￥286起",
        "广州"
      )
    ).toMatchObject({
      matched: false,
      coreNameMatched: false
    });
  });

  it("does not borrow an ali door number or price from another list card", () => {
    const candidate = {
      hotelName: "如家商旅酒店(广州白云山京溪南方医院地铁站店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "白云区广州大道北1420号",
      price: 218,
      rawText: ""
    };
    const targetCardWithoutDoor = "如家商旅(金标)-广州京溪南方医院地铁站店 广州市白云区广州大道 ￥286起";
    const otherCardWithDoor = "如家商旅(金标)-广州天河龙洞植物园地铁站店 广州市白云区广州大道路1420号 ￥199起";

    expect(matchAliHotelListCandidateText(candidate, targetCardWithoutDoor, "广州")).toMatchObject({
      matched: false,
      price: 286
    });
    expect(matchAliHotelListCandidateText(candidate, otherCardWithDoor, "广州")).toMatchObject({
      matched: false,
      price: 199
    });
  });

  it("uses ali list cards without door numbers only as detail candidates", () => {
    const candidate = {
      hotelName: "如家商旅酒店(广州白云山京溪南方医院地铁站店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "白云区广州大道北1420号",
      price: 218,
      rawText: ""
    };
    const cardText = "如家商旅(金标)-广州京溪南方医院地铁站店舒适4.7很好178条评价近梅花园(地铁站)·摩登百货(圣地店)可开专票￥211起";

    expect(matchAliHotelListCandidateText(candidate, cardText, "广州")).toMatchObject({
      matched: false,
      reason: "candidate-card-missing-door-number"
    });
    expect(matchAliHotelListCandidateForDetail(candidate, cardText, "广州")).toMatchObject({
      matched: true,
      reason: "阿里列表候选：品牌+核心店名，待详情门牌确认",
      sameHotelConfirmed: false
    });
  });

  it("lets ali list cards without door numbers enter detail but rejects wrong detail door plates", () => {
    const candidate = {
      hotelName: "如家商旅酒店(广州白云山京溪南方医院地铁站店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "白云区广州大道北1420号",
      price: 218,
      rawText: ""
    };
    const selection = selectAliHotelListMatchFromCards(candidate, "广州", [
      { index: 0, text: "如家商旅(金标)-广州京溪南方医院地铁站店 近京溪南方医院 ￥304起", screenIndex: 0 }
    ]);
    const firstDetailCandidate = selection.detailCandidates[0]!;
    const outcome = resolveAliHotelDetailCandidateAttempts("广州", candidate, [{
      ...firstDetailCandidate,
      detailText: "酒店详情 如家商旅(金标)-广州京溪南方医院地铁站店 广州市天河区燕岭路13号"
    }]);

    expect(selection.matched).toBe(true);
    expect(firstDetailCandidate.listMatchReason).toBe("阿里列表候选：品牌+核心店名，待详情门牌确认");
    expect(outcome).toMatchObject({
      matched: false,
      attempts: [{ detailSameHotel: false, detailDoorNumber: "13号" }]
    });
    expect(outcome.failureReason).toContain("阿里详情门牌不匹配");
  });

  it("matches ali detail candidates only after the detail door plate is compatible", () => {
    const candidate = {
      hotelName: "如家酒店(杭州富阳富春江店)",
      level: "经济型",
      score: "4.6",
      area: "",
      address: "杭州市富阳区桂花路75-8号",
      price: 128,
      rawText: ""
    };
    const ranked = rankAliHotelDetailCandidateCards(candidate, "杭州", [
      { index: 0, text: "如家酒店杭州富阳富春江店 近富阳城区 ￥128起", screenIndex: 0 }
    ]);
    const outcome = resolveAliHotelDetailCandidateAttempts("杭州", candidate, [{
      ...ranked[0]!,
      detailText: "酒店详情 如家酒店杭州富阳富春江店 杭州市富阳区桂花路77号"
    }]);

    expect(outcome).toMatchObject({
      matched: true,
      matchedCandidate: {
        detailSameHotel: true,
        detailDoorNumber: "77号"
      }
    });
  });

  it("uses yongqingfang ali list cards without door numbers only as detail candidates", () => {
    const candidate = {
      hotelName: "如家商旅酒店(广州永庆坊荔湾湖公园店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "荔湾区黄沙大道144号",
      price: 583,
      rawText: ""
    };
    const cardText = "如家商旅(金标)-广州永庆坊黄沙大道店舒适4.6很好303条评价距黄沙大道步行140米 2分钟可开专票￥286起";

    expect(matchAliHotelListCandidateForDetail(candidate, cardText, "广州")).toMatchObject({
      matched: true,
      reason: "阿里列表候选：品牌+核心店名，待详情门牌确认",
      sameHotelConfirmed: false
    });
  });

  it("keeps ali cards when weak location words differ between qingmao and ali", () => {
    const candidate = {
      hotelName: "柏曼酒店(杭州千岛湖景区银泰店)",
      level: "舒适型",
      score: "4.6",
      area: "",
      address: "千岛湖镇新安大街128号",
      price: 220,
      rawText: ""
    };
    const cardText = "柏曼酒店杭州千岛湖银泰店高档4.6很好247条评价近千岛湖银泰城·千岛湖广场可开专票￥219起";

    expect(matchAliHotelListCandidateForDetail(candidate, cardText, "杭州")).toMatchObject({
      matched: true,
      reason: "阿里列表候选：品牌+核心店名，待详情门牌确认",
      brandMatched: true,
      coreNameMatched: true,
      cityMatched: true,
      doorNumber: null
    });
    expect(selectAliHotelListMatchFromCards(candidate, "杭州", [{ index: 0, text: cardText, screenIndex: 0 }])).toMatchObject({
      matched: true,
      detailCandidates: [
        expect.objectContaining({
          cardIndex: 0,
          listMatchReason: "阿里列表候选：品牌+核心店名，待详情门牌确认"
        })
      ]
    });
  });

  it("matches ali search suggestion cards by brand core location and city", () => {
    const candidate = {
      hotelName: "星程酒店(杭州滨江伟业路地铁站店)",
      level: "舒适型",
      score: "4.8",
      area: "",
      address: "滨江区伟业路298号",
      price: 260,
      rawText: ""
    };

    expect(matchAliHotelSearchSuggestionText(candidate, "星程酒店滨江 酒店", "杭州")).toMatchObject({
      matched: true,
      brandMatched: true,
      coreNameMatched: true,
      cityMatched: true
    });
    expect(matchAliHotelSearchSuggestionText(candidate, "星程酒店上海陆家嘴店 酒店", "杭州")).toMatchObject({
      matched: false
    });
  });

  it("confirms ali same hotel only after detail page door number matches", () => {
    const baiyunshan = {
      hotelName: "如家商旅酒店(广州白云山京溪南方医院地铁站店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "白云区广州大道北1420号",
      price: 218,
      rawText: ""
    };
    const yongqingfang = {
      hotelName: "如家商旅酒店(广州永庆坊荔湾湖公园店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "荔湾区黄沙大道144号",
      price: 583,
      rawText: ""
    };

    expect(confirmAliHotelDetailDoorPlate("广州", baiyunshan, "如家商旅(金标)-广州京溪南方医院地铁站店 广州市白云区广州大道北1420号")).toMatchObject({
      sameHotel: true,
      matchBasis: "阿里详情确认：列表品牌+核心店名，详情门牌数字",
      detailDoorNumber: "1420号"
    });
    expect(confirmAliHotelDetailDoorPlate("广州", yongqingfang, "如家商旅(金标)-广州永庆坊黄沙大道店 广州市荔湾区黄沙大道144号")).toMatchObject({
      sameHotel: true,
      matchBasis: "阿里详情确认：列表品牌+核心店名，详情门牌数字",
      detailDoorNumber: "144号"
    });
    expect(confirmAliHotelDetailDoorPlate("广州", baiyunshan, "如家商旅(金标)-广州京溪南方医院地铁站店 广州市天河区燕岭路13号")).toMatchObject({
      sameHotel: false,
      failureReason: "阿里详情门牌不匹配：期望 1420号，实际 13号"
    });
    expect(confirmAliHotelDetailDoorPlate("广州", baiyunshan, "酒店详情 广州市白云区广州大道路1420号 | 白云同和/龙洞查看地图 ICP备案：浙ICP备2021030200号-2")).toMatchObject({
      sameHotel: true,
      detailDoorNumber: "1420号"
    });
    expect(confirmAliHotelDetailDoorPlate("广州", yongqingfang, "酒店详情 广州市荔湾区黄沙大道144号 | 沙面岛/上下九步行街商圈查看地图 ICP备案：浙ICP备2021030200号-2")).toMatchObject({
      sameHotel: true,
      detailDoorNumber: "144号"
    });
  });

  it("confirms ali detail address ranges and ignores subway-line numbers", () => {
    const nihao = {
      hotelName: "你好广州上下九步行街酒店",
      level: "经济型",
      score: "4.8",
      area: "",
      address: "人民南路175号",
      price: 219,
      rawText: ""
    };
    const orange = {
      hotelName: "桔子杭州下沙酒店",
      level: "舒适型",
      score: "4.8",
      area: "",
      address: "6号大街6号",
      price: 321,
      rawText: ""
    };

    expect(confirmAliHotelDetailDoorPlate(
      "广州",
      nihao,
      "酒店详情 你好广州上下九步行街酒店 人民南路175-179号1F、2F-8F | 沙面岛/上下九步行街商圈 查看地图 广州市天河区中山大道中1025号君易大厦5-6层"
    )).toMatchObject({
      sameHotel: true,
      detailAddress: "人民南路175-179号",
      detailDoorNumber: "175-179号"
    });
    expect(confirmAliHotelDetailDoorPlate(
      "杭州",
      orange,
      "酒店详情 桔子杭州下沙酒店 6号大街6号，1层局部；3-9整层 | 下沙开发区/高教园区 距地铁1号线文泽路站 查看地图"
    )).toMatchObject({
      sameHotel: true,
      detailAddress: "6号大街6号",
      detailDoorNumber: "6号"
    });
  });

  it("accepts ali detail door numbers when the visible detail address omits the city name", () => {
    const vienna = {
      hotelName: "维也纳酒店(广州惠福西上下九店)",
      level: "舒适型",
      score: "4.5",
      area: "",
      address: "越秀区惠福西路38号",
      price: 214,
      rawText: ""
    };
    const cityComfort = {
      hotelName: "城市便捷酒店(广州白云山店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "白云区大金钟路63号",
      price: 300,
      rawText: ""
    };

    expect(confirmAliHotelDetailDoorPlate("广州", vienna, "酒店详情 维也纳酒店(广州惠福西上下九店) 越秀区惠福西路38号 查看地图")).toMatchObject({
      sameHotel: true,
      detailDoorNumber: "38号",
      failureReason: ""
    });
    expect(confirmAliHotelDetailDoorPlate("广州", cityComfort, "酒店详情 城市便捷酒店(广州白云山店) 白云区大金钟路63号 查看地图")).toMatchObject({
      sameHotel: true,
      detailDoorNumber: "63号",
      failureReason: ""
    });
  });

  it("waits for ali detail address instead of returning on title-only detail text", async () => {
    const candidate = {
      hotelName: "维也纳酒店(广州惠福西上下九店)",
      level: "舒适型",
      score: "4.5",
      area: "",
      address: "越秀区惠福西路38号",
      price: 214,
      rawText: ""
    };
    const textSnapshots = [
      "酒店详情 维也纳酒店(广州惠福西上下九店) 预订 大床房",
      "酒店详情 维也纳酒店(广州惠福西上下九店) 预订 大床房",
      "酒店详情 维也纳酒店(广州惠福西上下九店) 惠福西路38号 查看地图 预订"
    ];
    const innerText = vi.fn(async () => textSnapshots.shift() ?? textSnapshots[textSnapshots.length - 1] ?? "");
    const page = {
      waitForTimeout: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => undefined),
      locator: vi.fn(() => ({
        innerText
      }))
    };

    const detailText = await waitForAliHotelDetailIdentityText(
      page as never,
      { city: "广州", keyword: "维也纳", checkInDate: "2026-05-25", checkOutDate: "2026-05-26", nights: 1 },
      candidate,
      "酒店详情 维也纳酒店(广州惠福西上下九店) 预订"
    );

    expect(detailText).toContain("惠福西路38号");
    expect(innerText).toHaveBeenCalledTimes(3);
  });

  it("scrolls ali detail page to hotel intro when the first screen has no door number", async () => {
    const candidate = {
      hotelName: "如家商旅酒店(广州白云国际机场T2航站楼店)",
      level: "舒适型",
      score: "4.8",
      area: "",
      address: "花都区空港大道10号之六3栋二至十层",
      price: 216,
      rawText: ""
    };
    const textSnapshots = [
      "酒店详情 如家商旅-广州白云国际机场店 广东省广州市花都区花东镇如家商旅酒店 新白云国际机场商圈 预订 大床房",
      "酒店详情 如家商旅-广州白云国际机场店 广东省广州市花都区花东镇如家商旅酒店 新白云国际机场商圈 预订 大床房",
      "酒店介绍 如家商旅酒店（广州白云国际机场店）位于广州市花都区空港大道10号，是距离白云国际机场较近的酒店之一"
    ];
    const innerText = vi.fn(async () => textSnapshots.shift() ?? textSnapshots[textSnapshots.length - 1] ?? "");
    const page = {
      waitForTimeout: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => undefined),
      locator: vi.fn(() => ({
        innerText
      }))
    };

    const detailText = await waitForAliHotelDetailIdentityText(
      page as never,
      { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-25", checkOutDate: "2026-05-26", nights: 1 },
      candidate,
      "酒店详情 如家商旅-广州白云国际机场店 广东省广州市花都区花东镇如家商旅酒店 新白云国际机场商圈 预订"
    );

    expect(detailText).toContain("空港大道10号");
    expect(page.evaluate).toHaveBeenCalled();
  });

  it("does not treat long ali page identifiers as hotel door numbers", () => {
    const atour = {
      hotelName: "广州黄埔保盈大道地铁站亚朵酒店",
      level: "高档型",
      score: "4.9",
      area: "",
      address: "黄埔区保盈大道4号",
      price: 791,
      rawText: ""
    };

    expect(extractHotelDoorNumber("营业执照编号 33011002016404号")).toBeNull();
    expect(confirmAliHotelDetailDoorPlate("广州", atour, "酒店详情 广州黄埔保盈大道地铁站亚朵酒店 营业执照编号 33011002016404号")).toMatchObject({
      sameHotel: false,
      detailDoorNumber: null,
      failureReason: "阿里详情页未提取到地址"
    });
  });

  it("records ali detail address and door confirmation into keyword trace", () => {
    const candidate = {
      hotelName: "如家商旅酒店(广州白云山京溪南方医院地铁站店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "白云区广州大道北1420号",
      price: 218,
      rawText: ""
    };
    const selection = selectAliHotelListMatchFromCards(candidate, "广州", [
      { index: 0, text: "如家商旅(金标)-广州京溪南方医院地铁站店舒适4.7很好178条评价近梅花园(地铁站)·摩登百货(圣地店)可开专票￥211起", screenIndex: 0 }
    ]);
    const trace = {
      ...selection,
      keyword: "如家商旅酒店(广州白云山京溪南方医院地铁站店)",
      finalUrl: "https://travel.alibtrip.com/hotel-demeter#/list",
      selectedAsCandidate: true,
      clickedDetail: true,
      listScreenshotPath: "/tmp/alibtrip-keyword-01-list.png",
      detailScreenshotPath: "/tmp/alibtrip-keyword-01-detail.png",
      pathRecords: []
    };
    const detail = confirmAliHotelDetailDoorPlate("广州", candidate, "酒店详情 如家商旅(金标)-广州京溪南方医院地铁站店 广州市白云区广州大道北1420号");

    expect(applyAliHotelDetailDiagnosisToTrace(trace, "https://travel.alibtrip.com/hotel-demeter#/detail", detail)).toMatchObject({
      detailFinalUrl: "https://travel.alibtrip.com/hotel-demeter#/detail",
      detailAddress: expect.stringContaining("1420号"),
      detailDoorNumber: "1420号",
      detailSameHotel: true,
      detailMatchBasis: "阿里详情确认：列表品牌+核心店名，详情门牌数字",
      detailFailureReason: "",
      listScreenshotPath: "/tmp/alibtrip-keyword-01-list.png",
      detailScreenshotPath: "/tmp/alibtrip-keyword-01-detail.png"
    });
  });

  it("builds ali path records with timing, selected candidate, and evidence fields", () => {
    const record = buildAliHotelPathRecord({
      step: "click-candidate",
      status: "completed",
      startedAtMs: 1_000,
      endedAtMs: 1_750,
      keyword: "维也纳 惠福西路",
      keywordMode: "normal",
      finalUrl: "https://travel.alibtrip.com/hotel-demeter#/list",
      screenshotPath: "/tmp/alibtrip-keyword-01-selected-card-01.png",
      diagnosisPath: "/tmp/alibtrip-list-diagnosis.json",
      candidateRank: 1,
      candidateCardIndex: 3,
      candidateCardText: "维也纳酒店(广州惠福西上下九店) 惠福西路38号 ￥214起",
      selectedCandidate: true
    });

    expect(record).toMatchObject({
      step: "click-candidate",
      status: "completed",
      startedAt: "1970-01-01T00:00:01.000Z",
      endedAt: "1970-01-01T00:00:01.750Z",
      durationMs: 750,
      keyword: "维也纳 惠福西路",
      keywordMode: "normal",
      finalUrl: "https://travel.alibtrip.com/hotel-demeter#/list",
      screenshotPath: "/tmp/alibtrip-keyword-01-selected-card-01.png",
      diagnosisPath: "/tmp/alibtrip-list-diagnosis.json",
      candidateRank: 1,
      candidateCardIndex: 3,
      selectedCandidate: true
    });
  });

  it("appends ali failure path records with final url, screenshot, and diagnosis path", () => {
    const records = [] as ReturnType<typeof buildAliHotelPathRecord>[];
    appendAliHotelPathRecord(records, {
      step: "wait-detail-page",
      status: "failed",
      startedAtMs: 2_000,
      endedAtMs: 3_200,
      finalUrl: "https://travel.alibtrip.com/hotel-demeter#/list",
      screenshotPath: "/tmp/alibtrip-keyword-01-failure-01.png",
      diagnosisPath: "/tmp/alibtrip-list-diagnosis.json",
      failureReason: "阿里商旅点击第1候选后详情页加载超时",
      candidateRank: 1
    });

    expect(records).toEqual([
      expect.objectContaining({
        step: "wait-detail-page",
        status: "failed",
        durationMs: 1_200,
        finalUrl: "https://travel.alibtrip.com/hotel-demeter#/list",
        screenshotPath: "/tmp/alibtrip-keyword-01-failure-01.png",
        diagnosisPath: "/tmp/alibtrip-list-diagnosis.json",
        failureReason: "阿里商旅点击第1候选后详情页加载超时",
        candidateRank: 1
      })
    ]);
  });

  it("forces ali sameHotel false when detail door confirmation fails", () => {
    expect(resolveAliHotelSameHotelAfterFailure(true, "阿里详情门牌不匹配：期望 1420号，实际 2021030200号")).toBe(false);
    expect(resolveAliHotelSameHotelAfterFailure(true, "阿里详情页未提取到地址")).toBe(false);
    expect(resolveAliHotelSameHotelAfterFailure(true, "阿里商旅未找到大床有早餐价格")).toBe(true);
  });

  it("supports ali-only hotel calibration platform order and completeness", () => {
    expect(resolveHotelCalibrationPlatformOrder()).toEqual(["青猫差旅", "阿里商旅", "在途商旅", "携程商旅"]);
    expect(resolveHotelCalibrationPlatformOrder({ platforms: ["阿里商旅"] })).toEqual(["青猫差旅", "阿里商旅"]);
    expect(
      isHotelCalibrationSampleComplete(
        [
          {
            platform: "青猫差旅",
            sameHotel: true,
            matchBasis: "青猫候选源酒店",
            platformHotelName: "如家商旅酒店",
            platformAddress: "广州大道北1420号",
            platformDoorPlate: "广州大道北1420号",
            hasMainRate: true,
            mainRatePrice: 240,
            otherRates: { 大床无早餐: null, 双床有早餐: null, 双床无早餐: null },
            durationMs: 1,
            failureType: null,
            failureReason: "",
            finalUrl: "https://example.com/qingmao",
            pageTextSummary: ""
          },
          {
            platform: "阿里商旅",
            sameHotel: true,
            matchBasis: "阿里详情确认：列表品牌+核心店名，详情门牌数字",
            platformHotelName: "如家商旅酒店",
            platformAddress: "广州大道北1420号",
            platformDoorPlate: "广州大道北1420号",
            hasMainRate: true,
            mainRatePrice: 250,
            otherRates: { 大床无早餐: null, 双床有早餐: null, 双床无早餐: null },
            durationMs: 1,
            failureType: null,
            failureReason: "",
            finalUrl: "https://example.com/ali",
            pageTextSummary: ""
          }
        ],
        ["青猫差旅", "阿里商旅"]
      )
    ).toBe(true);
  });

  it("filters hotel small-batch candidates before platform collection", () => {
    const query = { city: "广州", keyword: "亚朵", checkInDate: "2026-05-25", checkOutDate: "2026-05-26", nights: 1 };
    const baseCandidate = {
      hotelName: "广州塔琶洲会展亚朵S酒店",
      level: "高档",
      score: "4.8",
      area: "海珠区",
      address: "广州市海珠区新港东路277号",
      price: 671,
      rawText: "广州塔琶洲会展亚朵S酒店 ￥671起"
    };
    expect(shouldSkipHotelSmallBatchCandidate(baseCandidate, query, new Set(), new Set())).toBeNull();
    const previousAnchors = [
      { hotelName: "如家商旅酒店(广州永庆坊荔湾湖公园店)", keyword: "如家商旅" },
      { hotelName: "全季酒店(广州上下九步行街陈家祠店)", keyword: "全季" },
      { hotelName: "维也纳酒店(广州火车站小北地铁站店)", keyword: "维也纳" },
      { hotelName: "城市便捷酒店(珠江夜游广州塔中大码头中山大学店)", keyword: "城市便捷" },
      { hotelName: "广州塔琶洲会展亚朵S酒店", keyword: "亚朵" }
    ];
    for (const anchor of previousAnchors) {
      expect(shouldSkipHotelSmallBatchCandidate(
        { ...baseCandidate, hotelName: anchor.hotelName, rawText: anchor.hotelName },
        { ...query, keyword: anchor.keyword }
      )).toBe("上一轮5集团锚点酒店");
    }
    expect(shouldSkipHotelSmallBatchCandidate({ ...baseCandidate, hotelName: "广州珠江太古仓亚朵S酒店" }, query, new Set(), new Set())).toBeNull();
    expect(shouldSkipHotelSmallBatchCandidate({ ...baseCandidate, address: "广州市海珠区新港东路" }, query, new Set(), new Set())).toBe("未提取到门牌号");
    expect(shouldSkipHotelSmallBatchCandidate({ ...baseCandidate, price: null }, query, new Set(), new Set())).toBe("候选起价为空");
    expect(shouldSkipHotelSmallBatchCandidate({ ...baseCandidate, hotelName: "广州琶洲会展漫途酒店" }, query, new Set(), new Set())).toBe("不属于亚朵候选");
    expect(shouldSkipHotelSmallBatchCandidate(baseCandidate, query, new Set(["广州塔琶洲会展亚朵S酒店"]), new Set())).toBe("本轮小放量重复酒店");
  });

  it("expands Dongcheng small-batch searches beyond City Comfort only", () => {
    expect(getHotelSmallBatchGroupSearchKeywords("东呈")).toEqual(["城市便捷", "宜尚", "柏曼", "怡程"]);
    expect(getHotelSmallBatchGroupSearchKeywords("华住")).toEqual(["全季", "汉庭", "桔子", "美居", "海友", "你好", "星程"]);
    expect(getHotelSmallBatchGroupSearchKeywords("锦江")).toEqual(["维也纳"]);
  });

  it("keeps expanded Dongcheng brand candidates eligible for small-batch filtering", () => {
    const common = {
      level: "舒适型",
      score: "4.7",
      area: "广州",
      address: "广州市天河区体育西路88号",
      price: 300,
      rawText: ""
    };
    for (const [keyword, hotelName] of [
      ["宜尚", "宜尚酒店(广州体育西路地铁站店)"],
      ["柏曼", "柏曼酒店(广州北京路步行街店)"],
      ["怡程", "怡程酒店(广州珠江新城店)"]
    ] as const) {
      expect(shouldSkipHotelSmallBatchCandidate(
        { ...common, hotelName },
        { city: "广州", keyword, checkInDate: "2026-05-25", checkOutDate: "2026-05-26", nights: 1 },
        new Set(),
        new Set()
      )).toBeNull();
    }
  });

  it("merges Qingmao hotel candidates from multiple scrolled screens and removes duplicates", () => {
    const firstScreen = `
全季酒店(广州天河火车东站店)
舒适型
4.9
距市中心10公里
广州市天河区林和西路1号
￥
428
查看详情
全季酒店(广州金融城临江大道店)
舒适型
4.8
距市中心12公里
广州市天河区临江大道787号
￥
446
查看详情
`;
    const secondScreen = `
全季酒店(广州金融城临江大道店)
舒适型
4.8
距市中心12公里
广州市天河区临江大道787号
￥
446
查看详情
汉庭酒店(广州北京路步行街店)
舒适型
4.7
距市中心3公里
广州市越秀区北京路88号
￥
301
查看详情
`;

    expect(mergeQingmaoHotelCandidatesFromTexts([firstScreen, secondScreen]).map((candidate) => candidate.hotelName)).toEqual([
      "全季酒店(广州天河火车东站店)",
      "全季酒店(广州金融城临江大道店)",
      "汉庭酒店(广州北京路步行街店)"
    ]);
  });

  it("summarizes hotel small-batch completion and failures", () => {
    const query = { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-25", checkOutDate: "2026-05-26", nights: 1 };
    const groups = [
      {
        group: "首旅如家" as const,
        query,
        targetCount: 2,
        maxAttempts: 6,
        budgetMs: 18 * 60 * 1000,
        attemptedCount: 2,
        completedCount: 1,
        partialCount: 0,
        failedCount: 1,
        skippedCount: 0,
        unattemptedCount: 0,
        timeoutBudget: false,
        samples: [
          { group: "首旅如家" as const, groupIndex: 1, sampleIndex: 1, query, status: "completed" as const, selectedCandidate: null, quotes: [], message: "ok" },
          { group: "首旅如家" as const, groupIndex: 1, sampleIndex: 2, query, status: "failed" as const, selectedCandidate: null, quotes: [], message: "failed", failureReason: "阿里失败" }
        ]
      },
      {
        group: "华住" as const,
        query: { ...query, keyword: "全季" },
        targetCount: 2,
        maxAttempts: 6,
        budgetMs: 18 * 60 * 1000,
        attemptedCount: 2,
        completedCount: 2,
        partialCount: 0,
        failedCount: 0,
        skippedCount: 0,
        unattemptedCount: 0,
        timeoutBudget: false,
        samples: [
          { group: "华住" as const, groupIndex: 2, sampleIndex: 1, query: { ...query, keyword: "全季" }, status: "completed" as const, selectedCandidate: null, quotes: [], message: "ok" },
          { group: "华住" as const, groupIndex: 2, sampleIndex: 2, query: { ...query, keyword: "全季" }, status: "completed" as const, selectedCandidate: null, quotes: [], message: "ok" }
        ]
      }
    ];
    expect(groups.every((group) => group.samples.length === 2)).toBe(true);
    expect(summarizeHotelSmallBatchGroups(groups)).toEqual({
      completedCount: 3,
      partialCount: 0,
      failedCount: 1,
      skippedCount: 0,
      unattemptedCount: 0,
      targetTotal: 4,
      timeoutBudget: false,
      status: "partial"
    });
  });

  it("does not stop hotel small-batch groups on per-group budgets during test runs", () => {
    expect(resolveHotelSmallBatchBudgetStop({
      maxAttempts: null,
      budgetMs: null,
      startedAtMs: 1000,
      nowMs: 1000
    })).toBeNull();
    expect(resolveHotelSmallBatchBudgetStop({
      maxAttempts: null,
      budgetMs: null,
      startedAtMs: 1000,
      nowMs: 1000 + 18 * 60 * 1000
    })).toBeNull();
  });

  it("can still stop hotel small-batch groups when a per-group budget is explicitly configured", () => {
    expect(resolveHotelSmallBatchBudgetStop({
      maxAttempts: 0,
      budgetMs: 18 * 60 * 1000,
      startedAtMs: 1000,
      nowMs: 1000
    })).toBe("达到本集团候选尝试上限");
    expect(resolveHotelSmallBatchBudgetStop({
      maxAttempts: 1,
      budgetMs: 18 * 60 * 1000,
      startedAtMs: 1000,
      nowMs: 1000 + 18 * 60 * 1000
    })).toBe("达到本集团时间预算");
    expect(resolveHotelSmallBatchBudgetStop({
      maxAttempts: 1,
      budgetMs: 18 * 60 * 1000,
      startedAtMs: 1000,
      nowMs: 2000
    })).toBeNull();
  });

  it("returns partial summary with skipped targets when the overall hotel small-batch budget is exhausted", () => {
    const query = { city: "广州", keyword: "亚朵", checkInDate: "2026-05-25", checkOutDate: "2026-05-26", nights: 1 };
    const groups = [
      {
        group: "亚朵" as const,
        query,
        targetCount: 2,
        maxAttempts: 6,
        budgetMs: 18 * 60 * 1000,
        attemptedCount: 0,
        completedCount: 0,
        partialCount: 0,
        failedCount: 0,
        skippedCount: 2,
        unattemptedCount: 2,
        timeoutBudget: true,
        budgetStopReason: "达到小放量整体时间预算",
        samples: [
          { group: "亚朵" as const, groupIndex: 5, sampleIndex: 1, query, status: "skipped" as const, selectedCandidate: null, quotes: [], message: "budget", timeoutBudget: true },
          { group: "亚朵" as const, groupIndex: 5, sampleIndex: 2, query, status: "skipped" as const, selectedCandidate: null, quotes: [], message: "budget", timeoutBudget: true }
        ]
      }
    ];
    expect(resolveHotelSmallBatchOverallBudgetStop(1000, 1000 + 90 * 60 * 1000)).toBe("达到小放量整体时间预算");
    expect(summarizeHotelSmallBatchGroups(groups)).toMatchObject({
      completedCount: 0,
      failedCount: 0,
      skippedCount: 2,
      unattemptedCount: 2,
      timeoutBudget: true,
      status: "partial"
    });
  });

  it("does not continue remaining competitors after hotel small-batch fail-fast sees a same-hotel hit failure", async () => {
    const ctrip = vi.fn(async () => ({
      platform: "携程商旅" as const,
      status: "available" as const,
      price: 280,
      hotelName: "测试酒店",
      roomType: "大床房",
      ratePlan: "大床有早餐" as const
    }));
    const ali = vi.fn(async () => ({
      platform: "阿里商旅" as const,
      status: "failed" as const,
      price: null,
      hotelName: "测试酒店",
      roomType: "",
      ratePlan: "大床有早餐" as const,
      error: "阿里未匹配同店",
      finalUrl: "https://travel.alibtrip.com/detail",
      screenshotPath: "/tmp/ali-detail.png",
      diagnosisPath: "/tmp/ali-diagnosis.json"
    }));
    const ztrip = vi.fn(async () => ({
      platform: "在途商旅" as const,
      status: "available" as const,
      price: 260,
      hotelName: "测试酒店",
      roomType: "大床房",
      ratePlan: "大床有早餐" as const
    }));

    const result = await collectHotelMainRateCompetitorQuotes([
      {
        platform: "携程商旅",
        beforeMessage: "开始查携程",
        collect: ctrip,
        pendingQuote: (reason) => ({ platform: "携程商旅", status: "pending", price: null, hotelName: "测试酒店", roomType: "", ratePlan: "大床有早餐", error: reason })
      },
      {
        platform: "阿里商旅",
        beforeMessage: "开始查阿里",
        collect: ali,
        pendingQuote: (reason) => ({ platform: "阿里商旅", status: "pending", price: null, hotelName: "测试酒店", roomType: "", ratePlan: "大床有早餐", error: reason })
      },
      {
        platform: "在途商旅",
        beforeMessage: "开始查在途",
        collect: ztrip,
        pendingQuote: (reason) => ({ platform: "在途商旅", status: "pending", price: null, hotelName: "测试酒店", roomType: "", ratePlan: "大床有早餐", error: reason })
      }
    ], { stopOnFirstCompetitorFailure: true });

    expect(ctrip).toHaveBeenCalledTimes(1);
    expect(ali).toHaveBeenCalledTimes(1);
    expect(ztrip).not.toHaveBeenCalled();
    expect(result.stoppedByFailure?.platform).toBe("阿里商旅");
    expect(result.quotes.map((quote) => quote.platform)).toEqual(["携程商旅", "阿里商旅", "在途商旅"]);
    expect(result.quotes[2]).toMatchObject({
      platform: "在途商旅",
      status: "pending"
    });
  });

  it("continues remaining competitors when a platform only misses the requested rate plan", async () => {
    const ali = vi.fn(async () => ({
      platform: "阿里商旅" as const,
      status: "failed" as const,
      price: null,
      hotelName: "测试酒店",
      roomType: "",
      ratePlan: "大床有早餐" as const,
      error: "阿里商旅未找到大床有早餐价格"
    }));
    const ztrip = vi.fn(async () => ({
      platform: "在途商旅" as const,
      status: "available" as const,
      price: 260,
      hotelName: "测试酒店",
      roomType: "大床房",
      ratePlan: "大床有早餐" as const
    }));

    const result = await collectHotelMainRateCompetitorQuotes([
      {
        platform: "阿里商旅",
        beforeMessage: "开始查阿里",
        collect: ali,
        pendingQuote: (reason) => ({ platform: "阿里商旅", status: "pending", price: null, hotelName: "测试酒店", roomType: "", ratePlan: "大床有早餐", error: reason })
      },
      {
        platform: "在途商旅",
        beforeMessage: "开始查在途",
        collect: ztrip,
        pendingQuote: (reason) => ({ platform: "在途商旅", status: "pending", price: null, hotelName: "测试酒店", roomType: "", ratePlan: "大床有早餐", error: reason })
      }
    ], { stopOnFirstCompetitorFailure: true });

    expect(ali).toHaveBeenCalledTimes(1);
    expect(ztrip).toHaveBeenCalledTimes(1);
    expect(result.stoppedByFailure).toBeNull();
    expect(result.quotes.map((quote) => quote.platform)).toEqual(["阿里商旅", "在途商旅"]);
  });

  it("stops remaining hotel rate plans only when a platform cannot confirm the same hotel", () => {
    expect(shouldStopHotelAllRatePlanCollectionAfterQuoteFailure({
      platform: "阿里商旅",
      status: "failed",
      price: null,
      hotelName: "海友酒店(北京南站店)",
      roomType: "",
      ratePlan: "大床无早餐",
      finalUrl: "https://travel.alibtrip.com/detail",
      screenshotPath: "/tmp/ali.png",
      error: "阿里详情门牌不匹配：期望 112号，实际 2号"
    })).toBe(true);

    expect(shouldStopHotelAllRatePlanCollectionAfterQuoteFailure({
      platform: "携程商旅",
      status: "not-found",
      price: null,
      hotelName: "海友酒店(北京南站店)",
      roomType: "",
      ratePlan: "大床无早餐",
      finalUrl: "https://ct.ctrip.com/detail",
      screenshotPath: "/tmp/ctrip.png",
      error: "携程商旅同酒店详情页未解析到大床无早餐价格"
    })).toBe(false);

    expect(shouldStopHotelAllRatePlanCollectionAfterQuoteFailure({
      platform: "青猫差旅",
      status: "failed",
      price: null,
      hotelName: "全季酒店",
      roomType: "",
      ratePlan: "大床无早餐",
      screenshotPath: "/tmp/qingmao.png",
      error: "青猫无大床无早餐"
    })).toBe(false);
  });

  it("builds hotel scale validation dates from explicit dates or next-day default", () => {
    const defaultInput = buildHotelScaleValidationInput(new Date(2026, 4, 24, 10), {});
    expect(defaultInput).toEqual({
      checkInDate: "2026-05-25",
      checkOutDate: "2026-05-26",
      nights: 1
    });

    expect(buildHotelScaleValidationInput(new Date(2026, 4, 24, 10), {
      checkInDate: "2026-06-02",
      checkOutDate: "2026-06-04"
    })).toEqual({
      checkInDate: "2026-06-02",
      checkOutDate: "2026-06-04",
      nights: 2
    });
  });

  it("initializes 40-hotel scale validation across 5 groups and the 9-city pool", () => {
    const result = buildInitialHotelScaleValidationResult(new Date(2026, 4, 24, 10), {
      checkInDate: "2026-06-02",
      checkOutDate: "2026-06-03"
    });

    expect(result).toMatchObject({
      status: "idle",
      mode: "scale-validation",
      targetTotal: 40,
      targetPerGroup: 8,
      mainRatePlan: "大床有早餐",
      checkInDate: "2026-06-02",
      checkOutDate: "2026-06-03",
      nights: 1,
      budget: {
        totalMs: 120 * 60 * 1000,
        perGroupMs: 25 * 60 * 1000,
        maxAttemptsPerGroup: 24
      },
      platformOrder: ["青猫差旅", "阿里商旅", "携程商旅", "在途商旅"],
      cityPool: ["北京", "广州", "杭州", "上海", "深圳", "武汉", "佛山", "成都", "厦门"]
    });
    expect(result.groups).toHaveLength(5);
    expect(result.groups.every((group) => group.targetCount === 8)).toBe(true);
    expect(getHotelScaleValidationGroupSearchKeywords("东呈")).toContain("宜尚");
  });

  it("initializes a 5-hotel scale validation smoke run as one hotel per group", () => {
    const result = buildInitialHotelScaleValidationResult(new Date(2026, 4, 24, 10), {
      limit: 5
    });

    expect(result).toMatchObject({
      targetTotal: 5,
      targetPerGroup: 1,
      unattemptedCount: 5
    });
    expect(result.groups).toHaveLength(5);
    expect(result.groups.map((group) => group.targetCount)).toEqual([1, 1, 1, 1, 1]);
    expect(result.groups.every((group) => group.unattemptedCount === 1)).toBe(true);
  });

  it("initializes a 3-hotel scale validation smoke run across the first three groups", () => {
    const result = buildInitialHotelScaleValidationResult(new Date(2026, 4, 24, 10), {
      limit: 3
    });

    expect(result).toMatchObject({
      targetTotal: 3,
      targetPerGroup: 1,
      unattemptedCount: 3
    });
    expect(result.groups.map((group) => group.targetCount)).toEqual([1, 1, 1, 0, 0]);
    expect(result.groups.map((group) => group.unattemptedCount)).toEqual([1, 1, 1, 0, 0]);
  });

  it("extracts and saves a hotel cover image from a detail page", async () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "hotel-cover-"));
    const page = {
      evaluate: vi.fn(async (_script: string, arg?: string) => {
        if (arg) {
          return "data:image/jpeg;base64,aG90ZWwtY292ZXI=";
        }
        return "https://img.example.com/hotel-cover.jpg";
      })
    } as unknown as Parameters<typeof collectHotelCoverImageFromPage>[0];

    const result = await collectHotelCoverImageFromPage(page, runDir, "青猫差旅");

    expect(result).toMatchObject({
      coverImageUrl: "https://img.example.com/hotel-cover.jpg",
      coverImagePath: path.join(runDir, "hotel-cover.jpg"),
      coverImageSource: "青猫差旅",
      coverImageStatus: "saved"
    });
    expect(fs.existsSync(path.join(runDir, "hotel-cover.jpg"))).toBe(true);
  });

  it("marks hotel cover image as missing when a detail page has no usable image", async () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "hotel-cover-"));
    const page = {
      evaluate: vi.fn(async () => null)
    } as unknown as Parameters<typeof collectHotelCoverImageFromPage>[0];

    const result = await collectHotelCoverImageFromPage(page, runDir, "青猫差旅");

    expect(result).toMatchObject({
      coverImageSource: "青猫差旅",
      coverImageStatus: "missing",
      coverImageFailureReason: "详情页未找到可用酒店封面图"
    });
    expect(fs.existsSync(path.join(runDir, "hotel-cover.jpg"))).toBe(false);
  });

  it("builds a human-readable hotel diagnostic review page with inline screenshots", () => {
    const result = buildInitialHotelScaleValidationResult(new Date(2026, 4, 24, 10), { limit: 5 });
    result.groups[0].samples.push({
      group: "华住",
      groupIndex: 1,
      sampleIndex: 1,
      status: "partial",
      selectedCandidate: {
        hotelName: "全季酒店(北京天安门广场前门地铁站店)",
        level: "舒适型",
        score: "4.8",
        area: "北京",
        address: "西城区大栅栏西街15号",
        price: 690,
        rawText: "全季酒店"
      },
      quotes: [
        {
          platform: "携程商旅",
          status: "not-found",
          price: null,
          hotelName: "全季酒店(北京天安门广场前门地铁站店)",
          roomType: "",
          ratePlan: "双床无早餐",
          screenshotPath: "/tmp/run/华住/hotel-01/双床无早餐/携程商旅.png",
          error: "携程商旅同酒店详情页未解析到双床无早餐价格"
        },
        {
          platform: "青猫差旅",
          status: "available",
          price: 619,
          hotelName: "全季酒店(北京天安门广场前门地铁站店)",
          roomType: "双床房",
          ratePlan: "双床无早餐",
          screenshotPath: "/tmp/run/华住/hotel-01/双床无早餐/青猫差旅.png"
        }
      ],
      message: "全季酒店 4 个口径已全部尝试"
    });

    const html = buildHotelDiagnosticReviewHtml(result, { htmlPath: "/tmp/run/diagnostic-review.html" });

    expect(html).toContain("酒店诊断人工验收页");
    expect(html).toContain("全季酒店(北京天安门广场前门地铁站店)");
    expect(html).toContain("系统没读到价格，请人工看截图");
    expect(html).toContain("双床无早餐");
    expect(html).toContain("src=\"%E5%8D%8E%E4%BD%8F/hotel-01/%E5%8F%8C%E5%BA%8A%E6%97%A0%E6%97%A9%E9%A4%90/%E6%90%BA%E7%A8%8B%E5%95%86%E6%97%85.png\"");
    expect(html).toContain("data-lightbox-src=\"%E5%8D%8E%E4%BD%8F/hotel-01/%E5%8F%8C%E5%BA%8A%E6%97%A0%E6%97%A9%E9%A4%90/%E6%90%BA%E7%A8%8B%E5%95%86%E6%97%85.png\"");
    expect(html).toContain("点击看大图");
    expect(html).toContain("id=\"imageLightbox\"");
  });

  it("shows Ali hotel search process evidence on the human review page", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "hotel-review-"));
    const rateDir = path.join(runDir, "首旅如家", "hotel-01", "大床无早餐");
    fs.mkdirSync(rateDir, { recursive: true });
    const mainShot = path.join(rateDir, "阿里商旅-酒店主口径大床无早餐.png");
    const listShot = path.join(rateDir, "alibtrip-keyword-07-list.png");
    const cardShot = path.join(rateDir, "alibtrip-keyword-07-selected-card-01.png");
    const detailShot = path.join(rateDir, "alibtrip-keyword-07-detail-01.png");
    for (const filePath of [mainShot, listShot, cardShot, detailShot]) {
      fs.writeFileSync(filePath, "fake");
    }
    const result = buildInitialHotelScaleValidationResult(new Date(2026, 4, 24, 10), { limit: 5 });
    result.groups[0].samples.push({
      group: "首旅如家",
      groupIndex: 1,
      sampleIndex: 1,
      status: "partial",
      selectedCandidate: {
        hotelName: "如家商旅酒店(北京天安门广场前门地铁站店)",
        level: "舒适型",
        score: "4.8",
        area: "北京",
        address: "西城区前门西河沿街114号",
        price: 690,
        rawText: "如家商旅"
      },
      quotes: [
        {
          platform: "阿里商旅",
          status: "not-found",
          price: null,
          hotelName: "如家商旅酒店(北京天安门广场前门地铁站店)",
          roomType: "",
          ratePlan: "大床无早餐",
          screenshotPath: mainShot,
          error: "阿里商旅同酒店详情页未解析到大床无早餐价格"
        }
      ]
    });

    const html = buildHotelDiagnosticReviewHtml(result, { htmlPath: path.join(runDir, "diagnostic-review.html") });

    expect(html).toContain("阿里过程证据");
    expect(html).toContain("搜索列表");
    expect(html).toContain("命中酒店卡片");
    expect(html).toContain("详情页截图");
    expect(html).toContain("alibtrip-keyword-07-selected-card-01.png");
  });

  it("builds a single-hotel all-rate-plans review page from platform rate prices", () => {
    const html = buildHotelSingleAllRatePlansReviewHtml({
      status: "partial",
      mode: "single-all-rate-plans",
      input: {
        city: "北京",
        keyword: "全季酒店(北京站店)",
        checkInDate: "2026-05-28",
        checkOutDate: "2026-05-29"
      },
      query: {
        city: "北京",
        keyword: "全季酒店(北京站店)",
        checkInDate: "2026-05-28",
        checkOutDate: "2026-05-29",
        nights: 1
      },
      selectedCandidate: {
        hotelName: "全季酒店(北京站店)",
        level: "舒适型",
        score: "4.8",
        area: "北京",
        address: "东城区北京站街8号",
        price: 520,
        rawText: "全季酒店(北京站店) 东城区北京站街8号"
      },
      sourceHotel: {
        hotelName: "全季酒店(北京站店)",
        city: "北京",
        address: "东城区北京站街8号",
        doorPlate: "北京站街8号",
        rawText: "全季酒店(北京站店) 东城区北京站街8号"
      },
      platformOrder: ["青猫差旅", "携程商旅", "阿里商旅", "在途商旅"],
      platforms: [
        calibrationPlatform("青猫差旅", { 大床无早餐: 500, 大床有早餐: 530, 双床无早餐: 540, 双床有早餐: 560 }),
        calibrationPlatform("携程商旅", { 大床无早餐: 510, 大床有早餐: 535, 双床无早餐: 545, 双床有早餐: 565 }),
        calibrationPlatform("阿里商旅", { 大床无早餐: 505, 大床有早餐: 532, 双床无早餐: 542, 双床有早餐: 562 }),
        {
          ...calibrationPlatform("在途商旅", { 大床无早餐: 515, 大床有早餐: 538, 双床无早餐: 548, 双床有早餐: null }),
          failureReason: "在途商旅未找到双床有早餐价格",
          screenshotPath: "/tmp/run/ztrip.png"
        }
      ],
      completeRatePlans: ["大床无早餐", "大床有早餐", "双床无早餐"],
      resultPath: "/tmp/run/result.json",
      diagnosticReviewPath: "/tmp/run/diagnostic-review.html",
      updatedAt: "2026-05-18T10:04:05.000Z",
      message: "指定单酒店一次性四口径复验完成：完整口径 3/4"
    }, { htmlPath: "/tmp/run/diagnostic-review.html" });

    expect(html).toContain("指定单酒店四口径验收页");
    expect(html).toContain("全季酒店(北京站店)");
    expect(html).toContain("大床无早餐");
    expect(html).toContain("双床有早餐");
    expect(html).toContain("青猫差旅");
    expect(html).toContain("携程商旅");
    expect(html).toContain("阿里商旅");
    expect(html).toContain("在途商旅");
    expect(html).toContain("¥500");
    expect(html).toContain("在途商旅未找到双床有早餐价格");
    expect(html).toContain("src=\"ztrip.png\"");
    expect(html).toContain("data-lightbox-src=\"ztrip.png\"");
    expect(html).toContain("点击看大图");
    expect(html).toContain("id=\"imageLightbox\"");
  });

  it("stops hotel scale validation on group and overall budgets", () => {
    expect(resolveHotelScaleValidationBudgetStop({
      maxAttempts: 0,
      budgetMs: 25 * 60 * 1000,
      startedAtMs: 1_000,
      nowMs: 1_000
    })).toBe("达到本集团候选尝试上限");
    expect(resolveHotelScaleValidationBudgetStop({
      maxAttempts: 1,
      budgetMs: 25 * 60 * 1000,
      startedAtMs: 1_000,
      nowMs: 1_000 + 25 * 60 * 1000
    })).toBe("达到本集团时间预算");
    expect(resolveHotelScaleValidationOverallBudgetStop(1_000, 1_000 + 120 * 60 * 1000)).toBe("达到40家放量验证整体时间预算");
  });

  it("keeps excluded random-bed hotel rate raw text for diagnosis", () => {
    expect(isHotelRateLineExcludedByBedAssignment("安心睡安睡大床房 到店随机分配床型 2份早餐 CNY 189")).toEqual({
      excluded: true,
      reason: "到店随机分配床型"
    });
    expect(isHotelRateLineExcludedByBedAssignment("安心睡安睡大床房 到店随机分配床型 2份早餐 CNY 189", { mainRoomTypeText: "安心睡安睡大床房" })).toEqual({
      excluded: false,
      reason: ""
    });
    expect(isHotelRateLineExcludedByBedAssignment("高级大床房 房型待定 1份早餐 ￥320")).toEqual({
      excluded: true,
      reason: "房型待定"
    });
    expect(isHotelRateLineExcludedByBedAssignment("高级大床房 1张1.8米大床 2份早餐 ￥320")).toEqual({
      excluded: false,
      reason: ""
    });
    expect(parseCtripHotelMainRatesText("测试酒店\n高级大床房\n到店安排\n2份早餐\n¥320", "大床有早餐")).toHaveLength(1);
    expect(extractExcludedHotelRateRowsFromText("携程商旅", "测试酒店\n高级大床房\n到店安排\n2份早餐\n¥320")).toEqual([
      {
        platform: "携程商旅",
        reason: "到店安排",
        rawText: "测试酒店 高级大床房 到店安排 2份早餐 ¥320"
      }
    ]);
  });

  it("marks incomplete failed evidence separately from evidence save failures", () => {
    expect(evaluateHotelScaleValidationEvidence({
      status: "failed",
      currentPlatform: "阿里商旅",
      currentStep: "read-main-rate",
      failureType: "competitor_no_main_rate",
      failureReason: "阿里无大床有早餐",
      finalUrl: "https://travel.alibtrip.com/hotel-demeter#/detail",
      screenshotPath: "",
      diagnosisPath: "/tmp/alibtrip-list-diagnosis.json",
      resultPath: "/tmp/result.json",
      pageTextSummary: "酒店详情 大床 早餐",
      pathRecords: [],
      aliEvidence: {
        listScreenshotPath: "/tmp/list.png",
        candidateScreenshotPath: "/tmp/card.png",
        failureScreenshotPath: "/tmp/failure.png"
      }
    })).toMatchObject({
      evidenceStatus: "evidence_missing",
      evidenceIssues: expect.arrayContaining(["screenshotPath 缺失", "pathRecords 缺失"])
    });

    expect(evaluateHotelScaleValidationEvidence({
      status: "failed",
      currentPlatform: "携程商旅",
      currentStep: "save-failure-screenshot",
      failureType: "unknown_technical_failure",
      failureReason: "截图和 HTML 快照均保存失败",
      finalUrl: "https://ct.ctrip.com/hotel",
      screenshotPath: "",
      diagnosisPath: "/tmp/result.json",
      resultPath: "/tmp/result.json",
      pageTextSummary: "携程酒店详情",
      pathRecords: [{
        platform: "携程商旅",
        step: "save-failure-screenshot",
        status: "failed",
        startedAt: "2026-05-24T10:00:00.000Z",
        endedAt: "2026-05-24T10:00:01.000Z",
        durationMs: 1000,
        finalUrl: "https://ct.ctrip.com/hotel",
        failureType: "unknown_technical_failure",
        failureReason: "截图和 HTML 快照均保存失败"
      }],
      evidenceSaveFailed: true
    })).toMatchObject({
      evidenceStatus: "evidence_save_failed"
    });
  });

  it("summarizes 40-hotel scale validation evidence and timing stats", () => {
    const query = { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-25", checkOutDate: "2026-05-26", nights: 1 };
    const pathRecords = [
      { platform: "青猫差旅" as const, step: "qingmao-candidate-search", status: "completed" as const, startedAt: "2026-05-24T10:00:00.000Z", endedAt: "2026-05-24T10:00:02.000Z", durationMs: 2000, finalUrl: "https://booking.tmctrip.com/TravelBooking", screenshotPath: "/tmp/qingmao.png" },
      { platform: "阿里商旅" as const, step: "read-main-rate", status: "completed" as const, startedAt: "2026-05-24T10:00:02.000Z", endedAt: "2026-05-24T10:00:07.000Z", durationMs: 5000, finalUrl: "https://travel.alibtrip.com/hotel-demeter#/detail", screenshotPath: "/tmp/ali.png", diagnosisPath: "/tmp/alibtrip.json" },
      { platform: "在途商旅" as const, step: "read-main-rate", status: "timeout" as const, startedAt: "2026-05-24T10:00:07.000Z", endedAt: "2026-05-24T10:00:17.000Z", durationMs: 10000, finalUrl: "https://www.z-trip.cn/v/pg/hotel/hotelList", screenshotPath: "/tmp/ztrip.png", failureType: "page_load_timeout" as const, failureReason: "在途超时" }
    ];
    const groups = [
      {
        group: "首旅如家" as const,
        targetCount: 8,
        attemptedCount: 8,
        completedCount: 7,
        partialCount: 0,
        failedCount: 0,
        skippedCount: 0,
        timeoutCount: 1,
        unattemptedCount: 0,
        timeoutBudget: false,
        samples: [
          { status: "completed" as const, query, pathRecords, evidenceStatus: "complete" as const },
          { status: "timeout" as const, query, pathRecords, evidenceStatus: "evidence_missing" as const, evidenceIssues: ["pageTextSummary 缺失"], currentPlatform: "在途商旅" as const, currentStep: "read-main-rate", failureType: "page_load_timeout" as const, failureReason: "在途超时", finalUrl: "https://www.z-trip.cn", screenshotPath: "/tmp/ztrip.png", diagnosisPath: "/tmp/result.json", pageTextSummary: "" }
        ]
      },
      {
        group: "华住" as const,
        targetCount: 8,
        attemptedCount: 8,
        completedCount: 8,
        partialCount: 0,
        failedCount: 0,
        skippedCount: 0,
        timeoutCount: 0,
        unattemptedCount: 0,
        timeoutBudget: false,
        samples: []
      }
    ];

    const summary = summarizeHotelScaleValidationGroups(groups);
    expect(summary).toMatchObject({
      completedCount: 15,
      timeoutCount: 1,
      targetTotal: 16,
      evidenceCompleteCount: 1,
      evidenceMissingCount: 1,
      evidenceCompleteRate: 0.5,
      status: "partial"
    });

    const timings = aggregateHotelScaleValidationTimings(groups.flatMap((group) => group.samples));
    expect(timings.platforms.find((item) => item.platform === "阿里商旅")).toMatchObject({
      count: 2,
      totalMs: 10000,
      averageMs: 5000,
      p95Ms: 5000
    });
    expect(timings.steps.find((item) => item.step === "read-main-rate")).toMatchObject({
      count: 4,
      totalMs: 30000,
      averageMs: 7500
    });
    expect(timings.slowestSteps[0]).toMatchObject({
      platform: "在途商旅",
      durationMs: 10000
    });
    expect(timings.timeoutSamples).toHaveLength(1);
  });

  it("selects the matching ali card even when it is not the first card", () => {
    const candidate = {
      hotelName: "如家商旅酒店(广州白云山京溪南方医院地铁站店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "白云区广州大道北1420号",
      price: 218,
      rawText: ""
    };
    const selection = selectAliHotelListMatchFromCards(candidate, "广州", [
      { index: 0, text: "如家商旅(金标)-广州东站燕塘店 天河区燕岭路13号 ￥235起", screenIndex: 0 },
      { index: 1, text: "如家商旅(金标)-广州京溪南方医院地铁站店 广州市白云区广州大道 ￥286起", screenIndex: 0 }
    ]);

    expect(selection.matched).toBe(true);
    expect(selection.matchedCard?.index).toBe(1);
    expect(selection.matchedCard?.match.reason).toBe("阿里列表候选：品牌+核心店名，待详情门牌确认");
    expect(selection.matchedCard?.match.sameHotelConfirmed).toBe(false);
  });

  it("keeps ali brand and core-name list cards as detail confirmation candidates", () => {
    const candidate = {
      hotelName: "如家商旅酒店(广州白云国际机场T2航站楼店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "花都区空港大道10号之六3栋二至十层",
      price: 216,
      rawText: ""
    };
    const selection = selectAliHotelListMatchFromCards(candidate, "广州", [
      { index: 0, text: "如家商旅(金标)-广州白云国际机场T2航站楼店 舒适型 4.7 白云机场附近 ￥216起", screenIndex: 0 }
    ]);

    expect(selection.matched).toBe(true);
    expect(selection.detailCandidates).toHaveLength(1);
    expect(selection.detailCandidates[0]).toMatchObject({
      cardIndex: 0,
      listMatchReason: "阿里列表候选：品牌+核心店名，待详情门牌确认"
    });
  });

  it("keeps ali full-name search variants as detail candidates when the core landmark still matches", () => {
    const rongguiCandidate = {
      hotelName: "如家酒店·neo(顺德容桂天佑城店)",
      level: "经济型",
      score: "4.6",
      area: "",
      address: "顺德区容桂镇文华路19号",
      price: 134,
      rawText: ""
    };
    const qinghuiCandidate = {
      hotelName: "如家精选酒店(佛山顺德清晖园店)",
      level: "舒适型",
      score: "4.8",
      area: "",
      address: "顺德区大良南国中路蚌岗巷5号",
      price: 222,
      rawText: ""
    };

    expect(
      matchAliHotelListCandidateForDetail(
        rongguiCandidate,
        "如家·neo-容桂渔人码头天佑城店经济4.6很好1000+评价近天佑城(桂洲大道店)·文塔公园可开专票￥133起",
        "佛山"
      )
    ).toMatchObject({
      matched: true,
      reason: "阿里列表候选：品牌+核心店名，待详情门牌确认",
      sameHotelConfirmed: false
    });
    expect(
      matchAliHotelListCandidateForDetail(
        qinghuiCandidate,
        "如家精选(佛山顺德大良清晖园店）舒适4.8很好1000+评价近清晖园·佛山顺德大良蚌岗巷可开专票￥222起",
        "佛山"
      )
    ).toMatchObject({
      matched: true,
      reason: "阿里列表候选：品牌+核心店名，待详情门牌确认",
      sameHotelConfirmed: false
    });
  });

  it("keeps ali airport landmark list cards as detail confirmation candidates even without door number", () => {
    const candidate = {
      hotelName: "如家商旅酒店(广州白云国际机场T2航站楼店)",
      level: "舒适型",
      score: "4.8",
      area: "",
      address: "花都区空港大道10号之六3栋二至十层",
      price: 216,
      rawText: ""
    };
    const selection = selectAliHotelListMatchFromCards(candidate, "广州", [
      { index: 0, text: "如家商旅-广州白云国际机场店舒适4.8很好432条评价近空港电商国际产业园·东北烧烤可开专票免费接送服务￥206起", screenIndex: 0 }
    ]);

    expect(selection.matched).toBe(true);
    expect(selection.matchedCard?.index).toBe(0);
    expect(selection.detailCandidates[0]).toMatchObject({
      cardIndex: 0,
      listMatchReason: "阿里列表候选：品牌+核心店名，待详情门牌确认"
    });
  });

  it("keeps ali cards with the same brand and strong airport landmark as detail candidates", () => {
    const candidate = {
      hotelName: "维也纳酒店(广州白云机场花都大道店)",
      level: "舒适型",
      score: "4.6",
      area: "",
      address: "花都区花东镇花都大道东406号",
      price: 226,
      rawText: ""
    };
    const selection = selectAliHotelListMatchFromCards(candidate, "广州", [
      { index: 0, text: "维也纳酒店(广州白云机场物流汽配城店)舒适4.8很好389条评价近花东商业城·世外桃源景区可开专票免费接送机￥230起", screenIndex: 0 }
    ]);

    expect(selection.matched).toBe(true);
    expect(selection.matchedCard?.index).toBe(0);
    expect(selection.matchedCard?.match).toMatchObject({
      brandMatched: true,
      coreNameMatched: true,
      strongLandmarkMatched: true,
      doorNumber: null,
      reason: "阿里列表候选：品牌+核心店名，待详情门牌确认"
    });
    expect(selection.detailCandidates).toHaveLength(1);
  });

  it("keeps Yishang Yuexiu Park list cards as detail confirmation candidates without door number", () => {
    const candidate = {
      hotelName: "宜尚酒店(广州越秀公园地铁站北京路步行街店)",
      level: "高档型",
      score: "4.4",
      area: "",
      address: "越秀区盘福路79号",
      price: 336,
      rawText: ""
    };
    const selection = selectAliHotelListMatchFromCards(candidate, "广州", [
      { index: 0, text: "宜尚酒店(广州越秀公园地铁站店)高档4.4好356条评价近北京路步行街·华茂中心大厦可开专票￥336起", screenIndex: 0 }
    ]);

    expect(selection.matched).toBe(true);
    expect(selection.matchedCard?.index).toBe(0);
    expect(selection.matchedCard?.match).toMatchObject({
      brandMatched: true,
      coreNameMatched: true,
      strongLandmarkMatched: true,
      doorNumber: null,
      reason: "阿里列表候选：品牌+核心店名，待详情门牌确认"
    });
    expect(selection.detailCandidates).toHaveLength(1);
  });

  it("does not click ali airport landmark cards when the hotel brand does not match", () => {
    const candidate = {
      hotelName: "维也纳酒店(广州白云机场花都大道店)",
      level: "舒适型",
      score: "4.6",
      area: "",
      address: "花都区花东镇花都大道东406号",
      price: 226,
      rawText: ""
    };
    const selection = selectAliHotelListMatchFromCards(candidate, "广州", [
      { index: 0, text: "尚客优连锁（广州白云机场花东店）经济4.4好112条评价距花东镇步行310米 4分钟可开专票免费接送机￥143起", screenIndex: 0 }
    ]);

    expect(selection.matched).toBe(false);
    expect(selection.detailCandidates).toHaveLength(0);
  });

  it("does not click ali cards that only match the brand without target landmarks", () => {
    const candidate = {
      hotelName: "维也纳酒店(广州白云机场花都大道店)",
      level: "舒适型",
      score: "4.6",
      area: "",
      address: "花都区花东镇花都大道东406号",
      price: 226,
      rawText: ""
    };
    const selection = selectAliHotelListMatchFromCards(candidate, "广州", [
      { index: 0, text: "维也纳酒店(广州北京路步行街店)舒适4.5好1000+评价近北京路步行街·新大新百货可开专票￥294起", screenIndex: 0 }
    ]);

    expect(selection.matched).toBe(false);
    expect(selection.detailCandidates).toHaveLength(0);
  });

  it("keeps ali failure evidence fields on failed main-rate quotes", () => {
    const candidate = {
      hotelName: "维也纳酒店(广州惠福西上下九店)",
      level: "舒适型",
      score: "4.5",
      area: "",
      address: "越秀区惠福西路38号",
      price: 214,
      rawText: ""
    };

    expect(buildFailedAliHotelMainRateQuote({
      candidate,
      ratePlan: "大床有早餐",
      error: "阿里详情门牌不匹配",
      durationMs: 105516,
      finalUrl: "https://travel.alibtrip.com/hotel-demeter#/list",
      screenshotPath: "/tmp/ali-failed.png",
      diagnosisPath: "/tmp/alibtrip-list-diagnosis.json"
    })).toMatchObject({
      platform: "阿里商旅",
      status: "failed",
      finalUrl: "https://travel.alibtrip.com/hotel-demeter#/list",
      screenshotPath: "/tmp/ali-failed.png",
      diagnosisPath: "/tmp/alibtrip-list-diagnosis.json",
      error: "阿里详情门牌不匹配"
    });
  });

  it("ranks ali same-keyword detail candidates and caps them at the top three", () => {
    const candidate = {
      hotelName: "如家商旅酒店(广州白云山京溪南方医院地铁站店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "白云区广州大道北1420号",
      price: 218,
      rawText: ""
    };
    const ranked = rankAliHotelDetailCandidateCards(candidate, "广州", [
      { index: 0, text: "如家商旅(金标)-广州京溪南方医院地铁站店 广州市天河区燕岭路13号 ￥235起", screenIndex: 0 },
      { index: 1, text: "如家商旅(金标)-广州京溪南方医院地铁站店 近梅花园地铁站 ￥286起", screenIndex: 0 },
      { index: 2, text: "如家商旅(金标)-广州京溪南方医院地铁站店 广州市白云区广州大道北1420号 ￥304起", screenIndex: 0 },
      { index: 3, text: "如家商旅(金标)-广州京溪南方医院地铁站店 近京溪南方医院 ￥299起", screenIndex: 1 }
    ]);

    expect(ranked).toHaveLength(3);
    expect(ranked.map((item) => item.cardIndex)).toEqual([2, 1, 3]);
    expect(ranked.map((item) => item.rank)).toEqual([1, 2, 3]);
    expect(ranked[0].cardText).toContain("1420号");
    expect(ranked[0].detailSameHotel).toBeUndefined();
    expect(ranked[0].failureReason).toBeUndefined();
  });

  it("continues within the same ali keyword when the first detail candidate has the wrong door plate", () => {
    const candidate = {
      hotelName: "如家商旅酒店(广州白云山京溪南方医院地铁站店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "白云区广州大道北1420号",
      price: 218,
      rawText: ""
    };
    const ranked = rankAliHotelDetailCandidateCards(candidate, "广州", [
      { index: 0, text: "如家商旅(金标)-广州京溪南方医院地铁站店 近梅花园地铁站 ￥286起", screenIndex: 0 },
      { index: 1, text: "如家商旅(金标)-广州京溪南方医院地铁站店 近京溪南方医院 ￥304起", screenIndex: 0 }
    ]);

    const outcome = resolveAliHotelDetailCandidateAttempts("广州", candidate, [
      {
        ...ranked[0],
        detailFinalUrl: "https://travel.alibtrip.com/hotel-demeter#/detail/first",
        detailText: "酒店详情 如家商旅(金标)-广州京溪南方医院地铁站店 广州市天河区燕岭路13号"
      },
      {
        ...ranked[1],
        detailFinalUrl: "https://travel.alibtrip.com/hotel-demeter#/detail/second",
        detailText: "酒店详情 如家商旅(金标)-广州京溪南方医院地铁站店 广州市白云区广州大道北1420号"
      }
    ]);

    expect(outcome.matched).toBe(true);
    expect(outcome.matchedCandidate).toMatchObject({
      rank: 2,
      detailFinalUrl: "https://travel.alibtrip.com/hotel-demeter#/detail/second",
      detailDoorNumber: "1420号",
      detailSameHotel: true,
      failureReason: ""
    });
    expect(outcome.attempts[0]).toMatchObject({
      rank: 1,
      detailDoorNumber: "13号",
      detailSameHotel: false,
      failureReason: "阿里详情门牌不匹配：期望 1420号，实际 13号"
    });
  });

  it("fails an ali keyword only after the top three detail candidates all miss the door plate", () => {
    const candidate = {
      hotelName: "如家商旅酒店(广州白云山京溪南方医院地铁站店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "白云区广州大道北1420号",
      price: 218,
      rawText: ""
    };
    const ranked = rankAliHotelDetailCandidateCards(candidate, "广州", [
      { index: 0, text: "如家商旅(金标)-广州京溪南方医院地铁站店 近梅花园地铁站 ￥286起", screenIndex: 0 },
      { index: 1, text: "如家商旅(金标)-广州京溪南方医院地铁站店 近京溪南方医院 ￥304起", screenIndex: 0 },
      { index: 2, text: "如家商旅(金标)-广州京溪南方医院地铁站店 近同和 ￥299起", screenIndex: 0 },
      { index: 3, text: "如家商旅(金标)-广州京溪南方医院地铁站店 近白云山 ￥288起", screenIndex: 0 }
    ]);

    const outcome = resolveAliHotelDetailCandidateAttempts("广州", candidate, ranked.map((item, index) => ({
      ...item,
      detailFinalUrl: `https://travel.alibtrip.com/hotel-demeter#/detail/${index + 1}`,
      detailText: `酒店详情 如家商旅(金标)-广州京溪南方医院地铁站店 广州市天河区燕岭路${13 + index}号`
    })));

    expect(outcome.matched).toBe(false);
    expect(outcome.attempts).toHaveLength(3);
    expect(outcome.attempts.map((item) => item.rank)).toEqual([1, 2, 3]);
    expect(outcome.failureReason).toContain("阿里同关键词前 3 个详情候选均未匹配");
    expect(outcome.failureReason).toContain("第1候选");
    expect(outcome.failureReason).toContain("第3候选");
  });

  it("collects ali cards across scroll screens before matching", async () => {
    const candidate = {
      hotelName: "如家商旅酒店(广州白云山京溪南方医院地铁站店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "白云区广州大道北1420号",
      price: 218,
      rawText: ""
    };
    const screens = [
      [{ index: 0, text: "如家商旅(金标)-广州东站燕塘店 天河区燕岭路13号 ￥235起" }],
      [{ index: 4, text: "如家商旅(金标)-广州京溪南方医院地铁站店 广州市白云区广州大道 ￥286起" }]
    ];
    let evaluateCalls = 0;
    const page = {
      evaluate: async () => screens[Math.min(evaluateCalls++, screens.length - 1)],
      waitForTimeout: async () => undefined
    };

    const result = await collectAliHotelListCardsForMatching(page, candidate, "广州", { maxScreens: 2, waitMs: 0 });

    expect(result.matched).toBe(true);
    expect(result.matchedCard?.index).toBe(4);
    expect(result.cardCount).toBe(2);
  });

  it("uses ali brand fallback keywords only after normal keywords miss", () => {
    const query = { city: "广州", keyword: "亚朵", checkInDate: "2026-05-24", checkOutDate: "2026-05-25", nights: 1 };
    const candidate = {
      hotelName: "广州塔琶洲会展亚朵S酒店",
      level: "高档型",
      score: "4.8",
      area: "",
      address: "海珠区新港东路277号20层",
      price: 671,
      rawText: ""
    };

    const plan = buildAliHotelSearchKeywordPlan(query, candidate);

    expect(plan.slice(0, 2).map((item) => item.keyword)).toEqual(["广州塔琶洲会展亚朵S酒店", "新港东路277号"]);
    expect(plan.find((item) => item.keyword === "亚朵酒店")).toMatchObject({
      mode: "brand-fallback",
      maxScreens: 20,
      maxCards: 120,
      maxDurationMs: 90_000
    });
    expect(plan.findIndex((item) => item.keyword === "亚朵酒店")).toBeGreaterThan(plan.findIndex((item) => item.keyword === "新港东路277号"));
  });

  it("collects ali brand fallback cards deeply until the target appears around the sixtieth card", async () => {
    const candidate = {
      hotelName: "广州塔琶洲会展亚朵S酒店",
      level: "高档型",
      score: "4.8",
      area: "",
      address: "海珠区新港东路277号20层",
      price: 671,
      rawText: ""
    };
    let evaluateCalls = 0;
    const page = {
      evaluate: async (pageFunction: string) => {
        if (pageFunction.includes("scrollBy")) return true;
        const start = evaluateCalls++ * 10;
        return Array.from({ length: 10 }, (_, offset) => {
          const index = start + offset;
          return {
            index,
            text: index === 59
              ? "广州塔琶洲会展亚朵S酒店 高档4.8超棒 近琶洲会展 可开专票￥671起"
              : `广州亚朵候选${index}号酒店 高档4.7 可开专票￥${500 + index}起`
          };
        });
      },
      waitForTimeout: async () => undefined
    };

    const result = await collectAliHotelListCardsForMatching(page, candidate, "广州", {
      maxScreens: 8,
      maxCards: 120,
      waitMs: 0
    });

    expect(result.matched).toBe(true);
    expect(result.matchedCard?.text).toContain("广州塔琶洲会展亚朵S酒店");
    expect(result.cardCount).toBe(60);
    expect(result.screensRead).toBe(6);
    expect(result.foundExactNameCard).toBe(true);
  });

  it("stops ali normal keyword collection immediately when a detail candidate is found", async () => {
    const candidate = {
      hotelName: "全季酒店(广州上下九步行街陈家祠店)",
      level: "高档型",
      score: "4.7",
      area: "",
      address: "荔湾区康王中路484号",
      price: 454,
      rawText: ""
    };
    let readCalls = 0;
    const page = {
      evaluate: async (pageFunction: string) => {
        if (pageFunction.includes("scrollBy")) return true;
        readCalls += 1;
        return [{ index: 0, text: "全季广州上下九步行街陈家祠酒店 高档4.7 广州市荔湾区康王中路484号 ￥418起" }];
      },
      waitForTimeout: async () => undefined
    };

    const result = await collectAliHotelListCardsForMatching(page, candidate, "广州", {
      maxScreens: 20,
      maxCards: 120,
      waitMs: 0
    });

    expect(result.matched).toBe(true);
    expect(result.screensRead).toBe(1);
    expect(readCalls).toBe(1);
  });

  it("builds ali brand fallback keyword pairs for non-atour brands too", () => {
    const query = { city: "广州", keyword: "全季", checkInDate: "2026-05-24", checkOutDate: "2026-05-25", nights: 1 };
    const wholeSeason = {
      hotelName: "全季酒店(广州上下九步行街陈家祠店)",
      level: "高档型",
      score: "4.7",
      area: "",
      address: "荔湾区康王中路484号",
      price: 454,
      rawText: ""
    };
    const vienna = {
      hotelName: "维也纳酒店(广州火车站小北地铁站店)",
      level: "舒适型",
      score: "4.6",
      area: "",
      address: "越秀区童心路8号",
      price: 301,
      rawText: ""
    };

    expect(buildAliHotelSearchKeywordPlan(query, wholeSeason).filter((item) => item.mode === "brand-fallback").map((item) => item.keyword)).toEqual([
      "全季酒店",
      "全季"
    ]);
    expect(buildAliHotelSearchKeywordPlan({ ...query, keyword: "维也纳" }, vienna).filter((item) => item.mode === "brand-fallback").map((item) => item.keyword)).toEqual([
      "维也纳酒店",
      "维也纳"
    ]);
  });

  it("does not confirm ali brand fallback target until the detail door plate matches", () => {
    const candidate = {
      hotelName: "广州塔琶洲会展亚朵S酒店",
      level: "高档型",
      score: "4.8",
      area: "",
      address: "海珠区新港东路277号20层",
      price: 671,
      rawText: ""
    };
    const ranked = rankAliHotelDetailCandidateCards(candidate, "广州", [
      { index: 59, text: "广州塔琶洲会展亚朵S酒店 高档4.8超棒 近琶洲会展 可开专票￥671起", screenIndex: 5 }
    ]);

    expect(ranked).toHaveLength(1);
    expect(
      resolveAliHotelDetailCandidateAttempts("广州", candidate, [{
        ...ranked[0],
        detailText: "广州塔琶洲会展亚朵S酒店 广州市海珠区新港东路289号"
      }])
    ).toMatchObject({
      matched: false,
      attempts: [{ detailDoorNumber: "289号", detailSameHotel: false }]
    });
    expect(
      resolveAliHotelDetailCandidateAttempts("广州", candidate, [{
        ...ranked[0],
        detailText: "广州塔琶洲会展亚朵S酒店 广州市海珠区新港东路277号20层"
      }])
    ).toMatchObject({
      matched: true,
      matchedCandidate: { detailDoorNumber: "277号", detailSameHotel: true }
    });
  });

  it("reports ali brand fallback scroll exhaustion clearly", async () => {
    const candidate = {
      hotelName: "广州塔琶洲会展亚朵S酒店",
      level: "高档型",
      score: "4.8",
      area: "",
      address: "海珠区新港东路277号20层",
      price: 671,
      rawText: ""
    };
    const page = {
      evaluate: async () => [{ index: 0, text: "广州珠江新城亚朵酒店 高档4.8 可开专票￥520起" }],
      waitForTimeout: async () => undefined
    };

    const result = await collectAliHotelListCardsForMatching(page, candidate, "广州", {
      maxScreens: 20,
      maxCards: 120,
      waitMs: 0
    });

    expect(result.matched).toBe(false);
    expect(result.screensRead).toBe(20);
    expect(formatAliHotelListMatchFailure(candidate, result)).toContain("滚动 20 屏");
    expect(formatAliHotelListMatchFailure(candidate, result)).toContain("未找到酒店名一致的阿里候选");
  });

  it("returns explicit ali selector diagnostics when no cards are found", async () => {
    const candidate = {
      hotelName: "如家商旅酒店(广州永庆坊荔湾湖公园店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "荔湾区黄沙大道144号",
      price: 583,
      rawText: ""
    };
    const page = {
      evaluate: async () => [],
      waitForTimeout: async () => undefined
    };

    const result = await collectAliHotelListCardsForMatching(page, candidate, "广州", { maxScreens: 1, waitMs: 0 });

    expect(result.matched).toBe(false);
    expect(formatAliHotelListMatchFailure(candidate, result)).toContain("selector 0 张");
  });

  it("keeps ali card-level match failure instead of overwriting it with whole-page address diagnosis", () => {
    const candidate = {
      hotelName: "如家商旅酒店(广州白云山京溪南方医院地铁站店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "白云区广州大道北1420号",
      price: 218,
      rawText: ""
    };
    const selection = selectAliHotelListMatchFromCards(candidate, "广州", [
      { index: 0, text: "如家商旅(金标)-广州天河龙洞植物园地铁站店 广州市天河区迎龙路1420号 ￥286起", screenIndex: 0 }
    ]);

    expect(selection.matched).toBe(false);
    expect(formatAliHotelListMatchFailure(candidate, selection)).toContain("有目标门牌但核心店名不匹配");
    expect(formatAliHotelListMatchFailure(candidate, selection)).not.toContain("竞品页面缺少可提取门牌号");
  });

  it("builds strict ctrip hotel search from the current run instead of an old list url", () => {
    const query = { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-24", checkOutDate: "2026-05-25", nights: 1 };
    const candidate = {
      hotelName: "如家商旅酒店(广州珠江新城杨箕东地铁站店)",
      level: "舒适型",
      score: "4.8",
      area: "",
      address: "越秀区广州大道中301号 (人保大厦南塔)",
      price: 299,
      rawText: ""
    };
    const keywords = buildHotelSearchKeywords(query, candidate);
    const url = new URL(buildStrictCtripHotelSearchUrl(query, keywords[0]));

    expect(keywords.slice(0, 4)).toEqual([
      "如家商旅酒店(广州珠江新城杨箕东地铁站店)",
      "如家商旅酒店珠江新城杨箕东地铁站",
      "如家商旅酒店珠江新城杨箕东",
      "如家酒店珠江新城杨箕东地铁站"
    ]);
    expect(keywords.indexOf("广州大道中301号")).toBeGreaterThan(3);
    expect(buildCtripHotelSearchKeywords(candidate)).toEqual(expect.arrayContaining(["广州大道中301号", "广州大道中"]));
    expect(url.pathname).toBe("/corp-hotel-booking/hotelList");
    expect(url.searchParams.get("geoCategoryName")).toBe("广州");
    expect(url.searchParams.get("checkIn")).toBe("2026-05-24");
    expect(url.searchParams.get("checkOut")).toBe("2026-05-25");
    expect(url.searchParams.get("keyword")).toBe("如家商旅酒店(广州珠江新城杨箕东地铁站店)");
  });

  it("keeps ctrip hotel list skeletons in loading state instead of treating them as no match", () => {
    const candidate = {
      hotelName: "如家商旅酒店(广州永庆坊荔湾湖公园店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "荔湾区黄沙大道144号",
      price: 264,
      rawText: ""
    };

    expect(
      classifyCtripHotelListReadiness(
        "热门 筛选 位置区域 价格/星级 更多筛选 如家商旅 清空 差旅标准",
        candidate
      )
    ).toBe("loading");
    expect(CTRIP_LIST_NOT_LOADED_ERROR).toBe("携程列表结果未加载完成");
  });

  it("matches exact ctrip hotel suggestions and rejects filter or keyword areas", () => {
    const candidate = {
      hotelName: "如家商旅酒店(广州永庆坊荔湾湖公园店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "荔湾区黄沙大道144号",
      price: 264,
      rawText: ""
    };

    expect(matchCtripHotelSuggestionText(candidate, "当前城市无搜索结果 其他城市搜索结果： 如家商旅酒店(广州永庆坊荔湾湖公园店) 中国-广东-广州 酒店")).toBe(true);
    expect(matchCtripHotelSuggestionText(candidate, "筛选 位置区域 价格/星级 推荐排序 如家商旅酒店(广州永庆坊荔湾湖公园店) 清空")).toBe(false);
    expect(matchCtripHotelSuggestionText(candidate, "关键词（选填） 如家商旅酒店(广州永庆坊荔湾湖公园店)")).toBe(false);
  });

  it("uses ali-style hotel keywords for ctrip single-diagnosis suggestions", () => {
    const candidate = {
      hotelName: "如家商旅酒店(广州永庆坊荔湾湖公园店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "荔湾区黄沙大道144号",
      price: 264,
      rawText: ""
    };
    const query = { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-24", checkOutDate: "2026-05-25", nights: 1 };

    expect(buildCtripHotelSuggestionKeywords(candidate, query)).toEqual(expect.arrayContaining([
      "如家商旅酒店(广州永庆坊荔湾湖公园店)",
      "如家商旅酒店永庆坊荔湾湖公园",
      "如家黄沙大道",
      "黄沙大道144号"
    ]));
    expect(buildCtripHotelSuggestionKeywords(candidate, query).indexOf("黄沙大道144号")).toBeGreaterThan(0);
  });

  it("does not submit ctrip single-diagnosis search until the hotel suggestion is selected", () => {
    expect(canSubmitCtripHotelSearchAfterSuggestionSelection({ clicked: false, selected: false })).toBe(false);
    expect(canSubmitCtripHotelSearchAfterSuggestionSelection({ clicked: true, selected: false })).toBe(false);
    expect(canSubmitCtripHotelSearchAfterSuggestionSelection({ clicked: true, selected: true })).toBe(true);
    expect(CTRIP_SUGGESTION_NOT_SELECTED_ERROR).toBe("携程酒店建议项未选中，未提交搜索");
  });

  it("retries ctrip home suggestion selection when the card was not selected", () => {
    expect(shouldRetryCtripHotelSuggestionSelection({ clicked: true, selected: false }, 1, 3)).toBe(true);
    expect(shouldRetryCtripHotelSuggestionSelection({ clicked: false, selected: false }, 2, 3)).toBe(true);
    expect(shouldRetryCtripHotelSuggestionSelection({ clicked: false, selected: false }, 3, 3)).toBe(false);
    expect(shouldRetryCtripHotelSuggestionSelection({ clicked: true, selected: true }, 1, 3)).toBe(false);
  });

  it("uses ctrip list keyword fallback when home submission lands on an old list", () => {
    const query = { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-24", checkOutDate: "2026-05-25", nights: 1 };

    expect(
      shouldUseCtripListKeywordFallback(
        query,
        "https://ct.ctrip.com/corp-hotel-booking/hotelList?geoCategoryName=%E4%B8%8A%E6%B5%B7&checkIn=2026-05-23&checkOut=2026-05-24",
        "上海 5月23日 5月24日"
      )
    ).toBe(true);
    expect(
      shouldUseCtripListKeywordFallback(
        query,
        "https://ct.ctrip.com/corp-hotel-booking/hotelList?geoCategoryName=%E5%B9%BF%E5%B7%9E&checkIn=2026-05-24&checkOut=2026-05-25",
        "广州 5月24日 5月25日 如家商旅酒店(广州永庆坊荔湾湖公园店)"
      )
    ).toBe(false);
  });

  it("does not submit ctrip list fallback search until the suggestion is selected", () => {
    expect(canSubmitCtripHotelSearchAfterSuggestionSelection({ clicked: true, selected: false })).toBe(false);
    expect(canSubmitCtripHotelSearchAfterSuggestionSelection({ clicked: true, selected: true })).toBe(true);
  });

  it("matches ctrip list candidates by core hotel name and door plate even when the card address omits the city", () => {
    const candidate = {
      hotelName: "如家商旅酒店(广州永庆坊荔湾湖公园店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "荔湾区黄沙大道144号",
      price: 264,
      rawText: ""
    };
    const listCard = "如家商旅酒店(广州永庆坊荔湾湖公园店) 黄沙大道144号 | 永庆坊/上下九步行街 ￥349 选择";

    expect(buildCtripHotelCoreKeywords(candidate.hotelName)).toEqual(expect.arrayContaining(["永庆坊荔湾湖公园", "永庆坊", "荔湾湖公园"]));
    expect(matchCtripHotelListCandidateText(candidate, listCard)).toMatchObject({
      matched: true,
      nameMatched: true,
      addressMatched: true
    });
  });

  it("still fails final ctrip confirmation when the detail page door plate differs", () => {
    const query = { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-24", checkOutDate: "2026-05-25", nights: 1 };
    const candidate = {
      hotelName: "如家商旅酒店(广州永庆坊荔湾湖公园店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "荔湾区黄沙大道144号",
      price: 264,
      rawText: ""
    };
    const similarNameWrongDoor = "如家商旅酒店(广州永庆坊荔湾湖公园店) 广州市荔湾区中山八路12号 大床房 2份早餐 ¥299";

    expect(scoreHotelNameMatch(candidate.hotelName, similarNameWrongDoor)).toBeGreaterThanOrEqual(6);
    expect(
      isSameHotelByCityAndDoorPlate(
        "广州",
        candidate.address,
        similarNameWrongDoor
      )
    ).toBe(false);
    expect(() =>
      assertCompetitorHotelDetailSameByDoorPlate("携程商旅", query, candidate, similarNameWrongDoor)
    ).toThrow("门牌号不一致");
  });

  it("continues ctrip keyword attempts after the first keyword opens a different door plate", () => {
    const query = { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-24", checkOutDate: "2026-05-25", nights: 1 };
    const candidate = {
      hotelName: "如家商旅酒店(广州永庆坊荔湾湖公园店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "荔湾区黄沙大道144号",
      price: 264,
      rawText: ""
    };
    const keywords = buildHotelSearchKeywords(query, candidate);
    const firstAttempt = evaluateCtripHotelDetailKeywordAttempt(
      query,
      candidate,
      keywords[0],
      "如家商旅酒店(广州中山八地铁站店) 广州市荔湾区中山八路12号"
    );
    const secondAttempt = evaluateCtripHotelDetailKeywordAttempt(
      query,
      candidate,
      keywords[1],
      "如家商旅酒店(广州永庆坊荔湾湖公园店) 广州市荔湾区黄沙大道144号"
    );

    expect(firstAttempt).toMatchObject({
      sameHotel: false,
      shouldTryNextKeyword: true,
      matchBasis: "门牌号不一致"
    });
    expect(secondAttempt).toMatchObject({
      sameHotel: true,
      shouldTryNextKeyword: false,
      matchBasis: "同城市同道路且门牌号兼容"
    });
  });

  it("does not auto-match ctrip detail pages when the door plate is missing", () => {
    const query = { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-24", checkOutDate: "2026-05-25", nights: 1 };
    const candidate = {
      hotelName: "如家商旅酒店(广州永庆坊荔湾湖公园店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "荔湾区黄沙大道144号",
      price: 264,
      rawText: ""
    };

    expect(() =>
      assertCompetitorHotelDetailSameByDoorPlate(
        "携程商旅",
        query,
        candidate,
        "广州 如家商旅酒店(广州永庆坊荔湾湖公园店) 永庆坊/上下九步行街 大床房 2份早餐 ¥299"
      )
    ).toThrow("竞品页面缺少可提取门牌号");
  });

  it("extracts ctrip hotel id from selectedSearchItem or searchFilter before opening detail", () => {
    const selectedSearchItemUrl = `https://ct.ctrip.com/corp-hotel-booking/hotelList?selectedSearchItem=${encodeURIComponent(JSON.stringify({
      text: "如家商旅酒店(广州永庆坊荔湾湖公园店)",
      sourceId: "HOTEL.HOTEL.67518346#abc",
      matchFilterId: "HOTEL.HOTEL.67518346",
      type: 4
    }))}`;
    const searchFilterUrl = `https://ct.ctrip.com/corp-hotel-booking/hotelList?searchFilter=${encodeURIComponent(JSON.stringify({
      text: "如家商旅酒店(广州永庆坊荔湾湖公园店)",
      sourceId: "HOTEL.HOTEL.67518346#abc"
    }))}`;

    expect(extractCtripHotelIdWithSourceFromUrl(selectedSearchItemUrl)).toEqual({
      hotelId: "67518346",
      source: "selectedSearchItem"
    });
    expect(extractCtripHotelIdWithSourceFromUrl(searchFilterUrl)).toEqual({
      hotelId: "67518346",
      source: "searchFilter"
    });
  });

  it("fails ctrip strict diagnosis when the page is still on an old city or old date", () => {
    const query = { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-24", checkOutDate: "2026-05-25", nights: 1 };
    const oldUrl = "https://ct.ctrip.com/corp-hotel-booking/hotelList?geoCategoryName=%E4%B8%8A%E6%B5%B7&checkIn=2026-05-22&checkOut=2026-05-23&keyword=%E5%A6%82%E5%AE%B6%E5%95%86%E6%97%85";

    expect(validateStrictCtripHotelSearchState(query, oldUrl, "上海 如家商旅 2026-05-22 2026-05-23")).toContain(CTRIP_SEARCH_STATE_STALE_ERROR);
    expect(
      validateStrictCtripHotelSearchState(
        query,
        "https://ct.ctrip.com/corp-hotel-booking/hotelList?geoCategoryName=%E5%B9%BF%E5%B7%9E&checkIn=2026-05-24&checkOut=2026-05-25&keyword=%E5%B9%BF%E5%B7%9E%E5%A4%A7%E9%81%93%E4%B8%AD301%E5%8F%B7",
        "广州 如家商旅 5月24日 5月25日"
      )
    ).toBeNull();
  });

  it("keeps hotel group samples inside the requested brand keyword", () => {
    const query = { city: "广州", keyword: "城市便捷", checkInDate: "2026-05-22", checkOutDate: "2026-05-23", nights: 1 };

    expect(
      isHotelCandidateRelevantForQuery(
        {
          hotelName: "城市便捷酒店(广州上下九步行街店)",
          level: "舒适型",
          score: "4.7",
          area: "",
          address: "",
          price: 200,
          rawText: ""
        },
        query
      )
    ).toBe(true);
    expect(
      isHotelCandidateRelevantForQuery(
        {
          hotelName: "广州东方宾馆",
          level: "豪华型",
          score: "4.7",
          area: "",
          address: "",
          price: 865,
          rawText: ""
        },
        query
      )
    ).toBe(false);
  });

  it("scores hotel names across platform naming differences", () => {
    expect(scoreHotelNameMatch("如家商旅酒店(广州白云山京溪南方医院地铁站店)", "如家商旅(金标)-广州京溪南方医院地铁站店")).toBeGreaterThanOrEqual(5);
    expect(scoreHotelNameMatch("广州琶洲会展赤沙地铁站如家商旅酒店", "如家商旅(金标)-广州京溪南方医院地铁站店")).toBeLessThan(3);
  });

  it("matches hotels by city and door plate instead of loose name similarity", () => {
    expect(extractHotelDoorPlate("广州市荔湾区黄沙大道144号")).toBe("黄沙大道144号");
    expect(
      isSameHotelByCityAndDoorPlate(
        "广州",
        "荔湾区黄沙大道144号",
        "如家商旅(金标)-广州永庆坊黄沙大道店 广州市荔湾区黄沙大道144号"
      )
    ).toBe(true);
    expect(
      isSameHotelByCityAndDoorPlate(
        "广州",
        "荔湾区黄沙大道144号",
        "广州尚辉国际酒店(中山八地铁站店) 广州市荔湾区中山八路12号"
      )
    ).toBe(false);
    expect(isSameHotelByCityAndDoorPlate("广州", "", "广州市荔湾区黄沙大道144号")).toBe(false);
  });

  it("matches hotel door plates when ali writes small Chinese numerals", () => {
    expect(extractHotelDoorPlate("广东省广州市天河区珠村东横三路一号")).toBe("珠村东横三路1号");
    expect(
      isSameHotelByCityAndDoorPlate(
        "广州",
        "天河区珠村东横三路1号",
        "如家商旅(金标)-广州天河东圃科学城珠吉店 广东省广州市天河区珠村东横三路一号"
      )
    ).toBe(true);
  });

  it("does not take the previous flight price when matching a same-flight quote", () => {
    const quote = extractSameFlightQuoteFromText(
      "CZ3586 22:00 白云T2 00:20 浦东T2 订票 ¥720 经济舱3.4折 南方航空 CZ3523 波音777 08:00 白云T2 10:20 虹桥T2 订票 ¥730 经济舱3.5折",
      "CZ3523"
    );

    expect(quote).toMatchObject({ status: "available", price: 730 });
  });

  it("requires all four platforms to have available same-flight prices for a complete sample", () => {
    expect(
      hasCompleteSameFlightQuotes([
        { platform: "青猫差旅", status: "available", price: 370 },
        { platform: "携程商旅", status: "available", price: 390 },
        { platform: "阿里商旅", status: "available", price: 380 },
        { platform: "在途商旅", status: "available", price: 376 }
      ])
    ).toBe(true);

    expect(
      hasCompleteSameFlightQuotes([
        { platform: "青猫差旅", status: "available", price: 370 },
        { platform: "携程商旅", status: "available", price: 390 },
        { platform: "阿里商旅", status: "available", price: 380 }
      ])
    ).toBe(false);

    expect(
      hasCompleteSameFlightQuotes([
        { platform: "青猫差旅", status: "available", price: 370 },
        { platform: "携程商旅", status: "available", price: 390 },
        { platform: "阿里商旅", status: "not-found", price: null },
        { platform: "在途商旅", status: "available", price: 376 }
      ])
    ).toBe(false);
  });
});
