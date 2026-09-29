import { describe, expect, it, vi } from "vitest";
import {
	formatPluginRuntimeLog,
	logPluginRuntimeError,
	logPluginRuntimeInfo,
	logPluginRuntimeWarn,
} from "./plugin-runtime-log";

describe("plugin runtime log", () => {
	it("keeps lifecycle correlation fields and redacts sensitive error text", () => {
		const message = formatPluginRuntimeLog(
			"activation failed",
			{
				pluginId: "demo",
				pluginVersion: "1.2.3",
				activationId: "activation-1",
				capabilitySessionId: "session-1",
				stage: "activate",
			},
			new Error("request failed for user@example.com with Bearer abc.def"),
		);

		expect(message).toContain('"pluginId":"demo"');
		expect(message).toContain('"activationId":"activation-1"');
		expect(message).toContain('"capabilitySessionId":"session-1"');
		expect(message).toContain('"stage":"activate"');
		expect(message).toContain("[redacted-email]");
		expect(message).toContain("Bearer [redacted]");
		expect(message).not.toContain("abc.def");
	});

	it("routes each severity through the persisted renderer console channel", () => {
		const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

		logPluginRuntimeInfo("loaded", { pluginId: "demo" });
		logPluginRuntimeWarn("retained previous activation", { pluginId: "demo" });
		logPluginRuntimeError("activation failed", { pluginId: "demo" }, new Error("failed"));

		expect(info).toHaveBeenCalledWith(expect.stringContaining("[plugin-runtime] loaded"));
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("[plugin-runtime] retained previous activation"));
		expect(error).toHaveBeenCalledWith(expect.stringContaining("[plugin-runtime] activation failed"));
	});
});
