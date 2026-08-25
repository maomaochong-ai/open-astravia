import { CAPABILITY_ERROR_CODES, DOMAIN_AI_CAPABILITIES } from "@vetta/capability-sdk";
import { describe, expect, it } from "vitest";
import { PLUGIN_CAPABILITY_PERMISSIONS, PluginCapabilityAdapter } from "../index.js";
import { RecordingAccessFactory } from "./helpers/recording-access-factory.js";

describe("PluginCapabilityAdapter ai permission", () => {
	it("maps ai.complete to both single-turn and chat capability grants", async () => {
		const access = new RecordingAccessFactory();
		const adapter = new PluginCapabilityAdapter(access, {
			isOfficialPlugin: () => false,
			resolvePermissions: () => [PLUGIN_CAPABILITY_PERMISSIONS.AI_COMPLETE],
		});
		const sessionId = adapter.openSession("chess");

		expect(access.sessions[0]?.grants).toEqual([
			{ capabilityId: DOMAIN_AI_CAPABILITIES.COMPLETE.id },
			{ capabilityId: DOMAIN_AI_CAPABILITIES.CHAT.id },
		]);
		await expect(adapter.completeAi(sessionId, { prompt: "hello" })).resolves.toHaveProperty("stopReason", "stop");
	});

	it("validates chat transcripts at the adapter boundary and forwards cleaned input", async () => {
		const access = new RecordingAccessFactory();
		const adapter = new PluginCapabilityAdapter(access, {
			isOfficialPlugin: () => false,
			resolvePermissions: () => [PLUGIN_CAPABILITY_PERMISSIONS.AI_COMPLETE],
		});
		const sessionId = adapter.openSession("chess");

		const result = await adapter.chatAi(sessionId, {
			messages: [
				{ role: "user", content: "your move", ignored: true },
				{ role: "assistant", content: "thinking" },
			],
			tools: [{ name: "make_move", description: "play", parameters: { type: "object" } }],
		});
		expect(result.stopReason).toBe("toolUse");
		expect(result.toolCalls[0]).toEqual({ id: "call-1", name: "make_move", arguments: { move: "h2e2" } });
		expect(access.invocations.at(-1)).toEqual({
			capabilityId: DOMAIN_AI_CAPABILITIES.CHAT.id,
			input: {
				messages: [
					{ role: "user", content: "your move" },
					{ role: "assistant", content: "thinking" },
				],
				tools: [{ name: "make_move", description: "play", parameters: { type: "object" } }],
			},
		});

		expect(() => adapter.chatAi(sessionId, { messages: [] })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
		);
	});

	it("denies chat without the ai.complete permission", () => {
		const access = new RecordingAccessFactory();
		const adapter = new PluginCapabilityAdapter(access, {
			isOfficialPlugin: () => false,
			resolvePermissions: () => [PLUGIN_CAPABILITY_PERMISSIONS.AI_MODELS_LIST],
		});
		const sessionId = adapter.openSession("chess");
		expect(() => adapter.chatAi(sessionId, { messages: [{ role: "user", content: "hi" }] })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
	});
});
