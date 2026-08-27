import type { CodingAgentRuntimeComposition, CodingAgentRuntimeSessionOptions } from "@vetta/coding-agent/composition";
import {
	type CodingAgentRuntimeExtensionInitialization,
	type CodingAgentRuntimeExtensionSessionHost,
	type CodingAgentTurnExecutor,
	type CodingAgentTurnRetryController,
	type CodingAgentTurnRetryEvent,
	type CodingAgentTurnRetrySettings,
	createCodingAgentTurnExecutor,
	createCodingAgentTurnRetryController,
} from "@vetta/coding-agent/runtime";
import {
	RetryableCleanup,
	type RuntimeActiveSessionHost,
	type RuntimeHost,
	type RuntimeHostSession,
	type RuntimeSessionExecutionObservation,
	type SessionEvent,
} from "@vetta/runtime-core";
import type { ManagedMcpRuntimeToolSource } from "@vetta/runtime-mcp";

export interface CliCodingAgentProcessSessionHostOptions {
	readonly runtime: CodingAgentRuntimeComposition;
	readonly runtimeHost: RuntimeHost;
	readonly activeSessionHost: RuntimeActiveSessionHost<CodingAgentRuntimeSessionOptions, RuntimeHostSession>;
	readonly extensionSessionHost: CodingAgentRuntimeExtensionSessionHost;
	readonly mcpSource: ManagedMcpRuntimeToolSource;
	readonly readRetrySettings: () => CodingAgentTurnRetrySettings;
	readonly setRetryEnabled: (enabled: boolean) => void;
}

/** Owns the CLI process-level Coding Agent session graph and its cleanup order. */
export class CliCodingAgentProcessSessionHost {
	readonly runtime: CodingAgentRuntimeComposition;
	readonly retryController: CodingAgentTurnRetryController;
	readonly turnExecutor: CodingAgentTurnExecutor;
	private readonly retryListeners = new Set<(event: CodingAgentTurnRetryEvent) => void>();
	private readonly cleanup = new RetryableCleanup();

	constructor(private readonly options: CliCodingAgentProcessSessionHostOptions) {
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
		this.cleanup.add({ id: "retry-controller", phase: 0, cleanup: () => this.retryController.abortRetry() });
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
		this.cleanup.add({ id: "runtime-host", phase: 2, cleanup: () => options.runtimeHost.close() });
		this.cleanup.add({ id: "runtime", phase: 3, cleanup: () => options.runtime.dispose() });
		this.cleanup.add({ id: "mcp-source", phase: 4, cleanup: () => options.mcpSource.dispose() });
	}

	readSession(): RuntimeHostSession {
		return this.options.activeSessionHost.readSession();
	}

	startActiveSessionOperation<T>(operation: (session: RuntimeHostSession) => Promise<T>): Promise<T> {
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

	initializeExtensions(input: CodingAgentRuntimeExtensionInitialization): Promise<void> {
		return this.options.extensionSessionHost.initialize(input);
	}

	shutdownExtensions(): Promise<void> {
		return this.options.extensionSessionHost.shutdown();
	}

	newSession(...args: Parameters<CliCodingAgentProcessSessionHostOptions["activeSessionHost"]["newSession"]>) {
		return this.options.activeSessionHost.newSession(...args);
	}

	switchSession(...args: Parameters<CliCodingAgentProcessSessionHostOptions["activeSessionHost"]["switchSession"]>) {
		return this.options.activeSessionHost.switchSession(...args);
	}

	fork(...args: Parameters<CliCodingAgentProcessSessionHostOptions["activeSessionHost"]["fork"]>) {
		return this.options.activeSessionHost.fork(...args);
	}

	async dispose(): Promise<void> {
		this.retryListeners.clear();
		await this.cleanup.run("Failed to dispose CLI Coding Agent Process Session Host");
	}
}
