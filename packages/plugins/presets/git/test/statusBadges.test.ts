import type { PluginFileExplorerEntry } from "@astravia-org/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	FileStatusBadges,
	type StatusSlice,
	badgeDecoration,
	buildStatusCodes,
	normalizeFsPath,
	normalizeRepoPrefix,
} from "../src/git/statusBadges";
import { createStatusRefresher } from "../src/git/statusRefresher";
import type { ChangeCode, StatusGroups } from "../src/git/types";

function groups(partial: Partial<StatusGroups> = {}): StatusGroups {
	return { conflict: [], staged: [], unstaged: [], ...partial };
}

function entry(path: string, isDirectory = false): PluginFileExplorerEntry {
	return { name: path.slice(path.lastIndexOf("/") + 1), path, isDirectory, size: 0, modifiedAt: 0 };
}

function slice(workspaceRoot: string, codes: Record<string, ChangeCode>, repoPrefix = ""): StatusSlice {
	return { workspaceRoot, codes: new Map(Object.entries(codes)), repoPrefix };
}

describe("buildStatusCodes", () => {
	it("keeps one letter per repo-relative path", () => {
		const codes = buildStatusCodes(
			groups({
				staged: [{ path: "src/added.ts", code: "A" }],
				// 同一个文件既已暂存新增、工作区又改过：只留一个标记，按面板的分档规则取 `A`。
				unstaged: [
					{ path: "src/added.ts", code: "M" },
					{ path: "src/edited.ts", code: "M" },
					{ path: "docs/new.md", code: "U" },
				],
			}),
		);
		expect([...codes.entries()]).toEqual([
			["src/added.ts", "A"],
			["src/edited.ts", "M"],
			["docs/new.md", "U"],
		]);
	});

	it("lets a conflict override ordinary staged and working-tree changes", () => {
		const codes = buildStatusCodes(
			groups({
				staged: [{ path: "a.ts", code: "M" }],
				unstaged: [{ path: "a.ts", code: "M" }],
				conflict: [{ path: "a.ts", code: "C" }],
			}),
		);
		expect(codes.get("a.ts")).toBe("C");
	});

	it("normalizes separators coming from Windows", () => {
		expect(normalizeFsPath("C:\\work\\repo\\")).toBe("C:/work/repo");
		expect(normalizeRepoPrefix("\\src\\")).toBe("src/");
		expect(normalizeRepoPrefix("")).toBe("");
		const codes = buildStatusCodes(groups({ unstaged: [{ path: "src\\a.ts", code: "M" }] }));
		expect(codes.get("src/a.ts")).toBe("M");
	});
});

describe("badgeDecoration", () => {
	it("maps every status letter to a one-character badge with a tooltip key", () => {
		const expected: Record<ChangeCode, string> = { M: "M", A: "A", D: "D", R: "R", U: "U", C: "!" };
		for (const [code, letter] of Object.entries(expected) as Array<[ChangeCode, string]>) {
			const decoration = badgeDecoration(code);
			expect(decoration.badge).toBe(letter);
			expect(decoration.tooltip).toMatch(/^%badge\.[a-z]+%$/);
			expect(decoration.color).toBeTruthy();
		}
	});
});

