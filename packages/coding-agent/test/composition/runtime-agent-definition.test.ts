import { RuntimeAgentRuntime, type RuntimeAgentSessionDefinition } from "@vetta/runtime-core";
import {
	type AgentFeatureDefinition,
	PassthroughContextStrategy,
	type RuntimeCapabilityDefinition,
} from "@vetta/runtime-core/kernel";
import { describe, expect, it } from "vitest";
import {
	createCodingAgentRuntimeDefinition,
	DEFAULT_CODING_AGENT_RUNTIME_ID,
} from "../../src/composition/runtime-agent-definition.js";

describe("Coding Agent Runtime Definition", () => {
	it("resolves product Profile to instructions while Tool, MCP and revision isolation use the common base", async () => {
		const disposed: string[] = [];
		const host = new RuntimeAgentRuntime();
		host.registry.upsert({
			source: { id: "product", revision: "1" },
			definition: codingDefinition("v1", disposed),
		});
		const oldInstance = await host.createInstance({
			agentId: DEFAULT_CODING_AGENT_RUNTIME_ID,
			instanceId: "old-instance",
			configuration: { tenant: "alpha" },
		});
		const oldSession = await oldInstance.createSession({
			sessionId: "old-session",
			configuration: { prompt: "product-profile-v1" },
		});

		host.registry.upsert({
			source: { id: "product", revision: "2" },
			definition: codingDefinition("v2", disposed),
		});
		const pinnedSession = await oldInstance.createSession({
			sessionId: "pinned-session",
			configuration: { prompt: "product-profile-pinned" },
		});
		const newInstance = await host.createInstance({
			agentId: DEFAULT_CODING_AGENT_RUNTIME_ID,
			instanceId: "new-instance",
			configuration: { tenant: "beta" },
		});
		const newSession = await newInstance.createSession({
			sessionId: "new-session",
			configuration: { prompt: "product-profile-v2" },
		});

		const oldLease = await oldSession.acquire(turn("old-session"));
		const pinnedLease = await pinnedSession.acquire(turn("pinned-session"));
		const newLease = await newSession.acquire(turn("new-session"));
		expect(oldLease.snapshot.instructions.map(({ content }) => content)).toEqual([
			"product-profile-v1",
			"base-v1-alpha",
		]);
		expect(pinnedLease.snapshot.instructions.map(({ content }) => content)).toEqual([
			"product-profile-pinned",
			"base-v1-alpha",
		]);
		expect(newLease.snapshot.instructions.map(({ content }) => content)).toEqual([
			"product-profile-v2",
			"base-v2-beta",
		]);
		expect([...newLease.snapshot.tools.keys()].sort()).toEqual(["mcp_v2", "tool_v2"]);
		expect("profile" in newLease.snapshot).toBe(false);
		expect("profileId" in newLease.snapshot).toBe(false);

		await oldLease.release();
		await pinnedLease.release();
		await newLease.release();
		await host.close();
		expect(disposed).toEqual(
			expect.arrayContaining([
				"session:v1:dispose",
				"session:v2:dispose",
				"instance:v1:dispose",
				"instance:v2:dispose",
				"definition:v1:dispose",
				"definition:v2:dispose",
			]),
		);
	});

	it("rejects untrusted configuration at the product boundary before assembling resources", async () => {
		let createCount = 0;
		const definition = createCodingAgentRuntimeDefinition({
			parseInstanceConfiguration: requiredString("tenant"),
			parseSessionConfiguration: requiredString("prompt"),
			createInstance: () => {
				createCount += 1;
				return { prepareSession: () => sessionDefinition("safe", "tenant", []) };
			},
		});
		const host = new RuntimeAgentRuntime();
		host.registry.upsert({ source: { id: "product", revision: "1" }, definition });

		await expect(host.createInstance({ agentId: definition.id, configuration: { wrong: true } })).rejects.toThrow(
			"tenant",
		);
		expect(createCount).toBe(0);
		await host.close();
	});
});

function codingDefinition(version: string, disposed: string[]) {
	return createCodingAgentRuntimeDefinition({
		parseInstanceConfiguration: requiredString("tenant"),
		parseSessionConfiguration: requiredString("prompt"),
		createInstance: ({ configuration: tenant, observationPublisher }) => ({
			resolvePromptProfile: ({ configuration: prompt }) => ({
				instructions: [{ id: "coding.profile", content: prompt, priority: 0 }],
			}),
			prepareSession: () => sessionDefinition(version, tenant, disposed, observationPublisher),
			dispose: () => {
				disposed.push(`instance:${version}:dispose`);
			},
		}),
		dispose: () => {
			disposed.push(`definition:${version}:dispose`);
		},
	});
}

function sessionDefinition(
	version: string,
	tenant: string,
	disposed: string[],
	observationPublisher?: RuntimeCapabilityDefinition["observationPublisher"],
): RuntimeAgentSessionDefinition {
	const tools: AgentFeatureDefinition = {
		id: `tools-${version}`,
		prepare: async () => ({
			contribute: async () => ({
				tools: [tool(`tool_${version}`), tool(`mcp_${version}`)],
			}),
			dispose: async () => {},
		}),
	};
	return {
		capabilities: {
			instructions: [{ id: "coding.base", content: `base-${version}-${tenant}`, priority: 100 }],
			features: [tools],
			contextStrategy: new PassthroughContextStrategy(),
			toolPolicy: { authorize: async () => true },
			tokenBudget: 8_000,
			reservedOutputTokens: 1_000,
			observationPublisher,
		},
		dispose: () => {
			disposed.push(`session:${version}:dispose`);
		},
	};
}

function tool(name: string) {
	return {
		name,
		label: name,
		description: name,
		inputSchema: { type: "object" },
		execute: async () => ({ content: [] }),
	};
}

function requiredString(field: string): (value: unknown) => string {
	return (value) => {
		if (!value || typeof value !== "object") {
			throw new Error(`Coding Agent configuration requires ${field}`);
		}
		const record = value as Record<string, unknown>;
		if (typeof record[field] !== "string") {
			throw new Error(`Coding Agent configuration requires ${field}`);
		}
		return record[field];
	};
}

function turn(sessionId: string) {
	return {
		sessionId,
		operationId: `turn-${sessionId}`,
		reason: "turn" as const,
		signal: new AbortController().signal,
	};
}
