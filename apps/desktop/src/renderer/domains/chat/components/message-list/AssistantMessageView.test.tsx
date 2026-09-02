// @vitest-environment jsdom
import { AssistantMessageView, type AssistantMessageViewLabels } from "@vetta/theme-ui/chat";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@vetta/theme-sdk/appearance", () => ({
	useThemeSurface: () => null,
}));

const labels: AssistantMessageViewLabels = {
	processing: "processing",
	waiting: "waiting",
	predicting: "predicting",
	streamingFold: (elapsed) => `streaming ${elapsed}`,
	waitingFold: (elapsed) => `waited ${elapsed}`,
	expandFold: (count) => `expand ${count}`,
	collapseFold: (count) => `collapse ${count}`,
	streamingPhrases: [],
};

describe("AssistantMessageView", () => {
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it("renders turn actions when the assistant turn has no conclusion text", () => {
		render(
			<AssistantMessageView
				author="Vetta"
				showDuration={false}
				isCurrentlyStreaming={false}
				isPredicting={false}
				conclusionText=""
				fold={null}
				labels={labels}
				botAvatar={null}
				segments={null}
				fallbackText="done"
				actions={<button type="button">token usage</button>}
				messageCards={null}
				onToggleExpanded={() => undefined}
			/>,
		);

		expect(screen.getByRole("button", { name: "token usage" })).toBeTruthy();
	});

	it("shows the assistant header and stable elapsed state before first model activity", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(66_000));
		render(
			<AssistantMessageView
				author="Vetta"
				showDuration={false}
				isCurrentlyStreaming
				isPredicting={false}
				conclusionText=""
				fold={{ kind: "streaming", count: 0, startedAt: 1_000, waitingForFirstActivity: true }}
				labels={labels}
				botAvatar={null}
				segments={null}
				actions={null}
				messageCards={null}
				onToggleExpanded={() => undefined}
			/>,
		);

		expect(screen.getByText("Vetta")).toBeTruthy();
		expect(screen.getByText("waiting")).toBeTruthy();
		expect(screen.getByText("waited 65")).toBeTruthy();
		expect(screen.queryByText("…")).toBeNull();
	});
});
