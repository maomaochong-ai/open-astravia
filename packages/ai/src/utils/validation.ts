import type { ErrorObject } from "ajv";
import AjvModule from "ajv";
import addFormatsModule from "ajv-formats";

// Handle both default and named exports
const Ajv = (AjvModule as any).default || AjvModule;
const addFormats = (addFormatsModule as any).default || addFormatsModule;

import type { Tool, ToolCall } from "../types.js";

// Detect if we're in a browser extension environment with strict CSP
// Chrome extensions with Manifest V3 don't allow eval/Function constructor
const isBrowserExtension = typeof globalThis !== "undefined" && (globalThis as any).chrome?.runtime?.id !== undefined;

// Create a singleton AJV instance with formats (only if not in browser extension)
// AJV requires 'unsafe-eval' CSP which is not allowed in Manifest V3
let ajv: any = null;
if (!isBrowserExtension) {
	try {
		ajv = new Ajv({
			allErrors: true,
			strict: false,
			coerceTypes: true,
			discriminator: true,
		});
		addFormats(ajv);
	} catch (_e) {
		// AJV initialization failed (likely CSP restriction)
		console.warn("AJV validation disabled due to CSP restrictions");
	}
}

/**
 * Finds a tool by name and validates the tool call arguments against its TypeBox schema
 * @param tools Array of tool definitions
 * @param toolCall The tool call from the LLM
 * @returns The validated arguments
 * @throws Error if tool is not found or validation fails
 */
export function validateToolCall(tools: Tool[], toolCall: ToolCall): any {
	const tool = tools.find((t) => t.name === toolCall.name);
	if (!tool) {
		throw new Error(`Tool "${toolCall.name}" not found`);
	}
	return validateToolArguments(tool, toolCall);
}

/**
 * Validates tool call arguments against the tool's TypeBox schema
 * @param tool The tool definition with TypeBox schema
 * @param toolCall The tool call from the LLM
 * @returns The validated (and potentially coerced) arguments
 * @throws Error with formatted message if validation fails
 */
export function validateToolArguments(tool: Tool, toolCall: ToolCall): any {
	// Skip validation in browser extension environment (CSP restrictions prevent AJV from working)
	if (!ajv || isBrowserExtension) {
		// Trust the LLM's output without validation
		// Browser extensions can't use AJV due to Manifest V3 CSP restrictions
		return toolCall.arguments;
	}

	// Compile the schema
	const validate = ajv.compile(withInferredDiscriminators(tool.parameters));

	// Clone arguments so AJV can safely mutate for type coercion
	const args = structuredClone(toolCall.arguments);

	// Validate the arguments (AJV mutates args in-place for type coercion)
	if (validate(args)) {
		return args;
	}

	// Format validation errors nicely
	const errors =
		validate.errors
			?.filter((err: ErrorObject) => err.keyword !== "if")
			.map((err: ErrorObject) => {
				const path = err.instancePath ? err.instancePath.substring(1) : err.params.missingProperty || "root";
				const unexpectedProperty =
					err.keyword === "additionalProperties" ? err.params.additionalProperty : undefined;
				return `  - ${path}: ${err.message}${unexpectedProperty ? ` '${unexpectedProperty}'` : ""}`;
			})
			.join("\n") || "Unknown validation error";

	const errorMessage = `Validation failed for tool "${toolCall.name}":\n${errors}\n\nReceived arguments:\n${JSON.stringify(toolCall.arguments, null, 2)}`;

	throw new Error(errorMessage);
}

function withInferredDiscriminators(schema: unknown): unknown {
	if (Array.isArray(schema)) return schema.map(withInferredDiscriminators);
	if (!schema || typeof schema !== "object") return schema;
	const mapped = Object.fromEntries(
		Object.entries(schema).map(([key, value]) => [key, withInferredDiscriminators(value)]),
	);
	const variants = Array.isArray(mapped.oneOf) ? mapped.oneOf : null;
	if (!variants || variants.length < 2 || mapped.discriminator !== undefined) return mapped;
	const propertyName = inferDiscriminatorProperty(variants);
	return propertyName ? { ...mapped, discriminator: { propertyName } } : mapped;
}

function inferDiscriminatorProperty(variants: readonly unknown[]): string | null {
	const firstProperties = schemaProperties(variants[0]);
	if (!firstProperties) return null;
	for (const propertyName of Object.keys(firstProperties)) {
		const values = variants.map((variant) => discriminatorValue(variant, propertyName));
		if (values.every((value) => value !== null) && new Set(values).size === values.length) {
			return propertyName;
		}
	}
	return null;
}

function discriminatorValue(variant: unknown, propertyName: string): string | null {
	if (!variant || typeof variant !== "object" || Array.isArray(variant)) return null;
	const record = variant as Record<string, unknown>;
	if (!Array.isArray(record.required) || !record.required.includes(propertyName)) return null;
	const property = schemaProperties(variant)?.[propertyName];
	if (!property || typeof property !== "object" || Array.isArray(property)) return null;
	const value = (property as Record<string, unknown>).const;
	return typeof value === "string" ? value : null;
}

function schemaProperties(schema: unknown): Record<string, unknown> | null {
	if (!schema || typeof schema !== "object" || Array.isArray(schema)) return null;
	const properties = (schema as Record<string, unknown>).properties;
	return properties && typeof properties === "object" && !Array.isArray(properties)
		? (properties as Record<string, unknown>)
		: null;
}
