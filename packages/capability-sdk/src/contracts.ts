import type { CapabilitySchema } from "./schema.js";

declare const capabilityIdBrand: unique symbol;
declare const capabilityTypes: unique symbol;

export const CAPABILITY_LAYERS = {
	FOUNDATION: "foundation",
	DOMAIN: "domain",
} as const;

export type CapabilityLayer = (typeof CAPABILITY_LAYERS)[keyof typeof CAPABILITY_LAYERS];
export type CapabilityId = string & { readonly [capabilityIdBrand]: true };

export const CAPABILITY_PREFIXES = {
	ROOT: "cap.",
	FOUNDATION: "cap.foundation.",
	DOMAIN: "cap.domain.",
	VETTA_FOUNDATION: "cap.foundation.vetta.",
	VETTA_DOMAIN: "cap.domain.vetta.",
} as const;

export const CAPABILITY_PUBLISHERS = {
	VETTA: "vetta",
} as const;

export const CAPABILITY_ERROR_CODES = {
	ABORTED: "CAPABILITY_ABORTED",
	ACCESS_DENIED: "CAPABILITY_ACCESS_DENIED",
	DUPLICATE_PROVIDER: "CAPABILITY_DUPLICATE_PROVIDER",
	INVALID_CONSTRAINT: "CAPABILITY_INVALID_CONSTRAINT",
	INVALID_ID: "CAPABILITY_INVALID_ID",
	INVALID_INPUT: "CAPABILITY_INVALID_INPUT",
	INVALID_MODULE: "CAPABILITY_INVALID_MODULE",
	INVALID_OUTPUT: "CAPABILITY_INVALID_OUTPUT",
	LAYER_MISMATCH: "CAPABILITY_LAYER_MISMATCH",
	NOT_FOUND: "CAPABILITY_NOT_FOUND",
	PUBLISHER_MISMATCH: "CAPABILITY_PUBLISHER_MISMATCH",
	PROVIDER_FAILED: "CAPABILITY_PROVIDER_FAILED",
	RESERVED_PUBLISHER: "CAPABILITY_RESERVED_PUBLISHER",
	SESSION_EXPIRED: "CAPABILITY_SESSION_EXPIRED",
	SESSION_REVOKED: "CAPABILITY_SESSION_REVOKED",
	VERSION_MISMATCH: "CAPABILITY_VERSION_MISMATCH",
} as const;

export type CapabilityErrorCode = (typeof CAPABILITY_ERROR_CODES)[keyof typeof CAPABILITY_ERROR_CODES];
export type CapabilityParser<Value> = CapabilitySchema<Value>["parse"];

export interface CapabilityToken<Input, Output> {
	readonly id: CapabilityId;
	readonly input: CapabilitySchema<Input>;
	readonly kind: "query" | "command" | "event";
	readonly layer: CapabilityLayer;
	readonly output: CapabilitySchema<Output>;
	readonly version: number;
	readonly parseInput: CapabilityParser<Input>;
	readonly parseOutput: CapabilityParser<Output>;
	readonly [capabilityTypes]?: {
		readonly input: Input;
		readonly output: Output;
	};
}

export type AnyCapabilityToken = CapabilityToken<unknown, unknown>;

export interface CapabilityModule {
	readonly id: string;
	readonly publisher: string;
	readonly version: string;
	readonly capabilities: readonly AnyCapabilityToken[];
}

export interface CapabilityModuleDefinition {
	readonly id: string;
	readonly publisher: string;
	readonly version: string;
	readonly capabilities: readonly AnyCapabilityToken[];
}

export interface CapabilityDefinition<Input, Output> {
	readonly input: CapabilitySchema<Input>;
	readonly id: string;
	readonly kind: CapabilityToken<Input, Output>["kind"];
	readonly layer: CapabilityLayer;
	readonly output: CapabilitySchema<Output>;
	readonly version: number;
}

export interface CapabilityExecutionContext {
	readonly signal: AbortSignal;
	readonly traceId: string;
	readonly deadline?: number;
}

export interface CapabilityHandler<Input, Output> {
	execute(input: Input, context: CapabilityExecutionContext): Promise<Output> | Output;
}

