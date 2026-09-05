import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@vetta/ui";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMcpSetupLoginModel } from "../hooks/useMcpSetupLoginModel";
import type { AbilitiesModel, McpAbility } from "../types";

/** QR 请求阶段留在详情页显示状态；只有拿到二维码或需要恢复时才打开弹窗。 */
function SetupBody({ item, model }: { item: McpAbility; model: AbilitiesModel }): JSX.Element | null {
	const { t } = useTranslation("abilities");
	const login = useMcpSetupLoginModel({ item, onCompleted: model.refresh });
	if (login.phase === "preparing") return null;

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) model.dismissSetupPrompt();
			}}
		>
			<DialogContent className="max-w-md">
			<DialogHeader>
				<DialogTitle>{t("mcp.setupLoginTitle", { name: item.title })}</DialogTitle>
				<DialogDescription>{t("mcp.setupLoginLead", { name: item.title })}</DialogDescription>
			</DialogHeader>

			<div className="flex min-h-56 flex-col items-center justify-center gap-3">
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
					</>
				) : null}
			</div>

			<DialogFooter>
				<Button onClick={model.dismissSetupPrompt}>{t("mcp.setupLoginClose")}</Button>
			</DialogFooter>
			</DialogContent>
		</Dialog>
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

	return <SetupBody item={item} model={model} />;
}
