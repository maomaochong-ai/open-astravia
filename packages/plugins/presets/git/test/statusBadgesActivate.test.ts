import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	PluginContext,
	PluginFileExplorerChange,
	PluginFileExplorerDecorationProvider,
	PluginFileExplorerEntry,
} from "@astravia-org/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import plugin from "../src/index";

let root: string;

const git = (...args: string[]) =>
	execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function entry(path: string): PluginFileExplorerEntry {
	return { name: path.slice(path.lastIndexOf("/") + 1), path, isDirectory: false, size: 0, modifiedAt: 0 };
}

/** 只实现激活过程真正会碰到的宿主面；其余留空，免得靠「猜」跑通。 */
function createHostContext(workspaceRoot: string): {
	ctx: PluginContext;
	decorations: PluginFileExplorerDecorationProvider[];
	notifyFilesChanged: (changes: readonly PluginFileExplorerChange[]) => void;
} {
	const decorations: PluginFileExplorerDecorationProvider[] = [];
	const fileListeners: Array<(changes: readonly PluginFileExplorerChange[]) => void> = [];
	const disposable = { dispose: () => {} };
	const ctx = {
		permissions: { has: () => true, require: () => {} },
		command: {
			run: async (command: string, args: string[], options?: { cwd?: string }) => {
				try {
					const stdout = execFileSync(command, args, {
						cwd: options?.cwd ?? workspaceRoot,
						encoding: "utf8",
						stdio: ["ignore", "pipe", "pipe"],
					});
					return { stdout, stderr: "", exitCode: 0 };
				} catch (error) {
					const failed = error as { stdout?: string; stderr?: string; status?: number };
					return { stdout: failed.stdout ?? "", stderr: failed.stderr ?? "", exitCode: failed.status ?? 1 };
				}
			},
		},
		fs: { stat: async () => null, readFile: async () => ({ content: "", encoding: "utf8" }) },
		official: {},
		storage: { get: async () => null, set: async () => {}, delete: async () => {} },
		ai: {},
		ui: {
			registerActivityTab: () => disposable,
			registerWorkspaceView: () => disposable,
			registerTurnCard: () => disposable,
			setActivityTabVisible: () => {},
			openActivityTab: () => {},
			setActivityPanelWidth: () => {},
			notify: () => {},
		},
		conversation: { on: () => disposable },
		fileExplorer: {
			getWorkspaceRoots: () => [{ name: "repo", path: workspaceRoot }],
			onDidChangeFiles: (listener: (changes: readonly PluginFileExplorerChange[]) => void) => {
				fileListeners.push(listener);
				return disposable;
			},
			registerDecorationProvider: (provider: PluginFileExplorerDecorationProvider) => {
				decorations.push(provider);
				return disposable;
			},
		},
	} as unknown as PluginContext;
	return {
		ctx,
		decorations,
		notifyFilesChanged: (changes) => {
			for (const listener of fileListeners) listener(changes);
		},
	};
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "astravia-badge-activate-"));
	git("init", "-b", "main");
	git("config", "user.name", "Fixture");
	git("config", "user.email", "fixture@example.com");
	git("config", "core.hooksPath", join(root, "no-hooks"));
	git("config", "commit.gpgsign", "false");
	git("config", "core.autocrlf", "false");
	writeFileSync(join(root, "tracked.ts"), "export const a = 1;\n");
	git("add", "tracked.ts");
	git("commit", "-m", "init");
});

afterEach(() => {
	plugin.deactivate?.();
	rmSync(root, { recursive: true, force: true });
});

describe("git plugin activation", () => {
	it("marks edited and new files after the workspace changes", async () => {
		const { ctx, decorations, notifyFilesChanged } = createHostContext(root);
		plugin.activate?.(ctx);
		expect(decorations.map((provider) => provider.id)).toEqual(["status-badges"]);

		const provider = decorations[0]!;
		const badge = (name: string) => provider.provideDecoration(entry(join(root, name)))?.badge ?? null;

		// 激活时工作区是干净的。
		await vi.waitFor(() => expect(badge("tracked.ts")).toBeNull(), { timeout: 5000 });

		// 用户改了已跟踪文件、又新建一个；宿主发来文件事件，徽标应当随之更新。
		writeFileSync(join(root, "tracked.ts"), "export const a = 2;\n");
		writeFileSync(join(root, "untracked.md"), "# note\n");
		notifyFilesChanged([{ type: "changed", path: join(root, "tracked.ts") }]);

		await vi.waitFor(() => expect(badge("tracked.ts")).toBe("M"), { timeout: 8000 });
		expect(badge("untracked.md")).toBe("U");
		// 没改过的文件不挂标记。
		expect(badge("missing.md")).toBeNull();
	});
});
