import { readFileSync } from "node:fs";
import { z } from "zod";

const retryStartSchema = z.object({
	type: z.literal("auto_retry_start"),
	attempt: z.number().int().nonnegative(),
	maxAttempts: z.number().int().nonnegative(),
	delayMs: z.number().nonnegative(),
});

const retryEndSchema = z.object({
	type: z.literal("auto_retry_end"),
	attempt: z.number().int().nonnegative(),
	success: z.boolean(),
});

const legacyRuntimeContractSchema = z.object({
	schemaVersion: z.literal(1),
	print: z.object({
		coreEventTypes: z.array(z.string()).nonempty(),
		toolFrameTypes: z.array(z.string()).nonempty(),
		retry: z.object({
			requestCount: z.number().int().positive(),
			frames: z.tuple([retryStartSchema, retryEndSchema]),
		}),
		nonRetryableProviderFailure: z.object({
			code: z.number().int(),
			requestCount: z.number().int().positive(),
			retryFrameCount: z.number().int().nonnegative(),
			fallback: z.boolean(),
		}),
		textProviderFailure: z.object({
			code: z.number().int(),
			requestCount: z.number().int().positive(),
		}),
	}),
	rpc: z.object({
		streamingLifecycle: z.array(z.string()).nonempty(),
		terminalFailureKinds: z.array(z.string()).nonempty(),
	}),
	tools: z.object({
		defaultNames: z.object({
			win32: z.array(z.string()).nonempty(),
			posix: z.array(z.string()).nonempty(),
		}),
	}),
});

export type LegacyRuntimeContract = z.infer<typeof legacyRuntimeContractSchema>;

const source: unknown = JSON.parse(
	readFileSync(new URL("../fixtures/legacy-runtime-contract-v1.json", import.meta.url), "utf8"),
);

export const legacyRuntimeContract: LegacyRuntimeContract = legacyRuntimeContractSchema.parse(source);
