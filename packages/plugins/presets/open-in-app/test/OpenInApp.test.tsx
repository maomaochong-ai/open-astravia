import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const conversation = { cwd: "/Users/me/project" as string | null };
vi.mock("@astravia-org/plugin-sdk", () => ({
	useActiveConversation: () => conversation,
	useTranslation: () => ({ t: (key: string) => key }),
}));

import type { PluginExternalApplication, PluginHeaderActionState } from "@astravia-org/plugin-sdk";
import { releaseHostApis, setHostApis, useOpenInAppAction } from "../src/OpenInApp";

const PROJECT = "/Users/me/project";

function createShell(applications: PluginExternalApplication[] = []) {
	return {
		listExternalApplications: vi.fn(async () => applications),
		openPathWithApplication: vi.fn(async () => undefined),
		openPathWithDefaultApplication: vi.fn(async () => undefined),
	};
}

const code: PluginExternalApplication = {
	id: "/Applications/Visual Studio Code.app",
	name: "Visual Studio Code",
	kind: "editor",
	iconUrl: "data:image/png;base64,code",
	isDefault: false,
};
const explorer: PluginExternalApplication = { id: "C:\\Windows\\explorer.exe", name: "File Explorer", kind: "file-manager", isDefault: true };
const terminal: PluginExternalApplication = { id: "wt", name: "Windows Terminal", kind: "terminal", isDefault: false };

/** 像宿主探针那样调用声明 hook，返回最近一次的声明。 */
async function declare(): Promise<{ current: PluginHeaderActionState | null }> {
	const latest: { current: PluginHeaderActionState | null } = { current: null };
	function Probe(): null {
		latest.current = useOpenInAppAction();
		return null;
	}
	const app = document.createElement("div");
	document.body.append(app);
	await act(async () => {
		createRoot(app).render(<Probe />);
	});
	// 让探测的 Promise 落地。
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	return latest;
}

beforeEach(() => {
	conversation.cwd = PROJECT;
});

afterEach(() => {
	document.body.replaceChildren();
	setHostApis(undefined, undefined);
});

describe("useOpenInAppAction", () => {
	it("declares null until the host answers", async () => {
		const shell = createShell([code]);
		// 探测永不返回：宿主这一帧拿到 null，按钮既不显示也不占位。
		shell.listExternalApplications.mockImplementation(() => new Promise(() => {}));
		setHostApis(shell as never, vi.fn());
		expect((await declare()).current).toBeNull();
	});

	it("lists what the host found and keeps a default-open fallback last", async () => {
		const shell = createShell([code, explorer, terminal]);
		setHostApis(shell as never, vi.fn());
		const state = (await declare()).current;
		expect(state?.title).toBe("action.title");
		expect(state?.onClick).toBeUndefined();
		const items = state?.menuItems ?? [];
		expect(items.map((item) => item.id)).toEqual([code.id, explorer.id, terminal.id, "__default"]);
		expect(shell.listExternalApplications).toHaveBeenCalledWith(PROJECT);
		// 文件管理器用通用文案，其余用应用自己的名字。
		expect(items[1]?.label).toBe("app.reveal");
		expect(items[0]?.label).toBe("Visual Studio Code");
		expect(items[3]?.label).toBe("action.openDefault");
	});

	it("still offers the default-open entry when nothing was detected", async () => {
		setHostApis(createShell([]) as never, vi.fn());
		const state = (await declare()).current;
		expect(state?.menuItems?.map((item) => item.id)).toEqual(["__default"]);
	});

	it("keeps the default-open entry when the host reports more apps than the menu can hold", async () => {
		// 宿主对 menuItems 的硬上限是 20 项，超出的直接丢掉；恰好 20 个应用时末尾的默认项不能被裁掉。
		const many = Array.from({ length: 25 }, (_, index) => ({ id: `app-${index}`, name: `App ${index}`, kind: "editor" as const, isDefault: false }));
		setHostApis(createShell(many) as never, vi.fn());
		const items = (await declare()).current?.menuItems ?? [];
		expect(items).toHaveLength(20);
		expect(items.at(-1)?.id).toBe("__default");
	});

	it("opens the chosen app through the host, so no platform command is built here", async () => {
		const shell = createShell([code, terminal]);
		setHostApis(shell as never, vi.fn());
		const state = (await declare()).current;
		state?.menuItems?.find((item) => item.id === terminal.id)?.onSelect();
		await act(async () => {});
		expect(shell.openPathWithApplication).toHaveBeenCalledWith(PROJECT, terminal.id, "terminal");
	});

	it("opens with the system default app", async () => {
		const shell = createShell([code]);
		setHostApis(shell as never, vi.fn());
		const state = (await declare()).current;
		state?.menuItems?.find((item) => item.id === "__default")?.onSelect();
		await act(async () => {});
		expect(shell.openPathWithDefaultApplication).toHaveBeenCalledWith(PROJECT);
	});

	it("notifies the user when opening fails", async () => {
		const shell = createShell([code]);
		shell.openPathWithApplication.mockRejectedValue(new Error("launch failed"));
		const notify = vi.fn();
		setHostApis(shell as never, notify);
		const state = (await declare()).current;
		state?.menuItems?.find((item) => item.id === code.id)?.onSelect();
		await act(async () => {});
		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify.mock.calls[0]?.[0]).toMatchObject({ message: "error.failed", variant: "error" });
	});

	it("declares null for an SSH remote project so the host collapses the slot", async () => {
		conversation.cwd = "ssh://host/home/me/project";
		const shell = createShell([code]);
		setHostApis(shell as never, vi.fn());
		expect((await declare()).current).toBeNull();
		// 远端目录不去问本机装了哪些应用。
		expect(shell.listExternalApplications).not.toHaveBeenCalled();
	});

	it("declares null when there is no active directory", async () => {
		conversation.cwd = null;
		setHostApis(createShell([code]) as never, vi.fn());
		expect((await declare()).current).toBeNull();
	});

	it("works on Windows and Linux exactly like on macOS", async () => {
		for (const platform of ["Win32", "Linux x86_64", "MacIntel"]) {
			Object.defineProperty(navigator, "platform", { value: platform, configurable: true });
			setHostApis(createShell([code]) as never, vi.fn());
			expect((await declare()).current?.menuItems?.length).toBe(2);
			document.body.replaceChildren();
		}
	});
});

describe("releaseHostApis", () => {
	it("does not wipe the apis of a newer activation", async () => {
		const older = createShell([]);
		const newer = createShell([code]);
		setHostApis(older as never, vi.fn());
		setHostApis(newer as never, vi.fn());
		releaseHostApis(older as never);
		expect((await declare()).current).not.toBeNull();
	});
});
