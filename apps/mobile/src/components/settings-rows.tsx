import { Switch } from "heroui-native";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { t } from "../i18n/strings";

export function SectionTitle({ title, hint }: { title: string; hint?: string }) {
	return (
		<View className="mb-3">
			<Text className="text-[17px] font-semibold text-ink">{title}</Text>
			{hint ? <Text className="mt-1 text-[13px] leading-5 text-dim">{hint}</Text> : null}
		</View>
	);
}

export function ToggleRow({
	title,
	hint,
	value,
	onChange,
	disabled,
}: {
	title: string;
	hint: string;
	value: boolean;
	onChange: (value: boolean) => void;
	disabled?: boolean;
}) {
	return (
		<View className={`flex-row items-center py-3.5 ${disabled ? "opacity-50" : ""}`}>
			<View className="flex-1 pr-4">
				<View className="flex-row items-center gap-2">
					<Text className="text-[15px] font-semibold text-ink">{title}</Text>
					{disabled ? (
						<View className="rounded-full bg-card-2 px-2 py-0.5">
							<Text className="text-[10px] text-dim">{t.common.comingSoon}</Text>
						</View>
					) : null}
				</View>
				<Text className="mt-1 text-[12px] leading-[18px] text-dim">{hint}</Text>
			</View>
			<Switch isSelected={value} onSelectedChange={onChange} isDisabled={disabled} accessibilityLabel={title} />
		</View>
	);
}

export function ActionRow({ title, hint, onPress, destructive, right }: { title: string; hint?: string; onPress: () => void; destructive?: boolean; right?: ReactNode }) {
	return (
		<Pressable accessibilityRole="button" onPress={onPress} className="flex-row items-center py-3.5 active:opacity-70">
			<View className="flex-1 pr-4">
				<Text className={`text-[15px] font-semibold ${destructive ? "text-vetta-red" : "text-ink"}`}>{title}</Text>
				{hint ? <Text className="mt-1 text-[12px] leading-[18px] text-dim">{hint}</Text> : null}
			</View>
			{right}
		</Pressable>
	);
}
