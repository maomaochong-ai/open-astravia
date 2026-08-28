import type { PluginManifest, PluginPermission } from "@vetta-org/plugin-sdk/manifest";
import { describe, expect, it } from "vitest";
import {
	assertPluginPermissionContract,
	findPluginPermissionContractViolations,
} from "../src/permission-contract.js";

function manifest(permissions: readonly PluginPermission[] = [], agent?: PluginManifest["agent"]): PluginManifest {
	return {
		id: "permission-contract-test",
		name: "Permission contract test",
		version: "0.1.0",
		pluginApiVersion: "^1.0.0",
		entry: "dist/mf-manifest.json",
		moduleFederation: { remoteName: "permission_contract_test", expose: "./plugin" },
		permissions: [...permissions],
		styles: [],
		commands: undefined,
		agent,
		defaultLocale: "zh",
	};
}

describe("plugin permission contract", () => {
	it("rejects runtime tool effects when agent.tools.control is missing", () => {
		const chunks = [
			{
				fileName: "assets/index.js",
				code: 'return [{type:"setToolEnabled",toolName:"demo",enabled:false}]',
			},
		];
		expect(findPluginPermissionContractViolations(manifest(), chunks)).toEqual([
			{
				capability: "dynamic runtime tool availability",
				fileName: "assets/index.js",
				missingPermissions: ["agent.tools.control"],
			},
		]);
		expect(() => assertPluginPermissionContract(manifest(), chunks)).toThrow(
			'Plugin "permission-contract-test" permission contract failed',
		);
		expect(() => assertPluginPermissionContract(manifest(["agent.tools.control"]), chunks)).not.toThrow();
	});

	it("checks Agent registrations and action helpers", () => {
		const chunks = [
			{
				fileName: "index.js",
				code: [
					"ctx.agent.registerSystemPromptProvider({});",
					"ctx.agent.registerTool({});",
					"ctx.agent.registerHook({});",
					"actions.continuation.request({ text: 'continue' });",
				].join("\n"),
			},
		];
		expect(findPluginPermissionContractViolations(manifest(), chunks)).toEqual([
			expect.objectContaining({ missingPermissions: ["agent.systemPrompt.write"] }),
			expect.objectContaining({ missingPermissions: ["agent.continuation.register"] }),
			expect.objectContaining({
				missingPermissions: ["agent.tools.register", "agent.toolHandler.execute"],
			}),
			expect.objectContaining({
				missingPermissions: ["agent.hooks.register", "agent.hookHandler.execute"],
			}),
		]);
	});

	it("checks manifest-owned Agent resources", () => {
		const agent: PluginManifest["agent"] = {
			skillPaths: ["agent/skills/demo"],
			mcpServers: "mcp/servers.json",
			toolPolicy: { deny: ["write"] },
		};
		expect(findPluginPermissionContractViolations(manifest([], agent), [])).toEqual([
			expect.objectContaining({ missingPermissions: ["agent.tools.control"] }),
			expect.objectContaining({ missingPermissions: ["agent.skills.control"] }),
			expect.objectContaining({ missingPermissions: ["agent.mcp.control"] }),
		]);
	});

});
