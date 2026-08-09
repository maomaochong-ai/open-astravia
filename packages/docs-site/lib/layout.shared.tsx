import { BrandMark } from "@/components/brand-mark";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
	return {
		nav: {
			title: <BrandMark />,
			url: "/",
			transparentMode: "none",
		},
	};
}
