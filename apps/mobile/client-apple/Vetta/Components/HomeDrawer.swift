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
				.gesture(DrawerPan(opens: true, canBegin: { enabled && !router.drawerOpen }, onChange: { drag = max(0, $0) }, onEnd: settle))
			if enabled {
				drawer
					.offset(x: (progress - 1) * width)
					.allowsHitTesting(open)
					.accessibilityHidden(!open)
					.accessibilityAction(.escape) { router.closeDrawer() }
					.gesture(DrawerPan(opens: false, canBegin: { router.drawerOpen && router.path.isEmpty }, onChange: { drag = min(0, $0) }, onEnd: settle))
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

/// Opening: a rightward drag that starts at the screen's left edge.
/// Closing: a leftward drag anywhere on Home's first page, except over a row that scrolls sideways.
/// A plain pan rather than a screen-edge one, which never fires when attached from SwiftUI.
private struct DrawerPan: UIGestureRecognizerRepresentable {
	var opens: Bool
	var canBegin: () -> Bool
	var onChange: (CGFloat) -> Void
	var onEnd: (CGFloat, CGFloat) -> Void

	func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator(opens: opens) }

	func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
		let pan = UIPanGestureRecognizer()
		pan.delegate = context.coordinator
		return pan
	}

	func updateUIGestureRecognizer(_ pan: UIPanGestureRecognizer, context: Context) {
		context.coordinator.canBegin = canBegin
	}

	func handleUIGestureRecognizerAction(_ pan: UIPanGestureRecognizer, context: Context) {
		if opens, pan.state == .began { dismissKeyboard() }
		let translation = pan.translation(in: pan.view).x
		switch pan.state {
		case .began, .changed: onChange(translation)
		case .ended: onEnd(translation, pan.velocity(in: pan.view).x)
		case .cancelled, .failed: onEnd(0, 0)
		default: break
		}
	}

	final class Coordinator: NSObject, UIGestureRecognizerDelegate {
		let opens: Bool
		var canBegin: () -> Bool = { false }

		init(opens: Bool) { self.opens = opens }

		func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
			guard canBegin(), let pan = recognizer as? UIPanGestureRecognizer, let view = pan.view else { return false }
			let velocity = pan.velocity(in: view)
			guard (velocity.x > 0) == opens, abs(velocity.x) > abs(velocity.y) * 1.5 else { return false }
			if opens {
				let start = pan.location(in: nil).x - pan.translation(in: nil).x
				return start <= 24
			}
			// A row that scrolls sideways, like the filter chips, keeps its own swipe.
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
