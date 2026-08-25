import { describe, expect, it } from "vitest";
import {
	RUNTIME_AGENT_LIFECYCLE_OBSERVATION,
	type RuntimeAgentDefinition,
	RuntimeAgentHost,
} from "../../src/agents/index.js";
import { PassthroughContextStrategy } from "../../src/kernel/index.js";
import { createRuntimeObservationPublisher, type RuntimeObservationRecord } from "../../src/observation/index.js";

describe("Runtime Agent observation", () => {
	it("binds lifecycle identity and injects the scoped publisher into dynamic factories", async () => {
		const records: RuntimeObservationRecord[] = [];
		const factoryScopes: unknown[] = [];
		const definition: RuntimeAgentDefinition = {
			id: "custom-agent",
			createInstance(context) {
				factoryScopes.push(context.observationPublisher);
				return {
					createSession(sessionContext) {
						factoryScopes.push(sessionContext.observationPublisher);
						return {
							capabilities: {
								instructions: [{ id: "private", content: "secret-prompt", priority: 0 }],
								features: [],
								contextStrategy: new PassthroughContextStrategy(),
								toolPolicy: { authorize: async () => true },
								tokenBudget: 8_000,
								reservedOutputTokens: 1_000,
							},
						};
					},
				};
			},
		};
		const host = new RuntimeAgentHost({
			observationPort: {
				record: (record) => {
					records.push(record);
				},
			},
		});
		host.registry.upsert({ source: { id: "code", revision: "1" }, definition });
		const instance = await host.createInstance({
			agentId: definition.id,
			instanceId: "instance",
			configuration: { credential: "secret-instance-config" },
		});
		await instance.createSession({
			sessionId: "session",
			configuration: { token: "secret-session-config" },
		});
		await host.close();

		expect(factoryScopes).toHaveLength(2);
		expect(records.some(({ token }) => token === RUNTIME_AGENT_LIFECYCLE_OBSERVATION)).toBe(true);
		expect(
			records.some(
				({ context, payload }) =>
					context.agentId === "custom-agent" &&
					context.instanceId === "instance" &&
					context.sessionId === "session" &&
					(payload as { operation?: string }).operation === "session.create",
			),
		).toBe(true);
		const serialized = JSON.stringify(records);
		expect(serialized).not.toContain("secret-prompt");
		expect(serialized).not.toContain("secret-instance-config");
		expect(serialized).not.toContain("secret-session-config");
	});

	it("inherits a parent Publisher without taking ownership of its flush lifecycle", async () => {
		const records: RuntimeObservationRecord[] = [];
		let flushCount = 0;
		const parent = createRuntimeObservationPublisher({
			context: { traceId: "trace-parent" },
			port: {
				record: (record) => {
					records.push(record);
				},
				flush: async () => {
					flushCount += 1;
				},
			},
		});
		const host = new RuntimeAgentHost({ observationPublisher: parent });
		host.registry.upsert({
			source: { id: "code", revision: "1" },
			definition: {
				id: "custom-agent",
				createInstance: () => ({
					createSession: () => ({
						capabilities: {
							instructions: [],
							features: [],
							contextStrategy: new PassthroughContextStrategy(),
							toolPolicy: { authorize: async () => true },
							tokenBudget: 8_000,
							reservedOutputTokens: 1_000,
						},
					}),
				}),
			},
		});
		const instance = await host.createInstance({ agentId: "custom-agent", instanceId: "instance" });
		await instance.createSession({ sessionId: "session" });
		await host.close();

		expect(
			records.some(({ context }) => context.traceId === "trace-parent" && context.agentId === "custom-agent"),
		).toBe(true);
		expect(flushCount).toBe(0);
		await parent.flush();
		expect(flushCount).toBe(1);
	});

	it("rejects ambiguous Port and Publisher ownership", () => {
		expect(
			() =>
				new RuntimeAgentHost({
					observationPort: { record() {} },
					observationPublisher: createRuntimeObservationPublisher(),
				}),
		).toThrow("either observationPort or observationPublisher");
	});
});
