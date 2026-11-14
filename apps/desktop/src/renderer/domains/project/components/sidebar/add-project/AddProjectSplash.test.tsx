// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: Record<string, unknown>) =>
			options && "count" in options ? `${key}:${String(options.count)}` : key,
	}),
}));

vi.mock("@astravia-org/ui/button", () => ({
	Button: ({ children, ...props }: ComponentProps<"button">) => (
		<button type="button" {...props}>
			{children}
		</button>
	),
}));

import { AddProjectNameStep } from "./AddProjectNameStep";
import { AddProjectRootStep } from "./AddProjectRootStep";
import { AddProjectSplash } from "./AddProjectSplash";
import type { AddProjectMenuItemModel } from "./types";

const items: AddProjectMenuItemModel[] = [
	{
		action: "newProject",
		icon: "icon-[solar--add-folder-linear]",
		labelKey: "actions.newProject",
		descriptionKey: "addProjectSplash.items.newProject",
		onSelect: vi.fn(),
	},
	{
		action: "cloneFromGit",
		icon: "icon-[solar--branching-paths-up-linear]",
		labelKey: "actions.cloneFromGit",
		descriptionKey: "addProjectSplash.items.cloneFromGit",
		onSelect: vi.fn(),
	},
];

/**
 * 添加项目从「一个下拉菜单 + 多个对话框」变成了同一个容器里的分步流程。
 * 用户实际走的是「打开入口 → 选一种方式 → 填完 → 关掉」，所以要按整条路径断言：
 * 入口列表出现、点了进第二步、表单校验拦下空名、返回能回入口。
 */
// 面板首帧要跑 requestAnimationFrame 聚焦，机器负载高时首帧会明显变慢，放宽单测超时。
describe("添加项目 Splash", () => {
	it("打开就列出全部入口，点其中一项进入对应步骤", { timeout: 30_000 }, async () => {
		const onSelect = vi.fn();
		const root = render(
			<AddProjectRootStep
				items={[items[0]!, { ...items[1]!, onSelect }]}
				onClose={vi.fn()}
			/>,
		);
		expect(screen.getByText("actions.newProject")).toBeTruthy();
		await userEvent.click(screen.getByText("actions.cloneFromGit"));
		expect(onSelect).toHaveBeenCalledTimes(1);
		root.unmount();
	});

	it("新建项目：空名与重名都在确认那一刻拦下，合法名字才回调", { timeout: 30_000 }, async () => {
		const onConfirm = vi.fn();
		const isNameTaken = (name: string): boolean => name === "taken";
		const view = render(
			<AddProjectNameStep onConfirm={onConfirm} onBack={vi.fn()} isNameTaken={isNameTaken} />,
		);

		const input = screen.getByRole("textbox", { name: "newProjectDialog.title" });
		await userEvent.type(input, "   ");
		await userEvent.keyboard("{Enter}");
		expect(screen.getByRole("alert").textContent).toBe("newProjectDialog.emptyError");
		expect(onConfirm).not.toHaveBeenCalled();

		await userEvent.clear(input);
		await userEvent.type(input, "taken{Enter}");
		expect(screen.getByRole("alert").textContent).toBe("newProjectDialog.duplicateError");

		await userEvent.clear(input);
		await userEvent.type(input, "新项目{Enter}");
		expect(onConfirm).toHaveBeenCalledWith("新项目");
		view.unmount();
	});

	it("按步骤切换：入口 → 新建 → 返回入口，外层容器始终是同一个对话框", { timeout: 30_000 }, async () => {
		const onClose = vi.fn();
		const props = {
			items,
			onClose,
			isProjectNameTaken: () => false,
			onCreateProject: vi.fn(),
			onCloned: vi.fn(),
			onRemoteConfirm: vi.fn(),
		};
		const view = render(<AddProjectSplash open step="root" {...props} onBack={vi.fn()} />);
		const { rerender } = view;
		expect(screen.getByRole("dialog", { name: "addProjectSplash.title" })).toBeTruthy();

		// 进入第二步：头部换成项目名输入框，容器不换。
		rerender(<AddProjectSplash open step="newProject" {...props} onBack={vi.fn()} />);
		await waitFor(() =>
			expect(screen.getByRole("textbox", { name: "newProjectDialog.title" })).toBeTruthy(),
		);
		expect(screen.getByRole("dialog", { name: "addProjectSplash.title" })).toBeTruthy();

		// 回到入口：内容换回列表，对话框仍只有这一个（不是叠了两层容器）。
		rerender(<AddProjectSplash open step="root" {...props} onBack={vi.fn()} />);
		await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(1));
		view.unmount();
	});
});
