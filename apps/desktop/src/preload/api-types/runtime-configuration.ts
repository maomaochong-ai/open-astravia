import type {
	RuntimeConfigurationApplyMode,
	RuntimeConfigurationDescriptor,
	RuntimeConfigurationDiagnostic,
	RuntimeConfigurationJsonObject,
} from "@vetta/runtime-core/configuration";

export interface DesktopRuntimeConfigurationConsumer {
	readonly kind: "tool" | "runtime";
	readonly id: string;
	readonly support: "native" | "host-policy";
}

export interface DesktopRuntimeConfigurationEntry {
	readonly configurationId: string;
	readonly definitionRevisionId: string;
	readonly definitionSourceId: string;
	readonly schemaVersion: number;
	readonly apply: RuntimeConfigurationApplyMode;
	readonly descriptor: RuntimeConfigurationDescriptor;
	readonly defaultValue: RuntimeConfigurationJsonObject;
	readonly value: RuntimeConfigurationJsonObject;
	readonly redactedPaths: readonly string[];
	readonly appliedLayerIds: readonly string[];
	readonly diagnostics: readonly RuntimeConfigurationDiagnostic[];
	readonly consumers: readonly DesktopRuntimeConfigurationConsumer[];
}

export interface DesktopRuntimeConfigurationCatalog {
	readonly snapshotId: string;
	readonly definitionVersion: number;
	readonly entries: readonly DesktopRuntimeConfigurationEntry[];
}

export interface DesktopRuntimeConfigurationChangedEvent {
	readonly configurationId?: string;
}

export interface DesktopRuntimeConfigurationApi {
	list(): Promise<DesktopRuntimeConfigurationCatalog>;
	set(configurationId: string, patch: RuntimeConfigurationJsonObject): Promise<DesktopRuntimeConfigurationCatalog>;
	onChanged(handler: (event: DesktopRuntimeConfigurationChangedEvent) => void): () => void;
}
