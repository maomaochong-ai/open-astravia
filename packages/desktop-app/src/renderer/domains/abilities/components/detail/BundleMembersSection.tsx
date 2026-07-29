import { cn } from "@vetta/ui";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ABILITY_TYPE_ICON, ABILITY_TYPE_LABEL_KEY } from "../../lib/ability-presentation";
import type { BundleAbility } from "../../types";
import { AbilityIcon } from "../AbilityIcon";

/**
 * bundle 专属区块：成员列表。
 * 成员以 (type, slug) 引用已上架行，可逐个跳转到自己的详情页；
 * 仅 mcp 允许私有内联，内联成员没有独立详情页。
 */
export function BundleMembersSection({
	item,
}: {
	item: BundleAbility;
}): JSX.Element {
	const { t } = useTranslation("abilities");
	const navigate = useNavigate();

	return (
		<section className="flex flex-col gap-3">
			<h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
				{t("bundle.members", { count: item.members.length })}
			</h2>
			<ul className="flex flex-col gap-1.5">
				{item.members.map((member) => {
					const resolved = item.memberItems.find(
						(candidate) => candidate.type === member.type && candidate.slug === member.slug,
					);
					const inline = Boolean(member.inline);
					const navigable = !inline && member.exists;
					return (
						<li key={`${member.type}:${member.slug}`}>
							<button
								type="button"
								disabled={!navigable}
								onClick={() =>
									void navigate({
										to: "/abilities",
										search: { detail: resolved?.id },
									})
								}
								className={cn(
									"flex w-full items-center gap-3 rounded-xl border border-border/50 px-3 py-2.5 text-left transition-colors",
									navigable ? "hover:bg-accent/60" : "cursor-default opacity-70",
								)}
							>
								<AbilityIcon
									icon={resolved?.icon ?? member.icon}
									type={member.type}
									className="h-9 w-9"
									iconClassName="h-4 w-4"
								/>
								<div className="min-w-0 flex-1">
									<div className="flex min-w-0 flex-wrap items-center gap-1.5">
										<span className="truncate text-[12px] font-medium text-foreground">
											{resolved?.title || member.name || member.slug}
										</span>
										<span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/60 px-1.5 py-0.5 text-[10px] text-muted-foreground/80">
											<span className={cn("h-3 w-3", ABILITY_TYPE_ICON[member.type])} />
											{t(ABILITY_TYPE_LABEL_KEY[member.type])}
										</span>
										{inline ? (
											<span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
												{t("bundle.inline")}
											</span>
										) : null}
										{!inline && !member.exists ? (
											<span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive">
												{t("bundle.missing")}
											</span>
										) : null}
									</div>
									<p className="mt-0.5 text-[11px] text-muted-foreground/70">
										{resolved?.installed ? t("bundle.memberInstalled") : t("bundle.memberNotInstalled")}
									</p>
								</div>
								{navigable ? (
									<span className="icon-[solar--alt-arrow-right-linear] h-4 w-4 shrink-0 text-muted-foreground/50" />
								) : null}
							</button>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
