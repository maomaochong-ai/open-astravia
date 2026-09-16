import type {
	AgentExperimentalSettings,
	AgentExperimentalSettingsUpdate,
	ImageGenerationSettings,
	ImageGenerationSettingsUpdate,
} from "@vetta-org/capability-sdk";
import {
	type DesktopConfig,
	normalizeExperimental,
	normalizeImageGeneration,
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

	async getImageGeneration(): Promise<ImageGenerationSettings> {
		const config = await this.options.readConfig();
		return normalizeImageGeneration(config.imageGeneration);
	}

	async setImageGeneration(input: ImageGenerationSettingsUpdate): Promise<ImageGenerationSettings> {
		const current = await this.options.readConfig();
		const currentSettings = normalizeImageGeneration(current.imageGeneration);
		const imageGeneration = normalizeImageGeneration({
			...currentSettings,
			...(input.textToImageProviderId === null
				? { textToImageProviderId: undefined }
				: input.textToImageProviderId !== undefined
					? { textToImageProviderId: input.textToImageProviderId }
					: {}),
			...(input.imageToImageProviderId === null
				? { imageToImageProviderId: undefined }
				: input.imageToImageProviderId !== undefined
					? { imageToImageProviderId: input.imageToImageProviderId }
					: {}),
		});
		await this.options.writeConfig({ ...current, imageGeneration });
		return imageGeneration;
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
