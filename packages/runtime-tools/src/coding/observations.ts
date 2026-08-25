import { defineRuntimeObservation, type RuntimeObservationFailure } from "@vetta/runtime-core";

export type CodingToolCatalogOperation = "register" | "activate" | "deactivate" | "revoke" | "unregister";

export interface CodingToolCatalogObservation {
	readonly operation: CodingToolCatalogOperation;
	readonly toolName: string;
	readonly catalogVersion: number;
}

export const CODING_TOOL_CATALOG_OBSERVATION = defineRuntimeObservation<CodingToolCatalogObservation>(
	"runtime.tool",
	"catalog",
);

export interface CodingToolConfigurationObservation {
	readonly operation: "bind";
	readonly phase: "completed";
	readonly toolName: string;
	readonly support: "native" | "adapter" | "host-policy";
	readonly configurationCount: number;
}

export const CODING_TOOL_CONFIGURATION_OBSERVATION = defineRuntimeObservation<CodingToolConfigurationObservation>(
	"runtime.tool",
	"configuration",
);

export interface CodingToolConfigurationIssueObservation {
	readonly operation: "bind";
	readonly phase: "fallback" | "failed";
	readonly toolName: string;
	readonly support: "native" | "adapter" | "host-policy";
	readonly configurationCount: number;
	readonly missingConfigurationIds?: readonly string[];
	readonly failure?: RuntimeObservationFailure;
}

export const CODING_TOOL_CONFIGURATION_ISSUE_OBSERVATION =
	defineRuntimeObservation<CodingToolConfigurationIssueObservation>("runtime.tool", "configuration.issue", "warning");
