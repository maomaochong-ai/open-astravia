import { basename, dirname } from "node:path";
import { type GreenfieldRuntimeSession, RetryableCleanup } from "@vetta/runtime-core";
import { createCodingAgentExtensionSessionView } from "../../adapters/extensions/runtime-session-view-adapter.js";
import { CodingAgentExtensionObservationAdapter } from "../../adapters/runtime-core/extension-observation-adapter.js";
import type { Extension, ExtensionError, ExtensionExecutionHost, ExtensionRuntime } from "../../extensions/index.js";
import { ExtensionRunner } from "../../extensions/index.js";
import type { CodingAgentModelRuntime } from "../../models/index.js";
import type { ResourceExtensionPaths, SessionResourceRuntime } from "../../resources/index.js";
import type { CodingAgentExtensionEventBinding } from "../../runtime-contracts/index.js";
import { CodingAgentExtensionActionHost } from "./action-host.js";
import type { CodingAgentExtensionEventHost, CodingAgentExtensionInitialization } from "./contracts.js";

export interface CodingAgentExtensionEventHostOptions {
	readonly extensions: readonly Extension[];
	readonly runtime: ExtensionRuntime;
	readonly cwd: string;
	readonly session: GreenfieldRuntimeSession;
	readonly modelRegistry: CodingAgentModelRuntime;
	readonly resourceLoader: Pick<SessionResourceRuntime, "extendResources" | "getPrompts" | "getSkills">;
	readonly bindEvents: (
		runner: ExtensionRunner,
		options?: { readonly replaceExisting?: boolean },
	) => CodingAgentExtensionEventBinding;
	readonly onError?: (error: ExtensionError) => void;
}

class DefaultCodingAgentExtensionEventHost implements CodingAgentExtensionEventHost {
	readonly runner: ExtensionRunner;
	private readonly actionHost: CodingAgentExtensionActionHost;
	private eventBinding: CodingAgentExtensionEventBinding;
	private readonly removeExecutionObservationListener: () => void;
	private removeErrorListener: (() => void) | undefined;
	private shutdownHandler: () => void = () => {};
	private errorListener: ((error: ExtensionError) => void) | undefined;
	private initialized = false;
	private shutdownEmitted = false;
	private disposed = false;
	private readonly cleanup = new RetryableCleanup();
	private cleanupPrepared = false;

	constructor(private readonly options: CodingAgentExtensionEventHostOptions) {
		const assembly = options.session.createCoreAssembly();
		const contextController = assembly.contextController;
		if (!contextController) throw new Error("Greenfield Extension events require a Runtime context controller");

		this.actionHost = new CodingAgentExtensionActionHost({
			session: options.session,
			resourceLoader: options.resourceLoader,
			onModelSelect: (event) => this.runner.emit(event),
			onError: (error) => this.reportError(error),
		});
		this.runner = new ExtensionRunner(
			[...options.extensions],
			options.runtime,
			options.cwd,
			createCodingAgentExtensionSessionView(assembly),
			options.modelRegistry,
		);
		this.eventBinding = options.bindEvents(this.runner);
		const observationAdapter = new CodingAgentExtensionObservationAdapter(async (event) => {
			await this.runner.emit(event);
		});
		this.removeExecutionObservationListener = assembly.executionObservationStream.subscribe(async (observation) => {
			try {
				await observationAdapter.observe(observation);
			} catch (error) {
				this.reportRuntimeError("execution_observation", error);
			}
		});
		const executionHost: ExtensionExecutionHost = {
			actions: this.actionHost.actions,
			contextActions: {
				getModel: () => options.session.readState().model,
				isIdle: () => !options.session.readState().isStreaming,
				abort: () => {
					void options.session.abort().catch((error: unknown) => {
						this.reportRuntimeError("abort", error);
					});
				},
				hasPendingMessages: () => assembly.queueView.readPendingMessageCount() > 0,
				shutdown: () => this.shutdownHandler(),
				getContextUsage: () => assembly.contextUsageView.readContextUsage(),
				compact: (compactOptions) => {
					void contextController.compact({ customInstructions: compactOptions?.customInstructions }).then(
						(result) => compactOptions?.onComplete?.(result),
						(error: unknown) =>
							compactOptions?.onError?.(error instanceof Error ? error : new Error(String(error))),
					);
				},
				getSystemPrompt: () => this.eventBinding.readSystemPrompt(),
			},
		};
		this.runner.bindExecutionHost(executionHost);
		this.removeErrorListener = this.runner.onError((error) => this.reportError(error));
	}

