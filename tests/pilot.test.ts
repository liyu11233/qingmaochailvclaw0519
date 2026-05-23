import { describe, expect, it } from "vitest";
import {
  classifyProbeOutcome,
  classifyZtripProbeOutcome,
  classifyZtripProductEntries,
  buildCtripHotelSearchKeywords,
  buildCtripHotelCoreKeywords,
  buildStrictCtripHotelSearchUrl,
  buildAliHotelSearchKeywords,
  buildAliHotelSearchKeywordPlan,
  collectAliHotelListCardsForMatching,
  confirmAliHotelDetailDoorPlate,
  applyAliHotelDetailDiagnosisToTrace,
  rankAliHotelDetailCandidateCards,
  resolveAliHotelDetailCandidateAttempts,
  resolveAliHotelSameHotelAfterFailure,
  formatAliHotelListMatchFailure,
  matchAliHotelListCandidateForDetail,
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
  hasCompleteSameFlightQuotes,
  classifyHotelCalibrationFailureType,
  extractHotelDoorPlate,
  isHotelCandidateRelevantForQuery,
  isSameHotelByCityAndDoorPlate,
  matchCtripHotelListCandidateText,
  normalizeHotelSearchKeywords,
  parseAliHotelMainRatesText,
  parseCtripHotelMainRatesText,
  parseDurationMinutes,
  parseQingmaoHotelCandidatesText,
  parseQingmaoHotelMainRatesText,
  parseQingmaoFlightCandidateText,
  parseQingmaoInternationalFlightCandidatesText,
  readHotelCalibrationRatesFromText,
  resolveHotelCalibrationPlatformOrder,
  isHotelCalibrationSampleComplete,
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

  it("keeps ztrip random bed assignment rates when the room title names a bed type", () => {
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

  it("does not parse ztrip rates below the unmatched-products divider", () => {
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

  it("keeps random bed assignment text when the same rate block confirms the bed type", () => {
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

    expect(qingmaoRates[0]).toMatchObject({ roomType: "安心睡0压大床房", price: 280 });
    expect(ctripRates[0]).toMatchObject({ roomType: "安心睡0压大床房", price: 280 });
    expect(aliRates[0]).toMatchObject({ roomType: "安心睡0压大床房", price: 280 });
  });

  it("does not force a random-bed rate into a bed type when no bed signal exists", () => {
    const rates = parseCtripHotelMainRatesText(`如家商旅酒店
特惠房
到店随机分配床型
2份早餐
¥280
订`, "大床有早餐");

    expect(rates).toEqual([]);
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

    expect(keywords.slice(0, 4)).toEqual([
      "如家商旅酒店(广州永庆坊荔湾湖公园店)",
      "黄沙大道144号",
      "如家黄沙大道",
      "如家黄沙大道144号"
    ]);
    expect(keywords.indexOf("如家黄沙大道144号")).toBeLessThan(keywords.indexOf("如家商旅"));
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
      detailScreenshotPath: "/tmp/alibtrip-keyword-01-detail.png"
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
    const keywords = buildCtripHotelSearchKeywords(candidate);
    const url = new URL(buildStrictCtripHotelSearchUrl(query, keywords[0]));

    expect(keywords.slice(0, 4)).toEqual([
      "如家商旅酒店(广州珠江新城杨箕东地铁站店)",
      "珠江新城杨箕东",
      "珠江新城",
      "杨箕东"
    ]);
    expect(keywords.indexOf("广州大道中301号")).toBeGreaterThan(3);
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

  it("uses the full hotel name as the ctrip single-diagnosis suggestion keyword", () => {
    const candidate = {
      hotelName: "如家商旅酒店(广州永庆坊荔湾湖公园店)",
      level: "舒适型",
      score: "4.7",
      area: "",
      address: "荔湾区黄沙大道144号",
      price: 264,
      rawText: ""
    };

    expect(buildCtripHotelSuggestionKeywords(candidate)).toEqual(["如家商旅酒店(广州永庆坊荔湾湖公园店)"]);
    expect(buildCtripHotelSuggestionKeywords(candidate)).not.toContain("黄沙大道144号");
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
    expect(
      isSameHotelByCityAndDoorPlate(
        "广州",
        "荔湾区黄沙大道144号",
        "如家商旅酒店(广州中山八地铁站店) 广州市荔湾区中山八路12号 大床房 2份早餐 ¥299"
      )
    ).toBe(false);
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
