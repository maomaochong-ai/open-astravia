import { GuideBadgeSwiperView } from "@vetta/theme-ui/chat";
import { useGuideBadgeSwiperModel } from "../hooks/useGuideBadgeSwiperModel";

interface GuideBadgeSwiperProps {
	mounted: boolean;
}

export function GuideBadgeSwiper({ mounted }: GuideBadgeSwiperProps): JSX.Element | null {
	const model = useGuideBadgeSwiperModel(mounted);
	if (!model) return null;
	return <GuideBadgeSwiperView {...model} />;
}
