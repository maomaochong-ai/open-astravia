import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@vetta/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AbilityItem, BundleAbility } from "../../types";
import { AbilityIcon } from "../AbilityIcon";

/**
 * bundle 卸载确认：列出将被卸载的成员，且允许逐项取消勾选。
 * bundle 本身无产物，卸载即「批量卸载选中的成员」。
 */
export function BundleUninstallDialog({
	bundle,
	open,
	onOpenChange,
	onConfirm,
}: {
	bundle: BundleAbility;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: (members: AbilityItem[]) => void;
}): JSX.Element {
	const { t } = useTranslation("abilities");
	const removable = bundle.memberItems.filter((member) => member.installed && !member.readonly);
	const removableIds = removable.map((member) => member.id).join(",");
	const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set<string>());

	// 打开时默认全选；成员集合变化（安装/卸载后刷新）也重置，避免勾选残留到已不存在的成员。
	useEffect(() => {
		if (!open) return;
		setSelected(new Set(removableIds ? removableIds.split(",") : []));
	}, [open, removableIds]);

	const toggle = (id: string): void => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>{t("bundle.uninstall.title")}</DialogTitle>
					<DialogDescription>{t("bundle.uninstall.description", { name: bundle.title })}</DialogDescription>
				</DialogHeader>

				{removable.length === 0 ? (
					<p className="text-[12px] text-muted-foreground">{t("bundle.uninstall.nothing")}</p>
				) : (
					<ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
						{removable.map((member) => (
							<li key={member.id}>
								<label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border/50 px-2.5 py-2 hover:bg-accent/50">
									<input
										type="checkbox"
										className="h-3.5 w-3.5 accent-[var(--primary)]"
										checked={selected.has(member.id)}
										onChange={() => toggle(member.id)}
									/>
									<AbilityIcon
										icon={member.icon}
										type={member.type}
										className="h-8 w-8"
										iconClassName="h-4 w-4"
									/>
									<span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{member.title}</span>
								</label>
							</li>
						))}
					</ul>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{t("actions.cancel")}
					</Button>
					<Button
						variant="destructive"
						disabled={selected.size === 0}
						onClick={() => {
							onConfirm(removable.filter((member) => selected.has(member.id)));
							onOpenChange(false);
						}}
					>
						{t("bundle.uninstall.confirm", { count: selected.size })}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
