import { formatDocsDate } from "@/lib/docs-date";
import { getDocsMessages, type DocsLanguage } from "@/lib/i18n";

export function PageToolbar({ dateModified, locale = "zh" }: { dateModified?: string; locale?: DocsLanguage }) {
	const formatted = formatDocsDate(dateModified, locale);
	if (!formatted) return null;
	const text = getDocsMessages(locale);

	return (
		<p className="m-0 font-mono text-[0.64rem] tracking-[0.08em] text-fd-muted-foreground uppercase">
			{text.updatedOn} {formatted}
		</p>
	);
}
