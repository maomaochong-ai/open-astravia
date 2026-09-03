// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { createConversationAgentMessage } from "@shared/conversation";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => (key === "messageList.streamingPhrases" ? [] : key),
	}),
}));

vi.mock("@vetta/theme-sdk/appearance", () => ({ useThemeSurface: () => null }));
vi.mock("@shared/components/BotAvatar", () => ({ BotAvatar: () => null }));
vi.mock("../../hooks/useAssistantMessageModel", () => ({
	useAssistantMessageModel: () => ({
		conclusionText: "",
		exportProcessSegments: [],
		foldData: null,
		isCurrentlyStreaming: true,
		isPredicting: false,
		liveThinkingId: "source-block",
		stagedNarration: true,
		segments: [
			{
				type: "progress_group",
				id: "first",
				stageId: "shared",
				label: "第一段",
				closed: false,
				blocks: [],
			},
			{
				type: "progress_group",
				id: "latest",
				stageId: "shared",
				label: "第二段",
				closed: false,
				blocks: [],
			},
		],
		durationAvailable: false,
		streamingTailIndex: -1,
		workFoldCount: 0,
	}),
}));
vi.mock("../MessageCardsHost", () => ({ MessageCardsHost: () => null }));
vi.mock("./MessageActions", () => ({
	CopyButton: () => null,
	RelativeTimeLabel: () => null,
	formatDuration: () => "",
	formatTime: () => "",
}));
vi.mock("./MessageTokenUsage", () => ({ MessageTokenUsage: () => null }));
vi.mock("./MessageBlockSegments", () => ({ SegmentRenderer: () => null }));
vi.mock("./expansionStore", () => ({ useExpansion: () => [false, vi.fn()] }));
vi.mock("./WorkSegmentRenderer", () => ({
	WorkSegmentRenderer: ({
		liveThinkingId,
		isLiveActivity,
		segment,
	}: { liveThinkingId?: string | null; isLiveActivity?: boolean; segment: { id: string } }) => (
		<span data-testid={`segment-${segment.id}`} data-live-thinking={liveThinkingId ?? ""}>
			{isLiveActivity ? "live" : "idle"}
		</span>
	),
}));

import { AssistantMessage } from "./AssistantMessage";

describe("AssistantMessage live activity wiring", () => {
	it("同一流式阶段被切成多段时只把最后一段标为实时活动", () => {
		render(
			<AssistantMessage
				isStreaming
				isTailMessage
				message={createConversationAgentMessage({
					id: "assistant-1",
					phase: "streaming",
					text: "",
					blocks: [{ type: "thinking", id: "source-block", text: "分析中" }],
				})}
			/>,
		);

		expect(screen.getByTestId("segment-first").textContent).toBe("idle");
		expect(screen.getByTestId("segment-latest").textContent).toBe("live");
	});

	it("把进行中的思考交给所属段就地渲染，消息末尾不再单独提升一份", () => {
		render(
			<AssistantMessage
				isStreaming
				isTailMessage
				message={createConversationAgentMessage({
					id: "assistant-1",
					phase: "streaming",
					text: "",
					blocks: [{ type: "thinking", id: "source-block", text: "分析中" }],
				})}
			/>,
		);

		expect(screen.queryByTestId("live-thinking")).toBeNull();
		expect(screen.getByTestId("segment-latest").getAttribute("data-live-thinking")).toBe("source-block");
		expect(screen.getByTestId("segment-first").getAttribute("data-live-thinking")).toBe("source-block");
	});
});
