import { z } from "zod";

export const RUNTIME_CANARY_MODEL_PROVIDER = "runtime-canary";
export const RUNTIME_CANARY_MODEL_ID = "runtime-canary-model";
export const RUNTIME_CANARY_MODEL_KEY = `${RUNTIME_CANARY_MODEL_PROVIDER}/${RUNTIME_CANARY_MODEL_ID}`;
export const RUNTIME_CANARY_FIRST_PROMPT = "Reply with exactly DESKTOP_PROCESS_CANARY_FIRST.";
export const RUNTIME_CANARY_SECOND_PROMPT = "Reply with exactly DESKTOP_PROCESS_CANARY_SECOND.";
export const RUNTIME_CANARY_RESTART_PROMPT = "Reply with exactly DESKTOP_PROCESS_CANARY_RESTARTED.";
export const RUNTIME_CANARY_MCP_PROMPT = "Call the Runtime Canary MCP echo tool with value restart.";
export const RUNTIME_CANARY_MCP_RESULT = "RUNTIME_CANARY_MCP_RESULT:restart";
export const RUNTIME_CANARY_SKILL_MARKER = "RUNTIME_CANARY_HOST_SKILL_MARKER";
export const RUNTIME_CANARY_QUESTION_PROMPT = "Call ask_user_question for the Desktop process canary.";
export const RUNTIME_CANARY_QUESTION = "Should the Desktop process canary continue?";
export const RUNTIME_CANARY_SCHEDULER_PROMPT = "Hold the Desktop process Scheduler runtime canary open.";
export const RUNTIME_CANARY_BATCH_PROMPT = "Hold the Desktop process Batch runtime canary open.";
export const RUNTIME_CANARY_KNOWLEDGE_SOURCE_PATH = "runtime-canary/source.md";
export const RUNTIME_CANARY_KNOWLEDGE_PENDING_SOURCE_PATH = "runtime-canary/pending.md";
export const RUNTIME_CANARY_KNOWLEDGE_FAILURE_SOURCE_PATH = "runtime-canary/failure.md";
export const RUNTIME_CANARY_KNOWLEDGE_COMPLETE = "DESKTOP_PROCESS_CANARY_KNOWLEDGE_COMPLETE";

export const runtimeCanaryProcessingRecordFormatSchema = z.literal("conversation-v2-jsonl");

const runtimeCanaryKnowledgeScanSchema = z
	.object({
		operation: z.literal("scan-now"),
		skipped: z.literal(false),
	})
	.strict();

export const runtimeCanaryKnowledgeNotificationSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("processing"), value: z.boolean() }).strict(),
	z.object({ type: z.literal("statuses") }).strict(),
]);

export const runtimeCanaryKnowledgeContractSchema = z
	.object({
		scans: z
			.object({
				success: runtimeCanaryKnowledgeScanSchema,
				aborted: runtimeCanaryKnowledgeScanSchema,
				providerFailure: runtimeCanaryKnowledgeScanSchema,
			})
			.strict(),
		artifacts: z
			.object({
				path: z.string().min(1),
				source: z.string().min(1),
				sourcePath: z.string().min(1),
				sourceHash: z.string().min(1),
				tags: z.array(z.string()),
				title: z.string().min(1),
				summary: z.string().min(1),
				body: z.string().min(1),
				orphaned: z.boolean(),
				manifestPageCount: z.number().int().nonnegative(),
				indexedSourcePaths: z.array(z.string()),
			})
			.strict(),
		failure: z
			.object({
				sourcePath: z.string().min(1),
				attempts: z.number().int().positive(),
				quarantined: z.boolean(),
			})
			.strict(),
		monitor: z
			.object({
				processingInputTokens: z.number().nonnegative(),
				processingOutputTokens: z.number().nonnegative(),
				processingRounds: z.number().int().nonnegative(),
				filesProcessed: z.number().int().nonnegative(),
				filesFailed: z.number().int().nonnegative(),
				manualScanCount: z.number().int().nonnegative(),
			})
			.strict(),
		notifications: z.array(runtimeCanaryKnowledgeNotificationSchema),
		processingRecordCount: z.number().int().positive(),
		lifecycle: z
			.object({
				desktopRestarted: z.boolean(),
				sessionLocksReleased: z.boolean(),
				rawsUnlocked: z.boolean(),
				endpointRemoved: z.boolean(),
				providerStopped: z.boolean(),
				desktopExitCode: z.number().int(),
			})
			.strict(),
	})
	.strict();

