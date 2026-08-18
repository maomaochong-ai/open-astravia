import type { AgentExperimentalSettings, AgentExperimentalSettingsUpdate } from "@vetta/capability-sdk";
import {
	type DesktopConfig,
	normalizeExperimental,
	readDesktopConfig,
	writeDesktopConfig,
} from "../config/desktop-config-store.js";

export interface AgentSettingsServiceOptions {
	readonly readConfig: () => Promise<DesktopConfig>;
	readonly writeConfig: (config: DesktopConfig) => Promise<void>;
}

function normalizeAgentExperimentalSettings(value: unknown): AgentExperimentalSettings {
	const settings = normalizeExperimental(value);
	return {
		vettaCli: settings.vettaCli ?? true,
		promptPrediction: settings.promptPrediction ?? false,
		agentSkills: settings.agentSkills ?? true,
	};
}

export class AgentSettingsService {
	constructor(private readonly options: AgentSettingsServiceOptions) {}

	async getExperimental(): Promise<AgentExperimentalSettings> {
		const config = await this.options.readConfig();
		return normalizeAgentExperimentalSettings(config.experimental);
	}

	async setExperimental(input: AgentExperimentalSettingsUpdate): Promise<AgentExperimentalSettings> {
		const current = await this.options.readConfig();
		const experimental = normalizeAgentExperimentalSettings({ ...current.experimental, ...input });
		await this.options.writeConfig({ ...current, experimental });
		return experimental;
	}
}

let desktopAgentSettingsService: AgentSettingsService | undefined;

export function getDesktopAgentSettingsService(): AgentSettingsService {
	desktopAgentSettingsService ??= new AgentSettingsService({
		readConfig: readDesktopConfig,
		writeConfig: writeDesktopConfig,
	});
	return desktopAgentSettingsService;
}
