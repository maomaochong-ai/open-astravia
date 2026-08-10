// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ContextRing } from "./ContextRing";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("../hooks/useContextRingModel", () => ({
	useContextRingModel: () => ({
		percent: 25,
		offset: 10,
		color: "currentColor",
		isCompacting: false,
		tooltip: "Context 25% used",
		details: null,
	}),
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
	Button: ({ children }: { children: ReactNode }) => createElement("button", { type: "button" }, children),
}));

vi.mock("@shared/components/ui/popover", () => ({
	Popover: ({ children }: { children: ReactNode }) => createElement("div", null, children),
	PopoverContent: ({ children }: { children: ReactNode }) => createElement("section", null, children),
	PopoverTitle: ({ children }: { children: ReactNode }) => createElement("h2", null, children),
	PopoverTrigger: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}));

describe("ContextRing", () => {
	it("renders an actionable fallback when restored usage has no composition report", async () => {
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(createElement(ContextRing));
		});

		expect(container.textContent).toContain("Context 25% used");
		expect(container.textContent).toContain("contextRing.details.unavailableAfterRestart");

		await act(async () => root.unmount());
		container.remove();
	});
});
