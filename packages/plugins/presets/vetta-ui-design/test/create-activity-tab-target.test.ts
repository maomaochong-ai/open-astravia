import type {
	PluginAgentToolHandler,
	PluginAgentToolRegistration,
	PluginContext,
	PluginFsApi,
} from "@vetta-org/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPendingDesignPath, takePendingDesignPath } from "../src/canvas/design-runtime";
import { registerDesignTools } from "../src/tools";
import { DESIGN_ONLY_TOOLS } from "../src/vetd/tool-gate";

const SESSION_CWD = "C:/work/design-session";

describe("vetd_create activity-tab target", () => {
	let createHandler: PluginAgentToolHandler<{ name?: string; product?: string }>;
	const setActivityTabVisible = vi.fn();
	const openActivityTab = vi.fn();
	const enableTool = vi.fn();

	beforeEach(() => {
		setPendingDesignPath(null);
		setPendingDesignPath(null, SESSION_CWD);
		setActivityTabVisible.mockReset();
		openActivityTab.mockReset();
		enableTool.mockReset();
		const ctx = {
			agent: {
				registerTool: (registration: PluginAgentToolRegistration) => {
					if (registration.name === "vetd_create") {
						createHandler = registration.handler as PluginAgentToolHandler<{
							name?: string;
							product?: string;
						}>;
					}
					return { dispose: () => {} };
				},
			},
			ui: { setActivityTabVisible, openActivityTab },
		} as unknown as PluginContext;
		registerDesignTools(ctx);
	});

	it("binds the UI target and enables the design tools for the rest of the current turn", async () => {
		const fs = {
			stat: vi.fn(async () => null),
			createDirectory: vi.fn(async () => {}),
			writeFile: vi.fn(async () => {}),
		} as unknown as PluginFsApi;

		await createHandler({
			host: { fs },
			session: { cwd: SESSION_CWD },
			trigger: { input: { name: "dashboard", product: "desktop" } },
			actions: { tools: { enable: enableTool } },
		} as never);

		expect(setActivityTabVisible).toHaveBeenCalledWith("canvas", true, { cwd: SESSION_CWD });
		expect(openActivityTab).toHaveBeenCalledWith("canvas", { width: "max", cwd: SESSION_CWD });
		expect(takePendingDesignPath("C:/work/foreground")).toBeNull();
		expect(takePendingDesignPath(SESSION_CWD)).toBe(`${SESSION_CWD}/dashboard.vetd`);
		expect(enableTool.mock.calls.map(([toolName]) => toolName)).toEqual([...DESIGN_ONLY_TOOLS]);
	});

	it("keeps the design-only tools gated when creation validation fails", async () => {
		const result = await createHandler({
			host: { fs: {} as PluginFsApi },
			session: { cwd: SESSION_CWD },
			trigger: { input: { name: "dashboard" } },
			actions: { tools: { enable: enableTool } },
		} as never);

		expect(result).toMatchObject({ ok: false });
		expect(enableTool).not.toHaveBeenCalled();
	});
});
