import type { AddMarketplaceSourceInput } from "@preload/api";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@vetta/ui";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function ExternalRepositoryDialog({
	onAdd,
	onClose,
}: {
	onAdd: (input: AddMarketplaceSourceInput) => Promise<void>;
	onClose: () => void;
}): JSX.Element {
	const { t } = useTranslation(["abilities", "common"]);
	const [repository, setRepository] = useState("");
	const [ref, setRef] = useState("main");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const submit = (event: FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		if (!repository.trim() || submitting) return;
		setSubmitting(true);
		setError(null);
		void onAdd({ repository: repository.trim(), ...(ref.trim() ? { ref: ref.trim() } : {}) })
			.then(onClose)
			.catch((reason: unknown) => setError(errorMessage(reason)))
			.finally(() => setSubmitting(false));
	};

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !submitting) onClose();
			}}
		>
			<DialogContent className="max-w-md">
				<form onSubmit={submit}>
					<DialogHeader>
						<DialogTitle>{t("abilities:add.repositoryDialog.title")}</DialogTitle>
						<DialogDescription>{t("abilities:add.repositoryDialog.description")}</DialogDescription>
					</DialogHeader>
					<div className="mt-4 flex flex-col gap-3">
						<label className="flex flex-col gap-1.5">
							<span className="text-[12px] font-medium text-foreground">
								{t("abilities:add.repositoryDialog.repositoryLabel")}
							</span>
							<input
								autoFocus
								value={repository}
								disabled={submitting}
								onChange={(event) => setRepository(event.target.value)}
								placeholder={t("abilities:add.repositoryDialog.repositoryPlaceholder")}
								className="h-8 w-full rounded-lg border border-border bg-card px-2.5 text-[12px] font-medium text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 hover:bg-accent focus-visible:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
							/>
						</label>
						<label className="flex flex-col gap-1.5">
							<span className="text-[12px] font-medium text-foreground">
								{t("abilities:add.repositoryDialog.refLabel")}
							</span>
							<input
								value={ref}
								disabled={submitting}
								onChange={(event) => setRef(event.target.value)}
								placeholder={t("abilities:add.repositoryDialog.refPlaceholder")}
								className="h-8 w-full rounded-lg border border-border bg-card px-2.5 text-[12px] font-medium text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 hover:bg-accent focus-visible:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
							/>
						</label>
						{error && (
							<div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
								<span className="icon-[solar--danger-circle-linear] mt-0.5 h-3.5 w-3.5 shrink-0" />
								<span>{t("abilities:add.repositoryDialog.error", { error })}</span>
							</div>
						)}
					</div>
					<DialogFooter className="mt-5">
						<Button type="button" variant="ghost" disabled={submitting} onClick={onClose}>
							{t("common:actions.cancel")}
						</Button>
						<Button type="submit" disabled={submitting || !repository.trim()}>
							{submitting && <span className="icon-[solar--refresh-linear] h-3.5 w-3.5 animate-spin" />}
							{submitting
								? t("abilities:add.repositoryDialog.syncing")
								: t("abilities:add.repositoryDialog.submit")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
