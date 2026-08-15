import { Button } from "@shared/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@shared/components/ui/tooltip";
import { aggregatePromptCacheUsage, type Usage } from "@vetta/ai";
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

	const rows = [
		[t("messageList.tokenUsage.total"), numberFormatter.format(details.totalTokens)],
		[t("messageList.tokenUsage.prompt"), numberFormatter.format(details.promptTokens)],
		[t("messageList.tokenUsage.uncachedInput"), numberFormatter.format(details.input)],
		[t("messageList.tokenUsage.output"), numberFormatter.format(details.output)],
		[t("messageList.tokenUsage.cacheRead"), numberFormatter.format(details.cacheRead)],
		[t("messageList.tokenUsage.cacheWrite"), numberFormatter.format(details.cacheWrite)],
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
			details.writeCallCoverage === null
				? t("messageList.tokenUsage.unavailable")
				: percentFormatter.format(details.writeCallCoverage),
		],
	] as const;

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
				className="w-64 max-w-64 flex-col items-stretch gap-0 rounded-lg border border-border/60 bg-popover p-3 text-popover-foreground shadow-md [&>svg]:hidden"
			>
				<div className="flex items-baseline justify-between gap-4">
					<span className="text-[12px] font-semibold">{t("messageList.tokenUsage.title")}</span>
					<span className="text-[10px] text-muted-foreground">
						{t("messageList.tokenUsage.modelCalls", { count: details.modelCalls })}
					</span>
				</div>
				<dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 border-t border-border/50 pt-2 text-[11px]">
					{rows.map(([label, value]) => (
						<div key={label} className="contents">
							<dt className="text-muted-foreground">{label}</dt>
							<dd className="text-right font-medium tabular-nums text-popover-foreground">{value}</dd>
						</div>
					))}
				</dl>
			</TooltipContent>
		</Tooltip>
	);
}

export function calculateTokenUsageDetails(usages: readonly Usage[]): TokenUsageDetails | null {
	if (usages.length === 0) return null;
	const promptCache = aggregatePromptCacheUsage(usages);
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	let totalTokens = 0;
	for (const usage of usages) {
		input += usage.input;
		output += usage.output;
		cacheRead += usage.cacheRead;
		cacheWrite += usage.cacheWrite;
		totalTokens += usage.totalTokens;
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
	};
}
