import type { ThinkingBudgetsSettings, TransportSetting } from "./settings-document.js";

export interface ModelSettingsPort {
	getDefaultProvider(): string | undefined;
	getDefaultModel(): string | undefined;
	setDefaultProvider(provider: string): void;
	setDefaultModel(modelId: string): void;
	setDefaultModelAndProvider(provider: string, modelId: string): void;
	getDefaultThinkingLevel(): string | undefined;
	setDefaultThinkingLevel(level: string): void;
	getTransport(): TransportSetting;
	setTransport(transport: TransportSetting): void;
	getThinkingBudgets(): ThinkingBudgetsSettings | undefined;
	getEnabledModels(): string[] | undefined;
	setEnabledModels(patterns: string[] | undefined): void;
}
