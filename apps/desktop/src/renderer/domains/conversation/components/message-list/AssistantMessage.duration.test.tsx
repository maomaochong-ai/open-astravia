// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { createConversationAgentMessage } from "@shared/conversation";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => (key === "messageList.duration.lessThanSecond" ? "少于1秒" : key),
	}),
}));

vi.mock("@vetta-org/theme-sdk/appearance", () => ({ useThemeSurface: () => null }));
vi.mock("@shared/components/BotAvatar", () => ({ BotAvatar: () => null }));
vi.mock("../../hooks/useAssistantMessageModel", () => ({
	useAssistantMessageModel: () => ({
		conclusionText: "done",
		exportProcessSegments: [],
		foldData: null,
		isCurrentlyStreaming: false,
		isPredicting: false,
		liveThinkingId: null,
		segments: [],
		durationAvailable: true,
		streamingTailIndex: -1,
		workFoldCount: 0,
	}),
}));
vi.mock("../MessageCardsHost", () => ({ MessageCardsHost: () => null }));
vi.mock("./MessageActions", () => ({
	CopyButton: () => null,
	RelativeTimeLabel: () => null,
	formatTime: () => "",
}));
vi.mock("./MessageTokenUsage", () => ({ MessageTokenUsage: () => null }));
vi.mock("./MessageBlockSegments", () => ({ SegmentRenderer: ({ children }: { children?: ReactNode }) => children }));
vi.mock("./expansionStore", () => ({ useExpansion: () => [false, vi.fn()] as const }));
vi.mock("./WorkSegmentRenderer", () => ({ WorkSegmentRenderer: () => null }));

import { AssistantMessage } from "./AssistantMessage";

describe("AssistantMessage duration", () => {
	it("shows an explicit sub-second duration instead of hiding a completed zero value", () => {
		render(
			<AssistantMessage
				isStreaming={false}
				isTailMessage={false}
				message={createConversationAgentMessage({
					id: "assistant-fast",
					phase: "completed",
					text: "done",
					blocks: [],
					durationSeconds: 0,
				})}
			/>,
		);

		expect(screen.getByText("少于1秒")).toBeTruthy();
	});
});
