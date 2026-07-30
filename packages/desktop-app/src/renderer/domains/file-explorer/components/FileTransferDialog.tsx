import type { FileTransferAction, FileTransferConflictPolicy, FileTransferPlan } from "@preload/fs-types";
import { Button } from "@shared/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@shared/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@shared/components/ui/select";
import { pathBasename } from "@shared/lib/utils";
import { useTranslation } from "react-i18next";

interface FileTransferDialogProps {
	plan: FileTransferPlan;
	conflictPolicy: FileTransferConflictPolicy;
	busy: boolean;
	onConflictPolicyChange: (policy: FileTransferConflictPolicy) => void;
	onConfirm: (action: FileTransferAction) => void;
	onCancel: () => void;
}

function isConflictPolicy(value: string): value is FileTransferConflictPolicy {
	return value === "keep-both" || value === "replace" || value === "skip";
}

export function FileTransferDialog({
	plan,
	conflictPolicy,
	busy,
	onConflictPolicyChange,
	onConfirm,
	onCancel,
}: FileTransferDialogProps): JSX.Element {
	const { t } = useTranslation("chat");
	const conflictCount = plan.items.filter((item) => item.hasConflict).length;
	const destinationName = pathBasename(plan.destinationDirectory);

	return (
		<Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
			<DialogContent className="max-w-[420px]">
				<DialogHeader>
					<DialogTitle>{t("fileExplorer.transfer.title")}</DialogTitle>
					<DialogDescription>
						{t("fileExplorer.transfer.description", { count: plan.items.length, destination: destinationName })}
					</DialogDescription>
				</DialogHeader>

				<div className="rounded-lg border border-border/50 bg-muted/40 px-3 py-2.5 text-[12px] text-foreground">
					<div className="flex items-center gap-2">
						<span className="icon-[solar--folder-with-files-linear] h-4 w-4 shrink-0 text-primary" />
						<span className="min-w-0 truncate">{plan.items.map((item) => item.name).join(", ")}</span>
					</div>
				</div>
				<p className="text-[11px] text-muted-foreground">{t("fileExplorer.transfer.moveWarning")}</p>

				{conflictCount > 0 && (
					<div className="space-y-1.5">
						<label className="text-[11px] font-medium text-muted-foreground" htmlFor="file-transfer-conflict-policy">
							{t("fileExplorer.transfer.conflictLabel", { count: conflictCount })}
						</label>
						<Select
							value={conflictPolicy}
							onValueChange={(value) => isConflictPolicy(value) && onConflictPolicyChange(value)}
						>
							<SelectTrigger id="file-transfer-conflict-policy" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="keep-both">{t("fileExplorer.transfer.keepBoth")}</SelectItem>
								<SelectItem value="replace">{t("fileExplorer.transfer.replace")}</SelectItem>
								<SelectItem value="skip">{t("fileExplorer.transfer.skip")}</SelectItem>
							</SelectContent>
						</Select>
					</div>
				)}

				<DialogFooter>
					<Button variant="outline" disabled={busy} onClick={onCancel}>
						{t("fileExplorer.transfer.cancel")}
					</Button>
					<Button variant="secondary" disabled={busy} onClick={() => onConfirm("move")}>
						{t("fileExplorer.transfer.move")}
					</Button>
					<Button disabled={busy} onClick={() => onConfirm("copy")}>
						{busy ? t("fileExplorer.transfer.processing") : t("fileExplorer.transfer.copy")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
