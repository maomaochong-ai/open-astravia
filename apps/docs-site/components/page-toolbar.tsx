import { formatDocsDate } from "@/lib/docs-date";
import type { DocsLanguage } from "@/lib/i18n";

export function PageToolbar({ dateModified, locale = "zh" }: { dateModified?: string; locale?: DocsLanguage }) {
	const formatted = formatDocsDate(dateModified, locale);
	if (!formatted) return null;

	return (
		<p className="m-0 font-mono text-[0.64rem] tracking-[0.08em] text-fd-muted-foreground uppercase">
			{locale === "en" ? "Updated on" : "更新于"} {formatted}
		</p>
	);
}