export interface Disposable {
	dispose(): void;
}

export class CapabilityError extends Error {
	readonly code: CapabilityErrorCode;
	readonly details?: Readonly<Record<string, unknown>>;

	constructor(
		code: CapabilityErrorCode,
		message: string,
		options?: ErrorOptions,
		details?: Readonly<Record<string, unknown>>,
	) {
		super(message, options);
		this.name = "CapabilityError";
		this.code = code;
		this.details = details;
	}
}

const CAPABILITY_ID_PATTERN = /^cap\.(foundation|domain)\.[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,}$/;

export function isCapabilityError(error: unknown): error is CapabilityError {
	return error instanceof CapabilityError;
}

export function isCapabilityId(value: string): value is CapabilityId {
	return CAPABILITY_ID_PATTERN.test(value);
}

export function parseCapabilityId(value: string): CapabilityId {
	if (!isCapabilityId(value)) {
		throw new CapabilityError(CAPABILITY_ERROR_CODES.INVALID_ID, `Invalid capability id: ${value}`);
	}
	return value;
}

export function capabilityLayerFromId(id: CapabilityId): CapabilityLayer {
	return id.startsWith(CAPABILITY_PREFIXES.FOUNDATION) ? CAPABILITY_LAYERS.FOUNDATION : CAPABILITY_LAYERS.DOMAIN;
}

export function capabilityPublisherFromId(id: CapabilityId): string {
	const publisher = id.split(".")[2];
	if (publisher === undefined) {
		throw new CapabilityError(CAPABILITY_ERROR_CODES.INVALID_ID, `Capability id has no publisher: ${id}`);
	}
	return publisher;
}

export function defineCapabilityModule(definition: CapabilityModuleDefinition): CapabilityModule {
	const id = definition.id.trim();
	const publisher = definition.publisher.trim();
	const version = definition.version.trim();
	if (id.length === 0 || publisher.length === 0 || version.length === 0 || definition.capabilities.length === 0) {
		throw new CapabilityError(
			CAPABILITY_ERROR_CODES.INVALID_MODULE,
			"Capability module id, publisher, version, and capabilities are required",
		);
	}
	if (!/^[a-z0-9][a-z0-9-]*$/.test(publisher)) {
		throw new CapabilityError(
			CAPABILITY_ERROR_CODES.INVALID_MODULE,
			`Capability module publisher is invalid: ${publisher}`,
		);
	}
	const capabilityIds = new Set<CapabilityId>();
	for (const capability of definition.capabilities) {
		if (capabilityPublisherFromId(capability.id) !== publisher) {
			throw new CapabilityError(
				CAPABILITY_ERROR_CODES.PUBLISHER_MISMATCH,
				`Capability ${capability.id} does not belong to publisher ${publisher}`,
			);
		}
		if (capabilityIds.has(capability.id)) {
			throw new CapabilityError(
				CAPABILITY_ERROR_CODES.INVALID_MODULE,
				`Capability module ${id} declares ${capability.id} more than once`,
			);
		}
		capabilityIds.add(capability.id);
	}
	return Object.freeze({
		id,
		publisher,
		version,
		capabilities: Object.freeze([...definition.capabilities]),
	});
}

export function defineCapability<Input, Output>(
	definition: CapabilityDefinition<Input, Output>,
): CapabilityToken<Input, Output> {
	const id = parseCapabilityId(definition.id);
	const idLayer = capabilityLayerFromId(id);
	if (definition.layer !== idLayer) {
		throw new CapabilityError(
			CAPABILITY_ERROR_CODES.LAYER_MISMATCH,
			`Capability ${id} declares layer ${definition.layer}, but its id belongs to ${idLayer}`,
		);
	}
	if (!Number.isInteger(definition.version) || definition.version < 1) {
		throw new CapabilityError(
			CAPABILITY_ERROR_CODES.VERSION_MISMATCH,
			`Capability ${id} must declare a positive integer version`,
		);
	}
	return Object.freeze({
		id,
		input: definition.input,
		kind: definition.kind,
		layer: definition.layer,
		output: definition.output,
		version: definition.version,
		parseInput: definition.input.parse,
		parseOutput: definition.output.parse,
	});
}
