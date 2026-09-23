import { useTranslation } from "@vetta-org/plugin-sdk";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Input,
} from "@vetta-org/ui";
import { useRef, useState } from "react";
import type { HeadState, ResetMode } from "../../git/commitActions";
import { createBranchAtCommit, detachAtCommit, readHeadState, resetToCommit } from "../../git/commitActions";
import { emitRefreshSignal, notifyError } from "../../git/runtime";
import type { CommitNode } from "../../git/types";
import { ConfirmDialog } from "../ConfirmDialog";

export interface CommitMenuTarget {
	node: CommitNode;
	x: number;
	y: number;
}
type Pending = { node: CommitNode } & (
	| { kind: "branch" | "detach" }
	| { kind: "reset"; mode: ResetMode; head: HeadState }
);

/** Menu intent and confirmation are separate: opening a menu never changes the repository. */
export function CommitActions({
	root,
	target,
	onClose,
}: {
	root: string;
	target: CommitMenuTarget | null;
	onClose: () => void;
}): JSX.Element {
	const { t } = useTranslation();
	const [pending, setPending] = useState<Pending | null>(null);
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const running = useRef(false);
	const [error, setError] = useState<string | null>(null);

	const run = async (task: () => Promise<void>): Promise<void> => {
		if (running.current) return;
		running.current = true;
		setBusy(true);
		setError(null);
		try {
			await task();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setError(message);
			notifyError(message, err);
		} finally {
			running.current = false;
			setBusy(false);
		}
	};

	const request = (kind: "branch" | "detach" | ResetMode): void => {
		if (!target || running.current) return;
		const { node } = target;
		setName("");
		setError(null);
		onClose();
		if (kind === "branch" || kind === "detach") setPending({ kind, node });
		else void run(async () => setPending({ kind: "reset", mode: kind, node, head: await readHeadState(root) }));
	};

	const confirm = (): void => {
		if (!pending || (pending.kind === "branch" && !name.trim())) return;
		void run(async () => {
			if (pending.kind === "branch") await createBranchAtCommit(root, pending.node.hash, name.trim());
			else if (pending.kind === "detach") await detachAtCommit(root, pending.node.hash);
			else if (pending.kind === "reset") await resetToCommit(root, pending.node.hash, pending.mode, pending.head);
			setPending(null);
			emitRefreshSignal();
		});
	};
	const action = pending?.kind === "reset" ? `reset.${pending.mode}` : pending?.kind;

	return (
		<>
			{target && (
				<DropdownMenu
					open
					onOpenChange={(open) => {
						if (!open) onClose();
					}}
					modal={false}
				>
					<DropdownMenuTrigger
						aria-label={t("commit.actions")}
						className="fixed h-0 w-0"
						style={{ left: target.x, top: target.y }}
					/>
					<DropdownMenuContent
						data-vetta-plugin-root="git"
						align="start"
						sideOffset={0}
						onCloseAutoFocus={(event) => event.preventDefault()}
					>
						<DropdownMenuItem
							disabled={busy}
							onSelect={() => {
								const hash = target.node.hash;
								onClose();
								void run(() => navigator.clipboard.writeText(hash));
							}}
						>
							{t("commit.copyHash")}
						</DropdownMenuItem>
						<DropdownMenuItem disabled={busy} onSelect={() => request("branch")}>
							{t("commit.branch")}
						</DropdownMenuItem>
						<DropdownMenuItem disabled={busy} onSelect={() => request("detach")}>
							{t("commit.detach")}
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						{(["soft", "mixed", "hard"] as const).map((mode) => (
							<DropdownMenuItem
								key={mode}
								disabled={busy}
								className={mode === "hard" ? "text-destructive" : undefined}
								onSelect={() => request(mode)}
							>
								{t(`commit.reset.${mode}`)}
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			)}
			{pending && (
				<ConfirmDialog
					open
					title={t(`commit.${action}`)}
					description={t(`commit.${action}.description`)}
					confirmLabel={t("commit.execute")}
					busy={busy}
					confirmDisabled={pending.kind === "branch" && !name.trim()}
					destructive={pending.kind === "reset"}
					onConfirm={confirm}
					onCancel={() => {
						if (!running.current) setPending(null);
					}}
					detail={
						<div className="space-y-3">
							<p className="break-all text-[12px]">
								{pending.node.subject}
								<br />
								<span className="git-mono">{pending.node.hash}</span>
							</p>
							{pending.kind === "reset" && (
								<p className="text-[12px]">
									{t("commit.reset.current", {
										branch: pending.head.branch ?? t("branch.detached"),
										hash: pending.head.hash.slice(0, 8),
									})}
								</p>
							)}
							{pending.kind === "branch" && (
								<Input
									aria-label={t("branch.namePlaceholder")}
									placeholder={t("branch.namePlaceholder")}
									value={name}
									disabled={busy}
									onChange={(event) => setName(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Enter" && !event.nativeEvent.isComposing) confirm();
									}}
								/>
							)}
							{error && (
								<p role="alert" className="text-[12px] text-destructive">
									{error}
								</p>
							)}
						</div>
					}
				/>
			)}
		</>
	);
}
