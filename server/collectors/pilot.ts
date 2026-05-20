import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { FIXED_ROUTES, INTERNATIONAL_FALLBACK_ROUTES } from "../../src/domain/fakeBatch";
import type { CollectionBatch, FlightSample, PlatformName, PlatformQuote, RouteConfig, RouteScope } from "../../src/domain/types";

type PilotStatus = "idle" | "login-browser-open" | "running" | "completed" | "failed";
type PilotOutcome = "needs-config" | "opened" | "reachable" | "login-required" | "failed";
type QingmaoCandidateStatus = "idle" | "running" | "completed" | "failed";
type SameFlightComparisonStatus = "idle" | "running" | "completed" | "failed";
type SameFlightQuoteStatus = "available" | "not-found" | "failed";

interface PilotRoute {
  scope: RouteScope;
  origin: string;
  destination: string;
  travelDate: string;
}

export interface PilotPlatformState {
  platform: PlatformName;
  loginUrl?: string;
  configured: boolean;
  outcome?: PilotOutcome;
  note?: string;
  pageTitle?: string;
  finalUrl?: string;
  screenshotPath?: string;
  screenshotUrl?: string;
  error?: string;
}

export interface PilotResult {
  status: PilotStatus;
  route: PilotRoute;
  profileDir: string;
  platforms: PilotPlatformState[];
  updatedAt: string | null;
  message: string;
}

export interface QingmaoFlightCandidate {
  airline: string;
  flightNo: string;
  aircraft: string;
  departureTime: string;
  arrivalTime: string;
  originAirport: string;
  destinationAirport: string;
  durationMinutes: number | null;
  price: number | null;
  cabin: "经济舱" | "";
  discount: string;
  meal: string;
  shared: boolean;
  rawText: string;
}

export interface QingmaoCandidateProbeResult {
  status: QingmaoCandidateStatus;
  route: PilotRoute;
  candidates: QingmaoFlightCandidate[];
  totalFlights: number | null;
  screenshotPath?: string;
  screenshotUrl?: string;
  finalUrl?: string;
  updatedAt: string | null;
  message: string;
  error?: string;
}

export interface SameFlightPlatformQuote {
  platform: PlatformName;
  status: SameFlightQuoteStatus;
  price: number | null;
  finalUrl?: string;
  screenshotPath?: string;
  screenshotUrl?: string;
  rawText?: string;
  error?: string;
}

export interface SameFlightComparisonProbeResult {
  status: SameFlightComparisonStatus;
  route: PilotRoute;
  selectedFlight: QingmaoFlightCandidate | null;
  quotes: SameFlightPlatformQuote[];
  updatedAt: string | null;
  message: string;
  error?: string;
}

export interface PilotCollector {
  getStatus(): PilotResult;
  getQingmaoCandidateStatus(): QingmaoCandidateProbeResult;
  getSameFlightComparisonStatus(): SameFlightComparisonProbeResult;
  openLoginSession(): Promise<PilotResult>;
  runSilentProbe(): Promise<PilotResult>;
  runAttachedProbe(): Promise<PilotResult>;
  runQingmaoCandidateProbe(): Promise<QingmaoCandidateProbeResult>;
  runSameFlightComparisonProbe(): Promise<SameFlightComparisonProbeResult>;
  runDomesticBatchCollection(limit?: number): Promise<CollectionBatch>;
  runInternationalBatchCollection(limit?: number): Promise<CollectionBatch>;
  runFullBatchCollection(): Promise<CollectionBatch>;
}

interface PilotCollectorOptions {
  profileDir: string;
  artifactDir: string;
  now?: () => Date;
  random?: () => number;
  remoteDebuggingPort?: number;
  openLoginWindow?: (profileDir: string, urls: string[], debuggingPort: number) => Promise<void>;
}

interface BrowserLocator {
  innerText(options?: { timeout?: number }): Promise<string>;
  click(options?: { timeout?: number }): Promise<unknown>;
  fill(value: string): Promise<unknown>;
  press(key: string): Promise<unknown>;
  count(): Promise<number>;
  first(): BrowserLocator;
  nth(index: number): BrowserLocator;
}

interface BrowserFrame {
  url(): string;
  locator(selector: string): BrowserLocator;
  getByRole(role: string, options?: { name?: string; exact?: boolean }): BrowserLocator;
  getByText(text: string, options?: { exact?: boolean }): BrowserLocator;
  waitForTimeout(timeout: number): Promise<unknown>;
  evaluate<T, Arg = unknown>(pageFunction: string | ((arg: Arg) => T), arg?: Arg): Promise<T>;
}

interface BrowserPage {
  goto(url: string, options?: { waitUntil?: "domcontentloaded"; timeout?: number }): Promise<unknown>;
  title(): Promise<string>;
  url(): string;
  locator(selector: string): BrowserLocator;
  getByText(text: string, options?: { exact?: boolean }): BrowserLocator;
  screenshot(options: { path: string; fullPage?: boolean; timeout?: number }): Promise<unknown>;
  setContent(html: string): Promise<unknown>;
  waitForTimeout(timeout: number): Promise<unknown>;
  waitForLoadState?(state: "domcontentloaded" | "load" | "networkidle", options?: { timeout?: number }): Promise<unknown>;
  waitForResponse?(predicate: (response: { url(): string; text(): Promise<string> }) => boolean, options?: { timeout?: number }): Promise<{ url(): string; text(): Promise<string> }>;
  evaluate<T, Arg = unknown>(pageFunction: string | ((arg: Arg) => T), arg?: Arg): Promise<T>;
  on?(event: "console", handler: (message: { text(): string }) => void): unknown;
  frames(): BrowserFrame[];
  bringToFront(): Promise<unknown>;
}

interface BrowserContext {
  newPage(): Promise<BrowserPage>;
  pages(): BrowserPage[];
  cookies?(urls?: string[]): Promise<Array<{ name: string; value: string; domain: string }>>;
  close(): Promise<void>;
}

interface BrowserConnection {
  contexts(): BrowserContext[];
  disconnect?: () => Promise<void>;
}

interface ChromiumLauncher {
  launchPersistentContext(userDataDir: string, options: Record<string, unknown>): Promise<BrowserContext>;
  connectOverCDP(endpointURL: string): Promise<BrowserConnection>;
}

const platformUrls: Record<PlatformName, string> = {
  青猫差旅: process.env.QINGMAO_TRAVEL_URL ?? "https://booking.tmctrip.com/TravelBooking",
  携程商旅: process.env.CTRIP_BUSINESS_URL ?? "https://ct.ctrip.com/login",
  阿里商旅: process.env.ALIBABA_BUSINESS_URL ?? "https://travel.alibtrip.com/index.html#/login"
};

const cityCodes: Record<string, string> = {
  广州: "CAN",
  上海: "SHA",
  北京: "BJS",
  成都: "CTU",
  杭州: "HGH",
  青岛: "TAO",
  深圳: "SZX",
  南京: "NKG",
  厦门: "XMN",
  福州: "FOC",
  曼谷: "BKK",
  河内: "HAN",
  胡志明市: "SGN",
  胡志明: "SGN",
  吉隆坡: "KUL",
  首尔: "SEL",
  东京: "TYO",
  洛杉矶: "LAX",
  新加坡: "SIN",
  大阪: "OSA",
  悉尼: "SYD",
  马尼拉: "MNL"
};

const citySearchNames: Record<string, string> = {
  胡志明市: "胡志明"
};

