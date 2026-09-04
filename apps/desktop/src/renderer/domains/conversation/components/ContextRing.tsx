import { ContextRingView } from "@vetta/theme-ui/chat";
import { AgentAvatarView } from "@vetta/theme-ui/chat";
import { Button } from "@shared/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@shared/components/ui/popover";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ComponentProps,
	type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import type { ContextRingModel, ContextRingScopeModel } from "../hooks/useContextRingModel";
import {
	buildContextRingBarSegments,
	type ContextRingDetailGroup,
	type ContextRingDetailGroupKind,
	type ContextRingDetailsModel,
} from "../services/context-ring-details";

/** 分段配色由主题的等亮度色板提供，见 styles.css 的 --context-segment-*。 */
const GROUP_COLORS: Record<ContextRingDetailGroupKind, string> = {
	instructions: "var(--context-segment-1)",
	capabilities: "var(--context-segment-2)",
	tools: "var(--context-segment-3)",
	conversation: "var(--context-segment-4)",
	runtime: "var(--context-segment-5)",
};

interface ContextRingState {
	readonly model: ContextRingModel;
	readonly scopes: readonly ContextRingScopeModel[];
	readonly registerScope: (scope: ContextRingScopeModel) => void;
	readonly unregisterScope: (id: string) => void;
	readonly activeScope: ContextRingScopeModel | null;
	readonly setActiveScope: (id: string) => void;
	readonly open: boolean;
	readonly setOpen: (open: boolean) => void;
	readonly activeGroup: ContextRingDetailGroupKind | null;
	readonly setActiveGroup: (group: ContextRingDetailGroupKind | null) => void;
}

const ContextRingContext = createContext<ContextRingState | null>(null);

export interface ContextRingRootProps {
	readonly model: ContextRingModel | null;
	readonly children: ReactNode;
}

export function ContextRingRoot({ model, children }: ContextRingRootProps): JSX.Element | null {
	const [open, setOpen] = useState(false);
	const [activeGroup, setActiveGroup] = useState<ContextRingDetailGroupKind | null>(null);
	const [activeScopeId, setActiveScopeId] = useState<string>();
	const [scopeMap, setScopeMap] = useState<Readonly<Record<string, ContextRingScopeModel>>>({});
	const registerScope = useCallback((scope: ContextRingScopeModel) => {
		setScopeMap((current) => (current[scope.id] === scope ? current : { ...current, [scope.id]: scope }));
	}, []);
	const unregisterScope = useCallback((id: string) => {
		setScopeMap((current) => {
			if (!current[id]) return current;
			const next = { ...current };
			delete next[id];
			return next;
		});
	}, []);
	const scopes = useMemo(() => Object.values(scopeMap), [scopeMap]);
	const activeScope = scopes.find((scope) => scope.id === activeScopeId) ?? scopes[0] ?? null;
	const activeModel = activeScope?.model ?? model;
	useEffect(() => {
		if (!model && open) setOpen(false);
	}, [model, open]);
	useEffect(() => {
		if (!open) setActiveGroup(null);
	}, [open]);
	if (!activeModel) return null;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<ContextRingContext.Provider
				value={{
					model: activeModel,
					scopes,
					registerScope,
					unregisterScope,
					activeScope,
					setActiveScope: setActiveScopeId,
					open,
					setOpen,
					activeGroup,
					setActiveGroup,
				}}
			>
				{children}
			</ContextRingContext.Provider>
		</Popover>
	);
}

export function ContextRingTrigger({ className }: { readonly className?: string }): JSX.Element {
	const context = useContextRingContext("Trigger");
	return (
		<PopoverTrigger asChild>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				className={`h-7 w-7 shrink-0 rounded-full p-0${className ? ` ${className}` : ""}`}
				aria-label={context.model.tooltip}
			>
				<ContextRingView
					percent={context.model.percent}
					offset={context.model.offset}
					color={context.model.color}
					isCompacting={context.model.isCompacting}
					tooltip={context.model.tooltip}
				/>
			</Button>
		</PopoverTrigger>
	);
}

