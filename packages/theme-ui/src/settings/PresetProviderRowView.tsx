import { useState, type JSX, type ReactNode } from "react";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Switch,
	cn,
} from "@astravia-org/ui";
import { InputField } from "./SettingsFormFields";

export interface PresetProviderRowModelView {
	readonly displayName: string;
	readonly icon?: string;
	readonly isExpanded: boolean;
	readonly isOpen: boolean;
	readonly adopted: boolean;
	/** 已采纳且未被暂停：徽标与行尾开关都看它。 */
	readonly enabled: boolean;
	readonly offline: boolean;
	readonly models: readonly unknown[];
	readonly refreshing: boolean;
	readonly hasApiKey: boolean;
	readonly modelsError: string | null;
	/** 服务商地址；本机代理从这里取当前端口。 */
	readonly baseUrl?: string;
	/**
	 * 内置密钥（本机代理）：地址与密钥都由产品给定，用户只能改端口。
	 * 与参照实现同名同义——密钥按钮看 `!autoKey`，端口按钮看 `autoKey`。
	 */
	readonly autoKey?: boolean;
}

export interface PresetProviderRowViewLabels {
	readonly collapseModels: string;
	readonly viewModels: string;
	readonly enabled: string;
	readonly deprecated: string;
	readonly modelsCount: (count: number) => string;
	readonly cancel: string;
	readonly changeKey: string;
	readonly remove: string;
	readonly enable: string;
	readonly apiKeyDirect: (name: string) => string;
	readonly apiKeyLabel: string;
	readonly port: string;
	readonly portLabel: string;
	readonly apiKeyPlaceholder: string;
	readonly encryptedApiKeyPlaceholder: string;
	readonly save: string;
	readonly refreshModels: string;
	readonly refreshingModels: string;
	readonly copyApiKey: string;
	readonly toggleProvider: (name: string) => string;
}

export interface PresetProviderRowViewProps {
	readonly row: PresetProviderRowModelView;
	readonly draftKey: string;
	readonly saving: boolean;
	readonly labels: PresetProviderRowViewLabels;
	readonly onToggleExpanded: () => void;
	readonly onToggleEditor: () => void;
	readonly onDraftKeyChange: (key: string) => void;
	readonly onAdopt: () => void;
	readonly onRemove: () => void;
	readonly onToggleEnabled: (enabled: boolean) => void;
	readonly onSetPort: (port: string) => void;
	readonly onRefreshModels: () => void;
	readonly onCopyApiKey: () => void;
	readonly icon: ReactNode;
	readonly modelsList?: ReactNode;
}

/** 从服务商地址里取出端口；解析不出来时留空，让用户自己填。 */
function portOf(baseUrl: string | undefined): string {
	if (!baseUrl) return "";
	try {
		return new URL(baseUrl).port || "";
	} catch {
		return "";
	}
}

/** 端口输入框左侧的固定前缀，如 `http://127.0.0.1:`。 */
function hostPrefix(baseUrl: string | undefined): string {
	if (!baseUrl) return "";
	try {
		const url = new URL(baseUrl);
		return `${url.protocol}//${url.hostname}:`;
	} catch {
		return "";
	}
}

/**
 * 预置服务商一行：左侧是可展开的模型列表入口，右侧是行内动作，行尾固定一颗启用开关。
 *
 * 编辑一律走弹窗——行内输入框在窄屏上会把左侧服务商名挤没，而弹窗可以放下标题、
 * 说明、错误与「保存 / 取消」，与设置页其它对话框同一套外壳。
 */
