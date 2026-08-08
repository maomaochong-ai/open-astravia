import { PassThrough } from "node:stream";
import { describe, expect, test, vi } from "vitest";
import { createRpcCommandDispatcher, type RpcFrameOutput } from "../../src/modes/rpc/rpc-command-dispatcher.js";
import { runRpcModeWithCapabilities } from "../../src/modes/rpc/rpc-mode.js";
import {
	RPC_FULL_SESSION_PROFILE,
	RPC_IM_SESSION_PROFILE,
	type RpcSessionCapabilities,
	type RpcSessionInitialization,
} from "../../src/modes/rpc/rpc-session-capabilities.js";
import type { RpcCommand, RpcResponse, RpcSessionState, RpcSlashCommand } from "../../src/modes/rpc/rpc-types.js";

describe("RPC command dispatcher", () => {
	test("dispatches the complete valid command surface through grouped capabilities", async () => {
		const session = createSessionCapabilities();
		const output = vi.fn<RpcFrameOutput>();
		const longOperationController = new AbortController();
		const dispatch = createRpcCommandDispatcher(session, output, {
			longOperationSignal: longOperationController.signal,
		});
		const commands: RpcCommand[] = [
			{ id: "prompt", type: "prompt", message: "hello", streamingBehavior: "steer" },
			{ id: "steer", type: "steer", message: "steer" },
			{ id: "follow", type: "follow_up", message: "follow" },
			{ id: "abort", type: "abort" },
			{ id: "new", type: "new_session", parentSession: "parent.jsonl" },
			{ id: "state", type: "get_state" },
			{ id: "model", type: "set_model", provider: "missing", modelId: "missing" },
			{ id: "cycle-model", type: "cycle_model" },
			{ id: "models", type: "get_available_models" },
			{ id: "thinking", type: "set_thinking_level", level: "high" },
			{ id: "cycle-thinking", type: "cycle_thinking_level" },
			{ id: "steering-mode", type: "set_steering_mode", mode: "one-at-a-time" },
			{ id: "follow-mode", type: "set_follow_up_mode", mode: "all" },
			{ id: "compact", type: "compact", customInstructions: "keep facts" },
			{ id: "auto-compact", type: "set_auto_compaction", enabled: false },
			{ id: "flush", type: "flush_memory" },
			{ id: "auto-retry", type: "set_auto_retry", enabled: false },
			{ id: "abort-retry", type: "abort_retry" },
			{ id: "bash", type: "bash", command: "echo ok" },
			{ id: "abort-bash", type: "abort_bash" },
			{ id: "stats", type: "get_session_stats" },
			{ id: "export", type: "export_html", outputPath: "out.html" },
			{ id: "switch", type: "switch_session", sessionPath: "other.jsonl" },
			{ id: "fork", type: "fork", entryId: "entry-1" },
			{ id: "fork-messages", type: "get_fork_messages" },
			{ id: "last-text", type: "get_last_assistant_text" },
			{ id: "name", type: "set_session_name", name: "  named  " },
			{ id: "messages", type: "get_messages" },
			{ id: "commands", type: "get_commands" },
		];

		const responses: RpcResponse[] = [];
		for (const command of commands) {
			responses.push(await dispatch(command));
		}

		expect(responses.map(({ command }) => command)).toEqual(commands.map(({ type }) => type));
		expect(responses.find(({ command }) => command === "set_model")).toMatchObject({
			success: false,
			error: "Model not found: missing/missing",
		});
		expect(responses.find(({ command }) => command === "flush_memory")).toMatchObject({
			success: true,
			data: { written: 3 },
		});
		expect(responses.find(({ command }) => command === "compact")).toMatchObject({
			success: true,
			data: { summary: "summary", firstKeptEntryId: "kept", tokensBefore: 42 },
		});
		expect(responses.find(({ command }) => command === "get_last_assistant_text")).toMatchObject({
			success: true,
			data: { text: undefined },
		});
		expect(required(session.session).setName).toHaveBeenCalledWith("named");
		expect(required(session.session).newSession).toHaveBeenCalledWith("parent.jsonl");
		expect(required(session.context).compact).toHaveBeenCalledWith("keep facts", longOperationController.signal);
		expect(required(session.memory).flushMemory).toHaveBeenCalledWith(longOperationController.signal);
		expect(required(session.bash).execute).toHaveBeenCalledWith("echo ok", longOperationController.signal);
		expect(output).not.toHaveBeenCalled();
	});

	test("acknowledges prompt immediately and reports its later failure as a correlated response", async () => {
		const session = createSessionCapabilities();
		required(session.turn).prompt = vi.fn(async () => {
			throw new Error("provider failed");
		});
		const frames: unknown[] = [];
		const backgroundTasks: Promise<void>[] = [];
		const dispatch = createRpcCommandDispatcher(session, (frame) => frames.push(frame), {
			onBackgroundTask: (task) => backgroundTasks.push(task),
		});

		const response = await dispatch({ id: "p1", type: "prompt", message: "hello" });
		await Promise.all(backgroundTasks);

		expect(response).toEqual({ id: "p1", type: "response", command: "prompt", success: true });
		expect(backgroundTasks).toHaveLength(1);
		expect(frames).toEqual([
			{
				id: "p1",
				type: "response",
				command: "prompt",
				success: false,
				error: "provider failed",
				errorCode: "command_failed",
				phase: "turn",
				recoverability: "continue_session",
			},
		]);
	});

	test("preserves empty session-name validation without invoking the session", async () => {
		const session = createSessionCapabilities();
		const dispatch = createRpcCommandDispatcher(session, () => {});

		await expect(dispatch({ id: "name", type: "set_session_name", name: "   " })).resolves.toEqual({
			id: "name",
			type: "response",
			command: "set_session_name",
			success: false,
			error: "Session name cannot be empty",
			errorCode: "invalid_request",
			phase: "command",
			recoverability: "user_action",
		});
		expect(required(session.session).setName).not.toHaveBeenCalled();
	});

	test("returns a correlated error when a synchronous control command rejects", async () => {
		const session = createSessionCapabilities();
		required(session.session).switchSession = vi.fn(async () => {
			throw new Error("target session is locked");
		});
		const dispatch = createRpcCommandDispatcher(session, () => {});

		await expect(
			dispatch({ id: "switch-locked", type: "switch_session", sessionPath: "locked.jsonl" }),
		).resolves.toEqual({
			id: "switch-locked",
			type: "response",
			command: "switch_session",
			success: false,
			error: "target session is locked",
			errorCode: "command_failed",
			phase: "transition",
			recoverability: "continue_session",
		});
	});

	test("rejects commands outside the selected profile without invoking absent capabilities", async () => {
		const session: RpcSessionCapabilities = {
			profile: RPC_IM_SESSION_PROFILE,
			turn: {
				prompt: vi.fn(async () => {}),
				steer: vi.fn(async () => {}),
				followUp: vi.fn(async () => {}),
				abort: vi.fn(async () => {}),
			},
			state: {
				readState: vi.fn(async () => createRpcState()),
				readMessages: vi.fn(() => []),
			},
			memory: { flushMemory: vi.fn(async () => 0) },
			commands: { readCommands: vi.fn(() => []) },
			initialize: vi.fn(async () => {}),
			subscribe: vi.fn(() => () => {}),
			shutdown: vi.fn(async () => {}),
			dispose: vi.fn(async () => {}),
		};
		const dispatch = createRpcCommandDispatcher(session, () => {});

		await expect(dispatch({ id: "bash", type: "bash", command: "echo no" })).resolves.toEqual({
			id: "bash",
			type: "response",
			command: "bash",
			success: false,
			error: "Command bash is not supported by RPC profile im",
			errorCode: "command_not_supported",
			phase: "command",
			recoverability: "user_action",
		});
	});

	test("wires validated JSONL frames, session events and awaited transport cleanup", async () => {
		const session = createSessionCapabilities();
		let initialization: RpcSessionInitialization | undefined;
		let eventListener: ((event: unknown) => void) | undefined;
		const unsubscribe = vi.fn();
		session.initialize = vi.fn(async (input) => {
			initialization = input;
		});
		session.subscribe = vi.fn((listener) => {
			eventListener = listener;
			return unsubscribe;
		});
		const input = new PassThrough();
		const output = new PassThrough();
		const chunks: Buffer[] = [];
		output.on("data", (chunk: Buffer) => chunks.push(chunk));
		const exit = vi.fn();

		void runRpcModeWithCapabilities(session, { input, output, exit });
		await vi.waitFor(() => expect(initialization).toBeDefined());

		input.write('{"id":"state","type":"get_state"}\n');
		await vi.waitFor(() => expect(readOutputFrames(chunks)).toHaveLength(1));
		input.write('{"id":"invalid","type":"prompt"}\n');
		await vi.waitFor(() => expect(readOutputFrames(chunks)).toHaveLength(2));
		input.write('{"type":"future_command"}\n');
		await vi.waitFor(() => expect(readOutputFrames(chunks)).toHaveLength(3));
		eventListener?.({ type: "agent_end" });
		await vi.waitFor(() => expect(readOutputFrames(chunks)).toHaveLength(4));

		expect(readOutputFrames(chunks)).toEqual([
			expect.objectContaining({ id: "state", command: "get_state", success: true }),
			expect.objectContaining({
				command: "parse",
				success: false,
				error: "Failed to parse command: Invalid RPC frame",
			}),
			expect.objectContaining({
				command: "future_command",
				success: false,
				error: "Unknown command: future_command",
			}),
			{ type: "agent_end" },
		]);

		input.end();
		await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
		expect(unsubscribe).toHaveBeenCalledOnce();
		expect(session.dispose).toHaveBeenCalledOnce();
	});

	test("drains an accepted command before disposing after input closes", async () => {
		const session = createSessionCapabilities();
		let initialization: RpcSessionInitialization | undefined;
		let resolveState: ((state: RpcSessionState) => void) | undefined;
		const unsubscribe = vi.fn();
		session.initialize = vi.fn(async (input) => {
			initialization = input;
		});
		session.subscribe = vi.fn(() => unsubscribe);
		required(session.state).readState = vi.fn(
			() =>
				new Promise<RpcSessionState>((resolve) => {
					resolveState = resolve;
				}),
		);
		const input = new PassThrough();
		const output = new PassThrough();
		const chunks: Buffer[] = [];
		output.on("data", (chunk: Buffer) => chunks.push(chunk));
		const exit = vi.fn();

		void runRpcModeWithCapabilities(session, { input, output, exit });
		await vi.waitFor(() => expect(initialization).toBeDefined());
		input.write('{"id":"drain-state","type":"get_state"}\n');
		await vi.waitFor(() => expect(required(session.state).readState).toHaveBeenCalledOnce());
		input.end();
		await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledOnce());
		expect(session.dispose).not.toHaveBeenCalled();

		required(resolveState)(createRpcState());
		await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
		expect(readOutputFrames(chunks)).toEqual([
			expect.objectContaining({ id: "drain-state", command: "get_state", success: true }),
		]);
		expect(session.dispose).toHaveBeenCalledOnce();
	});

	test("cancels transport-scoped long operations before draining handlers and disposing", async () => {
		const session = createSessionCapabilities();
		const lifecycle: string[] = [];
		const signals: AbortSignal[] = [];
		required(session.context).compact = vi.fn((_customInstructions, signal) =>
			settleWhenAborted(
				signal,
				{
					summary: "cancelled compact",
					firstKeptEntryId: "kept",
					tokensBefore: 1,
				},
				() => lifecycle.push("compact-aborted"),
				signals,
			),
		);
		required(session.memory).flushMemory = vi.fn((signal) =>
			settleWhenAborted(signal, 0, () => lifecycle.push("memory-aborted"), signals),
		);
		required(session.bash).execute = vi.fn((_command, signal) =>
			settleWhenAborted(
				signal,
				{ output: "", exitCode: undefined, cancelled: true, truncated: false },
				() => lifecycle.push("bash-aborted"),
				signals,
			),
		);
		session.dispose = vi.fn(async () => {
			lifecycle.push("dispose");
		});
		const input = new PassThrough();
		const output = new PassThrough();
		const exit = vi.fn();

		void runRpcModeWithCapabilities(session, { input, output, exit });
		input.write('{"id":"held-compact","type":"compact"}\n');
		input.write('{"id":"held-memory","type":"flush_memory"}\n');
		input.write('{"id":"held-bash","type":"bash","command":"hold"}\n');
		await vi.waitFor(() => expect(signals).toHaveLength(3));
		input.end();
		await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));

		expect(new Set(signals).size).toBe(1);
		expect(lifecycle).toEqual(["compact-aborted", "memory-aborted", "bash-aborted", "dispose"]);
	});

	test("waits for an accepted prompt background task after session disposal before exiting", async () => {
		const session = createSessionCapabilities();
		let finishPrompt: (() => void) | undefined;
		required(session.turn).prompt = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishPrompt = resolve;
				}),
		);
		const input = new PassThrough();
		const output = new PassThrough();
		const exit = vi.fn();

		void runRpcModeWithCapabilities(session, { input, output, exit });
		input.write('{"id":"background-prompt","type":"prompt","message":"hold"}\n');
		await vi.waitFor(() => expect(required(session.turn).prompt).toHaveBeenCalledOnce());
		input.end();
		await vi.waitFor(() => expect(session.dispose).toHaveBeenCalledOnce());
		expect(exit).not.toHaveBeenCalled();

		required(finishPrompt)();
		await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
	});

	test("settles a prompt waiting on the Host Bridge before transport exit", async () => {
		const session = createSessionCapabilities();
		let initialization: RpcSessionInitialization | undefined;
		session.initialize = vi.fn(async (input) => {
			initialization = input;
		});
		required(session.turn).prompt = vi.fn(async () => {
			await required(required(initialization).hostBridge).sendAttachment({ path: "file.txt", kind: "file" });
		});
		const input = new PassThrough();
		const output = new PassThrough();
		const chunks: Buffer[] = [];
		output.on("data", (chunk: Buffer) => chunks.push(chunk));
		const exit = vi.fn();

		void runRpcModeWithCapabilities(session, { input, output, exit, enableHostBridge: true });
		await vi.waitFor(() => expect(initialization).toBeDefined());
		input.write('{"id":"host-prompt","type":"prompt","message":"send"}\n');
		await vi.waitFor(() =>
			expect(readOutputFrames(chunks).some((frame) => isFrameType(frame, "host_request"))).toBe(true),
		);
		input.end();
		await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));

		expect(
			readOutputFrames(chunks).filter(
				(frame) => isRpcResponse(frame) && frame.id === "host-prompt" && frame.command === "prompt",
			),
		).toEqual([
			expect.objectContaining({ success: true }),
			expect.objectContaining({ success: false, error: "RPC host bridge closed" }),
		]);
	});

	test("cancels a prompt waiting on Extension UI before transport exit", async () => {
		const session = createSessionCapabilities();
		let initialization: RpcSessionInitialization | undefined;
		let confirmation: boolean | undefined;
		session.initialize = vi.fn(async (input) => {
			initialization = input;
		});
		required(session.turn).prompt = vi.fn(async () => {
			confirmation = await required(initialization).uiContext.confirm("Confirm", "Continue?");
		});
		const input = new PassThrough();
		const output = new PassThrough();
		const chunks: Buffer[] = [];
		output.on("data", (chunk: Buffer) => chunks.push(chunk));
		const exit = vi.fn();

		void runRpcModeWithCapabilities(session, { input, output, exit });
		await vi.waitFor(() => expect(initialization).toBeDefined());
		input.write('{"id":"ui-prompt","type":"prompt","message":"confirm"}\n');
		await vi.waitFor(() =>
			expect(readOutputFrames(chunks).some((frame) => isFrameType(frame, "extension_ui_request"))).toBe(true),
		);
		input.end();
		await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));

		expect(confirmation).toBe(false);
		expect(
			readOutputFrames(chunks).filter(
				(frame) => isRpcResponse(frame) && frame.id === "ui-prompt" && frame.command === "prompt",
			),
		).toEqual([expect.objectContaining({ success: true })]);
	});

	test("settles an active prompt during an Extension-requested shutdown", async () => {
		const session = createSessionCapabilities();
		let initialization: RpcSessionInitialization | undefined;
		let finishPrompt: (() => void) | undefined;
		session.initialize = vi.fn(async (input) => {
			initialization = input;
		});
		required(session.turn).prompt = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishPrompt = resolve;
				}),
		);
		required(session.turn).abort = vi.fn(async () => required(finishPrompt)());
		const input = new PassThrough();
		const output = new PassThrough();
		const exit = vi.fn();

		void runRpcModeWithCapabilities(session, { input, output, exit });
		await vi.waitFor(() => expect(initialization).toBeDefined());
		input.write('{"id":"shutdown-prompt","type":"prompt","message":"hold"}\n');
		await vi.waitFor(() => expect(required(session.turn).prompt).toHaveBeenCalledOnce());
		required(initialization).onShutdownRequested();
		await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));

		expect(session.shutdown).toHaveBeenCalledOnce();
		expect(required(session.turn).abort).toHaveBeenCalledOnce();
		expect(session.dispose).toHaveBeenCalledOnce();
	});

	test("runs an Extension-requested shutdown exactly once across concurrent commands", async () => {
		const session = createSessionCapabilities();
		let initialization: RpcSessionInitialization | undefined;
		let finishShutdown: (() => void) | undefined;
		const shutdownGate = new Promise<void>((resolve) => {
			finishShutdown = resolve;
		});
		session.initialize = vi.fn(async (input) => {
			initialization = input;
		});
		session.shutdown = vi.fn(() => shutdownGate);
		const input = new PassThrough();
		const output = new PassThrough();
		const exit = vi.fn();

		void runRpcModeWithCapabilities(session, { input, output, exit });
		await vi.waitFor(() => expect(initialization).toBeDefined());
		required(initialization).onShutdownRequested();
		input.write('{"id":"shutdown-state-a","type":"get_state"}\n');
		input.write('{"id":"shutdown-state-b","type":"get_state"}\n');
		await vi.waitFor(() => expect(session.shutdown).toHaveBeenCalled());
		await Promise.resolve();
		required(finishShutdown)();
		await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));

		expect(session.shutdown).toHaveBeenCalledOnce();
		expect(session.dispose).toHaveBeenCalledOnce();
	});

	test("honors an asynchronous Extension shutdown request without another command", async () => {
		const session = createSessionCapabilities();
		let initialization: RpcSessionInitialization | undefined;
		session.initialize = vi.fn(async (input) => {
			initialization = input;
		});
		const input = new PassThrough();
		const output = new PassThrough();
		const exit = vi.fn();

		void runRpcModeWithCapabilities(session, { input, output, exit });
		await vi.waitFor(() => expect(initialization).toBeDefined());
		await Promise.resolve();
		required(initialization).onShutdownRequested();
		await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));

		expect(session.shutdown).toHaveBeenCalledOnce();
		expect(session.dispose).toHaveBeenCalledOnce();
	});

	test("does not re-enter an Extension callback while accepting its shutdown request", async () => {
		const session = createSessionCapabilities();
		const lifecycle: string[] = [];
		let initialization: RpcSessionInitialization | undefined;
		session.initialize = vi.fn(async (input) => {
			initialization = input;
		});
		session.shutdown = vi.fn(async () => {
			lifecycle.push("session-shutdown");
		});
		const input = new PassThrough();
		const output = new PassThrough();
		const exit = vi.fn();

		void runRpcModeWithCapabilities(session, { input, output, exit });
		await vi.waitFor(() => expect(initialization).toBeDefined());
		lifecycle.push("handler-before");
		required(initialization).onShutdownRequested();
		lifecycle.push("handler-after");
		expect(session.shutdown).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));

		expect(lifecycle).toEqual(["handler-before", "handler-after", "session-shutdown"]);
		expect(session.shutdown).toHaveBeenCalledOnce();
		expect(session.dispose).toHaveBeenCalledOnce();
	});

	test("disposes capabilities when RPC initialization fails", async () => {
		const session = createSessionCapabilities();
		session.initialize = vi.fn(async () => {
			throw new Error("initialization failed");
		});

		await expect(
			runRpcModeWithCapabilities(session, {
				input: new PassThrough(),
				output: new PassThrough(),
				exit: vi.fn(),
			}),
		).rejects.toThrow("initialization failed");
		expect(session.dispose).toHaveBeenCalledOnce();
	});
});