const aliInternationalCities = new Set(["曼谷", "河内", "胡志明市", "胡志明", "吉隆坡", "首尔", "东京", "洛杉矶", "新加坡", "大阪", "悉尼", "马尼拉"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isChromiumLauncher(value: unknown): value is ChromiumLauncher {
  return isRecord(value) && typeof value.launchPersistentContext === "function" && typeof value.connectOverCDP === "function";
}

async function loadChromium() {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
  const playwright = await dynamicImport("playwright");

  if (!isRecord(playwright) || !isChromiumLauncher(playwright.chromium)) {
    throw new Error("Playwright Chromium 不可用");
  }

  return playwright.chromium;
}

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function buildPilotRoute(now: Date): PilotRoute {
  return {
    scope: "国内",
    origin: "广州",
    destination: "上海",
    travelDate: formatDate(addDays(now, 3))
  };
}

function buildRouteFromConfig(route: RouteConfig, now: Date): PilotRoute {
  return {
    scope: route.scope,
    origin: route.origin,
    destination: route.destination,
    travelDate: formatDate(addDays(now, 3))
  };
}

function formatBatchTimestamp(date: Date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${formatDate(date)}-${hours}${minutes}${seconds}`;
}

function buildPlatformStatus(): PilotPlatformState[] {
  return (Object.entries(platformUrls) as Array<[PlatformName, string]>).map(([platform, loginUrl]) => ({
    platform,
    loginUrl,
    configured: Boolean(loginUrl)
  }));
}

function safeFilename(platform: PlatformName) {
  return platform.replace(/[^\u4e00-\u9fa5a-zA-Z0-9_-]/g, "-");
}

export function classifyProbeOutcome(text: string, finalUrl: string): PilotOutcome {
  if (/TravelBooking/i.test(finalUrl)) return "reachable";
  if (/ct\.ctrip\.com\/online\/home/i.test(finalUrl)) return "reachable";
  if (/travel\.alibtrip\.com\/index\.html.*#\/flight/i.test(finalUrl)) return "reachable";
  if (/travel\.alibtrip\.com\/flight-new.*#\/i-search-list/i.test(finalUrl)) return "reachable";
  if (/login|signin|sign-in/i.test(finalUrl)) return "login-required";
  return /登录|登陆|扫码|验证码|login|sign in/i.test(text) ? "login-required" : "reachable";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

function resolveBrowserExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? "",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  ];

  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function launchOptions(headless: boolean) {
  const executablePath = resolveBrowserExecutable();
  const options: Record<string, unknown> = {
    headless,
    viewport: { width: 1440, height: 960 }
  };

  if (executablePath) {
    options.executablePath = executablePath;
  }

  return options;
}

function openChromeLoginWindow(profileDir: string, urls: string[], debuggingPort: number) {
  const executablePath = resolveBrowserExecutable();
  if (!executablePath) {
    throw new Error("未找到本机 Chrome、Edge 或 Chromium");
  }

  const child = spawn(executablePath, [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${debuggingPort}`,
    "--remote-allow-origins=*",
    "--new-window",
    ...urls
  ], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

function missingPlaywrightResult(base: PilotResult, error: unknown): PilotResult {
  return {
    ...base,
    status: "failed",
    updatedAt: new Date().toISOString(),
    message: "Playwright 启动失败，请先安装浏览器运行环境",
    platforms: base.platforms.map((platform) => ({
      ...platform,
      outcome: "failed",
      note: "需要执行 npm install playwright 并安装 Chromium",
      error: errorMessage(error)
    }))
  };
}

export function createPlaywrightPilotCollector(options: PilotCollectorOptions): PilotCollector {
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;
  const remoteDebuggingPort = options.remoteDebuggingPort ?? 9223;
  let loginContext: BrowserContext | null = null;
  let latest: PilotResult = {
    status: "idle",
    route: buildPilotRoute(now()),
    profileDir: options.profileDir,
    platforms: buildPlatformStatus(),
    updatedAt: null,
    message: "等待打开登录浏览器"
  };
  let latestQingmaoCandidates: QingmaoCandidateProbeResult = {
    status: "idle",
    route: buildPilotRoute(now()),
    candidates: [],
    totalFlights: null,
    updatedAt: null,
    message: "等待读取青猫航班候选池"
  };
  let latestSameFlightComparison: SameFlightComparisonProbeResult = {
    status: "idle",
    route: buildPilotRoute(now()),
    selectedFlight: null,
    quotes: [],
    updatedAt: null,
    message: "等待随机抽取同航班并查询竞品"
  };

  return {
    getStatus() {
      return latest;
    },

    getQingmaoCandidateStatus() {
      return latestQingmaoCandidates;
    },

    getSameFlightComparisonStatus() {
      return latestSameFlightComparison;
    },

    async openLoginSession() {
      const base: PilotResult = {
        ...latest,
        status: "login-browser-open",
        route: buildPilotRoute(now()),
        updatedAt: new Date().toISOString(),
        message: "请在弹出的浏览器中完成三平台人工登录"
      };

      try {
        if (loginContext) {
          await loginContext.close();
          loginContext = null;
        }

        await fsp.mkdir(options.profileDir, { recursive: true });
        const platforms = buildPlatformStatus();
        const loginUrls = platforms
          .filter((platform) => platform.configured && platform.loginUrl)
          .map((platform) => platform.loginUrl as string);

        await (options.openLoginWindow ?? (async (profileDir, urls, debuggingPort) => openChromeLoginWindow(profileDir, urls, debuggingPort)))(
          options.profileDir,
          loginUrls,
          remoteDebuggingPort
        );

        const openedPlatforms: PilotPlatformState[] = [];
        for (const platform of platforms) {
          if (!platform.configured || !platform.loginUrl) {
            openedPlatforms.push({ ...platform, outcome: "needs-config", note: "请先配置该平台入口地址" });
            continue;
          }

          openedPlatforms.push({ ...platform, outcome: "opened", note: "已用普通 Chrome 打开，请人工登录；登录完成后保持窗口打开，再运行附着探测" });
        }

        latest = { ...base, platforms: openedPlatforms };
        return latest;
      } catch (error) {
        latest = missingPlaywrightResult(base, error);
        return latest;
      }
    },

    async runSilentProbe() {
      const base: PilotResult = {
        ...latest,
        status: "running",
        route: buildPilotRoute(now()),
        updatedAt: new Date().toISOString(),
        message: "正在后台静默探测三平台页面"
      };
      latest = base;

      try {
        if (loginContext) {
          await loginContext.close();
          loginContext = null;
        }

        await fsp.mkdir(options.profileDir, { recursive: true });
        await fsp.mkdir(options.artifactDir, { recursive: true });
        const chromium = await loadChromium();
        const context = await chromium.launchPersistentContext(options.profileDir, launchOptions(true));
        const platforms: PilotPlatformState[] = [];

        platforms.push(...(await probePlatformsInContext(context, options.artifactDir, "后台页面可访问", "后台静默访问失败")));

        await context.close();
        latest = {
          ...base,
          status: platforms.some((platform) => platform.outcome === "failed") ? "failed" : "completed",
          platforms,
          updatedAt: new Date().toISOString(),
          message: "后台静默探测完成"
        };
        return latest;
      } catch (error) {
        latest = missingPlaywrightResult(base, error);
        return latest;
      }
    },

    async runAttachedProbe() {
      const base: PilotResult = {
        ...latest,
        status: "running",
        route: buildPilotRoute(now()),
        updatedAt: new Date().toISOString(),
        message: "正在附着到已打开的 Chrome 登录窗口"
      };
      latest = base;

      try {
        await fsp.mkdir(options.artifactDir, { recursive: true });
        const chromium = await loadChromium();
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`);
        const context = browser.contexts()[0];

        if (!context) {
          await browser.disconnect?.();
          throw new Error("未找到可附着的 Chrome 浏览器上下文");
        }

        const platforms = await probePlatformsInContext(context, options.artifactDir, "已附着到登录窗口", "附着窗口访问失败");
        await browser.disconnect?.();

        latest = {
          ...base,
          status: platforms.some((platform) => platform.outcome === "failed") ? "failed" : "completed",
          platforms,
          updatedAt: new Date().toISOString(),
          message: "附着探测完成"
        };
        return latest;
      } catch (error) {
        latest = {
          ...base,
          status: "failed",
          updatedAt: new Date().toISOString(),
          message: "附着探测失败，请确认登录窗口保持打开",
          platforms: buildPlatformStatus().map((platform) => ({
            ...platform,
            outcome: "failed",
            note: "无法附着到普通 Chrome 登录窗口",
            error: errorMessage(error)
          }))
        };
        return latest;
      }
    },

    async runQingmaoCandidateProbe() {
      const base: QingmaoCandidateProbeResult = {
        ...latestQingmaoCandidates,
        status: "running",
        route: buildPilotRoute(now()),
        candidates: [],
        totalFlights: null,
        updatedAt: new Date().toISOString(),
        message: "正在读取青猫差旅候选航班"
      };
      latestQingmaoCandidates = base;

      try {
        await fsp.mkdir(options.artifactDir, { recursive: true });
        const chromium = await loadChromium();
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`);
        const context = browser.contexts()[0];

        if (!context) {
          await browser.disconnect?.();
          throw new Error("未找到可附着的 Chrome 浏览器上下文");
        }

        const page = findExistingPage(context, platformUrls.青猫差旅);
        if (!page) {
          await browser.disconnect?.();
          throw new Error("未找到青猫差旅已登录页面，请先打开登录浏览器并保持窗口打开");
        }

        const route = buildPilotRoute(now());
        await openQingmaoDomesticFlightTab(page);
        const frame = findQingmaoFlightFrame(page);

        if (!frame) {
          await browser.disconnect?.();
          throw new Error("未找到青猫机票 iframe，可能页面尚未加载完成或入口结构变化");
        }

        await searchQingmaoFlightRoute(frame, route);
        const candidates = await extractQingmaoFlightCandidates(frame);
        const totalFlights = await readQingmaoTotalFlightCount(frame);
        const screenshotPath = path.join(options.artifactDir, "青猫差旅-候选航班.png");
        await page.screenshot({ path: screenshotPath, fullPage: true });
        await browser.disconnect?.();

        latestQingmaoCandidates = {
          ...base,
          status: "completed",
          route,
          candidates,
          totalFlights,
          screenshotPath,
          finalUrl: page.url(),
          updatedAt: new Date().toISOString(),
          message: candidates.length > 0 ? `已读取青猫差旅 ${candidates.length} 条候选航班` : "青猫差旅页面可搜索，但未读取到候选航班"
        };
        return latestQingmaoCandidates;
      } catch (error) {
        latestQingmaoCandidates = {
          ...base,
          status: "failed",
          updatedAt: new Date().toISOString(),
          message: "青猫候选航班读取失败",
          error: errorMessage(error)
        };
        return latestQingmaoCandidates;
      }
    },

    async runSameFlightComparisonProbe() {
      const route = buildPilotRoute(now());
      const base: SameFlightComparisonProbeResult = {
        ...latestSameFlightComparison,
        status: "running",
        route,
        selectedFlight: null,
        quotes: [],
        updatedAt: new Date().toISOString(),
        message: "正在随机抽取青猫航班，并查询携程商旅、阿里商旅同航班"
      };
      latestSameFlightComparison = base;

      try {
        const selectedFlight = pickRandomQingmaoCandidate(latestQingmaoCandidates.candidates, random);

        if (!selectedFlight) {
          throw new Error("青猫候选航班池为空，请先点击“读取青猫候选航班”");
        }

        await fsp.mkdir(options.artifactDir, { recursive: true });
        const chromium = await loadChromium();
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`);
        const context = browser.contexts()[0];

        if (!context) {
          await browser.disconnect?.();
          throw new Error("未找到可附着的 Chrome 浏览器上下文");
        }

        const quotes: SameFlightPlatformQuote[] = [
          buildQingmaoQuote(selectedFlight, latestQingmaoCandidates.screenshotPath),
          await searchCtripSameFlightQuote(context, options.artifactDir, route, selectedFlight),
          await searchAliSameFlightQuote(context, options.artifactDir, route, selectedFlight)
        ];

        await browser.disconnect?.();
        latestSameFlightComparison = {
          ...base,
          status: "completed",
          selectedFlight,
          quotes,
          updatedAt: new Date().toISOString(),
          message: `已随机抽取 ${selectedFlight.flightNo}，并完成三平台同航班价格读取`
        };
        return latestSameFlightComparison;
      } catch (error) {
        latestSameFlightComparison = {
          ...base,
          status: "failed",
          updatedAt: new Date().toISOString(),
          message: "同航班价格读取失败",
          error: errorMessage(error)
        };
        return latestSameFlightComparison;
      }
    },

    async runDomesticBatchCollection(limit) {
      const collectedAt = now();
      const batchId = `batch-${formatBatchTimestamp(collectedAt)}-real-domestic`;
      const batchArtifactDir = path.join(options.artifactDir, batchId);
      const outputRoot = path.dirname(options.artifactDir);
      const publicScreenshotDir = path.join(outputRoot, "screenshots", batchId);
      const targetSampleCount = typeof limit === "number" && limit > 0 ? Math.min(limit, 10) : 10;
      const routes = FIXED_ROUTES
        .filter((route) => route.scope === "国内")
        .slice(0, targetSampleCount);

      await fsp.mkdir(batchArtifactDir, { recursive: true });
      await fsp.mkdir(publicScreenshotDir, { recursive: true });

      const chromium = await loadChromium();
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`);
      const context = browser.contexts()[0];

      if (!context) {
        await browser.disconnect?.();
        throw new Error("未找到可附着的 Chrome 浏览器上下文");
      }

      const qingmaoPage = findExistingPage(context, platformUrls.青猫差旅);
      if (!qingmaoPage) {
        await browser.disconnect?.();
        throw new Error("未找到青猫差旅已登录页面，请先打开登录浏览器并保持窗口打开");
      }

      await openQingmaoDomesticFlightTab(qingmaoPage);
      const qingmaoFrame = findQingmaoFlightFrame(qingmaoPage);

      if (!qingmaoFrame) {
        await browser.disconnect?.();
        throw new Error("未找到青猫机票 iframe，可能页面尚未加载完成或入口结构变化");
      }

      const samples: FlightSample[] = [];
      const failureNotes: string[] = [];

      try {
        for (const routeConfig of routes) {
          if (samples.length >= targetSampleCount) {
            break;
          }

          const route = buildRouteFromConfig(routeConfig, collectedAt);
          const sampleIndex = samples.length + 1;
          const sampleId = `real-domestic-${String(sampleIndex).padStart(2, "0")}`;
          const sampleArtifactDir = path.join(batchArtifactDir, sampleId);
          await fsp.mkdir(sampleArtifactDir, { recursive: true });

          try {
            await searchQingmaoFlightRoute(qingmaoFrame, route);
            const candidates = await extractQingmaoFlightCandidates(qingmaoFrame);
            const selectedFlight = pickRandomQingmaoCandidate(candidates, random);

            if (!selectedFlight) {
              failureNotes.push(`${route.origin}-${route.destination}: 青猫候选航班为空`);
              continue;
            }

            const randomizedCandidates = shuffledQingmaoCandidates(candidates, random);
            const skippedFlights: string[] = [];
            let acceptedSample: FlightSample | null = null;

            for (const candidate of randomizedCandidates) {
              try {
                const ctripQuote = await searchCtripSameFlightQuote(context, sampleArtifactDir, route, candidate, `${sampleId}-${platformSlug("携程商旅")}.png`);
                const aliQuote = await searchAliSameFlightQuote(context, sampleArtifactDir, route, candidate, `${sampleId}-${platformSlug("阿里商旅")}.png`);
                const sameFlightQuotes = [buildQingmaoQuote(candidate), ctripQuote, aliQuote];

                if (!hasCompleteSameFlightQuotes(sameFlightQuotes)) {
                  skippedFlights.push(`${candidate.flightNo}: ${incompleteQuoteReason(sameFlightQuotes)}`);
                  continue;
                }

                const qingmaoScreenshot = path.join(publicScreenshotDir, `${sampleId}-${platformSlug("青猫差旅")}.png`);
                const qingmaoEvidencePath = await savePageEvidence(qingmaoPage, qingmaoScreenshot, {
                  platform: "青猫差旅",
                  route,
                  selectedFlight: candidate,
                  price: candidate.price,
                  bodyText: candidate.rawText
                });
                const quotes = [
                  mapSameFlightQuoteToPlatformQuote(buildQingmaoQuote(candidate, qingmaoEvidencePath), batchId, sampleId),
                  await persistSameFlightQuote(ctripQuote, publicScreenshotDir, batchId, sampleId),
                  await persistSameFlightQuote(aliQuote, publicScreenshotDir, batchId, sampleId)
                ];
                acceptedSample = buildFlightSampleFromRealQuote(sampleId, routeConfig, route, candidate, quotes);
                break;
              } catch (error) {
                skippedFlights.push(`${candidate.flightNo}: ${errorMessage(error)}`);
              }
            }

            if (acceptedSample) {
              samples.push(acceptedSample);
            } else {
              failureNotes.push(`${route.origin}-${route.destination}: 已跳过 ${randomizedCandidates.length} 个航班，未找到三平台均可订同航班${skippedFlights.length ? `（${skippedFlights.slice(0, 3).join("；")}）` : ""}`);
            }
          } catch (error) {
            failureNotes.push(`${route.origin}-${route.destination}: ${errorMessage(error)}`);
          }
        }
      } finally {
        await browser.disconnect?.();
      }

      const failedCount = Math.max(targetSampleCount - samples.length, 0);

      if (samples.length === 0 && failureNotes.length > 0) {
        throw new Error(`国内真实采集未获得有效样本：${failureNotes.join("；")}`);
      }

      if (samples.length < targetSampleCount) {
        throw new Error(`国内真实采集未凑够 ${targetSampleCount} 条三平台完整样本，当前成功 ${samples.length} 条：${failureNotes.join("；")}`);
      }

      return {
        id: batchId,
        status: samples.length > 0 ? "ready" : "failed",
        generatedAt: collectedAt.toISOString(),
        sampleCount: samples.length,
        successCount: samples.length,
        failedCount,
        samples,
        failureNotes
      };
    },

    async runInternationalBatchCollection(limit) {
      const collectedAt = now();
      const batchId = `batch-${formatBatchTimestamp(collectedAt)}-real-international`;
      const batchArtifactDir = path.join(options.artifactDir, batchId);
      const outputRoot = path.dirname(options.artifactDir);
      const publicScreenshotDir = path.join(outputRoot, "screenshots", batchId);
      const targetSampleCount = typeof limit === "number" && limit > 0 ? Math.min(limit, 10) : 10;
      const primaryRoutes = FIXED_ROUTES
        .filter((route) => route.scope === "国际")
        .slice(0, targetSampleCount);
      const routes = [...primaryRoutes, ...INTERNATIONAL_FALLBACK_ROUTES];

      await fsp.mkdir(batchArtifactDir, { recursive: true });
      await fsp.mkdir(publicScreenshotDir, { recursive: true });

      const chromium = await loadChromium();
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`);
      const context = browser.contexts()[0];

      if (!context) {
        await browser.disconnect?.();
        throw new Error("未找到可附着的 Chrome 浏览器上下文");
      }

      const qingmaoPage = findExistingPage(context, platformUrls.青猫差旅);
      if (!qingmaoPage) {
        await browser.disconnect?.();
        throw new Error("未找到青猫差旅已登录页面，请先打开登录浏览器并保持窗口打开");
      }

      const samples: FlightSample[] = [];
      const failureNotes: string[] = [];

      try {
        for (const routeConfig of routes) {
          if (samples.length >= targetSampleCount) {
            break;
          }

          const route = buildRouteFromConfig(routeConfig, collectedAt);
          const sampleIndex = samples.length + 1;
          const sampleId = `real-international-${String(sampleIndex).padStart(2, "0")}`;
          const sampleArtifactDir = path.join(batchArtifactDir, sampleId);
          await fsp.mkdir(sampleArtifactDir, { recursive: true });

          try {
            const qingmaoFrame = await searchQingmaoInternationalFlightRoute(qingmaoPage, route);
            const candidates = await extractQingmaoFlightCandidates(qingmaoFrame);
            const selectedFlight = pickRandomQingmaoCandidate(candidates, random);

            if (!selectedFlight) {
              failureNotes.push(`已替换 ${route.origin}-${route.destination}: 青猫国际候选航班为空`);
              continue;
            }

            const randomizedCandidates = shuffledQingmaoCandidates(candidates, random);
            const skippedFlights: string[] = [];
            let acceptedSample: FlightSample | null = null;

            for (const candidate of randomizedCandidates) {
              try {
                const ctripQuote = await searchCtripSameFlightQuote(context, sampleArtifactDir, route, candidate, `${sampleId}-${platformSlug("携程商旅")}.png`);
                const aliQuote = await searchAliSameFlightQuote(context, sampleArtifactDir, route, candidate, `${sampleId}-${platformSlug("阿里商旅")}.png`);
                const sameFlightQuotes = [buildQingmaoQuote(candidate), ctripQuote, aliQuote];

                if (!hasCompleteSameFlightQuotes(sameFlightQuotes)) {
                  skippedFlights.push(`${candidate.flightNo}: ${incompleteQuoteReason(sameFlightQuotes)}`);
                  continue;
                }

                const qingmaoScreenshot = path.join(publicScreenshotDir, `${sampleId}-${platformSlug("青猫差旅")}.png`);
                const qingmaoEvidencePath = await savePageEvidence(qingmaoPage, qingmaoScreenshot, {
                  platform: "青猫差旅",
                  route,
                  selectedFlight: candidate,
                  price: candidate.price,
                  bodyText: candidate.rawText
                });
                const quotes = [
                  mapSameFlightQuoteToPlatformQuote(buildQingmaoQuote(candidate, qingmaoEvidencePath), batchId, sampleId),
                  await persistSameFlightQuote(ctripQuote, publicScreenshotDir, batchId, sampleId),
                  await persistSameFlightQuote(aliQuote, publicScreenshotDir, batchId, sampleId)
                ];
                acceptedSample = buildFlightSampleFromRealQuote(sampleId, routeConfig, route, candidate, quotes);
                break;
              } catch (error) {
                skippedFlights.push(`${candidate.flightNo}: ${errorMessage(error)}`);
              }
            }

            if (acceptedSample) {
              samples.push(acceptedSample);
            } else {
              failureNotes.push(`已替换 ${route.origin}-${route.destination}: 已跳过 ${randomizedCandidates.length} 个航班，未找到三平台均可订同航班${skippedFlights.length ? `（${skippedFlights.slice(0, 3).join("；")}）` : ""}`);
            }
          } catch (error) {
            failureNotes.push(`已替换 ${route.origin}-${route.destination}: ${errorMessage(error)}`);
          }
        }
      } finally {
        await browser.disconnect?.();
      }

      const failedCount = Math.max(targetSampleCount - samples.length, 0);

      if (samples.length === 0 && failureNotes.length > 0) {
        throw new Error(`国际真实采集未获得有效样本：${failureNotes.join("；")}`);
      }

      if (samples.length < targetSampleCount) {
        throw new Error(`国际真实采集未凑够 ${targetSampleCount} 条三平台完整样本，当前成功 ${samples.length} 条：${failureNotes.join("；")}`);
      }

      return {
        id: batchId,
        status: samples.length > 0 ? "ready" : "failed",
        generatedAt: collectedAt.toISOString(),
        sampleCount: samples.length,
        successCount: samples.length,
        failedCount,
        samples,
        failureNotes
      };
    },

    async runFullBatchCollection() {
      const domesticBatch = await this.runDomesticBatchCollection(10);
      const internationalBatch = await this.runInternationalBatchCollection(10);
      const batchId = `batch-${formatBatchTimestamp(now())}-real-full`;
      const samples = [...domesticBatch.samples, ...internationalBatch.samples].map((sample, index) => {
        const nextId = `real-full-${String(index + 1).padStart(2, "0")}`;
        return {
          ...sample,
          id: nextId,
          quotes: sample.quotes.map((quote) => ({
            ...quote,
            evidencePath: quote.evidencePath
              .replace(`screenshots/${domesticBatch.id}/`, `screenshots/${batchId}/`)
              .replace(`screenshots/${internationalBatch.id}/`, `screenshots/${batchId}/`)
          }))
        };
      });
      const outputRoot = path.dirname(options.artifactDir);
      const publicScreenshotDir = path.join(outputRoot, "screenshots", batchId);
      await fsp.mkdir(publicScreenshotDir, { recursive: true });

      for (const sourceBatch of [domesticBatch, internationalBatch]) {
        const sourceDir = path.join(outputRoot, "screenshots", sourceBatch.id);
        if (!fs.existsSync(sourceDir)) continue;
        const files = await fsp.readdir(sourceDir);
        for (const file of files) {
          await fsp.copyFile(path.join(sourceDir, file), path.join(publicScreenshotDir, file));
        }
      }

      return {
        id: batchId,
        status: "ready",
        generatedAt: now().toISOString(),
        sampleCount: samples.length,
        successCount: samples.length,
        failedCount: 0,
        samples,
        failureNotes: [...(domesticBatch.failureNotes ?? []), ...(internationalBatch.failureNotes ?? [])]
      };
    }
  };
}

function domainFromUrl(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function findExistingPage(context: BrowserContext, loginUrl: string) {
  const domain = domainFromUrl(loginUrl);
  if (!domain) return null;
  return context.pages().find((page) => page.url().includes(domain)) ?? null;
}

async function probePlatformsInContext(
  context: BrowserContext,
  artifactDir: string,
  reachableNote: string,
  failedNote: string
): Promise<PilotPlatformState[]> {
  const platforms: PilotPlatformState[] = [];

  for (const platform of buildPlatformStatus()) {
    if (!platform.configured || !platform.loginUrl) {
      platforms.push({ ...platform, outcome: "needs-config", note: "请先配置该平台入口地址" });
      continue;
    }

    const existingPage = findExistingPage(context, platform.loginUrl);
    const page = existingPage ?? await context.newPage();
    const screenshotPath = path.join(artifactDir, `${safeFilename(platform.platform)}.png`);

    try {
      if (!existingPage) {
        await page.goto(platform.loginUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
      }

      await page.waitForTimeout(5_000).catch(() => undefined);
      const bodyText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const outcome = classifyProbeOutcome(bodyText, page.url());

      platforms.push({
        ...platform,
        outcome,
        note: outcome === "login-required" ? "页面可访问，但可能仍在登录页" : reachableNote,
        pageTitle: await page.title().catch(() => ""),
        finalUrl: page.url(),
        screenshotPath
      });
    } catch (error) {
      platforms.push({
        ...platform,
        outcome: "failed",
        note: failedNote,
        screenshotPath,
        error: errorMessage(error)
      });
    }
  }

  return platforms;
}

function cleanText(value: string) {
  return value.replace(/\s+/g, "").trim();
}

export function parseDurationMinutes(value: string): number | null {
  const hourMatch = value.match(/(\d+)小时/);
  const minuteMatch = value.match(/(\d+)分/);

  if (!hourMatch && !minuteMatch) return null;

  return (hourMatch ? Number(hourMatch[1]) * 60 : 0) + (minuteMatch ? Number(minuteMatch[1]) : 0);
}

function parseCompactDurationMinutes(value: string): number | null {
  const compact = value.match(/(?:(\d+)h)?(?:(\d+)m)?/i);
  if (!compact || (!compact[1] && !compact[2])) return parseDurationMinutes(value);

  return (compact[1] ? Number(compact[1]) * 60 : 0) + (compact[2] ? Number(compact[2]) : 0);
}

export function parseQingmaoFlightCandidateText(rawText: string): QingmaoFlightCandidate | null {
  const text = cleanText(rawText);
  const flightMatch = text.match(/^([\u4e00-\u9fa5A-Za-z]+)((?:[A-Z]{2}|[0-9][A-Z])\d{3,4})/);
  const timeMatches = Array.from(text.matchAll(/\d{2}:\d{2}/g));

  if (!flightMatch || timeMatches.length < 2) return null;

  const flightNo = flightMatch[2];
  const flightNoEnd = (flightMatch.index ?? 0) + flightMatch[0].length;
  const firstTime = timeMatches[0];
  const secondTime = timeMatches[1];
  const firstTimeIndex = firstTime.index ?? -1;
  const secondTimeIndex = secondTime.index ?? -1;

  if (firstTimeIndex < 0 || secondTimeIndex < 0) return null;

  const aircraft = text.slice(flightNoEnd, firstTimeIndex);
  const betweenTimes = text.slice(firstTimeIndex + firstTime[0].length, secondTimeIndex);
  const terminalDurationMatch = betweenTimes.match(/^(.*T[0-9A-Z])(\d+小时(?:\d+分)?|\d+分)$/);
  const plainDurationMatch = betweenTimes.match(/^(.*?)(\d+小时(?:\d+分)?|\d+分)$/);
  const durationText = terminalDurationMatch?.[2] ?? plainDurationMatch?.[2] ?? "";
  const originAirport = terminalDurationMatch?.[1] ?? plainDurationMatch?.[1] ?? "";
  const destinationAndRest = text.slice(secondTimeIndex + secondTime[0].length);
  const destinationAirport = destinationAndRest.split(/有餐食|无餐食|￥/)[0];
  const priceMatch = text.match(/￥(\d+)起/);
  const discountMatch = text.match(/经济舱(?:[\d.]+折|全价)/);
  const mealMatch = text.match(/有餐食|无餐食/);

  return {
    airline: flightMatch[1],
    flightNo,
    aircraft,
    departureTime: firstTime[0],
    arrivalTime: secondTime[0],
    originAirport,
    destinationAirport,
    durationMinutes: durationText ? parseDurationMinutes(durationText) : null,
    price: priceMatch ? Number(priceMatch[1]) : null,
    cabin: discountMatch ? "经济舱" : "",
    discount: discountMatch ? discountMatch[0] : "",
    meal: mealMatch ? mealMatch[0] : "",
    shared: aircraft.includes("共享"),
    rawText
  };
}

export function parseQingmaoInternationalFlightCandidatesText(rawText: string): QingmaoFlightCandidate[] {
  const lines = rawText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates: QingmaoFlightCandidate[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const flightMatch = lines[index].match(/^(.+?)\s+((?:[A-Z]{2}|[0-9][A-Z])\d{3,4})$/);
    if (!flightMatch) continue;

    const previousLines = lines.slice(Math.max(0, index - 8), index);
    const timeIndexes = previousLines
      .map((line, lineIndex) => (/^\d{2}:\d{2}$/.test(line) ? lineIndex : -1))
      .filter((lineIndex) => lineIndex >= 0);
    const priceMatch = (lines[index + 1] ?? "").match(/[￥¥]\s*(\d{2,5})/);

    if (timeIndexes.length < 2 || !priceMatch) continue;

    const departureIndex = timeIndexes[timeIndexes.length - 2];
    const arrivalIndex = timeIndexes[timeIndexes.length - 1];
    const durationIndex = previousLines.findIndex((line, lineIndex) => lineIndex > departureIndex && lineIndex < arrivalIndex && /^\d+h(?:\d+m)?$|^\d+m$/.test(line));
    const originParts = previousLines.slice(departureIndex + 1, durationIndex > -1 ? durationIndex : arrivalIndex);
    const destinationParts = previousLines.slice(arrivalIndex + 1);
    const rawCandidate = [...previousLines, lines[index], lines[index + 1] ?? ""].join(" ");

    candidates.push({
      airline: flightMatch[1].trim(),
      flightNo: flightMatch[2],
      aircraft: "",
      departureTime: previousLines[departureIndex],
      arrivalTime: previousLines[arrivalIndex],
      originAirport: originParts.join(""),
      destinationAirport: destinationParts.join(""),
      durationMinutes: durationIndex > -1 ? parseCompactDurationMinutes(previousLines[durationIndex]) : null,
      price: Number(priceMatch[1]),
      cabin: "经济舱",
      discount: "",
      meal: "",
      shared: /共享/.test(rawCandidate),
      rawText: rawCandidate
    });
  }

  return candidates;
}

async function openQingmaoDomesticFlightTab(page: BrowserPage) {
  if (!/TravelBooking/i.test(page.url())) {
    await page.getByText("差旅预订", { exact: true }).first().click({ timeout: 8_000 });
    await page.waitForTimeout(3_000);
  }

  const domesticTab = page.locator("#tab-101");
  if ((await domesticTab.count().catch(() => 0)) > 0) {
    await domesticTab.click({ timeout: 8_000 });
  } else {
    await page.getByText("国内机票", { exact: true }).first().click({ timeout: 8_000 });
  }

  await page.waitForTimeout(5_000);
}

function findQingmaoFlightFrame(page: BrowserPage) {
  return page.frames().find((frame) => frame.url().includes("mrs.tmctrip.com") && frame.url().includes("type=flight")) ?? null;
}

function findQingmaoTrafficFrame(page: BrowserPage) {
  return page.frames().find((frame) => frame.url().includes("mcqt.tmctrip.com")) ?? null;
}

async function waitForQingmaoIntegratedTrafficFrame(page: BrowserPage) {
  for (let index = 0; index < 30; index += 1) {
    const frame = page.frames().find((item) => item.url().includes("integratedTraffic"));
    const bodyText = await frame?.locator("body").innerText({ timeout: 1_000 }).catch(() => "") ?? "";
    if (frame && bodyText.includes("国际机票")) {
      return frame;
    }

    await page.waitForTimeout(500);
  }

  return null;
}

async function clickVisibleFrameElement(frame: BrowserFrame, selector: string, text?: string) {
  const selectorValue = JSON.stringify(selector);
  const textValue = JSON.stringify(text ?? "");
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const clicked = await frame.evaluate<boolean>(`(() => {
      const selector = ${selectorValue};
      const text = ${textValue};
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && rect.x >= 0 && rect.x < window.innerWidth && style.visibility !== "hidden" && style.display !== "none";
      };
      const elements = Array.from(document.querySelectorAll(selector)).filter((element) => {
        const matchesText = text ? (element.textContent || "").trim().includes(text) : true;
        return matchesText && isVisible(element);
      });
      const target = elements[0];
      if (target) target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return Boolean(target);
    })()`);

    if (clicked) return;
    await frame.waitForTimeout(500);
  }

  throw new Error(`未找到可点击的青猫页面元素 ${selector}`);
}

async function openQingmaoInternationalFlightTab(page: BrowserPage) {
  if (!/TravelBooking/i.test(page.url())) {
    await page.getByText("差旅预订", { exact: true }).first().click({ timeout: 8_000 });
    await page.waitForTimeout(3_000);
  }

  const currentFrame = findQingmaoTrafficFrame(page);
  if (currentFrame && !currentFrame.url().includes("integratedTraffic")) {
    await currentFrame.evaluate(`(() => {
      window.location.href = "https://mcqt.tmctrip.com/pages/product3.0/integratedTraffic/index?productType=5&fromHomePage=1";
    })()`);
    await waitForQingmaoIntegratedTrafficFrame(page);
  }

  const otherBookingTab = page.locator("#tab-16");
  if ((await otherBookingTab.count().catch(() => 0)) > 0) {
    await otherBookingTab.click({ timeout: 8_000 });
  } else {
    await page.getByText("其他预订", { exact: true }).first().click({ timeout: 8_000 });
  }
  await page.waitForTimeout(1_000);

  const frame = await waitForQingmaoIntegratedTrafficFrame(page);
  if (!frame) {
    throw new Error("未找到青猫其他预订 iframe");
  }

  await clickVisibleFrameElement(frame, ".tw-trapezoid-tabs-item", "国际机票");
  await frame.waitForTimeout(1_000);
}

function qingmaoCitySearchName(city: string) {
  return citySearchNames[city] ?? city;
}

async function selectQingmaoMobileCity(page: BrowserPage, areaSelector: ".departArea" | ".arriveArea", city: string) {
  let frame = findQingmaoTrafficFrame(page);
  if (!frame) {
    throw new Error("未找到青猫国际机票 iframe");
  }

  await clickVisibleFrameElement(frame, areaSelector);
  await page.waitForTimeout(800);
  frame = findQingmaoTrafficFrame(page);

  if (!frame || !frame.url().includes("cityAirport")) {
    throw new Error(`青猫国际未打开${areaSelector === ".departArea" ? "出发地" : "目的地"}城市选择页`);
  }

  const searchName = qingmaoCitySearchName(city);
  const tabText = aliInternationalCities.has(city) || aliInternationalCities.has(searchName) ? "国际/中国港澳台" : "国内";
  const tabValue = JSON.stringify(tabText);
  const clickedTab = await frame.evaluate<boolean>(`(() => {
    const targetTab = ${tabValue};
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const tab = Array.from(document.querySelectorAll("uni-view, uni-text, span"))
      .find((element) => (element.textContent || "").trim() === targetTab && isVisible(element));
    if (tab) {
      tab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    }
    return false;
  })()`);

  if (!clickedTab) {
    throw new Error(`青猫国际未找到城市标签 ${tabText}`);
  }

  await frame.waitForTimeout(500);
  await frame.locator("input.uni-input-input").first().fill(searchName);
  const cityName = JSON.stringify(searchName);
  let clicked = false;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await frame.waitForTimeout(500);
    clicked = await frame.evaluate<boolean>(`(() => {
      const cityName = ${cityName};
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const exactCity = Array.from(document.querySelectorAll("uni-view, uni-text, span"))
        .find((element) => (element.textContent || "").trim() === cityName && isVisible(element));
      const clickableRow = exactCity?.closest(".border-bottom-line, .search-list > uni-view, .a-pl-108") ?? null;
      const airportRow = Array.from(document.querySelectorAll(".search-list uni-view, uni-view"))
        .find((element) => {
          const text = (element.textContent || "").trim();
          return isVisible(element) && (text === cityName || text.includes(cityName + "白云国际机场") || text.includes(cityName));
        });
      const target = clickableRow || airportRow || exactCity;
      if (target) {
        target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      }
      return Boolean(target);
    })()`);

    if (clicked) {
      break;
    }
  }

  if (!clicked) {
    throw new Error(`青猫国际未找到城市 ${city}`);
  }

  await page.waitForTimeout(1_000);
}

async function selectQingmaoMobileDate(page: BrowserPage, travelDate: string) {
  let frame = findQingmaoTrafficFrame(page);
  if (!frame) {
    throw new Error("未找到青猫国际机票 iframe");
  }

  const [, monthRaw, dayRaw] = travelDate.split("-");
  const selectedDateTexts = [`${monthRaw}月${dayRaw}日`, `${Number(monthRaw)}月${Number(dayRaw)}日`];
  const currentBodyText = await frame.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
  if (selectedDateTexts.some((text) => currentBodyText.includes(text))) {
    return;
  }

  await clickVisibleFrameElement(frame, "uni-view", "所选日期为航班起降当地日期");
  await frame.waitForTimeout(500);
  const dateValue = JSON.stringify(travelDate);
  const clicked = await frame.evaluate<boolean>(`(() => {
    const [year, monthValue, dayValue] = ${dateValue}.split("-").map(Number);
    const monthText = year + "年" + monthValue + "月";
    const dayText = String(dayValue);
    const isVisibleEnough = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const monthHeaders = Array.from(document.querySelectorAll("uni-view, uni-text, span"))
      .filter((element) => (element.textContent || "").trim() === monthText && isVisibleEnough(element));
    const monthHeader = monthHeaders[0];
    if (!monthHeader) return false;
    const monthY = monthHeader.getBoundingClientRect().y;
    const nextMonthHeader = Array.from(document.querySelectorAll("uni-view, uni-text, span"))
      .filter((element) => /^\\d{4}年\\d+月$/.test((element.textContent || "").trim()) && element.getBoundingClientRect().y > monthY)
      .sort((left, right) => left.getBoundingClientRect().y - right.getBoundingClientRect().y)[0];
    const nextMonthY = nextMonthHeader ? nextMonthHeader.getBoundingClientRect().y : Number.POSITIVE_INFINITY;
    const day = Array.from(document.querySelectorAll(".item-box"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const text = (element.textContent || "").trim();
        return rect.y > monthY && rect.y < nextMonthY && text === dayText && isVisibleEnough(element);
      })[0];
    if (day) day.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return Boolean(day);
  })()`);

  if (!clicked) {
    throw new Error(`青猫国际未找到日期 ${travelDate}`);
  }

  await page.waitForTimeout(800);
}

async function searchQingmaoInternationalFlightRoute(page: BrowserPage, route: PilotRoute) {
  await openQingmaoInternationalFlightTab(page);
  await selectQingmaoMobileCity(page, ".departArea", route.origin);
  await selectQingmaoMobileCity(page, ".arriveArea", route.destination);
  await selectQingmaoMobileDate(page, route.travelDate);

  let frame = findQingmaoTrafficFrame(page);
  if (!frame) {
    throw new Error("未找到青猫国际机票 iframe");
  }

  await clickVisibleFrameElement(frame, ".common-search-btn", "查询");

  for (let index = 0; index < 90; index += 1) {
    frame = findQingmaoTrafficFrame(page);
    const bodyText = await frame?.locator("body").innerText({ timeout: 2_000 }).catch(() => "") ?? "";

    if (/￥\d+/.test(bodyText) || /暂无|无航班/.test(bodyText)) {
      return frame as BrowserFrame;
    }

    await page.waitForTimeout(1_000);
  }

  frame = findQingmaoTrafficFrame(page);
  if (!frame) {
    throw new Error("青猫国际查询后未找到结果 iframe");
  }

  return frame;
}

async function selectQingmaoCity(frame: BrowserFrame, selectIndex: number, city: string) {
  const select = frame.locator(".el-select").nth(selectIndex);
  const currentText = await select.innerText({ timeout: 3_000 }).catch(() => "");
  if (currentText.includes(city)) {
    return;
  }

  const cityNameValue = JSON.stringify(city);
  const clickCityOption = async () => frame.evaluate<boolean>(`(() => {
      const cityName = ${cityNameValue};
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const item = Array.from(document.querySelectorAll(".el-select-dropdown__item, [role='option']"))
        .find((element) => {
          const text = (element.textContent || "").trim();
          return isVisible(element) && (text === cityName || text.includes(cityName));
        });
      if (!item) return false;
      item.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, cancelable: true, view: window }));
      item.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      item.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      item.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    })()`);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await select.click({ timeout: 8_000 });
    await frame.waitForTimeout(300);
    await frame.locator("input.el-select__input").nth(selectIndex).fill(city);

    for (let index = 0; index < 10; index += 1) {
      const clicked = await clickCityOption();
      if (clicked) {
        await frame.waitForTimeout(500);
        const selectedText = await select.innerText({ timeout: 2_000 }).catch(() => "");
        if (selectedText.includes(city)) return;
      }
      await frame.waitForTimeout(300);
    }

    const selectedText = await select.innerText({ timeout: 2_000 }).catch(() => "");
    if (selectedText.includes(city)) {
      return;
    }
  }

  throw new Error(`青猫国内未找到城市 ${city}`);
}

async function searchQingmaoFlightRoute(frame: BrowserFrame, route: PilotRoute) {
  await selectQingmaoCity(frame, 0, route.origin);
  await selectQingmaoCity(frame, 1, route.destination);

  const dateInput = frame.locator("input[placeholder=\"选择出发日期\"]");
  await dateInput.click({ timeout: 8_000 });
  await dateInput.fill(route.travelDate);
  await dateInput.press("Enter").catch(() => undefined);
  await frame.waitForTimeout(800);
  await frame.getByText("搜索航班", { exact: true }).click({ timeout: 8_000 });

  for (let index = 0; index < 70; index += 1) {
    const itemCount = await frame.locator(".list-item").count().catch(() => 0);
    const bodyText = await frame.locator("body").innerText({ timeout: 2_000 }).catch(() => "");

    if (itemCount > 0 || (/暂无符合条件的航班/.test(bodyText) && !/共\d+个航班/.test(bodyText))) {
      return;
    }

    await frame.waitForTimeout(1_000);
  }
}

async function extractQingmaoFlightCandidates(frame: BrowserFrame): Promise<QingmaoFlightCandidate[]> {
  const rawItems = await frame.evaluate<string[]>(`(() =>
    Array.from(document.querySelectorAll(".list-item"))
      .slice(0, 12)
      .map((item) => (item.textContent || "").replace(/\\s+/g, " ").trim())
  )()`);

  const domesticCandidates = rawItems
    .map((item) => parseQingmaoFlightCandidateText(item))
    .filter((candidate): candidate is QingmaoFlightCandidate => Boolean(candidate));

  if (domesticCandidates.length > 0) {
    return domesticCandidates;
  }

  const bodyText = await frame.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  return parseQingmaoInternationalFlightCandidatesText(bodyText).slice(0, 12);
}

async function readQingmaoTotalFlightCount(frame: BrowserFrame) {
  const bodyText = await frame.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  const match = bodyText.match(/共(\d+)个航班/);
  if (match) return Number(match[1]);

  const internationalCandidates = parseQingmaoInternationalFlightCandidatesText(bodyText);
  return internationalCandidates.length > 0 ? internationalCandidates.length : null;
}

function pickRandomQingmaoCandidate(candidates: QingmaoFlightCandidate[], random: () => number) {
  const selectable = candidates.filter((candidate) => candidate.flightNo && typeof candidate.price === "number" && !candidate.shared);
  if (!selectable.length) return null;

  const index = Math.min(selectable.length - 1, Math.floor(random() * selectable.length));
  return selectable[index];
}

function shuffledQingmaoCandidates(candidates: QingmaoFlightCandidate[], random: () => number) {
  const selectable = candidates.filter((candidate) => candidate.flightNo && typeof candidate.price === "number" && !candidate.shared);

  for (let index = selectable.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.min(index, Math.floor(random() * (index + 1)));
    [selectable[index], selectable[swapIndex]] = [selectable[swapIndex], selectable[index]];
  }

  return selectable;
}

function buildQingmaoQuote(candidate: QingmaoFlightCandidate, screenshotPath?: string): SameFlightPlatformQuote {
  return {
    platform: "青猫差旅",
    status: typeof candidate.price === "number" ? "available" : "not-found",
    price: candidate.price,
    screenshotPath,
    rawText: candidate.rawText
  };
}

const requiredPlatforms: PlatformName[] = ["青猫差旅", "携程商旅", "阿里商旅"];

export function hasCompleteSameFlightQuotes(quotes: SameFlightPlatformQuote[]) {
  return requiredPlatforms.every((platform) =>
    quotes.some((quote) => quote.platform === platform && quote.status === "available" && typeof quote.price === "number")
  );
}

function incompleteQuoteReason(quotes: SameFlightPlatformQuote[]) {
  return requiredPlatforms
    .filter((platform) => !quotes.some((quote) => quote.platform === platform && quote.status === "available" && typeof quote.price === "number"))
    .map((platform) => {
      const quote = quotes.find((item) => item.platform === platform);
      if (!quote) return `${platform}未返回`;
      if (quote.error) return `${platform}${quote.status === "failed" ? "采集失败" : "无可订价格"}：${quote.error}`;
      if (quote.status === "not-found") return `${platform}无同航班`;
      return `${platform}无可订价格`;
    })
    .join("，");
}

function mapQuoteStatus(status: SameFlightQuoteStatus) {
  if (status === "available") return "可订" as const;
  if (status === "not-found") return "无同航班" as const;
  return "采集失败" as const;
}

function evidenceExtension(evidencePath?: string) {
  const extension = evidencePath ? path.extname(evidencePath) : "";
  return extension && /^\.[a-z0-9]+$/i.test(extension) ? extension : ".png";
}

function relativeScreenshotPath(batchId: string, sampleId: string, platform: PlatformName, extension = ".png") {
  return `screenshots/${batchId}/${sampleId}-${platformSlug(platform)}${extension}`;
}

function platformSlug(platform: PlatformName) {
  const slugs: Record<PlatformName, string> = {
    青猫差旅: "qingmao",
    携程商旅: "ctrip",
    阿里商旅: "alibtrip"
  };
  return slugs[platform];
}

function mapSameFlightQuoteToPlatformQuote(quote: SameFlightPlatformQuote, batchId: string, sampleId: string): PlatformQuote {
  return {
    platform: quote.platform,
    price: quote.status === "available" ? quote.price : null,
    refundRule: quote.status === "available" ? "以平台页面展示及航司规则为准" : quote.error ? `采集失败：${quote.error}` : "未展示同航班退改规则",
    baggageRule: quote.status === "available" ? "以平台页面展示及航司规则为准" : quote.error ? "采集失败，未读取行李规则" : "未展示同航班行李规则",
    available: quote.status === "available",
    status: mapQuoteStatus(quote.status),
    evidencePath: relativeScreenshotPath(batchId, sampleId, quote.platform, evidenceExtension(quote.screenshotPath)),
    sourceUrl: quote.finalUrl ?? ""
  };
}

async function persistSameFlightQuote(
  quote: SameFlightPlatformQuote,
  publicScreenshotDir: string,
  batchId: string,
  sampleId: string
): Promise<PlatformQuote> {
  const publicScreenshotPath = path.join(publicScreenshotDir, `${sampleId}-${platformSlug(quote.platform)}${evidenceExtension(quote.screenshotPath)}`);

  if (quote.screenshotPath && fs.existsSync(quote.screenshotPath)) {
    await fsp.copyFile(quote.screenshotPath, publicScreenshotPath).catch(() => undefined);
    return mapSameFlightQuoteToPlatformQuote({ ...quote, screenshotPath: publicScreenshotPath }, batchId, sampleId);
  }

  const fallbackPath = publicScreenshotPath.replace(/\.[^.]+$/, ".html");
  await writeEvidenceSnapshotHtml(fallbackPath, {
    platform: quote.platform,
    finalUrl: quote.finalUrl,
    rawText: quote.rawText,
    price: quote.price,
    error: quote.error ?? "截图文件未成功保存"
  });
  return mapSameFlightQuoteToPlatformQuote({ ...quote, screenshotPath: fallbackPath }, batchId, sampleId);
}

function buildFlightSampleFromRealQuote(
  sampleId: string,
  routeConfig: RouteConfig,
  route: PilotRoute,
  selectedFlight: QingmaoFlightCandidate,
  quotes: PlatformQuote[]
): FlightSample {
  return {
    id: sampleId,
    routeId: routeConfig.id,
    scope: route.scope,
    origin: route.origin,
    destination: route.destination,
    travelDate: route.travelDate,
    flightNo: selectedFlight.flightNo,
    airline: selectedFlight.airline,
    cabin: "经济舱",
    directType: "直飞",
    transferCity: "",
    durationMinutes: selectedFlight.durationMinutes ?? 0,
    quotes
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractSameFlightQuoteFromText(bodyText: string, flightNo: string) {
  const text = bodyText.replace(/\s+/g, " ").trim();
  const flightPattern = new RegExp(escapeRegExp(flightNo), "i");
  const match = flightPattern.exec(text);

  if (!match || match.index === undefined) {
    return {
      status: "not-found" as SameFlightQuoteStatus,
      price: null,
      rawText: ""
    };
  }

  const snippet = text.slice(match.index, match.index + 900);
  const priceMatch = snippet.match(/[￥¥]\s*(\d{2,5})(?:\s*起)?/);

  return {
    status: priceMatch ? "available" as SameFlightQuoteStatus : "not-found" as SameFlightQuoteStatus,
    price: priceMatch ? Number(priceMatch[1]) : null,
    rawText: snippet.slice(0, 900)
  };
}

async function getOrCreatePlatformPage(context: BrowserContext, url: string) {
  return findExistingPage(context, url) ?? await context.newPage();
}

interface EvidenceSnapshot {
  platform: PlatformName;
  route?: PilotRoute;
  selectedFlight?: QingmaoFlightCandidate;
  price?: number | null;
  finalUrl?: string;
  bodyText?: string;
  rawText?: string;
  error?: string;
}

async function savePageScreenshot(page: BrowserPage, screenshotPath: string): Promise<boolean> {
  await fsp.mkdir(path.dirname(screenshotPath), { recursive: true });

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 10_000 });
    return await fileExistsWithContent(screenshotPath);
  } catch {
    await page.screenshot({ path: screenshotPath, timeout: 10_000 }).catch(() => undefined);
    return await fileExistsWithContent(screenshotPath);
  }
}

async function savePageEvidence(page: BrowserPage, screenshotPath: string, snapshot: EvidenceSnapshot): Promise<string> {
  if (await savePageScreenshot(page, screenshotPath)) {
    return screenshotPath;
  }

  const fallbackPath = screenshotPath.replace(/\.[^.]+$/, ".html");
  const bodyText = snapshot.bodyText ?? await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
  await writeEvidenceSnapshotHtml(fallbackPath, {
    ...snapshot,
    finalUrl: snapshot.finalUrl ?? page.url(),
    bodyText
  });
  return fallbackPath;
}

async function fileExistsWithContent(filePath: string) {
  try {
    return (await fsp.stat(filePath)).size > 0;
  } catch {
    return false;
  }
}

async function writeEvidenceSnapshotHtml(filePath: string, snapshot: EvidenceSnapshot) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const routeText = snapshot.route ? `${snapshot.route.origin} - ${snapshot.route.destination} / ${snapshot.route.travelDate}` : "";
  const flightText = snapshot.selectedFlight ? `${snapshot.selectedFlight.airline} ${snapshot.selectedFlight.flightNo}` : "";
  const bodyText = snapshot.bodyText ?? snapshot.rawText ?? "";
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(snapshot.platform)}网页截图</title>
  <style>
    body { margin: 0; padding: 32px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #0f2742; background: #f5f8fb; }
    main { max-width: 960px; margin: 0 auto; background: white; border: 1px solid #d9e2ef; border-radius: 12px; padding: 28px; box-shadow: 0 18px 45px rgba(15, 39, 66, 0.08); }
    h1 { margin: 0 0 18px; font-size: 28px; }
    dl { display: grid; grid-template-columns: 120px 1fr; gap: 10px 18px; margin: 0 0 24px; }
    dt { color: #65758c; }
    dd { margin: 0; font-weight: 650; }
    pre { white-space: pre-wrap; word-break: break-word; background: #f8fafc; border: 1px solid #d9e2ef; border-radius: 8px; padding: 16px; line-height: 1.7; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(snapshot.platform)}网页截图</h1>
    <dl>
      <dt>页面</dt><dd>${escapeHtml(snapshot.finalUrl ?? "")}</dd>
      <dt>航线</dt><dd>${escapeHtml(routeText)}</dd>
      <dt>航班</dt><dd>${escapeHtml(flightText)}</dd>
      <dt>价格</dt><dd>${snapshot.price == null ? "未读取" : `¥${snapshot.price}`}</dd>
      <dt>状态</dt><dd>${escapeHtml(snapshot.error ?? "页面截图保存异常，已保留采集时页面文本")}</dd>
    </dl>
    <pre>${escapeHtml(bodyText)}</pre>
  </main>
</body>
</html>`;
  await fsp.writeFile(filePath, html, "utf8");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

