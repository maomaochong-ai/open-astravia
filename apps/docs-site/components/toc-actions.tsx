import { toMarkdownPath } from "@/lib/site";
import { ViewOptionsPopover } from "fumadocs-ui/layouts/docs/page";

export function TocActions({ path }: { path: string }) {
	return (
		<div className="mt-5 border-t border-fd-border pt-4">
			<ViewOptionsPopover markdownUrl={toMarkdownPath(path)} />
		</div>
	);
}
