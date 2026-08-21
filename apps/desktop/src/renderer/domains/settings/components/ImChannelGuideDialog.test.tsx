// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	// 回显 key，断言据此确认「渲染了哪一条文案」而不锁定具体措辞。
	useTranslation: () => ({ t: (key: string) => key, i18n: { exists: () => true } }),
}));

const { ImChannelGuideDialog } = await import("./ImChannelGuideDialog.js");

describe("ImChannelGuideDialog", () => {
	it("transport 为 null 时不渲染任何内容", () => {
		const { container } = render(<ImChannelGuideDialog transport={null} onClose={() => {}} />);
		expect(container.innerHTML).toBe("");
	});

	it("渲染该渠道的标题、全部步骤与提醒", () => {
		render(<ImChannelGuideDialog transport="signal" onClose={() => {}} />);

		expect(screen.getByText("imGuide.signal.title")).toBeDefined();
		expect(screen.getByText("imGuide.signal.step1Title")).toBeDefined();
		expect(screen.getByText("imGuide.signal.step3Desc")).toBeDefined();
		expect(screen.getByText("imGuide.signal.note2Title")).toBeDefined();
		// 带命令的步骤要把命令原样显示出来，供用户照抄。
		expect(screen.getByText("brew install signal-cli")).toBeDefined();
	});

	it("点关闭回调上抛", async () => {
		const onClose = vi.fn();
		render(<ImChannelGuideDialog transport="telegram" onClose={onClose} />);

		await userEvent.click(screen.getByRole("button", { name: "imGuideClose" }));

		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
