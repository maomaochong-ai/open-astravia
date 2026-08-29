import type { AbilityMetaEntry, AbilityMetaKey } from "@shared/lib/api";
import { cn } from "@vetta/ui";
import { useTranslation } from "react-i18next";
import type { AbilitiesModel, AbilityItem } from "../../types";
import { DETAIL_KICKER, DETAIL_RULE } from "./ability-detail-surface";
import { AbilitySourceMetaRow, AbilitySourceRelations } from "./AbilitySourceMeta";

/** 预置键 → i18n label key。未知键当作自定义条目处理（服务端已白名单校验，这里只是渲染兜底）。 */
const META_LABEL_KEYS = {
	homepage: "meta.homepage",
	repository: "meta.repository",
	docs: "meta.docs",
	license: "meta.license",
} as const satisfies Record<AbilityMetaKey, string>;

/**
 * 详情页元信息表：官网 / 仓库 / 文档 / 开源协议 + 运营自定义条目。
 * 顺序即 raw.detail.meta 的数组顺序（运营在 admin 里排定）。
 */
export function AbilityMetaList({
	meta,
	item,
	model,
}: {
	meta: AbilityMetaEntry[] | undefined;
	item: AbilityItem;
	model: AbilitiesModel;
}): JSX.Element {
	const { t } = useTranslation("abilities");
	const entries = (meta ?? []).filter((entry) => entry.value.trim().length > 0);

	return (
		<section>
			<div className={cn("mb-2", DETAIL_KICKER)}>{t("meta.title")}</div>
			<dl className="flex flex-col text-[12px]">
				{entries.map((entry, index) => (
					<div
						key={`${entry.key ?? entry.label ?? ""}-${index}`}
						className={cn("flex items-start gap-3 py-2", index > 0 && DETAIL_RULE)}
					>
						<dt className="w-20 shrink-0 text-[11px] text-muted-foreground/60">
							{entry.key && entry.key in META_LABEL_KEYS
								? t(META_LABEL_KEYS[entry.key])
								: (entry.label ?? "")}
						</dt>
						<dd className="min-w-0 flex-1 break-words text-foreground/80">
							<MetaValue value={entry.value} />
						</dd>
					</div>
				))}
				<div className={cn("py-2", entries.length > 0 && DETAIL_RULE)}>
					<AbilitySourceMetaRow item={item} />
				</div>
			</dl>
			<AbilitySourceRelations item={item} model={model} />
		</section>
	);
}

/** http(s) 开头渲染为可点击链接，其余按纯文本。 */
function MetaValue({ value }: { value: string }): JSX.Element {
	const trimmed = value.trim();
	if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
		return <span>{trimmed}</span>;
	}
	return (
		<a
			href={trimmed}
			target="_blank"
			rel="noreferrer"
			className="text-primary underline-offset-2 hover:underline"
		>
			{trimmed}
		</a>
	);
}
