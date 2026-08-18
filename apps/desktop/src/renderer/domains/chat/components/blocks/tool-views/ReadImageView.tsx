import { ReadImageView as ThemeReadImageView } from "@vetta/theme-ui/chat";
import {
	useReadImageViewModel,
	type ToolImagePreviewLike,
} from "../../../hooks/useReadImageViewModel";

/** Desktop thin container: model formats meta/i18n/IPC; theme-ui owns markup. */
export function ReadImageView({ image }: { image: ToolImagePreviewLike }): JSX.Element {
	const model = useReadImageViewModel(image);
	return <ThemeReadImageView {...model} />;
}
