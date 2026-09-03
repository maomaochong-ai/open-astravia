// @vitest-environment jsdom
/**
 * 发送按钮的 pending 变形态：宿主在发送前还有一步要跑完时（新会话页要先把待创建的
 * 项目落盘），按钮就地展开成带文案的胶囊、停止接受点击，跑完后恢复原样。
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { exists: () => true } }),
}));

const { SendButton } = await import("./SendButton.js");

describe("SendButton", () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(cleanup);

	it("常态下可点击发送", async () => {
		const user = userEvent.setup();
		const onSend = vi.fn();
		render(<SendButton canSend isStreaming={false} onSend={onSend} onAbort={vi.fn()} />);

		await user.click(screen.getByRole("button"));
		expect(onSend).toHaveBeenCalledOnce();
	});

	it("pending 时展示文案与忙碌语义，并拒绝点击", async () => {
		const user = userEvent.setup();
		const onSend = vi.fn();
		const onAbort = vi.fn();
		render(
			<SendButton
				canSend
				isStreaming={false}
				pending={{ label: "正在准备项目" }}
				onSend={onSend}
				onAbort={onAbort}
			/>,
		);

		const button = screen.getByRole("button", { name: "正在准备项目" });
		expect(button.textContent).toContain("正在准备项目");
		expect(button.getAttribute("aria-busy")).toBe("true");
		expect((button as HTMLButtonElement).disabled).toBe(true);

		await user.click(button);
		expect(onSend).not.toHaveBeenCalled();
		expect(onAbort).not.toHaveBeenCalled();
	});

	it("pending 优先于流式态：不会变成可点击的停止按钮", () => {
		const onAbort = vi.fn();
		render(
			<SendButton
				canSend={false}
				isStreaming
				pending={{ label: "正在准备项目" }}
				onSend={vi.fn()}
				onAbort={onAbort}
			/>,
		);

		const button = screen.getByRole("button", { name: "正在准备项目" });
		expect((button as HTMLButtonElement).disabled).toBe(true);
	});

	it("点击停止后保持纯图标并拒绝重复取消", async () => {
		const user = userEvent.setup();
		const onAbort = vi.fn(() => new Promise<void>(() => undefined));
		render(<SendButton canSend={false} isStreaming onSend={vi.fn()} onAbort={onAbort} />);

		await user.click(screen.getByRole("button", { name: "sendButton.stopGenerating" }));

		const button = screen.getByRole("button", { name: "sendButton.stopGenerating" });
		expect(button.textContent).toBe("");
		expect(button.getAttribute("aria-busy")).toBe("true");
		expect((button as HTMLButtonElement).disabled).toBe(true);
		expect(onAbort).toHaveBeenCalledOnce();
		await user.click(button);
		expect(onAbort).toHaveBeenCalledOnce();
	});

	it("停止请求失败时恢复停止按钮，允许用户重试", async () => {
		const user = userEvent.setup();
		const onAbort = vi.fn(async () => {
			throw new Error("IPC failed");
		});
		render(<SendButton canSend={false} isStreaming onSend={vi.fn()} onAbort={onAbort} />);

		await user.click(screen.getByRole("button", { name: "sendButton.stopGenerating" }));
		await waitFor(() => {
			expect(
				(screen.getByRole("button", { name: "sendButton.stopGenerating" }) as HTMLButtonElement).disabled,
			).toBe(false);
		});
	});

	it("pending 结束后回到普通发送按钮", async () => {
		const user = userEvent.setup();
		const onSend = vi.fn();
		const { rerender } = render(
			<SendButton canSend isStreaming={false} pending={{ label: "正在准备项目" }} onSend={onSend} onAbort={vi.fn()} />,
		);
		rerender(<SendButton canSend isStreaming={false} onSend={onSend} onAbort={vi.fn()} />);

		const button = screen.getByRole("button");
		expect(button.textContent).not.toContain("正在准备项目");
		await user.click(button);
		expect(onSend).toHaveBeenCalledOnce();
	});
});
