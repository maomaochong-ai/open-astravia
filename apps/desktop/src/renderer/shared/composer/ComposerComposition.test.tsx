// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { ConversationComposer } from "@vetta/theme-ui/chat";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerCapabilityRegion } from "./ComposerCapabilityRegion";
import { composeComposerCapabilities } from "./capabilities";

vi.mock("@vetta/theme-sdk/appearance", () => ({ useThemeSurface: () => undefined }));

afterEach(cleanup);

describe("composer layout composition", () => {
	it("renders installed abilities at compound layout anchors and omits removed abilities", () => {
		type Region = "routing" | "editor" | "toolbar";
		const composition = composeComposerCapabilities<Region, ReactNode>([
			{
				id: "routing",
				contributions: [{ id: "members", region: "routing", value: <span>Members</span> }],
			},
			false,
			{
				id: "editor",
				contributions: [{ id: "input", region: "editor", value: <span>Editor</span> }],
			},
		]);

		render(
			<ConversationComposer.Root focused={false}>
				<ConversationComposer.Content>
					<ConversationComposer.Routing>
						<ComposerCapabilityRegion composition={composition} region="routing" />
					</ConversationComposer.Routing>
					<ConversationComposer.Editor>
						<ComposerCapabilityRegion composition={composition} region="editor" />
					</ConversationComposer.Editor>
					<ConversationComposer.Toolbar>
						<ComposerCapabilityRegion composition={composition} region="toolbar" />
					</ConversationComposer.Toolbar>
				</ConversationComposer.Content>
			</ConversationComposer.Root>,
		);

		expect(screen.getByText("Members")).toBeTruthy();
		expect(screen.getByText("Editor")).toBeTruthy();
		expect(screen.queryByText("Toolbar")).toBeNull();
	});
});