function createSessionCapabilities(): RpcSessionCapabilities {
	return {
		profile: RPC_FULL_SESSION_PROFILE,
		turn: {
			prompt: vi.fn(async () => {}),
			steer: vi.fn(async () => {}),
			followUp: vi.fn(async () => {}),
			abort: vi.fn(async () => {}),
		},
		state: {
			readState: vi.fn(async () => createRpcState()),
			readMessages: vi.fn(() => []),
		},
		model: {
			selectModel: vi.fn(async () => undefined),
			cycleModel: vi.fn(async () => undefined),
			readAvailableModels: vi.fn(async () => []),
			setThinkingLevel: vi.fn(),
			cycleThinkingLevel: vi.fn(() => undefined),
		},
		queue: {
			setSteeringMode: vi.fn(),
			setFollowUpMode: vi.fn(),
		},
		context: {
			compact: vi.fn(async () => ({
				summary: "summary",
				firstKeptEntryId: "kept",
				tokensBefore: 42,
			})),
			setAutoCompactionEnabled: vi.fn(),
		},
		memory: {
			flushMemory: vi.fn(async () => 3),
		},
		retry: {
			setAutoRetryEnabled: vi.fn(),
			abortRetry: vi.fn(),
		},
		bash: {
			execute: vi.fn(async () => ({
				output: "ok",
				exitCode: 0,
				cancelled: false,
				truncated: false,
			})),
			abort: vi.fn(),
		},
		session: {
			newSession: vi.fn(async () => true),
			switchSession: vi.fn(async () => true),
			fork: vi.fn(async () => ({ text: "fork text", cancelled: false })),
			readForkMessages: vi.fn(() => [{ entryId: "entry-1", text: "prompt" }]),
			readLastAssistantText: vi.fn(() => undefined),
			setName: vi.fn(),
			readStats: vi.fn(() => ({
				sessionFile: "session.jsonl",
				sessionId: "session-1",
				userMessages: 1,
				assistantMessages: 1,
				toolCalls: 0,
				toolResults: 0,
				totalMessages: 2,
				tokens: {
					input: 1,
					output: 1,
					cacheRead: 0,
					cacheWrite: 0,
					total: 2,
				},
				cost: 0,
			})),
			exportHtml: vi.fn(async () => "out.html"),
		},
		commands: {
			readCommands: vi.fn(() => [{ name: "skill:test", source: "skill" }] satisfies RpcSlashCommand[]),
		},
		initialize: vi.fn(async () => {}),
		subscribe: vi.fn(() => () => {}),
		shutdown: vi.fn(async () => {}),
		dispose: vi.fn(async () => {}),
	};
}

