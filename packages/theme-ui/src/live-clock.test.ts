import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { TODO_PROGRESS_CSS } from "./chat/TodoProgress";
import { ACTIVITY_STATUS_DOT_CSS } from "./shared/ActivityStatusDot";

const stylesCss = readFileSync(join(import.meta.dirname, "styles.css"), "utf8");
const sendButtonCss = readFileSync(join(import.meta.dirname, "chat", "send-button.css"), "utf8");

/** 取出某个选择器的第一条规则体。 */
function ruleBody(css: string, selector: string): string {
	const start = css.indexOf(`${selector} {`);
	expect(start, `missing rule for ${selector}`).toBeGreaterThanOrEqual(0);
	return css.slice(start, css.indexOf("}", start));
}

/**
 * 「进行中」指示器共用一条 :root 上的步进时钟，而不是各自跑 60fps 关键帧：
 * 毛玻璃窗口每出一帧都要整窗重合成，指示器再多，整页每秒也只能因此多出 10 帧。
 */
describe("shared live clock", () => {
	test("the clock is a registered number property stepped at 100ms and only runs when a consumer exists", () => {
		expect(stylesCss).toMatch(/@property --vetta-live-phase \{[^}]*syntax: "<number>"[^}]*inherits: true/);
		expect(stylesCss).toContain("animation: vetta-live-clock 1.6s steps(16, end) infinite;");
		const gate = stylesCss.match(/:root:has\(([^)]*)\) \{\n\tanimation: vetta-live-clock/);
		expect(gate).not.toBeNull();
		for (const consumer of [".vetta-live-phase", ".vetta-live-dot", ".processing-shimmer", ".send-button-ripple"]) {
			expect(gate?.[1]).toContain(consumer);
		}
	});

	test("the clock stops under reduced motion and consumers rest at full opacity at phase 0", () => {
		expect(stylesCss).toMatch(
			/@media \(prefers-reduced-motion: reduce\) \{\n\t:root:has\([^)]*\) \{\n\t\tanimation: none;/,
		);
		// wave = 1 - |2p - 1| 在 p = 0 时为 0，消费者的 opacity 公式都写成 1 - k * wave，静止时全亮。
		expect(stylesCss).toContain("--vetta-live-wave: calc(1 - abs(2 * var(--vetta-live-phase) - 1));");
		expect(ruleBody(stylesCss, ".processing-shimmer")).toContain("opacity: calc(1 - 0.42 * var(--vetta-live-wave));");
		expect(ruleBody(stylesCss, ".vetta-live-dot")).toContain("opacity: calc(1 - 0.6 * var(--vetta-live-wave));");
	});

	test("no in-progress indicator declares its own infinite animation any more", () => {
		const consumers: Array<[string, string]> = [
			["processing-shimmer", ruleBody(stylesCss, ".processing-shimmer")],
			["send-button-ripple", ruleBody(sendButtonCss, ".send-button-ripple")],
			["send-button-ripple-2", ruleBody(sendButtonCss, ".send-button-ripple-2")],
			["todo progress", TODO_PROGRESS_CSS],
			["activity status dot", ACTIVITY_STATUS_DOT_CSS],
		];
		for (const [name, css] of consumers) {
			expect(css, name).not.toMatch(/animation\s*:/);
			expect(css, name).not.toContain("infinite");
			expect(css, name).toMatch(/var\(--vetta-live-(phase|wave)\)/);
		}
		expect(sendButtonCss).not.toContain("@keyframes send-button-ripple");
	});

	test("the second ripple ring reads the clock half a period apart", () => {
		expect(ruleBody(sendButtonCss, ".send-button-ripple-2")).toContain(
			"--send-button-ripple-progress: mod(calc(var(--vetta-live-phase) + 0.5), 1);",
		);
	});
});
