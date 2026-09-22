import { useMemo } from "react";
import { Platform } from "react-native";
import MarkdownDisplay from "react-native-markdown-display";
import { palette } from "../theme/colors";
import { useTheme } from "../theme/use-theme";

const mono = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

/** Assistant text with the design's table, list and inline-code treatment. */
export function Markdown({ text, onLink }: { text: string; onLink?: (url: string) => boolean }) {
	const { colors } = useTheme();
	const style = useMemo(
		() => ({
			body: { color: colors.ink, fontSize: 15, lineHeight: 23 },
			paragraph: { marginTop: 0, marginBottom: 10 },
			strong: { fontWeight: "600" as const, color: colors.ink },
			em: { fontStyle: "italic" as const },
			heading1: { fontSize: 20, fontWeight: "700" as const, marginBottom: 8, color: colors.ink },
			heading2: { fontSize: 18, fontWeight: "700" as const, marginBottom: 8, color: colors.ink },
			heading3: { fontSize: 16, fontWeight: "600" as const, marginBottom: 6, color: colors.ink },
			bullet_list: { marginBottom: 8 },
			ordered_list: { marginBottom: 8 },
			list_item: { marginBottom: 4 },
			bullet_list_icon: { color: colors.dim, marginRight: 8 },
			ordered_list_icon: { color: colors.dim, marginRight: 8 },
			code_inline: {
				fontFamily: mono,
				fontSize: 13,
				color: palette.green,
				backgroundColor: colors.card2,
				borderWidth: 0,
				borderRadius: 6,
				paddingHorizontal: 5,
				paddingVertical: 1,
			},
			fence: {
				fontFamily: mono,
				fontSize: 12.5,
				color: colors.ink,
				backgroundColor: colors.card,
				borderWidth: 1,
				borderColor: colors.line,
				borderRadius: 14,
				padding: 12,
				marginBottom: 10,
			},
			code_block: {
				fontFamily: mono,
				fontSize: 12.5,
				color: colors.ink,
				backgroundColor: colors.card,
				borderWidth: 1,
				borderColor: colors.line,
				borderRadius: 14,
				padding: 12,
			},
			blockquote: {
				backgroundColor: colors.card,
				borderLeftWidth: 2,
				borderLeftColor: palette.green,
				paddingHorizontal: 12,
				paddingVertical: 6,
				marginBottom: 10,
				borderRadius: 8,
			},
			link: { color: palette.green },
			hr: { backgroundColor: colors.line, height: 1, marginVertical: 10 },
			table: { borderWidth: 1, borderColor: colors.line, borderRadius: 14, overflow: "hidden" as const, marginBottom: 12 },
			thead: { backgroundColor: colors.card },
			th: { paddingHorizontal: 12, paddingVertical: 9, fontSize: 12, color: colors.dim, fontWeight: "500" as const },
			tr: { borderBottomWidth: 1, borderColor: colors.line, flexDirection: "row" as const },
			td: { paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: colors.ink, fontFamily: mono },
		}),
		[colors],
	);
	return (
		<MarkdownDisplay style={style} onLinkPress={onLink}>
			{text}
		</MarkdownDisplay>
	);
}
