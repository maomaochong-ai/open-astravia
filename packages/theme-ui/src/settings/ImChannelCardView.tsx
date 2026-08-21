import type { JSX, ReactNode } from "react";
import { Button, cn } from "@vetta/ui";
import { ImStatusBadgeView, type ImStatusBadgeStatus } from "./ImStatusBadgeView";

export interface ImChannelCardViewLabels {
	readonly channelActive: string;
	readonly channelConfigured: string;
	readonly channelNotAssociated: string;
	readonly activateChannelTitle: string;
	/** 齿轮按钮的可访问名，按渠道不同（设置机器人 / 扫码绑定 / 配置渠道）。 */
	readonly configureLabel: string;
	readonly statusLabel: string;
}

export interface ImChannelCardViewProps {
	readonly name: string;
	readonly subtitle: string;
	readonly iconClass: string;
	readonly configured: boolean;
	readonly isActive: boolean;
	readonly effectiveStatus: ImStatusBadgeStatus;
	readonly onConfigure: () => void;
	/** 仅在该渠道可被切换为活动渠道时传入；活动渠道自身不传。 */
	readonly onActivate?: () => void;
	readonly labels: ImChannelCardViewLabels;
	/** Optional override for status badge (e.g. host-wired i18n). Defaults to ImStatusBadgeView. */
	readonly statusBadge?: ReactNode;
}

/**
 * 渠道卡：整卡是主操作（可激活时切换为活动渠道，否则打开配置），右下角齿轮始终进配置。
 * 同时只有一个活动渠道，因此活动态用 ring + primary 底色单独标出，未配置渠道走虚线弱化态。
 */
export function ImChannelCardView({
	name,
	subtitle,
	iconClass,
	configured,
	isActive,
	effectiveStatus,
	onConfigure,
	onActivate,
	labels,
	statusBadge,
}: ImChannelCardViewProps): JSX.Element {
	const canActivate = configured && onActivate !== undefined;
	const primaryAction = canActivate ? onActivate : onConfigure;
	const primaryLabel = canActivate ? labels.activateChannelTitle : labels.configureLabel;

	return (
		<div
			className={cn(
				"group relative flex flex-col gap-3 rounded-xl border p-3.5 transition-colors duration-200",
				isActive
					? "border-primary/40 bg-primary/10 ring-1 ring-inset ring-primary/30"
					: configured
						? "border-border/50 bg-card/40 hover:border-primary/40 hover:bg-card/60"
						: "border-dashed border-border/50 bg-card/20 hover:border-primary/40 hover:bg-card/40",
			)}
		>
			{/* 铺满整卡的主操作按钮；卡内其余内容通过 relative 叠在其上。 */}
			<button
				type="button"
				aria-label={`${name} · ${primaryLabel}`}
				title={primaryLabel}
				onClick={primaryAction}
				className="absolute inset-0 rounded-xl outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
			/>

			<div className="pointer-events-none relative flex items-start gap-2.5">
				<span
					className={cn(
						"flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
						isActive ? "bg-primary/15" : "bg-background/60",
					)}
				>
					<span className={cn(iconClass, "h-4 w-4", isActive ? "text-primary" : "text-muted-foreground")} />
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
						<span className="truncate text-[13px] font-semibold text-foreground">{name}</span>
						{isActive && (
							<span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
								{labels.channelActive}
							</span>
						)}
					</div>
					<div className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground" title={subtitle}>
						{subtitle}
					</div>
				</div>
			</div>

			<div className="relative flex items-center justify-between gap-2">
				<span className="pointer-events-none min-w-0">
					{isActive ? (
						(statusBadge ?? <ImStatusBadgeView label={labels.statusLabel} status={effectiveStatus} />)
					) : (
						<span
							className={cn(
								"inline-flex items-center rounded-full px-2 py-0.5 text-[11px]",
								configured ? "bg-accent/60 text-muted-foreground" : "bg-muted text-muted-foreground/60",
							)}
						>
							{configured ? labels.channelConfigured : labels.channelNotAssociated}
						</span>
					)}
				</span>
				<Button
					variant="ghost"
					size="icon-xs"
					aria-label={`${name} · ${labels.configureLabel}`}
					title={labels.configureLabel}
					onClick={onConfigure}
				>
					<span className="icon-[solar--settings-linear] h-3 w-3" />
				</Button>
			</div>
		</div>
	);
}
