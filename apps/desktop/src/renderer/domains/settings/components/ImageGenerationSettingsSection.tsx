import { Button } from "@astravia-org/ui";
import {
	CheckboxField,
	InputField,
	MotionSelect,
	SettingRow,
	SettingSection,
} from "@astravia-org/theme-ui/settings";
import { SETTINGS_SECTION } from "../registry";
import type { ImageGenerationSettingsModel } from "./useImageGenerationSettingsModel";

/**
 * 只有「自动选择」一项说明当前没有任何图像 provider。这种时候下拉仍然可用——禁用会让入口
 * 看起来坏掉，而点开看到唯一的自动项就说明了真实状态；不在行里再挂一个「去某页安装」的
 * 引导链接：设置项只负责这一项设置本身，缺什么、去哪儿补属于能力页的事。
 */
function providerMissing(options: readonly { value: string }[]): boolean {
	return options.length <= 1;
}

interface ImageSelectProps {
	ariaLabel: string;
	onChange: (value: string) => void;
	options: readonly { value: string; label: string }[];
	value: string;
}

function ImageRouteSelect({ ariaLabel, onChange, options, value }: ImageSelectProps): JSX.Element {
	return (
		<MotionSelect
			value={value}
			onValueChange={onChange}
			options={options}
			aria-label={ariaLabel}
		/>
	);
}


/** 自定义服务的内联表单：保存前只留在本地 state，API Key 不回显。 */
function CustomProviderForm({ model }: { model: ImageGenerationSettingsModel["custom"] }): JSX.Element | null {
	const { draft, labels } = model;
	if (!draft) return null;
	const field = (title: string, input: JSX.Element): JSX.Element => (
		<label className="flex flex-col gap-1">
			<span className="text-[12px] font-medium text-muted-foreground">{title}</span>
			{input}
		</label>
	);
	return (
		<form
			className="flex flex-col gap-3 border-t border-border px-5 py-4"
			onSubmit={(event) => {
				event.preventDefault();
				void model.save();
			}}
		>
			{field(
				labels.name,
				<InputField
					value={draft.name}
					onChange={(name) => model.updateDraft({ name })}
					aria-label={labels.name}
					autoFocus
				/>,
			)}
			{field(
				labels.baseUrl,
				<InputField
					value={draft.baseUrl}
					onChange={(baseUrl) => model.updateDraft({ baseUrl })}
					placeholder="https://api.example.com/v1"
					aria-label={labels.baseUrl}
				/>,
			)}
			{field(
				labels.apiKey,
				<InputField
					type="password"
					value={draft.apiKey}
					onChange={(apiKey) => model.updateDraft({ apiKey })}
					placeholder={draft.hasStoredApiKey ? labels.apiKeyKeepHint : "sk-…"}
					aria-label={labels.apiKey}
				/>,
			)}
			{field(
				labels.model,
				<InputField
					value={draft.model}
					onChange={(modelName) => model.updateDraft({ model: modelName })}
					placeholder="gpt-image-1"
					aria-label={labels.model}
				/>,
			)}
			<div className="flex flex-wrap items-center gap-x-5 gap-y-2">
				<CheckboxField
					checked={draft.supportsTextToImage}
					onChange={(supportsTextToImage) => model.updateDraft({ supportsTextToImage })}
					label={labels.supportsTextToImage}
				/>
				<CheckboxField
					checked={draft.supportsImageToImage}
					onChange={(supportsImageToImage) => model.updateDraft({ supportsImageToImage })}
					label={labels.supportsImageToImage}
				/>
			</div>
			{model.error && (
				<p role="alert" className="text-[12px] text-destructive">
					{model.error}
				</p>
			)}
			<div className="flex justify-end gap-2">
				<Button variant="field" type="button" onClick={model.cancel}>
					{labels.cancel}
				</Button>
				<Button variant="primary" type="submit" disabled={model.saving}>
					{labels.save}
				</Button>
			</div>
		</form>
	);
}

/** 自定义服务列表 + 新增入口。表单与列表同处一张卡片，编辑时原地展开。 */
function CustomProviderList({ model }: { model: ImageGenerationSettingsModel["custom"] }): JSX.Element {
	const { labels } = model;
	return (
		<div className="border-t border-border">
			<div className="flex items-center justify-between gap-6 px-5 py-4">
				<div className="min-w-0 flex-1">
					<div className="text-[13px] font-medium text-foreground">{labels.title}</div>
					<div className="mt-0.5 text-[12px] text-muted-foreground">{labels.description}</div>
				</div>
				{!model.draft && (
					<Button variant="field" type="button" onClick={model.startAdd}>
						{labels.add}
					</Button>
				)}
			</div>
			{model.providers.map((provider) => (
				<div key={provider.id} className="flex items-center justify-between gap-4 px-5 py-2.5">
					<div className="min-w-0 flex-1">
						<div className="truncate text-[13px] text-foreground" title={provider.name}>
							{provider.name} · {provider.model}
						</div>
						<div className="truncate text-[12px] text-muted-foreground" title={provider.baseUrl}>
							{provider.baseUrl}
						</div>
					</div>
					<div className="flex shrink-0 gap-2">
						<button
							type="button"
							onClick={() => model.startEdit(provider.id)}
							className="h-7 rounded-lg px-2 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
						>
							{labels.edit}
						</button>
						<button
							type="button"
							onClick={() => void model.remove(provider.id)}
							className="h-7 rounded-lg px-2 text-[12px] text-muted-foreground hover:bg-accent hover:text-destructive"
						>
							{labels.delete}
						</button>
					</div>
				</div>
			))}
			<CustomProviderForm model={model} />
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
								onChange={(value) => void model.actions.setTextToImageRoute(value)}
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
								onChange={(value) => void model.actions.setImageToImageRoute(value)}
								options={model.imageToImageOptions}
								value={model.imageToImageRouteId}
							/>
						</SettingRow>
						<CustomProviderList model={model.custom} />
					</>
				)}
			</SettingSection>
		</div>
	);
}