async function waitForSearchText(page: BrowserPage, flightNo: string, options: { returnOnGenericResult?: boolean } = {}) {
  const returnOnGenericResult = options.returnOnGenericResult ?? true;

  for (let index = 0; index < 45; index += 1) {
    const bodyText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
    if (bodyText.includes(flightNo) || /暂无|无航班|没有找到|出错了|异常/.test(bodyText)) {
      return bodyText;
    }

    if (returnOnGenericResult && /订票|预订|个航班/.test(bodyText)) {
      return bodyText;
    }

    await page.waitForTimeout(1_000);
  }

  return page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
}

async function clickVisibleText(page: BrowserPage, text: string) {
  const targetText = JSON.stringify(text);
  const clicked = await page.evaluate<boolean>(`(() => {
    const targetText = ${targetText};
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const score = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width * rect.height;
    };
    const buttons = Array.from(document.querySelectorAll("button, [role='button']"))
      .filter((element) => (element.textContent || "").includes(targetText) && isVisible(element))
      .sort((left, right) => score(right) - score(left));
    const elements = Array.from(document.querySelectorAll("a, div, span, li"))
      .filter((element) => (element.textContent || "").trim() === targetText && isVisible(element));
    const nearestButton = elements.map((element) => element.closest("button, [role='button']")).find(Boolean);
    const target = buttons[0] || nearestButton || elements[0];
    if (target) target.click();
    return Boolean(target);
  })()`);

  if (!clicked) {
    throw new Error(`未找到可点击的“${text}”`);
  }
}

