import type { ImTransportSelector } from "@preload/api";

/**
 * 渠道使用手册的唯一事实源：每个渠道的接入步骤与提醒。
 *
 * 步骤文案与 `apps/im-gateway/docs/*-setup.md` 对齐——那些文档面向命令行
 * 用户，这里面向设置页，讲的是同一件事，改动时请同步。
 *
 * 这里只存 i18n key 与图标；文案在 settings 命名空间的 `imGuide.*` 下。
 * key 逐条写成字面量而不是拼接：i18next 的 `t()` 只接受字面量 key 联合类型，
 * 拼出来的 string 既过不了类型检查，也让「哪些 key 还没翻译」无法被静态发现。
 */

export interface ImChannelGuideStep {
	readonly icon: string;
	readonly titleKey: string;
	readonly descKey: string;
	/** 需要照抄的命令或地址；省略表示这一步没有可复制内容。 */
	readonly code?: string;
}

export interface ImChannelGuideNote {
	/** warning 用于会导致失败或反直觉的事情，其余用 info。 */
	readonly tone: "info" | "warning";
	readonly titleKey: string;
	readonly descKey: string;
}

export interface ImChannelGuide {
	readonly titleKey: string;
	readonly subtitleKey: string;
	readonly steps: readonly ImChannelGuideStep[];
	readonly notes: readonly ImChannelGuideNote[];
}

