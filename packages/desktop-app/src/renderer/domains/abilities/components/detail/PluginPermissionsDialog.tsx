import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Switch } from "@vetta/ui";
import { useTranslation } from "react-i18next";
import { PLUGIN_PERMISSION_LABEL_KEYS } from "../../lib/plugin-permission-labels";
import type { AbilitiesModel, PluginAbility } from "../../types";

/**
 * 权限配置弹窗：详情正文只列权限清单，逐项授予在这里改。
 * 未安装或系统插件不可改（系统插件自动全授予）。
 */
export function PluginPermissionsDialog({
	item,
	model,
	open,
	onOpenChange,
}: {
	item: PluginAbility;
	model: AbilitiesModel;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}): JSX.Element {
	const { t } = useTranslation("abilities");
	const plugin = item.plugin;
	const isSystem = plugin?.source === "system";
	const editable = plugin !== null && !isSystem;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>{t("plugin.permissionsDialog")}</DialogTitle>
					<DialogDescription>
						{isSystem
							? t("plugin.permissionsSystemHint")
							: plugin
								? t("plugin.permissionsDialogHint")
								: t("plugin.permissionsNotInstalledHint")}
					</DialogDescription>
				</DialogHeader>
				{/* 与详情页的贡献列表同款：一张卡片，条目之间只用分隔线 */}
				{/* overflow-y-auto 会把 overflow-x 也算成 auto，显式关掉横向滚动，长文案改为换行 */}
				<div className="max-h-[60vh] overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-background/50">
					{item.permissions.map((permission) => (
						<label
							key={permission}
							className="flex items-center justify-between gap-3 border-b border-border/60 px-2.5 py-2 last:border-b-0"
						>
							<span className="min-w-0 flex-1 break-words text-[12px] text-foreground">
								{t(PLUGIN_PERMISSION_LABEL_KEYS[permission])}
							</span>
							<Switch
								className="shrink-0"
								checked={editable ? item.grantedPermissions.includes(permission) : true}
								disabled={!editable || item.busy}
								onCheckedChange={(checked) => model.setPluginPermission(item, permission, checked)}
							/>
						</label>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}