async function selectCtripCity(page: BrowserPage, inputIndex: number, city: string) {
  const input = page.locator("input[placeholder=\"城市或机场\"]").nth(inputIndex);
  await input.click({ timeout: 10_000 });
  await input.fill(city);
  await page.waitForTimeout(1_000);
  await page.locator(".searchedCity").first().click({ timeout: 10_000 });
  await page.waitForTimeout(500);
}

async function selectCtripDate(page: BrowserPage, travelDate: string) {
  await page.locator("input[placeholder=\"选择日期\"]").click({ timeout: 10_000 });
  await page.waitForTimeout(500);
  const dateValue = JSON.stringify(travelDate);
  const clicked = await page.evaluate<boolean>(`(() => {
    const [year, monthValue, dayValue] = ${dateValue}.split("-").map(Number);
    const monthText = year + "年" + monthValue + "月";
    const dayText = String(dayValue);
    const months = Array.from(document.querySelectorAll(".c-calendar-month"));
    const month = months.find((element) => (element.textContent || "").includes(monthText));
    const day = Array.from(month ? month.querySelectorAll(".day") : [])
      .find((element) => (element.textContent || "").trim() === dayText);
    if (day) day.click();
    return Boolean(day);
  })()`);

  if (!clicked) {
    throw new Error(`携程商旅未找到日期 ${travelDate}`);
  }
}

