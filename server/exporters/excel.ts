import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { summarizeFlight, summarizeQuoteSet } from "../../src/domain/comparison";
import {
  resolveHotelDisplayDecision,
  resolveHotelPrimaryRatePlan
} from "../../src/domain/hotelRatePlans";
import type {
  CollectionBatch,
  FlightSample,
  HotelRatePlan,
  HotelRatePlanLabel,
  HotelSample,
  PlatformName,
  PlatformQuote
} from "../../src/domain/types";

const BRAND_BLUE = "0F3D5E";
const BRAND_TEAL = "0E8F7A";
const SOFT_GRAY = "F8FAFC";
const BORDER = "D8E2EF";
const MUTED_TEXT = "667085";
const HEADER_ROW = 4;
const PLATFORMS: PlatformName[] = ["青猫差旅", "携程商旅", "阿里商旅", "在途商旅"];
const PLATFORM_STYLE: Record<PlatformName, { fill: string; font: string; code: string }> = {
  青猫差旅: { fill: "E8F7F0", font: BRAND_TEAL, code: "QM" },
  携程商旅: { fill: "EAF3FF", font: "1769E0", code: "CT" },
  阿里商旅: { fill: "FFF4E2", font: "B45309", code: "AL" },
  在途商旅: { fill: "F1ECFF", font: "6D28D9", code: "ZT" }
};

const RATE_PLAN_ORDER: HotelRatePlanLabel[] = ["大床无早餐", "大床有早餐", "双床无早餐", "双床有早餐"];

function money(value: number | null | undefined) {
  return typeof value === "number" ? value : "";
}

function routeName(origin: string, destination: string) {
  return `${origin}-${destination}`;
}

function quoteByPlatform(quotes: PlatformQuote[], platform: PlatformName) {
  return quotes.find((quote) => quote.platform === platform);
}

function lowestAvailablePlatform(quotes: PlatformQuote[]) {
  return [...quotes]
    .filter((quote) => quote.available && typeof quote.price === "number")
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))[0]?.platform;
}

function primaryRatePlan(hotel: HotelSample) {
  return resolveHotelPrimaryRatePlan(hotel) ?? hotel.ratePlans[0];
}

function orderedRatePlans(hotel: HotelSample) {
  const primary = primaryRatePlan(hotel);
  return [
    ...hotel.ratePlans.filter((ratePlan) => ratePlan.label === primary?.label),
    ...hotel.ratePlans
      .filter((ratePlan) => ratePlan.label !== primary?.label)
      .sort((a, b) => RATE_PLAN_ORDER.indexOf(a.label) - RATE_PLAN_ORDER.indexOf(b.label))
  ];
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  })
    .format(new Date(value))
    .replace(/\//g, "-");
}

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${BRAND_BLUE}` } };
  row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  row.height = 32;
}

function addTitle(sheet: ExcelJS.Worksheet, title: string, subtitle: string, columns: number, note?: string) {
  sheet.mergeCells(1, 1, 1, columns);
  sheet.getCell(1, 1).value = title;
  sheet.getCell(1, 1).font = { bold: true, size: 20, color: { argb: `FF${BRAND_BLUE}` } };
  sheet.getCell(1, 1).alignment = { vertical: "middle" };
  sheet.getRow(1).height = 34;

  sheet.mergeCells(2, 1, 2, columns);
  sheet.getCell(2, 1).value = subtitle;
  sheet.getCell(2, 1).font = { size: 11, color: { argb: `FF${MUTED_TEXT}` } };
  sheet.getCell(2, 1).alignment = { vertical: "middle", wrapText: true };
  sheet.getRow(2).height = 24;

  sheet.mergeCells(3, 1, 3, columns);
  const noteCell = sheet.getCell(3, 1);
  noteCell.value = note ?? "第二版验收版：不内嵌图片，网页截图证据保存在离线网页包证据目录中，Excel 只保留索引、路径和复核字段。";
  noteCell.font = { size: 10, color: { argb: `FF${BRAND_TEAL}` }, bold: true };
  noteCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF7F5" } };
  noteCell.alignment = { vertical: "middle", wrapText: true };
  sheet.getRow(3).height = 24;
}

function addTableShell(sheet: ExcelJS.Worksheet, title: string, subtitle: string, columns: number, header: string[], note?: string) {
  addTitle(sheet, title, subtitle, columns, note);
  const headerRow = sheet.getRow(HEADER_ROW);
  header.forEach((value, index) => {
    headerRow.getCell(index + 1).value = value;
  });
  styleHeader(headerRow);
}

function styleBodyRow(row: ExcelJS.Row, index: number) {
  row.height = 31;
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: index % 2 === 0 ? "FFFFFFFF" : `FF${SOFT_GRAY}` } };
    cell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.font = { color: { argb: "FF10233F" }, size: 10 };
  });
}

function stylePlatformPriceCells(row: ExcelJS.Row, quotes: PlatformQuote[], columnByPlatform: Record<PlatformName, number>) {
  const lowestPlatform = lowestAvailablePlatform(quotes);
  for (const platform of PLATFORMS) {
    const cell = row.getCell(columnByPlatform[platform]);
    const platformStyle = PLATFORM_STYLE[platform];
    cell.numFmt = '"¥"#,##0';
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${platformStyle.fill}` } };
    cell.font =
      platform === lowestPlatform
        ? { bold: true, size: 11, color: { argb: `FF${platformStyle.font}` } }
        : { bold: false, size: 11, color: { argb: `FF${platformStyle.font}` } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  }
}

