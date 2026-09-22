import { useEffect } from "react";
import { Animated, Easing, useAnimatedValue, View } from "react-native";
import { palette } from "../theme/colors";

const SIZE = 260;
const CORNER = 34;
const THICKNESS = 3;

/** Viewfinder with green corner brackets and a sweeping scan line. */
export function ScanFrame({ active, children }: { active: boolean; children?: React.ReactNode }) {
	const sweep = useAnimatedValue(0);
	useEffect(() => {
		if (!active) return;
		const loop = Animated.loop(
			Animated.sequence([
				Animated.timing(sweep, { toValue: 1, duration: 1_800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
				Animated.timing(sweep, { toValue: 0, duration: 1_800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
			]),
		);
		loop.start();
		return () => loop.stop();
	}, [active, sweep]);
	const translateY = sweep.interpolate({ inputRange: [0, 1], outputRange: [20, SIZE - 20] });
	return (
		<View style={{ width: SIZE, height: SIZE }} className="items-center justify-center overflow-hidden rounded-[28px] bg-card">
			<View className="absolute inset-0">{children}</View>
			{(["tl", "tr", "bl", "br"] as const).map((corner) => (
				<View
					key={corner}
					pointerEvents="none"
					style={{
						position: "absolute",
						width: CORNER,
						height: CORNER,
						top: corner.startsWith("t") ? 10 : undefined,
						bottom: corner.startsWith("b") ? 10 : undefined,
						left: corner.endsWith("l") ? 10 : undefined,
						right: corner.endsWith("r") ? 10 : undefined,
						borderColor: palette.green,
						borderTopWidth: corner.startsWith("t") ? THICKNESS : 0,
						borderBottomWidth: corner.startsWith("b") ? THICKNESS : 0,
						borderLeftWidth: corner.endsWith("l") ? THICKNESS : 0,
						borderRightWidth: corner.endsWith("r") ? THICKNESS : 0,
						borderTopLeftRadius: corner === "tl" ? 14 : 0,
						borderTopRightRadius: corner === "tr" ? 14 : 0,
						borderBottomLeftRadius: corner === "bl" ? 14 : 0,
						borderBottomRightRadius: corner === "br" ? 14 : 0,
					}}
				/>
			))}
			{active ? (
				<Animated.View
					pointerEvents="none"
					style={{
						position: "absolute",
						left: 24,
						right: 24,
						top: 0,
						height: 2,
						backgroundColor: palette.green,
						opacity: 0.85,
						transform: [{ translateY }],
						shadowColor: palette.green,
						shadowOpacity: 0.8,
						shadowRadius: 8,
					}}
				/>
			) : null}
		</View>
	);
}
