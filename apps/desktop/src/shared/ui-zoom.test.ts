import { describe, expect, it } from "vitest";
import {
	formatUiZoomPercent,
	normalizeUiZoomFactor,
	parseTitlebarCenter,
	stepUiZoomFactor,
	TITLEBAR_CENTER_FALLBACK,
	trafficLightPositionFor,
	UI_ZOOM_DEFAULT,
	UI_ZOOM_STEPS,
	uiZoomNeedsCorrection,
	uiZoomStepIndex,
} from "./ui-zoom.js";

describe("界面缩放档位", () => {
	it("吸附到最近的档位", () => {
		expect(normalizeUiZoomFactor(0.97)).toBe(1);
		expect(normalizeUiZoomFactor(1.2)).toBe(1.25);
		expect(normalizeUiZoomFactor(0.6)).toBe(0.75);
		expect(normalizeUiZoomFactor(3)).toBe(1.5);
	});

	it("非数字与非有限值回落默认档", () => {
		expect(normalizeUiZoomFactor(undefined)).toBe(UI_ZOOM_DEFAULT);
		expect(normalizeUiZoomFactor("1.25")).toBe(UI_ZOOM_DEFAULT);
		expect(normalizeUiZoomFactor(Number.NaN)).toBe(UI_ZOOM_DEFAULT);
		expect(normalizeUiZoomFactor(Number.POSITIVE_INFINITY)).toBe(UI_ZOOM_DEFAULT);
	});

	it("快捷键逐档移动，到头不越界", () => {
		expect(stepUiZoomFactor(1, 1)).toBe(1.1);
		expect(stepUiZoomFactor(1, -1)).toBe(0.9);
		expect(stepUiZoomFactor(UI_ZOOM_STEPS[0], -1)).toBe(0.75);
		expect(stepUiZoomFactor(UI_ZOOM_STEPS[UI_ZOOM_STEPS.length - 1], 1)).toBe(1.5);
	});

	it("档位索引与档位表一致", () => {
		expect(uiZoomStepIndex(1)).toBe(2);
		expect(uiZoomStepIndex(1.4)).toBe(UI_ZOOM_STEPS.indexOf(1.5));
	});
});

describe("macOS 红绿灯位置", () => {
	it("按页头实测中线换算，缩放比参与计算", () => {
		// 100% 缩放：中线 28 → 框顶 28 - 9 = 19。
		expect(trafficLightPositionFor(TITLEBAR_CENTER_FALLBACK, 1)).toEqual({ x: 16, y: 19 });
		// 125% 缩放：中线跟着页面放大，红绿灯仍按屏幕像素摆放。
		expect(trafficLightPositionFor(28, 1.25)).toEqual({ x: 16, y: 26 });
		// 空值按 100% 处理，不抛错。
		expect(trafficLightPositionFor(28, undefined)).toEqual({ x: 16, y: 19 });
	});

	it("上报值做有限与范围校验，越界一律丢弃", () => {
		expect(parseTitlebarCenter(28)).toBe(28);
		expect(parseTitlebarCenter(0)).toBe(0);
		expect(parseTitlebarCenter(200)).toBe(200);
		expect(parseTitlebarCenter(-1)).toBeUndefined();
		expect(parseTitlebarCenter(201)).toBeUndefined();
		expect(parseTitlebarCenter(Number.NaN)).toBeUndefined();
		expect(parseTitlebarCenter("28")).toBeUndefined();
		expect(parseTitlebarCenter(null)).toBeUndefined();
	});
});

describe("uiZoomNeedsCorrection", () => {
	it("实测与档位一致（含 Chromium 的浮点误差）时不纠正", () => {
		expect(uiZoomNeedsCorrection(1.1, 1.1)).toBe(false);
		expect(uiZoomNeedsCorrection(1.1000000001, 1.1)).toBe(false);
	});

	it("实测偏离档位就纠正：显示 110% 实际却是 100% 或 90%", () => {
		expect(uiZoomNeedsCorrection(1, 1.1)).toBe(true);
		expect(uiZoomNeedsCorrection(0.9, 1.1)).toBe(true);
	});

	it("取不到有效实测值时不动，避免乱写", () => {
		for (const bad of [undefined, null, Number.NaN, 0, -1, "1.1"]) {
			expect(uiZoomNeedsCorrection(bad, 1.1)).toBe(false);
		}
	});
});

describe("formatUiZoomPercent", () => {
	it("按档位输出百分比，浮点误差不外露", () => {
		expect(formatUiZoomPercent(1.1)).toBe("110%");
		expect(formatUiZoomPercent(0.75)).toBe("75%");
		expect(formatUiZoomPercent(1.5000001)).toBe("150%");
	});
});
