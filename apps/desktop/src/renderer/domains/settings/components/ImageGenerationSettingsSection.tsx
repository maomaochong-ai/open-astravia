import { MotionSelect, SettingRow, SettingSection } from "@vetta-org/theme-ui/settings";
import { SETTINGS_SECTION } from "../registry";
import type { ImageGenerationSettingsModel } from "./useImageGenerationSettingsModel";

export function ImageGenerationSettingsSection({ model }: { model: ImageGenerationSettingsModel }): JSX.Element {
	const hasTextToImageOptions = model.textToImageOptions.length > 1;
	const hasImageToImageOptions = model.imageToImageOptions.length > 1;
	return (
		<div className="mt-6">
			<SettingSection
				title={model.labels.title}
				section={SETTINGS_SECTION["agent-images"]}
				description={model.labels.description}
			>
				{model.loading ? (
					<p className="px-1 py-3 text-[12px] text-muted-foreground">{model.labels.loading}</p>
				) : (
					<>
						<SettingRow
							title={model.labels.textToImage}
							description={hasTextToImageOptions ? undefined : model.labels.noProviders}
						>
							<MotionSelect
								value={model.textToImageRouteId}
								onValueChange={(value) => void model.actions.setTextToImageRoute(value)}
								options={model.textToImageOptions}
								disabled={!hasTextToImageOptions}
								triggerClassName="min-w-[220px]"
								aria-label={model.labels.textToImage}
							/>
						</SettingRow>
						<SettingRow
							title={model.labels.imageToImage}
							description={hasImageToImageOptions ? undefined : model.labels.noProviders}
							border={false}
						>
							<MotionSelect
								value={model.imageToImageRouteId}
								onValueChange={(value) => void model.actions.setImageToImageRoute(value)}
								options={model.imageToImageOptions}
								disabled={!hasImageToImageOptions}
								triggerClassName="min-w-[220px]"
								aria-label={model.labels.imageToImage}
							/>
						</SettingRow>
					</>
				)}
			</SettingSection>
		</div>
	);
}
