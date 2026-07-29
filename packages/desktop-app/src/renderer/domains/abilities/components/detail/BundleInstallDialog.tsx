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

export function BundleInstallDialog({
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
	const rows = bundle.members.map((member) => ({
		declared: member,
		resolved: bundle.memberItems.find(
			(candidate) => candidate.type === member.type && candidate.slug === member.slug,
		),
	}));
	const selectable = rows
		.map(({ resolved }) => resolved)
		.filter(
			(member): member is AbilityItem => Boolean(member && !member.readonly && (!member.installed || member.needsUpdate)),
		);
	const selectableIds = selectable.map((member) => member.id).join(",");
	const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set<string>());

	useEffect(() => {
		if (!open) return;
		setSelected(new Set(selectableIds ? selectableIds.split(",") : []));
	}, [open, selectableIds]);

	const toggle = (id: string): void => {
		setSelected((previous) => {
			const next = new Set(previous);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>{t("bundle.install.title")}</DialogTitle>
					<DialogDescription>{t("bundle.install.description", { name: bundle.title })}</DialogDescription>
				</DialogHeader>

				{rows.length === 0 ? (
					<p className="text-[12px] text-muted-foreground">{t("bundle.install.nothing")}</p>
				) : (
					<ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
						{rows.map(({ declared, resolved }) => {
							const canSelect = Boolean(
								resolved && !resolved.readonly && (!resolved.installed || resolved.needsUpdate),
							);
							const id = resolved?.id ?? `${declared.type}:${declared.slug}`;
							return (
								<li key={id}>
									<label className="flex items-center gap-3 rounded-lg border border-border/50 px-2.5 py-2 has-[:enabled]:cursor-pointer has-[:enabled]:hover:bg-accent/50">
										<input
											type="checkbox"
											className="h-3.5 w-3.5 accent-[var(--primary)]"
											checked={selected.has(id)}
											disabled={!canSelect}
											onChange={() => toggle(id)}
										/>
										<AbilityIcon
											icon={resolved?.icon ?? declared.icon}
											type={declared.type}
											className="h-8 w-8"
											iconClassName="h-4 w-4"
										/>
										<div className="min-w-0 flex-1">
											<p className="truncate text-[12px] text-foreground">
												{resolved?.title || declared.name || declared.slug}
											</p>
											<p className="text-[10px] text-muted-foreground/70">
												{!resolved
													? t("bundle.missing")
													: resolved.needsUpdate
														? t("status.updateAvailable")
														: resolved.installed || resolved.readonly
															? t("bundle.memberInstalled")
															: t("bundle.memberNotInstalled")}
											</p>
										</div>
									</label>
								</li>
							);
						})}
					</ul>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{t("actions.cancel")}
					</Button>
					<Button
						variant="primary"
						disabled={selected.size === 0}
						onClick={() => {
							onConfirm(selectable.filter((member) => selected.has(member.id)));
							onOpenChange(false);
						}}
					>
						{t("bundle.install.confirm", { count: selected.size })}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
