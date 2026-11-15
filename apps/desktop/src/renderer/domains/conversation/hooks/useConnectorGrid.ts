import {
	type BuiltinMcpLabelKey,
	matchBuiltinMcpPreset,
	missingRequiredSecrets,
	resolveMcpPresetDisplayName,
	resolveMcpPresetIconUrl,
} from "@domains/settings/mcp/builtin-mcp-presets";
import type { McpServerConfigData } from "@preload/api";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { connectorGridColumns } from "../lib/connector-grid";

export interface ConnectorGridItem {
	/** mcp.json 里的真实 key，写进 `@mcp:` 标记的就是它。 */
	name: string;
	label: string;
	iconUrl: string;
}

export interface ConnectorGridModel {
	items: ConnectorGridItem[];
	columns: number;
}

/**
 * 「可用」= 存在于 mcp.json + 未禁用 +（内置预置时）必填密钥齐。
 *
 * **不再要求必须匹配内置预置**：只认预置意味着用户自己加的、或从能力市场装进来的
 * MCP server 永远不会出现在面板里——装了却在面板看不到，比装失败更难理解。
 * 预置只用于「更漂亮的名称与图标」，不决定一条连接器是否存在。
 *
 * 刻意不查 OAuth 授权状态：那是一次异步 IPC，会让面板打开后行数跳变、整个列表重排。
 * 未授权的连接器仍然会出现，模型调用时报错由对话链路自己呈现。
 */
function isAvailable(name: string, config: McpServerConfigData): boolean {
	if (config.disabled === true) return false;
	const preset = matchBuiltinMcpPreset(name, config);
	// 没有预置就没有「必填密钥」的概念，能读到配置即视为可用。
	if (!preset) return true;
	return missingRequiredSecrets(preset, config).length === 0;
}

/**
 * 命令区顶部宫格：用户已接入的内置连接器。
 * `prefetch` 让它在展开前就把 mcp.json 读好——否则第一次展开时读盘与高度动画撞在一起。
 */
/**
 * 把 mcp.json 的服务器列表投影成面板里的连接器条目。
 *
 * 抽成纯函数是为了能直接验证分类契约（见 ADR-0177）：**任何**用户可用的 server 都要
 * 出现，内置预置只影响名称与图标。放在 hook 里就必须靠渲染才能测到。
 */
export function projectConnectorItems(
	servers: Record<string, McpServerConfigData>,
	translate: (key: BuiltinMcpLabelKey) => string,
): ConnectorGridItem[] {
	const items: ConnectorGridItem[] = [];
	for (const [name, config] of Object.entries(servers)) {
		if (!isAvailable(name, config)) continue;
		const preset = matchBuiltinMcpPreset(name, config);
		items.push(
			preset
				? {
						name,
						label: resolveMcpPresetDisplayName(preset, translate),
						iconUrl: resolveMcpPresetIconUrl(preset),
					}
				: {
						// 没有预置时用 mcp.json 里的 key 作标签：用户自己起的名字就是它的身份。
						name,
						label: name,
						iconUrl: "",
					},
		);
	}
	return items;
}

export function useConnectorGrid(open: boolean, prefetch = false): ConnectorGridModel {
	const { t } = useTranslation("settings");
	const [servers, setServers] = useState<Record<string, McpServerConfigData>>({});

	useEffect(() => {
		if (!open && !prefetch) return;
		let cancelled = false;
		void window.astravia.mcp
			.get()
			.then((config) => {
				if (!cancelled) setServers(config.mcpServers ?? {});
			})
			.catch((error) => {
				console.error("[useConnectorGrid] read mcp config failed:", error);
			});
		return () => {
			cancelled = true;
		};
	}, [open, prefetch]);

	return useMemo(() => {
		const items = projectConnectorItems(servers, (key: BuiltinMcpLabelKey) => t(key));
		return { items, columns: connectorGridColumns(items.length) };
	}, [servers, t]);
}
