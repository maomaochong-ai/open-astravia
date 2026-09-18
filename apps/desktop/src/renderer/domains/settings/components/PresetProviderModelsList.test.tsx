// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PresetProviderModelsList } from "./PresetProviderModelsList";
import type { PresetProviderRow, PresetProvidersSectionLabels } from "./usePresetProvidersSectionModel";

const labels: PresetProvidersSectionLabels = {
	title: "Preset providers",
	loading: "Loading",
	noPresetProviders: "No providers",
	enabled: "Enabled",
	deprecated: "Deprecated",
	collapseModels: "Collapse models",
	viewModels: "View models",
	modelsCount: (count) => `${count} models`,
	collapse: "Collapse",
	cancel: "Cancel",
	changeKey: "Change key",
	remove: "Remove",
	enable: "Enable",
	apiKeyDirect: (provider) => `${provider} API key`,
	apiKeyPlaceholder: "API key",
	encryptedApiKeyPlaceholder: "Saved API key",
	save: "Save",
	noModels: "No models",
	noMatchingModels: "No matching models",
	searchModels: (provider) => `Search ${provider} models`,
	clearModelSearch: "Clear model search",
	modelListLabel: (provider) => `${provider} model list`,
	thinking: "Thinking",
	perMillionTokens: "/M tokens",
	refreshModels: "Refresh models",
	refreshingModels: "Refreshing models",
	refreshCatalog: "Refresh catalog",
	copyApiKey: "Copy API key",
};

const row: PresetProviderRow = {
	id: "qwen",
	displayName: "Qwen",
	api: "openai-compatible",
	models: [],
	modelRows: [
		{
			id: "qwen3-max",
			name: "Qwen3 Max",
			hasVision: false,
			hasReasoning: true,
			price: null,
		},
		{
			id: "qwen3-coder-plus",
			name: "Coding Expert",
			hasVision: false,
			hasReasoning: true,
			price: null,
		},
		{
			id: "qwen3-flash",
			name: "Qwen3 Flash",
			hasVision: false,
			hasReasoning: false,
			price: null,
		},
	],
	offline: false,
	adopted: false,
	isOpen: false,
	isExpanded: true,
	refreshing: false,
	hasApiKey: false,
	modelsError: null,
};

describe("PresetProviderModelsList", () => {
	it("按模型名称或 ID 即时过滤，并能清除搜索恢复完整列表", async () => {
		const user = userEvent.setup();
		render(<PresetProviderModelsList row={row} labels={labels} />);

		const search = screen.getByRole("searchbox", { name: "Search Qwen models" });
		expect(screen.getByText("Qwen3 Max")).toBeTruthy();
		expect(screen.getByText("Coding Expert")).toBeTruthy();

		await user.type(search, "coder");
		expect(screen.getByText("Coding Expert")).toBeTruthy();
		expect(screen.getByText("qwen3-coder-plus")).toBeTruthy();
		expect(screen.queryByText("Qwen3 Max")).toBeNull();

		await user.clear(search);
		await user.type(search, "flash");
		expect(screen.getByText("Qwen3 Flash")).toBeTruthy();
		expect(screen.queryByText("Coding Expert")).toBeNull();

		await user.click(screen.getByRole("button", { name: "Clear model search" }));
		expect(screen.getByText("Qwen3 Max")).toBeTruthy();
		expect(screen.getByText("Coding Expert")).toBeTruthy();
	});

	it("搜索无匹配项时显示明确空态，并让结果区保持限高滚动", async () => {
		const user = userEvent.setup();
		render(<PresetProviderModelsList row={row} labels={labels} />);

		await user.type(screen.getByRole("searchbox", { name: "Search Qwen models" }), "missing");

		expect(screen.getByText("No matching models")).toBeTruthy();
		const region = screen.getByRole("region", { name: "Qwen model list" });
		expect(region.className).toContain("max-h-[min(24rem,50vh)]");
		expect(region.className).toContain("overflow-y-auto");
	});
});
