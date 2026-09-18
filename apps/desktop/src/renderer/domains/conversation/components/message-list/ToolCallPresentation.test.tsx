// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { subagentsBySessionAtom } from "@shared/store/subagents-atoms";
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
import { SubagentCardsScope } from "./SubagentCardsScope";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

describe("ToolCallPresentation", () => {
	it("shows the child under its initiating tool call and opens its transcript", () => {
		const store = createStore();
		store.set(subagentsBySessionAtom, new Map([["parent", [{
			id: "child", taskName: "inspect", path: "/root/inspect", agentType: "explorer", status: "running",
			task: "inspect", parentSessionId: "parent", originToolCallId: "spawn-call",
			sessionFile: "/tmp/child.jsonl", startedAt: 1, generation: 0,
		}]]]));
		render(<Provider store={store}><SubagentCardsScope sessionId="parent"><ToolCallPresentation block={{ type: "tool_call", toolCallId: "spawn-call", toolName: "spawn_agent", args: {}, status: "success" }} /></SubagentCardsScope></Provider>);
		fireEvent.click(screen.getByTestId("subagent-reply-card").querySelector("button") as HTMLButtonElement);
		expect(navigate).toHaveBeenCalledWith({ to: "/viewer/$path", params: { path: encodeURIComponent("/tmp/child.jsonl") }, search: { origin: "subagent" } });
	});

	it("shows queued children before their transcript exists", () => {
		const store = createStore();
		store.set(subagentsBySessionAtom, new Map([["parent", [{
			id: "pending", taskName: "review", path: "/root/review", agentType: "workflow", status: "queued",
			task: "review", parentSessionId: "parent", originToolCallId: "dispatch-call", startedAt: 1, generation: 0,
		}]]]));
		render(<Provider store={store}><SubagentCardsScope sessionId="parent"><ToolCallPresentation block={{ type: "tool_call", toolCallId: "dispatch-call", toolName: "dispatch_workflows", args: {}, status: "success" }} /></SubagentCardsScope></Provider>);
		expect(screen.getByTestId("subagent-reply-card").querySelector("button")?.disabled).toBe(true);
	});
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
