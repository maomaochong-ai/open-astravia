import { getDocsMessages, type DocsLanguage } from "@/lib/i18n";

export function StudioBanner({ language = "zh" }: { language?: DocsLanguage }) {
	const text = getDocsMessages(language);

	return (
		<a
			className="my-[0.15rem] mb-[0.35rem] grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-lg border border-fd-border bg-fd-card/70 px-3 py-[0.7rem] text-inherit no-underline transition-colors hover:border-vetta-coral/55 hover:bg-fd-card"
			href="/getting-started/"
		>
			<img
				src="/images/vetta-app-icon.webp"
				alt=""
				width="40"
				height="40"
				className="size-[2.4rem] rounded-full border border-fd-border bg-vetta-binding object-cover"
			/>
			<span className="grid min-w-0 gap-[0.18rem]">
				<strong className="text-[0.82rem] font-semibold">
					{text.startWithOneTask}
				</strong>
				<small className="text-[0.68rem] leading-[1.45] text-fd-muted-foreground">
					{text.workspaceDescriptor}
				</small>
			</span>
		</a>
	);
}
