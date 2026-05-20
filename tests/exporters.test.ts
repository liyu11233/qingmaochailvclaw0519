import { existsSync, statSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFakeBatch } from "../src/domain/fakeBatch";
import { exportBatchWorkbook } from "../server/exporters/excel";
import { exportSalesLongScreenshot } from "../server/exporters/offlinePackage";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

let outputDir: string;

beforeEach(async () => {
  outputDir = await mkdtemp(path.join(tmpdir(), "qingmao-export-"));
});

afterEach(async () => {
  await rm(outputDir, { recursive: true, force: true });
});

describe("export artifacts", () => {
  it("exports a styled Excel workbook for the current batch", async () => {
    const batch = buildFakeBatch(new Date("2026-05-18T10:00:00+08:00"));
    const result = await exportBatchWorkbook(batch, outputDir);

    expect(result.filename.endsWith(".xlsx")).toBe(true);
    expect(existsSync(result.path)).toBe(true);
    expect(statSync(result.path).size).toBeGreaterThan(10_000);
    expect(result.sheets).toEqual(["汇总页", "网页截图索引页", "留痕页"]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(result.path);
    const summarySheet = workbook.getWorksheet("汇总页");
    const headerValues = summarySheet?.getRow(8).values;
    const gapCell = summarySheet?.getRow(9).getCell(13);

    expect(summarySheet?.getCell("A1").value).toBe("青猫差旅航班价格对比汇总");
    expect(headerValues).not.toContain("退改/行李摘要");
    expect(headerValues).toContain("网页截图索引");
    expect(gapCell?.value).toMatchObject({
      formula: 'IF(COUNT(J9:K9)=0,"",I9-MIN(J9:K9))',
      result: -63
    });
    expect(gapCell?.font?.bold).toBe(true);
    expect(gapCell?.fill).toMatchObject({
      type: "pattern",
      fgColor: { argb: "FF0E8F7A" }
    });
  });

  it("keeps webpage screenshots as a text index without embedding images", async () => {
    const batch = buildFakeBatch(new Date("2026-05-18T10:00:00+08:00"));
    batch.samples = batch.samples.slice(0, 1);
    batch.sampleCount = 1;
    batch.successCount = 1;
    batch.samples[0].quotes[0].evidencePath = "screenshots/embedded-qingmao.png";
    await mkdir(path.join(outputDir, "screenshots"), { recursive: true });
    await writeFile(path.join(outputDir, "screenshots", "embedded-qingmao.png"), ONE_PIXEL_PNG);

    const result = await exportBatchWorkbook(batch, outputDir);
    const workbookZip = await readFile(result.path);
    const mediaMarker = Buffer.from("xl/media/image");

    expect(workbookZip.includes(mediaMarker)).toBe(false);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(result.path);
    const evidenceSheet = workbook.getWorksheet("网页截图索引页");
    expect(evidenceSheet?.getRow(5).getCell(7).value).toBe("embedded-qingmao.png");
    expect(evidenceSheet?.getRow(5).getCell(9).value).toBe("screenshots/embedded-qingmao.png");
  });

  it("exports a customer-facing sales long screenshot", async () => {
    const batch = buildFakeBatch(new Date("2026-05-18T10:00:00+08:00"));
    batch.samples = batch.samples.slice(0, 4);
    batch.sampleCount = 4;
    batch.successCount = 4;
    const result = await exportSalesLongScreenshot(batch, outputDir);
    const image = await readFile(result.path);

    expect(result.filename.endsWith(".png")).toBe(true);
    expect(existsSync(result.path)).toBe(true);
    expect(statSync(result.path).size).toBeGreaterThan(20_000);
    expect(image.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  }, 15_000);
});
