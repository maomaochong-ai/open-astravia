// @vitest-environment jsdom
/**
 * 截断失败卡：模型撞上输出上限、自动续接放弃时，用户看到的必须是本地化的说明，
 * 而不是服务方自报的那段英文诊断。英文原文保留在「详情」里供排查。
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import enChat from "@/shared/i18n/locales/en/chat.json";
import zhChat from "@/shared/i18n/locales/zh/chat.json";
import type { ErrorBlock } from "@shared/store/atoms";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => () => undefined }));

const { ErrorBlockView } = await import("./ErrorBlock");

const TRUNCATED_TEXT =
	"Provider reported a length stop before any visible output (reported output: 1 tokens). Automatic continuation cannot recover this.";

function truncatedBlock(overrides: Partial<ErrorBlock> = {}): ErrorBlock {
	return {
		type: "error",
		id: "error-1",
		kind: "truncated",
		text: TRUNCATED_TEXT,
		details: { code: "coding_agent_length_stop_without_output", origin: "runtime", retryable: false },
		...overrides,
	} as ErrorBlock;
}

async function renderBlock(block: ErrorBlock, language: "zh" | "en"): Promise<void> {
	const i18n = createInstance();
	await i18n.init({
		resources: { zh: { chat: zhChat }, en: { chat: enChat } },
		lng: language,
		fallbackLng: "zh",
		ns: ["chat"],
		defaultNS: "chat",
		initAsync: false,
	});
	render(
		<I18nextProvider i18n={i18n}>
			<ErrorBlockView block={block} />
		</I18nextProvider>,
	);
}

describe("ErrorBlock 截断卡", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it.each([
		["zh", "回复在上限处被截断了"],
		["en", "The reply was cut off at the output limit"],
	] as const)("按界面语言给出标题（%s）", async (language, title) => {
		await renderBlock(truncatedBlock(), language);
		expect(screen.getByText(title)).toBeTruthy();
	});

	it("展开详情后仍能看到失败码与英文原文", async () => {
		await renderBlock(truncatedBlock(), "zh");
		expect(screen.getByText("回复在上限处被截断了")).toBeTruthy();
		// 标题不是英文原文；排查线索留在折叠的详情里。
		expect(screen.queryByText(TRUNCATED_TEXT)).toBeNull();

		await userEvent.click(screen.getByRole("button", { name: "查看详情" }));

		expect(document.body.textContent).toContain("coding_agent_length_stop_without_output");
		expect(document.body.textContent).toContain(TRUNCATED_TEXT);
	});

	it("不给「去设置」入口：换模型还是降思考等级，得用户自己判断", async () => {
		await renderBlock(truncatedBlock(), "zh");
		expect(screen.queryByText("去设置")).toBeNull();
	});
});
