import { beforeEach, describe, expect, it } from "vitest";
import { claimCanvasReveal, requestCanvasReveal, resetCanvasReveal } from "../src/gallery/open-project";

describe("从画廊进入时的画布展开预约", () => {
	beforeEach(() => {
		resetCanvasReveal();
	});

	it("没预约过就不抢面板", () => {
		expect(claimCanvasReveal("/w/p")).toBe(false);
	});

	it("只对预约的那个项目生效，且只生效一次", () => {
		requestCanvasReveal("/w/p");
		expect(claimCanvasReveal("/w/other")).toBe(false);
		expect(claimCanvasReveal("/w/p")).toBe(true);
		// 用户在同一项目里自己关掉画布后，不该被反复弹开。
		expect(claimCanvasReveal("/w/p")).toBe(false);
	});

	it("再次点卡片会重新预约", () => {
		requestCanvasReveal("/w/p");
		claimCanvasReveal("/w/p");
		requestCanvasReveal("/w/p");
		expect(claimCanvasReveal("/w/p")).toBe(true);
	});

	it("cwd 为空（没有会话上下文）时不认领", () => {
		requestCanvasReveal("/w/p");
		expect(claimCanvasReveal(null)).toBe(false);
	});
});
