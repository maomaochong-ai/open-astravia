import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";

export interface McpRuntimeToolBinding {
	readonly tool: RuntimeToolDefinition;
	/** 标识该工具当前实现绑定；相同名称但绑定变化时必须替换 Registry entry。 */
	readonly fingerprint: string;
}

/** Source 每次刷新后发布的只读能力视图；它不是持久化或 Turn 级快照。 */
export interface McpRuntimeToolView {
	readonly tools: readonly McpRuntimeToolBinding[];
}

/**
 * MCP 宿主能力端口。
 *
 * 具体配置文件、连接、认证和重载策略属于 Source 实现，不进入 Runtime Feature。
 */
export interface McpRuntimeToolSource {
	refresh(): Promise<McpRuntimeToolView>;
}

export interface ManagedMcpRuntimeToolSource {
	readonly source: McpRuntimeToolSource;
	dispose(): Promise<void>;
}

export interface McpRuntimeToolRegistry {
	register(tool: RuntimeToolDefinition): void;
	unregister(toolName: string): boolean;
}

export interface McpRuntimeToolDescriptor {
	readonly name: string;
	readonly description: string;
}

export interface McpRuntimeToolSnapshot {
	readonly revision: number;
	readonly tools: readonly McpRuntimeToolDescriptor[];
}

/**
 * 在每次模型调用前把 MCP Source 的当前工具集合增量同步到 Runtime registry。
 *
 * 未变化的工具保留原 binding；重连、配置变化、禁用和删除只替换受影响工具。
 */
export class McpRuntimeToolSynchronizer {
	private readonly fingerprints = new Map<string, string>();
	private currentView: McpRuntimeToolView = Object.freeze({ tools: Object.freeze([]) });
	private currentSnapshot: McpRuntimeToolSnapshot = Object.freeze({
		revision: 0,
		tools: Object.freeze([]),
	});
	private pendingRefresh: Promise<McpRuntimeToolSnapshot> | undefined;

	constructor(
		private readonly source: McpRuntimeToolSource,
		private readonly registry: McpRuntimeToolRegistry,
	) {}

	async refresh(): Promise<McpRuntimeToolSnapshot> {
		if (this.pendingRefresh) return this.pendingRefresh;
		const refresh = this.refreshNow();
		this.pendingRefresh = refresh;
		try {
			return await refresh;
		} finally {
			if (this.pendingRefresh === refresh) this.pendingRefresh = undefined;
		}
	}

	snapshot(): McpRuntimeToolSnapshot {
		return this.currentSnapshot;
	}

	/** 当前已同步的 Tool Binding 视图；调用方不获得 Source 或连接的生命周期所有权。 */
	view(): McpRuntimeToolView {
		return this.currentView;
	}

	dispose(): void {
		for (const toolName of this.fingerprints.keys()) {
			this.registry.unregister(toolName);
		}
		this.fingerprints.clear();
		this.currentSnapshot = Object.freeze({
			revision: this.currentSnapshot.revision + 1,
			tools: Object.freeze([]),
		});
		this.currentView = Object.freeze({ tools: Object.freeze([]) });
	}

	private async refreshNow(): Promise<McpRuntimeToolSnapshot> {
		const view = await this.source.refresh();
		const nextNames = new Set(view.tools.map(({ tool }) => tool.name));

		for (const toolName of this.fingerprints.keys()) {
			if (nextNames.has(toolName)) continue;
			this.registry.unregister(toolName);
			this.fingerprints.delete(toolName);
		}

		for (const binding of view.tools) {
			const toolName = binding.tool.name;
			if (this.fingerprints.get(toolName) === binding.fingerprint) continue;
			if (this.fingerprints.has(toolName)) this.registry.unregister(toolName);
			this.registry.register(binding.tool);
			this.fingerprints.set(toolName, binding.fingerprint);
		}
		this.currentView = Object.freeze({ tools: Object.freeze([...view.tools]) });

		const descriptors = view.tools.map(({ tool }) =>
			Object.freeze({
				name: tool.name,
				description: tool.description,
			}),
		);
		if (!sameDescriptors(this.currentSnapshot.tools, descriptors)) {
			this.currentSnapshot = Object.freeze({
				revision: this.currentSnapshot.revision + 1,
				tools: Object.freeze(descriptors),
			});
		}
		return this.currentSnapshot;
	}
}

export function createMcpRuntimeToolSynchronizer(
	source: McpRuntimeToolSource,
	registry: McpRuntimeToolRegistry,
): McpRuntimeToolSynchronizer {
	return new McpRuntimeToolSynchronizer(source, registry);
}

function sameDescriptors(
	current: readonly McpRuntimeToolDescriptor[],
	next: readonly McpRuntimeToolDescriptor[],
): boolean {
	return (
		current.length === next.length &&
		current.every((tool, index) => tool.name === next[index]?.name && tool.description === next[index]?.description)
	);
}
