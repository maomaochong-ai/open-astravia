// @vitest-environment jsdom
/**
 * 项目选择器的交互契约：搜索框的出现阈值、键盘选中、「不指定项目」回退，
 * 以及「新建项目」只登记待创建意向、并在重名时当场拦下。
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openProject = vi.fn(async () => "/w/picked");

vi.mock("@domains/project/hooks/useProjects", () => ({
	useProjectActions: () => ({ openProject }),
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { exists: () => true } }),
}));

const { NewSessionProjectSelector } = await import("./NewSessionProjectSelector.js");

const FEW = [
	{ cwd: "/w/alpha", name: "Alpha" },
	{ cwd: "/w/beta", name: "Beta" },
];

const MANY = [
	...FEW,
	{ cwd: "/w/gamma", name: "Gamma" },
	{ cwd: "/w/delta", name: "Delta" },
	{ cwd: "/w/epsilon", name: "Epsilon" },
	{ cwd: "/w/zeta", name: "Zeta" },
];

function renderSelector(
	overrides: Partial<Parameters<typeof NewSessionProjectSelector>[0]> = {},
): {
	readonly onSelectProject: ReturnType<typeof vi.fn>;
	readonly onSelectPendingProject: ReturnType<typeof vi.fn>;
} {
	const onSelectProject = vi.fn();
	const onSelectPendingProject = vi.fn();
	render(
		<NewSessionProjectSelector
			selection={null}
			options={FEW}
			takenNames={["Alpha", "Beta"]}
			creating={false}
			onSelectProject={onSelectProject}
			onSelectPendingProject={onSelectPendingProject}
			{...overrides}
		/>,
	);
	return { onSelectProject, onSelectPendingProject };
}

describe("NewSessionProjectSelector", () => {
	beforeEach(() => vi.clearAllMocks());

	it("未选中时 trigger 显示占位文案", () => {
		renderSelector();
		const trigger = screen.getByRole("button", { name: "newSession.projectSelector.triggerTitle" });
		expect(trigger.textContent).toContain("newSession.projectSelector.placeholder");
	});

	it("选中项目后 trigger 显示项目名；待创建项目额外带一个轻量标记", () => {
		const { unmount } = render(
			<NewSessionProjectSelector
				selection={{ kind: "project", cwd: "/w/alpha", name: "Alpha" }}
				options={FEW}
				takenNames={[]}
				creating={false}
				onSelectProject={vi.fn()}
				onSelectPendingProject={vi.fn()}
			/>,
		);
		expect(screen.getByRole("button", { name: /triggerTitle/ }).textContent).toContain("Alpha");
		unmount();

		render(
			<NewSessionProjectSelector
				selection={{ kind: "pending-create", name: "新项目" }}
				options={FEW}
				takenNames={[]}
				creating={false}
				onSelectProject={vi.fn()}
				onSelectPendingProject={vi.fn()}
			/>,
		);
		const trigger = screen.getByRole("button", { name: /triggerTitle/ });
		expect(trigger.textContent).toContain("新项目");
		expect(trigger.textContent).toContain("newSession.projectSelector.pendingHint");
	});

	it("正在创建项目时 trigger 换成创建中文案并停止响应点击", async () => {
		const user = userEvent.setup();
		renderSelector({ selection: { kind: "pending-create", name: "新项目" }, creating: true });

		const trigger = screen.getByRole("button", { name: /triggerTitle/ });
		expect(trigger.textContent).toContain("newSession.projectSelector.creating");
		expect((trigger as HTMLButtonElement).disabled).toBe(true);

		await user.click(trigger);
		expect(screen.queryByText("Alpha")).toBeNull();
	});

	it("项目不超过 5 个时没有搜索框，超过后才出现", async () => {
		const user = userEvent.setup();
		const { unmount } = render(
			<NewSessionProjectSelector
				selection={null}
				options={FEW}
				takenNames={[]}
				creating={false}
				onSelectProject={vi.fn()}
				onSelectPendingProject={vi.fn()}
			/>,
		);
		await user.click(screen.getByRole("button", { name: /triggerTitle/ }));
		expect(screen.queryByLabelText("newSession.projectSelector.searchPlaceholder")).toBeNull();
		unmount();

		render(
			<NewSessionProjectSelector
				selection={null}
				options={MANY}
				takenNames={[]}
				creating={false}
				onSelectProject={vi.fn()}
				onSelectPendingProject={vi.fn()}
			/>,
		);
		await user.click(screen.getByRole("button", { name: /triggerTitle/ }));
		expect(screen.getByLabelText("newSession.projectSelector.searchPlaceholder")).toBeTruthy();
	});

	it("搜索过滤后用 ↑↓ 与回车选中，无需回到鼠标", async () => {
		const user = userEvent.setup();
		const onSelectProject = vi.fn();
		render(
			<NewSessionProjectSelector
				selection={null}
				options={MANY}
				takenNames={[]}
				creating={false}
				onSelectProject={onSelectProject}
				onSelectPendingProject={vi.fn()}
			/>,
		);

		await user.click(screen.getByRole("button", { name: /triggerTitle/ }));
		const search = screen.getByLabelText("newSession.projectSelector.searchPlaceholder");
		await user.type(search, "ta");
		// Beta / Delta / Zeta 命中，Alpha 被过滤掉。
		expect(screen.queryByRole("button", { name: "Alpha" })).toBeNull();

		await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
		expect(onSelectProject).toHaveBeenCalledWith("/w/delta");
	});

	it("点「不指定项目」回到未选中态", async () => {
		const user = userEvent.setup();
		const { onSelectProject } = renderSelector({
			selection: { kind: "project", cwd: "/w/alpha", name: "Alpha" },
		});

		await user.click(screen.getByRole("button", { name: /triggerTitle/ }));
		await user.click(screen.getByRole("button", { name: /projectSelector\.clear/ }));

		expect(onSelectProject).toHaveBeenCalledWith(null);
	});

	it("「新建项目」只登记待创建意向，此刻不创建任何目录", async () => {
		const user = userEvent.setup();
		const { onSelectPendingProject, onSelectProject } = renderSelector();

		await user.click(screen.getByRole("button", { name: /triggerTitle/ }));
		await user.click(screen.getByRole("button", { name: /projectSelector\.newProject/ }));
		await user.type(screen.getByPlaceholderText("newProjectDialog.placeholder"), "Gamma");
		await user.click(screen.getByRole("button", { name: "newProjectDialog.create" }));

		expect(onSelectPendingProject).toHaveBeenCalledWith("Gamma");
		expect(onSelectProject).not.toHaveBeenCalled();
	});

	it("新建项目重名时当场报错，不登记待创建项目", async () => {
		const user = userEvent.setup();
		const { onSelectPendingProject } = renderSelector();

		await user.click(screen.getByRole("button", { name: /triggerTitle/ }));
		await user.click(screen.getByRole("button", { name: /projectSelector\.newProject/ }));
		await user.type(screen.getByPlaceholderText("newProjectDialog.placeholder"), " alpha ");
		await user.click(screen.getByRole("button", { name: "newProjectDialog.create" }));

		expect(screen.getByText("newProjectDialog.duplicateError")).toBeTruthy();
		expect(onSelectPendingProject).not.toHaveBeenCalled();
	});

	it("「打开本地项目」选完目录后立即选中它", async () => {
		const user = userEvent.setup();
		const { onSelectProject } = renderSelector();

		await user.click(screen.getByRole("button", { name: /triggerTitle/ }));
		await user.click(screen.getByRole("button", { name: /projectSelector\.openProject/ }));

		expect(openProject).toHaveBeenCalledOnce();
		await vi.waitFor(() => expect(onSelectProject).toHaveBeenCalledWith("/w/picked"));
	});
});
