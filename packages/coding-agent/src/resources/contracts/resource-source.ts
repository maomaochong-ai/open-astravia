export type ResourceScope = "user" | "project" | "temporary";

export type ResourceKind = "extensions" | "skills" | "prompts" | "themes";

export type ResourcePackageSource =
	| string
	| {
			source: string;
			extensions?: string[];
			skills?: string[];
			prompts?: string[];
			themes?: string[];
	  };

export interface ResourceSettingsSnapshot {
	packages?: ResourcePackageSource[];
	extensions?: string[];
	skills?: string[];
	prompts?: string[];
	themes?: string[];
}

export interface ResourceSettingsPort {
	getGlobalSettings(): ResourceSettingsSnapshot;
	getProjectSettings(): ResourceSettingsSnapshot;
	setPackages(packages: ResourcePackageSource[]): void;
	setProjectPackages(packages: ResourcePackageSource[]): void;
}

export interface ResourcePathMetadata {
	source: string;
	scope: ResourceScope;
	origin: "package" | "top-level";
	baseDir?: string;
}

export interface ResolvedResourcePath {
	path: string;
	enabled: boolean;
	metadata: ResourcePathMetadata;
}

export type ResolvedResourcePaths = Record<ResourceKind, ResolvedResourcePath[]>;

export type MissingResourceSourceAction = "install" | "skip" | "error";

export interface ResourcePackageProgressEvent {
	type: "start" | "progress" | "complete" | "error";
	action: "install" | "remove" | "update" | "clone" | "pull";
	source: string;
	message?: string;
}

export type ResourcePackageProgressListener = (event: ResourcePackageProgressEvent) => void;

export interface ResourcePackageCommandPort {
	run(command: string, args: string[], options?: { cwd?: string }): Promise<void>;
	runSync(command: string, args: string[]): string;
}

export interface ResourcePackageRegistryPort {
	getLatestVersion(packageName: string): Promise<string>;
}

export interface ResourcePackageRuntime {
	resolve(onMissing?: (source: string) => Promise<MissingResourceSourceAction>): Promise<ResolvedResourcePaths>;
	resolveAdditionalSources(
		sources: string[],
		options?: { local?: boolean; temporary?: boolean },
	): Promise<ResolvedResourcePaths>;
	install(source: string, options?: { local?: boolean }): Promise<void>;
	remove(source: string, options?: { local?: boolean }): Promise<void>;
	update(source?: string): Promise<void>;
	addSource(source: string, options?: { local?: boolean }): boolean;
	removeSource(source: string, options?: { local?: boolean }): boolean;
	setProgressListener(listener: ResourcePackageProgressListener | undefined): void;
	getInstalledPath(source: string, scope: "user" | "project"): string | undefined;
}
