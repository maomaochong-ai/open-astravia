import type { JSX } from "react";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	cn,
} from "@vetta/ui";

export interface ImFeishuDialogViewLabels {
	readonly title: string;
	readonly description: string;
	readonly hide: string;
	readonly show: string;
	readonly testing: string;
	readonly testConnection: string;
	readonly saving: string;
	readonly save: string;
}

export interface ImFeishuDialogViewProps {
	readonly open: boolean;
	readonly onOpenChange: (open: boolean) => void;
	readonly appId: string;
	readonly appSecret: string;
	readonly showSecret: boolean;
	readonly onToggleSecret: () => void;
	readonly onAppIdChange: (value: string) => void;
	readonly onAppSecretChange: (value: string) => void;
	readonly appIdError: boolean;
	readonly appSecretError: boolean;
	readonly statusMessage: string | null;
	readonly statusTone: "error" | "ok" | "muted" | null;
	readonly testing: boolean;
	readonly saving: boolean;
	readonly canTest: boolean;
	readonly canSave: boolean;
	readonly onTest: () => void;
	readonly onSave: () => void;
	/**
	 * Optional control rendered at the start of the footer — the channel's
	 * "how this works" entry. Bottom left, so it cannot collide with the
	 * dialog's own close button in the top right corner.
	 */
	readonly footerExtra?: JSX.Element | null;
	readonly labels: ImFeishuDialogViewLabels;
}

export function ImFeishuDialogView({
	open,
	onOpenChange,
	appId,
	appSecret,
	showSecret,
	onToggleSecret,
	onAppIdChange,
	onAppSecretChange,
	appIdError,
	appSecretError,
	statusMessage,
	statusTone,
	testing,
	saving,
	canTest,
	canSave,
	onTest,
	onSave,
	footerExtra,
	labels,
}: ImFeishuDialogViewProps): JSX.Element {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[460px]">
				<DialogHeader>
					<DialogTitle>{labels.title}</DialogTitle>
					<DialogDescription>{labels.description}</DialogDescription>
				</DialogHeader>

				<div className="space-y-3 py-2">
					<div>
						<label className="mb-1 block text-[12px] font-medium text-foreground">App ID</label>
						<input
							type="text"
							value={appId}
							onChange={(event) => onAppIdChange(event.target.value)}
							className={cn(
								"w-full rounded-md border bg-secondary px-2.5 py-1.5 text-[12px] text-foreground",
								appIdError ? "border-destructive" : "border-input",
							)}
							placeholder="cli_xxxxxxxxxxxxxxxx"
						/>
					</div>
					<div>
						<label className="mb-1 block text-[12px] font-medium text-foreground">App Secret</label>
						<div className="flex items-center gap-1.5">
							<input
								type={showSecret ? "text" : "password"}
								value={appSecret}
								onChange={(event) => onAppSecretChange(event.target.value)}
								className={cn(
									"flex-1 rounded-md border bg-secondary px-2.5 py-1.5 text-[12px] text-foreground",
									appSecretError ? "border-destructive" : "border-input",
								)}
								placeholder="App Secret"
							/>
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={onToggleSecret}
								aria-label={showSecret ? labels.hide : labels.show}
							>
								<span
									className={cn(
										showSecret ? "icon-[mdi--eye-off-outline]" : "icon-[mdi--eye-outline]",
										"h-3.5 w-3.5",
									)}
								/>
							</Button>
						</div>
					</div>

					<div className="min-h-[18px] text-[12px]">
						{statusMessage && (
							<span
								className={cn(
									statusTone === "error" && "text-destructive",
									statusTone === "ok" && "text-emerald-400",
									statusTone === "muted" && "text-muted-foreground",
								)}
							>
								{statusMessage}
							</span>
						)}
					</div>
				</div>

				<DialogFooter className={footerExtra ? "gap-2 sm:justify-between" : "gap-2"}>
					{footerExtra && <div className="flex items-center gap-1">{footerExtra}</div>}
					{/* 动作按钮成组，justify-between 才是「说明 | 动作」两端分布，
					    而不是把每个按钮都摊开。 */}
					<div className="flex items-center gap-2">
						<Button variant="outline" onClick={onTest} disabled={testing || !canTest}>
							{testing ? labels.testing : labels.testConnection}
						</Button>
						<Button variant="primary" onClick={onSave} disabled={!canSave || saving}>
							{saving ? labels.saving : labels.save}
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
