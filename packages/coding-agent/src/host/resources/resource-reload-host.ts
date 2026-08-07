import { resetApiProviders } from "@vetta/ai";
import type { SessionResourceRuntime } from "../../resources/index.js";
import type { SettingsRuntime } from "../../settings/index.js";

export interface CodingAgentResourceReloadHostOptions {
	readonly settingsManager: Pick<SettingsRuntime, "reload">;
	readonly resourceLoader: Pick<SessionResourceRuntime, "reload">;
	readonly runWithExtensionLifecycle: (operation: () => Promise<void>) => Promise<void>;
	readonly afterReload?: () => Promise<void> | void;
	readonly resetProviders?: () => void;
}

/** 按既有顺序重载设置、Provider 注册表和本地资源。 */
export class CodingAgentResourceReloadHost {
	private readonly resetProviders: () => void;

	constructor(private readonly options: CodingAgentResourceReloadHostOptions) {
		this.resetProviders = options.resetProviders ?? resetApiProviders;
	}

	reload(): Promise<void> {
		return this.options.runWithExtensionLifecycle(async () => {
			this.options.settingsManager.reload();
			this.resetProviders();
			await this.options.resourceLoader.reload();
			await this.options.afterReload?.();
		});
	}
}
