import { useState, type JSX } from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@vetta-org/ui";
import { InputField } from "./SettingsFormFields";
import { McpDefaultIcon } from "./McpDefaultIcon";

export interface BuiltinMcpSecretFieldView {
	readonly envKey: string;
	readonly label: string;
	readonly required: boolean;
	readonly optionalSuffix?: string;
	readonly helpUrl?: string;
	readonly secret?: boolean;
	readonly placeholder?: string;
}

export interface BuiltinMcpSecretsDialogViewLabels {
	readonly continueCta: string;
	readonly getKey: string;
	readonly openAuthPage: string;
	readonly openKeyPage: string;
	readonly privacyTooltip: string;
	readonly privacyTooltipAria: string;
	readonly saving: string;
	/** 浏览器 OAuth 进行中时的主按钮文案 */
	readonly authorizing?: string;
	readonly setupBody: string;
	readonly setupTitle: string;
	readonly stepPasteKey: string;
	readonly title: string;
}

export interface BuiltinMcpSecretsDialogViewProps {
	readonly appIconUrl: string;
	readonly canSubmit: boolean;
	readonly connectorIconUrl: string;
	readonly connectorName: string;
	readonly fields: readonly BuiltinMcpSecretFieldView[];
	readonly guideLines: readonly string[];
	readonly hasFields: boolean;
	readonly labels: BuiltinMcpSecretsDialogViewLabels;
	readonly onChangeValue: (envKey: string, value: string) => void;
	readonly onConfirm: (values: Record<string, string>) => void;
	readonly onOpenChange: (open: boolean) => void;
	readonly onOpenHelp: (url: string) => void;
	readonly open: boolean;
	readonly primaryHelpUrl?: string | null;
	readonly saving: boolean;
	/** 浏览器授权进行中（按钮 loading 文案用 authorizing） */
	readonly authorizing?: boolean;
	/** 授权/连接失败时展示在主按钮上方 */
	readonly error?: string | null;
	readonly values: Record<string, string>;
}

function ConnectorIcon({
	src,
	alt,
}: {
	src: string;
	alt: string;
}): JSX.Element {
	const [failed, setFailed] = useState(false);
	if (failed) {
		return <McpDefaultIcon className="h-12 w-12 rounded-xl" />;
	}
	return (
		<img
			src={src}
			alt={alt}
			className="h-12 w-12 shrink-0 rounded-xl border border-border/50 bg-muted object-contain p-1.5"
			onError={() => setFailed(true)}
		/>
	);
}

/** 纵向步骤条：序号圆点 + 连接线 */
function StepList({ steps }: { steps: readonly string[] }): JSX.Element {
	return (
		<ol className="mt-2.5 space-y-0">
			{steps.map((line, index) => {
				const isLast = index === steps.length - 1;
				return (
					<li key={line} className="relative flex gap-2.5">
						<div className="flex w-5 shrink-0 flex-col items-center">
							<span className="relative z-10 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-muted text-[10px] font-semibold tabular-nums text-foreground">
								{index + 1}
							</span>
							{!isLast && <span className="my-0.5 w-px flex-1 bg-border" aria-hidden />}
						</div>
						<p
							className={`min-w-0 flex-1 text-[11px] leading-relaxed text-muted-foreground ${isLast ? "pb-0" : "pb-3"}`}
						>
							{line}
						</p>
					</li>
				);
			})}
		</ol>
	);
}

function PrivacyHelpTooltip({
	ariaLabel,
	content,
}: {
	ariaLabel: string;
	content: string;
}): JSX.Element {
	return (
		<TooltipPrimitive.Provider delayDuration={200}>
			<TooltipPrimitive.Root>
				<TooltipPrimitive.Trigger asChild>
					<button
						type="button"
						className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						aria-label={ariaLabel}
					>
						<span className="icon-[mdi--help-circle-outline] h-4 w-4" aria-hidden />
					</button>
				</TooltipPrimitive.Trigger>
				<TooltipPrimitive.Portal>
					<TooltipPrimitive.Content
						side="bottom"
						sideOffset={6}
						className="z-50 max-w-[min(18rem,calc(100vw-2rem))] rounded-lg border border-border bg-popover px-3 py-2.5 text-[11px] leading-relaxed whitespace-pre-line text-popover-foreground shadow-md outline-none"
					>
						{content}
					</TooltipPrimitive.Content>
				</TooltipPrimitive.Portal>
			</TooltipPrimitive.Root>
		</TooltipPrimitive.Provider>
	);
}

