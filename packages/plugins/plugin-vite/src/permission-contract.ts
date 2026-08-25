import type { PluginManifest, PluginPermission } from "@vetta-org/plugin-sdk/manifest";

export interface PluginRuntimeChunk {
	fileName: string;
	code: string;
}

export interface PluginPermissionContractViolation {
	capability: string;
	fileName: string;
	missingPermissions: PluginPermission[];
}

interface BundleCapabilityRule {
	capability: string;
	permissions: readonly PluginPermission[];
	patterns: readonly RegExp[];
}

const BUNDLE_CAPABILITY_RULES: readonly BundleCapabilityRule[] = [
	{
		capability: "dynamic system prompt provider registration",
		permissions: ["agent.systemPrompt.write"],
		patterns: [/(?:\.|\[\s*["'])registerSystemPromptProvider(?:["']\s*\])?\s*\(/u],
	},
	{
		capability: "dynamic runtime tool availability",
		permissions: ["agent.tools.control"],
		patterns: [
			/(?:\btype|["']type["'])\s*:\s*["']setToolEnabled["']/u,
			/(?:\.tools|\[\s*["']tools["']\s*\])(?:\.(?:setEnabled|enable|disable)|\[\s*["'](?:setEnabled|enable|disable)["']\s*\])\s*\(/u,
		],
	},
	{
		capability: "Agent continuation",
		permissions: ["agent.continuation.register"],
		patterns: [
			/(?:\.|\[\s*["'])registerContinuationProvider(?:["']\s*\])?\s*\(/u,
			/(?:\btype|["']type["'])\s*:\s*["']requestContinuation["']/u,
			/(?:\.continuation|\[\s*["']continuation["']\s*\])(?:\.request|\[\s*["']request["']\s*\])\s*\(/u,
		],
	},
	{
		capability: "Agent tool registration",
		permissions: ["agent.tools.register", "agent.toolHandler.execute"],
		patterns: [/(?:\.|\[\s*["'])registerTool(?:["']\s*\])?\s*\(/u],
	},
	{
		capability: "Agent hook registration",
		permissions: ["agent.hooks.register", "agent.hookHandler.execute"],
		patterns: [/(?:\.|\[\s*["'])registerHook(?:["']\s*\])?\s*\(/u],
	},
];

function missingPermissions(
	manifest: PluginManifest,
	required: readonly PluginPermission[],
): PluginPermission[] {
	const declared = new Set(manifest.permissions ?? []);
	return required.filter((permission) => !declared.has(permission));
}

export function findPluginPermissionContractViolations(
	manifest: PluginManifest,
	chunks: readonly PluginRuntimeChunk[],
): PluginPermissionContractViolation[] {
	const violations: PluginPermissionContractViolation[] = [];
	for (const rule of BUNDLE_CAPABILITY_RULES) {
		const chunk = chunks.find((candidate) => rule.patterns.some((pattern) => pattern.test(candidate.code)));
		if (!chunk) continue;
		const missing = missingPermissions(manifest, rule.permissions);
		if (missing.length === 0) continue;
		violations.push({
			capability: rule.capability,
			fileName: chunk.fileName,
			missingPermissions: missing,
		});
	}

	const manifestRequirements: Array<{
		active: boolean;
		capability: string;
		permission: PluginPermission;
	}> = [
		{
			active: manifest.agent?.toolPolicy !== undefined,
			capability: "plugin.json#agent.toolPolicy",
			permission: "agent.tools.control",
		},
		{
			active: (manifest.agent?.skillPaths?.length ?? 0) > 0,
			capability: "plugin.json#agent.skillPaths",
			permission: "agent.skills.control",
		},
		{
			active: manifest.agent?.mcpServers !== undefined,
			capability: "plugin.json#agent.mcpServers",
			permission: "agent.mcp.control",
		},
	];
	for (const requirement of manifestRequirements) {
		if (!requirement.active) continue;
		const missing = missingPermissions(manifest, [requirement.permission]);
		if (missing.length === 0) continue;
		violations.push({
			capability: requirement.capability,
			fileName: "plugin.json",
			missingPermissions: missing,
		});
	}
	return violations;
}

export function assertPluginPermissionContract(
	manifest: PluginManifest,
	chunks: readonly PluginRuntimeChunk[],
): void {
	const violations = findPluginPermissionContractViolations(manifest, chunks);
	if (violations.length === 0) return;
	const details = violations.map(
		(violation) =>
			`- ${violation.capability} in ${violation.fileName} requires ${violation.missingPermissions
				.map((permission) => JSON.stringify(permission))
				.join(" and ")}`,
	);
	throw new Error(`Plugin ${JSON.stringify(manifest.id)} permission contract failed:\n${details.join("\n")}`);
}
