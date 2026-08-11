import { describe, expect, test } from "vitest";
import { validateRpcInboundFrame } from "../../src/modes/rpc/rpc-frame-validator.js";

describe("RPC inbound frame validation", () => {
	test("accepts every documented command shape while preserving extra compatible fields", () => {
		const commands: unknown[] = [
			{ type: "prompt", message: "hello", images: [], streamingBehavior: "followUp", futureField: true },
			{ type: "steer", message: "hello" },
			{ type: "follow_up", message: "hello" },
			{ type: "abort" },
			{ type: "new_session", parentSession: "parent.jsonl" },
			{ type: "get_state" },
			{ type: "set_model", provider: "provider", modelId: "model" },
			{ type: "cycle_model" },
			{ type: "get_available_models" },
			{ type: "set_thinking_level", level: "provider-specific-level" },
			{ type: "cycle_thinking_level" },
			{ type: "set_steering_mode", mode: "all" },
			{ type: "set_follow_up_mode", mode: "one-at-a-time" },
			{ type: "compact", customInstructions: "keep facts" },
			{ type: "set_auto_compaction", enabled: true },
			{ type: "set_auto_retry", enabled: true },
			{ type: "abort_retry" },
			{ type: "bash", command: "echo ok" },
			{ type: "abort_bash" },
			{ type: "get_session_stats" },
			{ type: "export_html", outputPath: "out.html" },
			{ type: "switch_session", sessionPath: "session.jsonl" },
			{ type: "fork", entryId: "entry-1" },
			{ type: "get_fork_messages" },
			{ type: "get_last_assistant_text" },
			{ type: "set_session_name", name: "name" },
			{ type: "get_messages" },
			{ type: "get_commands" },
			{ type: "flush_memory" },
		];

		expect(commands.map((command) => validateRpcInboundFrame(command).kind)).toEqual(commands.map(() => "command"));
	});

	test("classifies extension and host responses independently from commands", () => {
		expect(
			validateRpcInboundFrame({
				type: "extension_ui_response",
				id: "ui-1",
				confirmed: true,
			}),
		).toMatchObject({ kind: "extension_ui_response" });
		expect(
			validateRpcInboundFrame({
				type: "host_response",
				id: "host-1",
				success: true,
				data: { messageId: "message-1" },
			}),
		).toMatchObject({ kind: "host_response" });
		expect(
			validateRpcInboundFrame({
				type: "host_response",
				id: "host-2",
				success: false,
				error: "failed",
				errorCode: "transport_error",
			}),
		).toMatchObject({ kind: "host_response" });
	});

	test("distinguishes unknown commands from malformed known frames", () => {
		expect(validateRpcInboundFrame({ type: "future_command", id: "future" })).toEqual({
			kind: "unknown",
			type: "future_command",
		});
		expect(validateRpcInboundFrame({ type: "prompt", id: "missing-message" })).toEqual({
			kind: "invalid",
			message: "Invalid RPC frame",
		});
		expect(validateRpcInboundFrame({ type: "host_response", id: "missing-success" })).toEqual({
			kind: "invalid",
			message: "Invalid RPC frame",
		});
		expect(validateRpcInboundFrame(null)).toEqual({
			kind: "invalid",
			message: "Invalid RPC frame",
		});
	});
});