export const runtimeCanarySuccessEnvelopeSchema = z
	.object({
		ok: z.literal(true),
		result: z
			.object({
				processingRecordFormat: runtimeCanaryProcessingRecordFormatSchema,
				knowledgeContract: runtimeCanaryKnowledgeContractSchema,
			})
			.loose(),
	})
	.strict();

export const runtimeCanaryConsumersSchema = z
	.object({
		schedulerTaskId: z.string().min(1),
		schedulerSessionId: z.string().min(1),
		schedulerSessionPath: z.string().min(1),
		batchProjectId: z.string().min(1),
		batchActiveTaskId: z.string().min(1),
		batchQueuedTaskId: z.string().min(1),
		batchSessionId: z.string().min(1),
		batchSessionPath: z.string().min(1),
	})
	.strict();

export const runtimeCanaryFixtureSchema = z
	.object({
		vettaHome: z.string().min(1),
		agentDir: z.string().min(1),
		workspace: z.string().min(1),
		providerBaseUrl: z.url(),
		requestLogPath: z.string().min(1),
		installedCliPath: z.string().min(1),
		modelKey: z.literal(RUNTIME_CANARY_MODEL_KEY),
		batchSourceDirectories: z.tuple([z.string().min(1), z.string().min(1)]),
		knowledgeRoot: z.string().min(1),
		knowledgeSourceHash: z.string().min(1),
	})
	.strict();

export const runtimeCanaryHostStateSchema = z
	.object({
		workspaceId: z.string().min(1),
		hostPid: z.number().int().positive(),
		desktopPid: z.number().int().positive(),
		desktopGeneration: z.number().int().positive(),
		cdpPort: z.number().int().positive(),
		runtimeCanary: runtimeCanaryFixtureSchema.extend({
			providerPid: z.number().int().positive(),
			exitReportPath: z.string().min(1),
			restartRequestPath: z.string().min(1),
			restartReportPath: z.string().min(1),
		}),
	})
	.loose();

export const runtimeCanaryRestartReportSchema = z
	.object({
		desktopExitCode: z.number().int(),
		desktopPid: z.number().int().positive(),
		endpointRemoved: z.boolean(),
		sessionLocksReleased: z.boolean(),
		knowledgeRawsUnlocked: z.boolean(),
	})
	.strict();

export const runtimeCanaryExitReportSchema = z
	.object({
		desktopExitCode: z.number().int(),
		desktopExitCodes: z.array(z.number().int()).min(1),
		desktopProcessIds: z.array(z.number().int().positive()).min(1),
		restartCount: z.number().int().nonnegative(),
		endpointRemoved: z.boolean(),
		providerStopped: z.boolean(),
	})
	.strict();

export type RuntimeCanaryFixture = z.infer<typeof runtimeCanaryFixtureSchema>;
export type RuntimeCanaryHostState = z.infer<typeof runtimeCanaryHostStateSchema>;
export type RuntimeCanaryRestartReport = z.infer<typeof runtimeCanaryRestartReportSchema>;
export type RuntimeCanaryExitReport = z.infer<typeof runtimeCanaryExitReportSchema>;
export type RuntimeCanaryConsumers = z.infer<typeof runtimeCanaryConsumersSchema>;
export type RuntimeCanaryProcessingRecordFormat = z.infer<typeof runtimeCanaryProcessingRecordFormatSchema>;
export type RuntimeCanaryKnowledgeContract = z.infer<typeof runtimeCanaryKnowledgeContractSchema>;
