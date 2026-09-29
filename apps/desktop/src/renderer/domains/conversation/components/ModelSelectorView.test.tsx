// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModelSelectorView, type ModelSelectorViewProps } from "@vetta-org/theme-ui/chat";
import { DetailDrawer } from "@vetta-org/theme-ui/overlays";
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
	vi.stubGlobal("matchMedia", (query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		addListener: vi.fn(),
		removeListener: vi.fn(),
		dispatchEvent: vi.fn(() => true),
	}));
	HTMLElement.prototype.scrollIntoView = vi.fn();
	HTMLElement.prototype.setPointerCapture = vi.fn();
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

	it("supports a controlled empty selection and a disabled trigger", async () => {
		const user = userEvent.setup();
		const onEmptySelect = vi.fn();
		const { rerender } = render(
			<ModelSelectorView
				ariaLabel="Member model"
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
						],
					},
				]}
				labels={labels}
				emptyOption={{ label: "Follow conversation default", onSelect: onEmptySelect }}
				onModelSelect={vi.fn()}
				onReasoningSelect={vi.fn()}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "Member model" }));
		await user.click(await screen.findByRole("menuitem", { name: "Follow conversation default" }));
		expect(onEmptySelect).toHaveBeenCalledOnce();

		rerender(
			<ModelSelectorView
				ariaLabel="Member model"
				disabled
				selectedModel="provider/alpha"
				selectedOption={{
					key: "provider/alpha",
					provider: "provider",
					modelId: "alpha",
					displayName: "Alpha",
				}}
				menuLevels={[]}
				groups={[]}
				labels={labels}
				onModelSelect={vi.fn()}
				onReasoningSelect={vi.fn()}
			/>,
		);

		const disabledTrigger = screen.getByRole("button", { name: "Member model" });
		expect(disabledTrigger).toHaveProperty("disabled", true);
		await user.click(disabledTrigger);
		expect(screen.queryByRole("searchbox", { name: "Search models" })).toBeNull();
	});

	it("keeps its scrollable menu inside a modal drawer's scroll boundary", async () => {
		render(
			<DetailDrawer open title="Team" onClose={vi.fn()}>
				<ModelSelectorView
					selectedOption={null}
					menuLevels={[]}
					groups={[
						{
							provider: "provider",
							label: "Provider",
							models: Array.from({ length: 30 }, (_, index) => ({
								key: `provider/model-${index}`,
								provider: "provider",
								modelId: `model-${index}`,
								displayName: `Model ${index}`,
							})),
						},
					]}
					labels={labels}
					onModelSelect={vi.fn()}
					onReasoningSelect={vi.fn()}
				/>
			</DetailDrawer>,
		);

		fireEvent.keyDown(screen.getByRole("button", { name: "Choose model" }), { key: "Enter" });
		const drawer = document.querySelector('[data-slot="drawer-content"]');
		const menu = document.querySelector('[data-slot="dropdown-menu-content"]');
		expect(drawer).not.toBeNull();
		expect(menu).not.toBeNull();
		expect(drawer?.contains(menu)).toBe(true);
	});
});
