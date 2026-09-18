import { __createPluginLogger, __setPluginLogSink } from "@vetta-org/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatPluginLogEntry, installPluginLogSink } from "./plugin-log-sink";

afterEach(() => {
	__setPluginLogSink(undefined);
	vi.restoreAllMocks();
});

describe("plugin log sink", () => {
	it("formats plugin identity and scope while redacting sensitive values", () => {
		const message = formatPluginLogEntry({
			level: "error",
			plugin: { id: "cli-proxy-api", version: "1.9.6" },
			scope: "models.sync",
			message: "failed for user@example.com with Bearer abc.def",
			fields: {
				credential: "secret-value",
				endpoint: "https://example.test/models?access_token=secret-value",
				error: new Error("request failed for user@example.com"),
			},
		});

		expect(message).toContain("[plugin:cli-proxy-api@1.9.6][models.sync]");
		expect(message).toContain('"credential":"[redacted]"');
		expect(message).toContain("[redacted-email]");
		expect(message).toContain("Bearer [redacted]");
		expect(message).not.toContain("secret-value");
	});

	it("routes a build-bound logger through the persisted renderer console channel", () => {
		const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
		installPluginLogSink();

		__createPluginLogger({ id: "alpha", version: "1.0.0" }).info("ready", { count: 2 });

		expect(info).toHaveBeenCalledWith('[plugin:alpha@1.0.0] ready {"count":2}');
	});
});
