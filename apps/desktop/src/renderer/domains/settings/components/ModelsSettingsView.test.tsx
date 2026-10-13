// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModelsSettingsView } from "./ModelsSettingsView";
import type { ModelTransportSettingsModel } from "./useModelTransportSettingsModel";
import type { ModelsSettingsModel } from "./useModelsSettingsModel";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../ai-assist", () => ({ SettingsAiAssist: () => null }));
vi.mock("@vetta-org/theme-ui/settings", () => ({
	SettingsPageShellView: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("./PresetProvidersSection", () => ({
	PresetProvidersSection: () => <section data-testid="model-settings-section">preset-providers</section>,
}));
vi.mock("./ModelsProvidersSection", () => ({
	ModelsProvidersSection: () => <section data-testid="model-settings-section">providers</section>,
}));
vi.mock("./ModelTransportSettingsSection", () => ({
	ModelTransportSettingsSection: () => <section data-testid="model-settings-section">transport</section>,
}));

describe("ModelsSettingsView", () => {
	it("places the OpenAI Responses transport section after provider settings", () => {
		const model = {
			config: { providers: {} },
			saveConfig: vi.fn(),
		} as unknown as ModelsSettingsModel;
		const transport = {} as ModelTransportSettingsModel;

		render(<ModelsSettingsView model={model} transport={transport} />);

		expect(screen.getAllByTestId("model-settings-section").map((section) => section.textContent)).toEqual([
			"preset-providers",
			"providers",
			"transport",
		]);
	});
});
