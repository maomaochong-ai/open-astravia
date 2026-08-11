import type { ModelSettingsPort } from "../contracts/model-settings.js";
import type { SettingsStatePort } from "../runtime/settings-state.js";

export function createModelSettingsView(state: SettingsStatePort): ModelSettingsPort {
	return {
		getDefaultProvider: () => state.read().defaultProvider,
		getDefaultModel: () => state.read().defaultModel,
		setDefaultProvider: (defaultProvider) => state.patchGlobal({ defaultProvider }),
		setDefaultModel: (defaultModel) => state.patchGlobal({ defaultModel }),
		setDefaultModelAndProvider: (defaultProvider, defaultModel) =>
			state.patchGlobal({ defaultProvider, defaultModel }),
		getDefaultThinkingLevel: () => state.read().defaultThinkingLevel,
		setDefaultThinkingLevel: (defaultThinkingLevel) => state.patchGlobal({ defaultThinkingLevel }),
		getTransport: () => state.read().transport ?? "sse",
		setTransport: (transport) => state.patchGlobal({ transport }),
		getThinkingBudgets: () => state.read().thinkingBudgets,
		getEnabledModels: () => state.read().enabledModels,
		setEnabledModels: (enabledModels) => state.patchGlobal({ enabledModels }),
	};
}
