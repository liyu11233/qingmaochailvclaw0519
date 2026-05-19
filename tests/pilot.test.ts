import { describe, expect, it } from "vitest";
import {
  classifyProbeOutcome,
  extractSameFlightQuoteFromText,
  parseDurationMinutes,
  parseQingmaoFlightCandidateText,
  parseQingmaoInternationalFlightCandidatesText
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

  it("does not take the previous flight price when matching a same-flight quote", () => {
    const quote = extractSameFlightQuoteFromText(
      "CZ3586 22:00 白云T2 00:20 浦东T2 订票 ¥720 经济舱3.4折 南方航空 CZ3523 波音777 08:00 白云T2 10:20 虹桥T2 订票 ¥730 经济舱3.5折",
      "CZ3523"
    );

    expect(quote).toMatchObject({ status: "available", price: 730 });
  });
});
