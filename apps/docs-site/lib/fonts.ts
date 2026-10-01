import { Noto_Serif_SC } from "next/font/google";

export const displaySerif = Noto_Serif_SC({
	subsets: ["latin"],
	weight: ["600", "700"],
	display: "swap",
	variable: "--font-astravia-serif",
	adjustFontFallback: false,
});
