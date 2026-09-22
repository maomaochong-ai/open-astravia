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
 * 「进行中」指示器在 theme-ui 的 CSS 里只有静止态：呼吸/波纹由宿主用 Web Animations 挂
 * steps(16) 的合成器动画并锁同一相位。这里守住「不要再有人把 infinite 关键帧写回来」。
 */
describe("in-progress indicators declare no animation of their own", () => {
	test("theme-ui styles carry no infinite keyframes for the indicator classes", () => {
		expect(ruleBody(stylesCss, ".processing-shimmer")).not.toMatch(/animation\s*:/);
		expect(stylesCss).not.toContain("@keyframes processing-shimmer");
		expect(stylesCss).not.toContain("--vetta-live-phase");
	});

	test("send button ripple rings rest invisible and are animated by the host", () => {
		const body = ruleBody(sendButtonCss, ".send-button-ripple");
		expect(body).toContain("opacity: 0;");
		expect(body).not.toMatch(/animation\s*:/);
		expect(sendButtonCss).not.toContain("@keyframes send-button-ripple");
	});

	test("todo and activity-dot style snippets hold no keyframes", () => {
		for (const css of [TODO_PROGRESS_CSS, ACTIVITY_STATUS_DOT_CSS]) {
			expect(css).not.toContain("@keyframes");
			expect(css).not.toMatch(/animation\s*:/);
		}
		// 光晕没有宿主动画时不该留下一圈静止的色块。
		expect(ACTIVITY_STATUS_DOT_CSS).toContain(".activity-dot-halo { opacity: 0; }");
	});
});
