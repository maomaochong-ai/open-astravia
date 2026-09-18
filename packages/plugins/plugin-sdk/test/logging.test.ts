import { afterEach, describe, expect, it } from "vitest";
import {
	__createPluginLogger,
	__setPluginLogSink,
	type PluginLogEntry,
} from "../src/index.js";
import { logger as unboundLogger } from "../src/logger.js";

afterEach(() => __setPluginLogSink(undefined));

describe("plugin logger", () => {
	it("keeps manifest identities and child scopes isolated between plugins", () => {
		const entries: PluginLogEntry[] = [];
		__setPluginLogSink((entry) => entries.push(entry));
		const alpha = __createPluginLogger({ id: "alpha", version: "1.0.0" });
		const beta = __createPluginLogger({ id: "beta", version: "2.0.0" });

		alpha.child("models").child("sync").info("completed", { count: 3 });
		beta.warn("degraded");

		expect(entries).toEqual([
			{
				level: "info",
				plugin: { id: "alpha", version: "1.0.0" },
				scope: "models.sync",
				message: "completed",
				fields: { count: 3 },
			},
			{
				level: "warn",
				plugin: { id: "beta", version: "2.0.0" },
				message: "degraded",
			},
		]);
	});

	it("fails clearly when the logger subpath was not bound by plugin-vite", () => {
		expect(() => unboundLogger.info("unscoped")).toThrow("Plugin logger is not bound");
	});
});
