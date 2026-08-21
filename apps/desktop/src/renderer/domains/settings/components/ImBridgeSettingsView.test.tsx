// @vitest-environment jsdom
import type { ImBridgeConfig } from "@preload/api";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { exists: () => true } }),
}));
vi.mock("@shared/components/ModelSelect", () => ({ ModelSelect: () => <div data-testid="model-select" /> }));
vi.mock("../ai-assist", () => ({ SettingsAiAssist: () => null }));
vi.mock("./ImFeishuDialog", () => ({ ImFeishuDialog: () => null }));
vi.mock("./ImChannelConfigDialog", () => ({ ImChannelConfigDialog: () => null }));
vi.mock("./WechatBindDialog", () => ({ WechatBindDialog: () => null }));
vi.mock("./ImLogDrawer", () => ({ ImLogDrawer: () => null }));
vi.mock("./ImLegacyImportBanner", () => ({ ImLegacyImportBanner: () => null }));

const { ImBridgeSettingsView } = await import("./ImBridgeSettingsView.js");
const { IM_CHANNELS } = await import("./im-channel-catalog.js");
type Model = Parameters<typeof ImBridgeSettingsView>[0]["model"];

function config(overrides: Partial<ImBridgeConfig> = {}): ImBridgeConfig {
	return {
		enabled: false,
		transport: "feishu",
		feishu: { appId: "cli_a", appSecret: "sec", verificationToken: "", encryptKey: "" },
		wechat: { bound: false },
		telegram: { botToken: "" },
		slack: { botToken: "", appToken: "" },
		discord: { botToken: "" },
		signal: { bound: false, cliInstallHint: "brew install signal-cli" },
		whatsapp: { bound: false },
		imessage: {},
		transportMode: "long-connection",
		encryptionAvailable: true,
		...overrides,
	};
}

function model(overrides: Partial<Model> = {}): Model {
	return {
		config: config(),
		channelDialog: {
			transport: null,
			form: { botToken: "", appToken: "", endpoint: "", account: "", attachmentsDir: "", path: "", allowlist: "" },
			open: false,
			showSecret: false,
			busy: false,
			error: null,
			message: null,
			setOpen: vi.fn(),
			setShowSecret: vi.fn(),
			updateField: vi.fn(),
			onSave: vi.fn(),
			onTest: vi.fn(),
			onBind: vi.fn(),
			onLogout: vi.fn(),
		},
		feishuForm: { appId: "", appSecret: "" },
		feishuValidation: { errors: {}, valid: true },
		feishuDialogOpen: false,
		wechatDialogOpen: false,
		status: null,
		transportStatus: "online",
		showSecret: false,
		saving: false,
		saveError: null,
		saveOk: null,
		testing: false,
		testResult: null,
		logsOpen: false,
		logs: [],
		legacy: null,
		importing: false,
		probing: false,
		probeResult: null,
		setFeishuDialogOpen: vi.fn(),
		setWechatDialogOpen: vi.fn(),
		setShowSecret: vi.fn(),
		setLogsOpen: vi.fn(),
		updateFeishuField: vi.fn(),
		onImportLegacy: vi.fn(),
		onSkipLegacy: vi.fn(),
		onPickModel: vi.fn(),
		onProbeModel: vi.fn(),
		onToggleEnabled: vi.fn(),
		onSwitchTransport: vi.fn(),
		onOpenFeishuDialog: vi.fn(),
		onOpenWechatDialog: vi.fn(),
		onOpenChannelDialog: vi.fn(),
		onWechatLogout: vi.fn(),
		onSaveFeishu: vi.fn(),
		onTestFeishu: vi.fn(),
		onRestart: vi.fn(),
		onOpenLogs: vi.fn(),
		onWechatConfirmedRefresh: vi.fn(),
		onDismissFeedback: vi.fn(),
		...overrides,
	} as Model;
}

describe("ImBridgeSettingsView", () => {
	it("渠道网格渲染全部渠道，各自一张卡", () => {
		const view = render(<ImBridgeSettingsView model={model()} />);
		expect(view.getByText("Telegram")).toBeDefined();
		expect(view.getByText("Slack")).toBeDefined();
		expect(view.getByText("iMessage")).toBeDefined();
		// 飞书是活动渠道，概览区与渠道卡各出现一次
		expect(view.getAllByText("feishuName")).toHaveLength(2);
		// 每个通用渠道都有自己的配置入口（未配置的渠道整卡也是同一个动作，故用 getAll）
		for (const channel of IM_CHANNELS.filter((item) => item.dialogKind === "generic")) {
			expect(
				view.getAllByRole("button", { name: `${channel.brandName} · configureChannel` }).length,
			).toBeGreaterThan(0);
		}
	});

	it("概览区展示当前活动渠道与实时状态", () => {
		const view = render(<ImBridgeSettingsView model={model({ transportStatus: "online" })} />);
		expect(view.getAllByText("imbStatusOnline").length).toBeGreaterThan(0);
		expect(view.getByText(/imbActiveChannel/)).toBeDefined();
	});

	it("点击其它渠道卡切换活动渠道", async () => {
		const onSwitchTransport = vi.fn();
		const view = render(
			<ImBridgeSettingsView
				model={model({ onSwitchTransport, config: config({ telegram: { botToken: "tok" } }) })}
			/>,
		);

		await userEvent.click(view.getByRole("button", { name: "Telegram · activateChannelTitle" }));

		expect(onSwitchTransport).toHaveBeenCalledWith("telegram");
	});

	it("保存失败时在页面上给出可见反馈，并可关闭", async () => {
		const onDismissFeedback = vi.fn();
		const view = render(
			<ImBridgeSettingsView model={model({ saveError: "请先选择对话模型", onDismissFeedback })} />,
		);

		expect(view.getByRole("status").textContent).toContain("请先选择对话模型");
		await userEvent.click(view.getByRole("button", { name: "imbDismissMessage" }));

		expect(onDismissFeedback).toHaveBeenCalledTimes(1);
	});

	it("没有反馈消息时不渲染提示条", () => {
		const view = render(<ImBridgeSettingsView model={model()} />);
		expect(view.queryByRole("status")).toBeNull();
	});
});
