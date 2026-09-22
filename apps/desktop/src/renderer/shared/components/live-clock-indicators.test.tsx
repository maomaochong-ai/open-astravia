// @vitest-environment jsdom
import { AssistantMessage, todoLabelSheenClassName } from "@vetta-org/theme-ui/chat";
import { ActivityStatusDot } from "@vetta-org/theme-ui/shared";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LIVE_ANIMATION_SELECTORS } from "../lib/live-animations";

afterEach(cleanup);

const LIVE_SELECTOR = LIVE_ANIMATION_SELECTORS.join(", ");

/**
 * 呼吸/波纹由宿主的 live-animations 按类名挂上；组件只要漏掉登记表里的类名，就会静止在
 * 首帧，看起来像坏了。这里验证 theme-ui 组件产出的标记能被登记表匹配到，且不再自带内联动画。
 */
describe("in-progress indicators are matched by the live-animation registry", () => {
	it("streaming status dot", () => {
		const { container } = render(<AssistantMessage.StreamingStatus label="working" />);
		const dot = container.querySelector(LIVE_SELECTOR);
		expect(dot?.className).toContain("vetta-live-dot");
		expect(dot?.getAttribute("style")).toBeNull();
	});

	it("pulsing activity dot exposes halo and core, idle dot exposes nothing", () => {
		const active = render(<ActivityStatusDot pulse tone="primary" />);
		const consumers = active.container.querySelectorAll(LIVE_SELECTOR);
		expect(consumers).toHaveLength(2);
		expect(consumers[0]?.className).toContain("activity-dot-halo");
		expect(consumers[1]?.className).toContain("activity-dot-core");
		for (const consumer of consumers) expect(consumer.getAttribute("style")).toBeNull();

		const idle = render(<ActivityStatusDot pulse={false} tone="emerald" />);
		expect(idle.container.querySelector(LIVE_SELECTOR)).toBeNull();
	});

	it("todo label sheen class is only attached while work is in progress", () => {
		expect(todoLabelSheenClassName(true)).toBe("todo-label-sheen");
		expect(LIVE_ANIMATION_SELECTORS).toContain(".todo-label-sheen");
		expect(todoLabelSheenClassName(false)).toBeUndefined();
	});
});
