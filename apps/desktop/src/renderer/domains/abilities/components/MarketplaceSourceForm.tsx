import { Button } from "@vetta/ui";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";

export interface MarketplaceSourceFormValue {
	repository: string;
	name: string;
	ref: string;
}

const inputClassName =
	"h-8 w-full rounded-lg border border-border bg-card px-2.5 text-[12px] font-medium text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 hover:bg-accent focus-visible:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50";

/** 新增 / 编辑来源共用的表单；编辑时仓库地址固定（改仓库等于换一个来源）。 */
export function MarketplaceSourceForm({
	mode,
	initial,
	submitting,
	onSubmit,
	onCancel,
}: {
	mode: "add" | "edit";
	initial?: MarketplaceSourceFormValue;
	submitting: boolean;
	onSubmit: (value: MarketplaceSourceFormValue) => void;
	onCancel: () => void;
}): JSX.Element {
	const { t } = useTranslation(["abilities", "common"]);
	const [repository, setRepository] = useState(initial?.repository ?? "");
	const [name, setName] = useState(initial?.name ?? "");
	const [ref, setRef] = useState(initial?.ref ?? "main");

	const submit = (event: FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		if (submitting || !repository.trim()) return;
		onSubmit({ repository: repository.trim(), name: name.trim(), ref: ref.trim() });
	};

	return (
		<form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card/40 p-3">
			<p className="text-[12px] font-semibold text-foreground">
				{mode === "add" ? t("abilities:sources.form.addTitle") : t("abilities:sources.form.editTitle")}
			</p>
			<label className="flex flex-col gap-1.5">
				<span className="text-[11px] font-medium text-muted-foreground/80">
					{t("abilities:sources.form.repositoryLabel")}
				</span>
				<input
					autoFocus={mode === "add"}
					value={repository}
					disabled={submitting || mode === "edit"}
					onChange={(event) => setRepository(event.target.value)}
					placeholder={t("abilities:sources.form.repositoryPlaceholder")}
					className={inputClassName}
				/>
			</label>
			<div className="flex gap-3">
				<label className="flex flex-1 flex-col gap-1.5">
					<span className="text-[11px] font-medium text-muted-foreground/80">
						{t("abilities:sources.form.nameLabel")}
					</span>
					<input
						value={name}
						disabled={submitting}
						onChange={(event) => setName(event.target.value)}
						placeholder={t("abilities:sources.form.namePlaceholder")}
						className={inputClassName}
					/>
				</label>
				<label className="flex flex-1 flex-col gap-1.5">
					<span className="text-[11px] font-medium text-muted-foreground/80">
						{t("abilities:sources.form.refLabel")}
					</span>
					<input
						value={ref}
						disabled={submitting}
						onChange={(event) => setRef(event.target.value)}
						placeholder={t("abilities:sources.form.refPlaceholder")}
						className={inputClassName}
					/>
				</label>
			</div>
			<div className="flex justify-end gap-2">
				<Button type="button" size="sm" variant="ghost" disabled={submitting} onClick={onCancel}>
					{t("common:actions.cancel")}
				</Button>
				<Button type="submit" size="sm" disabled={submitting || !repository.trim()}>
					{submitting && <span className="icon-[solar--refresh-linear] h-3.5 w-3.5 animate-spin" />}
					{mode === "add" ? t("abilities:sources.form.submitAdd") : t("abilities:sources.form.submitEdit")}
				</Button>
			</div>
		</form>
	);
}
