import type { AddMarketplaceSourceInput, MarketplaceSource, UpdateMarketplaceSourceInput } from "@preload/api";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@vetta/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MarketplaceSourceForm, type MarketplaceSourceFormValue } from "./MarketplaceSourceForm";
import { MarketplaceSourceRow } from "./MarketplaceSourceRow";

type Editing = { kind: "none" } | { kind: "add" } | { kind: "edit"; id: string };

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** 能力来源的增删改查；内置来源只能启停，不能改配置或删除。 */
export function MarketplaceSourcesDialog({
	sources,
	onAdd,
	onUpdate,
	onRemove,
	onClose,
}: {
	sources: MarketplaceSource[];
	onAdd: (input: AddMarketplaceSourceInput) => Promise<void>;
	onUpdate: (id: string, input: UpdateMarketplaceSourceInput) => Promise<void>;
	onRemove: (id: string) => Promise<void>;
	onClose: () => void;
}): JSX.Element {
	const { t } = useTranslation(["abilities", "common"]);
	const [editing, setEditing] = useState<Editing>({ kind: "none" });
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const run = (task: Promise<void>, onDone?: () => void): void => {
		setBusy(true);
		setError(null);
		void task
			.then(() => onDone?.())
			.catch((reason: unknown) => setError(errorMessage(reason)))
			.finally(() => setBusy(false));
	};

	const submitForm = (value: MarketplaceSourceFormValue): void => {
		if (editing.kind === "add") {
			run(
				onAdd({
					repository: value.repository,
					...(value.name ? { name: value.name } : {}),
					...(value.ref ? { ref: value.ref } : {}),
				}),
				() => setEditing({ kind: "none" }),
			);
			return;
		}
		if (editing.kind !== "edit") return;
		run(
			onUpdate(editing.id, {
				...(value.name ? { name: value.name } : {}),
				...(value.ref ? { ref: value.ref } : {}),
			}),
			() => setEditing({ kind: "none" }),
		);
	};

	const editingSource = editing.kind === "edit" ? sources.find((source) => source.id === editing.id) : undefined;

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy) onClose();
			}}
		>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>{t("abilities:sources.dialog.title")}</DialogTitle>
					<DialogDescription>{t("abilities:sources.dialog.description")}</DialogDescription>
				</DialogHeader>

				<div className="mt-4 flex max-h-[52vh] flex-col gap-2 overflow-y-auto">
					{sources.length === 0 ? (
						<p className="rounded-xl border border-border/50 bg-card/30 px-3 py-6 text-center text-[12px] text-muted-foreground/60">
							{t("abilities:sources.empty")}
						</p>
					) : (
						sources.map((source) => (
							<MarketplaceSourceRow
								key={source.id}
								source={source}
								busy={busy}
								onToggle={(enabled) => run(onUpdate(source.id, { enabled }))}
								onEdit={() => setEditing({ kind: "edit", id: source.id })}
								onRemove={() => run(onRemove(source.id))}
							/>
						))
					)}
				</div>

				{editing.kind === "add" && (
					<div className="mt-3">
						<MarketplaceSourceForm
							mode="add"
							submitting={busy}
							onSubmit={submitForm}
							onCancel={() => setEditing({ kind: "none" })}
						/>
					</div>
				)}
				{editingSource && (
					<div className="mt-3">
						<MarketplaceSourceForm
							key={editingSource.id}
							mode="edit"
							initial={{
								repository: editingSource.repository,
								name: editingSource.name,
								ref: editingSource.ref,
							}}
							submitting={busy}
							onSubmit={submitForm}
							onCancel={() => setEditing({ kind: "none" })}
						/>
					</div>
				)}

				{error && (
					<div className="mt-3 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
						<span className="icon-[solar--danger-circle-linear] mt-0.5 h-3.5 w-3.5 shrink-0" />
						<span>{t("abilities:sources.error", { error })}</span>
					</div>
				)}

				<DialogFooter className="mt-5">
					{editing.kind === "none" && (
						<Button type="button" variant="secondary" disabled={busy} onClick={() => setEditing({ kind: "add" })}>
							<span className="icon-[solar--add-circle-linear] h-3.5 w-3.5" />
							{t("abilities:sources.actions.add")}
						</Button>
					)}
					<Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
						{t("common:actions.close")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
