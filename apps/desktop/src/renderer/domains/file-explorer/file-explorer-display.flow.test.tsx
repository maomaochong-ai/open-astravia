// @vitest-environment jsdom
import type { InstalledPlugin } from "@preload/api";
import { i18n, initI18n } from "@shared/i18n";
import { DEFAULT_FILE_EXPLORER_PREFERENCES, readFileExplorerPreferences } from "@shared/lib/file-explorer-preferences";
import { fileExplorerPreferencesAtom, pluginFileExplorerDecorationProvidersAtom, pluginFileIconThemesAtom, type FsEntry } from "@shared/store/atoms";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectFileExplorerContributions } from "../plugins/components/plugin-file-explorer-publication";
import { createPluginFileExplorerApi } from "../plugins/runtime/plugin-file-explorer-context";
import { PluginLocalContributions } from "../plugins/runtime/plugin-local-contributions";
import { FileExplorerSettings } from "./components/FileExplorerSettings";
import { FileTree } from "./components/FileTree";
import { useFileTree } from "./hooks/useFileTree";
import { useFileExplorerSelection } from "./hooks/useFileExplorerSelection";

// jsdom has no layout; only replace the virtualizer's viewport measurement boundary.
vi.mock("react-virtuoso", async () => {
	const React = await import("react");
	return { Virtuoso: React.forwardRef(function Viewport(props: { data: { key: string }[]; itemContent: (index: number, item: { key: string }) => ReactNode }, ref) {
		React.useImperativeHandle(ref, () => ({ scrollIntoView() {} }));
		return <>{props.data.map((item, index) => <div key={item.key}>{props.itemContent(index, item)}</div>)}</>;
	}) };
});

const entry = (name: string, isDirectory = false): FsEntry => ({ name, path: `/project/${name}`, isDirectory, size: 1, modifiedAt: 0 });
const readDir = vi.fn(async (path: string) => path === "/project" ? [entry(".env"), entry(".github", true), entry("index.ts"), entry("debug.log")] : []);
const noop = () => {};

function Explorer() {
	const tree = useFileTree("/project");
	const selection = useFileExplorerSelection({ rootDir: tree.rootDir, cache: tree.cache, expandedDirs: tree.expandedDirs });
	return <><FileExplorerSettings /><FileTree rootDir="/project" cache={tree.cache} expandedDirs={tree.expandedDirs} loadingDirs={tree.loadingDirs}
		selectedPaths={selection.selectedPaths} focusedPath={selection.focusedPath} creatingEntry={null}
		onToggleDir={tree.toggleDir} onSelectEntry={selection.selectEntry} onSelectPaths={selection.selectPaths} onBackgroundClick={selection.clear}
		onRename={tree.renameEntry} onFileMove={noop} onExternalDrop={noop} onNativeDragStart={noop} onContextMenu={noop} onRootContextMenu={noop} onCreateSubmit={noop} onCreateCancel={noop} />
		<output aria-label="selected">{selection.selectedEntries.map((item) => item.name).join(",")}</output></>;
}

beforeEach(async () => {
	HTMLElement.prototype.hasPointerCapture = () => false;
	HTMLElement.prototype.scrollIntoView = noop;
	localStorage.clear();
	Object.defineProperty(window, "vetta", { configurable: true, value: { fs: { readDir, watchDir: vi.fn(), unwatchDir: vi.fn(), onDirChanged: () => noop } } });
	initI18n();
	await i18n.changeLanguage("en");
	readDir.mockClear();
});
afterEach(() => cleanup());