function createRpcState(): RpcSessionState {
	return {
		thinkingLevel: "medium",
		isStreaming: false,
		isCompacting: false,
		steeringMode: "all",
		followUpMode: "all",
		sessionId: "session-1",
		autoCompactionEnabled: true,
		messageCount: 0,
		pendingMessageCount: 0,
	};
}

function readOutputFrames(chunks: readonly Buffer[]): unknown[] {
	return Buffer.concat(chunks)
		.toString("utf8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

function isFrameType(frame: unknown, type: string): boolean {
	return typeof frame === "object" && frame !== null && Reflect.get(frame, "type") === type;
}

function isRpcResponse(frame: unknown): frame is RpcResponse {
	return isFrameType(frame, "response");
}

function settleWhenAborted<T>(
	signal: AbortSignal | undefined,
	value: T,
	onAbort: () => void,
	signals: AbortSignal[],
): Promise<T> {
	if (!signal) throw new Error("Expected long-operation abort signal");
	signals.push(signal);
	return new Promise((resolve) => {
		const settle = () => {
			onAbort();
			resolve(value);
		};
		if (signal.aborted) {
			settle();
		} else {
			signal.addEventListener("abort", settle, { once: true });
		}
	});
}

function required<T>(value: T | undefined): T {
	if (!value) throw new Error("Expected RPC capability");
	return value;
}
