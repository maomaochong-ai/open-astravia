import type { DocsLanguage } from "@/lib/i18n";

export function BrandMark({ language = "zh" }: { language?: DocsLanguage }) {
	return (
		<span className="inline-flex min-w-0 items-center gap-[0.7rem] tracking-normal">
			<span
				className="relative grid size-8 shrink-0 place-items-center overflow-visible rounded-full border border-fd-border bg-vetta-binding"
				aria-hidden="true"
			>
				<img
					src="/images/vetta-app-icon.webp"
					alt=""
					width="32"
					height="32"
					className="block size-full rounded-full object-cover"
				/>
				<span className="absolute -right-[0.12rem] -bottom-[0.12rem] size-[0.48rem] rounded-full border-2 border-fd-background bg-vetta-coral" />
			</span>
			<span className="grid leading-[1.05]">
				<strong className="font-display text-[1.02rem] font-semibold">Vetta</strong>
				<small className="mt-[0.18rem] hidden font-mono text-[0.58rem] font-medium tracking-[0.12em] text-fd-muted-foreground uppercase md:block">
					{language === "en" ? "Documentation" : "文档"}
				</small>
			</span>
		</span>
	);
}
