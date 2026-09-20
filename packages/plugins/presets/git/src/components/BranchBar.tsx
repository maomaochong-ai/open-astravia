import { useTranslation } from "@vetta-org/plugin-sdk";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Input,
} from "@vetta-org/ui";
import { useCallback, useEffect, useState } from "react";
import { listBranches } from "../git/log";
import { checkoutBranch, createBranch, currentBranch } from "../git/run";
import { emitRefreshSignal, onRefreshSignal } from "../git/runtime";
import type { BranchRef } from "../git/types";
import { BranchIcon, ChevronIcon } from "./icons";

/** Branch names git itself rejects; validated up front for a clearer message. */
export function invalidBranchName(name: string, existing: readonly string[]): "empty" | "chars" | "taken" | null {
	const trimmed = name.trim();
	if (trimmed.length === 0) return "empty";
	if (/[\s~^:?*[\\]/.test(trimmed) || trimmed.startsWith("-") || trimmed.endsWith(".") || trimmed.includes("..")) return "chars";
	if (existing.includes(trimmed)) return "taken";
	return null;
}

/**
 * Current branch plus the switcher, at the top of the change column.
 *
 * "Which branch am I on" is more basic than anything else in this panel and was
 * previously nowhere to be found in it.
 */
export function BranchBar({ root }: { root: string }): JSX.Element {
	const { t } = useTranslation();
	const [branch, setBranch] = useState<string | null>(null);
	const [locals, setLocals] = useState<BranchRef[]>([]);
	const [remotes, setRemotes] = useState<BranchRef[]>([]);
	const [creating, setCreating] = useState(false);
	const [newName, setNewName] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const reload = useCallback(() => {
		void currentBranch(root).then(setBranch).catch(() => setBranch(null));
		void listBranches(root, "local").then(setLocals).catch(() => setLocals([]));
		void listBranches(root, "remote").then(setRemotes).catch(() => setRemotes([]));
	}, [root]);

	useEffect(() => {
		reload();
		return onRefreshSignal(reload);
	}, [reload]);

	const run = useCallback((task: () => Promise<void>) => {
		setBusy(true);
		setError(null);
		task()
			.then(() => emitRefreshSignal())
			.catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
			.finally(() => setBusy(false));
	}, []);

	// 切换分支是可逆操作，不加确认弹窗，失败时直接把 git 的原话摆出来。
	const switchTo = (name: string): void => run(() => checkoutBranch(root, name));

	const nameError = invalidBranchName(newName, locals.map((item) => item.name));

	const submitCreate = (): void => {
		if (nameError) return;
		const name = newName.trim();
		setCreating(false);
		setNewName("");
		run(() => createBranch(root, name));
	};

	return (
		<div className="shrink-0 border-b border-border">
			<div className="flex h-8 items-center gap-1 px-2">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button type="button" variant="ghost" size="xs" className="min-w-0 max-w-full gap-1 px-1.5" disabled={busy} title={t("branch.switch")}>
							<BranchIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span className="truncate text-[12px] font-medium">{branch ?? t("branch.detached")}</span>
							<ChevronIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start" className="max-h-80 overflow-y-auto" data-vetta-plugin-root="git">
						<DropdownMenuItem onSelect={() => setCreating(true)}>{t("branch.create")}</DropdownMenuItem>
						{locals.length > 0 && (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuLabel>{t("branch.scopeLocal")}</DropdownMenuLabel>
								{locals.map((item) => (
									<DropdownMenuItem key={item.name} disabled={item.name === branch} onSelect={() => switchTo(item.name)}>
										{item.name}
									</DropdownMenuItem>
								))}
							</>
						)}
						{remotes.length > 0 && (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuLabel>{t("branch.scopeRemote")}</DropdownMenuLabel>
								{remotes.map((item) => (
									<DropdownMenuItem key={item.name} onSelect={() => switchTo(item.name)}>
										{item.name}
									</DropdownMenuItem>
								))}
							</>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
				{error && (
					<span className="min-w-0 flex-1 truncate text-right text-[11px] text-rose-500" title={`${error}\n${t("branch.switchFailedHint")}`}>
						{error.split("\n")[0]}
					</span>
				)}
			</div>

			<Dialog open={creating} onOpenChange={(open) => !open && setCreating(false)}>
				<DialogContent data-vetta-plugin-root="git" className="max-w-sm">
					<DialogHeader>
						<DialogTitle>{t("branch.createTitle")}</DialogTitle>
						<DialogDescription>{t("branch.createDescription")}</DialogDescription>
					</DialogHeader>
					<Input
						value={newName}
						autoFocus
						placeholder={t("branch.namePlaceholder")}
						onChange={(event) => setNewName(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") submitCreate();
						}}
					/>
					{newName.trim().length > 0 && nameError && <p className="text-[11px] text-rose-500">{t(`branch.error.${nameError}`)}</p>}
					<DialogFooter>
						<Button type="button" variant="ghost" size="sm" onClick={() => setCreating(false)}>
							{t("confirm.cancel")}
						</Button>
						<Button type="button" size="sm" disabled={nameError !== null} onClick={submitCreate}>
							{t("branch.createConfirm")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
