import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition, RuntimeToolExecutionRequest, RuntimeToolResult } from "@vetta/runtime-core/kernel";

export const CommandToolInputSchema = Type.Object({
	description: Type.Optional(
		Type.String({
			description: "Brief user-facing reason for this tool call (max 100 chars).",
			maxLength: 100,
		}),
	),
	command: Type.String({
		description: "Bash command to execute.",
	}),
	timeout: Type.Optional(
		Type.Number({
			description:
				"Hard timeout in seconds: kill the process when exceeded. Prefer for bounded work (builds, one-shot tests). Unrelated to auto-promote soft wait.",
		}),
	),
	run_in_background: Type.Optional(
		Type.Boolean({
			description:
				"Run as a background task immediately (returns task ID). REQUIRED for any process that does not exit on its own: dev servers, watchers, docker compose up (without -d), make dev, tunnels. Do not use for quick one-shot commands. Ignores timeout.",
		}),
	),
});

export type CommandToolInput = Static<typeof CommandToolInputSchema>;
export type CommandToolName = "bash" | "shell";

export interface CommandToolExecutorRequest {
	readonly toolName: CommandToolName;
	readonly cwd: string;
	readonly toolCallId: string;
	readonly input: Readonly<CommandToolInput>;
	readonly signal: AbortSignal;
	readonly onUpdate?: (result: RuntimeToolResult) => void;
	readonly reportPhase?: (label: string) => void;
}

export interface CommandToolExecutor {
	execute(request: CommandToolExecutorRequest): Promise<RuntimeToolResult>;
}

export interface CreateCommandToolOptions {
	readonly name: CommandToolName;
	readonly description: string;
	readonly cwd: string;
	readonly executor: CommandToolExecutor;
}

export function createCommandTool(options: CreateCommandToolOptions): RuntimeToolDefinition<CommandToolInput> {
	return {
		name: options.name,
		label: options.name,
		description: options.description,
		inputSchema: CommandToolInputSchema,
		execute(request: RuntimeToolExecutionRequest<CommandToolInput>) {
			return options.executor.execute({
				toolName: options.name,
				cwd: options.cwd,
				toolCallId: request.toolCallId,
				input: request.input,
				signal: request.signal,
				onUpdate: request.onUpdate,
				reportPhase: request.reportPhase,
			});
		},
	};
}
