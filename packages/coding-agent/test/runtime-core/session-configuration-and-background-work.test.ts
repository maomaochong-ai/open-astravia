import type { AgentSession } from "@vetta/runtime-core/kernel";
import type { BackgroundCommandService, BackgroundCommandSnapshot } from "@vetta/runtime-tools/coding";
import { describe, expect, it, vi } from "vitest";
import { CodingAgentSessionConfigurationState } from "../../src/host/session-configuration/configuration-state.js";
import { CodingAgentBackgroundWorkController } from "../../src/host/session-execution/background-work-controller.js";

describe("Coding Agent session configuration and background work", () => {
	it("publishes immutable agent and plugin configuration revisions while binding queue modes", async () => {
		const setSteeringMode = vi.fn();
		const setFollowUpMode = vi.fn();
		const state = new CodingAgentSessionConfigurationState("work", () => ({
			toolContributions: [],
		}));
		const controller = state.createController({
			setSteeringMode,
			setFollowUpMode,
		} as unknown as AgentSession);

		controller.setSteeringMode("all");
		controller.setFollowUpMode("one-at-a-time");
		controller.setAgentMode("plan");
		await controller.reconfigureAgentPlugins(undefined);

		expect(setSteeringMode).toHaveBeenCalledWith("all");
		expect(setFollowUpMode).toHaveBeenCalledWith("one-at-a-time");
		expect(state.readAgentMode()).toBe("plan");
		expect(state.readAgentPlugins()).toBeUndefined();
		expect(state.captureRevision().revision).toBe(2);
	});

	it("keeps an admitted revision isolated from later configuration publications", async () => {
		const state = new CodingAgentSessionConfigurationState("work", () => ({
			toolContributions: [
				{ pluginId: "plugin", id: "v1", name: "tool", description: "v1", parameters: {}, handlerId: "v1" },
			],
		}));
		const controller = state.createController({} as unknown as AgentSession);
		const admitted = state.captureRevision();

		controller.setAgentMode("plan");
		await controller.reconfigureAgentPlugins({
			toolContributions: [
				{ pluginId: "plugin", id: "v2", name: "tool", description: "v2", parameters: {}, handlerId: "v2" },
			],
		});
		state.setActiveToolNamesOverride(["tool"]);
		const next = state.captureRevision();

		expect(admitted).toMatchObject({ revision: 0, agentMode: "work" });
		expect(admitted.agentPlugins?.toolContributions?.[0]?.id).toBe("v1");
		expect(Object.isFrozen(admitted.agentPlugins?.toolContributions?.[0])).toBe(true);
		expect(next).toMatchObject({ revision: 3, agentMode: "plan", activeToolNamesOverride: ["tool"] });
		expect(next.agentPlugins?.toolContributions?.[0]?.id).toBe("v2");
	});

	it("commits plugin configuration only after the session-local MCP reconfiguration succeeds", async () => {
		const base = { toolContributions: [] };
		const next = { mcpServerContributions: [] };
		const reconfigureAgentPlugins = vi
			.fn()
			.mockRejectedValueOnce(new Error("MCP reconfiguration failed"))
			.mockResolvedValueOnce(undefined);
		const state = new CodingAgentSessionConfigurationState("work", () => base);
		const controller = state.createController({} as unknown as AgentSession, { reconfigureAgentPlugins });

		await expect(controller.reconfigureAgentPlugins(next)).rejects.toThrow("MCP reconfiguration failed");
		expect(state.readAgentPlugins()).toBe(base);

		await expect(controller.reconfigureAgentPlugins(next)).resolves.toBeUndefined();
		expect(state.readAgentPlugins()).toBe(next);
	});

	it("projects real background task service commands without sharing mutable snapshots", () => {
		const task: BackgroundCommandSnapshot = {
			id: "b1",
			command: "echo work",
			cwd: "C:/workspace",
			status: "completed",
			outputFile: "C:/workspace/b1.log",
			exitCode: 0,
			startedAt: 1,
			endedAt: 2,
			tail: "work",
		};
		const clearFinished = vi.fn(() => 1);
		const stop = vi.fn(() => true);
		const service = {
			clearFinished,
			stop,
			list: () => [task],
		} as unknown as BackgroundCommandService;
		const controller = new CodingAgentBackgroundWorkController(service);

		const tasks = controller.readTasks();

		expect(tasks).toEqual([task]);
		expect(tasks[0]).not.toBe(task);
		expect(controller.killTask("b1")).toBe(true);
		expect(stop).toHaveBeenCalledWith("b1", "user");
		expect(controller.clearFinished()).toBe(1);
		expect(controller.readSubagents()).toEqual([]);
	});
});
