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

  async function exportTestOfflinePackage(batch: ReturnType<typeof buildFakeBatch>, outputDir: string) {
    await fsp.mkdir(outputDir, { recursive: true });
    const filename = `青猫差旅离线网页包-${batch.id}.zip`;
    const packagePath = path.join(outputDir, filename);
    await fsp.writeFile(packagePath, ONE_PIXEL_PNG);
    return { path: packagePath, filename, directory: outputDir };
  }

  async function exportTestWorkbook(batch: ReturnType<typeof buildFakeBatch>, outputDir: string) {
    await fsp.mkdir(outputDir, { recursive: true });
    const filename = `青猫差旅一体化比价-${batch.id}.xlsx`;
    const workbookPath = path.join(outputDir, filename);
    await fsp.writeFile(workbookPath, Buffer.from("test workbook"));
    return { path: workbookPath, filename, sheets: ["总览页"] };
  }

  function createTestApp(options: Parameters<typeof createApp>[0] = {}) {
    return createApp({
      ...options,
      exporters: {
        ...options.exporters,
        workbook: exportTestWorkbook,
        offlinePackage: exportTestOfflinePackage
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
    expect(collect.body.artifacts.offlinePackage).toMatch(/^\/outputs\//);
    expect(collect.body.artifacts.offlinePackage).toMatch(/\.zip$/);

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
    expect(restoredStatus.body.artifacts.offlinePackage).toMatch(/\.zip$/);
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
      getQingmaoHotelCandidateStatus: vi.fn(() => ({
        status: "idle",
        query: { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-21", checkOutDate: "2026-05-22", nights: 1 },
        candidates: [],
        selectedCandidate: null,
        totalHotels: null,
        updatedAt: null,
        message: "等待读取青猫酒店候选池"
      })),
      getHotelMainRateStatus: vi.fn(() => ({
        status: "idle",
        query: { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-21", checkOutDate: "2026-05-22", nights: 1 },
        selectedCandidate: null,
        quotes: [],
        updatedAt: null,
        message: "等待验证酒店当前口径大床有早餐"
      })),
      getHotelGroupMainRateStatus: vi.fn(() => ({
        status: "idle",
        samples: [],
        updatedAt: null,
        message: "等待验证每个集团 1 家酒店主口径"
      })),
      getHotelSmallBatchStatus: vi.fn(() => ({
        status: "idle",
        city: "广州",
        targetTotal: 10,
        targetPerGroup: 2,
        mainRatePlan: "大床有早餐",
        completedCount: 0,
        failedCount: 0,
        partialCount: 0,
        skippedCount: 0,
        unattemptedCount: 10,
        timeoutBudget: false,
        budget: {
          totalMs: 90 * 60 * 1000,
          perGroupMs: 18 * 60 * 1000,
          maxAttemptsPerGroup: 6
        },
        groups: [],
        updatedAt: null,
        message: "等待执行 10 家酒店小放量"
      })),
      getHotelScaleValidationStatus: vi.fn(() => ({
        status: "idle",
        mode: "scale-validation",
        targetTotal: 40,
        targetPerGroup: 8,
        mainRatePlan: "大床有早餐",
        checkInDate: "2026-05-25",
        checkOutDate: "2026-05-26",
        nights: 1,
        budget: {
          totalMs: 120 * 60 * 1000,
          perGroupMs: 25 * 60 * 1000,
          maxAttemptsPerGroup: 24
        },
        platformOrder: ["青猫差旅", "阿里商旅", "在途商旅", "携程商旅"],
        cityPool: ["北京", "广州", "杭州", "上海", "深圳", "武汉", "佛山", "成都", "厦门"],
        groups: [],
        completedCount: 0,
        failedCount: 0,
        partialCount: 0,
        skippedCount: 0,
        timeoutCount: 0,
        unattemptedCount: 40,
        evidenceCompleteCount: 0,
        evidenceMissingCount: 0,
        evidenceSaveFailedCount: 0,
        evidenceCompleteRate: 0,
        timeoutBudget: false,
        timing: {
          platforms: [],
          steps: [],
          slowestSteps: [],
          timeoutSamples: []
        },
        updatedAt: null,
        message: "等待执行 40 家酒店放量验证 / 准生产诊断跑"
      })),
      getHotelSingleDiagnosisStatus: vi.fn(() => ({
        status: "idle",
        input: null,
        selectedCandidate: null,
        platforms: [],
        updatedAt: null,
        message: "等待严格单酒店诊断"
      })),
      getHotelSingleAllRatePlansStatus: vi.fn(() => ({
        status: "idle",
        mode: "single-all-rate-plans",
        input: null,
        query: null,
        selectedCandidate: null,
        sourceHotel: null,
        platformOrder: ["青猫差旅", "携程商旅", "阿里商旅", "在途商旅"],
        platforms: [],
        completeRatePlans: [],
        updatedAt: null,
        message: "等待指定单酒店一次性四口径复验"
      })),
      getAliHotelSingleVerifyStatus: vi.fn(() => ({
        status: "idle",
        input: null,
        selectedCandidate: null,
        result: null,
        updatedAt: null,
        message: "等待指定酒店阿里-only复验"
      })),
      getAliHotelMatchStatus: vi.fn(() => ({
        status: "idle",
        samples: [],
        updatedAt: null,
        message: "等待验证阿里商旅同店匹配"
      })),
      getHotelRatePlanProbeStatus: vi.fn(() => ({
        status: "idle",
        plans: [],
        recommendedRatePlan: null,
        updatedAt: null,
        message: "等待验证酒店 4 个房型早餐口径完整率"
      })),
      getHotelAllRatePlanStatus: vi.fn(() => ({
        status: "idle",
        query: { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-21", checkOutDate: "2026-05-22", nights: 1 },
        selectedCandidate: null,
        samples: [],
        updatedAt: null,
        message: "等待选择青猫候选酒店并采集四平台四口径"
      })),
      getHotelCalibrationStatus: vi.fn(() => ({
        status: "idle",
        mode: "calibration",
        limit: 3,
        mainRatePlan: "大床有早餐",
        platformOrder: ["青猫差旅", "阿里商旅", "在途商旅", "携程商旅"],
        query: { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-21", checkOutDate: "2026-05-22", nights: 1 },
        samples: [],
        updatedAt: null,
        message: "等待执行 3 家酒店校准测试"
      })),
      getSameFlightComparisonStatus: vi.fn(() => ({
        status: "idle",
        route: { scope: "国内", origin: "广州", destination: "上海", travelDate: "2026-05-21" },
        selectedFlight: null,
        quotes: [],
        updatedAt: null,
        message: "等待随机抽取同航班并查询竞品"
      })),
      getZtripStatus: vi.fn(() => ({
        status: "idle",
        loginUrl: "https://www.z-trip.cn/v/vcommon/home",
        checks: [],
        updatedAt: null,
        message: "等待验证在途商旅"
      })),
      getZtripFlightStatus: vi.fn(() => ({
        status: "idle",
        route: { scope: "国内", origin: "广州", destination: "上海", travelDate: "2026-05-21" },
        selectedFlight: null,
        candidates: [],
        totalFlights: null,
        updatedAt: null,
        message: "等待采集在途商旅航班样本"
      })),
      getZtripHotelStatus: vi.fn(() => ({
        status: "idle",
        query: { city: "广州", checkInDate: "2026-05-21", checkOutDate: "2026-05-22", nights: 1 },
        selectedRate: null,
        rates: [],
        updatedAt: null,
        message: "等待采集在途商旅酒店样本"
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
      runQingmaoHotelCandidateProbe: vi.fn(async () => ({
        status: "completed",
        query: { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-21", checkOutDate: "2026-05-22", nights: 1 },
        candidates: [
          {
            hotelName: "如家商旅酒店(广州白云山京溪南方医院地铁站店)",
            level: "舒适型",
            score: "4.7",
            area: "距市中心直线9.2公里·白云同和/龙洞地区·白云区",
            address: "白云区广州大道北1420号",
            price: 228,
            rawText: "如家商旅酒店(广州白云山京溪南方医院地铁站店) 舒适型 ￥ 228 起 查看详情"
          }
        ],
        selectedCandidate: {
          hotelName: "如家商旅酒店(广州白云山京溪南方医院地铁站店)",
          level: "舒适型",
          score: "4.7",
          area: "距市中心直线9.2公里·白云同和/龙洞地区·白云区",
          address: "白云区广州大道北1420号",
          price: 228,
          rawText: "如家商旅酒店(广州白云山京溪南方医院地铁站店) 舒适型 ￥ 228 起 查看详情"
        },
        totalHotels: 9,
        finalUrl: "https://booking.tmctrip.com/TravelBooking",
        screenshotPath: "/tmp/qingmao-hotel-candidates.png",
        updatedAt: "2026-05-18T10:03:30.000Z",
        message: "已读取青猫酒店候选池：广州 / 如家商旅，共 9 家，解析 1 家"
      })),
      runHotelMainRateProbe: vi.fn(async () => ({
        status: "partial",
        query: { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-21", checkOutDate: "2026-05-22", nights: 1 },
        selectedCandidate: {
          hotelName: "如家商旅酒店(广州天河东圃科学城珠吉店)",
          level: "舒适型",
          score: "4.8",
          area: "距市中心直线17.2公里·奥体中心/国际金融城·天河区",
          address: "天河区珠村东横三路1号",
          price: 252,
          rawText: "如家商旅酒店(广州天河东圃科学城珠吉店) 舒适型 ￥ 252 起 查看详情"
        },
        quotes: [
          {
            platform: "青猫差旅",
            status: "available",
            price: 222,
            hotelName: "如家商旅酒店(广州天河东圃科学城珠吉店)",
            roomType: "大床房",
            ratePlan: "大床有早餐",
            screenshotPath: "/tmp/qingmao-hotel-main-rate.png",
            rawText: "大床房 2份早餐 ￥ 222 起"
          },
          { platform: "携程商旅", status: "pending", price: null, hotelName: "如家商旅酒店(广州天河东圃科学城珠吉店)", roomType: "", ratePlan: "大床有早餐", error: "酒店同店同口径匹配尚未接入" },
          { platform: "阿里商旅", status: "pending", price: null, hotelName: "如家商旅酒店(广州天河东圃科学城珠吉店)", roomType: "", ratePlan: "大床有早餐", error: "酒店同店同口径匹配尚未接入" },
          {
            platform: "在途商旅",
            status: "available",
            price: 213,
            hotelName: "如家商旅酒店(广州天河东圃科学城珠吉店)",
            roomType: "高级大床房",
            ratePlan: "大床有早餐",
            screenshotPath: "/tmp/ztrip-hotel-main-rate.png",
            rawText: "高级大床房 2份早餐 CNY 213"
          }
        ],
        updatedAt: "2026-05-18T10:03:40.000Z",
        message: "已找到青猫酒店主口径锚点"
      })),
      runHotelGroupMainRateProbe: vi.fn(async () => ({
        status: "completed",
        samples: [
          {
            group: "首旅如家",
            query: { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-21", checkOutDate: "2026-05-22", nights: 1 },
            status: "completed",
            selectedCandidate: {
              hotelName: "如家商旅酒店(广州天河东圃科学城珠吉店)",
              level: "舒适型",
              score: "4.8",
              area: "距市中心直线17.2公里·奥体中心/国际金融城·天河区",
              address: "天河区珠村东横三路1号",
              price: 252,
              rawText: "如家商旅酒店(广州天河东圃科学城珠吉店) 舒适型 ￥ 252 起 查看详情"
            },
            quotes: [
              {
                platform: "青猫差旅",
                status: "available",
                price: 222,
                hotelName: "如家商旅酒店(广州天河东圃科学城珠吉店)",
                roomType: "大床房",
                ratePlan: "大床有早餐",
                screenshotPath: "/tmp/qingmao-group-main-rate.png",
                rawText: "大床房 2份早餐 ￥ 222 起"
              },
              {
                platform: "在途商旅",
                status: "available",
                price: 213,
                hotelName: "如家商旅酒店(广州天河东圃科学城珠吉店)",
                roomType: "高级大床房",
                ratePlan: "大床有早餐",
                screenshotPath: "/tmp/ztrip-group-main-rate.png",
                rawText: "高级大床房 2份早餐 CNY 213"
              }
            ],
            message: "已找到酒店主口径锚点"
          }
        ],
        updatedAt: "2026-05-18T10:03:50.000Z",
        message: "已完成每个集团 1 家酒店主口径验证：完整 1/1，部分 0/1"
      })),
      runHotelSingleDiagnosisProbe: vi.fn(async (input) => ({
        status: "completed",
        input,
        selectedCandidate: {
          hotelName: "如家商旅酒店(广州白云山京溪南方医院地铁站店)",
          level: "舒适型",
          score: "4.7",
          area: "白云同和/龙洞地区",
          address: "白云区广州大道北1420号",
          price: 228,
          rawText: "如家商旅酒店(广州白云山京溪南方医院地铁站店) ￥228 起"
        },
        platforms: [
          {
            platform: "青猫差旅",
            step: "success",
            sameHotel: true,
            matchBasis: "青猫候选源酒店",
            sourceDoorPlate: "广州大道北1420号",
            targetDoorPlate: "广州大道北1420号",
            durationMs: 1200,
            price: 240,
            screenshotPath: path.resolve("outputs/current/pilot/hotel-single-diagnosis/test-run/qingmao.png"),
            finalUrl: "https://booking.tmctrip.com/TravelBooking"
          },
          {
            platform: "携程商旅",
            step: "failed",
            sameHotel: false,
            matchBasis: "未匹配到同城市同门牌号",
            sourceDoorPlate: "广州大道北1420号",
            targetDoorPlate: "广州大道中301号",
            durationMs: 3400,
            price: null,
            error: "门牌号不一致",
            screenshotPath: path.resolve("outputs/current/pilot/hotel-single-diagnosis/test-run/ctrip.png"),
            finalUrl: "https://ct.ctrip.com/corp-hotel-booking/hotelList"
          }
        ],
        updatedAt: "2026-05-18T10:04:00.000Z",
        message: "严格单酒店诊断完成"
      })),
      runHotelSingleAllRatePlansProbe: vi.fn(async (input) => ({
        status: "partial",
        mode: "single-all-rate-plans",
        input,
        query: { ...input, nights: 1 },
        selectedCandidate: {
          hotelName: input.keyword,
          level: "舒适型",
          score: "4.8",
          area: input.city,
          address: "东城区北京站街8号",
          price: 520,
          rawText: `${input.keyword} 东城区北京站街8号`
        },
        sourceHotel: {
          hotelName: input.keyword,
          city: input.city,
          address: "东城区北京站街8号",
          doorPlate: "北京站街8号",
          rawText: `${input.keyword} 东城区北京站街8号`
        },
        platformOrder: ["青猫差旅", "携程商旅", "阿里商旅", "在途商旅"],
        platforms: ["青猫差旅", "携程商旅", "阿里商旅", "在途商旅"].map((platform, index) => ({
          platform,
          sameHotel: true,
          matchBasis: index === 0 ? "青猫候选源酒店" : "同城市同门牌号一致",
          platformHotelName: input.keyword,
          platformAddress: "东城区北京站街8号",
          platformDoorPlate: "北京站街8号",
          hasMainRate: true,
          mainRatePrice: 530 + index,
          otherRates: {
            大床无早餐: 500 + index,
            双床有早餐: index === 3 ? null : 560 + index,
            双床无早餐: 540 + index
          },
          ratePrices: {
            大床无早餐: 500 + index,
            大床有早餐: 530 + index,
            双床无早餐: 540 + index,
            双床有早餐: index === 3 ? null : 560 + index
          },
          durationMs: 1000 + index,
          failureType: index === 3 ? "competitor_no_main_rate" : null,
          failureReason: index === 3 ? "在途商旅未找到双床有早餐价格" : "",
          screenshotPath: path.resolve(`outputs/current/pilot/hotel-single-all-rate-plans/test-run/${index + 1}.png`),
          finalUrl: "https://example.com/hotel",
          pageTextSummary: "酒店详情 大床 双床 早餐 价格"
        })),
        completeRatePlans: ["大床无早餐", "大床有早餐", "双床无早餐"],
        artifactDir: path.resolve("outputs/current/pilot/hotel-single-all-rate-plans/test-run"),
        resultPath: path.resolve("outputs/current/pilot/hotel-single-all-rate-plans/test-run/result.json"),
        diagnosticReviewPath: path.resolve("outputs/current/pilot/hotel-single-all-rate-plans/test-run/diagnostic-review.html"),
        updatedAt: "2026-05-18T10:04:05.000Z",
        message: "指定单酒店一次性四口径复验完成：完整口径 3/4"
      })),
      runAliHotelSingleVerifyProbe: vi.fn(async (input) => ({
        status: "completed",
        input,
        selectedCandidate: {
          hotelName: input.hotelName,
          level: "",
          score: "",
          area: input.city,
          address: input.address,
          price: null,
          rawText: `${input.hotelName} ${input.address}`
        },
        result: {
          platform: "阿里商旅",
          status: "completed",
          sameHotel: true,
          mainRatePrice: 388,
          otherRates: {
            大床无早餐: null,
            双床有早餐: null,
            双床无早餐: null
          },
          failureType: null,
          failureReason: "",
          matchBasis: "阿里详情页城市和门牌号一致",
          sourceAddress: input.address,
          finalUrl: "https://travel.alibtrip.com/hotel-detail",
          screenshotPath: path.resolve("outputs/current/pilot/ali-hotel-single/test-run/alibtrip.png"),
          pageTextSummary: "大床有早餐 ¥388"
        },
        artifactDir: path.resolve("outputs/current/pilot/ali-hotel-single/test-run"),
        diagnosisPath: path.resolve("outputs/current/pilot/ali-hotel-single/test-run/alibtrip-list-diagnosis.json"),
        updatedAt: "2026-05-18T10:04:10.000Z",
        message: "阿里-only复验完成"
      })),
      runAliHotelMatchProbe: vi.fn(),
      runHotelRatePlanProbe: vi.fn(async () => ({
        status: "completed",
        plans: [
          {
            ratePlan: "大床有早餐",
            status: "completed",
            completedCount: 1,
            partialCount: 0,
            failedCount: 0,
            completeRate: 1,
            durationMs: 1000,
            samples: []
          },
          {
            ratePlan: "大床无早餐",
            status: "partial",
            completedCount: 0,
            partialCount: 1,
            failedCount: 0,
            completeRate: 0,
            durationMs: 900,
            samples: []
          }
        ],
        recommendedRatePlan: "大床有早餐",
        updatedAt: "2026-05-18T10:03:55.000Z",
        message: "口径探针完成：建议主口径为大床有早餐"
      })),
      runHotelAllRatePlanProbe: vi.fn(async () => ({
        status: "completed",
        query: { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-21", checkOutDate: "2026-05-22", nights: 1 },
        selectedCandidate: {
          hotelName: "如家商旅酒店(广州天河东圃科学城珠吉店)",
          level: "舒适型",
          score: "4.7",
          area: "天河区",
          address: "天河区珠吉路1号",
          price: 213,
          rawText: "如家商旅酒店"
        },
        samples: [],
        updatedAt: "2026-05-18T10:03:56.000Z",
        message: "四平台四口径采集完成：完整 4/4"
      })),
      runHotelCalibrationProbe: vi.fn(async (input: { checkInDate?: string; checkOutDate?: string; platforms?: string[] } = {}) => ({
        status: "partial",
        mode: "calibration",
        limit: 3,
        mainRatePlan: "大床有早餐",
        platformOrder: input.platforms?.length ? ["青猫差旅", ...input.platforms] : ["青猫差旅", "阿里商旅", "在途商旅", "携程商旅"],
        query: {
          city: "广州",
          keyword: "如家商旅",
          checkInDate: input.checkInDate ?? "2026-05-21",
          checkOutDate: input.checkOutDate ?? "2026-05-22",
          nights: 1
        },
        samples: Array.from({ length: 3 }, (_, index) => ({
          index: index + 1,
          status: index === 0 ? "completed" : "partial",
          sourceHotel: {
            hotelName: `如家商旅酒店${index + 1}`,
            city: "广州",
            address: `广州大道北142${index}号`,
            doorPlate: `广州大道北142${index}号`,
            rawText: `如家商旅酒店${index + 1}`
          },
          platforms: (input.platforms?.length ? ["青猫差旅", ...input.platforms] : ["青猫差旅", "阿里商旅", "在途商旅", "携程商旅"]).map((platform, platformIndex) => ({
            platform,
            sameHotel: platformIndex === 1 && index === 1 ? false : true,
            matchBasis: platformIndex === 1 && index === 1 ? "未匹配到同城市同门牌号" : "同城市同门牌号一致",
            platformHotelName: `如家商旅酒店${index + 1}`,
            platformAddress: `广州大道北142${index}号`,
            platformDoorPlate: `广州大道北142${index}号`,
            hasMainRate: !(platformIndex === 1 && index === 1),
            mainRatePrice: platformIndex === 1 && index === 1 ? null : 240 + index + platformIndex,
            otherRates: {
              大床无早餐: null,
              双床有早餐: 260 + index + platformIndex,
              双床无早餐: null
            },
            durationMs: 1000 + platformIndex,
            failureType: platformIndex === 1 && index === 1 ? "competitor_no_same_hotel" : null,
            failureReason: platformIndex === 1 && index === 1 ? "门牌号不一致" : "",
            screenshotPath: path.resolve(`outputs/current/pilot/hotel-calibration/test-run/hotel-${index + 1}-${platformIndex + 1}.png`),
            finalUrl: "https://example.com/hotel",
            pageTextSummary: "酒店详情 大床 早餐 价格"
          })),
          message: `如家商旅酒店${index + 1} 校准完成`
        })),
        updatedAt: "2026-05-18T10:04:10.000Z",
        message: "3 家酒店校准测试完成：完整 1/3"
      })),
      runHotelSmallBatchProbe: vi.fn(async () => ({
        status: "partial",
        city: "广州",
        targetTotal: 10,
        targetPerGroup: 2,
        mainRatePlan: "大床有早餐",
        completedCount: 9,
        failedCount: 1,
        partialCount: 1,
        skippedCount: 0,
        unattemptedCount: 0,
        timeoutBudget: false,
        budget: {
          totalMs: 90 * 60 * 1000,
          perGroupMs: 18 * 60 * 1000,
          maxAttemptsPerGroup: 6
        },
        groups: ["首旅如家", "华住", "锦江", "东呈", "亚朵"].map((group, groupIndex) => ({
          group,
          query: { city: "广州", keyword: group === "亚朵" ? "亚朵" : group === "东呈" ? "城市便捷" : group === "锦江" ? "维也纳" : group === "华住" ? "全季" : "如家商旅", checkInDate: "2026-05-25", checkOutDate: "2026-05-26", nights: 1 },
          targetCount: 2,
          maxAttempts: 6,
          budgetMs: 18 * 60 * 1000,
          attemptedCount: 2,
          completedCount: groupIndex === 4 ? 1 : 2,
          partialCount: groupIndex === 4 ? 1 : 0,
          failedCount: 0,
          skippedCount: 0,
          unattemptedCount: 0,
          timeoutBudget: false,
          samples: Array.from({ length: 2 }, (_, sampleIndex) => {
            const completed = !(groupIndex === 4 && sampleIndex === 1);
            return {
              group,
              groupIndex: groupIndex + 1,
              sampleIndex: sampleIndex + 1,
              query: { city: "广州", keyword: group === "亚朵" ? "亚朵" : group === "东呈" ? "城市便捷" : group === "锦江" ? "维也纳" : group === "华住" ? "全季" : "如家商旅", checkInDate: "2026-05-25", checkOutDate: "2026-05-26", nights: 1 },
              status: completed ? "completed" : "partial",
              selectedCandidate: completed ? {
                hotelName: `${group}新增酒店${sampleIndex + 1}`,
                level: "舒适",
                score: "4.8",
                area: "广州",
                address: `广州市测试路${groupIndex}${sampleIndex}号`,
                price: 260 + groupIndex + sampleIndex,
                rawText: `${group}新增酒店${sampleIndex + 1}`
              } : null,
              quotes: completed ? ["青猫差旅", "阿里商旅", "在途商旅", "携程商旅"].map((platform, platformIndex) => ({
                platform,
                status: "available",
                price: 260 + groupIndex + sampleIndex + platformIndex,
                hotelName: `${group}新增酒店${sampleIndex + 1}`,
                roomType: "大床房",
                ratePlan: "大床有早餐",
                durationMs: 1000 + platformIndex,
                screenshotPath: path.resolve(`outputs/current/pilot/hotel-small-batch/${group}/hotel-${sampleIndex + 1}-${platformIndex + 1}.png`),
                finalUrl: "https://example.com/hotel"
              })) : [
                {
                  platform: "青猫差旅",
                  status: "available",
                  price: 300,
                  hotelName: `${group}新增酒店${sampleIndex + 1}`,
                  roomType: "大床房",
                  ratePlan: "大床有早餐",
                  durationMs: 1000,
                  screenshotPath: path.resolve(`outputs/current/pilot/hotel-small-batch/${group}/hotel-${sampleIndex + 1}-qingmao.png`),
                  finalUrl: "https://example.com/qingmao"
                },
                {
                  platform: "阿里商旅",
                  status: "failed",
                  price: null,
                  hotelName: `${group}新增酒店${sampleIndex + 1}`,
                  roomType: "",
                  ratePlan: "大床有早餐",
                  durationMs: 2000,
                  error: "未找到符合条件的新增候选"
                }
              ],
              message: completed ? `${group}新增酒店${sampleIndex + 1} 四平台主口径均已读取` : "亚朵第 2 家酒店小放量失败",
              failureReason: completed ? undefined : "未找到符合条件的新增候选",
              failurePlatform: completed ? undefined : "阿里商旅"
            };
          })
        })),
        updatedAt: "2026-05-18T10:04:20.000Z",
        message: "10 家酒店小放量完成：完整 9/10，失败 1/10"
      })),
      runHotelScaleValidationProbe: vi.fn(async (input: { checkInDate?: string; checkOutDate?: string } = {}) => ({
        status: "partial",
        mode: "scale-validation",
        targetTotal: 40,
        targetPerGroup: 8,
        mainRatePlan: "大床有早餐",
        checkInDate: input.checkInDate ?? "2026-05-25",
        checkOutDate: input.checkOutDate ?? "2026-05-26",
        nights: input.checkInDate && input.checkOutDate ? 2 : 1,
        budget: {
          totalMs: 120 * 60 * 1000,
          perGroupMs: 25 * 60 * 1000,
          maxAttemptsPerGroup: 24
        },
        platformOrder: ["青猫差旅", "阿里商旅", "在途商旅", "携程商旅"],
        cityPool: ["北京", "广州", "杭州", "上海", "深圳", "武汉", "佛山", "成都", "厦门"],
        groups: [],
        completedCount: 39,
        failedCount: 1,
        partialCount: 0,
        skippedCount: 0,
        timeoutCount: 0,
        unattemptedCount: 0,
        evidenceCompleteCount: 39,
        evidenceMissingCount: 1,
        evidenceSaveFailedCount: 0,
        evidenceCompleteRate: 0.975,
        timeoutBudget: false,
        summaryPath: "/tmp/hotel-scale-validation/summary.json",
        timing: {
          platforms: [{ platform: "阿里商旅", count: 40, totalMs: 400000, averageMs: 10000, p95Ms: 18000 }],
          steps: [{ step: "read-main-rate", count: 120, totalMs: 900000, averageMs: 7500, p95Ms: 15000 }],
          slowestSteps: [],
          timeoutSamples: []
        },
        updatedAt: "2026-05-18T10:05:20.000Z",
        message: "40 家酒店放量验证 / 准生产诊断跑返回 partial：完整 39/40"
      })),
      cleanupBrowserPages: vi.fn(async () => ({
        status: "completed",
        beforeCount: 86,
        closedCount: 80,
        afterCount: 6,
        updatedAt: "2026-05-18T10:03:56.000Z",
        message: "已关闭 80 个采集临时窗口"
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
      runZtripProbe: vi.fn(async () => ({
        status: "completed",
        loginUrl: "https://www.z-trip.cn/v/vcommon/home",
        checks: [
          {
            target: "入口页",
            outcome: "login-required",
            note: "页面可访问，但需要人工登录",
            finalUrl: "https://www.z-trip.cn/v/vcommon/home",
            screenshotPath: "/tmp/ztrip-entry.png"
          }
        ],
        updatedAt: "2026-05-18T10:04:30.000Z",
        message: "在途商旅入口验证完成"
      })),
      runZtripFlightProbe: vi.fn(async () => ({
        status: "completed",
        route: { scope: "国内", origin: "广州", destination: "上海", travelDate: "2026-05-21" },
        selectedFlight: {
          airline: "海南航空",
          flightNo: "HU7431",
          aircraft: "空客320NEO(窄体) |",
          departureTime: "06:35",
          arrivalTime: "08:55",
          originAirport: "白云T3",
          destinationAirport: "浦东T2",
          durationMinutes: null,
          price: 470,
          cabin: "经济舱",
          discount: "经济舱T 2.4折",
          meal: "",
          shared: false,
          rawText: "海南航空HU7431 空客320NEO(窄体) | 06:35 白云T3 08:55 浦东T2 CNY 470 起 经济舱T 2.4折"
        },
        candidates: [],
        totalFlights: 53,
        finalUrl: "https://www.z-trip.cn/v/pg/flight/multiList",
        screenshotPath: "/tmp/ztrip-flight.png",
        updatedAt: "2026-05-18T10:04:40.000Z",
        message: "已读取在途商旅 1 条航班样本"
      })),
      runZtripHotelProbe: vi.fn(async () => ({
        status: "completed",
        query: { city: "广州", checkInDate: "2026-05-21", checkOutDate: "2026-05-22", nights: 1 },
        selectedRate: {
          hotelName: "广州科尔海悦酒店",
          roomType: "精英大床房",
          bedType: "大床",
          breakfast: "有早餐",
          price: 388,
          rawText: "精英大床房 2份早餐 CNY 388"
        },
        rates: [],
        finalUrl: "https://www.z-trip.cn/v/pg/hotel/hotelList",
        screenshotPath: "/tmp/ztrip-hotel.png",
        updatedAt: "2026-05-18T10:04:50.000Z",
        message: "已读取在途商旅酒店大床有早餐样本"
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

    const qingmaoHotelStatus = await request(app).get("/api/pilot/qingmao-hotel-candidates/status").expect(200);
    expect(qingmaoHotelStatus.body.status).toBe("idle");

    const qingmaoHotelCandidates = await request(app).post("/api/pilot/qingmao-hotel-candidates/run").expect(200);
    expect(qingmaoHotelCandidates.body.status).toBe("completed");
    expect(qingmaoHotelCandidates.body.totalHotels).toBe(9);
    expect(qingmaoHotelCandidates.body.selectedCandidate).toMatchObject({
      hotelName: "如家商旅酒店(广州白云山京溪南方医院地铁站店)",
      price: 228
    });
    expect(pilotCollector.runQingmaoHotelCandidateProbe).toHaveBeenCalledTimes(1);

    const hotelMainRateStatus = await request(app).get("/api/pilot/hotel-main-rate/status").expect(200);
    expect(hotelMainRateStatus.body.status).toBe("idle");

    const hotelMainRate = await request(app).post("/api/pilot/hotel-main-rate/run").expect(200);
    expect(hotelMainRate.body.status).toBe("partial");
    expect(hotelMainRate.body.quotes.find((quote: { platform: string }) => quote.platform === "青猫差旅")).toMatchObject({
      status: "available",
      price: 222,
      ratePlan: "大床有早餐"
    });
    expect(pilotCollector.runHotelMainRateProbe).toHaveBeenCalledTimes(1);

    const hotelGroupMainRateStatus = await request(app).get("/api/pilot/hotel-group-main-rate/status").expect(200);
    expect(hotelGroupMainRateStatus.body.status).toBe("idle");

    const hotelGroupMainRate = await request(app).post("/api/pilot/hotel-group-main-rate/run").expect(200);
    expect(hotelGroupMainRate.body.status).toBe("completed");
    expect(hotelGroupMainRate.body.samples[0]).toMatchObject({
      group: "首旅如家",
      status: "completed"
    });
    expect(hotelGroupMainRate.body.samples[0].quotes.find((quote: { platform: string }) => quote.platform === "青猫差旅")).toMatchObject({
      screenshotPath: "/tmp/qingmao-group-main-rate.png"
    });
    expect(pilotCollector.runHotelGroupMainRateProbe).toHaveBeenCalledTimes(1);

    const hotelSmallBatchStatus = await request(app).get("/api/pilot/hotel-small-batch/status").expect(200);
    expect(hotelSmallBatchStatus.body).toMatchObject({
      status: "idle",
      targetTotal: 10,
      targetPerGroup: 2,
      mainRatePlan: "大床有早餐"
    });

    const hotelSmallBatch = await request(app).post("/api/pilot/hotel-small-batch/run").expect(200);
    expect(hotelSmallBatch.body).toMatchObject({
      status: "partial",
      city: "广州",
      targetTotal: 10,
      targetPerGroup: 2,
      completedCount: 9,
      failedCount: 1
    });
    expect(hotelSmallBatch.body.groups).toHaveLength(5);
    expect(hotelSmallBatch.body.groups.every((group: { samples: unknown[] }) => group.samples.length === 2)).toBe(true);
    expect(hotelSmallBatch.body.groups[0].samples[0].quotes.find((quote: { platform: string }) => quote.platform === "青猫差旅")).toMatchObject({
      screenshotUrl: "/outputs/current/pilot/hotel-small-batch/%E9%A6%96%E6%97%85%E5%A6%82%E5%AE%B6/hotel-1-1.png",
      finalUrl: "https://example.com/hotel",
      durationMs: 1000
    });
    expect(pilotCollector.runHotelSmallBatchProbe).toHaveBeenCalledTimes(1);

    const hotelScaleValidationStatus = await request(app).get("/api/pilot/hotel-scale-validation/status").expect(200);
    expect(hotelScaleValidationStatus.body).toMatchObject({
      status: "idle",
      mode: "scale-validation",
      targetTotal: 40,
      targetPerGroup: 8,
      checkInDate: "2026-05-25",
      checkOutDate: "2026-05-26",
      nights: 1,
      budget: {
        totalMs: 120 * 60 * 1000,
        perGroupMs: 25 * 60 * 1000,
        maxAttemptsPerGroup: 24
      }
    });

    const defaultScaleValidation = await request(app).post("/api/pilot/hotel-scale-validation/run").expect(200);
    expect(defaultScaleValidation.body).toMatchObject({
      checkInDate: "2026-05-25",
      checkOutDate: "2026-05-26",
      nights: 1
    });
    expect(pilotCollector.runHotelScaleValidationProbe).toHaveBeenCalledWith({});

    const explicitScaleInput = { checkInDate: "2026-06-02", checkOutDate: "2026-06-04" };
    const hotelScaleValidation = await request(app).post("/api/pilot/hotel-scale-validation/run").send(explicitScaleInput).expect(200);
    expect(hotelScaleValidation.body).toMatchObject({
      status: "partial",
      mode: "scale-validation",
      checkInDate: "2026-06-02",
      checkOutDate: "2026-06-04",
      nights: 2,
      completedCount: 39,
      evidenceCompleteRate: 0.975
    });
    expect(pilotCollector.runHotelScaleValidationProbe).toHaveBeenLastCalledWith(explicitScaleInput);

    const smokeScaleInput = { limit: 5 };
    await request(app).post("/api/pilot/hotel-scale-validation/run").send(smokeScaleInput).expect(200);
    expect(pilotCollector.runHotelScaleValidationProbe).toHaveBeenLastCalledWith(smokeScaleInput);

    const threeHotelScaleInput = { limit: 3 };
    await request(app).post("/api/pilot/hotel-scale-validation/run").send(threeHotelScaleInput).expect(200);
    expect(pilotCollector.runHotelScaleValidationProbe).toHaveBeenLastCalledWith(threeHotelScaleInput);

    await request(app).post("/api/pilot/hotel-scale-validation/run").send({ checkInDate: "2026-06-02" }).expect(400);
    await request(app).post("/api/pilot/hotel-scale-validation/run").send({ checkInDate: "2026-06-04", checkOutDate: "2026-06-02" }).expect(400);
    await request(app).post("/api/pilot/hotel-scale-validation/run").send({ limit: 41 }).expect(400);

    const singleDiagnosisStatus = await request(app).get("/api/pilot/hotel-single-diagnosis/status").expect(200);
    expect(singleDiagnosisStatus.body.status).toBe("idle");

    const singleDiagnosisInput = {
      city: "广州",
      keyword: "如家商旅",
      checkInDate: "2026-05-23",
      checkOutDate: "2026-05-24",
      ratePlan: "大床有早餐"
    };
    const singleDiagnosis = await request(app).post("/api/pilot/hotel-single-diagnosis/run").send(singleDiagnosisInput).expect(200);
    expect(singleDiagnosis.body).toMatchObject({
      status: "completed",
      input: singleDiagnosisInput,
      selectedCandidate: {
        hotelName: "如家商旅酒店(广州白云山京溪南方医院地铁站店)",
        address: "白云区广州大道北1420号"
      }
    });
    expect(singleDiagnosis.body.platforms).toHaveLength(2);
    expect(singleDiagnosis.body.platforms[0]).toMatchObject({
      platform: "青猫差旅",
      step: "success",
      sameHotel: true,
      matchBasis: "青猫候选源酒店",
      sourceDoorPlate: "广州大道北1420号",
      targetDoorPlate: "广州大道北1420号",
      price: 240,
      screenshotUrl: "/outputs/current/pilot/hotel-single-diagnosis/test-run/qingmao.png"
    });
    expect(singleDiagnosis.body.platforms[1]).toMatchObject({
      platform: "携程商旅",
      step: "failed",
      sameHotel: false,
      matchBasis: "未匹配到同城市同门牌号",
      sourceDoorPlate: "广州大道北1420号",
      targetDoorPlate: "广州大道中301号",
      price: null,
      error: "门牌号不一致",
      screenshotUrl: "/outputs/current/pilot/hotel-single-diagnosis/test-run/ctrip.png"
    });
    expect(pilotCollector.runHotelSingleDiagnosisProbe).toHaveBeenCalledWith(singleDiagnosisInput);

    const singleAllRatePlansStatus = await request(app).get("/api/pilot/hotel-single-all-rate-plans/status").expect(200);
    expect(singleAllRatePlansStatus.body).toMatchObject({
      status: "idle",
      mode: "single-all-rate-plans",
      platformOrder: ["青猫差旅", "携程商旅", "阿里商旅", "在途商旅"]
    });

    const singleAllRatePlansInput = {
      city: "北京",
      keyword: "全季酒店(北京站店)",
      checkInDate: "2026-05-28",
      checkOutDate: "2026-05-29"
    };
    const singleAllRatePlans = await request(app).post("/api/pilot/hotel-single-all-rate-plans/run").send(singleAllRatePlansInput).expect(200);
    expect(singleAllRatePlans.body).toMatchObject({
      status: "partial",
      mode: "single-all-rate-plans",
      input: singleAllRatePlansInput,
      selectedCandidate: {
        hotelName: "全季酒店(北京站店)",
        address: "东城区北京站街8号"
      },
      sourceHotel: {
        doorPlate: "北京站街8号"
      },
      completeRatePlans: ["大床无早餐", "大床有早餐", "双床无早餐"],
      resultUrl: "/outputs/current/pilot/hotel-single-all-rate-plans/test-run/result.json",
      diagnosticReviewUrl: "/outputs/current/pilot/hotel-single-all-rate-plans/test-run/diagnostic-review.html"
    });
    expect(singleAllRatePlans.body.platforms).toHaveLength(4);
    expect(singleAllRatePlans.body.platforms[0]).toMatchObject({
      platform: "青猫差旅",
      sameHotel: true,
      ratePrices: {
        大床无早餐: 500,
        大床有早餐: 530,
        双床无早餐: 540,
        双床有早餐: 560
      },
      screenshotUrl: "/outputs/current/pilot/hotel-single-all-rate-plans/test-run/1.png"
    });
    expect(singleAllRatePlans.body.platforms[3]).toMatchObject({
      platform: "在途商旅",
      sameHotel: true,
      ratePrices: {
        双床有早餐: null
      }
    });
    expect(pilotCollector.runHotelSingleAllRatePlansProbe).toHaveBeenCalledWith(singleAllRatePlansInput);
    await request(app).post("/api/pilot/hotel-single-all-rate-plans/run").send({ city: "北京", checkInDate: "2026-05-28", checkOutDate: "2026-05-29" }).expect(400);

    const aliSingleStatus = await request(app).get("/api/pilot/ali-hotel-single/status").expect(200);
    expect(aliSingleStatus.body.status).toBe("idle");

    const aliSingleInput = {
      city: "广州",
      hotelName: "广州塔琶洲会展亚朵S酒店",
      address: "海珠区新港东路277号20层",
      checkInDate: "2026-05-24",
      checkOutDate: "2026-05-25",
      ratePlan: "大床有早餐"
    };
    const aliSingle = await request(app).post("/api/pilot/ali-hotel-single/run").send(aliSingleInput).expect(200);
    expect(aliSingle.body).toMatchObject({
      status: "completed",
      input: aliSingleInput,
      selectedCandidate: {
        hotelName: "广州塔琶洲会展亚朵S酒店",
        address: "海珠区新港东路277号20层"
      },
      result: {
        platform: "阿里商旅",
        status: "completed",
        sameHotel: true,
        mainRatePrice: 388,
        screenshotUrl: "/outputs/current/pilot/ali-hotel-single/test-run/alibtrip.png"
      }
    });
    expect(pilotCollector.runAliHotelSingleVerifyProbe).toHaveBeenCalledWith(aliSingleInput);

    const ratePlanStatus = await request(app).get("/api/pilot/hotel-rate-plan-probe/status").expect(200);
    expect(ratePlanStatus.body.status).toBe("idle");

    const ratePlanProbe = await request(app).post("/api/pilot/hotel-rate-plan-probe/run").expect(200);
    expect(ratePlanProbe.body).toMatchObject({
      status: "completed",
      recommendedRatePlan: "大床有早餐"
    });
    expect(ratePlanProbe.body.plans).toHaveLength(2);
    expect(pilotCollector.runHotelRatePlanProbe).toHaveBeenCalledTimes(1);

    const calibrationStatus = await request(app).get("/api/pilot/hotel-calibration/status").expect(200);
    expect(calibrationStatus.body).toMatchObject({
      status: "idle",
      mode: "calibration",
      limit: 3,
      mainRatePlan: "大床有早餐"
    });

    const calibrationInput = { checkInDate: "2026-05-25", checkOutDate: "2026-05-26" };
    const calibration = await request(app).post("/api/pilot/hotel-calibration/run").send(calibrationInput).expect(200);
    expect(calibration.body).toMatchObject({
      status: "partial",
      mode: "calibration",
      limit: 3,
      mainRatePlan: "大床有早餐",
      query: {
        checkInDate: "2026-05-25",
        checkOutDate: "2026-05-26",
        nights: 1
      }
    });
    expect(calibration.body.platformOrder).toEqual(["青猫差旅", "阿里商旅", "在途商旅", "携程商旅"]);
    expect(calibration.body.samples).toHaveLength(3);
    expect(calibration.body.samples[0].platforms).toHaveLength(4);
    expect(calibration.body.samples[0].platforms[0]).toMatchObject({
      platform: "青猫差旅",
      hasMainRate: true,
      otherRates: {
        大床无早餐: null,
        双床无早餐: null
      },
      screenshotUrl: "/outputs/current/pilot/hotel-calibration/test-run/hotel-1-1.png",
      pageTextSummary: "酒店详情 大床 早餐 价格"
    });
    expect(calibration.body.samples[1].platforms[1]).toMatchObject({
      platform: "阿里商旅",
      failureType: "competitor_no_same_hotel",
      failureReason: "门牌号不一致"
    });
    expect(pilotCollector.runHotelCalibrationProbe).toHaveBeenCalledWith(calibrationInput);

    const aliOnlyCalibrationInput = {
      checkInDate: "2026-05-25",
      checkOutDate: "2026-05-26",
      platforms: ["阿里商旅"]
    };
    const aliOnlyCalibration = await request(app).post("/api/pilot/hotel-calibration/run").send(aliOnlyCalibrationInput).expect(200);
    expect(aliOnlyCalibration.body.platformOrder).toEqual(["青猫差旅", "阿里商旅"]);
    expect(aliOnlyCalibration.body.samples[0].platforms.map((platform: { platform: string }) => platform.platform)).toEqual(["青猫差旅", "阿里商旅"]);
    expect(pilotCollector.runHotelCalibrationProbe).toHaveBeenLastCalledWith(aliOnlyCalibrationInput);

    const invalidCalibration = await request(app)
      .post("/api/pilot/hotel-calibration/run")
      .send({ checkInDate: "2026-05-25", checkOutDate: "2026-05-26", platforms: ["青猫差旅"] })
      .expect(400);
    expect(invalidCalibration.body.error).toContain("platforms 暂只支持");

    const cleanup = await request(app).post("/api/pilot/cleanup-browser-pages").expect(200);
    expect(cleanup.body).toMatchObject({
      status: "completed",
      beforeCount: 86,
      closedCount: 80,
      afterCount: 6
    });
    expect(pilotCollector.cleanupBrowserPages).toHaveBeenCalledTimes(1);

    const ztripStatus = await request(app).get("/api/pilot/ztrip/status").expect(200);
    expect(ztripStatus.body).toMatchObject({
      status: "idle",
      loginUrl: "https://www.z-trip.cn/v/vcommon/home",
      message: "等待验证在途商旅"
    });

    const ztripProbe = await request(app).post("/api/pilot/ztrip/run").expect(200);
    expect(ztripProbe.body.status).toBe("completed");
    expect(ztripProbe.body.checks[0]).toMatchObject({
      target: "入口页",
      outcome: "login-required",
      screenshotPath: "/tmp/ztrip-entry.png"
    });
    expect(pilotCollector.runZtripProbe).toHaveBeenCalledTimes(1);

    const ztripFlightStatus = await request(app).get("/api/pilot/ztrip-flight/status").expect(200);
    expect(ztripFlightStatus.body).toMatchObject({
      status: "idle",
      message: "等待采集在途商旅航班样本"
    });

    const ztripFlight = await request(app).post("/api/pilot/ztrip-flight/run").expect(200);
    expect(ztripFlight.body.status).toBe("completed");
    expect(ztripFlight.body.selectedFlight).toMatchObject({
      flightNo: "HU7431",
      price: 470
    });
    expect(ztripFlight.body.totalFlights).toBe(53);
    expect(pilotCollector.runZtripFlightProbe).toHaveBeenCalledTimes(1);

    const ztripHotelStatus = await request(app).get("/api/pilot/ztrip-hotel/status").expect(200);
    expect(ztripHotelStatus.body).toMatchObject({
      status: "idle",
      message: "等待采集在途商旅酒店样本"
    });

    const ztripHotel = await request(app).post("/api/pilot/ztrip-hotel/run").expect(200);
    expect(ztripHotel.body.status).toBe("completed");
    expect(ztripHotel.body.selectedRate).toMatchObject({
      hotelName: "广州科尔海悦酒店",
      roomType: "精英大床房",
      breakfast: "有早餐",
      price: 388
    });
    expect(pilotCollector.runZtripHotelProbe).toHaveBeenCalledTimes(1);

    const realCollect = await request(app).post("/api/collect-real-domestic").send({ limit: 1 }).expect(200);
    expect(realCollect.body.batch.id).toContain("real-domestic");
    expect(realCollect.body.batch.sampleCount).toBe(1);
    expect(realCollect.body.artifacts.excel).toMatch(/\.xlsx$/);
    expect(realCollect.body.artifacts.offlinePackage).toMatch(/\.zip$/);
    expect(pilotCollector.runDomesticBatchCollection).toHaveBeenCalledWith(1);

    const realInternationalCollect = await request(app).post("/api/collect-real-international").send({ limit: 1 }).expect(200);
    expect(realInternationalCollect.body.batch.id).toContain("real-international");
    expect(realInternationalCollect.body.batch.sampleCount).toBe(1);
    expect(realInternationalCollect.body.artifacts.excel).toMatch(/\.xlsx$/);
    expect(realInternationalCollect.body.artifacts.offlinePackage).toMatch(/\.zip$/);
    expect(pilotCollector.runInternationalBatchCollection).toHaveBeenCalledWith(1);

    const realFullCollect = await request(app).post("/api/collect-real-full").expect(200);
    expect(realFullCollect.body.batch.id).toContain("real-full");
    expect(realFullCollect.body.batch.sampleCount).toBe(2);
    expect(realFullCollect.body.artifacts.excel).toMatch(/\.xlsx$/);
    expect(realFullCollect.body.artifacts.offlinePackage).toMatch(/\.zip$/);
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
      { platform: "阿里商旅", loginUrl: "https://travel.alibtrip.com/index.html#/login", configured: true },
      { platform: "在途商旅", loginUrl: "https://www.z-trip.cn/v/vcommon/home", configured: true }
    ]);

    const login = await pilotCollector.openLoginSession();
    expect(login.status).toBe("login-browser-open");
    expect(login.platforms.map((platform) => platform.outcome)).toEqual(["opened", "opened", "opened", "opened"]);
    expect(opened).toEqual([
      {
        profileDir: "/tmp/qingmao-browser-profile",
        urls: [
          "https://booking.tmctrip.com/TravelBooking",
          "https://ct.ctrip.com/login",
          "https://travel.alibtrip.com/index.html#/login",
          "https://www.z-trip.cn/v/vcommon/home"
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
      getQingmaoHotelCandidateStatus: vi.fn(() => ({
        status: "idle",
        query: { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-21", checkOutDate: "2026-05-22", nights: 1 },
        candidates: [],
        selectedCandidate: null,
        totalHotels: null,
        updatedAt: null,
        message: "等待读取青猫酒店候选池"
      })),
      getHotelMainRateStatus: vi.fn(() => ({
        status: "idle",
        query: { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-21", checkOutDate: "2026-05-22", nights: 1 },
        selectedCandidate: null,
        quotes: [],
        updatedAt: null,
        message: "等待验证酒店当前口径大床有早餐"
      })),
      getHotelGroupMainRateStatus: vi.fn(() => ({
        status: "idle",
        samples: [],
        updatedAt: null,
        message: "等待验证每个集团 1 家酒店主口径"
      })),
      getHotelSingleDiagnosisStatus: vi.fn(() => ({
        status: "idle",
        input: null,
        selectedCandidate: null,
        platforms: [],
        updatedAt: null,
        message: "等待严格单酒店诊断"
      })),
      getHotelSingleAllRatePlansStatus: vi.fn(() => ({
        status: "idle",
        mode: "single-all-rate-plans",
        input: null,
        query: null,
        selectedCandidate: null,
        sourceHotel: null,
        platformOrder: ["青猫差旅", "携程商旅", "阿里商旅", "在途商旅"],
        platforms: [],
        completeRatePlans: [],
        updatedAt: null,
        message: "等待指定单酒店一次性四口径复验"
      })),
      getAliHotelSingleVerifyStatus: vi.fn(() => ({
        status: "idle",
        input: null,
        selectedCandidate: null,
        result: null,
        updatedAt: null,
        message: "等待指定酒店阿里-only复验"
      })),
      getAliHotelMatchStatus: vi.fn(() => ({
        status: "idle",
        samples: [],
        updatedAt: null,
        message: "等待验证阿里商旅同店匹配"
      })),
      getHotelRatePlanProbeStatus: vi.fn(() => ({
        status: "idle",
        plans: [],
        recommendedRatePlan: null,
        updatedAt: null,
        message: "等待验证酒店 4 个房型早餐口径完整率"
      })),
      getHotelAllRatePlanStatus: vi.fn(() => ({
        status: "idle",
        query: { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-21", checkOutDate: "2026-05-22", nights: 1 },
        selectedCandidate: null,
        samples: [],
        updatedAt: null,
        message: "等待选择青猫候选酒店并采集四平台四口径"
      })),
      getHotelCalibrationStatus: vi.fn(() => ({
        status: "idle",
        mode: "calibration",
        limit: 3,
        mainRatePlan: "大床有早餐",
        platformOrder: ["青猫差旅", "阿里商旅", "在途商旅", "携程商旅"],
        query: { city: "广州", keyword: "如家商旅", checkInDate: "2026-05-21", checkOutDate: "2026-05-22", nights: 1 },
        samples: [],
        updatedAt: null,
        message: "等待执行 3 家酒店校准测试"
      })),
      getHotelSmallBatchStatus: vi.fn(() => ({
        status: "idle",
        city: "广州",
        targetTotal: 10,
        targetPerGroup: 2,
        mainRatePlan: "大床有早餐",
        completedCount: 0,
        failedCount: 0,
        partialCount: 0,
        skippedCount: 0,
        unattemptedCount: 10,
        timeoutBudget: false,
        budget: {
          totalMs: 90 * 60 * 1000,
          perGroupMs: 18 * 60 * 1000,
          maxAttemptsPerGroup: 6
        },
        groups: [],
        updatedAt: null,
        message: "等待执行 10 家酒店小放量"
      })),
      getHotelScaleValidationStatus: vi.fn(() => ({
        status: "idle",
        mode: "scale-validation",
        targetTotal: 40,
        targetPerGroup: 8,
        mainRatePlan: "大床有早餐",
        checkInDate: "2026-05-25",
        checkOutDate: "2026-05-26",
        nights: 1,
        budget: {
          totalMs: 120 * 60 * 1000,
          perGroupMs: 25 * 60 * 1000,
          maxAttemptsPerGroup: 24
        },
        platformOrder: ["青猫差旅", "阿里商旅", "在途商旅", "携程商旅"],
        cityPool: ["北京", "广州", "杭州", "上海", "深圳", "武汉", "佛山", "成都", "厦门"],
        groups: [],
        completedCount: 0,
        failedCount: 0,
        partialCount: 0,
        skippedCount: 0,
        timeoutCount: 0,
        unattemptedCount: 40,
        evidenceCompleteCount: 0,
        evidenceMissingCount: 0,
        evidenceSaveFailedCount: 0,
        evidenceCompleteRate: 0,
        timeoutBudget: false,
        timing: {
          platforms: [],
          steps: [],
          slowestSteps: [],
          timeoutSamples: []
        },
        updatedAt: null,
        message: "等待执行 40 家酒店放量验证 / 准生产诊断跑"
      })),
      getSameFlightComparisonStatus: vi.fn(() => ({
        status: "idle",
        route: { scope: "国内", origin: "广州", destination: "上海", travelDate: "2026-05-21" },
        selectedFlight: null,
        quotes: [],
        updatedAt: null,
        message: "等待随机抽取同航班并查询竞品"
      })),
      getZtripStatus: vi.fn(() => ({
        status: "idle",
        loginUrl: "https://www.z-trip.cn/v/vcommon/home",
        checks: [],
        updatedAt: null,
        message: "等待验证在途商旅"
      })),
      getZtripFlightStatus: vi.fn(() => ({
        status: "idle",
        route: { scope: "国内", origin: "广州", destination: "上海", travelDate: "2026-05-21" },
        selectedFlight: null,
        candidates: [],
        totalFlights: null,
        updatedAt: null,
        message: "等待采集在途商旅航班样本"
      })),
      getZtripHotelStatus: vi.fn(() => ({
        status: "idle",
        query: { city: "广州", checkInDate: "2026-05-21", checkOutDate: "2026-05-22", nights: 1 },
        selectedRate: null,
        rates: [],
        updatedAt: null,
        message: "等待采集在途商旅酒店样本"
      })),
      openLoginSession: vi.fn(),
      runSilentProbe: vi.fn(async () => idlePilot),
      runAttachedProbe: vi.fn(),
      runQingmaoCandidateProbe: vi.fn(),
      runQingmaoHotelCandidateProbe: vi.fn(),
      runHotelMainRateProbe: vi.fn(),
      runHotelGroupMainRateProbe: vi.fn(),
      runHotelSingleDiagnosisProbe: vi.fn(),
      runHotelSingleAllRatePlansProbe: vi.fn(),
      runAliHotelSingleVerifyProbe: vi.fn(),
      runAliHotelMatchProbe: vi.fn(),
      runHotelRatePlanProbe: vi.fn(),
      runHotelAllRatePlanProbe: vi.fn(),
      runHotelCalibrationProbe: vi.fn(),
      runHotelSmallBatchProbe: vi.fn(),
      cleanupBrowserPages: vi.fn(),
      runSameFlightComparisonProbe: vi.fn(),
      runZtripProbe: vi.fn(),
      runZtripFlightProbe: vi.fn(),
      runZtripHotelProbe: vi.fn(),
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
