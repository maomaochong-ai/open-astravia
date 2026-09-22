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
 * 毛玻璃窗口每出一帧都要整窗重合成。流式期间的装饰动效要么挂到 theme-ui 的共享步进时钟上，
 * 要么自己走 steps()，不能再各自 60fps 逐帧插值。
 */
describe("streaming-time animations stay low-rate", () => {
	it("tool-call shimmer text breathes off the shared clock instead of its own infinite keyframes", () => {
		const body = ruleBody(".tool-call-shimmer-text");
		expect(body).toContain("opacity: calc(1 - 0.45 * var(--vetta-live-wave));");
		expect(body).not.toMatch(/animation\s*:/);
		expect(stylesCss).not.toContain("@keyframes tool-call-text-breathe");
	});

	it("streaming chunk fade-in is stepped rather than interpolated every frame", () => {
		expect(ruleBody(".markdown-streaming-tail .streaming-chunk")).toContain(
			"animation: streaming-chunk-fade 400ms steps(6, end) both;",
		);
	});
});
