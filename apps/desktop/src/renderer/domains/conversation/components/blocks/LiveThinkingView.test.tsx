// @vitest-environment jsdom
import { LiveThinkingView } from "@vetta-org/theme-ui/chat";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("LiveThinkingView", () => {
	it("用 CSS grid 入场，而不是 motion 的 height:auto", () => {
		const { container } = render(<LiveThinkingView text="thinking..." />);
		const root = container.firstElementChild as HTMLElement | null;
		expect(root).not.toBeNull();
		expect(root?.className).toContain("grid");
		expect(root?.className).toContain("grid-rows-[0fr]");
		expect(root?.getAttribute("style") ?? "").not.toMatch(/height/i);
	});
});