export interface ContextRingContentProps extends Omit<ComponentProps<typeof PopoverContent>, "children" | "className"> {
	readonly children?: ReactNode;
	readonly className?: string;
}

/** Generic popover surface. Layout and content are fully composed by callers. */
export function ContextRingContent({ children, className, ...props }: ContextRingContentProps = {}): JSX.Element {
	return (
		<PopoverContent side="top" align="end" {...props} className={`w-64 p-0${className ? ` ${className}` : ""}`}>
			{children}
		</PopoverContent>
	);
}

/** Default context composition body shared by ordinary and Team conversations. */
export function ContextRingDetails(): JSX.Element {
	const context = useContextRingContext("Details");
	const { t } = useTranslation("chat");
	const selected = context.model.details?.groups.find((group) => group.id === context.activeGroup) ?? null;
	return (
		<>
			{context.model.details ? (
				selected ? (
					<GroupDetailPane group={selected} onBack={() => context.setActiveGroup(null)} />
				) : (
					<OverviewPane details={context.model.details} onSelect={context.setActiveGroup} />
				)
			) : (
				<div className="px-3 py-2.5">
					<PopoverTitle className="text-[12px]">{t("contextRing.details.title")}</PopoverTitle>
					<div className="mt-1.5 text-[11px] text-foreground">{context.model.tooltip}</div>
					<p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{t("contextRing.details.unavailableAfterRestart")}</p>
				</div>
			)}
		</>
	);
}

export interface ContextRingScopeListProps {
	readonly children: ReactNode;
	readonly className?: string;
}

export function ContextRingScopeList({ children, className }: ContextRingScopeListProps): JSX.Element {
	return (
		<div className={`flex gap-1 overflow-x-auto border-b border-border/60 px-2 py-1.5${className ? ` ${className}` : ""}`}>
			{children}
		</div>
	);
}

export type ContextRingScopeProps = ContextRingScopeModel;

export function ContextRingScope({ id, label, avatar, blueprintId, model }: ContextRingScopeProps): JSX.Element {
	const context = useContextRingContext("Scope");
	const { registerScope, unregisterScope } = context;
	const scope = useMemo(
		() => ({ id, label, avatar, blueprintId, model }),
		[id, label, avatar, blueprintId, model],
	);
	useEffect(() => {
		registerScope(scope);
		return () => unregisterScope(id);
	}, [id, registerScope, scope, unregisterScope]);
	const selected = context.activeScope?.id === id;
	return (
		<button
			type="button"
			onClick={() => {
				context.setActiveScope(id);
				context.setActiveGroup(null);
			}}
			className={`flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[10px] ${selected ? "bg-muted text-foreground hover:bg-muted" : "text-muted-foreground hover:bg-muted/60"}`}
		>
			<AgentAvatarView name={label} avatar={avatar} blueprintId={blueprintId} size="xs" />
			<span className="max-w-20 truncate">{label}</span>
		</button>
	);
}

function ContextRingDefault({ className, model }: { className?: string; model: ContextRingModel | null }): JSX.Element | null {
	return (
		<ContextRingRoot model={model}>
			<ContextRingTrigger className={className} />
			<ContextRingContent>
				<ContextRingDetails />
			</ContextRingContent>
		</ContextRingRoot>
	);
}

function useContextRingContext(part: string): ContextRingState {
	const context = useContext(ContextRingContext);
	if (!context) throw new Error(`ContextRing.${part} must be used within ContextRing.Root`);
	return context;
}

export const ContextRing = Object.assign(ContextRingDefault, {
	Root: ContextRingRoot,
	Trigger: ContextRingTrigger,
	Content: ContextRingContent,
	Details: ContextRingDetails,
	ScopeList: ContextRingScopeList,
	Scope: ContextRingScope,
});

