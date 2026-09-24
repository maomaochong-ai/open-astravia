import { resolve } from "node:path";
import type {
	ManagedMcpRuntimeToolSource,
	McpRuntimeToolBinding,
	McpRuntimeToolSource,
	McpRuntimeToolView,
} from "@vetta/runtime-mcp";

export interface DesktopMcpResourceManagerScope {
	readonly cwd: string;
	readonly agentDir: string;
}

export interface DesktopMcpResourceManagerOptions {
	readonly createApplicationSource: (agentDir: string) => Promise<ManagedMcpRuntimeToolSource>;
	readonly createWorkspaceSource: (scope: DesktopMcpResourceManagerScope) => Promise<ManagedMcpRuntimeToolSource>;
	readonly resolveApplicationRevision?: (agentDir: string) => string;
}

/** Owns application MCP connections while compositions continue to own workspace connections. */
export class DesktopMcpResourceManager {
	private readonly applicationSources = new Map<string, Promise<ManagedMcpRuntimeToolSource>>();
	private disposePromise: Promise<void> | undefined;
	private disposed = false;

	constructor(private readonly options: DesktopMcpResourceManagerOptions) {}

	async prewarmApplication(agentDir: string): Promise<void> {
		await this.getOrCreateApplicationSource(agentDir);
	}

	async acquire(scope: DesktopMcpResourceManagerScope): Promise<ManagedMcpRuntimeToolSource> {
		this.assertActive();
		const applicationPromise = this.getOrCreateApplicationSource(scope.agentDir);
		const workspacePromise = this.options.createWorkspaceSource(scope);
		let workspace: ManagedMcpRuntimeToolSource;
		try {
			const sources = await Promise.all([applicationPromise, workspacePromise]);
			workspace = sources[1];
			return createCombinedManagedSource(sources[0].source, workspace);
		} catch (error) {
			const createdWorkspace = await workspacePromise.catch(() => undefined);
			await createdWorkspace?.dispose().catch(() => undefined);
			throw error;
		}
	}

	dispose(): Promise<void> {
		this.disposed = true;
		if (this.disposePromise) return this.disposePromise;
		const operation = this.disposeApplicationSources().finally(() => {
			if (this.disposePromise === operation) this.disposePromise = undefined;
		});
		this.disposePromise = operation;
		return operation;
	}

	private getOrCreateApplicationSource(agentDir: string): Promise<ManagedMcpRuntimeToolSource> {
		this.assertActive();
		const normalizedAgentDir = resolve(agentDir);
		const revision = this.options.resolveApplicationRevision?.(normalizedAgentDir) ?? "default";
		const key = `${normalizedAgentDir}\u0000${revision}`;
		const existing = this.applicationSources.get(key);
		if (existing) return existing;
		const created = this.options.createApplicationSource(normalizedAgentDir).catch((error: unknown) => {
			this.applicationSources.delete(key);
			throw error;
		});
		this.applicationSources.set(key, created);
		return created;
	}

	private async disposeApplicationSources(): Promise<void> {
		const failures: unknown[] = [];
		for (const [key, pending] of this.applicationSources) {
			try {
				const source = await pending;
				await source.dispose();
				this.applicationSources.delete(key);
			} catch (error) {
				failures.push(error);
			}
		}
		if (failures.length > 0) throw new AggregateError(failures, "Desktop MCP resource disposal failed");
	}

	private assertActive(): void {
		if (this.disposed) throw new Error("Desktop MCP resource manager is disposed");
	}
}

function createCombinedManagedSource(
	application: McpRuntimeToolSource,
	workspace: ManagedMcpRuntimeToolSource,
): ManagedMcpRuntimeToolSource {
	let disposed = false;
	return {
		source: new CombinedMcpRuntimeToolSource([application, workspace.source]),
		async dispose() {
			if (disposed) return;
			await workspace.dispose();
			disposed = true;
		},
	};
}

class CombinedMcpRuntimeToolSource implements McpRuntimeToolSource {
	constructor(private readonly sources: readonly McpRuntimeToolSource[]) {}

	async refresh(): Promise<McpRuntimeToolView> {
		const views = await Promise.all(this.sources.map((source) => source.refresh()));
		const tools = new Map<string, McpRuntimeToolBinding>();
		for (const view of views) {
			for (const binding of view.tools) tools.set(binding.tool.name, binding);
		}
		return Object.freeze({ tools: Object.freeze([...tools.values()]) });
	}
}
