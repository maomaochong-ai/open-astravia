import { buildPageActionLinks } from "@/lib/page-actions";
import { toAbsoluteUrl, toMarkdownPath } from "@/lib/site";

export function TocActions({ path }: { path: string }) {
	const links = buildPageActionLinks({
		pageUrl: toAbsoluteUrl(path),
		markdownUrl: toMarkdownPath(path),
	});

	return (
		<nav className="mt-5 border-t border-fd-border pt-4" aria-label="打开本页">
			<p className="m-0 mb-2 font-mono text-[0.64rem] font-medium tracking-[0.14em] text-vetta-coral uppercase">
				OPEN / 打开
			</p>
			<ul className="m-0 grid list-none gap-0 p-0">
				{links.map((link) => (
					<li key={link.id} className="border-b border-fd-border last:border-b-0">
						<a
							className="group flex items-baseline justify-between gap-2 py-2 text-[0.78rem] leading-[1.45] text-inherit no-underline transition-colors hover:text-vetta-coral"
							href={link.href}
							rel={link.external ? "noreferrer noopener" : undefined}
							target={link.external ? "_blank" : undefined}
						>
							{link.label}
							<span className="font-mono text-[0.64rem] text-vetta-coral transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true">
								{link.external ? "↗" : "→"}
							</span>
						</a>
					</li>
				))}
			</ul>
		</nav>
	);
}
