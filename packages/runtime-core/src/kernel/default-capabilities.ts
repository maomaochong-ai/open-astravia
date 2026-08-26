import type { RuntimeCapabilityDefinition, ToolPolicy, ToolPolicyRequest } from "./contracts.js";
import { PassthroughContextStrategy } from "./defaults.js";

export const DEFAULT_RUNTIME_TOKEN_BUDGET = 32_000;
export const DEFAULT_RUNTIME_RESERVED_OUTPUT_TOKENS = 4_000;

/** Safe default for Agents that have not explicitly granted Tool execution. */
export class DenyAllToolPolicy implements ToolPolicy {
	async authorize(_request: ToolPolicyRequest, signal: AbortSignal): Promise<boolean> {
		signal.throwIfAborted();
		return false;
	}
}

export type DefaultRuntimeCapabilityOverrides = Partial<RuntimeCapabilityDefinition>;

/**
 * Creates an ordinary Runtime capability definition with product-neutral defaults.
 * Nothing is injected implicitly: callers may replace any regular capability field,
 * and the resulting object follows the same compilation/snapshot path as every Agent.
 */
export function createDefaultRuntimeCapabilityDefinition(
	overrides: DefaultRuntimeCapabilityOverrides = {},
): RuntimeCapabilityDefinition {
	const tokenBudget = overrides.tokenBudget ?? DEFAULT_RUNTIME_TOKEN_BUDGET;
	const reservedOutputTokens = overrides.reservedOutputTokens ?? DEFAULT_RUNTIME_RESERVED_OUTPUT_TOKENS;
	assertTokenBudgets(tokenBudget, reservedOutputTokens);
	return Object.freeze({
		...overrides,
		instructions: Object.freeze([...(overrides.instructions ?? [])]),
		features: Object.freeze([...(overrides.features ?? [])]),
		observers: overrides.observers ? Object.freeze([...overrides.observers]) : undefined,
		contextStrategy: overrides.contextStrategy ?? new PassthroughContextStrategy(),
		toolPolicy: overrides.toolPolicy ?? new DenyAllToolPolicy(),
		tokenBudget,
		reservedOutputTokens,
	});
}

function assertTokenBudgets(tokenBudget: number, reservedOutputTokens: number): void {
	if (!Number.isFinite(tokenBudget) || tokenBudget <= 0) {
		throw new RangeError("Runtime tokenBudget must be a positive finite number");
	}
	if (!Number.isFinite(reservedOutputTokens) || reservedOutputTokens < 0) {
		throw new RangeError("Runtime reservedOutputTokens must be a non-negative finite number");
	}
	if (reservedOutputTokens >= tokenBudget) {
		throw new RangeError("Runtime reservedOutputTokens must be smaller than tokenBudget");
	}
}
