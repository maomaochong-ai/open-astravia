/**
 * 画布已经开着时的「打开这份设计」请求。
 *
 * 复现的 bug：同一 cwd 里有两份 .vetd，画布开着时 vetd_create / 画廊 / 文件树右键
 * 请求打开第二份，画布仍停在第一份，左上角下拉也只有一份——pending 路径只在画布
 * 挂载时才被取走、设计列表也只在挂载时扫一次，得关掉整个活动面板重开才生效。
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	designs: [] as string[],
	startDesignServer: vi.fn(),
	// 必须是稳定引用：t 在开设计那个 effect 的依赖里，每次渲染换新函数会无限重开。
	t: (key: string) => key,
	notesVisibility: { visible: true, show: () => undefined, toggle: () => undefined },
}));

vi.mock("@vetta-org/plugin-sdk", () => ({
	useActivityTab: () => ({ cwd: "C:/project" }),
	useTranslation: () => ({ t: mocks.t }),
}));

vi.mock("../src/engine/engine-manager", () => ({
	startDesignServer: mocks.startDesignServer,
	stopDesignServer: () => Promise.resolve(),
}));

vi.mock("../src/vetd/design-session", () => ({
	DesignSession: class {
		dirPath: string;
		vetdPath: string;
		manifest = { frames: [] };
		constructor(_ctx: unknown, path: string) {
			this.dirPath = path;
			this.vetdPath = path;
		}
		open(): Promise<void> {
			return Promise.resolve();
		}
		dispose(): void {}
	},
}));

vi.mock("../src/notes/notes-store", () => ({
	NotesStore: class {
		load(): Promise<void> {
			return Promise.resolve();
		}
		dispose(): void {}
	},
}));

vi.mock("../src/notes/notes-visibility", () => ({
	useNotesVisibility: () => mocks.notesVisibility,
}));

vi.mock("../src/plugin-context", () => ({
	getPluginCtx: () => ({ fs: {}, ui: { setActivityPanelWidth: vi.fn() } }),
	notify: vi.fn(),
}));

vi.mock("../src/vetd/discover", () => ({ findVetdFiles: () => Promise.resolve([...mocks.designs]) }));
vi.mock("../src/vetd/scaffold", () => ({ scaffoldDesign: vi.fn() }));
vi.mock("../src/export/export-design", () => ({ exportDesign: vi.fn() }));
vi.mock("../src/canvas/cover-compose", () => ({ refreshCover: () => Promise.resolve() }));
vi.mock("../src/canvas/bridge-client", () => ({ BridgeHub: class {} }));
vi.mock("../src/canvas/DesignCanvas", () => ({
	DesignCanvas: ({ titleSlot }: { titleSlot: ReactNode }) => <div data-testid="design-canvas">{titleSlot}</div>,
}));
vi.mock("../src/canvas/ThemePalette", () => ({ ThemePalette: () => null }));
vi.mock("../src/preview-mode/PreviewDialog", () => ({ PreviewDialog: () => null }));

import { CanvasTab } from "../src/canvas/CanvasTab";
import { setPendingDesignPath } from "../src/canvas/design-runtime";

const FIRST = "C:/project/first.vetd";
const SECOND = "C:/project/second.vetd";

let root: Root;
let host: HTMLDivElement;

async function flush(): Promise<void> {
	await act(async () => {
		for (let index = 0; index < 12; index += 1) await Promise.resolve();
	});
}

function picker(): HTMLSelectElement {
	const select = host.querySelector("select");
	if (!select) throw new Error("design picker not rendered");
	return select;
}

beforeEach(() => {
	(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
	// Node 26 自带的全局 localStorage 会盖住 happy-dom 的实现，这里给一份内存版。
	const store = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => void store.set(key, value),
		removeItem: (key: string) => void store.delete(key),
		clear: () => store.clear(),
	});
	mocks.designs = [FIRST];
	mocks.startDesignServer.mockReset();
	mocks.startDesignServer.mockImplementation(async (_ctx: unknown, dir: string) => ({
		port: 53114,
		whenExited: new Promise(() => undefined),
		handle: {},
		designDir: dir,
	}));
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
});

afterEach(async () => {
	await act(async () => root.unmount());
	host.remove();
	vi.unstubAllGlobals();
});

it.each([
	["scoped to the canvas cwd (vetd_create / gallery)", "C:/project"],
	["unscoped (file explorer context menu)", undefined],
])("switches an already-open canvas to a newly requested design — %s", async (_label, cwd) => {
	await act(async () => root.render(<CanvasTab />));
	await flush();
	expect(mocks.startDesignServer).toHaveBeenLastCalledWith(expect.anything(), FIRST, expect.any(Function));

	mocks.designs = [FIRST, SECOND];
	await act(async () => setPendingDesignPath(SECOND, cwd));
	await flush();

	expect([...picker().options].map((option) => option.value)).toEqual([FIRST, SECOND]);
	expect(picker().value).toBe(SECOND);
	expect(mocks.startDesignServer).toHaveBeenLastCalledWith(expect.anything(), SECOND, expect.any(Function));
});

it("leaves a request for another project's cwd for that project's canvas", async () => {
	await act(async () => root.render(<CanvasTab />));
	await flush();

	mocks.designs = [FIRST, SECOND];
	await act(async () => setPendingDesignPath("D:/other/x.vetd", "D:/other"));
	await flush();

	expect(picker().value).toBe(FIRST);
	expect(mocks.startDesignServer).toHaveBeenCalledTimes(1);
});
