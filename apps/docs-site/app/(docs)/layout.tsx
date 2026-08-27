import { StudioBanner } from "@/components/studio-banner";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
	return (
		<DocsLayout
			tree={source.pageTree}
			{...baseOptions()}
			sidebar={{
				banner: <StudioBanner />,
			}}
		>
			{children}
		</DocsLayout>
	);
}
