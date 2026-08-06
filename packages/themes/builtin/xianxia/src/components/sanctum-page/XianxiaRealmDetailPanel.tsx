import { useThemeRouteModel } from "@vetta/theme-sdk";
import { HorizontalSliceImageDecoration, NineSliceImageFrame } from "@vetta/theme-ui";
import { cn } from "@vetta/ui";
import { motion } from "motion/react";
import { useEffect, useRef, type JSX } from "react";
import { sanctumPageAssets } from "./assets";
import type {
	RealmDetailAction,
	RealmDetailOutcome,
	RealmDetailView,
	RealmProgressItem,
} from "./types";

const realmDetailPanelDecoration = {
	borderWidth: "4.25rem",
	repeat: "stretch",
	slice: 180,
} as const;
const realmDetailActionDecoration = {
	height: "100%",
	leftSlice: 36,
	leftWidth: "0.9rem",
	repeat: "stretch",
	rightSlice: 36,
	rightWidth: "0.9rem",
} as const;
export function XianxiaRealmDetailPanel({
	detail,
	onClose,
}: {
	readonly detail: RealmDetailView;
	readonly onClose: () => void;
}): JSX.Element {
	const panelRef = useRef<HTMLElement>(null);

	useEffect(() => {
		const onPointerDown = (event: PointerEvent): void => {
			if (panelRef.current?.contains(event.target as Node)) return;
			onClose();
		};

		document.addEventListener("pointerdown", onPointerDown, true);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown, true);
		};
	}, [onClose]);

	return (
		<motion.aside
			animate={{ opacity: 1, x: 0 }}
			aria-label={`${detail.achievement.name}详情`}
			className="absolute right-0 top-[272px] z-30 min-h-[300px] w-[348px] text-slate-100 drop-shadow-[0_8px_24px_rgba(8,15,30,0.42)] min-[1280px]:right-[-10px] min-[1280px]:top-[282px] min-[1280px]:w-[382px]"
			exit={{ opacity: 0, x: 46 }}
			initial={{ opacity: 0, x: 80 }}
			ref={panelRef}
			role="dialog"
			transition={{ duration: 0.28, ease: "easeOut" }}
		>
			<NineSliceImageFrame
				className="min-h-[300px] w-full"
				contentClassName="relative z-10 flex min-h-[300px] flex-col px-7 pb-8 pt-3"
				decoration={realmDetailPanelDecoration}
				imageUrl={sanctumPageAssets.realmDetailPanel}
			>
				<div className="relative flex items-start justify-center border-b border-amber-100/16 pb-1">
					<div className="flex min-w-0 flex-col gap-1 px-10">
						<div className="truncate text-center text-[22px] font-semibold leading-7 text-amber-100 drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)] min-[1280px]:text-[24px]">
							{detail.achievement.name}详情
						</div>
						<div className="text-center text-[12px] leading-4 text-slate-300/80">
							{detail.achievement.englishName}
						</div>
					</div>
					<button
						aria-label="关闭境界详情"
						className="absolute right-0 top-[-0.25rem] flex h-8 w-8 items-center justify-center text-amber-100/90 outline-none transition hover:text-amber-50 border border-transparent focus-visible:border-amber-200/80"
						onClick={onClose}
						type="button"
					>
						<span aria-hidden="true" className="text-[30px] font-light leading-none">
							×
						</span>
					</button>
				</div>
				<div className="xianxia-hidden-scrollbar pt-3">
					{detail.achieved ? <AchievedRealmDetailContent detail={detail} /> : <LockedRealmDetailContent detail={detail} />}
				</div>
			</NineSliceImageFrame>
		</motion.aside>
	);
}

function AchievedRealmDetailContent({
	detail,
}: {
	readonly detail: RealmDetailView;
}): JSX.Element {
	return (
		<>
			<RealmDetailSection index={1} title="境界定义">
				<p className="text-[13px] leading-5 text-slate-200/82">{detail.definition}</p>
			</RealmDetailSection>
			<RealmDetailSection index={2} title="境界与能力进度">
				<RealmProgressList compact items={detail.requirements} />
			</RealmDetailSection>
			<RealmDetailSection index={3} title="数据来源">
				<RealmSourceChips sources={detail.sources} />
			</RealmDetailSection>
			<RealmDetailSection index={4} title="推荐入口">
				<RealmActionGrid actions={detail.actions} />
			</RealmDetailSection>
			<RealmDetailSection index={5} title="达成后收益">
				<RealmOutcomeGrid items={detail.rewards} />
			</RealmDetailSection>
		</>
	);
}

