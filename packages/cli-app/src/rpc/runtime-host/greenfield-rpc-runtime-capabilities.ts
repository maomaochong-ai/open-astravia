import type { CodingAgentHostBootstrap } from "@vetta/coding-agent/bootstrap";
import type { CodingAgentHtmlExportRuntime } from "@vetta/coding-agent/export-html";
import { createHostBashExecutor } from "@vetta/coding-agent/host-services";
import {
	GREENFIELD_FULL_RPC_PROFILE,
	GreenfieldRpcBashCapability,
	type RpcSessionCapabilities,
} from "@vetta/coding-agent/rpc";
import { InitializationRollbackScope, RetryableCleanup } from "@vetta/runtime-core";
import { GreenfieldImRpcSessionAdapter } from "../greenfield-im-rpc-session-adapter.js";
import { GreenfieldRpcSessionAdapter } from "../greenfield-rpc-session-adapter.js";
import {
	GREENFIELD_RUNTIME_HOST_STARTUP_FAILURE,
	type GreenfieldCliSessionAssembly,
} from "./greenfield-cli-session-assembly.js";

export interface CreateGreenfieldRpcRuntimeCapabilitiesOptions {
	readonly bootstrap: CodingAgentHostBootstrap;
	readonly assembly: GreenfieldCliSessionAssembly;
	readonly backend: "greenfield" | "greenfield-im";
	readonly htmlExporter?: CodingAgentHtmlExportRuntime;
}

export async function createGreenfieldRpcRuntimeCapabilities(
	options: CreateGreenfieldRpcRuntimeCapabilitiesOptions,
): Promise<RpcSessionCapabilities> {
	const { assembly, bootstrap } = options;
	const rollback = new InitializationRollbackScope();
	const dismissAssemblyRollback = rollback.defer({
		id: "cli-session-assembly",
		rollback: () => assembly.dispose(),
	});
	try {
		const bash = new GreenfieldRpcBashCapability({
			executor: createHostBashExecutor(),
			readContextDeliveryController: () =>
				assembly.sessionHost.readSession().createCoreAssembly().contextDeliveryController,
			readShellCommandPrefix: () => bootstrap.settingsManager.getShellCommandPrefix(),
		});
		const adapter =
			options.backend === "greenfield-im"
				? new GreenfieldImRpcSessionAdapter({
						sessionHost: assembly.sessionHost,
						runtime: assembly.runtime,
						resourceLoader: bootstrap.resourceLoader,
						htmlExporter: options.htmlExporter,
						extensionCommandHost: assembly.extensionSessionHost,
						disposeSessionResources: false,
					})
				: new GreenfieldRpcSessionAdapter({
						profile: GREENFIELD_FULL_RPC_PROFILE,
						sessionHost: assembly.sessionHost,
						runtime: assembly.runtime,
						resourceLoader: bootstrap.resourceLoader,
						htmlExporter: options.htmlExporter,
						retryController: assembly.sessionHost.retryController,
						turnExecutor: assembly.sessionHost.turnExecutor,
						disposeSessionResources: false,
						bash,
						readAvailableModels: async () =>
							(await bootstrap.modelRegistry.getAvailable()).map((model) => ({
								...model,
								remote: bootstrap.modelRegistry.isRemote(model),
							})),
						extensionCommandHost: assembly.extensionSessionHost,
					});
		const dismissAdapterRollback = rollback.defer({ id: "rpc-adapter", rollback: () => adapter.dispose() });
		const capabilities = new GreenfieldRpcRuntimeHostCapabilities(adapter, assembly);
		dismissAdapterRollback();
		dismissAssemblyRollback();
		rollback.commit();
		return capabilities;
	} catch (error) {
		return rollback.rollback(error, GREENFIELD_RUNTIME_HOST_STARTUP_FAILURE);
	}
}

class GreenfieldRpcRuntimeHostCapabilities implements RpcSessionCapabilities {
	readonly profile;
	readonly turn;
	readonly state;
	readonly model;
	readonly queue;
	readonly context;
	readonly memory;
	readonly retry;
	readonly bash;
	readonly session;
	readonly commands;
	private readonly cleanup = new RetryableCleanup();

	constructor(
		private readonly adapter: GreenfieldRpcSessionAdapter,
		private readonly assembly: GreenfieldCliSessionAssembly,
	) {
		this.profile = adapter.profile;
		this.turn = adapter.turn;
		this.state = adapter.state;
		this.model = adapter.model;
		this.queue = adapter.queue;
		this.context = adapter.context;
		this.memory = adapter.memory;
		this.retry = adapter.retry;
		this.bash = adapter.bash;
		this.session = adapter.session;
		this.commands = adapter.commands;
		this.cleanup.add({ id: "rpc-adapter", phase: 0, cleanup: () => this.adapter.dispose() });
		this.cleanup.add({ id: "cli-session-assembly", phase: 1, cleanup: () => this.assembly.dispose() });
	}

	async initialize(input: Parameters<RpcSessionCapabilities["initialize"]>[0]): Promise<void> {
		await this.assembly.sessionHost.initializeExtensions({
			uiContext: input.uiContext,
			shutdownHandler: input.onShutdownRequested,
			onError: input.onExtensionError,
		});
		await this.adapter.initialize(input);
	}

	subscribe(listener: (event: unknown) => void): () => void {
		const removeAdapter = this.adapter.subscribe(listener);
		const removeRetry = this.assembly.sessionHost.subscribeRetryEvents(listener);
		return () => {
			removeRetry();
			removeAdapter();
		};
	}

	async shutdown(): Promise<void> {
		await this.assembly.sessionHost.shutdownExtensions();
		await this.adapter.shutdown();
	}

	async dispose(): Promise<void> {
		try {
			await this.cleanup.run("Failed to dispose Greenfield IM Runtime host");
		} catch (error) {
			throw new AggregateError(
				error instanceof AggregateError ? error.errors : [error],
				"Failed to dispose Greenfield IM Runtime host",
			);
		}
	}
}
