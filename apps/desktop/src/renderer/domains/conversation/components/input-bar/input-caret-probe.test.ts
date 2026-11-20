// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { describeElement, isCaretProbeEnabled } from "./input-caret-probe";

describe("input caret probe", () => {
	it("默认关闭，只有显式写入开关才生效", () => {
		window.localStorage.clear();
		expect(isCaretProbeEnabled()).toBe(false);
		window.localStorage.setItem("astravia-input-caret-probe", "1");
		expect(isCaretProbeEnabled()).toBe(true);
		window.localStorage.clear();
	});

	// 日志只描述结构：把整个 class 串和 data 文本都带出去会泄露用户内容，
	// 也会让报告难以定位（一长串 Tailwind 类名里看不出是谁）。
	it("描述元素时只保留标签、少量类名与 data 标记", () => {
		const element = document.createElement("div");
		element.className = "absolute inset-x-0 bottom-0 z-20 bg-popover";
		element.setAttribute("data-message-input-part", "toolbar");
		expect(describeElement(element)).toBe('div.absolute.inset-x-0.bottom-0.z-20[data-message-input-part="toolbar"]');
	});

	it("类名超过四个时不继续堆积", () => {
		const element = document.createElement("span");
		element.className = "a b c d e f";
		expect(describeElement(element)).toBe("span.a.b.c.d");
	});

	it("空节点与空元素都有稳定的占位描述", () => {
		expect(describeElement(null)).toBe("null");
		const element = document.createElement("p");
		expect(describeElement(element)).toBe("p");
	});
});
