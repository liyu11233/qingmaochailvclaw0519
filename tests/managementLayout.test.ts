import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readAppSource() {
  return readFileSync(path.join(process.cwd(), "src", "App.tsx"), "utf8");
}

function readStyleSource() {
  return readFileSync(path.join(process.cwd(), "src", "styles.css"), "utf8");
}

describe("third version management layout", () => {
  it("keeps the frozen stage-1 section order and formal action boundary", () => {
    const source = readAppSource();
    const topbar = source.indexOf("top-status");
    const heroGrid = source.indexOf("hero-grid");
    const overview = source.indexOf("overview-card");
    const formalActions = source.indexOf("action-card");
    const config = source.indexOf("config-card");
    const status = source.indexOf("status-card");
    const preview = source.indexOf("preview-card");

    expect(topbar).toBeGreaterThan(-1);
    expect(heroGrid).toBeGreaterThan(topbar);
    expect(overview).toBeGreaterThan(heroGrid);
    expect(formalActions).toBeGreaterThan(overview);
    expect(config).toBeGreaterThan(formalActions);
    expect(status).toBeGreaterThan(config);
    expect(preview).toBeGreaterThan(status);

    const formalActionBlock = source.slice(formalActions, config);
    const actionStackBlock = source.slice(source.indexOf('className="action-stack"'), source.indexOf('className="collection-control-row"'));
    const collectionControlBlock = source.slice(source.indexOf('className="collection-control-row"'), source.indexOf("{[\"partial\"", source.indexOf('className="collection-control-row"')));
    expect(formalActionBlock).toContain("打开登录浏览器");
    expect(formalActionBlock).toContain("连接当前登录窗口");
    expect(formalActionBlock).toContain("开始完整真实采集");
    expect(formalActionBlock).toContain("暂停采集");
    expect(formalActionBlock).toContain("停止采集");
    expect(formalActionBlock).toContain("导出 Excel");
    expect(formalActionBlock).toContain("导出离线包");
    expect(actionStackBlock).not.toContain("暂停采集");
    expect(actionStackBlock).not.toContain("停止采集");
    expect(actionStackBlock).toContain("导出 Excel");
    expect(actionStackBlock).toContain("导出离线包");
    expect(collectionControlBlock).toContain("暂停采集");
    expect(collectionControlBlock).toContain("停止采集");
    expect(collectionControlBlock).not.toContain('className="step"');
    expect(formalActionBlock).not.toContain("清理采集窗口");
    expect(formalActionBlock).not.toContain("重新生成交付包");
  });

  it("matches the finalized design shell and card grid structure", () => {
    const source = readAppSource();
    const styles = readStyleSource();

    expect(source).toContain('className="top-status"');
    expect(source).toContain('className="hero-grid"');
    expect(source).toContain('className="overview-card"');
    expect(source).toContain('className="action-card"');
    expect(source).toContain('className="content-grid"');
    expect(source).toContain('className="side-stack"');
    expect(source).toContain("failure-trace-panel");
    expect(styles).toContain(".hero-grid {\n  display: grid;");
    expect(styles).toContain("grid-template-columns: minmax(0, 1fr) 430px;");
    expect(styles).toContain(".op-button {\n  display: grid;");
  });

  it("keeps diagnostics before the visible failure trace as the final bottom panel", () => {
    const source = readAppSource();
    const detail = source.indexOf("detail-card");
    const diagnostics = source.indexOf("advanced-card");
    const failureTrace = source.indexOf("failure-trace-panel");

    expect(detail).toBeGreaterThan(-1);
    expect(diagnostics).toBeGreaterThan(detail);
    expect(failureTrace).toBeGreaterThan(diagnostics);
    expect(source).not.toContain("notice-card");
    expect(source).toContain("问题排查区（平时不用）");
    expect(source).toContain("Failure Trace");
    expect(source).toContain("失败留痕");
    expect(source).toContain("失败记录");
    expect(source).toContain("已保存截图");
    expect(source).toContain("HTML 快照");
    expect(source).toContain("待人工复核");
    expect(source).toContain("对象");
    expect(source).toContain("平台 / 阶段");
    expect(source).toContain("失败原因");
    expect(source).toContain("痕迹文件");
    expect(source).toContain("处理状态");
  });

  it("links the overview failure trace card to the final failure trace panel", () => {
    const source = readAppSource();
    const overviewBlock = source.slice(source.indexOf("delivery-preview"), source.indexOf("action-card"));

    expect(overviewBlock).toContain('href="#failureTracePanel"');
    expect(overviewBlock).toContain('aria-label="查看失败留痕"');
    expect(source).toContain('id="failureTracePanel"');
    expect(source).toContain('aria-label="失败留痕面板"');
  });

  it("keeps failure trace metrics scoped to failure trace records", () => {
    const source = readAppSource();
    const failureTraceBlock = source.slice(source.indexOf("failure-trace-panel"), source.indexOf("</section>", source.indexOf("failure-trace-panel")));

    expect(source).toContain("failureTraceRows");
    expect(source).toContain("failureScreenshotCount");
    expect(source).toContain("failureHtmlSnapshotCount");
    expect(source).toContain("pendingManualReviewCount");
    expect(failureTraceBlock).not.toContain("view.evidenceCount");
  });

  it("limits batch details by default and keeps explicit expand-more controls", () => {
    const source = readAppSource();

    expect(source).toContain("flightDetailExpanded");
    expect(source).toContain("hotelDetailExpanded");
    expect(source).toContain("displayedFlightRows");
    expect(source).toContain("displayedHotelRows");
    expect(source).toContain("展开更多航班明细");
    expect(source).toContain("展开更多酒店明细");
  });

  it("shows explicit full-volume and target-met states in the result overview", () => {
    const source = readAppSource();
    const overviewBlock = source.slice(source.indexOf("status-card"), source.indexOf("preview-card"));

    expect(overviewBlock).toContain("是否满量");
    expect(overviewBlock).toContain("是否达标");
    expect(overviewBlock).toContain("酒店实际展示数");
    expect(overviewBlock).toContain("航班实际展示数");
    expect(overviewBlock).toContain("targetMetBadgeLabel");
  });

  it("keeps specified-platform selection empty until the user explicitly chooses one", () => {
    const source = readAppSource();

    expect(source).toContain('value={thirdVersionOptions.specifiedPlatform ?? ""}');
    expect(source).toContain('<option value="">请选择竞品平台</option>');
    expect(source).not.toContain('nextOptions.specifiedPlatform = "携程商旅"');
  });
});
