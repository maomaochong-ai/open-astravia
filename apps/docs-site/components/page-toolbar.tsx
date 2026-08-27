import { formatDocsDate } from "@/lib/docs-date";

export function PageToolbar({ dateModified }: { dateModified?: string }) {
	const formatted = formatDocsDate(dateModified);
	if (!formatted) return null;

	return (
		<p className="mt-[1.15rem] font-mono text-[0.68rem] tracking-[0.06em] text-fd-muted-foreground uppercase">
			更新于 {formatted}
		</p>
	);
}
