// @vitest-environment jsdom
import { type FsEntry, expandedDirsAtom, fileExplorerRevealRequestAtom, fileTreeCacheAtom } from "@shared/store/atoms";
import { act, renderHook, waitFor } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { type ReactElement, isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFilesPanelModel } from "./useFilesPanelModel";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { language: "zh" } }),
}));

// 图标光栅化依赖 CSSOM / Image，jsdom 里没有；与定位无关，直接置空。
vi.mock("../services/rasterize-app-file-icon", () => ({
	cacheAppFileDragIcons: async () => {},
}));

const ROOT = "/ws";

function entry(name: string, path: string, isDirectory: boolean): FsEntry {
	return { name, path, isDirectory, size: 0, modifiedAt: 0 };
}

const DIRECTORIES: Record<string, FsEntry[]> = {
	[ROOT]: [entry("src", `${ROOT}/src`, true), entry("README.md", `${ROOT}/README.md`, false)],
	[`${ROOT}/src`]: [entry("main.ts", `${ROOT}/src/main.ts`, false)],
};

/** `tree` 是 FileTree 元素，选中/聚焦/展开状态都在它的 props 上。 */
function treeProps(tree: unknown): {
	expandedDirs: Set<string>;
	selectedPaths: Set<string>;
	focusedPath: string | null;
} {
	if (!isValidElement(tree)) throw new Error("expected a FileTree element");
	return (tree as ReactElement<{ expandedDirs: Set<string>; selectedPaths: Set<string>; focusedPath: string | null }>)
		.props;
}

describe("useFilesPanelModel 消费文件树定位请求", () => {
	beforeEach(() => {
		const store = getDefaultStore();
		store.set(fileTreeCacheAtom, new Map());
		store.set(expandedDirsAtom, new Set());
		store.set(fileExplorerRevealRequestAtom, null);
		window.astravia = {
			fs: {
				readDir: vi.fn(async (path: string) => DIRECTORIES[path] ?? []),
				watchDir: vi.fn(async () => {}),
				unwatchDir: vi.fn(async () => {}),
				onDirChanged: vi.fn(() => () => {}),
			},
		} as unknown as typeof window.astravia;
	});

	it("展开祖先目录，并选中 / 聚焦到聊天里点开的那个文件", async () => {
		const store = getDefaultStore();
		const { result } = renderHook(() => useFilesPanelModel(ROOT));
		await waitFor(() => expect(treeProps(result.current.tree).expandedDirs.size).toBe(0));

		act(() => store.set(fileExplorerRevealRequestAtom, `${ROOT}/src/main.ts`));

		await waitFor(() => expect(treeProps(result.current.tree).focusedPath).toBe(`${ROOT}/src/main.ts`));
		expect(treeProps(result.current.tree).expandedDirs.has(`${ROOT}/src`)).toBe(true);
		expect(treeProps(result.current.tree).selectedPaths.has(`${ROOT}/src/main.ts`)).toBe(true);
		// 请求是一次性的：消费后清空，避免重开面板又跳一次。
		expect(store.get(fileExplorerRevealRequestAtom)).toBeNull();
	});

	it("同一路径再次点开时仍会重新处理", async () => {
		const store = getDefaultStore();
		const { result } = renderHook(() => useFilesPanelModel(ROOT));
		await waitFor(() => expect(treeProps(result.current.tree).expandedDirs.size).toBe(0));

		const readDir = window.astravia.fs.readDir as unknown as ReturnType<typeof vi.fn>;
		act(() => store.set(fileExplorerRevealRequestAtom, `${ROOT}/src/main.ts`));
		await waitFor(() => expect(store.get(fileExplorerRevealRequestAtom)).toBeNull());
		const callsAfterFirstReveal = readDir.mock.calls.length;

		act(() => store.set(fileExplorerRevealRequestAtom, `${ROOT}/src/main.ts`));

		await waitFor(() => expect(readDir.mock.calls.length).toBeGreaterThan(callsAfterFirstReveal));
		expect(store.get(fileExplorerRevealRequestAtom)).toBeNull();
	});

	it("不在本面板工作区里的路径不动它，留给真正的宿主面板", async () => {
		const store = getDefaultStore();
		const { result } = renderHook(() => useFilesPanelModel(ROOT));
		await waitFor(() => expect(treeProps(result.current.tree).expandedDirs.size).toBe(0));

		act(() => store.set(fileExplorerRevealRequestAtom, "/elsewhere/app.ts"));

		await waitFor(() => expect(treeProps(result.current.tree).focusedPath).toBeNull());
		expect(store.get(fileExplorerRevealRequestAtom)).toBe("/elsewhere/app.ts");
	});
});