function OverviewPane({
	details,
	onSelect,
}: {
	details: ContextRingDetailsModel;
	onSelect: (group: ContextRingDetailGroupKind) => void;
}): JSX.Element {
	const { t } = useTranslation("chat");
	const segments = useMemo(() => buildContextRingBarSegments(details.groups), [details.groups]);
	return (
		<div className="px-3 py-2.5">
			<PopoverTitle className="truncate text-[12px]">{t("contextRing.details.title")}</PopoverTitle>
			<div className="truncate text-[10px] text-muted-foreground" title={details.model}>
				{details.model}
			</div>
			<div className="mt-1.5 flex items-baseline justify-between gap-2 text-[10px]">
				<span className="text-muted-foreground">{t("contextRing.details.actual")}</span>
				<span className="tabular-nums text-foreground/80">
					{details.actualTokens ?? t("contextRing.details.unknown")} / {details.windowLabel}
				</span>
			</div>
			<div className="mt-2 flex h-2 gap-px overflow-hidden rounded-full bg-muted/50">
				{segments.map((segment) => {
					const group = details.groups.find((item) => item.id === segment.id);
					return (
						<button
							key={segment.id}
							type="button"
							title={group ? `${group.title} · ${group.tokens} · ${group.share}` : undefined}
							aria-label={group?.title}
							onClick={() => onSelect(segment.id)}
							style={{ width: `${segment.percent}%`, backgroundColor: GROUP_COLORS[segment.id] }}
							className="h-full transition-opacity hover:opacity-80"
						/>
					);
				})}
			</div>
			<div className="mt-1.5 max-h-56 overflow-y-auto">
				{details.groups.map((group) => (
					<button
						key={group.id}
						type="button"
						onClick={() => onSelect(group.id)}
						className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-x-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-muted/50"
					>
						<span
							className="h-2 w-2 shrink-0 rounded-full"
							style={{ backgroundColor: GROUP_COLORS[group.id] }}
							aria-hidden="true"
						/>
						<span className="truncate text-[11px] text-foreground">{group.title}</span>
						<span className="text-[11px] tabular-nums">{group.tokens}</span>
						<span className="w-9 text-right text-[10px] tabular-nums text-muted-foreground">{group.share}</span>
						<span className="icon-[solar--alt-arrow-right-linear] h-3 w-3 text-muted-foreground" aria-hidden="true" />
					</button>
				))}
			</div>
		</div>
	);
}

function GroupDetailPane({
	group,
	onBack,
}: {
	group: ContextRingDetailGroup;
	onBack: () => void;
}): JSX.Element {
	const { t } = useTranslation("chat");
	return (
		<div className="px-3 py-2.5">
			<div className="flex items-center gap-1.5">
				<button
					type="button"
					onClick={onBack}
					aria-label={t("contextRing.details.back")}
					className="-ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
				>
					<span className="icon-[solar--alt-arrow-left-linear] h-3.5 w-3.5" aria-hidden="true" />
				</button>
				<span
					className="h-2 w-2 shrink-0 rounded-full"
					style={{ backgroundColor: GROUP_COLORS[group.id] }}
					aria-hidden="true"
				/>
				<PopoverTitle className="truncate text-[12px]">{group.title}</PopoverTitle>
				<span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
					{group.tokens} · {group.share}
				</span>
			</div>
			<div className="mt-0.5 pl-6 text-[10px] text-muted-foreground">
				{t("contextRing.details.items", { count: group.itemCount })}
				{group.unknownCount > 0 ? ` · ${t("contextRing.details.unknownItems", { count: group.unknownCount })}` : null}
			</div>
			<div className="mt-1.5 max-h-56 overflow-y-auto">
				{group.sections.map((section) => {
					const meta = [
						section.metadata,
						section.itemCount > 1 ? t("contextRing.details.items", { count: section.itemCount }) : "",
						section.unknownCount > 0 ? t("contextRing.details.unknownItems", { count: section.unknownCount }) : "",
					]
						.filter(Boolean)
						.join(" · ");
					return (
						<div
							key={section.id}
							className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 px-1 py-1"
						>
							<div className="min-w-0">
								<div className="truncate text-[11px] text-foreground" title={section.title}>
									{section.title}
								</div>
								{meta ? (
									<div className="truncate text-[10px] text-muted-foreground" title={meta}>
										{meta}
									</div>
								) : null}
							</div>
							<span className="text-[11px] tabular-nums">{section.tokens}</span>
							<span className="w-9 text-right text-[10px] tabular-nums text-muted-foreground">{section.share}</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}