export const IM_CHANNEL_GUIDES = {
	feishu: {
		titleKey: "imGuide.feishu.title",
		subtitleKey: "imGuide.feishu.subtitle",
		steps: [
			{
				icon: "icon-[mdi--qrcode-scan]",
				titleKey: "imGuide.feishu.step1Title",
				descKey: "imGuide.feishu.step1Desc",
			},
			{
				icon: "icon-[mdi--chat-outline]",
				titleKey: "imGuide.feishu.step2Title",
				descKey: "imGuide.feishu.step2Desc",
			},
			{
				icon: "icon-[mdi--application-outline]",
				titleKey: "imGuide.feishu.step3Title",
				descKey: "imGuide.feishu.step3Desc",
				code: "https://open.feishu.cn/app",
			},
		],
		notes: [
			{ tone: "info", titleKey: "imGuide.feishu.note1Title", descKey: "imGuide.feishu.note1Desc" },
			{ tone: "warning", titleKey: "imGuide.feishu.note2Title", descKey: "imGuide.feishu.note2Desc" },
		],
	},
	wechat: {
		titleKey: "imGuide.wechat.title",
		subtitleKey: "imGuide.wechat.subtitle",
		steps: [
			{
				icon: "icon-[mdi--qrcode-scan]",
				titleKey: "imGuide.wechat.step1Title",
				descKey: "imGuide.wechat.step1Desc",
			},
			{
				icon: "icon-[mdi--message-text-outline]",
				titleKey: "imGuide.wechat.step2Title",
				descKey: "imGuide.wechat.step2Desc",
			},
			{
				icon: "icon-[mdi--login-variant]",
				titleKey: "imGuide.wechat.step3Title",
				descKey: "imGuide.wechat.step3Desc",
			},
		],
		notes: [
			{ tone: "info", titleKey: "imGuide.wechat.note1Title", descKey: "imGuide.wechat.note1Desc" },
			{ tone: "warning", titleKey: "imGuide.wechat.note2Title", descKey: "imGuide.wechat.note2Desc" },
		],
	},
	telegram: {
		titleKey: "imGuide.telegram.title",
		subtitleKey: "imGuide.telegram.subtitle",
		steps: [
			{
				icon: "icon-[mdi--robot-outline]",
				titleKey: "imGuide.telegram.step1Title",
				descKey: "imGuide.telegram.step1Desc",
				code: "https://t.me/BotFather → /newbot",
			},
			{
				icon: "icon-[mdi--key-outline]",
				titleKey: "imGuide.telegram.step2Title",
				descKey: "imGuide.telegram.step2Desc",
			},
			{
				icon: "icon-[mdi--account-check-outline]",
				titleKey: "imGuide.telegram.step3Title",
				descKey: "imGuide.telegram.step3Desc",
				code: "https://t.me/userinfobot",
			},
			{
				icon: "icon-[mdi--message-text-outline]",
				titleKey: "imGuide.telegram.step4Title",
				descKey: "imGuide.telegram.step4Desc",
			},
		],
		notes: [{ tone: "info", titleKey: "imGuide.telegram.note1Title", descKey: "imGuide.telegram.note1Desc" }],
	},
	slack: {
		titleKey: "imGuide.slack.title",
		subtitleKey: "imGuide.slack.subtitle",
		steps: [
			{
				icon: "icon-[mdi--application-outline]",
				titleKey: "imGuide.slack.step1Title",
				descKey: "imGuide.slack.step1Desc",
				code: "https://api.slack.com/apps",
			},
			{
				icon: "icon-[mdi--lan-connect]",
				titleKey: "imGuide.slack.step2Title",
				descKey: "imGuide.slack.step2Desc",
				code: "connections:write",
			},
			{
				icon: "icon-[mdi--shield-key-outline]",
				titleKey: "imGuide.slack.step3Title",
				descKey: "imGuide.slack.step3Desc",
				code: "chat:write   im:history   app_mentions:read   reactions:write   files:write   files:read",
			},
			{
				icon: "icon-[mdi--key-outline]",
				titleKey: "imGuide.slack.step4Title",
				descKey: "imGuide.slack.step4Desc",
				code: "xoxb-…   +   xapp-…",
			},
		],
		notes: [{ tone: "info", titleKey: "imGuide.slack.note1Title", descKey: "imGuide.slack.note1Desc" }],
	},
	discord: {
		titleKey: "imGuide.discord.title",
		subtitleKey: "imGuide.discord.subtitle",
		steps: [
			{
				icon: "icon-[mdi--application-outline]",
				titleKey: "imGuide.discord.step1Title",
				descKey: "imGuide.discord.step1Desc",
				code: "https://discord.com/developers/applications",
			},
			{
				icon: "icon-[mdi--text-box-check-outline]",
				titleKey: "imGuide.discord.step2Title",
				descKey: "imGuide.discord.step2Desc",
				code: "MESSAGE CONTENT INTENT",
			},
			{
				icon: "icon-[mdi--account-multiple-plus-outline]",
				titleKey: "imGuide.discord.step3Title",
				descKey: "imGuide.discord.step3Desc",
			},
			{
				icon: "icon-[mdi--key-outline]",
				titleKey: "imGuide.discord.step4Title",
				descKey: "imGuide.discord.step4Desc",
			},
		],
		notes: [
			{ tone: "warning", titleKey: "imGuide.discord.note1Title", descKey: "imGuide.discord.note1Desc" },
			{ tone: "info", titleKey: "imGuide.discord.note2Title", descKey: "imGuide.discord.note2Desc" },
		],
	},
	signal: {
		titleKey: "imGuide.signal.title",
		subtitleKey: "imGuide.signal.subtitle",
		steps: [
			{
				icon: "icon-[mdi--package-variant-closed]",
				titleKey: "imGuide.signal.step1Title",
				descKey: "imGuide.signal.step1Desc",
				code: "brew install signal-cli",
			},
			{
				icon: "icon-[mdi--qrcode-scan]",
				titleKey: "imGuide.signal.step2Title",
				descKey: "imGuide.signal.step2Desc",
			},
			{
				icon: "icon-[mdi--message-text-outline]",
				titleKey: "imGuide.signal.step3Title",
				descKey: "imGuide.signal.step3Desc",
			},
		],
		notes: [
			{ tone: "warning", titleKey: "imGuide.signal.note1Title", descKey: "imGuide.signal.note1Desc" },
			{ tone: "warning", titleKey: "imGuide.signal.note2Title", descKey: "imGuide.signal.note2Desc" },
		],
	},
	whatsapp: {
		titleKey: "imGuide.whatsapp.title",
		subtitleKey: "imGuide.whatsapp.subtitle",
		steps: [
			{
				icon: "icon-[mdi--qrcode-scan]",
				titleKey: "imGuide.whatsapp.step1Title",
				descKey: "imGuide.whatsapp.step1Desc",
			},
			{
				icon: "icon-[mdi--message-text-outline]",
				titleKey: "imGuide.whatsapp.step2Title",
				descKey: "imGuide.whatsapp.step2Desc",
			},
		],
		notes: [{ tone: "warning", titleKey: "imGuide.whatsapp.note1Title", descKey: "imGuide.whatsapp.note1Desc" }],
	},
	imessage: {
		titleKey: "imGuide.imessage.title",
		subtitleKey: "imGuide.imessage.subtitle",
		steps: [
			{
				icon: "icon-[mdi--message-badge-outline]",
				titleKey: "imGuide.imessage.step1Title",
				descKey: "imGuide.imessage.step1Desc",
			},
			{
				icon: "icon-[mdi--folder-lock-outline]",
				titleKey: "imGuide.imessage.step2Title",
				descKey: "imGuide.imessage.step2Desc",
			},
			{
				icon: "icon-[mdi--robot-industrial-outline]",
				titleKey: "imGuide.imessage.step3Title",
				descKey: "imGuide.imessage.step3Desc",
			},
			{
				icon: "icon-[mdi--message-text-outline]",
				titleKey: "imGuide.imessage.step4Title",
				descKey: "imGuide.imessage.step4Desc",
			},
		],
		notes: [
			{ tone: "info", titleKey: "imGuide.imessage.note1Title", descKey: "imGuide.imessage.note1Desc" },
			{ tone: "warning", titleKey: "imGuide.imessage.note2Title", descKey: "imGuide.imessage.note2Desc" },
		],
	},
} as const satisfies Record<ImTransportSelector, ImChannelGuide>;

export function getImChannelGuide(transport: ImTransportSelector): (typeof IM_CHANNEL_GUIDES)[ImTransportSelector] {
	return IM_CHANNEL_GUIDES[transport];
}
