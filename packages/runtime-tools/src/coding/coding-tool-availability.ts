import {
	type CapabilityBinding,
	type RuntimeToolDefinition,
	RuntimeToolExecutionError,
} from "@vetta/runtime-core/kernel";
import type { CodingToolCatalog, CodingToolCatalogEntry } from "./coding-tool-catalog.js";

export const CODING_TOOL_AVAILABILITY_ERROR_CODES = {
	UNAVAILABLE: "coding_tool_unavailable",
	DEFINITION_CHANGED: "coding_tool_definition_changed",
	DEACTIVATED: "coding_tool_deactivated",
	REVOKED: "coding_tool_revoked",
} as const;

export type CodingToolAvailabilityErrorCode =
	(typeof CODING_TOOL_AVAILABILITY_ERROR_CODES)[keyof typeof CODING_TOOL_AVAILABILITY_ERROR_CODES];

export class CodingToolAvailabilityError extends RuntimeToolExecutionError {
	readonly code: CodingToolAvailabilityErrorCode;
	readonly toolName: string;
	readonly binding: CapabilityBinding;

	constructor(code: CodingToolAvailabilityErrorCode, binding: CapabilityBinding) {
		super(errorMessage(code, binding.capabilityId), {
			code,
			retryable: isRetryable(code),
			metadata: {
				toolName: binding.capabilityId,
				binding,
			},
		});
		this.name = "CodingToolAvailabilityError";
		this.code = code;
		this.toolName = binding.capabilityId;
		this.binding = binding;
	}
}

export function guardCodingToolRegistration(
	catalog: CodingToolCatalog,
	entry: CodingToolCatalogEntry,
): RuntimeToolDefinition {
	return {
		...entry.registration.tool,
		modelOrder: entry.registration.modelOrder ?? entry.registration.tool.modelOrder,
		execute: (request) => catalog.execute(entry.binding, request),
	};
}

function isRetryable(code: CodingToolAvailabilityErrorCode): boolean {
	return code !== CODING_TOOL_AVAILABILITY_ERROR_CODES.REVOKED;
}

function errorMessage(code: CodingToolAvailabilityErrorCode, toolName: string): string {
	switch (code) {
		case CODING_TOOL_AVAILABILITY_ERROR_CODES.UNAVAILABLE:
			return `Coding tool is no longer available: ${toolName}`;
		case CODING_TOOL_AVAILABILITY_ERROR_CODES.DEFINITION_CHANGED:
			return `Coding tool definition changed after it was advertised: ${toolName}`;
		case CODING_TOOL_AVAILABILITY_ERROR_CODES.DEACTIVATED:
			return `Coding tool was deactivated after it was advertised: ${toolName}`;
		case CODING_TOOL_AVAILABILITY_ERROR_CODES.REVOKED:
			return `Coding tool was revoked: ${toolName}`;
	}
}
