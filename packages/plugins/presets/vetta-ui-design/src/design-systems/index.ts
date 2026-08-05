import airbnbMd from "./airbnb/DESIGN.md?raw";
import airbnbCss from "./airbnb/theme.css?raw";
import anthropicMd from "./anthropic/DESIGN.md?raw";
import anthropicCss from "./anthropic/theme.css?raw";
import appleMd from "./apple/DESIGN.md?raw";
import appleCss from "./apple/theme.css?raw";
import coinbaseMd from "./coinbase/DESIGN.md?raw";
import coinbaseCss from "./coinbase/theme.css?raw";
import discordMd from "./discord/DESIGN.md?raw";
import discordCss from "./discord/theme.css?raw";
import doodlePopMd from "./doodle-pop/DESIGN.md?raw";
import doodlePopCss from "./doodle-pop/theme.css?raw";
import duolingoMd from "./duolingo/DESIGN.md?raw";
import duolingoCss from "./duolingo/theme.css?raw";
import figmaMd from "./figma/DESIGN.md?raw";
import figmaCss from "./figma/theme.css?raw";
import githubMd from "./github/DESIGN.md?raw";
import githubCss from "./github/theme.css?raw";
import headspaceMd from "./headspace/DESIGN.md?raw";
import headspaceCss from "./headspace/theme.css?raw";
import linearMd from "./linear/DESIGN.md?raw";
import linearCss from "./linear/theme.css?raw";
import mediumMd from "./medium/DESIGN.md?raw";
import mediumCss from "./medium/theme.css?raw";
import netflixMd from "./netflix/DESIGN.md?raw";
import netflixCss from "./netflix/theme.css?raw";
import notionMd from "./notion/DESIGN.md?raw";
import notionCss from "./notion/theme.css?raw";
import openaiMd from "./openai/DESIGN.md?raw";
import openaiCss from "./openai/theme.css?raw";
import retro95Md from "./retro-95/DESIGN.md?raw";
import retro95Css from "./retro-95/theme.css?raw";
import shopifyMd from "./shopify/DESIGN.md?raw";
import shopifyCss from "./shopify/theme.css?raw";
import slackMd from "./slack/DESIGN.md?raw";
import slackCss from "./slack/theme.css?raw";
import spotifyMd from "./spotify/DESIGN.md?raw";
import spotifyCss from "./spotify/theme.css?raw";
import stripeMd from "./stripe/DESIGN.md?raw";
import stripeCss from "./stripe/theme.css?raw";
import type { DesignSystem } from "./types";
import vercelMd from "./vercel/DESIGN.md?raw";
import vercelCss from "./vercel/theme.css?raw";

/** 上游内容来源（DESIGN.md frontmatter 的 `source:` 归属，MIT）。 */
export const DESIGN_SYSTEMS_SOURCE = "https://github.com/VoltAgent/awesome-design-md";

/**
 * 内置的设计体系。顺序即 drawer 里的展示顺序：按风格差异交错排（亮暗、
 * 冷暖、克制/张扬），让用户横滑前几张就能碰到完全不同的方向。
 *
 * token 契约：每套 theme.css 必含 DEFAULT_THEME_CSS 的 7 个基础 color token
 * （只换值不改名），并统一追加 surface-raised / border 与 radius / shadow 刻度。
 */
