import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	anchoredFirstItemIndex,
	FIRST_ITEM_INDEX_BASE,
	MessageFeedRoot,
	MessageFeedVirtualList,
} from "./MessageFeedView";

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

describe("anchoredFirstItemIndex", () => {
	const key = (item: string) => item;

	it("lowers the first index by the number of items inserted above, so shown items keep theirs", () => {
		const tail = ["m8", "m9"];
		const full = ["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9"];
		const first = anchoredFirstItemIndex(tail, full, FIRST_ITEM_INDEX_BASE, key);

		expect(first).toBe(FIRST_ITEM_INDEX_BASE - 8);
		// "m8" had index BASE + 0 and still has it.
		expect(first + full.indexOf("m8")).toBe(FIRST_ITEM_INDEX_BASE);
	});

	it("keeps the first index when items are appended or updated in place", () => {
		expect(anchoredFirstItemIndex(["a", "b"], ["a", "b", "c"], 500, key)).toBe(500);
		expect(anchoredFirstItemIndex(["a", "b"], ["a", "b2"], 500, key)).toBe(500);
	});

	it("raises the first index when items are removed from the top", () => {
		expect(anchoredFirstItemIndex(["a", "b", "c"], ["c", "d"], 500, key)).toBe(502);
	});

	it("keeps the first index for an unrelated list", () => {
		expect(anchoredFirstItemIndex(["a", "b"], ["x", "y"], 500, key)).toBe(500);
	});
});

it("hands item renderers and keys positions in the list, not the anchored index", () => {
	renderToStaticMarkup(
		<MessageFeedRoot>
			<MessageFeedVirtualList items={["a", "b"]} getKey={(item, index) => `${item}:${index}`}>
				{(item, index) => `${item}@${index}`}
			</MessageFeedVirtualList>
		</MessageFeedRoot>,
	);

	const first = captured.props?.firstItemIndex as number;
	const itemContent = captured.props?.itemContent as (index: number, item: string) => string;
	const computeItemKey = captured.props?.computeItemKey as (index: number, item: string) => string;
	expect(first).toBe(FIRST_ITEM_INDEX_BASE);
	expect(itemContent(first + 1, "b")).toBe("b@1");
	expect(computeItemKey(first + 1, "b")).toBe("b:1");
});
