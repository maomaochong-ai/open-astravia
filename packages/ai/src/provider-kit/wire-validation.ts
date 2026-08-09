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
	}));
	throw new AIError(AI_ERROR_CODES.RESPONSE_VALIDATION_FAILED, `${context.payloadType} response validation failed`, {
		provider: context.provider,
		metadata: { payloadType: context.payloadType, errors },
	});
}
