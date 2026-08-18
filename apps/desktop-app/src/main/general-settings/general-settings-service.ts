import type {
	DefaultExecutionModeSettingInput,
	GeneralExecutionMode,
	GeneralSettingsSnapshot,
	NotificationsSettingInput,
	SandboxCapabilitySnapshot,
	WorkspaceSettingInput,
} from "@vetta/capability-sdk";
import { type DesktopConfig, readDesktopConfig, writeDesktopConfig } from "../config/desktop-config-store.js";
import { allowProjectRoot } from "../filesystem/filesystem-service.js";
import { getSandboxCapability } from "../sandbox/capability.js";

export interface GeneralSettingsServiceOptions {
	readonly readConfig: () => Promise<DesktopConfig>;
	readonly writeConfig: (config: DesktopConfig) => Promise<void>;
	readonly allowWorkspaceRoot: (path: string) => void;
	readonly getSandbox: () => SandboxCapabilitySnapshot;
}

function isAbsolutePath(path: string): boolean {
	return path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

export class GeneralSettingsService {
	constructor(private readonly options: GeneralSettingsServiceOptions) {}

	async getSettings(): Promise<GeneralSettingsSnapshot> {
		const config = await this.options.readConfig();
		return {
			workspacePath: config.workspacePath,
			defaultExecutionMode: config.defaultExecutionMode,
			notificationsEnabled: config.notificationsEnabled !== false,
			debugMode: Boolean(config.debugMode),
			sandbox: this.options.getSandbox(),
		};
	}

	async setNotifications(enabled: boolean): Promise<NotificationsSettingInput> {
		await this.updateConfig({ notificationsEnabled: enabled });
		return { enabled };
	}

	async setDefaultExecutionMode(mode: GeneralExecutionMode): Promise<DefaultExecutionModeSettingInput> {
		await this.updateConfig({ defaultExecutionMode: mode });
		return { mode };
	}

	async setWorkspace(path: string): Promise<WorkspaceSettingInput> {
		const normalizedPath = path.trim();
		if (!isAbsolutePath(normalizedPath)) throw new Error("workspace path must be absolute");
		this.options.allowWorkspaceRoot(normalizedPath);
		await this.updateConfig({ workspacePath: normalizedPath });
		return { path: normalizedPath };
	}

	private async updateConfig(patch: Partial<DesktopConfig>): Promise<void> {
		const current = await this.options.readConfig();
		await this.options.writeConfig({ ...current, ...patch });
	}
}

let desktopGeneralSettingsService: GeneralSettingsService | undefined;

export function getDesktopGeneralSettingsService(): GeneralSettingsService {
	desktopGeneralSettingsService ??= new GeneralSettingsService({
		readConfig: readDesktopConfig,
		writeConfig: writeDesktopConfig,
		allowWorkspaceRoot: allowProjectRoot,
		getSandbox: getSandboxCapability,
	});
	return desktopGeneralSettingsService;
}
