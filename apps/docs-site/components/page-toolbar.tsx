import { formatDocsDate } from "@/lib/docs-date";

export function PageToolbar({ dateModified }: { dateModified?: string }) {
	const formatted = formatDocsDate(dateModified);
	if (!formatted) return null;

	return (
		<p className="m-0 font-mono text-[0.64rem] tracking-[0.08em] text-fd-muted-foreground uppercase">
			更新于 {formatted}
		</p>
	);
}
