import { CAPABILITY_ERROR_CODES, DOMAIN_MODEL_CAPABILITIES } from "@vetta/capability-sdk";
import { describe, expect, it } from "vitest";
import { PluginCapabilityAdapter } from "../index.js";
import { RecordingAccessFactory } from "./helpers/recording-access-factory.js";

describe("PluginCapabilityAdapter community plugins", () => {
	it("rejects local ids that could overlap another plugin's namespace", () => {
		const access = new RecordingAccessFactory();
		const adapter = new PluginCapabilityAdapter(access, {
			isOfficialPlugin: () => false,
			resolvePermissions: () => ["models.manage"],
		});
		const sessionId = adapter.openSession("community");
		for (const id of ["other.provider", "../other", "", "X", "a".repeat(33)]) {
			expect(() => adapter.replaceOwnedModelProviders(sessionId, { [id]: {} })).toThrow("lowercase slug");
		}
		expect(access.invocations).toEqual([]);
	});
	it("allows a permitted plugin to manage only its own model provider namespace", async () => {
		const access = new RecordingAccessFactory();
		const adapter = new PluginCapabilityAdapter(access, {
			isOfficialPlugin: () => false,
			resolvePermissions: () => ["models.manage"],
		});
		const sessionId = adapter.openSession("community");

		await adapter.replaceOwnedModelProviders(sessionId, {
			openai: {
				baseUrl: "http://127.0.0.1:12345/v1",
				apiKey: "generated-service-key",
				models: [{ id: "dynamic-model" }],
			},
		});

		expect(access.invocations).toEqual([
			{
				capabilityId: DOMAIN_MODEL_CAPABILITIES.REPLACE_OWNED_PROVIDERS.id,
				input: {
					owner: "community",
					providers: {
						openai: {
							baseUrl: "http://127.0.0.1:12345/v1",
							apiKey: "generated-service-key",
							models: [{ id: "dynamic-model" }],
						},
					},
				},
			},
		]);
	});

	it("denies owned model provider mutation without models.manage", async () => {
		const access = new RecordingAccessFactory();
		const adapter = new PluginCapabilityAdapter(access, {
			isOfficialPlugin: () => false,
			resolvePermissions: () => [],
		});
		const sessionId = adapter.openSession("community");

		expect(() => adapter.replaceOwnedModelProviders(sessionId, { openai: {} })).toThrowError(
			expect.objectContaining({
				code: CAPABILITY_ERROR_CODES.ACCESS_DENIED,
			}),
		);
		expect(access.invocations).toEqual([]);
	});

	it("does not grant official domain capabilities to non-official plugins", () => {
		const access = new RecordingAccessFactory();
		const adapter = new PluginCapabilityAdapter(access, {
			isOfficialPlugin: () => false,
			resolvePermissions: () => [],
		});
		const sessionId = adapter.openSession("community");

		expect(access.sessions[0]?.grants).toEqual([]);
		expect(() => adapter.assertOfficialSession(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.getAgentExperimental(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.getGeneralSettings(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.getImStatus(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.listModels(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.listMcpServers(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.listBatchProjects(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.listProjects(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.listSessions(sessionId, "C:/workspace")).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.listSkills(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.getShortcutSettings(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.listDownloads(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.listKnowledgeBases(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.getUpdaterState(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.listScheduledTasks(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.listWebhookEndpoints(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
	});
});
