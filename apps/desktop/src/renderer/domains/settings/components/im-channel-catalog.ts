import type { ImBridgeConfig, ImTransportSelector } from "@preload/api";

/**
 * 飞书、微信与 Signal 各有专属配置对话框，其余渠道共用通用渠道对话框。
 * Signal 仍留在通用渠道联合类型里：扫码绑定之外，它还有一个「连接自建
 * signal-cli 服务」的高级表单，仍由通用对话框承载。
 */
export type ImGenericChannelTransport = Exclude<ImTransportSelector, "feishu" | "wechat">;

/**
 * 渠道图标：优先使用 public/channels 下的品牌图标资源；
 * 尚未提供资源的渠道退回单色图标类，保持网格可用。
 */
export type ImChannelIcon =
	| { readonly kind: "asset"; readonly url: string }
	| { readonly kind: "glyph"; readonly className: string };

interface ImChannelDescriptorBase {
	readonly brandName: string;
	readonly icon: ImChannelIcon;
}

/** Electron 走 file:// 协议，静态资源一律用相对路径引用。 */
function channelIcon(file: string): ImChannelIcon {
	return { kind: "asset", url: `./channels/${file}.png` };
}

export type ImChannelDescriptor =
	| (ImChannelDescriptorBase & { readonly transport: "feishu"; readonly dialogKind: "feishu" })
	| (ImChannelDescriptorBase & { readonly transport: "wechat"; readonly dialogKind: "wechat" })
	| (ImChannelDescriptorBase & { readonly transport: "signal"; readonly dialogKind: "signal" })
	| (ImChannelDescriptorBase & { readonly transport: ImGenericChannelTransport; readonly dialogKind: "generic" });

/**
 * 设置页渠道网格的唯一事实源：新增渠道时只在这里加一行，
 * 页面不再为飞书、微信和其余渠道维护三套并行写法。
 */
export const IM_CHANNELS: readonly ImChannelDescriptor[] = [
	{ transport: "feishu", dialogKind: "feishu", brandName: "Lark", icon: channelIcon("feishu") },
	{ transport: "wechat", dialogKind: "wechat", brandName: "WeChat", icon: channelIcon("wechat") },
	{ transport: "telegram", dialogKind: "generic", brandName: "Telegram", icon: channelIcon("telegram") },
	{ transport: "slack", dialogKind: "generic", brandName: "Slack", icon: channelIcon("slack") },
	{ transport: "discord", dialogKind: "generic", brandName: "Discord", icon: channelIcon("discord") },
	{ transport: "signal", dialogKind: "signal", brandName: "Signal", icon: channelIcon("signal") },
	{ transport: "whatsapp", dialogKind: "generic", brandName: "WhatsApp", icon: channelIcon("whatsapp") },
	{ transport: "imessage", dialogKind: "generic", brandName: "iMessage", icon: channelIcon("imessage") },
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
			// 托管模式看设备是否已扫码绑定；自管 daemon 模式看地址与账号是否齐全。
			return config.signal.bound || Boolean(config.signal.endpoint && config.signal.account);
		case "whatsapp":
			return config.whatsapp.bound;
		case "imessage":
			return true;
	}
}
