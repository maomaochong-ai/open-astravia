// @vitest-environment jsdom
import { AssistantMessageView, type AssistantMessageViewLabels } from "@vetta/theme-ui/chat";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@vetta/theme-sdk/appearance", () => ({
	useThemeSurface: () => null,
}));

const labels: AssistantMessageViewLabels = {
	processing: "processing",
	predicting: "predicting",
	streamingFold: (elapsed) => `streaming ${elapsed}`,
	expandFold: (count) => `expand ${count}`,
	collapseFold: (count) => `collapse ${count}`,
	streamingPhrases: [],
};

describe("AssistantMessageView", () => {
	it("renders turn actions when the assistant turn has no conclusion text", () => {
		render(
			<AssistantMessageView
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
});
