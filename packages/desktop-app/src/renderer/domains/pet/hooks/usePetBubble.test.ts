// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { type ShowPetBubbleInput, usePetBubble } from "./usePetBubble";

interface BubbleProbe {
	readonly text: string | undefined;
	show(input: ShowPetBubbleInput): void;
}

let container: HTMLDivElement;
let root: Root;
let probe: BubbleProbe | undefined;

beforeEach(() => {
	vi.useFakeTimers();
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	container = document.createElement("div");
	document.body.append(container);
});

afterEach(() => {
	act(() => root?.unmount());
	container.remove();
	probe = undefined;
	vi.useRealTimers();
});

it("advances to the next queued message when the current TTL expires", () => {
	function Probe() {
		const bubble = usePetBubble();
		probe = { text: bubble.bubble?.text, show: bubble.showBubble };
		return null;
	}

	act(() => {
		root = createRoot(container);
		root.render(createElement(Probe));
	});
	act(() => {
		probe?.show({ text: "第一条", ttlMs: 1_000, sessionId: "s1", dedupeKey: "status" });
		probe?.show({ text: "第二条", ttlMs: 1_000, sessionId: "s2", dedupeKey: "status" });
	});
	expect(probe?.text).toBe("第一条");

	act(() => vi.advanceTimersByTime(2_000));
	expect(probe?.text).toBe("第二条");

	act(() => vi.advanceTimersByTime(1_000));
	expect(probe?.text).toBeUndefined();
});
