import { MotionSelect, SettingRow, SettingSection } from "@astravia-org/theme-ui/settings";
import { SETTINGS_SECTION } from "../registry";
import type { ImageGenerationSettingsModel } from "./useImageGenerationSettingsModel";

/**
 * 只有「自动选择」一项说明当前没有任何图像 provider（开源构建没有内置 provider，
 * 需要用户在能力页安装）。此时不再禁用下拉：禁用会让入口看起来坏掉，
 * 而点开看到唯一的自动项、旁边给出安装入口，才说明真实状态。
 */
function providerMissing(options: readonly { value: string }[]): boolean {
	return options.length <= 1;
}

interface ImageSelectProps {
	ariaLabel: string;
	installLabel: string;
	missing: boolean;
	onChange: (value: string) => void;
	onInstall: () => void;
	options: readonly { value: string; label: string }[];
	value: string;
}

function ImageRouteSelect({
	ariaLabel,
	installLabel,
	missing,
	onChange,
	onInstall,
	options,
	value,
}: ImageSelectProps): JSX.Element {
	return (
		<div className="flex flex-col items-end gap-1">
			<MotionSelect
				value={value}
				onValueChange={onChange}
				options={options}
				triggerClassName="min-w-[220px]"
				aria-label={ariaLabel}
			/>
			{missing && (
				<button
					type="button"
					onClick={onInstall}
					className="text-[12px] font-medium text-primary underline-offset-2 hover:underline"
				>
					{installLabel}
				</button>
			)}
		</div>
	);
}

export function ImageGenerationSettingsSection({ model }: { model: ImageGenerationSettingsModel }): JSX.Element {
	const textToImageMissing = providerMissing(model.textToImageOptions);
	const imageToImageMissing = providerMissing(model.imageToImageOptions);

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
							description={textToImageMissing ? model.labels.noProviders : undefined}
						>
							<ImageRouteSelect
								ariaLabel={model.labels.textToImage}
								installLabel={model.labels.installProvider}
								missing={textToImageMissing}
								onChange={(value) => void model.actions.setTextToImageRoute(value)}
								onInstall={model.actions.openMarketplace}
								options={model.textToImageOptions}
								value={model.textToImageRouteId}
							/>
						</SettingRow>
						<SettingRow
							title={model.labels.imageToImage}
							description={imageToImageMissing ? model.labels.noProviders : undefined}
							border={false}
						>
							<ImageRouteSelect
								ariaLabel={model.labels.imageToImage}
								installLabel={model.labels.installProvider}
								missing={imageToImageMissing}
								onChange={(value) => void model.actions.setImageToImageRoute(value)}
								onInstall={model.actions.openMarketplace}
								options={model.imageToImageOptions}
								value={model.imageToImageRouteId}
							/>
						</SettingRow>
					</>
				)}
			</SettingSection>
		</div>
	);
}
