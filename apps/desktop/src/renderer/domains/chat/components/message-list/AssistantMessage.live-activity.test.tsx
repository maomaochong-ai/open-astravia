// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => (key === "messageList.streamingPhrases" ? [] : key),
	}),
}));

vi.mock("@vetta/theme-sdk/appearance", () => ({ useThemeSurface: () => null }));
vi.mock("@shared/components/BotAvatar", () => ({ BotAvatar: () => null }));
vi.mock("@vetta/theme-ui/chat", () => ({
	AssistantMessageView: ({ segments }: { segments: ReactNode }) => <div>{segments}</div>,
	LiveThinkingView: ({ active, text }: { active: boolean; text: string }) =>
		active ? <span data-testid="live-thinking">{text}</span> : null,
	StreamingIndicator: () => null,
}));
vi.mock("../../hooks/useAssistantMessageModel", () => ({
	useAssistantMessageModel: () => ({
		conclusionText: "",
		exportProcessSegments: [],
		foldData: null,
		isCurrentlyStreaming: true,
		isPredicting: false,
		liveThinking: { type: "thinking", id: "source-block", text: "分析中" },
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
		showDuration: false,
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
		hoistedThinkingId,
		isLiveActivity,
		segment,
	}: { hoistedThinkingId?: string; isLiveActivity?: boolean; segment: { id: string } }) => (
		<span data-testid={`segment-${segment.id}`} data-hoisted={hoistedThinkingId}>
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
				message={{
					id: "assistant-1",
					role: "assistant",
					text: "",
					blocks: [{ type: "thinking", id: "source-block", text: "分析中" }],
				}}
			/>,
		);

		expect(screen.getByTestId("segment-first").textContent).toBe("idle");
		expect(screen.getByTestId("segment-latest").textContent).toBe("live");
	});

	it("把进行中的思考提升到消息末尾，并告诉各段跳过原位渲染", () => {
		render(
			<AssistantMessage
				isStreaming
				isTailMessage
				message={{
					id: "assistant-1",
					role: "assistant",
					text: "",
					blocks: [{ type: "thinking", id: "source-block", text: "分析中" }],
				}}
			/>,
		);

		expect(screen.getByTestId("live-thinking").textContent).toBe("分析中");
		expect(screen.getByTestId("segment-latest").getAttribute("data-hoisted")).toBe("source-block");
	});
});
