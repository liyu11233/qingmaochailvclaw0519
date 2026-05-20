import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app";
import { createPlaywrightPilotCollector } from "../server/collectors/pilot";
import { buildFakeBatch } from "../src/domain/fakeBatch";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

describe("management API", () => {
  async function createTempOutputDir() {
    return fsp.mkdtemp(path.join(os.tmpdir(), "qingmao-api-test-"));
  }

  async function exportTestSalesSnapshot(batch: ReturnType<typeof buildFakeBatch>, outputDir: string) {
    await fsp.mkdir(outputDir, { recursive: true });
    const filename = `青猫差旅销售长截图-${batch.id}.png`;
    const snapshotPath = path.join(outputDir, filename);
    await fsp.writeFile(snapshotPath, ONE_PIXEL_PNG);
    return { path: snapshotPath, filename };
  }

  function createTestApp(options: Parameters<typeof createApp>[0] = {}) {
    return createApp({
      ...options,
      exporters: {
        ...options.exporters,
        salesSnapshot: exportTestSalesSnapshot
      }
    });
  }

  it("starts empty, creates a fake collection batch, and exposes export links", async () => {
    const app = createTestApp({ outputDir: await createTempOutputDir() });

    const initialStatus = await request(app).get("/api/status").expect(200);
    expect(initialStatus.body.hasBatch).toBe(false);

    const collect = await request(app).post("/api/collect").expect(200);
    expect(collect.body.batch.sampleCount).toBe(20);
    expect(collect.body.batch.status).toBe("ready");
    expect(collect.body.artifacts.excel).toMatch(/^\/outputs\//);
    expect(collect.body.artifacts.excel).toMatch(/\.xlsx$/);
    expect(collect.body.artifacts.salesSnapshot).toMatch(/^\/outputs\//);
    expect(collect.body.artifacts.salesSnapshot).toMatch(/\.png$/);

    const latest = await request(app).get("/api/batch/latest").expect(200);
    expect(latest.body.batch.samples).toHaveLength(20);

    const status = await request(app).get("/api/status").expect(200);
    expect(status.body.hasBatch).toBe(true);
    expect(status.body.successCount).toBe(20);
    expect(status.body.failedCount).toBe(0);
  });

  it("restores the latest persisted batch after the server restarts", async () => {
    const outputDir = await fsp.mkdtemp(path.join(os.tmpdir(), "qingmao-persisted-state-"));
    const app = createTestApp({ outputDir });

    const collect = await request(app).post("/api/collect").expect(200);
    const restartedApp = createTestApp({ outputDir });
    const restoredStatus = await request(restartedApp).get("/api/status").expect(200);

    expect(restoredStatus.body.hasBatch).toBe(true);
    expect(restoredStatus.body.batchId).toBe(collect.body.batch.id);
    expect(restoredStatus.body.sampleCount).toBe(20);
    expect(restoredStatus.body.artifacts.excel).toMatch(/\.xlsx$/);
    expect(restoredStatus.body.artifacts.salesSnapshot).toMatch(/\.png$/);
  });

  it("exposes a separate one-route real collection pilot flow", async () => {
    const pilotCollector = {
      getStatus: vi.fn(() => ({
        status: "idle",
        route: { scope: "国内", origin: "广州", destination: "上海", travelDate: "2026-05-21" },
        profileDir: "/tmp/qingmao-browser-profile",
        platforms: [
          { platform: "青猫差旅", loginUrl: "", configured: false },
          { platform: "携程商旅", loginUrl: "https://ct.ctrip.com/", configured: true },
          { platform: "阿里商旅", loginUrl: "https://www.alibtrip.com/alibtrip", configured: true }
        ],
        updatedAt: null,
        message: "等待打开登录浏览器"
      })),
      getQingmaoCandidateStatus: vi.fn(() => ({
        status: "idle",
        route: { scope: "国内", origin: "广州", destination: "上海", travelDate: "2026-05-21" },
        candidates: [],
        totalFlights: null,
        updatedAt: null,
        message: "等待读取青猫航班候选池"
      })),
      getSameFlightComparisonStatus: vi.fn(() => ({
        status: "idle",
        route: { scope: "国内", origin: "广州", destination: "上海", travelDate: "2026-05-21" },
        selectedFlight: null,
        quotes: [],
        updatedAt: null,
        message: "等待随机抽取同航班并查询竞品"
      })),
      openLoginSession: vi.fn(async () => ({
        status: "login-browser-open",
        route: { scope: "国内", origin: "广州", destination: "上海", travelDate: "2026-05-21" },
        profileDir: "/tmp/qingmao-browser-profile",
        platforms: [
          { platform: "青猫差旅", loginUrl: "", configured: false, outcome: "needs-config", note: "请配置青猫差旅入口地址" },
          { platform: "携程商旅", loginUrl: "https://ct.ctrip.com/", configured: true, outcome: "opened", note: "已打开登录页" },
          { platform: "阿里商旅", loginUrl: "https://www.alibtrip.com/alibtrip", configured: true, outcome: "opened", note: "已打开登录页" }
        ],
        updatedAt: "2026-05-18T10:00:00.000Z",
        message: "请在弹出的浏览器中完成三平台人工登录"
      })),
      runSilentProbe: vi.fn(async () => ({
        status: "completed",
        route: { scope: "国内", origin: "广州", destination: "上海", travelDate: "2026-05-21" },
        profileDir: "/tmp/qingmao-browser-profile",
        platforms: [
          { platform: "青猫差旅", configured: false, outcome: "needs-config", note: "请配置青猫差旅入口地址" },
          {
            platform: "携程商旅",
            loginUrl: "https://ct.ctrip.com/",
            configured: true,
            outcome: "reachable",
            note: "后台页面可访问",
            screenshotPath: "/tmp/ctrip.png"
          },
          {
            platform: "阿里商旅",
            loginUrl: "https://www.alibtrip.com/alibtrip",
            configured: true,
            outcome: "reachable",
            note: "后台页面可访问",
            screenshotPath: "/tmp/ali.png"
          }
        ],
        updatedAt: "2026-05-18T10:01:00.000Z",
        message: "后台静默探测完成"
      })),
      runAttachedProbe: vi.fn(async () => ({
        status: "completed",
        route: { scope: "国内", origin: "广州", destination: "上海", travelDate: "2026-05-21" },
        profileDir: "/tmp/qingmao-browser-profile",
        platforms: [
          { platform: "青猫差旅", configured: true, outcome: "reachable", note: "已附着到登录窗口", screenshotPath: "/tmp/qingmao.png" },
          { platform: "携程商旅", configured: true, outcome: "reachable", note: "已附着到登录窗口", screenshotPath: "/tmp/ctrip.png" },
          { platform: "阿里商旅", configured: true, outcome: "reachable", note: "已附着到登录窗口", screenshotPath: "/tmp/ali.png" }
        ],
        updatedAt: "2026-05-18T10:02:00.000Z",
        message: "附着探测完成"
      })),
      runQingmaoCandidateProbe: vi.fn(async () => ({
        status: "completed",
        route: { scope: "国内", origin: "广州", destination: "上海", travelDate: "2026-05-21" },
        candidates: [
          {
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
            shared: false,
            rawText: "春秋9C8930空客321(中)06:45广州白云T32小时25分09:10上海虹桥T1有餐食￥370起经济舱1.6折选择"
          }
        ],
        totalFlights: 92,
        screenshotPath: "/tmp/qingmao-candidates.png",
        updatedAt: "2026-05-18T10:03:00.000Z",
        message: "已读取青猫差旅 1 条候选航班"
      })),
      runSameFlightComparisonProbe: vi.fn(async () => ({
        status: "completed",
        route: { scope: "国内", origin: "广州", destination: "上海", travelDate: "2026-05-21" },
        selectedFlight: {
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
          shared: false,
          rawText: "春秋9C8930空客321(中)06:45广州白云T32小时25分09:10上海虹桥T1有餐食￥370起经济舱1.6折选择"
        },
        quotes: [
          { platform: "青猫差旅", status: "available", price: 370, screenshotPath: "/tmp/qingmao-candidates.png" },
          { platform: "携程商旅", status: "available", price: 370, screenshotPath: "/tmp/ctrip-same-flight.png" },
          { platform: "阿里商旅", status: "available", price: 480, screenshotPath: "/tmp/ali-same-flight.png" }
        ],
        updatedAt: "2026-05-18T10:04:00.000Z",
        message: "已随机抽取 9C8930，并完成三平台同航班价格读取"
      })),
      runDomesticBatchCollection: vi.fn(async () => ({
        id: "batch-2026-05-18-100500-real-domestic",
        status: "ready",
        generatedAt: "2026-05-18T10:05:00.000Z",
        sampleCount: 1,
        successCount: 1,
        failedCount: 0,
        samples: [
          {
            id: "real-domestic-01",
            routeId: "dom-01",
            scope: "国内",
            origin: "广州",
            destination: "上海",
            travelDate: "2026-05-21",
            flightNo: "9C8930",
            airline: "春秋",
            cabin: "经济舱",
            directType: "直飞",
            transferCity: "",
            durationMinutes: 145,
            quotes: [
              {
                platform: "青猫差旅",
                price: 370,
                refundRule: "以平台页面展示及航司规则为准",
                baggageRule: "以平台页面展示及航司规则为准",
                available: true,
                status: "可订",
                evidencePath: "screenshots/batch-2026-05-18-100500-real-domestic/real-domestic-01-qingmao.png",
                sourceUrl: ""
              },
              {
                platform: "携程商旅",
                price: 370,
                refundRule: "以平台页面展示及航司规则为准",
                baggageRule: "以平台页面展示及航司规则为准",
                available: true,
                status: "可订",
                evidencePath: "screenshots/batch-2026-05-18-100500-real-domestic/real-domestic-01-ctrip.png",
                sourceUrl: "https://ct.ctrip.com/corp-flight-booking/list"
              },
              {
                platform: "阿里商旅",
                price: 480,
                refundRule: "以平台页面展示及航司规则为准",
                baggageRule: "以平台页面展示及航司规则为准",
                available: true,
                status: "可订",
                evidencePath: "screenshots/batch-2026-05-18-100500-real-domestic/real-domestic-01-alibtrip.png",
                sourceUrl: "https://travel.alibtrip.com/flight-2025#/search-list"
              }
            ]
          }
        ]
      })),
      runInternationalBatchCollection: vi.fn(async () => ({
        id: "batch-2026-05-18-100700-real-international",
        status: "ready",
        generatedAt: "2026-05-18T10:07:00.000Z",
        sampleCount: 1,
        successCount: 1,
        failedCount: 0,
        samples: [
          {
            id: "real-international-01",
            routeId: "intl-01",
            scope: "国际",
            origin: "广州",
            destination: "曼谷",
            travelDate: "2026-05-21",
            flightNo: "CZ8079",
            airline: "南方航空",
            cabin: "经济舱",
            directType: "直飞",
            transferCity: "",
            durationMinutes: 180,
            quotes: [
              {
                platform: "青猫差旅",
                price: 1528,
                refundRule: "以平台页面展示及航司规则为准",
                baggageRule: "以平台页面展示及航司规则为准",
                available: true,
                status: "可订",
                evidencePath: "screenshots/batch-2026-05-18-100700-real-international/real-international-01-qingmao.png",
                sourceUrl: ""
              },
              {
                platform: "携程商旅",
                price: 1530,
                refundRule: "以平台页面展示及航司规则为准",
                baggageRule: "以平台页面展示及航司规则为准",
                available: true,
                status: "可订",
                evidencePath: "screenshots/batch-2026-05-18-100700-real-international/real-international-01-ctrip.png",
                sourceUrl: "https://ct.ctrip.com/corp-flight-booking/list"
              },
              {
                platform: "阿里商旅",
                price: 1528,
                refundRule: "以平台页面展示及航司规则为准",
                baggageRule: "以平台页面展示及航司规则为准",
                available: true,
                status: "可订",
                evidencePath: "screenshots/batch-2026-05-18-100700-real-international/real-international-01-alibtrip.png",
                sourceUrl: "https://travel.alibtrip.com/flight-2025#/search-list"
              }
            ]
          }
        ]
      })),
      runFullBatchCollection: vi.fn(async () => ({
        id: "batch-2026-05-18-100800-real-full",
        status: "ready",
        generatedAt: "2026-05-18T10:08:00.000Z",
        sampleCount: 2,
        successCount: 2,
        failedCount: 0,
        samples: [
          {
            id: "real-full-01",
            routeId: "dom-01",
            scope: "国内",
            origin: "广州",
            destination: "上海",
            travelDate: "2026-05-21",
            flightNo: "9C8930",
            airline: "春秋",
            cabin: "经济舱",
            directType: "直飞",
            transferCity: "",
            durationMinutes: 145,
            quotes: [
              {
                platform: "青猫差旅",
                price: 370,
                refundRule: "以平台页面展示及航司规则为准",
                baggageRule: "以平台页面展示及航司规则为准",
                available: true,
                status: "可订",
                evidencePath: "screenshots/batch-2026-05-18-100800-real-full/real-domestic-01-qingmao.png",
                sourceUrl: ""
              },
              {
                platform: "携程商旅",
                price: 370,
                refundRule: "以平台页面展示及航司规则为准",
                baggageRule: "以平台页面展示及航司规则为准",
                available: true,
                status: "可订",
                evidencePath: "screenshots/batch-2026-05-18-100800-real-full/real-domestic-01-ctrip.png",
                sourceUrl: "https://ct.ctrip.com/corp-flight-booking/list"
              },
              {
                platform: "阿里商旅",
                price: 480,
                refundRule: "以平台页面展示及航司规则为准",
                baggageRule: "以平台页面展示及航司规则为准",
                available: true,
                status: "可订",
                evidencePath: "screenshots/batch-2026-05-18-100800-real-full/real-domestic-01-alibtrip.png",
                sourceUrl: "https://travel.alibtrip.com/flight-2025#/search-list"
              }
            ]
          },
          {
            id: "real-full-02",
            routeId: "intl-01",
            scope: "国际",
            origin: "广州",
            destination: "曼谷",
            travelDate: "2026-05-21",
            flightNo: "CZ8079",
            airline: "南方航空",
            cabin: "经济舱",
            directType: "直飞",
            transferCity: "",
            durationMinutes: 180,
            quotes: [
              {
                platform: "青猫差旅",
                price: 1528,
                refundRule: "以平台页面展示及航司规则为准",
                baggageRule: "以平台页面展示及航司规则为准",
                available: true,
                status: "可订",
                evidencePath: "screenshots/batch-2026-05-18-100800-real-full/real-international-01-qingmao.png",
                sourceUrl: ""
              },
              {
                platform: "携程商旅",
                price: 1530,
                refundRule: "以平台页面展示及航司规则为准",
                baggageRule: "以平台页面展示及航司规则为准",
                available: true,
                status: "可订",
                evidencePath: "screenshots/batch-2026-05-18-100800-real-full/real-international-01-ctrip.png",
                sourceUrl: "https://ct.ctrip.com/corp-flight-booking/list"
              },
              {
                platform: "阿里商旅",
                price: 1528,
                refundRule: "以平台页面展示及航司规则为准",
                baggageRule: "以平台页面展示及航司规则为准",
                available: true,
                status: "可订",
                evidencePath: "screenshots/batch-2026-05-18-100800-real-full/real-international-01-alibtrip.png",
                sourceUrl: "https://travel.alibtrip.com/flight-2025#/search-list"
              }
            ]
          }
        ]
      }))
    };
    const app = createTestApp({ outputDir: await createTempOutputDir(), pilotCollector } as never);

    const initial = await request(app).get("/api/pilot/status").expect(200);
    expect(initial.body.status).toBe("idle");
    expect(initial.body.route).toMatchObject({ origin: "广州", destination: "上海" });

    const login = await request(app).post("/api/pilot/open-login").expect(200);
    expect(login.body.status).toBe("login-browser-open");
    expect(login.body.platforms.find((platform: { platform: string }) => platform.platform === "青猫差旅")).toMatchObject({
      outcome: "needs-config"
    });

    const probe = await request(app).post("/api/pilot/run-silent-probe").expect(200);
    expect(probe.body.status).toBe("completed");
    expect(probe.body.platforms).toHaveLength(3);
    expect(probe.body.platforms.find((platform: { platform: string }) => platform.platform === "携程商旅")).toMatchObject({
      outcome: "reachable",
      screenshotPath: "/tmp/ctrip.png"
    });

    const attached = await request(app).post("/api/pilot/run-attached-probe").expect(200);
    expect(attached.body.status).toBe("completed");
    expect(attached.body.platforms.find((platform: { platform: string }) => platform.platform === "阿里商旅")).toMatchObject({
      outcome: "reachable",
      screenshotPath: "/tmp/ali.png"
    });

    const qingmaoCandidateStatus = await request(app).get("/api/pilot/qingmao-candidates/status").expect(200);
    expect(qingmaoCandidateStatus.body.status).toBe("idle");

    const qingmaoCandidates = await request(app).post("/api/pilot/qingmao-candidates/run").expect(200);
    expect(qingmaoCandidates.body.status).toBe("completed");
    expect(qingmaoCandidates.body.totalFlights).toBe(92);
    expect(qingmaoCandidates.body.candidates[0]).toMatchObject({
      flightNo: "9C8930",
      price: 370
    });

    const sameFlightStatus = await request(app).get("/api/pilot/same-flight/status").expect(200);
    expect(sameFlightStatus.body.status).toBe("idle");

    const sameFlight = await request(app).post("/api/pilot/same-flight/run").expect(200);
    expect(sameFlight.body.status).toBe("completed");
    expect(sameFlight.body.selectedFlight).toMatchObject({ flightNo: "9C8930" });
    expect(sameFlight.body.quotes).toHaveLength(3);
    expect(sameFlight.body.quotes.find((quote: { platform: string }) => quote.platform === "阿里商旅")).toMatchObject({
      status: "available",
      price: 480
    });

    const status = await request(app).get("/api/status").expect(200);
    expect(status.body.hasBatch).toBe(false);
    expect(pilotCollector.openLoginSession).toHaveBeenCalledTimes(1);
    expect(pilotCollector.runSilentProbe).toHaveBeenCalledTimes(1);
    expect(pilotCollector.runAttachedProbe).toHaveBeenCalledTimes(1);
    expect(pilotCollector.runQingmaoCandidateProbe).toHaveBeenCalledTimes(1);
    expect(pilotCollector.runSameFlightComparisonProbe).toHaveBeenCalledTimes(1);

    const realCollect = await request(app).post("/api/collect-real-domestic").send({ limit: 1 }).expect(200);
    expect(realCollect.body.batch.id).toContain("real-domestic");
    expect(realCollect.body.batch.sampleCount).toBe(1);
    expect(realCollect.body.artifacts.excel).toMatch(/\.xlsx$/);
    expect(realCollect.body.artifacts.salesSnapshot).toMatch(/\.png$/);
    expect(pilotCollector.runDomesticBatchCollection).toHaveBeenCalledWith(1);

    const realInternationalCollect = await request(app).post("/api/collect-real-international").send({ limit: 1 }).expect(200);
    expect(realInternationalCollect.body.batch.id).toContain("real-international");
    expect(realInternationalCollect.body.batch.sampleCount).toBe(1);
    expect(realInternationalCollect.body.artifacts.excel).toMatch(/\.xlsx$/);
    expect(realInternationalCollect.body.artifacts.salesSnapshot).toMatch(/\.png$/);
    expect(pilotCollector.runInternationalBatchCollection).toHaveBeenCalledWith(1);

    const realFullCollect = await request(app).post("/api/collect-real-full").expect(200);
    expect(realFullCollect.body.batch.id).toContain("real-full");
    expect(realFullCollect.body.batch.sampleCount).toBe(2);
    expect(realFullCollect.body.artifacts.excel).toMatch(/\.xlsx$/);
    expect(realFullCollect.body.artifacts.salesSnapshot).toMatch(/\.png$/);
    expect(pilotCollector.runFullBatchCollection).toHaveBeenCalledTimes(1);
  });

  it("opens all configured platform login urls in the manual login browser profile", async () => {
    const opened: Array<{ profileDir: string; urls: string[]; debuggingPort: number }> = [];
    const pilotCollector = createPlaywrightPilotCollector({
      profileDir: "/tmp/qingmao-browser-profile",
      artifactDir: "/tmp/qingmao-pilot",
      now: () => new Date("2026-05-18T10:00:00+08:00"),
      remoteDebuggingPort: 9223,
      openLoginWindow: async (profileDir, urls, debuggingPort) => {
        opened.push({ profileDir, urls, debuggingPort });
      }
    });

    const status = pilotCollector.getStatus();
    expect(status.platforms).toEqual([
      { platform: "青猫差旅", loginUrl: "https://booking.tmctrip.com/TravelBooking", configured: true },
      { platform: "携程商旅", loginUrl: "https://ct.ctrip.com/login", configured: true },
      { platform: "阿里商旅", loginUrl: "https://travel.alibtrip.com/index.html#/login", configured: true }
    ]);

    const login = await pilotCollector.openLoginSession();
    expect(login.status).toBe("login-browser-open");
    expect(login.platforms.map((platform) => platform.outcome)).toEqual(["opened", "opened", "opened"]);
    expect(opened).toEqual([
      {
        profileDir: "/tmp/qingmao-browser-profile",
        urls: [
          "https://booking.tmctrip.com/TravelBooking",
          "https://ct.ctrip.com/login",
          "https://travel.alibtrip.com/index.html#/login"
        ],
        debuggingPort: 9223
      }
    ]);
  });

  it("blocks probe actions while a full real collection is running", async () => {
    let markFullStarted!: () => void;
    let resolveFull!: (batch: ReturnType<typeof buildFakeBatch>) => void;
    const fullStarted = new Promise<void>((resolve) => {
      markFullStarted = resolve;
    });
    const idlePilot = {
      status: "idle",
      route: { scope: "国内", origin: "广州", destination: "上海", travelDate: "2026-05-21" },
      profileDir: "/tmp/qingmao-browser-profile",
      platforms: [
        { platform: "青猫差旅", loginUrl: "https://booking.tmctrip.com/TravelBooking", configured: true },
        { platform: "携程商旅", loginUrl: "https://ct.ctrip.com/login", configured: true },
        { platform: "阿里商旅", loginUrl: "https://travel.alibtrip.com/index.html#/login", configured: true }
      ],
      updatedAt: null,
      message: "等待打开登录浏览器"
    };
    const pilotCollector = {
      getStatus: vi.fn(() => idlePilot),
      getQingmaoCandidateStatus: vi.fn(() => ({
        status: "idle",
        route: { scope: "国内", origin: "广州", destination: "上海", travelDate: "2026-05-21" },
        candidates: [],
        totalFlights: null,
        updatedAt: null,
        message: "等待读取青猫航班候选池"
      })),
      getSameFlightComparisonStatus: vi.fn(() => ({
        status: "idle",
        route: { scope: "国内", origin: "广州", destination: "上海", travelDate: "2026-05-21" },
        selectedFlight: null,
        quotes: [],
        updatedAt: null,
        message: "等待随机抽取同航班并查询竞品"
      })),
      openLoginSession: vi.fn(),
      runSilentProbe: vi.fn(async () => idlePilot),
      runAttachedProbe: vi.fn(),
      runQingmaoCandidateProbe: vi.fn(),
      runSameFlightComparisonProbe: vi.fn(),
      runDomesticBatchCollection: vi.fn(),
      runInternationalBatchCollection: vi.fn(),
      runFullBatchCollection: vi.fn(async () => {
        markFullStarted();
        return await new Promise<ReturnType<typeof buildFakeBatch>>((resolve) => {
          resolveFull = resolve;
        });
      })
    };
    const app = createTestApp({ outputDir: "/tmp/qingmao-api-concurrency-test", pilotCollector } as never);

    const fullRequest = new Promise<void>((resolve, reject) => {
      request(app)
        .post("/api/collect-real-full")
        .expect(200)
        .end((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
    });
    await fullStarted;

    const blockedProbe = await request(app).post("/api/pilot/run-silent-probe").expect(409);
    expect(blockedProbe.body.error).toContain("正在完整真实采集");
    expect(pilotCollector.runSilentProbe).not.toHaveBeenCalled();

    const statusDuringCollection = await request(app).get("/api/status").expect(200);
    expect(statusDuringCollection.body.activeOperation).toMatchObject({ label: "完整真实采集" });

    resolveFull(buildFakeBatch(new Date("2026-05-18T10:00:00+08:00")));
    await fullRequest;

    const statusAfterCollection = await request(app).get("/api/status").expect(200);
    expect(statusAfterCollection.body.activeOperation).toBeNull();
  });
});
