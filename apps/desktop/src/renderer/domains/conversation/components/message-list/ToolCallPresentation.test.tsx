// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type { ToolCallBlock } from "@shared/store/atoms";
import { describe, expect, it, vi } from "vitest";

vi.mock("../blocks/ToolCallBlock", () => ({
	ToolCallBlockView: ({ block }: { block: ToolCallBlock }) => (
		<div data-testid="tool-call">{block.toolName}</div>
	),
}));
vi.mock("./TeamMemberReplyCard", () => ({
	TeamMemberReplyCard: ({ event }: { event: { memberName: string } }) => (
		<div data-testid="member-result">{event.memberName}</div>
	),
}));

import { ToolCallPresentation } from "./ToolCallPresentation";

describe("ToolCallPresentation", () => {
	it("renders member activity as a sibling of tool details", () => {
		const block: ToolCallBlock = {
			type: "tool_call",
			toolCallId: "tool-1",
			toolName: "team_send_message",
			args: {},
			status: "success",
		};
		render(
			<ToolCallPresentation
				block={block}
				presentation={{
					toolCallId: "tool-1",
					activities: [
						{
							kind: "team-member-summary",
							requestId: "request-1",
							memberId: "reviewer",
							memberName: "Review",
							state: "completed",
							recent: [],
							timestamp: 1,
						},
					],
				}}
			/>,
		);

		expect(screen.getByTestId("tool-call")).toBeTruthy();
		expect(screen.getByTestId("member-result").textContent).toBe("Review");
		expect(screen.getByTestId("tool-call").parentElement?.children).toHaveLength(2);
	});
});
