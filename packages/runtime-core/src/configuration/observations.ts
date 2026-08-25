import { defineRuntimeObservation, type RuntimeObservationFailure } from "../observation/index.js";

export type RuntimeConfigurationLifecycleOperation =
	| "definition.publish"
	| "definition.acquire"
	| "definition.release"
	| "definition.retire"
	| "definition.remove"
	| "definition.dispose"
	| "source.sync"
	| "layer.publish"
	| "layer.remove"
	| "snapshot.resolve";

export interface RuntimeConfigurationLifecycleObservation {
	readonly operation: RuntimeConfigurationLifecycleOperation;
	readonly phase: "started" | "completed" | "failed" | "superseded" | "unchanged";
	readonly configurationId?: string;
	readonly definitionRevisionId?: string;
	readonly sourceId?: string;
	readonly sourceRevision?: string;
	readonly definitionCount?: number;
	readonly removedCount?: number;
	readonly layerCount?: number;
	readonly diagnosticCount?: number;
	readonly failure?: RuntimeObservationFailure;
}

export type RuntimeConfigurationIssueCode =
	| "definition-invalid"
	| "definition-source-conflict"
	| "definition-dispose-failed"
	| "layer-invalid"
	| "layer-source-conflict"
	| "layer-value-invalid"
	| "layer-definition-unknown";

export interface RuntimeConfigurationIssueObservation {
	readonly operation: "definition.publish" | "definition.dispose" | "layer.publish" | "snapshot.resolve";
	readonly code: RuntimeConfigurationIssueCode;
	readonly configurationId?: string;
	readonly definitionRevisionId?: string;
	readonly sourceId?: string;
	readonly sourceRevision?: string;
	readonly layerId?: string;
	readonly failure?: RuntimeObservationFailure;
}

export const RUNTIME_CONFIGURATION_LIFECYCLE_OBSERVATION =
	defineRuntimeObservation<RuntimeConfigurationLifecycleObservation>("runtime.configuration", "lifecycle");

export const RUNTIME_CONFIGURATION_ISSUE_OBSERVATION = defineRuntimeObservation<RuntimeConfigurationIssueObservation>(
	"runtime.configuration",
	"issue",
	"warning",
);
