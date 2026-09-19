import { extname } from "node:path";
import type { InstalledPlugin, PluginManifest } from "../../preload/api-types/plugins.js";
import { VETTA_PLUGIN_PACKAGE_EXTENSION } from "./plugin-package.js";

export function isVettaPluginPackagePath(filePath: string): boolean {
	return extname(filePath).toLowerCase() === VETTA_PLUGIN_PACKAGE_EXTENSION;
}

export function findVettaPluginPackagePath(argv: readonly string[]): string | undefined {
	return argv.find(isVettaPluginPackagePath);
}

export interface PluginPackageOpenDependencies {
	inspect(filePath: string): Promise<PluginManifest>;
	confirm(filePath: string, manifest: PluginManifest): Promise<boolean>;
	install(filePath: string, manifest: PluginManifest): Promise<InstalledPlugin>;
	notifyInstalled(plugin: InstalledPlugin): Promise<void>;
	notifyError(filePath: string, error: unknown): Promise<void>;
	revealApp(): void;
}

/** Serializes OS file-open events and holds startup events until Desktop is ready. */
export class PluginPackageOpenService {
	private ready = false;
	private readonly pending: string[] = [];
	private processing: Promise<void> = Promise.resolve();

	constructor(private readonly dependencies: PluginPackageOpenDependencies) {}

	enqueue(filePath: string): boolean {
		if (!isVettaPluginPackagePath(filePath)) return false;
		this.pending.push(filePath);
		this.flush();
		return true;
	}

	enqueueFromArgv(argv: readonly string[]): boolean {
		const filePath = findVettaPluginPackagePath(argv);
		return filePath ? this.enqueue(filePath) : false;
	}

	markReady(): void {
		this.ready = true;
		this.flush();
	}

	async waitForIdle(): Promise<void> {
		await this.processing;
	}

	private flush(): void {
		if (!this.ready || this.pending.length === 0) return;
		const paths = this.pending.splice(0);
		for (const filePath of paths) {
			this.processing = this.processing.then(() => this.open(filePath));
		}
	}

	private async open(filePath: string): Promise<void> {
		this.dependencies.revealApp();
		try {
			const manifest = await this.dependencies.inspect(filePath);
			if (!(await this.dependencies.confirm(filePath, manifest))) return;
			const installed = await this.dependencies.install(filePath, manifest);
			await this.dependencies.notifyInstalled(installed);
		} catch (error) {
			await this.dependencies.notifyError(filePath, error);
		}
	}
}
