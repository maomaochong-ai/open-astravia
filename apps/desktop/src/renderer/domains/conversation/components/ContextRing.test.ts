// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextRingModel } from "../hooks/useContextRingModel";
import type { ContextRingDetailsModel } from "../services/context-ring-details";
import { ContextRing } from "./ContextRing";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const contextRingCapture = vi.hoisted(() => ({
	includeDetails: [] as boolean[],
	onOpenChange: null as ((open: boolean) => void) | null,
	details: null as unknown,
}));

vi.mock("../hooks/useContextRingModel", () => ({
	useContextRingModel: (includeDetails: boolean) => {
		contextRingCapture.includeDetails.push(includeDetails);
		return {
			percent: 25,
			offset: 10,
			color: "currentColor",
			isCompacting: false,
			tooltip: "Context 25% used",
			details: includeDetails ? contextRingCapture.details : null,
		};
	},
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@vetta/theme-ui/chat", () => ({
	ContextRingView: () => createElement("span", { "data-testid": "context-ring-view" }),
}));

vi.mock("@shared/components/ui/button", () => ({
	Button: ({ children, "aria-label": ariaLabel }: { children: ReactNode; "aria-label"?: string }) =>
		createElement("button", { type: "button", "aria-label": ariaLabel }, children),
}));

vi.mock("@shared/components/ui/popover", () => ({
	Popover: ({ children, onOpenChange }: { children: ReactNode; onOpenChange?: (open: boolean) => void }) => {
		contextRingCapture.onOpenChange = onOpenChange ?? null;
		return createElement("div", null, children);
	},
	PopoverContent: ({ children }: { children: ReactNode }) => createElement("section", null, children),
	PopoverTitle: ({ children }: { children: ReactNode }) => createElement("h2", null, children),
	PopoverTrigger: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}));

describe("ContextRing", () => {
	beforeEach(() => {
		contextRingCapture.includeDetails = [];
		contextRingCapture.onOpenChange = null;
		contextRingCapture.details = null;
	});

	it("builds and renders details only after the user opens the popover", async () => {
		const { container, unmount } = render();

		expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("Context 25% used");
		expect(container.textContent).not.toContain("contextRing.details.unavailableAfterRestart");
		expect(contextRingCapture.includeDetails).toHaveLength(0);

		await act(async () => contextRingCapture.onOpenChange?.(true));

		expect(container.textContent).toContain("contextRing.details.unavailableAfterRestart");
		expect(contextRingCapture.includeDetails).toHaveLength(0);

		await unmount();
	});

	it("renders actual context usage with calibrated group tokens and normalized composition", async () => {
		contextRingCapture.details = details();
		const { container, unmount } = render({
			percent: 25,
			offset: 10,
			color: "currentColor",
			isCompacting: false,
			tooltip: "Context 25% used",
			details: details(),
		});

		await act(async () => contextRingCapture.onOpenChange?.(true));

		// 两个分项占估算构成的 25% 与 75%，合计 100%。
		const widths = [...container.querySelectorAll<HTMLElement>("section [aria-label]")].map(
			(node) => node.style.width,
		);
		expect(widths).toEqual(["25%", "75%"]);
		expect(container.textContent).toContain("8");
		expect(container.textContent).toContain("24");
		expect(container.textContent).toContain("contextRing.details.actual");
		expect(container.textContent).toContain("32 / 400");
		expect(container.textContent).not.toContain("contextRing.details.estimated");
		expect(container.textContent).not.toContain("≈");

		await unmount();
	});

	it("opens the selected group as a second pane and returns to the overview", async () => {
		contextRingCapture.details = details();
		const { container, unmount } = render({
			percent: 25,
			offset: 10,
			color: "currentColor",
			isCompacting: false,
			tooltip: "Context 25% used",
			details: details(),
		});
		await act(async () => contextRingCapture.onOpenChange?.(true));

		await act(async () => click(container, '[aria-label="group:tools"]'));

		expect(container.textContent).toContain("tool:read");
		expect(container.textContent).not.toContain("group:conversation");

		await act(async () => click(container, '[aria-label="contextRing.details.back"]'));

		expect(container.textContent).toContain("group:conversation");
		expect(container.textContent).not.toContain("tool:read");

		await unmount();
	});

	it("resets to the overview when the popover closes", async () => {
		contextRingCapture.details = details();
		const { container, unmount } = render({
			percent: 25,
			offset: 10,
			color: "currentColor",
			isCompacting: false,
			tooltip: "Context 25% used",
			details: details(),
		});
		await act(async () => contextRingCapture.onOpenChange?.(true));
		await act(async () => click(container, '[aria-label="group:tools"]'));

		await act(async () => contextRingCapture.onOpenChange?.(false));
		await act(async () => contextRingCapture.onOpenChange?.(true));

		expect(container.textContent).toContain("group:conversation");
		expect(container.textContent).not.toContain("tool:read");

		await unmount();
	});
});

function render(
	model: ContextRingModel | null = {
		percent: 25,
		offset: 10,
		color: "currentColor",
		isCompacting: false,
		tooltip: "Context 25% used",
		details: null,
	},
): { container: HTMLElement; unmount: () => Promise<void> } {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	act(() => {
		root.render(createElement(ContextRing, { model }));
	});
	return {
		container,
		unmount: async () => {
			await act(async () => root.unmount());
			container.remove();
		},
	};
}

function click(container: HTMLElement, selector: string): void {
	const target = container.querySelector<HTMLElement>(selector);
	if (!target) throw new Error(`missing element: ${selector}`);
	target.click();
}

function details(): ContextRingDetailsModel {
	return {
		phase: "completed",
		model: "openai/gpt-test",
		actualTokens: "32",
		windowLabel: "400",
		groups: [
			{
				id: "tools",
				title: "group:tools",
				tokens: "8",
				share: "25.0%",
				tokenCount: 10,
				itemCount: 1,
				unknownCount: 0,
				sections: [
					{
						id: "tool:read",
						title: "tool:read",
						metadata: "owner:runtime",
						tokens: "8",
						share: "25.0%",
						tokenCount: 10,
						itemCount: 1,
						unknownCount: 0,
					},
				],
			},
			{
				id: "conversation",
				title: "group:conversation",
				tokens: "24",
				share: "75.0%",
				tokenCount: 30,
				itemCount: 1,
				unknownCount: 0,
				sections: [],
			},
		],
	};
}
