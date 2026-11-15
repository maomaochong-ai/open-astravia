// @vitest-environment jsdom
import type { FsEntry } from "@shared/store/atoms";
import { fileTreeCacheAtom } from "@shared/store/atoms";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getDefaultStore } from "jotai";
import { type ReactElement, isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFilesPanelModel } from "./useFilesPanelModel";

/**
 * 目录树工具栏：新建文件与新建文件夹合并进一个下拉按钮，
 * 两个入口仍然各自可用，新建态仍然落在树上。
 */

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { language: "zh" } }),
}));
vi.mock("../services/rasterize-app-file-icon", () => ({
	cacheAppFileDragIcons: async () => {},
}));

const ROOT = "/ws";

function entry(name: string, path: string, isDirectory: boolean): FsEntry {
	return { name, path, isDirectory, size: 0, modifiedAt: 0 };
}

const DIRECTORIES: Record<string, FsEntry[]> = {
	[ROOT]: [entry("src", `${ROOT}/src`, true), entry("README.md", `${ROOT}/README.md`, false)],
	[`${ROOT}/src`]: [],
};

function treeCreatingEntry(tree: unknown): { kind: string; parentPath: string } | null {
	if (!isValidElement(tree)) throw new Error("expected a FileTree element");
	const props = (tree as ReactElement<{ creatingEntry: { kind: string; parentPath: string } | null }>).props;
	return props.creatingEntry;
}

describe("目录树工具栏的新建下拉", () => {
	beforeEach(() => {
		getDefaultStore().set(fileTreeCacheAtom, new Map());
		window.astravia = {
			fs: {
				readDir: vi.fn(async (path: string) => DIRECTORIES[path] ?? []),
				watchDir: vi.fn(async () => {}),
				unwatchDir: vi.fn(async () => {}),
				onDirChanged: vi.fn(() => () => {}),
			},
		} as unknown as typeof window.astravia;
	});

	it("工具栏只有一个新建按钮，展开后给出文件与文件夹两项", async () => {
		const { result } = renderHook(() => useFilesPanelModel(ROOT));
		await waitFor(() => expect(treeCreatingEntry(result.current.tree)).toBeNull());

		render(<>{result.current.toolbarActions as ReactElement}</>);
		expect(screen.queryAllByTitle("fileExplorer.newFile")).toHaveLength(0);
		expect(screen.queryAllByTitle("fileExplorer.newFolder")).toHaveLength(0);

		await userEvent.click(screen.getByTitle("fileExplorer.newMenu"));
		expect(await screen.findByText("fileExplorer.newFile")).toBeTruthy();
		expect(screen.getByText("fileExplorer.newFolder")).toBeTruthy();
	});

	it("从下拉里选新建文件，会让树进入根目录下的新建态", async () => {
		const { result } = renderHook(() => useFilesPanelModel(ROOT));
		await waitFor(() => expect(treeCreatingEntry(result.current.tree)).toBeNull());
		render(<>{result.current.toolbarActions as ReactElement}</>);

		await userEvent.click(screen.getByTitle("fileExplorer.newMenu"));
		await userEvent.click(await screen.findByText("fileExplorer.newFile"));

		await waitFor(() => expect(treeCreatingEntry(result.current.tree)?.kind).toBe("file"));
		expect(treeCreatingEntry(result.current.tree)?.parentPath).toBe(ROOT);
	});

	it("从下拉里选新建文件夹，进入的是文件夹新建态", async () => {
		const { result } = renderHook(() => useFilesPanelModel(ROOT));
		await waitFor(() => expect(treeCreatingEntry(result.current.tree)).toBeNull());
		render(<>{result.current.toolbarActions as ReactElement}</>);

		await userEvent.click(screen.getByTitle("fileExplorer.newMenu"));
		await userEvent.click(await screen.findByText("fileExplorer.newFolder"));

		await waitFor(() => expect(treeCreatingEntry(result.current.tree)?.kind).toBe("directory"));
	});
});
