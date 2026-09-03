// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) => {
			if (key === "thinkingBlock.title") return "思考过程";
			if (key === "thinkingBlock.lineCount") return `${values?.count} 行`;
			return key;
		},
	}),
}));

import { LiveThinkingView } from "@vetta/theme-ui/chat";
import { ThinkingBlockView } from "./ThinkingBlock";

describe("ThinkingBlockView", () => {
	it("历史思考是折叠条，正文默认不展开", () => {
		render(<ThinkingBlockView text={"第一行\n第二行"} />);

		const toggle = screen.getByRole("button");
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(screen.getByText("思考过程")).toBeTruthy();
		expect(screen.getByText("2 行")).toBeTruthy();
	});
});

describe("LiveThinkingView", () => {
	it("进行中时直接展示正文，不给标题也不给折叠开关", () => {
		render(<LiveThinkingView text={"第一行\n第二行"} />);

		expect(screen.getByText(/第二行/)).toBeTruthy();
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("追加新内容时就地换文本，不卸载重挂", () => {
		const { rerender } = render(<LiveThinkingView text="第一段思考" />);
		rerender(<LiveThinkingView text="第一段思考，第二段思考" />);

		expect(screen.getByText("第一段思考，第二段思考")).toBeTruthy();
	});
});