function LockedRealmDetailContent({
	detail,
}: {
	readonly detail: RealmDetailView;
}): JSX.Element {
	return (
		<>
			<RealmDetailSection index={1} title="境界定义">
				<p className="text-[13px] leading-5 text-slate-200/82">{detail.definition}</p>
			</RealmDetailSection>
			<RealmDetailSection index={2} title="前置关系">
				<p className="text-[13px] leading-5 text-slate-200/82">
					{detail.previousRealmName ?? "起始境界"} <span className="px-1 text-amber-100">→</span> {detail.achievement.name}
					{detail.nextRealmName ? <><span className="px-1 text-amber-100">→</span> {detail.nextRealmName}</> : null}
				</p>
			</RealmDetailSection>
			<RealmDetailSection index={3} title="境界与能力进度">
				<RealmProgressList items={detail.requirements} />
			</RealmDetailSection>
			<RealmDetailSection index={4} title="数据来源">
				<RealmSourceChips sources={detail.sources} />
			</RealmDetailSection>
			<RealmDetailSection index={5} title="建议修炼路径">
				<RealmActionGrid actions={detail.actions} />
			</RealmDetailSection>
			<RealmDetailSection index={6} title="达成后代表">
				<RealmOutcomeGrid items={detail.benefits} />
			</RealmDetailSection>
			<RealmDetailSection index={7} title="成长收获预览">
				<RealmOutcomeGrid items={detail.rewards} />
			</RealmDetailSection>
		</>
	);
}

function RealmDetailSection({
	children,
	index,
	title,
}: {
	readonly children: JSX.Element;
	readonly index: number;
	readonly title: string;
}): JSX.Element {
	return (
		<section className="mb-3 border-b border-white/10 pb-3 last:mb-0 last:border-b-0">
			<h3 className="mb-2 flex items-center gap-2 text-[15px] font-semibold leading-5 text-amber-100">
				<span className="flex h-5 w-5 flex-none items-center justify-center rounded-full border border-amber-100/45 text-[12px]">
					{index}
				</span>
				<span>{title}</span>
			</h3>
			{children}
		</section>
	);
}

function RealmProgressList({
	compact = false,
	items,
}: {
	readonly compact?: boolean;
	readonly items: readonly RealmProgressItem[];
}): JSX.Element {
	return (
		<div className={cn("space-y-2", compact && "space-y-1.5")}>
			{items.map((item) => (
				<div className="grid grid-cols-[5.5rem_minmax(0,1fr)_2.75rem] items-center gap-2" key={item.label}>
					<div className="flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-slate-200/82">
						<span className={cn(item.icon, "h-4 w-4 flex-none text-amber-100/90")} />
						<span className="truncate">{item.label}</span>
					</div>
					<div className="h-1.5 overflow-hidden rounded-full bg-slate-950/45">
						<div
							className="h-full rounded-full bg-gradient-to-r from-sky-200 to-amber-100"
							style={{ width: getProgressWidth(item.progress) }}
						/>
					</div>
					<div className="truncate text-right text-[10px] leading-4 text-slate-200/80">{item.valueText}</div>
				</div>
			))}
		</div>
	);
}

function RealmSourceChips({ sources }: { readonly sources: readonly string[] }): JSX.Element {
	return (
		<div className="flex flex-wrap gap-2">
			{sources.map((source) => (
				<span className="rounded border border-white/14 bg-white/6 px-3 py-1 text-[12px] leading-4 text-slate-200/82" key={source}>
					{source}
				</span>
			))}
		</div>
	);
}

function RealmActionGrid({ actions }: { readonly actions: readonly RealmDetailAction[] }): JSX.Element {
	const route = useThemeRouteModel();

	return (
		<div className="grid grid-cols-2 gap-2 min-[1280px]:grid-cols-4">
			{actions.map((action) => (
				<button
					className="relative flex h-9 min-w-0 items-center justify-center gap-1.5 px-2 text-[12px] font-semibold text-slate-700 outline-none transition hover:brightness-105 border border-transparent focus-visible:border-amber-200/80"
					key={action.label}
					onClick={() => route.navigate(action.target)}
					type="button"
				>
					<HorizontalSliceImageDecoration
						decoration={realmDetailActionDecoration}
						imageUrl={sanctumPageAssets.realmDetailActionButton}
					/>
					<span className={cn(action.icon, "relative z-10 h-4 w-4 flex-none")} />
					<span className="relative z-10 truncate">{action.label}</span>
				</button>
			))}
		</div>
	);
}

function RealmOutcomeGrid({
	items,
}: {
	readonly items: readonly RealmDetailOutcome[];
}): JSX.Element {
	return (
		<div className="grid grid-cols-3 gap-2">
			{items.map((item) => (
				<div className="rounded border border-amber-100/18 bg-slate-950/18 px-2 py-2 text-center text-[12px] leading-4 text-slate-200/82" key={item.label}>
					<span className={cn(item.icon, "mx-auto mb-1 block h-5 w-5 text-amber-100")} />
					{item.label}
				</div>
			))}
		</div>
	);
}

function getProgressWidth(progress: number): string {
	return `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`;
}
