import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { summarizeFlight } from "../../src/domain/comparison";
import type { CollectionBatch } from "../../src/domain/types";

const BRAND_BLUE = "0F3D5E";
const BRAND_TEAL = "0E8F7A";
const SOFT_GREEN = "E8F7F0";
const SOFT_AMBER = "FFF7E8";
const SOFT_BLUE = "EFF6FF";
const SOFT_GRAY = "F8FAFC";
const BORDER = "D8E2EF";
const MUTED_TEXT = "667085";
const HEADER_ROW = 8;

function money(value: number | null) {
  return typeof value === "number" ? value : "";
}

function routeName(origin: string, destination: string) {
  return `${origin}-${destination}`;
}

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${BRAND_BLUE}` } };
  row.alignment = { vertical: "middle", horizontal: "center" };
  row.height = 30;
}

function addTitle(sheet: ExcelJS.Worksheet, title: string, subtitle: string, columns: number) {
  sheet.mergeCells(1, 1, 1, columns);
  sheet.getCell(1, 1).value = title;
  sheet.getCell(1, 1).font = { bold: true, size: 18, color: { argb: `FF${BRAND_BLUE}` } };
  sheet.getCell(1, 1).alignment = { vertical: "middle" };
  sheet.getRow(1).height = 30;

  sheet.mergeCells(2, 1, 2, columns);
  sheet.getCell(2, 1).value = subtitle;
  sheet.getCell(2, 1).font = { size: 11, color: { argb: "FF667085" } };
  sheet.getRow(2).height = 22;
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

function summaryMetrics(batch: CollectionBatch) {
  return batch.samples.reduce(
    (metrics, sample) => {
      const summary = summarizeFlight(sample);
      if (summary.qingmaoGap !== null && summary.qingmaoGap < 0) metrics.lower += 1;
      if (summary.qingmaoGap === 0) metrics.tie += 1;
      if (summary.qingmaoGap !== null && summary.qingmaoGap > 0) metrics.higher += 1;
      return metrics;
    },
    { lower: 0, tie: 0, higher: 0 }
  );
}

function addMetricCard(
  sheet: ExcelJS.Worksheet,
  startCol: number,
  endCol: number,
  label: string,
  value: string,
  note: string,
  color: string
) {
  sheet.mergeCells(4, startCol, 4, endCol);
  sheet.mergeCells(5, startCol, 5, endCol);
  sheet.mergeCells(6, startCol, 6, endCol);

  const labelCell = sheet.getCell(4, startCol);
  const valueCell = sheet.getCell(5, startCol);
  const noteCell = sheet.getCell(6, startCol);

  for (const cell of [labelCell, valueCell, noteCell]) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
    cell.border = {
      top: { style: "thin", color: { argb: `FF${BORDER}` } },
      left: { style: "thin", color: { argb: `FF${BORDER}` } },
      bottom: { style: "thin", color: { argb: `FF${BORDER}` } },
      right: { style: "thin", color: { argb: `FF${BORDER}` } }
    };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  }

  labelCell.value = label;
  labelCell.font = { bold: true, size: 10, color: { argb: `FF${MUTED_TEXT}` } };
  valueCell.value = value;
  valueCell.font = { bold: true, size: 22, color: { argb: `FF${color}` } };
  noteCell.value = note;
  noteCell.font = { size: 9, color: { argb: `FF${MUTED_TEXT}` } };
}

function addSummaryHero(sheet: ExcelJS.Worksheet, batch: CollectionBatch, columns: number) {
  const metrics = summaryMetrics(batch);

  sheet.mergeCells(1, 1, 1, columns);
  sheet.getCell(1, 1).value = "青猫差旅航班价格对比汇总";
  sheet.getCell(1, 1).font = { bold: true, size: 22, color: { argb: `FF${BRAND_BLUE}` } };
  sheet.getCell(1, 1).alignment = { vertical: "middle" };
  sheet.getRow(1).height = 34;

  sheet.mergeCells(2, 1, 2, columns);
  sheet.getCell(2, 1).value = `同一航班，三平台价格对比。数据时间：${formatDateTime(batch.generatedAt)}。`;
  sheet.getCell(2, 1).font = { size: 11, color: { argb: `FF${MUTED_TEXT}` } };
  sheet.getRow(2).height = 22;

  sheet.mergeCells(3, 1, 3, columns);
  sheet.getCell(3, 1).value = `对比平台：青猫差旅 / 携程商旅 / 阿里商旅    批次编号：${batch.id}`;
  sheet.getCell(3, 1).font = { size: 10, color: { argb: "FF94A3B8" } };
  sheet.getRow(3).height = 20;

  addMetricCard(sheet, 1, 3, "总样本", `${batch.sampleCount} 条`, "国内 / 国际航班", BRAND_BLUE);
  addMetricCard(sheet, 4, 6, "青猫低于竞品", `${metrics.lower} 条`, "客户现场重点展示", BRAND_TEAL);
  addMetricCard(sheet, 7, 9, "青猫持平", `${metrics.tie} 条`, "同航班最低价持平", BRAND_TEAL);
  addMetricCard(sheet, 10, 12, "青猫高于竞品", `${metrics.higher} 条`, "内部复盘关注", "B45309");
  addMetricCard(sheet, 13, 15, "网页截图索引", `${batch.sampleCount * 3} 条`, "三平台页面留痕", BRAND_BLUE);

  sheet.getRow(7).height = 12;
}

export async function exportBatchWorkbook(batch: CollectionBatch, outputDir: string) {
  await fs.mkdir(outputDir, { recursive: true });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "青猫差旅价格采集工具";
  workbook.created = new Date(batch.generatedAt);

  const summarySheet = workbook.addWorksheet("汇总页", {
    views: [{ state: "frozen", ySplit: HEADER_ROW }]
  });
  addSummaryHero(summarySheet, batch, 15);
  const summaryHeader = summarySheet.addRow([
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
    "竞品最低价平台",
    "青猫差额",
    "对比结论",
    "网页截图索引"
  ]);
  styleHeader(summaryHeader);

  for (const [index, sample] of batch.samples.entries()) {
    const summary = summarizeFlight(sample);
    const qingmao = sample.quotes.find((quote) => quote.platform === "青猫差旅");
    const ctrip = sample.quotes.find((quote) => quote.platform === "携程商旅");
    const ali = sample.quotes.find((quote) => quote.platform === "阿里商旅");
    const rowNumber = summarySheet.rowCount + 1;
    const row = summarySheet.addRow([
      index + 1,
      sample.scope,
      routeName(sample.origin, sample.destination),
      sample.travelDate,
      sample.flightNo,
      sample.airline,
      sample.cabin,
      sample.directType,
      money(qingmao?.price ?? null),
      money(ctrip?.price ?? null),
      money(ali?.price ?? null),
      summary.lowestPlatform,
      {
        formula: `IF(COUNT(J${rowNumber}:K${rowNumber})=0,"",I${rowNumber}-MIN(J${rowNumber}:K${rowNumber}))`,
        result: summary.qingmaoGap ?? undefined
      },
      summary.conclusion,
      { text: "查看网页截图索引", hyperlink: "#'网页截图索引页'!A4" }
    ]);
    row.height = 34;
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: index % 2 === 0 ? "FFFFFFFF" : `FF${SOFT_GRAY}` } };
    });

    for (const cellIndex of [9, 10, 11]) {
      const priceCell = row.getCell(cellIndex);
      priceCell.numFmt = '"¥"#,##0';
      priceCell.font = {
        bold: cellIndex === 9,
        color: { argb: cellIndex === 9 ? `FF${BRAND_TEAL}` : `FF${BRAND_BLUE}` }
      };
      priceCell.alignment = { vertical: "middle", horizontal: "center" };
    }

    row.getCell(9).fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${SOFT_GREEN}` } };

    const gapCell = row.getCell(13);
    gapCell.numFmt = '[Color46]"高"0"元";[Color10]"低"0"元";"持平";@';
    gapCell.font = {
      bold: summary.qingmaoGap !== null && summary.qingmaoGap < 0,
      color: { argb: summary.qingmaoGap !== null && summary.qingmaoGap < 0 ? "FFFFFFFF" : `FF${BRAND_BLUE}` }
    };
    gapCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb:
          summary.qingmaoGap === null
            ? `FF${SOFT_BLUE}`
            : summary.qingmaoGap < 0
              ? `FF${BRAND_TEAL}`
              : summary.qingmaoGap === 0
                ? `FF${SOFT_GREEN}`
                : `FF${SOFT_AMBER}`
      }
    };

    row.getCell(14).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    row.getCell(15).font = { color: { argb: `FF${BRAND_TEAL}` }, underline: true };
  }

  summarySheet.columns = [
    { width: 8 },
    { width: 13 },
    { width: 16 },
    { width: 13 },
    { width: 12 },
    { width: 14 },
    { width: 10 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 13 },
    { width: 11 },
    { width: 34 },
    { width: 18 }
  ];
  summarySheet.autoFilter = `A${HEADER_ROW}:O${summarySheet.rowCount}`;

  const evidenceSheet = workbook.addWorksheet("网页截图索引页", {
    views: [{ state: "frozen", ySplit: 4 }]
  });
  addTitle(evidenceSheet, "网页截图索引", "记录每条报价对应的平台页面、网页截图文件名和内部追溯路径；当前 Excel 不内嵌图片。", 9);
  evidenceSheet.addRow([]);
  styleHeader(evidenceSheet.addRow(["样本编号", "航线", "航班号", "平台", "价格", "状态", "网页截图文件", "平台网页", "内部路径/说明"]));
  for (const sample of batch.samples) {
    for (const quote of sample.quotes) {
      const row = evidenceSheet.addRow([
        sample.id,
        routeName(sample.origin, sample.destination),
        sample.flightNo,
        quote.platform,
        money(quote.price),
        quote.status,
        quote.evidencePath ? path.basename(quote.evidencePath) : "",
        quote.sourceUrl ? { text: "打开平台页面", hyperlink: quote.sourceUrl } : "",
        quote.evidencePath
      ]);
      row.height = 26;
      row.getCell(5).numFmt = '"¥"#,##0';
      row.getCell(7).font = { color: { argb: `FF${BRAND_TEAL}` } };
      row.getCell(8).font = { color: { argb: `FF${BRAND_TEAL}` }, underline: Boolean(quote.sourceUrl) };
    }
  }
  evidenceSheet.columns = [{ width: 14 }, { width: 16 }, { width: 12 }, { width: 12 }, { width: 10 }, { width: 12 }, { width: 22 }, { width: 20 }, { width: 52 }];
  evidenceSheet.autoFilter = `A4:I${evidenceSheet.rowCount}`;

  const auditSheet = workbook.addWorksheet("留痕页", {
    views: [{ state: "frozen", ySplit: 4 }]
  });
  addTitle(auditSheet, "内部采集留痕", "该页用于内部复盘，不建议作为客户现场展示页。", 18);
  auditSheet.addRow([]);
  styleHeader(
    auditSheet.addRow([
      "采集批次ID",
      "采集时间",
      "采集人",
      "国内/国际",
      "出发地",
      "目的地",
      "出行日期",
      "航班号",
      "航司",
      "舱位",
      "直飞/中转",
      "中转城市",
      "总时长",
      "平台",
      "价格",
      "退改规则",
      "行李规则",
      "是否可订"
    ])
  );
  for (const sample of batch.samples) {
    for (const quote of sample.quotes) {
      auditSheet.addRow([
        batch.id,
        batch.generatedAt,
        "用户本人",
        sample.scope,
        sample.origin,
        sample.destination,
        sample.travelDate,
        sample.flightNo,
        sample.airline,
        sample.cabin,
        sample.directType,
        sample.transferCity,
        `${sample.durationMinutes}分钟`,
        quote.platform,
        money(quote.price),
        quote.refundRule,
        quote.baggageRule,
        quote.available ? "是" : "否"
      ]);
    }
  }

  if (batch.failureNotes?.length) {
    auditSheet.addRow([]);
    const failureHeader = auditSheet.addRow(["替换航线记录"]);
    failureHeader.font = { bold: true, color: { argb: "FFB45309" } };
    for (const note of batch.failureNotes) {
      auditSheet.addRow([note]);
    }
  }
  auditSheet.columns = new Array(18).fill(null).map((_, index) => ({ width: index < 3 ? 22 : 14 }));
  auditSheet.autoFilter = `A4:R${auditSheet.rowCount}`;

  for (const sheet of workbook.worksheets) {
    sheet.eachRow((row) => {
      row.alignment = { vertical: "middle", wrapText: true };
      row.border = {
        bottom: { style: "thin", color: { argb: "FFE5E7EB" } }
      };
    });
  }

  const filename = `青猫差旅航班比价-${batch.id}.xlsx`;
  const outputPath = path.join(outputDir, filename);
  await workbook.xlsx.writeFile(outputPath);

  return {
    path: outputPath,
    filename,
    sheets: workbook.worksheets.map((sheet) => sheet.name)
  };
}
