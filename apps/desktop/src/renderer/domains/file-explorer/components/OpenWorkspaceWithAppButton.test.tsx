// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ExternalApplication } from "@preload/api-types/system";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listExternalApplications = vi.fn();
const openPathWithApplication = vi.fn();
const openPathWithDefaultApplication = vi.fn();

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

import { OpenWorkspaceWithAppButton } from "./OpenWorkspaceWithAppButton";

function app(name: string, path: string, kind: ExternalApplication["kind"], isDefault = false): ExternalApplication {
	return { id: path, name, applicationPath: path, kind, isDefault };
}

const apps = [
	app("Visual Studio Code", "/Applications/Visual Studio Code.app", "editor"),
	app("Cursor", "/Applications/Cursor.app", "editor"),
	app("Finder", "/System/Library/CoreServices/Finder.app", "file-manager", true),
	app("iTerm", "/Applications/iTerm.app", "terminal"),
];

beforeEach(() => {
	vi.clearAllMocks();
	localStorage.clear();
	listExternalApplications.mockResolvedValue(apps);
	openPathWithApplication.mockResolvedValue(undefined);
	openPathWithDefaultApplication.mockResolvedValue(undefined);
	Object.defineProperty(window, "astravia", {
		configurable: true,
		value: { shell: { listExternalApplications, openPathWithApplication, openPathWithDefaultApplication } },
	});
});

afterEach(cleanup);

/** jsdom 没有 PointerEvent，Radix 只能从键盘打开菜单。 */
function openMenu(): void {
	fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
}

describe("OpenWorkspaceWithAppButton", () => {
	it("会话没有绑定工作区时按钮照样在，也照样列出本机应用", async () => {
		// 曾经这个按钮只在会话绑定目录时渲染，找不到入口就等于功能不存在。
		render(<OpenWorkspaceWithAppButton rootDir={null} />);

		await waitFor(() => expect(listExternalApplications).toHaveBeenCalledWith(null));
		expect(screen.getByRole("button")).toBeTruthy();
	});

	it("菜单列出探测到的编辑器，并把上次用过的排在最前", async () => {
		localStorage.setItem("astravia:open-workspace:app-id", "/Applications/iTerm.app");
		render(<OpenWorkspaceWithAppButton rootDir="/projects/demo" />);
		await waitFor(() => expect(listExternalApplications).toHaveBeenCalled());
		openMenu();

		const items = await screen.findAllByRole("menuitem");
		const labels = items.map((item) => item.textContent ?? "");
		expect(labels[0]).toContain("iTerm");
		expect(labels.some((label) => label.includes("Visual Studio Code"))).toBe(true);
		expect(labels.some((label) => label.includes("Finder"))).toBe(true);
	});

	it("选中某个编辑器时把分类一起带给主进程，并按工作区目录打开", async () => {
		render(<OpenWorkspaceWithAppButton rootDir="/projects/demo" />);
		await waitFor(() => expect(listExternalApplications).toHaveBeenCalled());
		openMenu();

		const target = await screen.findByText("Cursor");
		fireEvent.click(target);

		await waitFor(() =>
			expect(openPathWithApplication).toHaveBeenCalledWith("/projects/demo", "/Applications/Cursor.app", "editor"),
		);
		expect(localStorage.getItem("astravia:open-workspace:app-id")).toBe("/Applications/Cursor.app");
	});

	it("没有工作区时只启动应用，不传路径", async () => {
		render(<OpenWorkspaceWithAppButton rootDir={null} />);
		await waitFor(() => expect(listExternalApplications).toHaveBeenCalled());
		openMenu();

		fireEvent.click(await screen.findByText("Visual Studio Code"));

		await waitFor(() =>
			expect(openPathWithApplication).toHaveBeenCalledWith(null, "/Applications/Visual Studio Code.app", "editor"),
		);
	});
});
