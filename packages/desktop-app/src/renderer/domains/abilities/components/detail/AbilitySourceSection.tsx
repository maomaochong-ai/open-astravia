import { useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useAbilityText } from "../../hooks/useAbilityText";
import type { AbilitiesModel, AbilityCatalogSource, AbilityItem } from "../../types";
import { AbilityIcon } from "../AbilityIcon";

function sourceName(source: AbilityCatalogSource, t: TFunction<"abilities">): string {
	switch (source.kind) {
		case "builtin":
			return t("detail.source.builtin");
		case "local":
			return t("detail.source.local");
		case "server":
			return t("detail.source.server");
		case "github":
			return source.name;
	}
}

export function AbilitySourceSection({
	item,
	model,
}: {
	item: AbilityItem;
	model: AbilitiesModel;
}): JSX.Element {
	const { t } = useTranslation("abilities");
	const navigate = useNavigate();
	const resolveText = useAbilityText();
	const sameNameItems = (item.sameNameIds ?? [])
		.map((id) => model.findById(id))
		.filter((candidate): candidate is AbilityItem => candidate !== null);

	return (
		<section className="flex flex-col gap-3 rounded-xl border border-border/50 bg-card/30 p-4">
			<div>
				<h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
					{t("detail.source.title")}
				</h2>
				<p className="mt-1 text-[13px] font-medium text-foreground">
					{sourceName(item.catalogSource, t)}
				</p>
				{item.catalogSource.kind === "github" ? (
					<a
						href={item.catalogSource.repository}
						target="_blank"
						rel="noreferrer"
						className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
					>
						{item.catalogSource.repository}
						<span className="icon-[solar--arrow-right-up-linear] h-3 w-3" />
					</a>
				) : null}
			</div>

			{item.installConflictIds?.length ? (
				<p className="rounded-lg bg-amber-500/15 px-3 py-2 text-[11px] text-amber-400">
					{t("detail.source.installConflict")}
				</p>
			) : null}

			{sameNameItems.length > 0 ? (
				<div className="border-t border-border/50 pt-3">
					<h3 className="text-[11px] font-medium text-muted-foreground/70">
						{t("detail.source.sameNameTitle", { count: sameNameItems.length })}
					</h3>
					<ul className="mt-2 flex flex-col gap-1.5">
						{sameNameItems.map((candidate) => {
							const text = resolveText(candidate);
							return (
								<li key={candidate.id}>
									<button
										type="button"
										className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent/60"
										onClick={() =>
											void navigate({
												to: "/abilities",
												search: { detail: candidate.id },
											})
										}
									>
										<AbilityIcon
											icon={candidate.icon}
											type={candidate.type}
											className="h-8 w-8"
											iconClassName="h-3.5 w-3.5"
										/>
										<span className="min-w-0 flex-1">
											<span className="block truncate text-[12px] font-medium text-foreground">
												{text.title}
											</span>
											<span className="block truncate text-[10px] text-muted-foreground/60">
												{sourceName(candidate.catalogSource, t)}
											</span>
										</span>
										<span className="icon-[solar--alt-arrow-right-linear] h-3.5 w-3.5 text-muted-foreground/50" />
									</button>
								</li>
							);
						})}
					</ul>
				</div>
			) : null}
		</section>
	);
}
