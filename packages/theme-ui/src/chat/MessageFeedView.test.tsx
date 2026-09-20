import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { MessageFeedRoot, MessageFeedVirtualList } from "./MessageFeedView";

const captured = vi.hoisted(() => ({ props: undefined as Record<string, unknown> | undefined }));

vi.mock("react-virtuoso", () => ({
	Virtuoso: (props: Record<string, unknown>) => {
		captured.props = props;
		return null;
	},
}));

beforeEach(() => {
	captured.props = undefined;
});

it("uses per-item estimates as the only initial size source for dynamic rows", () => {
	const heightEstimates = [80, 2_640];
	const itemSize = (element: HTMLElement, field: "offsetHeight" | "offsetWidth") => element[field];

	renderToStaticMarkup(
		<MessageFeedRoot>
			<MessageFeedVirtualList
				items={["short", "long"]}
				defaultItemHeight={200}
				heightEstimates={heightEstimates}
				itemSize={itemSize}
			>
				{(item) => item}
			</MessageFeedVirtualList>
		</MessageFeedRoot>,
	);

	expect(captured.props?.heightEstimates).toBe(heightEstimates);
	expect(captured.props?.defaultItemHeight).toBeUndefined();
	expect(captured.props?.itemSize).toBe(itemSize);
	expect(captured.props?.skipAnimationFrameInResizeObserver).toBe(true);
});

it("falls back to the default item height when no per-item estimates are available", () => {
	renderToStaticMarkup(
		<MessageFeedRoot>
			<MessageFeedVirtualList items={[]} defaultItemHeight={200} heightEstimates={[]}>
				{(item) => item}
			</MessageFeedVirtualList>
		</MessageFeedRoot>,
	);

	expect(captured.props?.defaultItemHeight).toBe(200);
	expect(captured.props?.heightEstimates).toBeUndefined();
});

it("keeps real item content mounted while the user scrolls", () => {
	renderToStaticMarkup(
		<MessageFeedRoot>
			<MessageFeedVirtualList items={["message"]}>
				{(item) => item}
			</MessageFeedVirtualList>
		</MessageFeedRoot>,
	);

	expect(captured.props?.scrollSeekConfiguration).toBeUndefined();
});
