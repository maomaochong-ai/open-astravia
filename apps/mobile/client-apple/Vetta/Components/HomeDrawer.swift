import SwiftUI
import UIKit
import VettaKit

/// Home as a full-width drawer over the slot. It slides in from the left while the
/// page behind shifts a quarter over and dims; dragging from the left edge pulls it
/// out and dragging left on its first page puts it away, both under the finger.
struct HomeDrawer<Content: View, Drawer: View>: View {
	/// Off while unpaired: there is no Home to open.
	var enabled: Bool
	@ViewBuilder var content: Content
	@ViewBuilder var drawer: Drawer
	@Environment(Router.self) private var router
	@State private var width: CGFloat = 0
	/// The finger's travel while dragging the drawer open or shut.
	@State private var drag: CGFloat = 0

	/// 0 is shut, 1 is open.
	private var progress: CGFloat {
		let base: CGFloat = router.drawerOpen ? 1 : 0
		guard width > 0 else { return base }
		return min(max(base + drag / width, 0), 1)
	}

	var body: some View {
		let progress = progress
		let open = router.drawerOpen
		ZStack {
			content
				.overlay {
					Color.black.opacity(0.3 * progress)
						.ignoresSafeArea()
						.allowsHitTesting(false)
				}
				.offset(x: progress * width * 0.25)
				.allowsHitTesting(!open)
				.accessibilityHidden(open)
				.gesture(EdgePan(enabled: enabled && !open, onChange: { drag = max(0, $0) }, onEnd: settle))
			if enabled {
				drawer
					.offset(x: (progress - 1) * width)
					.allowsHitTesting(open)
					.accessibilityHidden(!open)
					.accessibilityAction(.escape) { router.closeDrawer() }
					.gesture(DrawerPan(canBegin: { router.drawerOpen && router.path.isEmpty }, onChange: { drag = min(0, $0) }, onEnd: settle))
			}
		}
		.onGeometryChange(for: CGFloat.self, of: \.size.width) { width = $0 }
	}

	/// Past halfway, or flicked, it goes the rest of the way; otherwise it springs back.
	private func settle(translation: CGFloat, velocity: CGFloat) {
		let reached = (router.drawerOpen ? 1 : 0) + translation / max(width, 1)
		let open = abs(velocity) > 500 ? velocity > 0 : reached > 0.5
		withAnimation(.snappy) {
			drag = 0
			router.drawerOpen = open
		}
	}
}

/// Opens Home from the slot's top-left corner.
struct DrawerButton: View {
	@Environment(Router.self) private var router

	var body: some View {
		Button { router.openDrawer() } label: {
			Image(systemName: "line.3.horizontal")
		}
		.accessibilityLabel(L10n.Home.title)
		.accessibilityIdentifier("drawer.open")
	}
}

/// A drag from the screen's left edge.
private struct EdgePan: UIGestureRecognizerRepresentable {
	var enabled: Bool
	var onChange: (CGFloat) -> Void
	var onEnd: (CGFloat, CGFloat) -> Void

	func makeUIGestureRecognizer(context: Context) -> UIScreenEdgePanGestureRecognizer {
		let pan = UIScreenEdgePanGestureRecognizer()
		pan.edges = .left
		return pan
	}

	func updateUIGestureRecognizer(_ pan: UIScreenEdgePanGestureRecognizer, context: Context) {
		pan.isEnabled = enabled
	}

	func handleUIGestureRecognizerAction(_ pan: UIScreenEdgePanGestureRecognizer, context: Context) {
		if pan.state == .began { dismissKeyboard() }
		follow(pan, onChange: onChange, onEnd: onEnd)
	}
}

/// A leftward drag anywhere on Home's first page, except over a row that scrolls sideways.
private struct DrawerPan: UIGestureRecognizerRepresentable {
	var canBegin: () -> Bool
	var onChange: (CGFloat) -> Void
	var onEnd: (CGFloat, CGFloat) -> Void

	func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }

	func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
		let pan = UIPanGestureRecognizer()
		pan.delegate = context.coordinator
		return pan
	}

	func updateUIGestureRecognizer(_ pan: UIPanGestureRecognizer, context: Context) {
		context.coordinator.canBegin = canBegin
	}

	func handleUIGestureRecognizerAction(_ pan: UIPanGestureRecognizer, context: Context) {
		follow(pan, onChange: onChange, onEnd: onEnd)
	}

	final class Coordinator: NSObject, UIGestureRecognizerDelegate {
		var canBegin: () -> Bool = { false }

		func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
			guard canBegin(), let pan = recognizer as? UIPanGestureRecognizer, let view = pan.view else { return false }
			let velocity = pan.velocity(in: view)
			guard velocity.x < 0, abs(velocity.x) > abs(velocity.y) * 1.5 else { return false }
			// The recent projects carousel keeps its own sideways swipe.
			var hit = view.hitTest(pan.location(in: view), with: nil)
			while let current = hit, current !== view {
				if let scroll = current as? UIScrollView, scrollsSideways(scroll) { return false }
				hit = current.superview
			}
			return true
		}

		/// Alongside the list's own scrolling, which a sideways drag barely moves.
		func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
			guard let scroll = other.view as? UIScrollView else { return false }
			return !scrollsSideways(scroll)
		}

		private func scrollsSideways(_ scroll: UIScrollView) -> Bool {
			scroll.contentSize.width > scroll.bounds.width + 1
		}
	}
}

private func follow(_ pan: UIPanGestureRecognizer, onChange: (CGFloat) -> Void, onEnd: (CGFloat, CGFloat) -> Void) {
	let translation = pan.translation(in: pan.view).x
	switch pan.state {
	case .began, .changed: onChange(translation)
	case .ended: onEnd(translation, pan.velocity(in: pan.view).x)
	case .cancelled, .failed: onEnd(0, 0)
	default: break
	}
}
