// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) => {
			if (key === "messageList.streamingPhrases") return [];
			if (key.startsWith("messageList.duration.")) return `${values?.seconds ?? 0}s`;
			if (key === "messageList.assistantFoldTip.waiting") return `waited ${values?.duration}`;
			return key;
		},
	}),
}));

vi.mock("@vetta/theme-sdk/appearance", () => ({ useThemeSurface: () => null }));
vi.mock("@shared/components/BotAvatar", () => ({ BotAvatar: () => null }));
vi.mock("@vetta/theme-ui/chat", () => ({
	AssistantMessageView: ({
		fallbackText,
		fold,
		labels,
	}: {
		fallbackText?: string;
		fold: { kind: string; waitingForFirstActivity?: boolean } | null;
		labels: { waiting: string; waitingFold: (elapsed: number) => string };
	}) => (
		<div>
			<span>{fold?.waitingForFirstActivity ? labels.waiting : "not-waiting"}</span>
			<span>{fold?.waitingForFirstActivity ? labels.waitingFold(12) : "no-timer"}</span>
			{fallbackText ? <span>{fallbackText}</span> : null}
		</div>
	),
	StreamingIndicator: () => null,
}));
vi.mock("../../hooks/useAssistantMessageModel", () => ({
	useAssistantMessageModel: () => ({
		conclusionText: "",
		exportProcessSegments: [],
		foldData: null,
		isCurrentlyStreaming: true,
		isPredicting: false,
		stagedNarration: true,
		segments: [],
		showDuration: false,
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
vi.mock("./expansionStore", () => ({ useExpansion: () => [false, vi.fn()] }));
vi.mock("./WorkSegmentRenderer", () => ({ WorkSegmentRenderer: () => null }));

import { AssistantMessage } from "./AssistantMessage";

describe("AssistantMessage first-response waiting state", () => {
	it("projects an empty streaming draft as a waiting assistant message without an ellipsis body", () => {
		render(
			<AssistantMessage
				isStreaming
				isTailMessage
				message={{
					id: "assistant-waiting",
					role: "assistant",
					text: "",
					blocks: [],
					startedAt: 1_000,
				}}
			/>,
		);

		expect(screen.getByText("messageList.assistantMessage.waiting")).toBeTruthy();
		expect(screen.getByText("waited 12s")).toBeTruthy();
		expect(screen.queryByText("…")).toBeNull();
	});
});
