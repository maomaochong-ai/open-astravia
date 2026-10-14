import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const stylesCss = readFileSync(join(import.meta.dirname, "styles.css"), "utf8");

function ruleBody(selector: string): string {
	const start = stylesCss.indexOf(`${selector} {`);
	expect(start, `missing rule for ${selector}`).toBeGreaterThanOrEqual(0);
	return stylesCss.slice(start, stylesCss.indexOf("}", start));
}

/**
 * 毛玻璃窗口每出一帧都要整窗重合成。流式期间的装饰动效要么由 live-animations 挂同相位的
 * steps() 合成器动画，要么干脆只随内容更新变化，不能再各自逐帧插值。
 */
describe("streaming-time animations stay low-rate", () => {
	it("tool-call shimmer text has no animation of its own; the host animates it in lockstep", () => {
		const body = ruleBody(".tool-call-shimmer-text");
		expect(body).not.toMatch(/animation\s*:/);
		expect(stylesCss).not.toContain("@keyframes tool-call-text-breathe");
	});

	it("streaming chunks use currentColor (no dimming — color-mix 半透明在毛玻璃上透出背景形成视觉层差)", () => {
		expect(stylesCss).not.toContain("@keyframes streaming-chunk-fade");
		expect(stylesCss).not.toMatch(/\.streaming-chunk \{[^}]*animation/);
		expect(ruleBody(".markdown-streaming-tail .streaming-chunk-latest")).not.toContain("opacity");
		expect(ruleBody(".markdown-streaming-tail .streaming-chunk-recent")).not.toContain("opacity");
		expect(ruleBody(".markdown-streaming-tail .streaming-chunk-latest")).toContain("currentColor");
		expect(ruleBody(".markdown-streaming-tail .streaming-chunk-recent")).toContain("currentColor");
	});
});
