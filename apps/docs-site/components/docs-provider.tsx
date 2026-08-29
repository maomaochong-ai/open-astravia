"use client";

import { getI18nProvider, type DocsLanguage } from "@/lib/i18n";
import { RootProvider } from "fumadocs-ui/provider/next";
import { useEffect, type ReactNode } from "react";

export function DocsProvider({ language, children }: { language: DocsLanguage; children: ReactNode }) {
	useEffect(() => {
		document.documentElement.lang = language === "en" ? "en-US" : "zh-CN";
	}, [language]);

	return (
		<RootProvider
			i18n={{
				...getI18nProvider(language),
				onLocaleChange: (nextLanguage) => {
					document.cookie = `FD_LOCALE=${encodeURIComponent(nextLanguage)}; Path=/; Max-Age=31536000; SameSite=Lax`;
					window.location.reload();
				},
			}}
		>
			{children}
		</RootProvider>
	);
}
