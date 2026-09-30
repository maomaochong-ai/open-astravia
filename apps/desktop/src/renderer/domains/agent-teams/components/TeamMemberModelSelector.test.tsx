// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamMemberModelSelector } from "./TeamMemberModelSelector";

const catalog = vi.hoisted(() => ({ revalidate: vi.fn(async () => undefined) }));
const modelOptions = vi.hoisted(() => {
	const visionModel = {
		provider: "provider",
		modelId: "vision",
		displayName: "Image Model",
		key: "provider/vision",
		supportsImage: true,
		reasoning: true,
		reasoningLevels: ["low", "high"],
		defaultReasoningLevel: "low",
		multiplier: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
	};
	return {
		options: [visionModel],
		grouped: new Map([["provider", [visionModel]]]),
		defaultKey: "provider/vision",
		iconFor: () => "provider-icon",
		labelFor: () => "Provider",
	};
});

vi.mock("@shared/store/model-catalog", () => ({ modelCatalog: catalog }));
vi.mock("@shared/components/ModelSelect/useModelOptions", () => ({
	useModelOptions: () => modelOptions,
}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, string | number>) => {
			const labels: Record<string, string> = {
				"modelSelect.clearSearch": "Clear search",
				"modelSelect.cloudOnly": "Cloud",
				"modelSelect.defaultBadge": "Default",
				"modelSelect.free": "Free",
				"modelSelect.modelHeader": "Models",
				"modelSelect.noResults": "No models",
				"modelSelect.noResultsHint": "Try another query",
				"modelSelect.reasoningHeader": "Reasoning",
				"modelSelect.searchPlaceholder": "Search models",
				"modelSelect.visionBadge": "Vision",
			};
			return labels[key] ?? values?.defaultValue?.toString() ?? key;
		},
	}),
}));

class ResizeObserverStub {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", ResizeObserverStub);
	HTMLElement.prototype.scrollIntoView = vi.fn();
	catalog.revalidate.mockClear();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("TeamMemberModelSelector", () => {
	it("pins a model and can return the member to the conversation default", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		const { rerender } = render(
			<TeamMemberModelSelector
				value={null}
				placeholder="Follow conversation default"
				emptyLabel="Follow conversation default"
				ariaLabel="Member model"
				onChange={onChange}
				onReasoningChange={vi.fn()}
			/>,
		);

		const trigger = screen.getByRole("button", { name: "Member model" });
		expect(trigger.textContent).toContain("Follow conversation default");
		await user.click(trigger);

		const visionModel = await screen.findByRole("menuitem", { name: /Image Model/ });
		expect(within(visionModel).getByLabelText("Vision")).toBeTruthy();
		expect(visionModel.textContent).not.toContain("Vision");
		await user.click(visionModel);
		expect(onChange).toHaveBeenCalledWith("provider/vision");
		expect(catalog.revalidate).toHaveBeenCalled();

		rerender(
			<TeamMemberModelSelector
				value="provider/vision"
				reasoning="low"
				placeholder="Follow conversation default"
				emptyLabel="Follow conversation default"
				ariaLabel="Member model"
				onChange={onChange}
				onReasoningChange={vi.fn()}
			/>,
		);

		expect(screen.getByRole("button", { name: "Member model" }).textContent).toContain("Image Model");
		await user.click(screen.getByRole("button", { name: "Member model" }));
		await user.click(await screen.findByRole("menuitem", { name: "Follow conversation default" }));
		expect(onChange).toHaveBeenLastCalledWith(null);
	});

	it("does not open while member model preferences are loading or saving", async () => {
		const user = userEvent.setup();
		render(
			<TeamMemberModelSelector
				value={null}
				disabled
				placeholder="Loading"
				emptyLabel="Follow conversation default"
				ariaLabel="Member model"
				onChange={vi.fn()}
				onReasoningChange={vi.fn()}
			/>,
		);

		const trigger = screen.getByRole("button", { name: "Member model" });
		expect(trigger).toHaveProperty("disabled", true);
		await user.click(trigger);
		await waitFor(() => expect(screen.queryByRole("searchbox", { name: "Search models" })).toBeNull());
	});
});
