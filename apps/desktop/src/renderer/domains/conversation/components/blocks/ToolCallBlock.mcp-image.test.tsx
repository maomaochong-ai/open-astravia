// @vitest-environment jsdom
import type { ToolCallBlock } from "@shared/store/atoms";
import { render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./tool-views/ReadImageView", () => ({
	ReadImageView: ({ image }: { image: { data: string; mimeType: string } }) => (
		<img alt="MCP result" src={`data:${image.mimeType};base64,${image.data}`} />
	),
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

import { EmbeddedToolCallBlockView } from "./ToolCallBlock";

function block(toolName: string): ToolCallBlock {
	return {
		type: "tool_call",
		toolCallId: "call-1",
		toolName,
		args: {},
		status: "success",
		result: "MCP result",
		imagePreview: { data: "aW1hZ2U=", mimeType: "image/png" },
	};
}

function Wrapper({ children }: { children: ReactNode }) {
	return <Provider store={createStore()}>{children}</Provider>;
}

describe("ToolCallBlock MCP images", () => {
	it("renders an image preview for an MCP tool result", () => {
		render(<EmbeddedToolCallBlockView block={block("mcp_demo_screenshot")} />, { wrapper: Wrapper });

		expect(screen.getByRole("img", { name: "MCP result" }).getAttribute("src")).toBe(
			"data:image/png;base64,aW1hZ2U=",
		);
	});

	it("renders every image block in a gallery", () => {
		const value = block("mcp_demo_screenshot");
		value.imagePreviews = [
			{ data: "aW1hZ2Ux", mimeType: "image/png" },
			{ data: "aW1hZ2Uy", mimeType: "image/jpeg" },
		];
		render(<EmbeddedToolCallBlockView block={value} />, { wrapper: Wrapper });

		expect(screen.getAllByRole("img", { name: "MCP result" })).toHaveLength(2);
	});
});
