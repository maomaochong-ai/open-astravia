import { z } from "zod";
import type { DebugDefinition, JsonValue } from "../types.js";
import { DebugError } from "../types.js";
import { type ProviderPreflightDependencies, ProviderPreflightError, runProviderPreflight } from "./preflight.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const preflightInputSchema = z
	.object({
		modelKey: z.string().trim().min(3),
		timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
	})
	.strict();

export function createProviderDebugDefinitions(dependencies: ProviderPreflightDependencies): DebugDefinition[] {
	return [
		{
			id: "provider.preflight",
			category: "provider",
			title: "Preflight a model provider",
			summary: "Verify model resolution and authentication with one small, cache-disabled Provider call.",
			keywords: ["provider", "model", "credential", "authentication", "cache", "preflight"],
			inputSchema: { description: "A provider/model modelKey and optional timeoutMs (1000-120000)." },
			examples: [
				{
					description: "Verify one configured model before a cache experiment",
					input: { modelKey: "provider/model-id", timeoutMs: 30_000 },
				},
			],
			validateInput(input) {
				const result = preflightInputSchema.safeParse(input);
				if (result.success) return result.data;
				throw new DebugError("DEBUG_INVALID_INPUT", "Provider preflight input is invalid.", {
					issues: result.error.issues.map((issue) => ({
						path: issue.path.map(String).join("."),
						message: issue.message,
					})),
				});
			},
			async run(input, context) {
				const request = preflightInputSchema.parse(input);
				try {
					return (await runProviderPreflight(
						dependencies,
						{ modelKey: request.modelKey, timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS },
						context.signal,
					)) as JsonValue;
				} catch (error) {
					if (!(error instanceof ProviderPreflightError)) throw error;
					throw new DebugError(`DEBUG_PROVIDER_${error.code}`, error.message, error.details as JsonValue);
				}
			},
		},
	];
}
