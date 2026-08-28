import { readRuntimeFailure } from "@vetta/runtime-core";
import { isRetryableRuntimeError } from "../failure-classification.js";
import type {
	CodingAgentTurnExecutor,
	CodingAgentTurnExecutorOptions,
	CodingAgentTurnFailure,
	CodingAgentTurnPromptOptions,
} from "./contracts.js";

export class CodingAgentSessionTurnExecutor implements CodingAgentTurnExecutor {
	constructor(private readonly options: CodingAgentTurnExecutorOptions) {}

	async prompt(message: string, promptOptions: CodingAgentTurnPromptOptions = {}): Promise<void> {
		if (!promptOptions.streamingBehavior) {
			const executed = await this.options.sessionHost.startActiveSessionOperation(
				async () => this.options.commandHost?.tryExecute(message) ?? false,
			);
			if (executed) return;
		} else {
			this.options.commandHost?.throwIfExtensionCommand(message);
		}

		const executeInitial = () =>
			this.options.sessionHost.startActiveSessionOperation((session) =>
				session.prompt({
					text: message,
					images: promptOptions.images ? [...promptOptions.images] : undefined,
					streamingBehavior: promptOptions.streamingBehavior,
				}),
			);
		const result = await this.options.retryController.run(
			executeInitial,
			() => this.options.sessionHost.startActiveSessionOperation((session) => session.retry()),
			readCodingAgentTurnFailure,
		);
		const failedMessage = readCodingAgentTurnFailure(result)?.message;
		if (failedMessage && promptOptions.throwOnFailure !== false) throw new Error(failedMessage);
	}
}

export function createCodingAgentTurnExecutor(options: CodingAgentTurnExecutorOptions): CodingAgentTurnExecutor {
	return new CodingAgentSessionTurnExecutor(options);
}

export function readCodingAgentFailedTurnMessage(value: unknown): string | undefined {
	return readCodingAgentTurnFailure(value)?.message;
}

export function readCodingAgentTurnFailure(value: unknown): CodingAgentTurnFailure | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const error = Reflect.get(value, "error");
	if (
		Reflect.get(value, "status") === "failed" &&
		typeof error === "object" &&
		error !== null &&
		typeof Reflect.get(error, "message") === "string"
	) {
		const message = Reflect.get(error, "message") as string;
		const origin = Reflect.get(error, "origin");
		const structured = readRuntimeFailure({
			...(error as object),
			origin:
				origin === "runtime" || origin === "provider" || origin === "tool" || origin === "extension"
					? origin
					: "runtime",
		});
		if (structured) return structured;
		return {
			code: "TURN_FAILED",
			message,
			retryable: isRetryableRuntimeError(message),
			origin: "runtime" as const,
		};
	}
	if (Reflect.get(value, "status") !== "completed" || Reflect.get(value, "stopReason") !== "error") {
		return undefined;
	}
	const messages = Reflect.get(value, "messages");
	if (!Array.isArray(messages)) {
		return { code: "LEGACY_ASSISTANT_ERROR", message: "Request failed", retryable: false, origin: "runtime" };
	}
	let assistant: unknown;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const candidate: unknown = messages[index];
		if (
			typeof candidate === "object" &&
			candidate !== null &&
			Reflect.get(candidate, "role") === "assistant" &&
			Reflect.get(candidate, "stopReason") === "error"
		) {
			assistant = candidate;
			break;
		}
	}
	const errorMessage = assistant ? Reflect.get(assistant, "errorMessage") : undefined;
	const message = typeof errorMessage === "string" && errorMessage.length > 0 ? errorMessage : "Request failed";
	return {
		code: "LEGACY_ASSISTANT_ERROR",
		message,
		retryable: isRetryableRuntimeError(message),
		origin: "runtime",
	};
}
