// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModelSelectorView, type ModelSelectorViewProps } from "@vetta-org/theme-ui/chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class ResizeObserverStub {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

const labels: ModelSelectorViewProps["labels"] = {
	placeholder: "Choose model",
	searchPlaceholder: "Search models",
	clearSearch: "Clear search",
	noResults: "No models",
	noResultsHint: "Try another query",
	reasoningHeader: "Reasoning",
	modelHeader: "Models",
	cloudOnly: "Cloud",
	visionBadge: "Vision",
	defaultBadge: "Default",
	levelLabel: (value) => value,
};

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", ResizeObserverStub);
	HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("ModelSelectorView", () => {
	it("opens, searches and selects without locking the surrounding document", async () => {
		const user = userEvent.setup();
		const onModelSelect = vi.fn();
		render(
			<ModelSelectorView
				selectedModel="provider/alpha"
				selectedOption={{
					key: "provider/alpha",
					provider: "provider",
					modelId: "alpha",
					displayName: "Alpha",
				}}
				menuLevels={[]}
				groups={[
					{
						provider: "provider",
						label: "Provider",
						models: [
							{
								key: "provider/alpha",
								provider: "provider",
								modelId: "alpha",
								displayName: "Alpha",
							},
							{
								key: "provider/beta",
								provider: "provider",
								modelId: "beta",
								displayName: "Beta",
							},
						],
					},
				]}
				labels={labels}
				onModelSelect={onModelSelect}
				onReasoningSelect={vi.fn()}
			/>,
		);

		const trigger = screen.getByRole("button", { name: "Alpha" });
		await user.click(trigger);

		const search = await screen.findByRole("searchbox", { name: "Search models" });
		await waitFor(() => expect(document.activeElement).toBe(search));
		expect(document.body.hasAttribute("data-scroll-locked")).toBe(false);
		expect(document.body.style.pointerEvents).not.toBe("none");

		await user.type(search, "beta");
		expect(screen.queryByRole("menuitem", { name: "Alpha" })).toBeNull();
		await user.click(screen.getByRole("menuitem", { name: "Beta" }));

		expect(onModelSelect).toHaveBeenCalledWith("provider/beta");
		await waitFor(() => expect(screen.queryByRole("searchbox", { name: "Search models" })).toBeNull());
		await waitFor(() => expect(document.activeElement).toBe(trigger));
	});
});
