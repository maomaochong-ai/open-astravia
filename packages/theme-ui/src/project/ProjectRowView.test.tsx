// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectRowView, type ProjectRowViewProps } from "./ProjectRowView";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let container: HTMLDivElement;

afterEach(() => {
	if (root) act(() => root.unmount());
	container?.remove();
});

function renderRow(overrides: Partial<ProjectRowViewProps> = {}): HTMLDivElement {
	const props: ProjectRowViewProps = {
		displayName: "api",
		expanded: false,
		hasRunning: false,
		isActive: false,
		newSessionTitle: "New session",
		onCollapse: () => undefined,
		onExpand: () => undefined,
		onNavigateProject: () => undefined,
		onNewSession: () => undefined,
		onOpenContextMenu: () => undefined,
		projectCwd: "/workspace/api",
		projectType: "normal",
		...overrides,
	};
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	act(() => root.render(<ProjectRowView {...props} />));
	return container;
}

describe("ProjectRowView 远程项目标识", () => {
	it("展开态下仍保留远程标识点，并带上可读的说明", () => {
		const view = renderRow({ remote: true, remoteTitle: "Project on a remote host (SSH)", expanded: true });
		const marker = view.querySelector("[data-remote-project-marker]");
		expect(marker).not.toBeNull();
		expect(marker?.getAttribute("aria-label")).toBe("Project on a remote host (SSH)");
	});

	it("折叠态用服务器图标而不是文件夹图标", () => {
		const view = renderRow({ remote: true, expanded: false });
		expect(view.querySelector(".icon-\\[solar--server-2-linear\\]")).not.toBeNull();
	});

	it("本地项目不出现远程标识", () => {
		const expanded = renderRow({ expanded: true });
		expect(expanded.querySelector("[data-remote-project-marker]")).toBeNull();
		// 折叠态用项目类型图标（普通项目是文件夹），不应该被服务器图标替掉。
		const collapsed = renderRow({ expanded: false });
		expect(collapsed.querySelector("[data-remote-project-marker]")).toBeNull();
		expect(collapsed.querySelector(".icon-\\[solar--folder-linear\\]")).not.toBeNull();
	});
});