	async initialize(
		input: CodingAgentExtensionInitialization = {},
		lifecycle: { readonly emitSessionStart?: boolean } = {},
	): Promise<void> {
		if (input.uiContext) this.runner.setUIContext(input.uiContext);
		if (input.shutdownHandler) this.shutdownHandler = input.shutdownHandler;
		if (input.onError) this.errorListener = input.onError;
		if (this.initialized) return;
		this.initialized = true;
		if (lifecycle.emitSessionStart !== false) await this.runner.emit({ type: "session_start" });
	}

	async shutdown(): Promise<void> {
		if (!this.initialized || this.shutdownEmitted) return;
		this.shutdownEmitted = true;
		await this.runner.emit({ type: "session_shutdown" });
	}

	async discoverResources(reason: "startup" | "reload"): Promise<void> {
		if (!this.runner.hasHandlers("resources_discover")) return;
		const discovered = await this.runner.emitResourcesDiscover(this.options.cwd, reason);
		if (
			discovered.skillPaths.length === 0 &&
			discovered.promptPaths.length === 0 &&
			discovered.themePaths.length === 0
		) {
			return;
		}
		const extensionPaths: ResourceExtensionPaths = {
			skillPaths: buildExtensionResourcePaths(discovered.skillPaths),
			promptPaths: buildExtensionResourcePaths(discovered.promptPaths),
			themePaths: buildExtensionResourcePaths(discovered.themePaths),
		};
		this.options.resourceLoader.extendResources(extensionPaths);
	}

	readSystemPrompt(): string {
		return this.eventBinding.readSystemPrompt();
	}

	rebindRuntimeActions(): void {
		if (this.disposed) throw new Error("Greenfield Extension event host is disposed");
		this.actionHost.bind(this.options.runtime);
	}

	rebindRuntimeBindings(): void {
		if (this.disposed) throw new Error("Greenfield Extension event host is disposed");
		this.actionHost.bind(this.options.runtime);
		this.eventBinding.dispose();
		this.eventBinding = this.options.bindEvents(this.runner, { replaceExisting: true });
	}

	async dispose(lifecycle: { readonly emitSessionShutdown?: boolean } = {}): Promise<void> {
		this.disposed = true;
		if (!this.cleanupPrepared) this.prepareCleanup(lifecycle.emitSessionShutdown !== false);
		await this.cleanup.run("Failed to dispose Greenfield Extension event host");
	}

	private prepareCleanup(emitSessionShutdown: boolean): void {
		this.cleanupPrepared = true;
		if (emitSessionShutdown) {
			this.cleanup.add({ id: "session-shutdown", phase: 0, cleanup: () => this.shutdown() });
		}
		const removeErrorListener = this.removeErrorListener;
		if (removeErrorListener) {
			this.cleanup.add({
				id: "error-listener",
				phase: 1,
				cleanup: () => {
					removeErrorListener();
					if (this.removeErrorListener === removeErrorListener) this.removeErrorListener = undefined;
				},
			});
		}
		this.cleanup.add({
			id: "execution-observation-listener",
			phase: 1,
			cleanup: this.removeExecutionObservationListener,
		});
		const eventBinding = this.eventBinding;
		this.cleanup.add({ id: "event-binding", phase: 1, cleanup: () => eventBinding.dispose() });
		this.cleanup.add({ id: "action-host", phase: 1, cleanup: () => this.actionHost.dispose() });
	}

	private reportRuntimeError(event: string, error: unknown): void {
		this.reportError({
			extensionPath: "<runtime>",
			event,
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		});
	}

	private reportError(error: ExtensionError): void {
		this.errorListener?.(error);
		this.options.onError?.(error);
	}
}

export function createCodingAgentExtensionEventHost(
	options: CodingAgentExtensionEventHostOptions,
): CodingAgentExtensionEventHost {
	return new DefaultCodingAgentExtensionEventHost(options);
}

function buildExtensionResourcePaths(entries: Array<{ path: string; extensionPath: string }>) {
	return entries.map((entry) => ({
		path: entry.path,
		metadata: {
			source: extensionSourceLabel(entry.extensionPath),
			scope: "temporary" as const,
			origin: "top-level" as const,
			baseDir: entry.extensionPath.startsWith("<") ? undefined : dirname(entry.extensionPath),
		},
	}));
}

function extensionSourceLabel(extensionPath: string): string {
	if (extensionPath.startsWith("<")) return `extension:${extensionPath.replace(/[<>]/g, "")}`;
	return `extension:${basename(extensionPath).replace(/\.(ts|js)$/, "")}`;
}
