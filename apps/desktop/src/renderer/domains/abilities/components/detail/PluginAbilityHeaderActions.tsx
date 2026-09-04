import { Button } from "@vetta/ui";
import { useTranslation } from "react-i18next";
import type { PluginAbility } from "../../types";
import { AbilityOperationStatus } from "../AbilityOperationStatus";

/** 插件详情页头动作：高频重载在前，权限配置在后；更新失败时也在这里恢复。 */
export function PluginAbilityHeaderActions({
	item,
	onReload,
	onOpenPermissions,
}: {
	item: PluginAbility;
	onReload: () => void;
	onOpenPermissions: () => void;
}): JSX.Element | null {
	const { t } = useTranslation("abilities");
	if (!item.installed && item.permissions.length === 0) return null;

	return (
		<>
			{item.installed ? (
				<Button variant="secondary" size="lg" disabled={item.busy} onClick={onReload}>
					{item.operation === "reloading" ? (
					<AbilityOperationStatus
						operation={item.operation}
						progress={item.operationProgress}
						iconClassName="h-4 w-4"
					/>
					) : (
						<>
							<span className="icon-[solar--restart-linear] h-4 w-4" />
							{item.pendingVersion
								? t("plugin.reloadVersion", { version: item.pendingVersion })
								: t("actions.reload")}
						</>
					)}
				</Button>
			) : null}
			{item.permissions.length > 0 ? (
				<Button variant="secondary" size="lg" onClick={onOpenPermissions}>
					<span className="icon-[solar--shield-keyhole-linear] h-4 w-4" />
					{t("permission.page.open")}
				</Button>
			) : null}
		</>
	);
}
