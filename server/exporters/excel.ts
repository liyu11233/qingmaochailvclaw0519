import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ExcelJS from "exceljs";
import { summarizeFlight } from "../../src/domain/comparison";
import type { CollectionBatch, PlatformQuote } from "../../src/domain/types";

const BRAND_BLUE = "0F3D5E";
const BRAND_TEAL = "0E8F7A";
const SOFT_GREEN = "E8F7F0";
const SOFT_AMBER = "FFF7E8";
const execFileAsync = promisify(execFile);

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

function evidenceSourcePath(outputDir: string, quote: PlatformQuote) {
  return path.join(outputDir, quote.evidencePath);
}

function supportedImageExtension(filePath: string): "png" | "jpeg" | null {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "png";
  if (extension === ".jpg" || extension === ".jpeg") return "jpeg";
  return null;
}

function pngDimensions(buffer: Buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function fitImage(width: number, height: number, maxWidth: number, maxHeight: number) {
  const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio))
  };
}

async function compactImageForWorkbook(sourcePath: string, cacheDir: string) {
  const extension = supportedImageExtension(sourcePath);
  if (!extension) return null;

  const cachedPath = path.join(cacheDir, `${path.basename(sourcePath, path.extname(sourcePath))}.${extension === "jpeg" ? "jpg" : "png"}`);

  try {
    await execFileAsync("sips", ["-Z", "1200", sourcePath, "--out", cachedPath], { timeout: 15_000 });
    return cachedPath;
  } catch {
    return sourcePath;
  }
}

async function loadEvidenceImage(outputDir: string, quote: PlatformQuote, cacheDir: string) {
  const sourcePath = evidenceSourcePath(outputDir, quote);
  const imagePath = await compactImageForWorkbook(sourcePath, cacheDir);
  if (!imagePath) return null;

  try {
    const buffer = await fs.readFile(imagePath);
    const extension = supportedImageExtension(imagePath);
    if (!extension) return null;
    const dimensions = extension === "png" ? pngDimensions(buffer) : null;
    const fitted = dimensions ? fitImage(dimensions.width, dimensions.height, 420, 170) : { width: 360, height: 170 };
    return { buffer, extension, width: fitted.width, height: fitted.height };
  } catch {
    return null;
  }
}

export async function exportBatchWorkbook(batch: CollectionBatch, outputDir: string) {
  await fs.mkdir(outputDir, { recursive: true });
  const imageCacheDir = await fs.mkdtemp(path.join(tmpdir(), "qingmao-excel-images-"));
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "青猫差旅价格采集工具";
  workbook.created = new Date(batch.generatedAt);

  const summarySheet = workbook.addWorksheet("汇总页", {
    views: [{ state: "frozen", ySplit: 4 }]
  });
  addTitle(summarySheet, "青猫差旅航班价格对比汇总", `采集批次：${batch.id} / 样本数：${batch.sampleCount}`, 14);
  summarySheet.addRow([]);
  const summaryHeader = summarySheet.addRow([
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
    "退改/行李摘要",
    "对比结论"
  ]);
  styleHeader(summaryHeader);

  for (const sample of batch.samples) {
    const summary = summarizeFlight(sample);
    const qingmao = sample.quotes.find((quote) => quote.platform === "青猫差旅");
    const ctrip = sample.quotes.find((quote) => quote.platform === "携程商旅");
    const ali = sample.quotes.find((quote) => quote.platform === "阿里商旅");
    const rowNumber = summarySheet.rowCount + 1;
    const row = summarySheet.addRow([
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
        formula: `IF(COUNT(I${rowNumber}:J${rowNumber})=0,"",H${rowNumber}-MIN(I${rowNumber}:J${rowNumber}))`,
        result: summary.qingmaoGap ?? undefined
      },
      `${qingmao?.refundRule ?? ""}；${qingmao?.baggageRule ?? ""}`,
      summary.conclusion
    ]);
    const gapCell = row.getCell(12);
    gapCell.numFmt = '[Color46]"高"0"元";[Color10]"低"0"元";"持平";@';
    gapCell.font = {
      bold: summary.qingmaoGap !== null && summary.qingmaoGap < 0,
      color: { argb: summary.qingmaoGap !== null && summary.qingmaoGap < 0 ? "FFFFFFFF" : `FF${BRAND_BLUE}` }
    };
    gapCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: summary.qingmaoGap !== null && summary.qingmaoGap < 0 ? `FF${BRAND_TEAL}` : `FF${SOFT_AMBER}` }
    };
  }

  summarySheet.columns = [
    { width: 12 },
    { width: 14 },
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
    { width: 30 },
    { width: 36 }
  ];
  summarySheet.autoFilter = "A4:N24";

  const evidenceSheet = workbook.addWorksheet("网页截图索引页", {
    views: [{ state: "frozen", ySplit: 4 }]
  });
  addTitle(evidenceSheet, "网页截图索引", "每条报价都内嵌网页截图，销售带走 Excel 后也能直接复核。", 8);
  evidenceSheet.addRow([]);
  styleHeader(evidenceSheet.addRow(["航线", "航班号", "平台", "价格", "状态", "网页截图", "平台网页", "内部路径/说明"]));
  for (const sample of batch.samples) {
    for (const quote of sample.quotes) {
      const row = evidenceSheet.addRow([
        routeName(sample.origin, sample.destination),
        sample.flightNo,
        quote.platform,
        money(quote.price),
        quote.status,
        "",
        quote.sourceUrl ? { text: "打开平台页面", hyperlink: quote.sourceUrl } : "",
        quote.evidencePath
      ]);
      row.height = 138;

      const image = await loadEvidenceImage(outputDir, quote, imageCacheDir);
      const screenshotCell = row.getCell(6);
      if (image) {
        const imageId = workbook.addImage({ base64: image.buffer.toString("base64"), extension: image.extension });
        const rowIndex = row.number - 1;
        evidenceSheet.addImage(imageId, {
          tl: { col: 5.08, row: rowIndex + 0.12 },
          ext: { width: image.width, height: image.height }
        });
        screenshotCell.value = "已内嵌网页截图";
        screenshotCell.font = { color: { argb: "FF94A3B8" }, size: 9 };
        row.height = Math.max(row.height ?? 138, image.height * 0.75 + 12);
      } else if (path.extname(quote.evidencePath).toLowerCase() === ".html") {
        screenshotCell.value = "截图失败，已保存网页快照；请查看离线包内同名 HTML";
      } else {
        screenshotCell.value = "未找到可嵌入截图";
      }
    }
  }
  evidenceSheet.columns = [{ width: 16 }, { width: 12 }, { width: 12 }, { width: 10 }, { width: 12 }, { width: 60 }, { width: 22 }, { width: 42 }];
  evidenceSheet.autoFilter = "A4:H64";

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
  auditSheet.autoFilter = "A4:R64";

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
  try {
    await workbook.xlsx.writeFile(outputPath);

    return {
      path: outputPath,
      filename,
      sheets: workbook.worksheets.map((sheet) => sheet.name)
    };
  } finally {
    await fs.rm(imageCacheDir, { recursive: true, force: true });
  }
}
