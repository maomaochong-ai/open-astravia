import { Button } from "@shared/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@shared/components/ui/tooltip";
import { aggregatePromptCacheUsage, type Usage } from "@vetta/ai/protocol";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

interface MessageTokenUsageProps {
	usages: readonly Usage[];
}

interface TokenUsageDetails {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	promptTokens: number;
	modelCalls: number;
	tokenHitRate: number | null;
	readCallCoverage: number | null;
	writeCallCoverage: number | null;
	diagnosedCalls: number;
	latestPromptCache: NonNullable<Usage["promptCache"]> | null;
}

export function MessageTokenUsage({ usages }: MessageTokenUsageProps): JSX.Element | null {
	const { t, i18n } = useTranslation("chat");
	const details = useMemo(() => calculateTokenUsageDetails(usages), [usages]);
	const language = i18n.resolvedLanguage ?? i18n.language;
	const numberFormatter = useMemo(() => new Intl.NumberFormat(language), [language]);
	const percentFormatter = useMemo(
		() =>
			new Intl.NumberFormat(language, {
				style: "percent",
				maximumFractionDigits: 1,
			}),
		[language],
	);

	if (!details) return null;
	const latestPromptCache = details.latestPromptCache;
	const prefixStatus = latestPromptCache?.prefixStatus
		? {
				initial: t("messageList.tokenUsage.prefixStatuses.initial"),
				extended: t("messageList.tokenUsage.prefixStatuses.extended"),
				changed: t("messageList.tokenUsage.prefixStatuses.changed"),
				unknown: t("messageList.tokenUsage.prefixStatuses.unknown"),
			}[latestPromptCache.prefixStatus]
		: null;
	const changedSegments = latestPromptCache?.changedSegments
		?.map((segment) => {
			switch (segment) {
				case "stable-system":
					return t("messageList.tokenUsage.prefixSegments.stableSystem");
				case "volatile-system":
					return t("messageList.tokenUsage.prefixSegments.volatileSystem");
				case "tools":
					return t("messageList.tokenUsage.prefixSegments.tools");
				case "messages":
					return t("messageList.tokenUsage.prefixSegments.messages");
			}
		})
		.join(t("messageList.tokenUsage.segmentSeparator"));
	const changeLabels = {
		added: t("messageList.tokenUsage.changeKinds.added"),
		removed: t("messageList.tokenUsage.changeKinds.removed"),
		changed: t("messageList.tokenUsage.changeKinds.changed"),
		reordered: t("messageList.tokenUsage.changeKinds.reordered"),
	};
	const formatDefinitionChanges = (
		changes: NonNullable<NonNullable<Usage["promptCache"]>["changedTools"]> | undefined,
	) =>
		changes
			?.map(({ id, change }) =>
				t("messageList.tokenUsage.definitionChange", { id, change: changeLabels[change] }),
			)
			.join(t("messageList.tokenUsage.segmentSeparator"));
	const changedPromptBlocks = formatDefinitionChanges(latestPromptCache?.changedSystemPromptBlocks);
	const changedTools = formatDefinitionChanges(latestPromptCache?.changedTools);

	const parts = [
		{ key: "uncachedInput", label: t("messageList.tokenUsage.uncachedInput"), value: details.input },
		{ key: "cacheRead", label: t("messageList.tokenUsage.cacheRead"), value: details.cacheRead },
		{ key: "cacheWrite", label: t("messageList.tokenUsage.cacheWrite"), value: details.cacheWrite },
		{ key: "output", label: t("messageList.tokenUsage.output"), value: details.output },
	] as const;
	const partsTotal = parts.reduce((sum, part) => sum + part.value, 0);

	const cacheStats: readonly (readonly [string, string])[] = [
		[
			t("messageList.tokenUsage.cacheHitRate"),
			details.tokenHitRate === null
				? t("messageList.tokenUsage.unavailable")
				: percentFormatter.format(details.tokenHitRate),
		],
		[
			t("messageList.tokenUsage.readCoverage"),
			details.readCallCoverage === null
				? t("messageList.tokenUsage.unavailable")
				: percentFormatter.format(details.readCallCoverage),
		],
		[
			t("messageList.tokenUsage.writeCoverage"),
			details.readCallCoverage !== null && details.readCallCoverage > 0 && details.writeCallCoverage === 0
				? t("messageList.tokenUsage.readOnlyReporting")
				: details.writeCallCoverage === null
					? t("messageList.tokenUsage.unavailable")
					: percentFormatter.format(details.writeCallCoverage),
		],
	];

	const diagnosticRows: readonly (readonly [string, string])[] = latestPromptCache
		? [
				[
					t("messageList.tokenUsage.diagnosticCoverage"),
					`${numberFormatter.format(details.diagnosedCalls)}/${numberFormatter.format(details.modelCalls)}`,
				],
				[
					t("messageList.tokenUsage.stableSystemChars"),
					numberFormatter.format(latestPromptCache.stableSystemPromptLength),
				],
				[
					t("messageList.tokenUsage.volatileSystemChars"),
					numberFormatter.format(latestPromptCache.volatileSystemPromptLength),
				],
				[
					t("messageList.tokenUsage.historyMessages"),
					numberFormatter.format(latestPromptCache.historyPrefixMessages),
				],
				[t("messageList.tokenUsage.toolCount"), numberFormatter.format(latestPromptCache.toolCount)],
				...(prefixStatus ? [[t("messageList.tokenUsage.prefixStatus"), prefixStatus] as const] : []),
				...(changedSegments ? [[t("messageList.tokenUsage.changedSegments"), changedSegments] as const] : []),
				...(changedPromptBlocks
					? [[t("messageList.tokenUsage.changedPromptBlocks"), changedPromptBlocks] as const]
					: []),
				...(changedTools ? [[t("messageList.tokenUsage.changedTools"), changedTools] as const] : []),
				[t("messageList.tokenUsage.prefixHash"), latestPromptCache.cachePrefixHash],
			]
		: [];

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					className="text-muted-foreground/45 hover:text-muted-foreground"
					aria-label={t("messageList.tokenUsage.trigger")}
				>
					<span className="icon-[solar--chart-2-linear] h-3.5 w-3.5" aria-hidden />
				</Button>
			</TooltipTrigger>
			<TooltipContent
				side="top"
				align="start"
				sideOffset={6}
				showArrow={false}
				className="w-60 max-w-60 flex-col items-stretch gap-0 rounded-lg border border-border/60 bg-popover p-2.5 text-popover-foreground shadow-md"
			>
				<div className="flex items-baseline justify-between gap-2">
					<span className="text-[11px] font-semibold">{t("messageList.tokenUsage.title")}</span>
					<span className="text-[10px] text-muted-foreground">
						{t("messageList.tokenUsage.modelCalls", { count: details.modelCalls })}
					</span>
				</div>
				<div className="mt-1 flex items-baseline gap-1.5">
					<span className="text-[18px] font-semibold leading-none tabular-nums">
						{numberFormatter.format(details.totalTokens)}
					</span>
					<span className="truncate text-[10px] text-muted-foreground">
						{t("messageList.tokenUsage.prompt")} {numberFormatter.format(details.promptTokens)}
					</span>
				</div>
				<div className="mt-1.5 flex h-1.5 gap-px overflow-hidden rounded-full bg-muted/50">
					{parts.map((part, index) => (
						<span
							key={part.key}
							style={{
								width: `${partsTotal > 0 ? (part.value / partsTotal) * 100 : 0}%`,
								backgroundColor: SEGMENT_COLORS[index],
							}}
							aria-hidden
						/>
					))}
				</div>
				<dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
					{parts.map((part, index) => (
						<div key={part.key} className="flex items-center gap-1">
							<span
								className="h-1.5 w-1.5 shrink-0 rounded-full"
								style={{ backgroundColor: SEGMENT_COLORS[index] }}
								aria-hidden
							/>
							<dt className="truncate text-muted-foreground">{part.label}</dt>
							<dd className="ml-auto tabular-nums">{numberFormatter.format(part.value)}</dd>
						</div>
					))}
				</dl>
				<dl className="mt-2 grid grid-cols-3 gap-1 border-t border-border/50 pt-1.5 text-[10px]">
					{cacheStats.map(([label, value]) => (
						<div key={label} className="min-w-0">
							<dt className="truncate text-muted-foreground" title={label}>
								{label}
							</dt>
							<dd className="truncate text-[11px] tabular-nums" title={value}>
								{value}
							</dd>
						</div>
					))}
				</dl>
				{diagnosticRows.length > 0 ? (
					<dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5 border-t border-border/50 pt-1.5 text-[10px]">
						{diagnosticRows.map(([label, value]) => (
							<div key={label} className="contents">
								<dt className="truncate text-muted-foreground" title={label}>
									{label}
								</dt>
								<dd className="max-w-32 truncate text-right tabular-nums text-popover-foreground" title={value}>
									{value}
								</dd>
							</div>
						))}
					</dl>
				) : null}
			</TooltipContent>
		</Tooltip>
	);
}

