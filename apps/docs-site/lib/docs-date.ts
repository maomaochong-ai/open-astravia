const formatterOptions: Intl.DateTimeFormatOptions = {
	year: "numeric",
	month: "long",
	day: "numeric",
	timeZone: "Asia/Shanghai",
};

export function formatDocsDate(iso?: string, locale: "zh" | "en" = "zh"): string | undefined {
	if (!iso) return undefined;

	const parsed = new Date(iso);
	if (Number.isNaN(parsed.getTime())) return undefined;

	return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", formatterOptions).format(parsed);
}
