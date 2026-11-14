// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { i18n, initI18n } from "@shared/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";

initI18n();
await i18n.changeLanguage("zh");

/**
 * 自动化任务正文：列表里是 Markdown 预览（高度随内容），点「编辑」在弹窗里改，
 * 改完的内容原样回写给模型（技能选择不被清空）。
 */

const skillArea = vi.hoisted(() => vi.fn());
vi.mock("@shared/components/RendererMarkdownContent", () => ({
	RendererMarkdownContent: ({ text }: { text: string }) => <div data-testid="markdown">{text}</div>,
}));
vi.mock("@domains/conversation/components/SkillPromptArea", () => ({
	SkillPromptArea: (props: {
		prompt: string;
		onPromptChange: (value: string) => void;
		skills: readonly { name: string }[];
	}) => {
		skillArea(props);
		return (
			<textarea
				data-testid="prompt-area"
				value={props.prompt}
				onChange={(event) => props.onPromptChange(event.target.value)}
			/>
		);
	},
}));

const { AutomationPromptField } = await import("./AutomationPromptField");

const skill = { name: "summarize", alias: "总结", type: "skill" } as const;

afterEach(() => {
	cleanup();
	skillArea.mockClear();
});

describe("AutomationPromptField", () => {
	it("有内容时渲染 Markdown 预览而不是输入框", () => {
		render(
			<AutomationPromptField
				prompt={"## 标题\n正文"}
				skills={[skill]}
				placeholder="占位"
				dialogMinHeight={240}
				onChange={vi.fn()}
			/>,
		);
		expect(screen.getByTestId("markdown").textContent).toBe("## 标题\n正文");
		expect(screen.queryByTestId("prompt-area")).toBeNull();
		expect(screen.getByText("总结")).toBeTruthy();
	});

	it("空内容时点占位文案直接打开编辑弹窗", async () => {
		render(<AutomationPromptField prompt="" skills={[]} placeholder="描述任务" dialogMinHeight={240} onChange={vi.fn()} />);
		await userEvent.click(screen.getByRole("button", { name: "描述任务" }));
		expect(screen.getByTestId("prompt-area")).toBeTruthy();
	});

	it("弹窗里改正文后回写，技能保持原样", async () => {
		const onChange = vi.fn();
		render(
			<AutomationPromptField
				prompt="旧内容"
				skills={[skill]}
				placeholder="占位"
				dialogMinHeight={240}
				onChange={onChange}
			/>,
		);
		await userEvent.click(screen.getByRole("button", { name: "编辑" }));
		const area = screen.getByTestId("prompt-area");
		fireEvent.change(area, { target: { value: "新内容" } });
		expect(onChange).toHaveBeenCalled();
		expect(onChange).toHaveBeenLastCalledWith("新内容", [skill]);
		// 弹窗里的编辑区至少撑到传入的最小高度。
		expect(skillArea).toHaveBeenCalled();
		await userEvent.click(screen.getByRole("button", { name: "完成" }));
		expect(screen.queryByTestId("prompt-area")).toBeNull();
	});
});