function styleGapCell(cell: ExcelJS.Cell, gap: number | null) {
  cell.numFmt = '[Color46]"高"#,##0"元";[Color10]"低"#,##0"元";"持平";@';
  cell.font = {
    bold: true,
    color: { argb: gap === null ? `FF${BRAND_BLUE}` : "FFFFFFFF" }
  };
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: gap === null ? "FFEAF3FF" : gap < 0 ? `FF${BRAND_TEAL}` : gap === 0 ? `FF${BRAND_BLUE}` : "FFB45309" }
  };
  cell.alignment = { vertical: "middle", horizontal: "center" };
}

function comparisonFormula(rowNumber: number) {
  return `IF(OR(I${rowNumber}="",COUNT(J${rowNumber}:L${rowNumber})<3),"",I${rowNumber}-MIN(J${rowNumber}:L${rowNumber}))`;
}

function hotelComparisonFormula(rowNumber: number) {
  return `IF(OR(P${rowNumber}="",COUNT(Q${rowNumber}:S${rowNumber})<3),"",P${rowNumber}-MIN(Q${rowNumber}:S${rowNumber}))`;
}

function platformEvidenceCode(platform: PlatformName) {
  return PLATFORM_STYLE[platform].code;
}

function flightEvidenceId(sampleIndex: number, platform: PlatformName) {
  return `F-${String(sampleIndex + 1).padStart(2, "0")}-${platformEvidenceCode(platform)}`;
}

function hotelEvidenceId(hotelIndex: number, ratePlanIndex: number, platform: PlatformName) {
  return `H-${String(hotelIndex + 1).padStart(3, "0")}-R${ratePlanIndex + 1}-${platformEvidenceCode(platform)}`;
}

function evidenceRefs(ids: string[]) {
  return ids.filter(Boolean).join(" / ");
}

function rawHotelName(hotel: HotelSample, quote?: PlatformQuote) {
  return quote?.rawHotelName || hotel.hotelName;
}

function rawRoomName(ratePlan: HotelRatePlan, quote?: PlatformQuote) {
  return quote?.rawRoomName || `${ratePlan.label}房`;
}

function missingReason(quotes: PlatformQuote[]) {
  const reasons = quotes
    .filter((quote) => !quote.available || typeof quote.price !== "number")
    .map((quote) => quote.missingReason || `${quote.platform}${quote.status === "可订" ? "暂无价格" : quote.status}`);
  return reasons.join("；");
}

function hotelSalesDisplayEligible(hotel: HotelSample) {
  return resolveHotelDisplayDecision(hotel.ratePlans).salesDisplayEligible;
}

