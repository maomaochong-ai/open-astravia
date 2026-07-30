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
 * 「已配置」= 存在于 mcp.json + 未禁用 + 必填密钥齐。
 *
 * 刻意不查 OAuth 授权状态：那是一次异步 IPC，会让面板打开后宫格行数跳变、
 * 整个列表重排。未授权的连接器仍然会出现，模型调用时报错由对话链路自己呈现。
 */
function isConfigured(name: string, config: McpServerConfigData): boolean {
	if (config.disabled === true) return false;
	const preset = matchBuiltinMcpPreset(name, config);
	if (!preset) return false;
	return missingRequiredSecrets(preset, config).length === 0;
}

/** 命令面板顶部宫格：用户已接入的内置连接器。 */
export function useConnectorGrid(open: boolean): ConnectorGridModel {
	const { t } = useTranslation("settings");
	const [servers, setServers] = useState<Record<string, McpServerConfigData>>({});

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		void window.vetta.mcp
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
	}, [open]);

	return useMemo(() => {
		const items: ConnectorGridItem[] = [];
		for (const [name, config] of Object.entries(servers)) {
			if (!isConfigured(name, config)) continue;
			const preset = matchBuiltinMcpPreset(name, config);
			if (!preset) continue;
			items.push({
				name,
				label: resolveMcpPresetDisplayName(preset, (key: BuiltinMcpLabelKey) => t(key)),
				iconUrl: resolveMcpPresetIconUrl(preset),
			});
		}
		return { items, columns: connectorGridColumns(items.length) };
	}, [servers, t]);
}
