import { getSiteOrigin } from "../site";

export const AI_SEARCH_USER_AGENTS = [
	"GPTBot",
	"OAI-SearchBot",
	"ClaudeBot",
	"PerplexityBot",
	"Google-Extended",
	"Google-CloudVertexBot",
] as const;

export interface RobotsConfig {
	rules: Array<{
		userAgent: string | string[];
		allow: string;
		disallow?: string[];
	}>;
	sitemap: string;
	host: string;
}

export function buildRobotsConfig(origin = getSiteOrigin()): RobotsConfig {
	return {
		rules: [
			{
				userAgent: "*",
				allow: "/",
				disallow: ["/api/"],
			},
			{
				userAgent: [...AI_SEARCH_USER_AGENTS],
				allow: "/",
			},
		],
		sitemap: `${origin}/sitemap.xml`,
		host: origin,
	};
}
