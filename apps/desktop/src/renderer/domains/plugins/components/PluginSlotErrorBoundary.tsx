import { Component, type ErrorInfo, type ReactNode } from "react";

export class PluginSlotErrorBoundary extends Component<
	{ pluginSlotId: string; children: ReactNode },
	{ failed: boolean }
> {
	state = { failed: false };

	static getDerivedStateFromError(): { failed: boolean } {
		return { failed: true };
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
		console.error(`Plugin slot failed: ${this.props.pluginSlotId}`, error, errorInfo.componentStack);
	}

	render(): ReactNode {
		if (this.state.failed) return null;
		return this.props.children;
	}
}
