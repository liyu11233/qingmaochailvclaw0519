import { existsSync, statSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFakeBatch } from "../src/domain/fakeBatch";
import { exportBatchWorkbook } from "../server/exporters/excel";
import { exportOfflinePackage } from "../server/exporters/offlinePackage";

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
    const gapCell = summarySheet?.getCell("L5");

    expect(gapCell?.value).toMatchObject({
      formula: 'IF(COUNT(I5:J5)=0,"",H5-MIN(I5:J5))',
      result: -63
    });
    expect(gapCell?.font?.bold).toBe(true);
    expect(gapCell?.fill).toMatchObject({
      type: "pattern",
      fgColor: { argb: "FF0E8F7A" }
    });
  });

  it("embeds available webpage screenshots inside the Excel workbook", async () => {
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

    expect(workbookZip.includes(mediaMarker)).toBe(true);
  });

  it("exports a self-contained offline demo package", async () => {
    const batch = buildFakeBatch(new Date("2026-05-18T10:00:00+08:00"));
    const result = await exportOfflinePackage(batch, outputDir);
    const packageDir = path.join(outputDir, result.filename.replace(/\.zip$/, ""));
    const indexHtml = await readFile(path.join(packageDir, "index.html"), "utf8");
    const screenshotSvg = await readFile(path.join(packageDir, "screenshots", "flight-01-1.svg"), "utf8");

    expect(result.filename.endsWith(".zip")).toBe(true);
    expect(existsSync(result.path)).toBe(true);
    expect(statSync(result.path).size).toBeGreaterThan(5_000);
    expect(result.entryFile).toBe("index.html");
    expect(indexHtml).not.toContain("证据");
    expect(indexHtml).not.toContain("假数据");
    expect(indexHtml).not.toContain("当前批次");
    expect(indexHtml).not.toContain("20 条样本");
    expect(indexHtml).toContain("同一航班，三平台价格对比。当前为 2026-05-18 10:00 的数据。");
    expect(indexHtml).toContain("查看网页截图");
    expect(indexHtml).not.toContain("打开携程商旅验证");
    expect(indexHtml).not.toContain("打开阿里商旅验证");
    expect(indexHtml).toContain('data-url="https://ct.ctrip.com/"');
    expect(indexHtml).toContain('data-url="https://www.alibtrip.com/alibtrip"');
    expect(indexHtml).toContain('onclick="openPlatform(event, this)"');
    expect(screenshotSvg).not.toContain("证据");
    expect(screenshotSvg).toContain("网页截图");
  });
});
