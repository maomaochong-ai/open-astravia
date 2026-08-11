/**
 * Headless JSONL RPC host adapter.
 *
 * The wire protocol, command dispatcher and session implementation are kept
 * separate so the transport does not depend on AgentSession internals.
 */

import type { Readable, Writable } from "node:stream";
import {
	createRpcCommandDispatcher,
	type RpcFrameOutput,
	rpcError,
	rpcFailureMetadataForCommand,
} from "./rpc-command-dispatcher.js";
import { RpcExtensionUIBridge } from "./rpc-extension-ui-bridge.js";
import { RPC_FAILURE_CODES } from "./rpc-failure.js";
import { validateRpcInboundFrame } from "./rpc-frame-validator.js";
import { RpcHostBridge } from "./rpc-host-bridge.js";
import { RpcJsonlTransport } from "./rpc-jsonl-transport.js";
import { assertRpcSessionCapabilities, type RpcSessionCapabilities } from "./rpc-session-capabilities.js";

export type {
	RpcCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcResponse,
	RpcSessionState,
} from "./rpc-types.js";

export interface RunRpcModeOptions {
	/** Register the im_send_attachment tool and accept host_response frames. */
	enableHostBridge?: boolean;
}

interface RpcModeRuntimeOptions extends RunRpcModeOptions {
	readonly input?: Readable;
	readonly output?: Writable;
	readonly exit?: (code: number) => void;
}

export async function runRpcModeWithCapabilities(
	session: RpcSessionCapabilities,
	options: RpcModeRuntimeOptions = {},
): Promise<never> {
	assertRpcSessionCapabilities(session, {
		hostBridgeEnabled: options.enableHostBridge === true,
	});
	const transport = new RpcJsonlTransport(options.input ?? process.stdin, options.output ?? process.stdout);
	const output: RpcFrameOutput = (frame) => transport.write(frame);
	const extensionUI = new RpcExtensionUIBridge(output);
	const hostBridge = options.enableHostBridge ? new RpcHostBridge(output) : undefined;
	const backgroundTasks = new Set<Promise<void>>();
	const longOperationController = new AbortController();
	const dispatch = createRpcCommandDispatcher(session, output, {
		onBackgroundTask: (task) => {
			backgroundTasks.add(task);
			void task.then(
				() => backgroundTasks.delete(task),
				() => backgroundTasks.delete(task),
			);
		},
		longOperationSignal: longOperationController.signal,
	});
	const exit = options.exit ?? ((code: number): never => process.exit(code));
	let shutdownRequested = false;
	let beginRequestedShutdown: (() => void) | undefined;
	let requestedShutdownScheduled = false;
	const scheduleRequestedShutdown = (): void => {
		if (requestedShutdownScheduled) return;
		requestedShutdownScheduled = true;
		queueMicrotask(() => {
			requestedShutdownScheduled = false;
			beginRequestedShutdown?.();
		});
	};

	try {
		await session.initialize({
			uiContext: extensionUI.createContext(),
			hostBridge: hostBridge?.createBridge(),
			onShutdownRequested: () => {
				shutdownRequested = true;
				scheduleRequestedShutdown();
			},
			onExtensionError: (error) => {
				output({
					type: "extension_error",
					extensionPath: error.extensionPath,
					event: error.event,
					error: error.error,
				});
			},
		});
	} catch (error) {
		extensionUI.dispose();
		hostBridge?.dispose();
		try {
			await session.dispose();
		} catch (disposeError) {
			throw new AggregateError([error, disposeError], "RPC initialization and cleanup both failed");
		}
		throw error;
	}

	const unsubscribe = session.subscribe(output);
	const inFlightHandlers = new Set<Promise<void>>();
	let shutdownPromise: Promise<void> | undefined;
	const shutdown = (): Promise<void> => {
		shutdownPromise ??= session.shutdown().catch((error: unknown) => {
			output(
				rpcError(
					undefined,
					"shutdown",
					`Failed to shut down RPC session: ${errorMessage(error)}`,
					rpcFailureMetadataForCommand("shutdown", RPC_FAILURE_CODES.SHUTDOWN_FAILED),
				),
			);
		});
		return shutdownPromise;
	};
	let cleanupPromise: Promise<void> | undefined;
	const cleanup = (): Promise<void> => {
		cleanupPromise ??= (async () => {
			unsubscribe();
			extensionUI.dispose();
			hostBridge?.dispose();
			longOperationController.abort("RPC transport closed");
			await Promise.allSettled([...inFlightHandlers]);
			if (backgroundTasks.size > 0) await session.turn?.abort();
			await shutdown();
			await session.dispose();
			await Promise.allSettled([...backgroundTasks]);
		})();
		return cleanupPromise;
	};
	beginRequestedShutdown = (): void => {
		if (shutdownPromise) return;
		void shutdown().finally(() => {
			transport.close();
		});
	};
	if (shutdownRequested) scheduleRequestedShutdown();

	const handleLine = async (line: string): Promise<void> => {
		try {
			const frame = validateRpcInboundFrame(JSON.parse(line));
			switch (frame.kind) {
				case "extension_ui_response":
					extensionUI.handle(frame.value);
					return;
				case "host_response":
					hostBridge?.handle(frame.value);
					return;
				case "unknown":
					output(
						rpcError(
							undefined,
							frame.type,
							`Unknown command: ${frame.type}`,
							rpcFailureMetadataForCommand(frame.type, RPC_FAILURE_CODES.COMMAND_NOT_SUPPORTED),
						),
					);
					return;
				case "invalid":
					throw new Error(frame.message);
				case "command": {
					try {
						const response = await dispatch(frame.value);
						output(response);
					} catch (error) {
						output(
							rpcError(
								frame.value.id,
								frame.value.type,
								errorMessage(error),
								rpcFailureMetadataForCommand(frame.value.type, errorCode(error)),
							),
						);
					}
					if (shutdownRequested) scheduleRequestedShutdown();
					return;
				}
			}
		} catch (error: unknown) {
			output(
				rpcError(
					undefined,
					"parse",
					`Failed to parse command: ${errorMessage(error)}`,
					rpcFailureMetadataForCommand("parse", RPC_FAILURE_CODES.INVALID_REQUEST),
				),
			);
		}
	};

	transport.start(
		(line) => {
			const task = handleLine(line);
			inFlightHandlers.add(task);
			void task.then(
				() => inFlightHandlers.delete(task),
				() => inFlightHandlers.delete(task),
			);
		},
		() => {
			void cleanup().then(
				() => exit(0),
				(error: unknown) => {
					output(
						rpcError(
							undefined,
							"shutdown",
							`Failed to dispose RPC session: ${errorMessage(error)}`,
							rpcFailureMetadataForCommand("shutdown", RPC_FAILURE_CODES.SHUTDOWN_FAILED),
						),
					);
					exit(1);
				},
			);
		},
	);

	return new Promise(() => {});
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string {
	if (typeof error === "object" && error !== null) {
		const code = Reflect.get(error, "code");
		if (typeof code === "string" && code.length > 0) return code;
	}
	return RPC_FAILURE_CODES.COMMAND_FAILED;
}