describe("FileStatusBadges", () => {
	it("answers the provider from memory and stays quiet for directories and unknown paths", () => {
		const badges = new FileStatusBadges();
		badges.replace([slice("/repo", { "a.ts": "M" })]);
		const provider = badges.provider();
		expect(provider.provideDecoration(entry("/repo/a.ts"))?.badge).toBe("M");
		expect(provider.provideDecoration(entry("/repo/b.ts"))).toBeNull();
		expect(provider.provideDecoration(entry("/repo", true))).toBeNull();
	});

	it("maps host paths through the workspace root, not the repo root", () => {
		// 工作区根是仓库里的子目录，`/var` 与 `/private/var` 这类写法差异也不该影响结果。
		const badges = new FileStatusBadges();
		badges.replace([slice("/private/var/proj", { "packages/app/src/a.ts": "M" }, "packages/app/")]);
		expect(badges.codeFor("/private/var/proj/src/a.ts")).toBe("M");
		// 前缀不匹配的路径不会被误判成同一个文件。
		expect(badges.codeFor("/private/var/proj/packages/app/src/a.ts")).toBeNull();
	});

	it("prefers the deepest workspace root when roots are nested", () => {
		const badges = new FileStatusBadges();
		badges.replace([
			slice("/repo", { "a.ts": "M", "packages/app/a.ts": "A" }),
			slice("/repo/packages/app", { "a.ts": "U" }),
		]);
		expect(badges.codeFor("/repo/packages/app/a.ts")).toBe("U");
		expect(badges.codeFor("/repo/a.ts")).toBe("M");
	});

	it("notifies subscribers after each snapshot", () => {
		const badges = new FileStatusBadges();
		const seen: Array<readonly PluginFileExplorerEntry[] | undefined> = [];
		const subscription = badges.provider().onDidChangeDecorations?.((entries) => seen.push(entries));
		badges.replace([]);
		expect(seen).toEqual([undefined]);
		subscription?.dispose();
		badges.replace([]);
		expect(seen).toHaveLength(1);
	});
});

describe("createStatusRefresher", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("reads status once per repo, even with two workspace roots inside it", async () => {
		const readStatus = vi.fn(async () => groups({ unstaged: [{ path: "packages/app/a.ts", code: "M" }] }));
		const snapshots: StatusSlice[][] = [];
		const refresher = createStatusRefresher({
			listRoots: () => [
				{ name: "repo", path: "/repo" },
				{ name: "app", path: "/repo/packages/app" },
			],
			resolveRepo: async (cwd) =>
				cwd === "/repo" ? { root: "/repo", prefix: "" } : { root: "/repo", prefix: "packages/app/" },
			readStatus,
			applySlices: (slices) => snapshots.push([...slices]),
			debounceMs: 10,
		});
		vi.useFakeTimers();
		refresher.schedule();
		refresher.schedule();
		await vi.advanceTimersByTimeAsync(10);
		expect(readStatus).toHaveBeenCalledTimes(1);
		expect(snapshots.at(-1)).toEqual([
			{ workspaceRoot: "/repo", codes: new Map([["packages/app/a.ts", "M"]]), repoPrefix: "" },
			{ workspaceRoot: "/repo/packages/app", codes: new Map([["packages/app/a.ts", "M"]]), repoPrefix: "packages/app/" },
		]);
		refresher.dispose();
	});

	it("keeps the previous letters when a repo read fails", async () => {
		let fail = false;
		const snapshots: StatusSlice[][] = [];
		const refresher = createStatusRefresher({
			listRoots: () => [{ name: "repo", path: "/repo" }],
			resolveRepo: async () => ({ root: "/repo", prefix: "" }),
			readStatus: async () => {
				if (fail) throw new Error("index.lock");
				return groups({ unstaged: [{ path: "a.ts", code: "M" }] });
			},
			applySlices: (slices) => snapshots.push([...slices]),
		});
		await refresher.refresh();
		fail = true;
		await refresher.refresh();
		expect([...snapshots.at(-1)![0]!.codes]).toEqual([["a.ts", "M"]]);
		refresher.dispose();
	});

	it("skips roots that are not repositories and stops after dispose", async () => {
		const applySlices = vi.fn();
		const readStatus = vi.fn(async () => groups());
		const refresher = createStatusRefresher({
			listRoots: () => [{ name: "plain", path: "/plain" }],
			resolveRepo: async () => null,
			readStatus,
			applySlices,
			debounceMs: 10,
		});
		vi.useFakeTimers();
		await refresher.refresh();
		expect(readStatus).not.toHaveBeenCalled();
		expect(applySlices).toHaveBeenCalledWith([]);
		refresher.schedule();
		refresher.dispose();
		await vi.advanceTimersByTimeAsync(50);
		expect(applySlices).toHaveBeenCalledTimes(1);
	});
});
