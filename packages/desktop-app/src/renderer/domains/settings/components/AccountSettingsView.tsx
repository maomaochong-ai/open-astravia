import { UserAvatar } from "@shared/components/UserAvatar";
import {
	SettingsEnterItem,
	SubscriptionCardsView,
	TokenActivityChartView,
} from "@vetta/theme-ui/settings";
import { Button, Dialog, DialogContent, DialogTitle } from "@vetta/ui";
import { useEffect, useState } from "react";
import { SubscriptionCards } from "./SubscriptionCards";
import { TokenActivityChart } from "./TokenActivityChart";
import type { AccountSettingsModel } from "./useAccountSettingsModel";

/** Theme presentation linked for migration inventory (Views implemented in theme-ui). */
export type AccountSettingsThemeViews = {
	readonly cards: typeof SubscriptionCardsView;
	readonly chart: typeof TokenActivityChartView;
};

export interface AccountSettingsViewProps {
	model: AccountSettingsModel;
}

export function AccountSettingsView({ model }: AccountSettingsViewProps): JSX.Element {
	const [dialogOpen, setDialogOpen] = useState(false);
	const [nickname, setNickname] = useState(model.user?.nickname ?? "");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setNickname(model.user?.nickname ?? "");
	}, [model.user?.nickname]);

	useEffect(() => {
		if (!dialogOpen) return;
		setNickname(model.user?.nickname ?? "");
		setError(null);
	}, [dialogOpen, model.user?.nickname]);

	const handleSaveNickname = async () => {
		setSaving(true);
		setError(null);
		try {
			const result = await model.actions.saveNickname(nickname);
			if (result.ok) {
				setDialogOpen(false);
				return;
			}
			if (result.error) setError(result.error);
		} finally {
			setSaving(false);
		}
	};

	if (!model.user) {
		return (
			<div className="mx-auto w-full max-w-[680px] px-8 pt-2 pb-10">
				<p className="text-[13px] text-muted-foreground">{model.labels.pleaseLogin}</p>
			</div>
		);
	}

	return (
		<div className="mx-auto w-full max-w-[680px] px-8 pt-2 pb-6">
			<SettingsEnterItem className="mb-8 flex items-center gap-5">
				<div className="relative shrink-0">
					<div className="rounded-2xl bg-gradient-to-br from-primary/40 to-primary/10 p-[2px]">
						<UserAvatar
							avatar={model.user.avatar}
							nickname={model.user.nickname ?? undefined}
							username={model.user.username}
							className="h-20 w-20 rounded-2xl"
							textClassName="text-3xl"
						/>
					</div>
				</div>

				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<h1 className="truncate text-[22px] font-bold leading-tight text-foreground">
							{model.displayName}
						</h1>
						{model.badge && (
							<span
								className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold text-primary-foreground"
								style={{ backgroundColor: model.badge.color }}
								title={model.badge.title}
							>
								{model.badge.text}
							</span>
						)}
						<button
							type="button"
							onClick={() => setDialogOpen(true)}
							title={model.labels.editNickname}
							className="flex shrink-0 items-center rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						>
							<span className="icon-[mdi--pencil-outline] h-3.5 w-3.5" />
						</button>
					</div>
					<div className="mt-0.5 truncate text-[13px] text-muted-foreground">@{model.user.username}</div>
					{model.user.email && (
						<div className="mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
							<span className="icon-[mdi--email-outline] h-3.5 w-3.5" />
							{model.user.email}
						</div>
					)}
				</div>
			</SettingsEnterItem>

			<SettingsEnterItem>
				<SubscriptionCards>
					<TokenActivityChart embedded />
				</SubscriptionCards>
			</SettingsEnterItem>

			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent
					showCloseButton={false}
					className="flex flex-col gap-0 overflow-hidden rounded-xl border border-border/60 bg-card/95 p-0 backdrop-blur-md sm:max-w-[420px]"
				>
					<div className="flex items-center gap-3 px-6 pt-5 pb-3">
						<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-inset ring-primary/20">
							<span className="icon-[mdi--account-edit-outline] h-4 w-4 text-primary" />
						</div>
						<DialogTitle className="text-[15px] font-semibold text-foreground">
							{model.labels.editNickname}
						</DialogTitle>
					</div>

					<div className="px-6 pb-5">
						<input
							type="text"
							value={nickname}
							autoFocus
							onChange={(event) => setNickname(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") void handleSaveNickname();
							}}
							placeholder={model.labels.enterNickname}
							maxLength={50}
							className="h-10 w-full rounded-lg border-none bg-muted px-3 text-[14px] text-foreground outline-none transition-colors"
						/>
						{error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
					</div>

					<div className="flex items-center justify-end gap-2 border-t border-border/40 bg-background/30 px-5 py-3">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => setDialogOpen(false)}
						>
							{model.labels.cancel}
						</Button>
						<Button
							type="button"
							variant="primary"
							size="sm"
							disabled={saving || !nickname.trim()}
							onClick={() => void handleSaveNickname()}
						>
							{saving ? model.labels.saving : model.labels.save}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
