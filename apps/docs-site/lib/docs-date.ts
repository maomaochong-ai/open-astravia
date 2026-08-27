const formatter = new Intl.DateTimeFormat("zh-CN", {
	year: "numeric",
	month: "long",
	day: "numeric",
	timeZone: "Asia/Shanghai",
});

export function formatDocsDate(iso?: string): string | undefined {
	if (!iso) return undefined;

	const parsed = new Date(iso);
	if (Number.isNaN(parsed.getTime())) return undefined;

	return formatter.format(parsed);
}
