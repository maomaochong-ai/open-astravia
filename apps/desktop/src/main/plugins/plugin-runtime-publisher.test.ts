import type { AgentPluginRuntimeConfig } from "@vetta/coding-agent/plugin-runtime";
import { describe, expect, it, vi } from "vitest";
import { AgentPluginRuntimePublisher } from "./plugin-runtime-publisher.js";

describe("AgentPluginRuntimePublisher", () => {
	it("suppresses equivalent runtime snapshots regardless of object key order", () => {
		let config: AgentPluginRuntimeConfig | undefined = toolConfig("activation-1", {
			type: "object",
			properties: { path: { type: "string" }, line: { type: "number" } },
		});
		const { publisher, apply } = createPublisher(() => config);

		expect(publisher.refresh({ reason: "initial" }).applied).toBe(true);
		config = toolConfig("activation-1", {
			properties: { line: { type: "number" }, path: { type: "string" } },
			type: "object",
		});
		expect(publisher.refresh({ reason: "staged-register" }).applied).toBe(false);
		expect(apply).toHaveBeenCalledTimes(1);
	});

	it("publishes new handler identity without claiming the model input changed", () => {
		let config: AgentPluginRuntimeConfig | undefined = toolConfig("activation-1");
		const { publisher, apply } = createPublisher(() => config);
		publisher.refresh();

		config = toolConfig("activation-2");
		const result = publisher.refresh({ reason: "activation-commit" });

		expect(result.applied).toBe(true);
		expect(result.modelTopologyChanged).toBe(false);
		expect(apply).toHaveBeenCalledTimes(2);
	});

	it("reports provider-facing tool changes", () => {
		let config: AgentPluginRuntimeConfig | undefined = toolConfig("activation-1");
		const { publisher } = createPublisher(() => config);
		publisher.refresh();

		config = toolConfig("activation-1", { type: "object", required: ["path"] });
		const result = publisher.refresh({ reason: "tool-schema-change" });

		expect(result.applied).toBe(true);
		expect(result.modelTopologyChanged).toBe(true);
	});

	it("forces resource reconstruction for code changes with unchanged topology", () => {
		const config = toolConfig("activation-1");
		const { publisher, apply } = createPublisher(() => config);
		publisher.refresh();

		const result = publisher.refresh({ reason: "plugin-dev:resource", force: true });

		expect(result.applied).toBe(true);
		expect(result.forced).toBe(true);
		expect(result.modelTopologyChanged).toBe(false);
		expect(apply).toHaveBeenCalledTimes(2);
	});
});

function createPublisher(build: () => AgentPluginRuntimeConfig | undefined) {
	const apply = vi.fn();
	const logger = { debug: vi.fn() };
	return {
		apply,
		logger,
		publisher: new AgentPluginRuntimePublisher({ build, apply, logger, summarize: () => ({}) }),
	};
}

function toolConfig(activationId: string, parameters: Record<string, unknown> = { type: "object" }) {
	return {
		toolContributions: [
			{
				pluginId: "demo",
				id: "read",
				name: "read",
				description: "Read a file",
				parameters,
				handlerId: `handler-${activationId}`,
				activationId,
			},
		],
	} satisfies AgentPluginRuntimeConfig;
}
