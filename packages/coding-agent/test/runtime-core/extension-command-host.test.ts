import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../../src/auth/index.js";
import type { ExtensionCommandContextActions } from "../../src/extensions/index.js";
import { discoverAndLoadExtensions, ExtensionRunner } from "../../src/extensions/index.js";
import { createCodingAgentModelRuntime } from "../../src/models/index.js";
import { createCodingAgentRuntimeExtensionCommandHost } from "../../src/public-api/runtime/extensions.js";
import { createExtensionSessionView } from "../fixtures/extension-session-view.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

describe("Coding Agent Runtime Extension command host", () => {
	it("binds the complete command action contract and preserves Legacy argument parsing", async () => {
		const runner = await createRunner(`
			export default function(extension) {
				extension.registerCommand("workflow", {
					description: "Run workflow",
					async handler(args, ctx) {
						if (args !== "first  second") throw new Error("unexpected args: " + args);
						await ctx.waitForIdle();
						await ctx.newSession({ parentSession: "parent.jsonl" });
						await ctx.fork("entry-1");
						await ctx.navigateTree("entry-2", { summarize: true, label: "kept" });
						await ctx.switchSession("next.jsonl");
						await ctx.reload();
					},
				});
			}
		`);
		const actions = createActions();
		const host = createCodingAgentRuntimeExtensionCommandHost({ runner, actions });

		await expect(host.tryExecute("/workflow first  second")).resolves.toBe(true);
		expect(actions.waitForIdle).toHaveBeenCalledOnce();
		expect(actions.newSession).toHaveBeenCalledWith({ parentSession: "parent.jsonl" });
		expect(actions.fork).toHaveBeenCalledWith("entry-1");
		expect(actions.navigateTree).toHaveBeenCalledWith("entry-2", { summarize: true, label: "kept" });
		expect(actions.switchSession).toHaveBeenCalledWith("next.jsonl");
		expect(actions.reload).toHaveBeenCalledOnce();
		expect(host.readCommands()).toEqual([
			{
				name: "workflow",
				description: "Run workflow",
				source: "extension",
				path: expect.stringContaining("command-host.ts"),
			},
		]);
	});

	it("returns false for non-extension input and rejects commands from queued paths", async () => {
		const runner = await createRunner(`
			export default function(extension) {
				extension.registerCommand("workflow", { handler: async () => {} });
			}
		`);
		const host = createCodingAgentRuntimeExtensionCommandHost({ runner, actions: createActions() });

		await expect(host.tryExecute("plain text")).resolves.toBe(false);
		await expect(host.tryExecute("/missing")).resolves.toBe(false);
		expect(() => host.throwIfExtensionCommand("/workflow queued")).toThrow(
			'Extension command "/workflow" cannot be queued. Use prompt() or execute the command when not streaming.',
		);
		expect(() => host.throwIfExtensionCommand("/missing")).not.toThrow();
	});

	it("reports handler failures through the Runner and treats the command as handled", async () => {
		const runner = await createRunner(`
			export default function(extension) {
				extension.registerCommand("fail", {
					handler: async () => { throw new Error("command failed"); },
				});
			}
		`);
		const errors: Array<{ extensionPath: string; event: string; error: string }> = [];
		runner.onError((error) => errors.push(error));
		const host = createCodingAgentRuntimeExtensionCommandHost({ runner, actions: createActions() });

		await expect(host.tryExecute("/fail")).resolves.toBe(true);
		expect(errors).toEqual([
			{
				extensionPath: "command:fail",
				event: "command",
				error: "command failed",
			},
		]);
	});
});

function createActions(): ExtensionCommandContextActions {
	return {
		waitForIdle: vi.fn(async () => {}),
		newSession: vi.fn(async () => ({ cancelled: false })),
		fork: vi.fn(async () => ({ cancelled: false })),
		navigateTree: vi.fn(async () => ({ cancelled: false })),
		switchSession: vi.fn(async () => ({ cancelled: false })),
		reload: vi.fn(async () => {}),
	};
}

async function createRunner(extensionSource: string): Promise<ExtensionRunner> {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "greenfield-extension-command-"));
	temporaryDirectories.push(directory);
	const extensionPath = path.join(directory, "command-host.ts");
	fs.writeFileSync(extensionPath, extensionSource);
	const loaded = await discoverAndLoadExtensions([extensionPath], directory, directory);
	return new ExtensionRunner(
		loaded.extensions,
		loaded.runtime,
		directory,
		createExtensionSessionView(directory),
		createCodingAgentModelRuntime(AuthStorage.inMemory(), {
			modelsJsonPath: path.join(directory, "models.json"),
		}),
	);
}
