import type { Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { AI_ERROR_CODES, AIError, type Provider } from "../protocol/index.js";

export interface WireValidationContext {
	readonly provider?: Provider;
	readonly payloadType: string;
}

export function validateWirePayload<TSchemaValue extends TSchema>(
	schema: TSchemaValue,
	value: unknown,
	context: WireValidationContext,
): Static<TSchemaValue> {
	if (Value.Check(schema, value)) return value as Static<TSchemaValue>;
	const errors = [...Value.Errors(schema, value)].slice(0, 5).map((error) => ({
		path: error.path || "/",
		message: error.message,
		// Without the offending value a relay-shaped deviation is undiagnosable from logs alone.
		// Only the value at the failing path is captured, never the surrounding payload.
		received: describeReceived(error.value),
	}));
	throw new AIError(AI_ERROR_CODES.RESPONSE_VALIDATION_FAILED, `${context.payloadType} response validation failed`, {
		provider: context.provider,
		metadata: { payloadType: context.payloadType, errors },
	});
}

const RECEIVED_PREVIEW_LIMIT = 120;

function describeReceived(value: unknown): string {
	if (value === undefined) return "undefined";
	let serialized: string;
	try {
		serialized = JSON.stringify(value) ?? String(value);
	} catch {
		return "[unserializable]";
	}
	return serialized.length > RECEIVED_PREVIEW_LIMIT ? `${serialized.slice(0, RECEIVED_PREVIEW_LIMIT)}…` : serialized;
}
