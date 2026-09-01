// @vitest-environment jsdom

import { ConversationTimelineView } from "@vetta/theme-ui/chat";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-virtuoso", () => ({
	Virtuoso: (props: {
		readonly data: readonly string[];
		readonly itemContent: (index: number, item: string) => ReactNode;
		readonly computeItemKey?: (index: number, item: string) => string | number;
		readonly increaseViewportBy?: number | { readonly top: number; readonly bottom: number };
	}) => {
		const mergedProps = {
			computeItemKey: (index: number) => index,
			increaseViewportBy: { top: 0, bottom: 0 },
			...props,
		};
		const viewportTop =
			typeof mergedProps.increaseViewportBy === "number"
				? mergedProps.increaseViewportBy
				: mergedProps.increaseViewportBy!.top;
		return (
			<div data-viewport-top={viewportTop}>
				{mergedProps.data.map((item, index) => (
					<div key={mergedProps.computeItemKey!(index, item)}>
						{mergedProps.itemContent(index, item)}
					</div>
				))}
			</div>
		);
	},
}));

describe("ConversationTimelineView", () => {
	it("preserves Virtuoso defaults when the host omits optional callbacks and viewport settings", () => {
		render(
			<ConversationTimelineView
				items={["first message"]}
				defaultItemHeight={24}
				renderItem={(_, item) => <div>{item}</div>}
			/>,
		);

		expect(screen.getByText("first message")).toBeTruthy();
	});
});
