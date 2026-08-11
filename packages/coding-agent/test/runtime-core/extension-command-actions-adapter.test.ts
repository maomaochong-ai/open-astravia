import { describe, expect, it, vi } from "vitest";
import type { ExtensionSessionWriter } from "../../src/extensions/index.js";
import type { CodingAgentSessionSeedInitializer } from "../../src/host/session-transition/contracts.js";
import {
	type CodingAgentRuntimeExtensionCommandActionPorts,
	createCodingAgentRuntimeExtensionCommandActions,
} from "../../src/public-api/runtime/extensions.js";

describe("createCodingAgentRuntimeExtensionCommandActions", () => {
	it("maps the complete Extension command action contract to neutral Greenfield ports", async () => {
		const initializer: CodingAgentSessionSeedInitializer = {
			initializeSeed: vi.fn(async () => {}),
		};
		const ports = createPorts(initializer);
		const actions = createCodingAgentRuntimeExtensionCommandActions(ports);
		const setup = async (_session: ExtensionSessionWriter): Promise<void> => {};

		await expect(actions.waitForIdle()).resolves.toBeUndefined();
		await expect(actions.newSession()).resolves.toEqual({ cancelled: false });
		await expect(actions.newSession({ parentSession: "parent.jsonl", setup })).resolves.toEqual({
			cancelled: false,
		});
		await expect(actions.fork("entry-1")).resolves.toEqual({ cancelled: true });
		await expect(
			actions.navigateTree("entry-2", {
				summarize: true,
				customInstructions: "custom",
				replaceInstructions: true,
				label: "kept",
			}),
		).resolves.toEqual({ cancelled: false });
		await expect(actions.switchSession("next.jsonl")).resolves.toEqual({ cancelled: false });
		await expect(actions.reload()).resolves.toBeUndefined();

		expect(ports.waitForIdle).toHaveBeenCalledOnce();
		expect(ports.newSession).toHaveBeenNthCalledWith(1, undefined);
		expect(ports.createSessionSetupInitializer).toHaveBeenCalledWith(setup);
		expect(ports.newSession).toHaveBeenNthCalledWith(2, {
			parentSession: "parent.jsonl",
			seedInitializer: initializer,
		});
		expect(ports.fork).toHaveBeenCalledWith("entry-1");
		expect(ports.navigateTree).toHaveBeenCalledWith("entry-2", {
			summarize: true,
			customInstructions: "custom",
			replaceInstructions: true,
			label: "kept",
		});
		expect(ports.switchSession).toHaveBeenCalledWith("next.jsonl");
		expect(ports.reload).toHaveBeenCalledOnce();
	});
});

function createPorts(initializer: CodingAgentSessionSeedInitializer): CodingAgentRuntimeExtensionCommandActionPorts & {
	readonly waitForIdle: ReturnType<typeof vi.fn>;
	readonly newSession: ReturnType<typeof vi.fn>;
	readonly createSessionSetupInitializer: ReturnType<typeof vi.fn>;
	readonly fork: ReturnType<typeof vi.fn>;
	readonly navigateTree: ReturnType<typeof vi.fn>;
	readonly switchSession: ReturnType<typeof vi.fn>;
	readonly reload: ReturnType<typeof vi.fn>;
} {
	return {
		waitForIdle: vi.fn(async () => {}),
		newSession: vi.fn(async () => ({ cancelled: false })),
		createSessionSetupInitializer: vi.fn(() => initializer),
		fork: vi.fn(async () => ({ text: "fork prompt", cancelled: true })),
		navigateTree: vi.fn(async () => ({ cancelled: false })),
		switchSession: vi.fn(async () => ({ cancelled: false })),
		reload: vi.fn(async () => {}),
	};
}
