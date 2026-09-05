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

function sameSet<T extends string>(a: readonly T[], b: readonly T[]): boolean {
	return a.length === b.length && a.every((value) => b.includes(value));
}

/**
 * 装完立刻弹的启用 + 授权配置：安装本身不启用插件（plugin catalog 的 enabled 默认 false），
 * 权限与命令首装也全未授予，漏配就会表现为「装了但什么都没出现」。这里把设置收进
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
	const isUpdate = item.setupMode === "update";
	// 首装默认全开；更新只自动勾选新增权限，保留用户已有授权选择。
	const [enabled, setEnabled] = useState(() => (isUpdate ? item.enabled : true));
	const [granted, setGranted] = useState<PluginPermission[]>(() =>
		isUpdate ? Array.from(new Set([...item.grantedPermissions, ...(item.permissionChanges?.added ?? [])])) : [...item.permissions],
	);
	const [grantedCommands, setGrantedCommands] = useState<string[]>(() =>
		isUpdate ? Array.from(new Set([...item.grantedCommands, ...(item.commandChanges?.added ?? [])])) : [...item.commands],
	);
	const [submitting, setSubmitting] = useState(false);

	const dirty =
		enabled !== item.enabled ||
		!sameSet(granted, item.grantedPermissions) ||
		!sameSet(grantedCommands, item.grantedCommands);

	const apply = async (): Promise<void> => {
		setSubmitting(true);
		try {
			await model.applyPluginSetup(item, { enabled, grantedPermissions: granted, grantedCommands });
			onClose();
		} catch {
			// 操作层已写入错误提示；保留弹窗，用户可以重试或调整权限。
		} finally {
			setSubmitting(false);
		}
	};
	const busy = item.busy || submitting;
	const permissionAdded = new Set(item.permissionChanges?.added ?? []);
	const commandAdded = new Set(item.commandChanges?.added ?? []);

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
					<DialogDescription>
						{isUpdate ? t("plugin.updateSetupDialogHint") : t("plugin.setupDialogHint")}
					</DialogDescription>
				</DialogHeader>
				<div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-foreground">
					{t("plugin.trustNotice")}
				</div>
				{/* 与详情页的贡献列表同款：一张卡片，条目之间只用分隔线 */}
				{/* overflow-y-auto 会把 overflow-x 也算成 auto，显式关掉横向滚动，长文案改为换行 */}
				<div className="max-h-[60vh] overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-background/50">
					<label className="flex items-center justify-between gap-3 border-b border-border/60 px-2.5 py-2">
						<span className="min-w-0 flex-1 break-words">
							<span className="block text-[12px] text-foreground">{t("plugin.setupEnable")}</span>
							<span className="block text-[11px] text-muted-foreground">{t("plugin.setupEnableHint")}</span>
						</span>
						<Switch className="shrink-0" checked={enabled} disabled={busy} onCheckedChange={setEnabled} />
					</label>
					{item.permissions.map((permission) => (
						<label
							key={permission}
							className="flex items-center justify-between gap-3 border-b border-border/60 px-2.5 py-2 last:border-b-0"
						>
							<span className="min-w-0 flex-1 break-words text-[12px] text-foreground">
								{t(PLUGIN_PERMISSION_LABEL_KEYS[permission])}
								{permissionAdded.has(permission) ? <span className="ml-2 text-[10px] text-amber-500">{t("plugin.permissionAdded")}</span> : null}
							</span>
							<Switch
								className="shrink-0"
								checked={granted.includes(permission)}
								disabled={busy}
								onCheckedChange={(checked) =>
									setGranted((current) =>
										checked ? [...current, permission] : current.filter((value) => value !== permission),
									)
								}
							/>
						</label>
					))}
					{item.permissionChanges?.removed.map((permission) => (
						<div key={`removed-${permission}`} className="flex items-center justify-between gap-3 border-b border-border/60 px-2.5 py-2 text-[12px] text-muted-foreground">
							<span>{t(PLUGIN_PERMISSION_LABEL_KEYS[permission])}</span>
							<span className="text-[10px] text-muted-foreground">{t("plugin.permissionRemoved")}</span>
						</div>
					))}
					{item.commands.map((command) => (
						<label
							key={command}
							className="flex items-center justify-between gap-3 border-b border-border/60 px-2.5 py-2 last:border-b-0"
						>
							<span className="min-w-0 flex-1 break-words text-[12px] text-foreground">
								{t("plugin.commands")}: <code className="font-mono">{command}</code>
								{commandAdded.has(command) ? <span className="ml-2 text-[10px] text-amber-500">{t("plugin.permissionAdded")}</span> : null}
							</span>
							<Switch
								className="shrink-0"
								checked={grantedCommands.includes(command)}
								disabled={busy}
								onCheckedChange={(checked) =>
									setGrantedCommands((current) =>
										checked ? [...current, command] : current.filter((value) => value !== command),
									)
								}
							/>
						</label>
					))}
					{item.commandChanges?.removed.map((command) => (
						<div key={`removed-command-${command}`} className="flex items-center justify-between gap-3 border-b border-border/60 px-2.5 py-2 text-[12px] text-muted-foreground">
							<span>{t("plugin.commands")}: <code className="font-mono">{command}</code></span>
							<span className="text-[10px]">{t("plugin.permissionRemoved")}</span>
						</div>
					))}
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={requestClose} disabled={busy}>
						{tCommon("actions.cancel")}
					</Button>
					<Button onClick={() => void apply()} disabled={busy} aria-busy={submitting}>
						{submitting ? t("operation.applyingSetup") : tCommon("actions.confirm")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