function hotelSalesDisplayReason(hotel: HotelSample) {
  return resolveHotelDisplayDecision(hotel.ratePlans).salesDisplayReason;
}

function addOverviewSheet(workbook: ExcelJS.Workbook, batch: CollectionBatch) {
  const sheet = workbook.addWorksheet("总览页", { views: [{ state: "frozen", ySplit: HEADER_ROW }] });
  addTitle(sheet, "青猫差旅价格对比总览", `数据时间：${formatDateTime(batch.generatedAt)}。批次：${batch.id}`, 8);

  const hotelSamples = batch.hotels ?? [];
  const hotelRateRows = hotelSamples.reduce((sum, hotel) => sum + hotel.ratePlans.length, 0);
  const flightSummaries = batch.samples.map(summarizeFlight);
  const hotelPrimarySummaries = hotelSamples.map((hotel) => summarizeQuoteSet(primaryRatePlan(hotel).quotes));
  const countByGap = (values: Array<{ qingmaoGap: number | null }>, predicate: (gap: number) => boolean) =>
    values.filter((item) => typeof item.qingmaoGap === "number" && predicate(item.qingmaoGap)).length;

  const summaryRows = [
    ["项目", "结果", "说明"],
    ["航班样本", batch.samples.length, "国内和国际航班四平台价格"],
    ["酒店样本", hotelSamples.length, "五个集团，每家酒店推荐口径和其他口径"],
    ["酒店口径行", hotelRateRows, "每家酒店最多 4 个房型早餐口径"],
    ["航班青猫低价", countByGap(flightSummaries, (gap) => gap < 0), "青猫低于对比口径"],
    ["酒店青猫低价", countByGap(hotelPrimarySummaries, (gap) => gap < 0), "按酒店推荐口径统计"],
    ["失败记录", batch.failureNotes?.length ?? 0, "候选放弃、平台缺失和批次异常"]
  ];

  summaryRows.forEach((values, index) => {
    const row = sheet.getRow(HEADER_ROW + index);
    values.forEach((value, cellIndex) => {
      row.getCell(cellIndex + 1).value = value;
    });
    if (index === 0) {
      styleHeader(row);
    } else {
      styleBodyRow(row, index);
      row.getCell(2).font = { bold: true, color: { argb: `FF${BRAND_TEAL}` }, size: 13 };
    }
  });

  const guideStart = HEADER_ROW + summaryRows.length + 2;
  const guideHeader = sheet.getRow(guideStart);
  ["Sheet", "用途"].forEach((value, index) => {
    guideHeader.getCell(index + 1).value = value;
  });
  styleHeader(guideHeader);
  [
    ["航班汇总页", "客户复核同一航班四平台价格和青猫差额"],
    ["酒店汇总页", "按酒店推荐口径查看四平台对比"],
    ["酒店集团明细页", "保留每家酒店 4 个口径、原始房型名和归一口径"],
    ["航班网页截图索引页", "定位航班平台网页截图或网页快照"],
    ["酒店网页截图索引页", "定位酒店平台网页截图或网页快照"],
    ["内部留痕页", "保留更完整的平台状态、证据路径和原始字段"],
    ["失败记录页", "保留候选放弃、缺失、采集失败原因"]
  ].forEach((values, index) => {
    const row = sheet.getRow(guideStart + index + 1);
    values.forEach((value, cellIndex) => {
      row.getCell(cellIndex + 1).value = value;
    });
    styleBodyRow(row, index);
  });

  sheet.columns = [{ width: 20 }, { width: 18 }, { width: 54 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];
}

function addFlightSheet(workbook: ExcelJS.Workbook, batch: CollectionBatch) {
  const sheet = workbook.addWorksheet("航班汇总页", { views: [{ state: "frozen", ySplit: HEADER_ROW }] });
  addTableShell(sheet, "航班四平台价格对比", `数据时间：${formatDateTime(batch.generatedAt)}。同一日期、同一航班号、经济舱口径。`, 16, [
    "序号",
    "国内/国际",
    "航线",
    "出行日期",
    "航班号",
    "航司",
    "舱位",
    "直飞/中转",
    "青猫差旅",
    "携程商旅",
    "阿里商旅",
    "在途商旅",
    "最低价平台",
    "青猫差额",
    "对比结论",
    "网页截图索引"
  ]);

  for (const [index, sample] of batch.samples.entries()) {
    const summary = summarizeFlight(sample);
    const rowNumber = sheet.rowCount + 1;
    const evidenceIds = PLATFORMS.map((platform) => flightEvidenceId(index, platform));
    const row = sheet.addRow([
      index + 1,
      sample.scope,
      routeName(sample.origin, sample.destination),
      sample.travelDate,
      sample.flightNo,
      sample.airline,
      sample.cabin,
      sample.directType,
      money(quoteByPlatform(sample.quotes, "青猫差旅")?.price),
      money(quoteByPlatform(sample.quotes, "携程商旅")?.price),
      money(quoteByPlatform(sample.quotes, "阿里商旅")?.price),
      money(quoteByPlatform(sample.quotes, "在途商旅")?.price),
      summary.lowestPlatform,
      {
        formula: comparisonFormula(rowNumber),
        result: summary.qingmaoGap ?? undefined
      },
      summary.conclusion,
      evidenceRefs(evidenceIds)
    ]);
    styleBodyRow(row, index);
    stylePlatformPriceCells(row, sample.quotes, { 青猫差旅: 9, 携程商旅: 10, 阿里商旅: 11, 在途商旅: 12 });
    styleGapCell(row.getCell(14), summary.qingmaoGap);
    row.getCell(15).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    row.getCell(16).font = { size: 9, color: { argb: `FF${MUTED_TEXT}` } };
  }

  sheet.columns = [
    { width: 7 },
    { width: 12 },
    { width: 18 },
    { width: 13 },
    { width: 12 },
    { width: 14 },
    { width: 10 },
    { width: 12 },
    { width: 13 },
    { width: 13 },
    { width: 13 },
    { width: 13 },
    { width: 15 },
    { width: 12 },
    { width: 38 },
    { width: 30 }
  ];
  sheet.autoFilter = `A${HEADER_ROW}:P${sheet.rowCount}`;
}

function addHotelSummarySheet(workbook: ExcelJS.Workbook, batch: CollectionBatch) {
  const sheet = workbook.addWorksheet("酒店汇总页", { views: [{ state: "frozen", ySplit: HEADER_ROW }] });
  addTableShell(sheet, "酒店默认展示口径价格对比", `数据时间：${formatDateTime(batch.generatedAt)}。每家酒店默认展示当前最完整、最可比的口径；至少 1 个口径四平台完整才进入销售主展示。`, 17, [
    "序号",
    "集团",
    "品牌",
    "城市",
    "酒店",
    "入住日期",
    "退房日期",
    "推荐口径",
    "青猫差旅",
    "携程商旅",
    "阿里商旅",
    "在途商旅",
    "最低价平台",
    "青猫差额",
    "对比结论",
    "网页截图索引",
    "缺失原因"
  ]);

  const displayHotels = (batch.hotels ?? []).filter(hotelSalesDisplayEligible);

  for (const [index, hotel] of displayHotels.entries()) {
    const ratePlan = primaryRatePlan(hotel);
    const summary = summarizeQuoteSet(ratePlan.quotes);
    const rowNumber = sheet.rowCount + 1;
    const sourceHotelIndex = (batch.hotels ?? []).indexOf(hotel);
    const ratePlanIndex = RATE_PLAN_ORDER.indexOf(ratePlan.label);
    const evidenceIds = PLATFORMS.map((platform) => hotelEvidenceId(sourceHotelIndex, ratePlanIndex, platform));
    const row = sheet.addRow([
      index + 1,
      hotel.group,
      hotel.brand,
      hotel.city,
      hotel.hotelName,
      hotel.checkInDate,
      hotel.checkOutDate,
      ratePlan.label,
      money(quoteByPlatform(ratePlan.quotes, "青猫差旅")?.price),
      money(quoteByPlatform(ratePlan.quotes, "携程商旅")?.price),
      money(quoteByPlatform(ratePlan.quotes, "阿里商旅")?.price),
      money(quoteByPlatform(ratePlan.quotes, "在途商旅")?.price),
      summary.lowestPlatform,
      {
        formula: comparisonFormula(rowNumber),
        result: summary.qingmaoGap ?? undefined
      },
      summary.conclusion,
      evidenceRefs(evidenceIds),
      missingReason(ratePlan.quotes)
    ]);
    styleBodyRow(row, index);
    stylePlatformPriceCells(row, ratePlan.quotes, { 青猫差旅: 9, 携程商旅: 10, 阿里商旅: 11, 在途商旅: 12 });
    styleGapCell(row.getCell(14), summary.qingmaoGap);
    row.getCell(15).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  }

  sheet.columns = [
    { width: 7 },
    { width: 13 },
    { width: 13 },
    { width: 10 },
    { width: 28 },
    { width: 13 },
    { width: 13 },
    { width: 12 },
    { width: 13 },
    { width: 13 },
    { width: 13 },
    { width: 13 },
    { width: 15 },
    { width: 12 },
    { width: 38 },
    { width: 30 },
    { width: 24 }
  ];
  sheet.autoFilter = `A${HEADER_ROW}:Q${sheet.rowCount}`;
}

function addHotelGroupDetailSheet(workbook: ExcelJS.Workbook, batch: CollectionBatch) {
  const sheet = workbook.addWorksheet("酒店集团明细页", { views: [{ state: "frozen", ySplit: HEADER_ROW }] });
  addTableShell(sheet, "酒店集团与房型口径明细", `数据时间：${formatDateTime(batch.generatedAt)}。销售明细只展示至少 1 个口径四平台完整的酒店，并保留每家酒店 4 个口径。`, 27, [
    "序号",
    "集团",
    "品牌",
    "城市",
    "酒店原始名称",
    "酒店归一名称",
    "入住日期",
    "退房日期",
    "间夜",
    "归一口径",
    "是否推荐口径",
    "青猫原始房型名",
    "携程原始房型名",
    "阿里原始房型名",
    "在途原始房型名",
    "青猫差旅",
    "携程商旅",
    "阿里商旅",
    "在途商旅",
    "最低价平台",
    "青猫差额",
    "对比结论",
    "青猫证据编号",
    "携程证据编号",
    "阿里证据编号",
    "在途证据编号",
    "缺失原因"
  ]);

  let rowIndex = 0;
  const displayHotels = (batch.hotels ?? []).filter(hotelSalesDisplayEligible);

  for (const hotel of displayHotels) {
    const hotelIndex = (batch.hotels ?? []).indexOf(hotel);
    const primary = primaryRatePlan(hotel);
    for (const ratePlan of orderedRatePlans(hotel)) {
      const ratePlanIndex = RATE_PLAN_ORDER.indexOf(ratePlan.label);
      const summary = summarizeQuoteSet(ratePlan.quotes);
      const rowNumber = sheet.rowCount + 1;
      const qingmao = quoteByPlatform(ratePlan.quotes, "青猫差旅");
      const ctrip = quoteByPlatform(ratePlan.quotes, "携程商旅");
      const alib = quoteByPlatform(ratePlan.quotes, "阿里商旅");
      const ztrip = quoteByPlatform(ratePlan.quotes, "在途商旅");
      const row = sheet.addRow([
        rowIndex + 1,
        hotel.group,
        hotel.brand,
        hotel.city,
        rawHotelName(hotel, qingmao),
        hotel.hotelName,
        hotel.checkInDate,
        hotel.checkOutDate,
        hotel.nights,
        ratePlan.label,
        ratePlan.label === primary.label ? "是" : "否",
        rawRoomName(ratePlan, qingmao),
        rawRoomName(ratePlan, ctrip),
        rawRoomName(ratePlan, alib),
        rawRoomName(ratePlan, ztrip),
        money(qingmao?.price),
        money(ctrip?.price),
        money(alib?.price),
        money(ztrip?.price),
        summary.lowestPlatform,
        {
          formula: hotelComparisonFormula(rowNumber),
          result: summary.qingmaoGap ?? undefined
        },
        summary.conclusion,
        hotelEvidenceId(hotelIndex, ratePlanIndex, "青猫差旅"),
        hotelEvidenceId(hotelIndex, ratePlanIndex, "携程商旅"),
        hotelEvidenceId(hotelIndex, ratePlanIndex, "阿里商旅"),
        hotelEvidenceId(hotelIndex, ratePlanIndex, "在途商旅"),
        missingReason(ratePlan.quotes)
      ]);
      styleBodyRow(row, rowIndex);
      stylePlatformPriceCells(row, ratePlan.quotes, { 青猫差旅: 16, 携程商旅: 17, 阿里商旅: 18, 在途商旅: 19 });
      styleGapCell(row.getCell(21), summary.qingmaoGap);
      if (ratePlan.label === primary.label) {
        row.height = 36;
        row.getCell(10).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F7F0" } };
        row.getCell(10).font = { bold: true, color: { argb: `FF${BRAND_TEAL}` } };
        row.getCell(11).font = { bold: true, color: { argb: `FF${BRAND_TEAL}` } };
      }
      rowIndex += 1;
    }
  }

  sheet.columns = [
    { width: 7 },
    { width: 13 },
    { width: 13 },
    { width: 10 },
    { width: 30 },
    { width: 30 },
    { width: 13 },
    { width: 13 },
    { width: 8 },
    { width: 12 },
    { width: 10 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 13 },
    { width: 13 },
    { width: 13 },
    { width: 13 },
    { width: 15 },
    { width: 12 },
    { width: 38 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 24 }
  ];
  sheet.autoFilter = `A${HEADER_ROW}:AA${sheet.rowCount}`;
}

function addFlightEvidenceSheet(workbook: ExcelJS.Workbook, batch: CollectionBatch) {
  const sheet = workbook.addWorksheet("航班网页截图索引页", { views: [{ state: "frozen", ySplit: HEADER_ROW }] });
  addTableShell(sheet, "航班网页截图索引", "用于按证据编号定位离线网页包中的平台网页截图或网页快照。", 12, [
    "证据编号",
    "样本序号",
    "国内/国际",
    "航线",
    "出行日期",
    "航班号",
    "平台",
    "状态",
    "价格",
    "证据相对路径",
    "来源页面",
    "说明"
  ]);

  let rowIndex = 0;
  batch.samples.forEach((sample, sampleIndex) => {
    PLATFORMS.forEach((platform) => {
      const quote = quoteByPlatform(sample.quotes, platform);
      const row = sheet.addRow([
        flightEvidenceId(sampleIndex, platform),
        sampleIndex + 1,
        sample.scope,
        routeName(sample.origin, sample.destination),
        sample.travelDate,
        sample.flightNo,
        platform,
        quote?.status ?? "采集失败",
        money(quote?.price),
        quote?.evidencePath ?? "",
        quote?.sourceUrl ?? "",
        quote?.available ? "可复核" : quote?.missingReason || quote?.status || "暂无"
      ]);
      styleBodyRow(row, rowIndex);
      row.getCell(9).numFmt = '"¥"#,##0';
      rowIndex += 1;
    });
  });

  sheet.columns = [{ width: 14 }, { width: 10 }, { width: 10 }, { width: 18 }, { width: 13 }, { width: 12 }, { width: 13 }, { width: 12 }, { width: 12 }, { width: 46 }, { width: 36 }, { width: 20 }];
  sheet.autoFilter = `A${HEADER_ROW}:L${sheet.rowCount}`;
}

function addHotelEvidenceSheet(workbook: ExcelJS.Workbook, batch: CollectionBatch) {
  const sheet = workbook.addWorksheet("酒店网页截图索引页", { views: [{ state: "frozen", ySplit: HEADER_ROW }] });
  addTableShell(sheet, "酒店网页截图索引", "用于按证据编号定位酒店、口径和平台对应的网页截图或网页快照。", 14, [
    "证据编号",
    "酒店序号",
    "集团",
    "城市",
    "酒店",
    "入住日期",
    "退房日期",
    "口径",
    "平台",
    "状态",
    "价格",
    "证据相对路径",
    "来源页面",
    "说明"
  ]);

  let rowIndex = 0;
  (batch.hotels ?? []).forEach((hotel, hotelIndex) => {
    orderedRatePlans(hotel).forEach((ratePlan) => {
      const ratePlanIndex = RATE_PLAN_ORDER.indexOf(ratePlan.label);
      PLATFORMS.forEach((platform) => {
        const quote = quoteByPlatform(ratePlan.quotes, platform);
        const row = sheet.addRow([
          hotelEvidenceId(hotelIndex, ratePlanIndex, platform),
          hotelIndex + 1,
          hotel.group,
          hotel.city,
          hotel.hotelName,
          hotel.checkInDate,
          hotel.checkOutDate,
          ratePlan.label,
          platform,
          quote?.status ?? "采集失败",
          money(quote?.price),
          quote?.evidencePath ?? "",
          quote?.sourceUrl ?? "",
          quote?.available ? "可复核" : quote?.missingReason || quote?.status || "暂无"
        ]);
        styleBodyRow(row, rowIndex);
        row.getCell(11).numFmt = '"¥"#,##0';
        rowIndex += 1;
      });
    });
  });

  sheet.columns = [{ width: 16 }, { width: 10 }, { width: 13 }, { width: 10 }, { width: 28 }, { width: 13 }, { width: 13 }, { width: 12 }, { width: 13 }, { width: 12 }, { width: 12 }, { width: 50 }, { width: 36 }, { width: 20 }];
  sheet.autoFilter = `A${HEADER_ROW}:N${sheet.rowCount}`;
}

function addInternalTraceSheet(workbook: ExcelJS.Workbook, batch: CollectionBatch) {
  const sheet = workbook.addWorksheet("内部留痕页", { views: [{ state: "frozen", ySplit: HEADER_ROW }] });
  addTableShell(sheet, "内部留痕", "保留采集记录、平台状态、原始字段和证据路径，用于内部复盘。", 16, [
    "类型",
    "样本ID",
    "路线/集团",
    "对象名称",
    "日期",
    "口径/舱位",
    "平台",
    "状态",
    "可订",
    "价格",
    "原始酒店名",
    "原始房型名",
    "归一口径",
    "证据路径",
    "来源URL",
    "规则说明"
  ]);

  let rowIndex = 0;
  batch.samples.forEach((sample) => {
    sample.quotes.forEach((quote) => {
      const row = sheet.addRow([
        "航班",
        sample.id,
        routeName(sample.origin, sample.destination),
        sample.flightNo,
        sample.travelDate,
        sample.cabin,
        quote.platform,
        quote.status,
        quote.available ? "是" : "否",
        money(quote.price),
        "",
        "",
        "",
        quote.evidencePath,
        quote.sourceUrl,
        `${quote.refundRule}；${quote.baggageRule}`
      ]);
      styleBodyRow(row, rowIndex);
      row.getCell(10).numFmt = '"¥"#,##0';
      rowIndex += 1;
    });
  });

  (batch.hotels ?? []).forEach((hotel) => {
    orderedRatePlans(hotel).forEach((ratePlan) => {
      ratePlan.quotes.forEach((quote) => {
        const row = sheet.addRow([
          "酒店",
          hotel.id,
          hotel.group,
          hotel.hotelName,
          `${hotel.checkInDate} 至 ${hotel.checkOutDate}`,
          ratePlan.label,
          quote.platform,
          quote.status,
          quote.available ? "是" : "否",
          money(quote.price),
          rawHotelName(hotel, quote),
          rawRoomName(ratePlan, quote),
          quote.normalizedRoomLabel || ratePlan.label,
          quote.evidencePath,
          quote.sourceUrl,
          `${quote.refundRule}；${quote.baggageRule}`
        ]);
        styleBodyRow(row, rowIndex);
        row.getCell(10).numFmt = '"¥"#,##0';
        rowIndex += 1;
      });
    });
  });

  sheet.columns = [{ width: 9 }, { width: 15 }, { width: 18 }, { width: 28 }, { width: 24 }, { width: 12 }, { width: 13 }, { width: 12 }, { width: 8 }, { width: 12 }, { width: 28 }, { width: 20 }, { width: 12 }, { width: 50 }, { width: 36 }, { width: 36 }];
  sheet.autoFilter = `A${HEADER_ROW}:P${sheet.rowCount}`;
}

function addFailureSheet(workbook: ExcelJS.Workbook, batch: CollectionBatch) {
  const sheet = workbook.addWorksheet("失败记录页", { views: [{ state: "frozen", ySplit: HEADER_ROW }] });
  addTableShell(sheet, "失败记录", "保留批次失败、候选放弃、平台缺失、口径缺失等原因。", 9, [
    "序号",
    "类型",
    "对象",
    "平台",
    "口径",
    "状态",
    "原因",
    "证据路径",
    "来源URL"
  ]);

  const records: Array<[string, string, string, string, string, string, string, string]> = [];
  for (const note of batch.failureNotes ?? []) {
    records.push(["批次", batch.id, "", "", "采集失败", note, "", ""]);
  }

  batch.samples.forEach((sample) => {
    sample.quotes
      .filter((quote) => !quote.available || typeof quote.price !== "number")
      .forEach((quote) => {
        records.push(["航班", `${routeName(sample.origin, sample.destination)} ${sample.flightNo}`, quote.platform, sample.cabin, quote.status, quote.missingReason || quote.status, quote.evidencePath, quote.sourceUrl]);
      });
  });

  (batch.hotels ?? []).forEach((hotel) => {
    if (!hotelSalesDisplayEligible(hotel)) {
      records.push(["酒店", hotel.hotelName, "", "全部口径", "不进销售主展示", hotelSalesDisplayReason(hotel), "", ""]);
    }
    orderedRatePlans(hotel).forEach((ratePlan) => {
      ratePlan.quotes
        .filter((quote) => !quote.available || typeof quote.price !== "number")
        .forEach((quote) => {
          records.push(["酒店", hotel.hotelName, quote.platform, ratePlan.label, quote.status, quote.missingReason || quote.status, quote.evidencePath, quote.sourceUrl]);
        });
    });
  });

  if (!records.length) {
    records.push(["批次", batch.id, "", "", "无失败", "暂无失败记录", "", ""]);
  }

  records.forEach((record, index) => {
    const row = sheet.addRow([index + 1, ...record]);
    styleBodyRow(row, index);
  });

  sheet.columns = [{ width: 7 }, { width: 10 }, { width: 30 }, { width: 13 }, { width: 12 }, { width: 12 }, { width: 36 }, { width: 50 }, { width: 36 }];
  sheet.autoFilter = `A${HEADER_ROW}:I${sheet.rowCount}`;
}

export async function exportBatchWorkbook(batch: CollectionBatch, outputDir: string) {
  await fs.mkdir(outputDir, { recursive: true });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "青猫差旅价格采集工具";
  workbook.created = new Date(batch.generatedAt);

  addOverviewSheet(workbook, batch);
  addFlightSheet(workbook, batch);
  addHotelSummarySheet(workbook, batch);
  addHotelGroupDetailSheet(workbook, batch);
  addFlightEvidenceSheet(workbook, batch);
  addHotelEvidenceSheet(workbook, batch);
  addInternalTraceSheet(workbook, batch);
  addFailureSheet(workbook, batch);

  for (const sheet of workbook.worksheets) {
    sheet.eachRow((row) => {
      row.border = {
        bottom: { style: "thin", color: { argb: "FFE5E7EB" } }
      };
    });
  }

  const filename = `青猫差旅一体化比价-${batch.id}.xlsx`;
  const outputPath = path.join(outputDir, filename);
  await workbook.xlsx.writeFile(outputPath);

  return {
    path: outputPath,
    filename,
    sheets: workbook.worksheets.map((sheet) => sheet.name)
  };
}
