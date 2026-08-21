import type {
	PluginAgentToolHandler,
	PluginAgentToolRegistration,
	PluginContext,
	PluginFsApi,
} from "@vetta-org/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPendingDesignPath, takePendingDesignPath } from "../src/canvas/design-runtime";
import { registerDesignTools } from "../src/tools";

const SESSION_CWD = "C:/work/design-session";

describe("vetd_create activity-tab target", () => {
	let createHandler: PluginAgentToolHandler<{ name?: string; product?: string }>;
	const setActivityTabVisible = vi.fn();
	const openActivityTab = vi.fn();

	beforeEach(() => {
		setPendingDesignPath(null);
		setPendingDesignPath(null, SESSION_CWD);
		setActivityTabVisible.mockReset();
		openActivityTab.mockReset();
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

	it("binds the pending design and both UI commands to the triggering session cwd", async () => {
		const fs = {
			stat: vi.fn(async () => null),
			createDirectory: vi.fn(async () => {}),
			writeFile: vi.fn(async () => {}),
		} as unknown as PluginFsApi;

		await createHandler({
			host: { fs },
			session: { cwd: SESSION_CWD },
			trigger: { input: { name: "dashboard", product: "desktop" } },
		} as never);

		expect(setActivityTabVisible).toHaveBeenCalledWith("canvas", true, { cwd: SESSION_CWD });
		expect(openActivityTab).toHaveBeenCalledWith("canvas", { width: "max", cwd: SESSION_CWD });
		expect(takePendingDesignPath("C:/work/foreground")).toBeNull();
		expect(takePendingDesignPath(SESSION_CWD)).toBe(`${SESSION_CWD}/dashboard.vetd`);
	});
});
