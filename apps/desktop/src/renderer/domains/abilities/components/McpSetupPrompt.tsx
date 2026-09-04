import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@vetta/ui";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AbilitiesModel, McpAbility } from "../types";

/**
 * 市场声明了安装后步骤的 MCP：装完立刻把「还要在对话里调一次登录工具」讲清楚。
 * 这一步无法在客户端代跑（二维码由 MCP 服务自己产出），所以只做引导，不做假的进度。
 */
export function McpSetupPrompt({ model }: { model: AbilitiesModel }): JSX.Element | null {
	const { t } = useTranslation("abilities");
	const id = model.setupPromptId;
	const item = useMemo<McpAbility | null>(() => {
		if (!id) return null;
		const found = model.allItems.find(
			(entry): entry is McpAbility => entry.type === "mcp" && entry.id === id && Boolean(entry.postInstallSetup),
		);
		return found ?? null;
	}, [id, model.allItems]);

	if (!item?.postInstallSetup) return null;

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) model.dismissSetupPrompt();
			}}
		>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>{t("mcp.setupPromptTitle")}</DialogTitle>
					<DialogDescription>
						{t("mcp.setupPromptLead", { name: item.title, tool: item.postInstallSetup.tool })}
					</DialogDescription>
				</DialogHeader>
				<p className="text-muted-foreground text-sm">{t("mcp.setupPromptHint")}</p>
				<DialogFooter>
					<Button onClick={model.dismissSetupPrompt}>{t("mcp.setupPromptDone")}</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
