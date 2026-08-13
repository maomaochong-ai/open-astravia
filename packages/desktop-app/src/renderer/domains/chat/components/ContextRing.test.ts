// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ContextRing } from "./ContextRing";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const contextRingCapture = vi.hoisted(() => ({
	includeDetails: [] as boolean[],
	onOpenChange: null as ((open: boolean) => void) | null,
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
			details: null,
		};
	},
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@vetta/theme-ui/chat", () => ({
	ContextRingView: () => createElement("span", { "data-testid": "context-ring-view" }),
}));

vi.mock("@vetta/theme-ui/shared", () => ({
	CollapsePanel: ({ children }: { children: ReactNode }) => createElement("div", null, children),
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
	it("builds and renders details only after the user opens the popover", async () => {
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		contextRingCapture.includeDetails = [];
		contextRingCapture.onOpenChange = null;

		await act(async () => {
			root.render(createElement(ContextRing));
		});

		expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("Context 25% used");
		expect(container.textContent).not.toContain("contextRing.details.unavailableAfterRestart");
		expect(contextRingCapture.includeDetails.at(-1)).toBe(false);

		await act(async () => contextRingCapture.onOpenChange?.(true));

		expect(container.textContent).toContain("contextRing.details.unavailableAfterRestart");
		expect(contextRingCapture.includeDetails.at(-1)).toBe(true);

		await act(async () => root.unmount());
		container.remove();
	});
});
