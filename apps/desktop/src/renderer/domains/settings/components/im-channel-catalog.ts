import type { ImBridgeConfig, ImTransportSelector } from "@preload/api";

/** 飞书与微信各有专属配置对话框，其余渠道共用通用渠道对话框。 */
export type ImGenericChannelTransport = Exclude<ImTransportSelector, "feishu" | "wechat">;

interface ImChannelDescriptorBase {
	readonly brandName: string;
	readonly iconClass: string;
}

export type ImChannelDescriptor =
	| (ImChannelDescriptorBase & { readonly transport: "feishu"; readonly dialogKind: "feishu" })
	| (ImChannelDescriptorBase & { readonly transport: "wechat"; readonly dialogKind: "wechat" })
	| (ImChannelDescriptorBase & { readonly transport: ImGenericChannelTransport; readonly dialogKind: "generic" });

/**
 * 设置页渠道网格的唯一事实源：新增渠道时只在这里加一行，
 * 页面不再为飞书、微信和其余渠道维护三套并行写法。
 */
export const IM_CHANNELS: readonly ImChannelDescriptor[] = [
	{ transport: "feishu", dialogKind: "feishu", brandName: "Lark", iconClass: "icon-[mdi--send-circle-outline]" },
	{ transport: "wechat", dialogKind: "wechat", brandName: "WeChat", iconClass: "icon-[mdi--wechat]" },
	{ transport: "telegram", dialogKind: "generic", brandName: "Telegram", iconClass: "icon-[mdi--telegram]" },
	{ transport: "slack", dialogKind: "generic", brandName: "Slack", iconClass: "icon-[mdi--slack]" },
	{ transport: "discord", dialogKind: "generic", brandName: "Discord", iconClass: "icon-[mdi--discord]" },
	{ transport: "signal", dialogKind: "generic", brandName: "Signal", iconClass: "icon-[mdi--message-lock-outline]" },
	{ transport: "whatsapp", dialogKind: "generic", brandName: "WhatsApp", iconClass: "icon-[mdi--whatsapp]" },
	{ transport: "imessage", dialogKind: "generic", brandName: "iMessage", iconClass: "icon-[mdi--apple]" },
];

/**
 * 渠道是否已经具备可用凭据。判定条件与各渠道的启动前置一致：
 * 静态凭据渠道要求凭据字段齐全，扫码渠道看绑定态，iMessage 读本机数据库、没有凭据可配。
 */
export function isImChannelConfigured(config: ImBridgeConfig, transport: ImTransportSelector): boolean {
	switch (transport) {
		case "feishu":
			return Boolean(config.feishu.appId);
		case "wechat":
			return config.wechat.bound;
		case "telegram":
			return Boolean(config.telegram.botToken);
		case "slack":
			return Boolean(config.slack.botToken && config.slack.appToken);
		case "discord":
			return Boolean(config.discord.botToken);
		case "signal":
			return Boolean(config.signal.endpoint && config.signal.account);
		case "whatsapp":
			return config.whatsapp.bound;
		case "imessage":
			return true;
	}
}
