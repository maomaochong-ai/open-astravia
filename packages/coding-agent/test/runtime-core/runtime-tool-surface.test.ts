import type { ModelCallContributionContext, RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { McpRuntimeToolBinding, McpRuntimeToolView } from "@vetta/runtime-mcp";
import { describe, expect, it } from "vitest";
import { CodingAgentCompositionResourceRegistry } from "../../src/composition/session-lifecycle/resource-registry.js";
import { createCodingAgentRuntimeToolSurface } from "../../src/composition/tool-surface/runtime-tool-surface.js";

describe("Coding Agent Runtime Tool Surface", () => {
	it("synchronizes dynamic MCP tools with the shared Registry and disposes them", async () => {
		const alpha = tool("mcp_alpha");
		const beta = tool("mcp_beta");
		let currentView = runtimeView(binding(alpha, "alpha"));
		const resources = new CodingAgentCompositionResourceRegistry();
		const surface = await createCodingAgentRuntimeToolSurface({
			cwd: process.cwd(),
			scenario: "cli",
			knowledgeEnabled: false,
			inheritedMcpView: runtimeView(),
			mcpSource: { refresh: async () => currentView },
			indexes: resources.indexes,
		});

		expect(readRegistryToolNames(surface.tools.registry.snapshot().entries)).toContain("mcp_alpha");
		const activation = surface.resolveActivation(modelCallContext());
		expect(activation.mode).toBe("scope");
		expect(activation.mode === "scope" ? activation.capabilities?.has("bg-tasks") : false).toBe(true);

		currentView = runtimeView(binding(beta, "beta"));
		await surface.mcpCoordinator.refreshSession("session", false);
		expect(readRegistryToolNames(surface.tools.registry.snapshot().entries)).not.toContain("mcp_alpha");
		expect(readRegistryToolNames(surface.tools.registry.snapshot().entries)).toContain("mcp_beta");

		surface.mcpCoordinator.dispose();
		expect(readRegistryToolNames(surface.tools.registry.snapshot().entries)).not.toContain("mcp_beta");
		surface.tools.dispose();
	});
});

function tool(name: string): RuntimeToolDefinition {
	return {
		name,
		label: name,
		description: name,
		inputSchema: { type: "object" },
		execute: async () => ({ content: [{ type: "text", text: name }] }),
	};
}

function binding(toolDefinition: RuntimeToolDefinition, fingerprint: string): McpRuntimeToolBinding {
	return { tool: toolDefinition, fingerprint };
}

function runtimeView(...tools: readonly McpRuntimeToolBinding[]): McpRuntimeToolView {
	return { tools };
}

function modelCallContext(): ModelCallContributionContext {
	return {
		sessionId: "session",
		turnId: "turn",
		signal: new AbortController().signal,
	};
}

function readRegistryToolNames(
	entries: readonly { readonly registration: { readonly tool: RuntimeToolDefinition } }[],
): string[] {
	return entries.map(({ registration }) => registration.tool.name);
}
