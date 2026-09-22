// @vitest-environment jsdom
import { AssistantMessage, todoLabelSheenClassName } from "@vetta-org/theme-ui/chat";
import { ActivityStatusDot } from "@vetta-org/theme-ui/shared";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

/**
 * 时钟只在页面上存在消费者时才跑（:root:has(...)），所以每个进行中的指示器都必须挂上
 * 门控类名；漏掉的那个会静止在相位 0，看起来像坏了。
 */
describe("in-progress indicators hang off the shared live clock", () => {
	it("streaming status dot uses the shared dot class instead of an inline pulse animation", () => {
		const { container } = render(<AssistantMessage.StreamingStatus label="working" />);
		const dot = container.querySelector(".vetta-live-dot");
		expect(dot).not.toBeNull();
		expect(dot?.getAttribute("style")).toBeNull();
	});

	it("pulsing activity dot marks both halo and core as clock consumers, idle dot does not", () => {
		const active = render(<ActivityStatusDot pulse tone="primary" />);
		const consumers = active.container.querySelectorAll(".vetta-live-phase");
		expect(consumers).toHaveLength(2);
		expect(consumers[0]?.className).toContain("activity-dot-halo");
		expect(consumers[1]?.className).toContain("activity-dot-core");
		for (const consumer of consumers) expect(consumer.getAttribute("style")).toBeNull();

		const idle = render(<ActivityStatusDot pulse={false} tone="emerald" />);
		expect(idle.container.querySelector(".vetta-live-phase")).toBeNull();
	});

	it("todo label sheen class is only attached while work is in progress", () => {
		expect(todoLabelSheenClassName(true)).toBe("vetta-live-phase todo-label-sheen");
		expect(todoLabelSheenClassName(false)).toBeUndefined();
	});
});