describe("file explorer display user flows", () => {
	it("shows dotfiles, hides them on request, removes hidden selections, persists and restores display settings", async () => {
		const user = userEvent.setup();
		const store = createStore();
		store.set(fileExplorerPreferencesAtom, DEFAULT_FILE_EXPLORER_PREFERENCES);
		const view = render(<Provider store={store}><Explorer /></Provider>);
		await screen.findByText(".env");
		await user.click(screen.getByText(".env"));
		expect(screen.getByLabelText("selected").textContent).toBe(".env");
		await user.click(screen.getByRole("button", { name: "File display settings" }));
		await user.click(screen.getByRole("switch", { name: "Show dotfiles and folders" }));
		await waitFor(() => expect(screen.queryByText(".env")).toBeNull());
		expect(screen.queryByText(".github")).toBeNull();
		expect(screen.getByLabelText("selected").textContent).toBe("");
		fireEvent.change(screen.getByLabelText("Exclude patterns"), { target: { value: "**/*.log" } });
		await user.click(screen.getByRole("button", { name: "Apply exclude patterns" }));
		expect(screen.queryByText("debug.log")).toBeNull();
		expect(readFileExplorerPreferences()).toMatchObject({ showHidden: false, exclude: ["**/*.log"] });
		view.unmount();
		const restored = createStore();
		restored.set(fileExplorerPreferencesAtom, readFileExplorerPreferences());
		render(<Provider store={restored}><Explorer /></Provider>);
		await screen.findByText("index.ts");
		expect(screen.queryByText(".env")).toBeNull();
		await user.click(screen.getByRole("button", { name: "File display settings" }));
		await user.click(screen.getByRole("button", { name: "Restore default display" }));
		await screen.findByText(".env");
		expect(screen.getByText("debug.log")).toBeTruthy();
	});

	it("selects plugin icons, updates independent status without disk reads, and restores a re-enabled theme", async () => {
		const user = userEvent.setup();
		const store = createStore();
		store.set(fileExplorerPreferencesAtom, DEFAULT_FILE_EXPLORER_PREFERENCES);
		const contributions = new PluginLocalContributions();
		const disposers: Array<() => void> = [];
		const publish = () => {
			const current = collectFileExplorerContributions([{ id: "example", fileExplorerDecorationProviders: contributions.fileExplorerDecorationProviders, fileIconThemes: contributions.fileIconThemes }]);
			store.set(pluginFileExplorerDecorationProvidersAtom, current.decorations);
			store.set(pluginFileIconThemesAtom, current.themes);
		};
		const permissions = ["ui.file-explorer.decorations"];
		const api = createPluginFileExplorerApi({ plugin: { id: "example", permissions, grantedPermissions: permissions } as unknown as InstalledPlugin, contributions, disposers, onChanged: publish });
		const theme = { id: "icons", label: "Example icons", iconDefinitions: { ts: <span aria-label="TypeScript icon">T</span> }, fileExtensions: { ts: "ts" } };
		const registration = api.registerIconTheme(theme);
		let status = "M";
		let emit: (entries?: readonly FsEntry[]) => void = noop;
		api.registerDecorationProvider({ id: "git", when: { extensions: ["ts"] }, provideDecoration: () => ({ badge: status, tooltip: status === "M" ? "Modified" : "Added", color: status === "M" ? "warning" : "success" }), onDidChangeDecorations(listener) { emit = listener; return { dispose: noop }; } });
		render(<Provider store={store}><Explorer /></Provider>);
		await screen.findByText("index.ts");
		await user.click(screen.getByRole("button", { name: "File display settings" }));
		await user.click(screen.getByRole("combobox", { name: "File icon theme" }));
		await user.click(screen.getByRole("option", { name: "Example icons" }));
		expect(screen.getByLabelText("TypeScript icon")).toBeTruthy();
		expect(screen.getByText("M")).toBeTruthy();
		expect(screen.getByText("index.ts").className).toContain("text-amber-400");
		readDir.mockClear();
		act(() => { status = "A"; emit([entry("index.ts")]); });
		expect(screen.getByText("A")).toBeTruthy();
		expect(screen.getByText("index.ts").closest('[role="treeitem"]')?.getAttribute("aria-description")).toBe("Added");
		expect(screen.getByText("index.ts").className).toContain("text-emerald-400");
		expect(readDir).not.toHaveBeenCalled();
		act(() => registration.dispose());
		expect(screen.queryByLabelText("TypeScript icon")).toBeNull();
		expect(readFileExplorerPreferences().iconTheme).toBe("example:icons");
		act(() => { api.registerIconTheme(theme); });
		expect(screen.getByLabelText("TypeScript icon")).toBeTruthy();
		act(() => { for (const dispose of disposers) dispose(); });
	});
});
