import type { PluginPermission } from "@preload/api";
import { confirmDialogAtom } from "@shared/store/atoms";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Switch,
} from "@vetta/ui";
import { useSetAtom } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PLUGIN_PERMISSION_LABEL_KEYS } from "../lib/plugin-permission-labels";
import type { AbilitiesModel, PluginAbility } from "../types";

function sameSet(a: readonly PluginPermission[], b: readonly PluginPermission[]): boolean {
	return a.length === b.length && a.every((value) => b.includes(value));
}

/**
 * 装完立刻弹的启用 + 权限配置：安装本身不启用插件（plugin catalog 的 enabled 默认 false），
 * 权限首装也全未授予，两者都漏配就会表现为「装了但什么都没出现」。这里把两件事收进
 * 一次确认：开关先改本地草稿，点确认才落盘，直接关掉则二次确认。
 */
export function PluginInstallSetupDialog({
	item,
	model,
	onClose,
}: {
	item: PluginAbility;
	model: AbilitiesModel;
	onClose: () => void;
}): JSX.Element {
	const { t } = useTranslation("abilities");
	const { t: tCommon } = useTranslation("common");
	const confirm = useSetAtom(confirmDialogAtom);
	// 草稿默认全开：用户看着这份清单点确认即为知情同意，比默认全关、装完不可用更合用。
	const [enabled, setEnabled] = useState(true);
	const [granted, setGranted] = useState<PluginPermission[]>(() => [...item.permissions]);

	const dirty = enabled !== item.enabled || !sameSet(granted, item.grantedPermissions);

	const apply = (): void => {
		model.applyPluginSetup(item, { enabled, grantedPermissions: granted });
		onClose();
	};

	const requestClose = (): void => {
		if (!dirty) {
			onClose();
			return;
		}
		confirm({
			title: t("plugin.setupDiscardTitle"),
			message: t("plugin.setupDiscardMessage"),
			confirmLabel: t("plugin.setupDiscardConfirm"),
			cancelLabel: tCommon("actions.cancel"),
			variant: "danger",
			onConfirm: onClose,
		});
	};

	return (
		<Dialog
			open
			onOpenChange={(next) => {
				if (!next) requestClose();
			}}
		>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>{t("plugin.setupDialog")}</DialogTitle>
					<DialogDescription>{t("plugin.setupDialogHint")}</DialogDescription>
				</DialogHeader>
				{/* 与详情页的贡献列表同款：一张卡片，条目之间只用分隔线 */}
				{/* overflow-y-auto 会把 overflow-x 也算成 auto，显式关掉横向滚动，长文案改为换行 */}
				<div className="max-h-[60vh] overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-background/50">
					<label className="flex items-center justify-between gap-3 border-b border-border/60 px-2.5 py-2">
						<span className="min-w-0 flex-1 break-words">
							<span className="block text-[12px] text-foreground">{t("plugin.setupEnable")}</span>
							<span className="block text-[11px] text-muted-foreground">{t("plugin.setupEnableHint")}</span>
						</span>
						<Switch className="shrink-0" checked={enabled} disabled={item.busy} onCheckedChange={setEnabled} />
					</label>
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
								checked={granted.includes(permission)}
								disabled={item.busy}
								onCheckedChange={(checked) =>
									setGranted((current) =>
										checked ? [...current, permission] : current.filter((value) => value !== permission),
									)
								}
							/>
						</label>
					))}
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={requestClose} disabled={item.busy}>
						{tCommon("actions.cancel")}
					</Button>
					<Button onClick={apply} disabled={item.busy}>
						{tCommon("actions.confirm")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
