import { useMemo, useState, type JSX } from "react";
import { InputField } from "@astravia/theme-ui/settings";
import { cn } from "@astravia/ui";
import { useTranslation } from "react-i18next";
import { DatabaseTypeBadge } from "./DatabaseTypeBadge";
import { DATABASE_TYPE_GROUPS, DATABASE_TYPES } from "../lib/database-type-catalog";
import { DatabaseSectionLabel } from "./DatabaseSectionLabel";

/**
 * dbx 风格的数据库类型选择器：搜索框 + 分组磁贴网格。
 * 取代 40+ 类型的长下拉框；选中态用软填充而非边框表达。
 */
export function DatabaseTypePicker({
	value,
	onChange,
}: {
	value: string;
	onChange: (value: string) => void;
}): JSX.Element {
	const { t } = useTranslation("settings");
	const [query, setQuery] = useState("");

	const groups = useMemo(() => {
		const keyword = query.trim().toLowerCase();
		const matches = keyword
			? DATABASE_TYPES.filter(
					(type) => type.label.toLowerCase().includes(keyword) || type.value.includes(keyword),
				)
			: DATABASE_TYPES;
		return DATABASE_TYPE_GROUPS.map((group) => ({
			group,
			types: matches.filter((type) => type.group === group.id),
		})).filter((entry) => entry.types.length > 0);
	}, [query]);

	return (
		<div>
			<InputField value={query} onChange={setQuery} placeholder={t("databaseSearchType")} />
			<div className="mt-2 max-h-52 space-y-3 overflow-y-auto pr-1">
				{groups.length === 0 ? (
					<p className="px-1 py-4 text-center text-[12px] text-muted-foreground">
						{t("databaseNoMatchingType")}
					</p>
				) : (
					groups.map(({ group, types }) => (
						<div key={group.id}>
							<DatabaseSectionLabel className="px-1 pb-1.5">{t(group.labelKey)}</DatabaseSectionLabel>
							<div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
								{types.map((type) => {
									const selected = type.value === value;
									return (
										<button
											key={type.value}
											type="button"
											onClick={() => onChange(type.value)}
											className={cn(
												"flex items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none transition-colors",
												selected ? "bg-primary/12" : "hover:bg-accent/60 focus-visible:bg-accent/60",
											)}
										>
											<DatabaseTypeBadge type={type.value} size="sm" />
											<span
												className={cn(
													"min-w-0 flex-1 truncate text-[12px]",
													selected ? "font-semibold text-primary" : "text-foreground",
												)}
											>
												{type.label}
											</span>
											{selected ? (
												<span className="icon-[mdi--check] h-3.5 w-3.5 shrink-0 text-primary" />
											) : null}
										</button>
									);
								})}
							</div>
						</div>
					))
				)}
			</div>
		</div>
	);
}
