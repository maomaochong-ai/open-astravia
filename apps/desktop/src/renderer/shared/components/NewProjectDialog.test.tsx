// @vitest-environment jsdom
/**
 * 新建项目弹窗的输入法契约：中文输入时按 Enter 是「上屏候选词」，
 * 不能被当成确认创建——否则名字还没打完项目就建出去了。
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { exists: () => true } }),
}));

const { NewProjectDialog } = await import("./NewProjectDialog.js");

function renderDialog(): { readonly onConfirm: ReturnType<typeof vi.fn> } {
	const onConfirm = vi.fn();
	render(<NewProjectDialog onConfirm={onConfirm} onCancel={vi.fn()} />);
	return { onConfirm };
}

afterEach(cleanup);

describe("NewProjectDialog", () => {
	it("组合输入中按 Enter 只上屏候选词，不创建项目", async () => {
		const user = userEvent.setup();
		const { onConfirm } = renderDialog();
		const input = screen.getByPlaceholderText("newProjectDialog.placeholder");

		await user.click(input);
		await user.type(input, "我的项目");
		input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
		await user.keyboard("{Enter}");

		expect(onConfirm).not.toHaveBeenCalled();
	});

	it("候选词刚上屏那一下的 Enter 也不创建项目", async () => {
		const user = userEvent.setup();
		const { onConfirm } = renderDialog();
		const input = screen.getByPlaceholderText("newProjectDialog.placeholder");

		await user.click(input);
		await user.type(input, "我的项目");
		input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
		input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
		await user.keyboard("{Enter}");

		expect(onConfirm).not.toHaveBeenCalled();
	});

	it("非组合输入时 Enter 正常创建项目", async () => {
		const user = userEvent.setup();
		const { onConfirm } = renderDialog();
		const input = screen.getByPlaceholderText("newProjectDialog.placeholder");

		await user.click(input);
		await user.type(input, "demo");
		await user.keyboard("{Enter}");

		expect(onConfirm).toHaveBeenCalledWith("demo");
	});
});