async function searchCtripSameFlightQuote(
  context: BrowserContext,
  artifactDir: string,
  route: PilotRoute,
  selectedFlight: QingmaoFlightCandidate,
  screenshotFilename = "携程商旅-同航班.png"
): Promise<SameFlightPlatformQuote> {
  const page = await getOrCreatePlatformPage(context, "https://ct.ctrip.com");
  const screenshotPath = path.join(artifactDir, screenshotFilename);

  try {
    await page.goto("https://ct.ctrip.com/online/home", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(3_000);
    await selectCtripCity(page, 0, route.origin);
    await selectCtripCity(page, 1, route.destination);
    await selectCtripDate(page, route.travelDate);
    await clickVisibleText(page, "因公出行");
    await page.waitForLoadState?.("domcontentloaded", { timeout: 30_000 }).catch(() => undefined);
    const bodyText = await waitForSearchText(page, selectedFlight.flightNo);
    const extracted = extractSameFlightQuoteFromText(bodyText, selectedFlight.flightNo);
    const evidencePath = await savePageEvidence(page, screenshotPath, {
      platform: "携程商旅",
      route,
      selectedFlight,
      price: extracted.price,
      bodyText
    });

    return {
      platform: "携程商旅",
      status: extracted.status,
      price: extracted.price,
      finalUrl: page.url(),
      screenshotPath: evidencePath,
      rawText: extracted.rawText
    };
  } catch (error) {
    const errorText = errorMessage(error);
    const evidencePath = await savePageEvidence(page, screenshotPath, {
      platform: "携程商旅",
      route,
      selectedFlight,
      price: null,
      error: errorText
    });
    return {
      platform: "携程商旅",
      status: "failed",
      price: null,
      finalUrl: page.url(),
      screenshotPath: evidencePath,
      error: errorText
    };
  }
}

function isAliFlightHomeUrl(urlValue: string) {
  return /travel\.alibtrip\.com\/index\.html.*#\/flight/i.test(urlValue);
}

function explainAliInternationalSubmitFailure(bodyText: string, preSaveText: string) {
  if (/DOMESTIC/.test(preSaveText)) {
    return "阿里商旅国际查询未进入结果页：平台预提交返回国内机票链路，自动化未成功切到国际航班状态";
  }

  if (/缺少业务参数btripCorpId|供应商搜索异常|当前页面停留时间太久/.test(bodyText)) {
    return "阿里商旅国际查询未进入有效结果页：" + (bodyText.match(/缺少业务参数btripCorpId|供应商搜索异常|当前页面停留时间太久/)?.[0] ?? "页面异常");
  }

  return "阿里商旅国际查询提交后仍停留在首页，未进入国际机票结果页";
}

function readAliItineraryIdFromUrl(urlValue: string) {
  try {
    return new URL(urlValue).searchParams.get("itineraryId");
  } catch {
    return null;
  }
}

function buildAliSearchListUrl(baseUrl: string, route: PilotRoute, itineraryId: string) {
  const base = new URL(baseUrl);
  const params = new URLSearchParams(base.search);
  params.set("tripType", "0");
  params.set("itineraryId", itineraryId);
  params.set("agg", "false");
  params.set("depCityName", route.origin);
  params.set("depCityCode", cityCodes[route.origin] ?? route.origin);
  params.set("arrCityName", route.destination);
  params.set("arrCityCode", cityCodes[route.destination] ?? route.destination);
  params.set("closeAgreementPrice", "false");
  params.set("leaveDate", route.travelDate);
  params.set("searchParamKey", crypto.randomUUID());
  params.set("sessionKey", `flightSession_${crypto.randomUUID().replace(/-/g, "")}`);
  params.set("pnc", "1,0,0");

  return `https://travel.alibtrip.com/flight-2025?${params.toString()}#/search-list`;
}

function parseAliItineraryNoFromPreSaveText(preSaveText: string) {
  try {
    const parsed = JSON.parse(preSaveText) as { data?: { bookingUrl?: string; componentResult?: Array<{ itineraryNo?: string }> } };
    const bookingUrl = parsed.data?.bookingUrl;
    if (bookingUrl) {
      const itineraryId = new URL(bookingUrl).searchParams.get("itineraryId");
      if (itineraryId) return itineraryId;
    }

    return parsed.data?.componentResult?.find((item) => item.itineraryNo)?.itineraryNo ?? null;
  } catch {
    return null;
  }
}

async function readAliIdentityParams(page: BrowserPage) {
  return page.evaluate<{ corpId: string; userId: string; fpt: string }>(`(() => {
    const defaults = { corpId: "", userId: "", fpt: "bIdentify(main.newpc.newpc.c)" };
    const readFromUrl = (urlValue) => {
      try {
        const params = new URL(urlValue).searchParams;
        return {
          corpId: params.get("corpId") || "",
          userId: params.get("userId") || "",
          fpt: params.get("fpt") || ""
        };
      } catch {
        return { corpId: "", userId: "", fpt: "" };
      }
    };
    const current = readFromUrl(location.href);
    if (current.corpId && current.userId) {
      return { ...defaults, ...current, fpt: current.fpt || defaults.fpt };
    }

    try {
      const menus = JSON.parse(localStorage.getItem("SFS_BTRIP_PC_NAVIGATION_MENU_LIST_CACHE") || "[]");
      const flightMenu = menus.find((item) => item && item.label === "机票" && item.url);
      const fromMenu = readFromUrl(flightMenu?.url || "");
      if (fromMenu.corpId && fromMenu.userId) {
        return { ...defaults, ...fromMenu, fpt: fromMenu.fpt || defaults.fpt };
      }
    } catch {
      // Ignore malformed platform cache and continue to corp cache.
    }

    try {
      const corps = JSON.parse(localStorage.getItem("SFS_BTRIP_PC_NAVIGATION_CORP_LIST_CACHE") || "[]");
      const corp = corps.find((item) => item && item.corpId && item.userId);
      if (corp) {
        return { ...defaults, corpId: String(corp.corpId), userId: String(corp.userId) };
      }
    } catch {
      // Ignore malformed platform cache.
    }

    return defaults;
  })()`);
}

async function callAliMtop(
  context: BrowserContext,
  page: BrowserPage,
  api: string,
  data: Record<string, unknown>
) {
  const parsed = await callAliMtopRaw(context, page, api, data);
  if (!parsed.ret?.some((item) => item.includes("SUCCESS")) || !parsed.data?.result) {
    throw new Error(`阿里商旅接口调用失败：${parsed.ret?.join(",") ?? JSON.stringify(parsed).slice(0, 120)}`);
  }

  return parsed.data.result;
}

async function callAliMtopRaw(
  context: BrowserContext,
  page: BrowserPage,
  api: string,
  data: Record<string, unknown>
) {
  const cookies = await context.cookies?.(["https://h5api.m.alibtrip.com", "https://travel.alibtrip.com"]);
  const tokenCookie = cookies?.find((cookie) => cookie.name === "_m_h5_tk")?.value;
  const token = tokenCookie?.split("_")[0];

  if (!token) {
    throw new Error("阿里商旅 MTop token 不存在，请确认阿里登录窗口仍保持打开");
  }

  const appKey = "12574478";
  const timestamp = String(Date.now());
  const dataText = JSON.stringify(data);
  const sign = crypto.createHash("md5").update(`${token}&${timestamp}&${appKey}&${dataText}`).digest("hex");
  const params = new URLSearchParams({
    jsv: "2.6.1",
    appKey,
    t: timestamp,
    sign,
    api,
    dataType: "json",
    timeout: "15000",
    v: "1.0",
    type: "originaljson",
    ttid: "12ali0000603"
  });
  const url = `https://h5api.m.alibtrip.com/h5/${api}/1.0?${params.toString()}`;
  const urlValue = JSON.stringify(url);
  const dataTextValue = JSON.stringify(dataText);
  const responseText = await page.evaluate<string>(`(async () => {
    const url = ${urlValue};
    const dataText = ${dataTextValue};
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(dataText)
    });
    return response.text();
  })()`);
  const parsed = JSON.parse(responseText) as { ret?: string[]; data?: { result?: string; bookingUrl?: string; componentResult?: Array<{ itineraryNo?: string }> } };

  if (!parsed.ret?.some((item) => item.includes("SUCCESS"))) {
    throw new Error(`阿里商旅接口调用失败：${parsed.ret?.join(",") ?? responseText.slice(0, 120)}`);
  }

  return parsed;
}

async function readAliBookUser(page: BrowserPage) {
  return page.evaluate<{ realName: string; userName: string; userId: string; userType: number }>(`(() => {
    try {
      const corps = JSON.parse(localStorage.getItem("SFS_BTRIP_PC_NAVIGATION_CORP_LIST_CACHE") || "[]");
      const corp = corps.find((item) => item && (item.userId || item.employeeId));
      if (corp) {
        const name = String(corp.userNick || corp.nickName || "");
        return {
          realName: name,
          userName: name,
          userId: String(corp.userId || corp.employeeId),
          userType: 1
        };
      }
    } catch {
      // Ignore malformed platform cache.
    }

    try {
      const userInfo = JSON.parse(localStorage.getItem("SFS_BTRIP_PC_NAVIGATION_USER_INFO_CACHE") || "{}");
      const name = String(userInfo.nickName || "");
      return { realName: name, userName: name, userId: "", userType: 1 };
    } catch {
      return { realName: "", userName: "", userId: "", userType: 1 };
    }
  })()`);
}

async function createAliFlightItineraryNo(context: BrowserContext, page: BrowserPage) {
  const bookUser = await readAliBookUser(page);
  const identity = await readAliIdentityParams(page);
  const userId = bookUser.userId || identity.userId;
  const name = bookUser.realName || bookUser.userName;

  if (!userId || !name) {
    throw new Error("阿里商旅缺少出行人信息，无法生成行程单号");
  }

  const extParam = JSON.stringify({
    spm: "",
    itineraryEntry: false,
    pcHomePage: "true",
    pcHomeParams: JSON.stringify({ dingAppId: "1692", source: "pc" })
  });
  const response = await callAliMtopRaw(context, page, "mtop.alitrip.btriphome.pre.select.save", {
    category: "flight",
    itineraryNo: "",
    bookUsers: JSON.stringify([{ realName: name, userName: name, userId, userType: 1 }]),
    fromComponent: true,
    extParam
  });
  const itineraryNo = parseAliItineraryNoFromPreSaveText(JSON.stringify(response));

  if (!itineraryNo) {
    throw new Error("阿里商旅未返回行程单号");
  }

  return itineraryNo;
}

async function navigateAliInternationalSearchList(
  context: BrowserContext,
  page: BrowserPage,
  route: PilotRoute,
  itineraryNo: string
) {
  const identity = await readAliIdentityParams(page);
  if (!identity.corpId || !identity.userId) {
    throw new Error("阿里商旅国际查询缺少企业或用户参数");
  }

  const searchJourneys = [{
    arrCityCode: cityCodes[route.destination] ?? route.destination,
    arrCityName: route.destination,
    arrAirportCode: "",
    depCityCode: cityCodes[route.origin] ?? route.origin,
    depCityName: route.origin,
    depAirportCode: "",
    depDate: route.travelDate,
    itineraryNo,
    depCityRegion: aliInternationalCities.has(route.origin) ? 1 : 0,
    arrCityRegion: aliInternationalCities.has(route.destination) ? 1 : 0
  }];
  const searchCondition = {
    adultPassengerNum: 1,
    childPassengerNum: 0,
    searchCabinType: 0
  };
  const sessionKey = await callAliMtop(context, page, "mtop.btrip.sparta.flight.save.session", {
    sessionValue: JSON.stringify({ intlAdjustPriceGrey: false })
  });
  const searchParamKey = await callAliMtop(context, page, "mtop.btrip.sparta.intl.flight.searchparam.save", {
    searchParamJsonStr: JSON.stringify({ searchCondition, searchJourneys }),
    isOldApi: false
  });
  const params = new URLSearchParams({
    spm: "181",
    corpId: identity.corpId,
    userId: identity.userId,
    fpt: identity.fpt || "bIdentify(main.newpc.newpc.c)",
    currentJourneyIndex: "0",
    tripType: "0",
    itineraryNo,
    searchParamKey,
    depCityName: route.origin,
    arrCityName: route.destination,
    sessionKey
  });

  await page.goto(`https://travel.alibtrip.com/flight-new?${params.toString()}#/i-search-list`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(5_000);
}

async function searchAliSameFlightQuote(
  context: BrowserContext,
  artifactDir: string,
  route: PilotRoute,
  selectedFlight: QingmaoFlightCandidate,
  screenshotFilename = "阿里商旅-同航班.png"
): Promise<SameFlightPlatformQuote> {
  const page = await getOrCreatePlatformPage(context, "https://travel.alibtrip.com");
  const screenshotPath = path.join(artifactDir, screenshotFilename);
  const preExistingItineraryId = readAliItineraryIdFromUrl(page.url());

  try {
    await page.goto("https://travel.alibtrip.com/index.html#/flight", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(3_000);

    if (route.scope === "国际") {
      const itineraryNo = await createAliFlightItineraryNo(context, page);
      await navigateAliInternationalSearchList(context, page, route, itineraryNo);
      const bodyText = await waitForSearchText(page, selectedFlight.flightNo, { returnOnGenericResult: false });
      if (!bodyText.includes(selectedFlight.flightNo) && /出错了|异常/.test(bodyText)) {
        throw new Error(explainAliInternationalSubmitFailure(bodyText, ""));
      }
      const extracted = extractSameFlightQuoteFromText(bodyText, selectedFlight.flightNo);
      const evidencePath = await savePageEvidence(page, screenshotPath, {
        platform: "阿里商旅",
        route,
        selectedFlight,
        price: extracted.price,
        bodyText
      });

      return {
        platform: "阿里商旅",
        status: extracted.status,
        price: extracted.price,
        finalUrl: page.url(),
        screenshotPath: evidencePath,
        rawText: extracted.rawText
      };
    }

    const itineraryId = preExistingItineraryId ?? await createAliFlightItineraryNo(context, page);
    await page.goto(buildAliSearchListUrl(page.url(), route, itineraryId), { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(5_000);

    const bodyText = await waitForSearchText(page, selectedFlight.flightNo);
    const extracted = extractSameFlightQuoteFromText(bodyText, selectedFlight.flightNo);
    const evidencePath = await savePageEvidence(page, screenshotPath, {
      platform: "阿里商旅",
      route,
      selectedFlight,
      price: extracted.price,
      bodyText
    });

    return {
      platform: "阿里商旅",
      status: extracted.status,
      price: extracted.price,
      finalUrl: page.url(),
      screenshotPath: evidencePath,
      rawText: extracted.rawText
    };
  } catch (error) {
    const errorText = errorMessage(error);
    const evidencePath = await savePageEvidence(page, screenshotPath, {
      platform: "阿里商旅",
      route,
      selectedFlight,
      price: null,
      error: errorText
    });
    return {
      platform: "阿里商旅",
      status: "failed",
      price: null,
      finalUrl: page.url(),
      screenshotPath: evidencePath,
      error: errorText
    };
  }
}
