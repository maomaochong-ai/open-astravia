import { CAPABILITY_ERROR_CODES } from "@vetta/capability-sdk";
import { describe, expect, it } from "vitest";
import { PluginCapabilityAdapter } from "../index.js";
import { RecordingAccessFactory } from "./helpers/recording-access-factory.js";

describe("PluginCapabilityAdapter community plugins", () => {
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
