import type { PluginCommandSpawnExit } from "@vetta-org/plugin-sdk";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

interface QueuedServer {
	port: number;
	whenExited: Promise<PluginCommandSpawnExit>;
	resolveExit(exit: PluginCommandSpawnExit): void;
}

const mocks = vi.hoisted(() => ({
	servers: [] as QueuedServer[],
	startDesignServer: vi.fn(),
	stopDesignServer: vi.fn(() => Promise.resolve()),
	setCanvasController: vi.fn(),
	notify: vi.fn(),
	notesVisibility: { visible: true, show: vi.fn(), toggle: vi.fn() },
	t: (key: string, values?: Record<string, string | number>) =>
		values
			? Object.entries(values).reduce(
					(text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
					key === "engine.status.restarting"
						? "restarting {{attempt}}/{{max}}"
						: key === "engine.error.exited"
							? "exited: {{reason}}"
							: key,
				)
			: key,
}));

vi.mock("@vetta-org/plugin-sdk", () => ({
	useActivityTab: () => ({ cwd: "C:/project" }),
	useTranslation: () => ({ t: mocks.t }),
}));

vi.mock("../src/engine/engine-manager", () => ({
	startDesignServer: mocks.startDesignServer,
	stopDesignServer: mocks.stopDesignServer,
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
	notify: mocks.notify,
}));

vi.mock("../src/vetd/discover", () => ({ findVetdFiles: () => Promise.resolve(["C:/project/demo.vetd"]) }));
vi.mock("../src/vetd/scaffold", () => ({ scaffoldDesign: vi.fn() }));
vi.mock("../src/export/export-design", () => ({ exportDesign: vi.fn() }));
vi.mock("../src/canvas/cover-compose", () => ({ refreshCover: () => Promise.resolve() }));
vi.mock("../src/canvas/design-runtime", () => ({
	clearFrameActivity: vi.fn(),
	setCanvasController: mocks.setCanvasController,
	setPendingDesignPath: vi.fn(),
	takePendingDesignPath: () => null,
}));
vi.mock("../src/canvas/bridge-client", () => ({ BridgeHub: class {} }));
vi.mock("../src/canvas/DesignCanvas", () => ({
	DesignCanvas: ({ port }: { port: number }) => <div data-testid="design-canvas" data-port={port} />,
}));
vi.mock("../src/canvas/ThemePalette", () => ({ ThemePalette: () => null }));
vi.mock("../src/preview-mode/PreviewDialog", () => ({ PreviewDialog: () => null }));

import { CanvasTab } from "../src/canvas/CanvasTab";

let root: Root;
let host: HTMLDivElement;

function queueServer(port: number): QueuedServer {
	let resolveExit: (exit: PluginCommandSpawnExit) => void = () => undefined;
	const server: QueuedServer = {
		port,
		whenExited: new Promise((resolve) => {
			resolveExit = resolve;
		}),
		resolveExit: (exit) => resolveExit(exit),
	};
	mocks.servers.push(server);
	return server;
}

async function flush(): Promise<void> {
	await act(async () => {
		for (let index = 0; index < 12; index += 1) await Promise.resolve();
	});
}

beforeEach(() => {
	vi.useFakeTimers();
	(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
	localStorage.clear();
	mocks.servers.length = 0;
	mocks.startDesignServer.mockReset();
	mocks.stopDesignServer.mockClear();
	mocks.setCanvasController.mockClear();
	mocks.notify.mockClear();
	mocks.startDesignServer.mockImplementation(async () => {
		const server = mocks.servers.shift();
		if (!server) throw new Error("no queued engine server");
		return { ...server, handle: {}, designDir: "C:/project/demo.vetd" };
	});
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
});

afterEach(async () => {
	await act(async () => root.unmount());
	host.remove();
	vi.useRealTimers();
});

it("unmounts consumers of a dead port and restarts the design engine automatically", async () => {
	const first = queueServer(53114);
	queueServer(53120);
	await act(async () => root.render(<CanvasTab />));
	await flush();

	expect(host.querySelector('[data-testid="design-canvas"]')?.getAttribute("data-port")).toBe("53114");

	await act(async () => first.resolveExit({ exitCode: 1, signal: null }));
	await flush();
	expect(host.querySelector('[data-testid="design-canvas"]')).toBeNull();
	expect(host.textContent).toContain("restarting 1/3");

	await act(async () => vi.advanceTimersByTimeAsync(250));
	await flush();
	expect(mocks.startDesignServer).toHaveBeenCalledTimes(2);
	expect(host.querySelector('[data-testid="design-canvas"]')?.getAttribute("data-port")).toBe("53120");
});
