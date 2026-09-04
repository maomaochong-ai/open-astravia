import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@vetta/ui";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMcpSetupLoginModel } from "../hooks/useMcpSetupLoginModel";
import type { AbilitiesModel, McpAbility } from "../types";

/**
 * 市场声明了安装后步骤的 MCP：装完直接把服务给出的二维码摆到用户面前，
 * 扫完由服务自己写登录态，这里只轮询完成标志。取不到码时退回「让 Agent 调用该工具」。
 */
function SetupBody({ item, model }: { item: McpAbility; model: AbilitiesModel }): JSX.Element {
	const { t } = useTranslation("abilities");
	const tool = item.postInstallSetup?.tool ?? "";
	const login = useMcpSetupLoginModel({ item, onCompleted: model.refresh });

	return (
		<DialogContent className="max-w-md">
			<DialogHeader>
				<DialogTitle>{t("mcp.setupLoginTitle", { name: item.title })}</DialogTitle>
				<DialogDescription>{t("mcp.setupLoginLead", { name: item.title })}</DialogDescription>
			</DialogHeader>

			<div className="flex min-h-56 flex-col items-center justify-center gap-3">
				{login.phase === "preparing" ? (
					<>
						<span className="icon-[solar--refresh-linear] h-6 w-6 animate-spin text-muted-foreground" />
						<p className="text-center text-sm text-muted-foreground">{t("mcp.setupLoginPreparing")}</p>
						<p className="text-center text-xs text-muted-foreground/70">{t("mcp.setupLoginFirstRun")}</p>
					</>
				) : null}

				{login.phase === "scanning" && login.image ? (
					<>
						<img
							src={login.image}
							alt={t("mcp.setupLoginTitle", { name: item.title })}
							className="h-48 w-48 rounded-lg bg-white p-2"
						/>
						<p className="text-sm text-muted-foreground">{t("mcp.setupLoginWaiting")}</p>
					</>
				) : null}

				{login.phase === "completed" ? (
					<>
						<span className="icon-[solar--check-circle-bold] h-8 w-8 text-primary" />
						<p className="text-sm">{t("mcp.setupLoginSuccess")}</p>
					</>
				) : null}

				{login.phase === "expired" || login.phase === "failed" ? (
					<>
						<p className="text-center text-sm text-muted-foreground">
							{login.phase === "expired"
								? t("mcp.setupLoginExpired")
								: t("mcp.setupLoginFailed", { error: login.error ?? "" })}
						</p>
						<Button variant="secondary" onClick={login.retry}>
							{t("mcp.setupLoginRetry")}
						</Button>
						<p className="text-center text-xs text-muted-foreground/70">
							{t("mcp.setupLoginManual", { tool })}
						</p>
					</>
				) : null}
			</div>

			<DialogFooter>
				<Button onClick={model.dismissSetupPrompt}>{t("mcp.setupLoginClose")}</Button>
			</DialogFooter>
		</DialogContent>
	);
}

export function McpSetupPrompt({ model }: { model: AbilitiesModel }): JSX.Element | null {
	const id = model.setupPromptId;
	const item = useMemo<McpAbility | null>(() => {
		if (!id) return null;
		const found = model.allItems.find(
			(entry): entry is McpAbility => entry.type === "mcp" && entry.id === id && Boolean(entry.postInstallSetup),
		);
		return found ?? null;
	}, [id, model.allItems]);

	if (!item) return null;

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) model.dismissSetupPrompt();
			}}
		>
			{/* 会话生命周期跟随这棵子树：弹窗一关，useMcpSetupLoginModel 的清理就收掉连接 */}
			<SetupBody item={item} model={model} />
		</Dialog>
	);
}