/** 与上下文构成条共用主题色板，保持等亮度、只靠色相区分。 */
const SEGMENT_COLORS = [
	"var(--context-segment-1)",
	"var(--context-segment-2)",
	"var(--context-segment-3)",
	"var(--context-segment-4)",
] as const;

export function calculateTokenUsageDetails(usages: readonly Usage[]): TokenUsageDetails | null {
	if (usages.length === 0) return null;
	const promptCache = aggregatePromptCacheUsage(usages);
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	let totalTokens = 0;
	let diagnosedCalls = 0;
	let latestPromptCache: NonNullable<Usage["promptCache"]> | null = null;
	for (const usage of usages) {
		input += usage.input;
		output += usage.output;
		cacheRead += usage.cacheRead;
		cacheWrite += usage.cacheWrite;
		totalTokens += usage.totalTokens;
		if (usage.promptCache) {
			diagnosedCalls += 1;
			latestPromptCache = usage.promptCache;
		}
	}
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens,
		promptTokens: promptCache.promptTokens,
		modelCalls: promptCache.calls,
		tokenHitRate: promptCache.tokenHitRate,
		readCallCoverage: promptCache.readCallCoverage,
		writeCallCoverage: promptCache.writeCallCoverage,
		diagnosedCalls,
		latestPromptCache,
	};
}