export function BuiltinMcpSecretsDialogView({
	appIconUrl,
	canSubmit,
	connectorIconUrl,
	connectorName,
	fields,
	guideLines,
	hasFields,
	labels,
	onChangeValue,
	onConfirm,
	onOpenChange,
	onOpenHelp,
	open,
	primaryHelpUrl,
	saving,
	authorizing = false,
	error,
	values,
}: BuiltinMcpSecretsDialogViewProps): JSX.Element {
	const busy = saving || authorizing;
	const ctaLabel = authorizing
		? (labels.authorizing ?? labels.saving)
		: saving
			? labels.saving
			: labels.continueCta;
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[min(90vh,640px)] max-w-[min(26rem,calc(100%-2rem))] gap-0 overflow-y-auto p-0">
				{/* 顶区：双图标 + 标题 + 隐私说明 tooltip */}
				<div className="relative px-5 pb-4 pt-6">
					<div className="flex items-center justify-center gap-3">
						<img
							src={appIconUrl}
							alt=""
							className="h-12 w-12 shrink-0 rounded-xl border border-border/50 bg-muted object-contain p-1.5"
						/>
						<div className="flex items-center gap-1 text-muted-foreground/40" aria-hidden>
							<span className="h-1 w-1 rounded-full bg-current" />
							<span className="h-1 w-1 rounded-full bg-current" />
							<span className="h-1 w-1 rounded-full bg-current" />
						</div>
						<ConnectorIcon src={connectorIconUrl} alt={connectorName} />
					</div>

					<div className="mt-4 flex items-center justify-center gap-1.5">
						<DialogTitle className="text-[15px] font-semibold tracking-tight text-foreground">
							{labels.title}
						</DialogTitle>
						<PrivacyHelpTooltip
							ariaLabel={labels.privacyTooltipAria}
							content={labels.privacyTooltip}
						/>
					</div>
					<DialogDescription className="sr-only">{labels.setupBody}</DialogDescription>
				</div>

				{/* 连接方式 + 步骤条 */}
				<div className="px-5">
					<div className="overflow-hidden rounded-xl border border-border/50 bg-muted/30 px-3.5 py-3">
						<div className="text-[12px] font-medium text-foreground">{labels.setupTitle}</div>
						<p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{labels.setupBody}</p>
						{guideLines.length > 0 && <StepList steps={guideLines} />}
						{primaryHelpUrl && (
							<Button
								variant="link"
								size="sm"
								className="mt-2 h-auto gap-1 p-0 text-[11px] font-medium"
								onClick={() => onOpenHelp(primaryHelpUrl)}
							>
								<span className="icon-[mdi--open-in-new] h-3 w-3" />
								{hasFields ? labels.openKeyPage : labels.openAuthPage}
							</Button>
						)}
					</div>
				</div>

				{/* 密钥输入（仅需要粘贴凭证时） */}
				{hasFields && (
					<div className="mt-4 space-y-3 px-5">
						<div className="text-[12px] font-medium text-foreground">{labels.stepPasteKey}</div>
						{fields.map((field) => (
							<div key={field.envKey}>
								<div className="mb-1 flex items-center justify-between gap-2">
									<label className="text-[11px] text-muted-foreground">
										{field.label}
										{field.required ? " *" : field.optionalSuffix}
									</label>
									{field.helpUrl && field.helpUrl !== primaryHelpUrl && (
										<Button
											variant="link"
											size="sm"
											className="h-auto shrink-0 gap-0.5 p-0 text-[11px]"
											onClick={() => onOpenHelp(field.helpUrl!)}
										>
											<span className="icon-[mdi--open-in-new] h-3 w-3" />
											{labels.getKey}
										</Button>
									)}
								</div>
								<InputField
									type={field.secret ? "password" : "text"}
									value={values[field.envKey] ?? ""}
									onChange={(value) => onChangeValue(field.envKey, value)}
									placeholder={field.placeholder}
								/>
							</div>
						))}
					</div>
				)}

				{/* 底部全宽主按钮 */}
				<div className="mt-5 px-5 pb-5">
					{error ? (
						<p className="mb-2.5 text-center text-[11px] leading-relaxed text-destructive">{error}</p>
					) : null}
					<Button
						variant="primary"
						size="lg"
						className="w-full"
						disabled={!canSubmit || busy}
						onClick={() => onConfirm(values)}
					>
						{authorizing ? (
							<span className="inline-flex items-center gap-2">
								<span className="icon-[mdi--loading] h-4 w-4 animate-spin" aria-hidden />
								{ctaLabel}
							</span>
						) : (
							ctaLabel
						)}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
