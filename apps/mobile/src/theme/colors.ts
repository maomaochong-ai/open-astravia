/**
 * Colours for props that cannot take a className (icon strokes, gradients,
 * placeholderTextColor). Keep in sync with `global.css`.
 */
export const palette = {
	dark: {
		page: "#0a0b0d",
		card: "#15171a",
		card2: "#1c1f23",
		line: "#24272c",
		ink: "#f4f5f6",
		ink2: "#b3b8be",
		dim: "#8b9096",
		faint: "#5b6067",
		pill: "#f4f5f6",
		pillInk: "#0a0b0d",
	},
	light: {
		page: "#f4f5f7",
		card: "#ffffff",
		card2: "#f0f1f3",
		line: "#e3e5e8",
		ink: "#0b0c0e",
		ink2: "#3f444b",
		dim: "#6b7077",
		faint: "#9aa0a6",
		pill: "#0b0c0e",
		pillInk: "#ffffff",
	},
	green: "#22c55e",
	greenSoft: "rgba(34, 197, 94, 0.14)",
	orange: "#f59e0b",
	red: "#f0524f",
} as const;

export type ThemeName = keyof Pick<typeof palette, "dark" | "light">;
