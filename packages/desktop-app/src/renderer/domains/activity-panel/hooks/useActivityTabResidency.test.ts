// @vitest-environment jsdom

import type { ActivityTabKey } from "@shared/lib/project-profile";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityTabDefinition, ResolvedActivityTab } from "../registry/types";
import { useActivityTabResidency } from "./useActivityTabResidency";

function tab(id: string): ResolvedActivityTab {
	const definition: ActivityTabDefinition = {
		id,
		source: "builtin",
		useMeta: () => ({ label: id }),
		component: () => null,
	};
	return { id, label: id, removable: true, source: "builtin", definition };
}

describe("useActivityTabResidency", () => {
	let activeTab: ActivityTabKey;
	let container: HTMLDivElement;
	let root: Root;
	const candidates = [tab("file"), tab("todo"), tab("debug")];

	function Harness(): ReturnType<typeof createElement> {
		const residentTabs = useActivityTabResidency({
			activeTab,
			candidates,
			floatingKeys: new Set(),
			maxInactiveWarmTabs: 1,
			scopeKey: "C:/repo",
			warmEligibleTabs: candidates,
		});
		return createElement("output", null, residentTabs.map((item) => item.id).join(","));
	}

	beforeEach(() => {
		vi.useFakeTimers();
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		activeTab = "file";
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		vi.useRealTimers();
	});

	it("keeps visited tabs through the switch and evicts overflow after the fallback delay", () => {
		act(() => root.render(createElement(Harness)));
		expect(container.textContent).toBe("file");

		activeTab = "todo";
		act(() => root.render(createElement(Harness)));
		activeTab = "debug";
		act(() => root.render(createElement(Harness)));
		expect(container.textContent).toBe("file,todo,debug");

		act(() => vi.advanceTimersByTime(250));
		expect(container.textContent).toBe("todo,debug");
	});
});