export const DESIGN_SYSTEMS: readonly DesignSystem[] = [
	{ id: "linear", name: "Linear", category: "dev", blurb:
			"Dark, dense, engineered dev-tool calm; indigo primary, hairline borders, keyboard-first density.",
		vibe: "dark", themeCss: linearCss, designMd: linearMd },
	{
		id: "doodle-pop",
		name: "Doodle Pop",
		category: "playful",
		blurb:
			"Lime × black sticker energy; thick ink borders, hard offset shadows, pastel doodles, game-drop vibes.",
		vibe: "light",
		themeCss: doodlePopCss,
		designMd: doodlePopMd,
	},
	{ id: "stripe", name: "Stripe", category: "fintech", blurb:
			"Polished light fintech; blurple CTAs, white cards on airy blue-gray, refined layered shadows.",
		vibe: "light", themeCss: stripeCss, designMd: stripeMd },
	{ id: "spotify", name: "Spotify", category: "media", blurb:
			"Near-black media stage; one electric green for play, bold type, pill buttons, imagery-led.",
		vibe: "dark", themeCss: spotifyCss, designMd: spotifyMd },
	{ id: "notion", name: "Notion", category: "productivity", blurb:
			"Quiet warm-gray document UI; tiny radii, almost no chrome, typography does the hierarchy.",
		vibe: "light", themeCss: notionCss, designMd: notionMd },
	{ id: "vercel", name: "Vercel", category: "dev", blurb:
			"Stark black-on-white monochrome; Swiss precision, mono accents, one blue for links only.",
		vibe: "light", themeCss: vercelCss, designMd: vercelMd },
	{
		id: "headspace",
		name: "Headspace",
		category: "playful",
		blurb:
			"Warm sunrise cream calm; orange CTAs, maximal roundness, soft diffuse depth, friendly.",
		vibe: "light",
		themeCss: headspaceCss,
		designMd: headspaceMd,
	},
	{ id: "github", name: "GitHub", category: "dev", blurb:
			"Dimmed dark developer habitat; bordered boxes, green actions, blue links, mono everywhere.",
		vibe: "dark", themeCss: githubCss, designMd: githubMd },
	{ id: "apple", name: "Apple", category: "consumer", blurb:
			"Airy premium light neutrals; huge type, pill controls, generous curves and silence.",
		vibe: "light", themeCss: appleCss, designMd: appleMd },
	{ id: "discord", name: "Discord", category: "consumer", blurb:
			"Cozy dark clubhouse; blurple energy, layered charcoals, rounded playful gaming DNA.",
		vibe: "dark", themeCss: discordCss, designMd: discordMd },
	{
		id: "anthropic",
		name: "Anthropic",
		category: "ai",
		blurb:
			"Warm book-cloth cream; ink primary, clay accent, serif headings, literary and unhurried.",
		vibe: "light",
		themeCss: anthropicCss,
		designMd: anthropicMd,
	},
	{ id: "netflix", name: "Netflix", category: "media", blurb:
			"Cinematic black; one red action, sharp corners, full-bleed imagery with gradient text.",
		vibe: "dark", themeCss: netflixCss, designMd: netflixMd },
	{ id: "airbnb", name: "Airbnb", category: "consumer", blurb:
			"Warm white hospitality; coral CTAs, photo-led rounded cards, floating pill search.",
		vibe: "light", themeCss: airbnbCss, designMd: airbnbMd },
	{
		id: "duolingo",
		name: "Duolingo",
		category: "playful",
		blurb:
			"Chunky playful game UI; vivid green, 3D-press buttons, extra-bold uppercase labels.",
		vibe: "light",
		themeCss: duolingoCss,
		designMd: duolingoMd,
	},
	{ id: "figma", name: "Figma", category: "creative", blurb:
			"Crisp light tool chrome; blue selection, purple spark, compact 1px-precision panels.",
		vibe: "light", themeCss: figmaCss, designMd: figmaMd },
	{ id: "openai", name: "OpenAI", category: "ai", blurb:
			"Restrained lab white; teal signal only, near-flat, centered reading column, quiet cards.",
		vibe: "light", themeCss: openaiCss, designMd: openaiMd },
	{ id: "slack", name: "Slack", category: "productivity", blurb:
			"Friendly workplace white with an aubergine nav rail; candy accents, conversational blocks.",
		vibe: "light", themeCss: slackCss, designMd: slackMd },
	{
		id: "coinbase",
		name: "Coinbase",
		category: "fintech",
		blurb:
			"Bank-grade crypto light; one decisive blue, pill CTAs, tabular numbers front and center.",
		vibe: "light",
		themeCss: coinbaseCss,
		designMd: coinbaseMd,
	},
	{
		id: "shopify",
		name: "Shopify",
		category: "commerce",
		blurb:
			"Merchant back-office; cool gray floor, white bordered cards, commerce green actions.",
		vibe: "light",
		themeCss: shopifyCss,
		designMd: shopifyMd,
	},
	{ id: "medium", name: "Medium", category: "editorial", blurb:
			"Editorial white magazine; serif prose, green follow, yellow highlight, dividers not boxes.",
		vibe: "light", themeCss: mediumCss, designMd: mediumMd },
	{ id: "retro-95", name: "Retro 95", category: "retro", blurb:
			"1995 desktop nostalgia; beveled silver chrome, navy title bars, zero border radius.",
		vibe: "light", themeCss: retro95Css, designMd: retro95Md },
];

export function designSystemById(id: string): DesignSystem | undefined {
	return DESIGN_SYSTEMS.find((system) => system.id === id);
}
