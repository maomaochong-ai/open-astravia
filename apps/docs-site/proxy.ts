import { createI18nMiddleware } from "fumadocs-core/i18n/middleware";
import { docsI18n } from "./lib/i18n";

export const proxy = createI18nMiddleware(docsI18n);

export const config = {
	matcher: [
		"/((?!api|_next|images|llms(?:\.txt|-full\.txt)?|opengraph-image|twitter-image|robots\.txt|sitemap\.xml|favicon\.svg).*)",
	],
};
