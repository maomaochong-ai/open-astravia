import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@astravia-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../src/canvas/raster-cache", () => ({
	loadRasters: () => Promise.resolve(new Map([["b", "data:image/png;base64,AA=="]])),
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PreviewFrameRail } from "../src/preview-mode/PreviewFrameRail";
import type { VetdFrameEntry } from "../src/astd/manifest-types";

/** React 19 的 act 需要这个开关，否则每次更新都会告警。 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class StubResizeObserver {
	observe(): void {}
	disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= StubResizeObserver;

let host: HTMLDivElement;
let root: Root;

function frame(id: string, x: number): VetdFrameEntry {
	return { id, title: id.toUpperCase(), file: `${id}.tsx`, x, y: 0, width: 390, height: 844 };
}

const frames = [frame("a", 0), frame("b", 500)];

function items(): HTMLElement[] {
	return [...document.body.querySelectorAll<HTMLElement>("button[title]")];
}

async function render(node: React.ReactElement): Promise<void> {
	await act(async () => {
		root.render(node);
		await Promise.resolve();
	});
}

beforeEach(() => {
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	document.body.innerHTML = "";
});

describe("PreviewFrameRail", () => {
	it("lists one thumbnail per frame and marks the current one", async () => {
		await render(
			<PreviewFrameRail frames={frames} currentFrameId="b" vetdPath="/tmp/demo.vetd" onPick={vi.fn()} />,
		);

		expect(items().map((element) => element.getAttribute("title"))).toEqual(["A", "B"]);
		expect(items().map((element) => element.getAttribute("aria-current"))).toEqual(["false", "true"]);
	});

	// 缩略图取的是画布缓存位图；没有缓存的画框只留占位，不为一列小图再截一遍。
	it("shows the cached raster where there is one", async () => {
		await render(
			<PreviewFrameRail frames={frames} currentFrameId="a" vetdPath="/tmp/demo.vetd" onPick={vi.fn()} />,
		);

		expect(document.body.querySelectorAll("img")).toHaveLength(1);
	});

	it("picks the clicked frame", async () => {
		const onPick = vi.fn();
		await render(<PreviewFrameRail frames={frames} currentFrameId="a" vetdPath="/tmp/demo.vetd" onPick={onPick} />);

		act(() => {
			items()[1].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
		});

		expect(onPick).toHaveBeenCalledWith("b");
	});

	// 一个画框都没有时不要在预览窗旁边留一条空壳。
	it("renders nothing without frames", async () => {
		await render(<PreviewFrameRail frames={[]} currentFrameId={null} vetdPath="/tmp/demo.vetd" onPick={vi.fn()} />);

		expect(host.innerHTML).toBe("");
	});
});
