import { applyConversationDocumentCommand, createEmptyConversationDocument } from "@vetta/runtime-core";
import { afterEach, describe, expect, it } from "vitest";
import {
	DEFAULT_AGENT_CONFIGURATION,
	parseAgentConfigurationSelection,
	parseAgentConfigurationTemplate,
} from "../../src/agent-configuration/configuration-schema.js";
import { AgentSessionConfiguration } from "../../src/agent-configuration/session-configuration.js";

describe("conversation Agent configuration", () => {
	const runtimes: AgentSessionConfiguration[] = [];
	afterEach(async () => {
		for (const runtime of runtimes.splice(0)) await runtime.dispose();
	});

	it("validates references without accepting credentials, commands, unknown fields or future versions", () => {
		for (const overrides of [
			{ mcpServers: [{ command: "run", env: { SECRET: "secret" } }] },
			{ tools: ["read", "read"] },
			{ skills: [""] },
			{ plugins: "all" },
			{ modelKey: "invalid" },
			{ permissions: ["all"] },
		]) {
			expect(() => parseAgentConfigurationSelection({ template: null, overrides })).toThrow(
				"AGENT_CONFIGURATION_INVALID",
			);
		}
		expect(() =>
			parseAgentConfigurationTemplate({
				id: "x",
				revision: 0,
				name: "x",
				configuration: DEFAULT_AGENT_CONFIGURATION,
			}),
		).toThrow("AGENT_CONFIGURATION_INVALID");
	});

	it("resolves template and override layers and preserves a private template snapshot across restore", async () => {
		const template = {
			id: "writer",
			revision: 2,
			name: "Writer",
			configuration: { ...DEFAULT_AGENT_CONFIGURATION, appendSystemPrompt: "template", tools: ["read"] },
		};
		const runtime = create({ template, overrides: { appendSystemPrompt: "session" } });
		const document = await initialize(runtime);
		template.configuration.tools.push("write");
		expect(runtime.read().resolved).toMatchObject({ appendSystemPrompt: "session", tools: ["read"] });
		expect(document.read().entries).toHaveLength(1);
		const resumed = create();
		await resumed.initialize(document.read(), {
			appendCustomEntry: async () => {
				throw new Error("restore should not rewrite");
			},
		});
		expect(resumed.read().desired).toEqual(runtime.read().desired);
		expect(resumed.read()).toMatchObject({ effectiveRevision: null, pending: true });
	});

	it.each(["coding-agent.configuration.v2", "coding-agent.configuration.v1"])(
		"rejects unknown persisted versions in %s",
		async (customType) => {
			const runtime = create();
			const document = applyConversationDocumentCommand(
				createEmptyConversationDocument({ sessionId: "conversation", createdAt: 1 }),
				{
					type: "custom.append",
					entryId: "future",
					timestamp: new Date(1).toISOString(),
					customType,
					data: { schemaVersion: 2, revision: 0, selection: { template: null, overrides: {} } },
				},
			).document;
			await expect(runtime.initialize(document, { appendCustomEntry: async () => {} })).rejects.toThrow(
				"AGENT_CONFIGURATION_INVALID",
			);
		},
	);

	it("saves durably before publishing desired and rejects concurrent stale edits", async () => {
		const runtime = create();
		let unblock!: () => void;
		const blocked = new Promise<void>((resolve) => {
			unblock = resolve;
		});
		let entered!: () => void;
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		await initialize(runtime, async () => {
			entered();
			await blocked;
		});
		const first = runtime.update({ expectedRevision: 0, selection: { template: null, overrides: { tools: [] } } });
		await started;
		expect(runtime.read().desired.revision).toBe(0);
		const second = runtime.update({
			expectedRevision: 0,
			selection: { template: null, overrides: { tools: ["read"] } },
		});
		const rejected = expect(second).rejects.toMatchObject({ code: "AGENT_CONFIGURATION_CONFLICT" });
		unblock();
		await first;
		await rejected;
		expect(runtime.read()).toMatchObject({
			desired: { revision: 1 },
			resolved: { tools: [] },
			effectiveRevision: null,
		});
	});

	it("keeps desired unchanged when persistence fails", async () => {
		const runtime = create();
		await initialize(runtime, async () => {
			throw new Error("disk unavailable");
		});
		await expect(
			runtime.update({ expectedRevision: 0, selection: { template: null, overrides: { skills: [] } } }),
		).rejects.toThrow("disk unavailable");
		expect(runtime.read().desired.revision).toBe(0);
	});

	it("pins admission while edits queue a later revision, and only commits effective after the full bind", async () => {
		const runtime = create();
		await initialize(runtime);
		(await runtime.admit(turn(), async () => {})).commit();
		const first = await runtime.update({
			expectedRevision: 0,
			selection: { template: null, overrides: { appendSystemPrompt: "one" } },
		});
		const admission = await runtime.admit(turn(), async () => {});
		expect(runtime.read().effectiveRevision).toBe(0);
		await runtime.update({
			expectedRevision: first.desired.revision,
			selection: { template: null, overrides: { appendSystemPrompt: "two" } },
		});
		expect(runtime.readAdmitted().appendSystemPrompt).toBe("one");
		admission.commit();
		expect(runtime.read()).toMatchObject({ effectiveRevision: 1, desired: { revision: 2 }, pending: true });
		(await runtime.admit(turn(), async () => {})).commit();
		expect(runtime.read()).toMatchObject({ effectiveRevision: 2, pending: false });
	});

	it("keeps the last effective version on apply or snapshot failure, with safe error diagnostics and retry", async () => {
		const runtime = create();
		await initialize(runtime);
		(await runtime.admit(turn(), async () => {})).commit();
		await runtime.update({
			expectedRevision: 0,
			selection: { template: null, overrides: { appendSystemPrompt: "private prompt" } },
		});
		await expect(
			runtime.admit(turn(), async () => {
				throw new Error("private credential");
			}),
		).rejects.toThrow("private credential");
		expect(runtime.read()).toMatchObject({
			effectiveRevision: 0,
			pending: true,
			failure: { code: "AGENT_CONFIGURATION_APPLY_FAILED", revision: 1 },
		});
		expect(JSON.stringify(runtime.read().failure)).not.toContain("private");
		const admission = await runtime.admit(turn(), async () => {});
		admission.rollback(new Error("binding failed"));
		expect(runtime.readAdmitted().appendSystemPrompt).toBe("");
		(await runtime.admit(turn(), async () => {})).commit();
		expect(runtime.read()).toMatchObject({ effectiveRevision: 1, pending: false, failure: null });
	});

	it("ignores unrelated document mutations and restores selected branches without carrying an effective revision", async () => {
		const runtime = create();
		const document = await initialize(runtime);
		await runtime.update({ expectedRevision: 0, selection: { template: null, overrides: { plugins: [] } } });
		(await runtime.admit(turn(), async () => {})).commit();
		await runtime.onDocumentChanged(document.read());
		expect(runtime.read().effectiveRevision).toBe(1);
		await runtime.onDocumentChanged(createEmptyConversationDocument({ sessionId: "conversation", createdAt: 1 }));
		expect(runtime.read()).toMatchObject({
			desired: { revision: 0 },
			resolved: { plugins: null },
			effectiveRevision: null,
		});
	});

	function create(selection?: Parameters<typeof parseAgentConfigurationSelection>[0]) {
		let index = 0;
		const runtime = new AgentSessionConfiguration(
			selection === undefined ? undefined : parseAgentConfigurationSelection(selection),
			() => `config-${++index}`,
			() => 1,
		);
		runtimes.push(runtime);
		return runtime;
	}
});

async function initialize(runtime: AgentSessionConfiguration, beforePersist?: () => Promise<void>) {
	let document = createEmptyConversationDocument({ sessionId: "conversation", createdAt: 1 });
	await runtime.initialize(document, {
		appendCustomEntry: async (entry) => {
			await beforePersist?.();
			document = applyConversationDocumentCommand(document, { type: "custom.append", ...entry }).document;
			await runtime.onDocumentChanged(document);
		},
	});
	return { read: () => document };
}

function turn() {
	return {
		sessionId: "conversation",
		operationId: "turn",
		reason: "turn" as const,
		signal: new AbortController().signal,
	};
}
