import {
	RetryableCleanup,
	type RuntimeSession,
	type RuntimeSessionExecutionObservation,
	type SessionEvent,
} from "@vetta/runtime-core";
import type { ManagedMcpRuntimeToolSource } from "@vetta/runtime-mcp";
import type {
	CodingAgentExtensionInitialization,
	CodingAgentExtensionSessionHost,
} from "../../host/extensions/contracts.js";
import type {
	CodingAgentTurnExecutor,
	CodingAgentTurnRetryController,
	CodingAgentTurnRetryEvent,
	CodingAgentTurnRetrySettings,
} from "../../host/session-execution/contracts.js";
import { createCodingAgentTurnExecutor } from "../../host/session-execution/turn-executor.js";
import { createCodingAgentTurnRetryController } from "../../host/session-execution/turn-retry-controller.js";
import type { CodingAgentRuntimeComposition } from "../contracts/index.js";
import type { CodingAgentActiveSessionHost } from "./active-session-transition-host.js";

export interface CodingAgentProcessSessionHostOptions {
	readonly runtime: CodingAgentRuntimeComposition;
	readonly activeSessionHost: CodingAgentActiveSessionHost;
	readonly extensionSessionHost: CodingAgentExtensionSessionHost;
	readonly mcpSource: ManagedMcpRuntimeToolSource;
	readonly readRetrySettings: () => CodingAgentTurnRetrySettings;
	readonly setRetryEnabled: (enabled: boolean) => void;
}

/** Runtime、活动 Session、Extension、MCP、Turn 与最终清理的进程宿主。 */
export class CodingAgentProcessSessionHost {
	readonly runtime: CodingAgentRuntimeComposition;
	readonly retryController: CodingAgentTurnRetryController;
	readonly turnExecutor: CodingAgentTurnExecutor;
	private readonly retryListeners = new Set<(event: CodingAgentTurnRetryEvent) => void>();
	private readonly cleanup = new RetryableCleanup();

	constructor(private readonly options: CodingAgentProcessSessionHostOptions) {
		this.runtime = options.runtime;
		this.retryController = createCodingAgentTurnRetryController({
			readSettings: options.readRetrySettings,
			setEnabled: options.setRetryEnabled,
			emit: (event) => {
				for (const listener of this.retryListeners) listener(event);
			},
		});
		this.turnExecutor = createCodingAgentTurnExecutor({
			sessionHost: options.activeSessionHost,
			retryController: this.retryController,
			commandHost: options.extensionSessionHost,
		});
		this.cleanup.add({
			id: "retry-controller",
			phase: 0,
			cleanup: () => this.retryController.abortRetry(),
		});
		this.cleanup.add({
			id: "extension-session-host",
			phase: 0,
			cleanup: () => options.extensionSessionHost.dispose(),
		});
		this.cleanup.add({
			id: "active-session-host",
			phase: 1,
			cleanup: () => options.activeSessionHost.dispose(),
		});
		this.cleanup.add({ id: "runtime", phase: 2, cleanup: () => options.runtime.dispose() });
		this.cleanup.add({ id: "mcp-source", phase: 3, cleanup: () => options.mcpSource.dispose() });
	}

	readSession(): RuntimeSession {
		return this.options.activeSessionHost.readSession();
	}

	startActiveSessionOperation<T>(operation: (session: RuntimeSession) => Promise<T>): Promise<T> {
		return this.options.activeSessionHost.startActiveSessionOperation(operation);
	}

	subscribe(listener: (event: SessionEvent) => void): () => void {
		return this.options.activeSessionHost.subscribe(listener);
	}

	subscribeExecutionObservations(
		listener: (observation: RuntimeSessionExecutionObservation) => Promise<void> | void,
	): () => void {
		return this.options.activeSessionHost.subscribeExecutionObservations(listener);
	}

	subscribeRetryEvents(listener: (event: CodingAgentTurnRetryEvent) => void): () => void {
		this.retryListeners.add(listener);
		return () => this.retryListeners.delete(listener);
	}

	initializeExtensions(input: CodingAgentExtensionInitialization): Promise<void> {
		return this.options.extensionSessionHost.initialize(input);
	}

	shutdownExtensions(): Promise<void> {
		return this.options.extensionSessionHost.shutdown();
	}

	newSession(...args: Parameters<CodingAgentActiveSessionHost["newSession"]>) {
		return this.options.activeSessionHost.newSession(...args);
	}

	switchSession(...args: Parameters<CodingAgentActiveSessionHost["switchSession"]>) {
		return this.options.activeSessionHost.switchSession(...args);
	}

	fork(...args: Parameters<CodingAgentActiveSessionHost["fork"]>) {
		return this.options.activeSessionHost.fork(...args);
	}

	async dispose(): Promise<void> {
		this.retryListeners.clear();
		await this.cleanup.run("Failed to dispose Coding Agent Process Session Host");
	}
}
