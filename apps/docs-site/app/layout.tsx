import { Analytics } from "@vercel/analytics/next";
import { cn } from "@/lib/cn";
import { displaySerif } from "@/lib/fonts";
import { getRequestLanguage, localeConfig } from "@/lib/i18n";
import { buildRootMetadata } from "@/lib/seo/metadata";
import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import "./global.css";

export const metadata: Metadata = buildRootMetadata();

export default async function RootLayout({ children }: { children: ReactNode }) {
	const requestHeaders = await headers();
	const language = getRequestLanguage(new Request("https://docs.openvetta.com/", { headers: requestHeaders }));

	return (
		<html
			lang={localeConfig[language].htmlLang}
			className={cn(displaySerif.variable, "scroll-smooth border-t-2 border-vetta-coral")}
			suppressHydrationWarning
		>
			<body className="flex min-h-screen flex-col bg-fd-background text-fd-foreground">
				{children}
				<Analytics />
			</body>
		</html>
	);
}
