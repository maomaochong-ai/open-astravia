import { defineRuntimeObservation } from "@vetta/runtime-core";

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