export function PresetProviderRowView({
	row,
	draftKey,
	saving,
	labels,
	onToggleExpanded,
	onToggleEditor,
	onDraftKeyChange,
	onAdopt,
	onRemove,
	onToggleEnabled,
	onSetPort,
	onRefreshModels,
	onCopyApiKey,
	icon,
	modelsList,
}: PresetProviderRowViewProps): JSX.Element {
	// 两件事同时决定「能不能改密钥」：已下线的旧条目不在内置目录里给不了 key；
	// 内置密钥的预设（本机代理）根本不需要 key，给一颗修改按钮只会让人以为必须填。
	const canEditKey = !row.offline && !row.autoKey;
	const keyDialogOpen = canEditKey && row.isOpen;
	// 本机代理不填 key，只改端口；端口草稿从当前地址里取，避免用户重新输一遍。
	const [portDraft, setPortDraft] = useState<string | null>(null);
	// 内置密钥的服务不填 key，但地址（端口）要能改——与参照实现同一个判据。
	const canEditUrl = Boolean(row.autoKey) && !row.offline;
	const portDialogOpen = canEditUrl && portDraft !== null;
	const portValid = portDraft !== null && /^\d{1,5}$/.test(portDraft) && Number(portDraft) >= 1 && Number(portDraft) <= 65535;

	const submitPort = (): void => {
		if (!portValid || saving) return;
		onSetPort(portDraft ?? "");
		setPortDraft(null);
	};

	return (
		<div className="border-b border-border last:border-b-0">
			<div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-3">
				<button
					type="button"
					onClick={onToggleExpanded}
					className="flex min-w-0 items-center gap-3 text-left"
					title={row.isExpanded ? labels.collapseModels : labels.viewModels}
				>
					<span
						className={cn(
							"icon-[mdi--chevron-right] h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150",
							row.isExpanded && "rotate-90",
						)}
					/>
					{icon}
					<div className="min-w-0 flex-1">
						<div className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-foreground">
							<span className="truncate">{row.displayName}</span>
							{row.enabled && (
								<span className="shrink-0 whitespace-nowrap rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium text-primary">
									{labels.enabled}
								</span>
							)}
							{row.offline && (
								<span className="shrink-0 whitespace-nowrap rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-400">
									{labels.deprecated}
								</span>
							)}
						</div>
						<div className="mt-0.5 truncate text-[11px] text-muted-foreground">
							{labels.modelsCount(row.models.length)}
							{canEditUrl && row.baseUrl ? ` · ${row.baseUrl}` : ""}
						</div>
					</div>
				</button>

				<div className="flex h-8 items-center justify-end gap-1.5">
					{row.adopted && !row.offline && (
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={onRefreshModels}
							disabled={row.refreshing}
							title={row.refreshing ? labels.refreshingModels : labels.refreshModels}
							className="text-muted-foreground hover:text-foreground"
						>
							<span className={cn("icon-[mdi--refresh] h-3.5 w-3.5", row.refreshing && "animate-spin")} />
						</Button>
					)}
					{canEditKey && (
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={onToggleEditor}
							title={row.adopted ? labels.changeKey : labels.enable}
							aria-label={row.adopted ? labels.changeKey : labels.enable}
							className={cn("text-muted-foreground hover:text-foreground", !row.adopted && "hover:text-primary")}
						>
							<span className={cn("h-3.5 w-3.5", row.adopted ? "icon-[mdi--key-outline]" : "icon-[mdi--key-plus]")} />
						</Button>
					)}
					{canEditUrl && (
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => setPortDraft(portOf(row.baseUrl))}
							title={labels.portLabel}
							aria-label={labels.portLabel}
							className="text-muted-foreground hover:text-foreground"
						>
							<span className="icon-[mdi--link-variant] h-3.5 w-3.5" />
						</Button>
					)}
					{/* 内置服务不可删除：删掉之后也装不回来（它不在用户可添加的目录里）。 */}
					{row.adopted && !row.autoKey && (
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={onRemove}
							title={labels.remove}
							aria-label={labels.remove}
							className="text-muted-foreground hover:text-destructive"
						>
							<span className="icon-[mdi--delete-outline] h-3.5 w-3.5" />
						</Button>
					)}
					{/* 开关与上游一致：只要服务商没下线就常驻，未采纳时是「关」，拨开等于启用。 */}
					{!row.offline && (
						<Switch
							size="sm"
							checked={row.enabled}
							disabled={saving}
							onCheckedChange={onToggleEnabled}
							aria-label={labels.toggleProvider(row.displayName)}
						/>
					)}
					{row.offline && !row.adopted && (
						<span className="text-[11px] text-muted-foreground">{labels.deprecated}</span>
					)}
				</div>
			</div>

			{/* 错误行独立展示,弹窗关着时也能看到校验失败原因。 */}
			{row.modelsError && <div className="truncate px-5 pb-2.5 text-[11px] text-amber-400">{row.modelsError}</div>}

			{row.isExpanded && modelsList}

			<Dialog open={keyDialogOpen} onOpenChange={(next) => !next && !saving && onToggleEditor()}>
				<DialogContent className="sm:max-w-[420px]">
					<DialogHeader>
						<DialogTitle>{row.displayName}</DialogTitle>
						<DialogDescription>{labels.apiKeyDirect(row.displayName)}</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-2">
						<span className="text-[14px] font-medium text-foreground">{labels.apiKeyLabel}</span>
						<div className="flex items-center gap-1.5">
							<div className="min-w-0 flex-1">
								<InputField
									value={draftKey}
									onChange={onDraftKeyChange}
									placeholder={row.hasApiKey ? labels.encryptedApiKeyPlaceholder : labels.apiKeyPlaceholder}
									type="password"
									disabled={saving}
									autoFocus
									aria-label={labels.apiKeyDirect(row.displayName)}
									className="h-10 rounded-xl px-3.5 text-[15px] md:text-[15px]"
									onKeyDown={(event) => {
										if (event.key !== "Enter") return;
										event.preventDefault();
										if (saving) return;
										if (draftKey.trim()) onAdopt();
									}}
								/>
							</div>
							{row.hasApiKey && (
								<Button
									variant="ghost"
									size="icon-sm"
									onClick={onCopyApiKey}
									title={labels.copyApiKey}
									aria-label={labels.copyApiKey}
									className="shrink-0 text-muted-foreground hover:text-foreground"
								>
									<span className="icon-[mdi--content-copy] h-3.5 w-3.5" />
								</Button>
							)}
						</div>
					</div>
					<DialogFooter>
						<Button variant="ghost" size="sm" onClick={onToggleEditor} disabled={saving}>
							{labels.cancel}
						</Button>
						{/* 内置密钥默认值的预设：空草稿就是「用默认」，不必逼用户造一个 key。 */}
						<Button
							variant="primary"
							size="sm"
							onClick={onAdopt}
							disabled={saving || !draftKey.trim()}
						>
							{row.adopted ? labels.save : labels.enable}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={portDialogOpen} onOpenChange={(next) => !next && !saving && setPortDraft(null)}>
				<DialogContent className="sm:max-w-[420px]">
					<DialogHeader>
						<DialogTitle>{row.displayName}</DialogTitle>
						<DialogDescription>{labels.portLabel}</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-2">
						<span className="text-[14px] font-medium text-foreground">{labels.port}</span>
						<div className="flex items-center gap-2">
							<span className="shrink-0 text-[14px] text-muted-foreground">{hostPrefix(row.baseUrl)}</span>
							<InputField
								value={portDraft ?? ""}
								onChange={(value) => setPortDraft(value.replace(/\D/g, "").slice(0, 5))}
								placeholder={labels.port}
								disabled={saving}
								autoFocus
								aria-label={labels.portLabel}
								className="h-10 w-28 rounded-xl px-3.5 text-[15px] md:text-[15px]"
								onKeyDown={(event) => {
									if (event.key !== "Enter") return;
									event.preventDefault();
									submitPort();
								}}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button variant="ghost" size="sm" onClick={() => setPortDraft(null)} disabled={saving}>
							{labels.cancel}
						</Button>
						<Button variant="primary" size="sm" onClick={submitPort} disabled={!portValid || saving}>
							{labels.save}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
