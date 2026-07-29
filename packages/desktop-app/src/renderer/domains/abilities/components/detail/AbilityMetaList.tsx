import type { AbilityMetaEntry, AbilityMetaKey } from "@shared/lib/api";
import { useTranslation } from "react-i18next";
import type { AbilitiesModel, AbilityItem } from "../../types";
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
			<div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
				{t("meta.title")}
			</div>
			<dl className="flex flex-col gap-1.5 text-[11px]">
				{entries.map((entry, index) => (
					<div
						// 同一个预置键不会重复出现，但自定义条目可能重名，故带上索引
						key={`${entry.key ?? entry.label ?? ""}-${index}`}
						className="flex items-start gap-3"
					>
						<dt className="w-20 shrink-0 text-muted-foreground/50">
							{entry.key && entry.key in META_LABEL_KEYS
								? t(META_LABEL_KEYS[entry.key])
								: (entry.label ?? "")}
						</dt>
						<dd className="min-w-0 flex-1 break-words text-muted-foreground">
							<MetaValue value={entry.value} />
						</dd>
					</div>
				))}
				<AbilitySourceMetaRow item={item} />
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
