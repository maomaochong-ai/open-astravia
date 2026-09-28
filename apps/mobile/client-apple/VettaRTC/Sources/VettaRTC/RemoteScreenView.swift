import SwiftUI
import UIKit
import VettaKit
@preconcurrency import WebRTC

/// The desktop's screen, and touches on it as the desktop's mouse, as on Android: a tap
/// clicks, a long press right-clicks (with a magnifier over the finger while held), a drag
/// drags; two fingers pinch to zoom the picture on the phone, pan it once zoomed, and
/// scroll the desktop otherwise. Every click and drag is felt as well as seen.
public struct RemoteScreenView: UIViewRepresentable {
	let track: RTCVideoTrack?
	let interactive: Bool
	let onInput: ([RemoteInputCommand]) -> Void

	public init(track: RTCVideoTrack?, interactive: Bool, onInput: @escaping ([RemoteInputCommand]) -> Void) {
		self.track = track
		self.interactive = interactive
		self.onInput = onInput
	}

	public func makeUIView(context: Context) -> RemoteScreenSurface {
		RemoteScreenSurface()
	}

	public func updateUIView(_ view: RemoteScreenSurface, context: Context) {
		view.onInput = onInput
		view.interactive = interactive
		view.attach(track)
	}

	public static func dismantleUIView(_ view: RemoteScreenSurface, coordinator: ()) {
		view.attach(nil)
	}
}

public final class RemoteScreenSurface: UIView, UIGestureRecognizerDelegate, RTCVideoViewDelegate {
	var onInput: ([RemoteInputCommand]) -> Void = { _ in }
	var interactive = true

	private let video = RTCMTLVideoView()
	private let magnifier = Magnifier()
	private var track: RTCVideoTrack?
	private var videoSize: CGSize = .zero
	private var viewport = RemoteViewport()
	private var wheel = WheelNotches()
	private var twoFingers: TwoFingerMode = .undecided
	private var twoFingerStart: CGPoint = .zero
	private var lastPinchScale: CGFloat = 1
	private var lastTwoFingerTranslation: CGPoint = .zero
	private var dragLast: (x: Double, y: Double)?
	private let tapFeel = UIImpactFeedbackGenerator(style: .light)
	private let holdFeel = UIImpactFeedbackGenerator(style: .medium)
	private let dragFeel = UIImpactFeedbackGenerator(style: .rigid)

	private enum TwoFingerMode { case undecided, zoom, scroll }

	init() {
		super.init(frame: .zero)
		backgroundColor = .black
		clipsToBounds = true
		video.videoContentMode = .scaleToFill
		video.delegate = self
		addSubview(video)
		addSubview(magnifier)

		let tap = UITapGestureRecognizer(target: self, action: #selector(tapped))
		let hold = UILongPressGestureRecognizer(target: self, action: #selector(held))
		hold.minimumPressDuration = 0.45
		hold.allowableMovement = 12
		let drag = UIPanGestureRecognizer(target: self, action: #selector(dragged))
		drag.maximumNumberOfTouches = 1
		let pinch = UIPinchGestureRecognizer(target: self, action: #selector(pinched))
		let pan2 = UIPanGestureRecognizer(target: self, action: #selector(twoFingerPanned))
		pan2.minimumNumberOfTouches = 2
		pan2.maximumNumberOfTouches = 2
		for recognizer in [tap, hold, drag, pinch, pan2] as [UIGestureRecognizer] {
			recognizer.delegate = self
			addGestureRecognizer(recognizer)
		}
		tap.require(toFail: hold)
	}

	@available(*, unavailable)
	required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

	func attach(_ next: RTCVideoTrack?) {
		guard next !== track else { return }
		track?.remove(video)
		magnifier.detach()
		track = next
		next?.add(video)
	}

	// MARK: Layout

	/// Where the picture sits: the video's shape fitted inside, so bars around it take no taps.
	private var pictureRect: CGRect {
		let fitted = RemoteViewport.fitted(
			videoWidth: videoSize.width, videoHeight: videoSize.height,
			containerWidth: bounds.width, containerHeight: bounds.height
		)
		return CGRect(x: fitted.x, y: fitted.y, width: fitted.width, height: fitted.height)
	}

	public override func layoutSubviews() {
		super.layoutSubviews()
		let rect = pictureRect
		video.transform = .identity
		video.frame = rect
		applyViewport()
	}

	private func applyViewport() {
		video.transform = CGAffineTransform(translationX: viewport.panX, y: viewport.panY).scaledBy(x: viewport.zoom, y: viewport.zoom)
	}

	public nonisolated func videoView(_ videoView: any RTCVideoRenderer, didChangeVideoSize size: CGSize) {
		DispatchQueue.main.async {
			MainActor.assumeIsolated {
				guard size.width > 0, size.height > 0, size != self.videoSize else { return }
				self.videoSize = size
				self.viewport = RemoteViewport()
				self.setNeedsLayout()
			}
		}
	}

	/// A point on this view, in the picture's own unzoomed coordinates.
	private func pictureLocal(_ point: CGPoint) -> CGPoint {
		let rect = pictureRect
		return CGPoint(x: point.x - rect.minX, y: point.y - rect.minY)
	}

	private func desktopPoint(_ point: CGPoint) -> (x: Double, y: Double) {
		let rect = pictureRect
		let local = pictureLocal(point)
		return viewport.toDesktop(x: local.x, y: local.y, width: rect.width, height: rect.height)
	}

	private func onPicture(_ point: CGPoint) -> Bool {
		pictureRect.width > 0 && pictureRect.contains(point)
	}

	// MARK: Gestures

	public override func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
		guard videoSize != .zero else { return false }
		// Zooming and panning the picture stay available when taps cannot reach the desktop.
		if recognizer is UIPinchGestureRecognizer { return true }
		if let pan = recognizer as? UIPanGestureRecognizer, pan.minimumNumberOfTouches == 2 { return true }
		return interactive && onPicture(recognizer.location(in: self))
	}

	public func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
		// Pinch and two-finger pan read the same fingers.
		let pair: [UIGestureRecognizer] = [recognizer, other]
		return pair.contains { $0 is UIPinchGestureRecognizer } && pair.contains { ($0 as? UIPanGestureRecognizer)?.minimumNumberOfTouches == 2 }
	}

	@objc private func tapped(_ recognizer: UITapGestureRecognizer) {
		guard recognizer.state == .ended else { return }
		click(at: recognizer.location(in: self), button: .left)
		tapFeel.impactOccurred()
	}

	@objc private func held(_ recognizer: UILongPressGestureRecognizer) {
		let point = recognizer.location(in: self)
		switch recognizer.state {
		case .began:
			holdFeel.impactOccurred()
			if let track { magnifier.show(track, over: point, picture: video.frame, bounds: bounds) }
		case .changed:
			magnifier.move(over: point, picture: video.frame, bounds: bounds)
		case .ended:
			magnifier.hide()
			click(at: point, button: .right)
		default:
			magnifier.hide()
		}
	}

	@objc private func dragged(_ recognizer: UIPanGestureRecognizer) {
		let point = recognizer.location(in: self)
		switch recognizer.state {
		case .began:
			// Pressed where the finger first came down, not where the drag was recognised.
			let translation = recognizer.translation(in: self)
			let start = desktopPoint(CGPoint(x: point.x - translation.x, y: point.y - translation.y))
			dragFeel.impactOccurred()
			onInput([.pointerButton(x: start.x, y: start.y, button: .left, action: .down)])
			let now = desktopPoint(point)
			onInput([.pointerMove(x: now.x, y: now.y)])
			dragLast = now
		case .changed:
			let now = desktopPoint(point)
			onInput([.pointerMove(x: now.x, y: now.y)])
			dragLast = now
		default:
			let end = dragLast ?? desktopPoint(point)
			onInput([.pointerButton(x: end.x, y: end.y, button: .left, action: .up)])
			dragLast = nil
		}
	}

	@objc private func pinched(_ recognizer: UIPinchGestureRecognizer) {
		switch recognizer.state {
		case .began:
			lastPinchScale = 1
		case .changed:
			if twoFingers == .undecided, abs(recognizer.scale - 1) > 0.08 { twoFingers = .zoom }
			guard twoFingers == .zoom else { return }
			let factor = recognizer.scale / lastPinchScale
			lastPinchScale = recognizer.scale
			let rect = pictureRect
			let focus = pictureLocal(recognizer.location(in: self))
			viewport = viewport.transformed(factor: factor, focusX: focus.x, focusY: focus.y, moveX: 0, moveY: 0, width: rect.width, height: rect.height)
			applyViewport()
		default:
			break
		}
	}

	@objc private func twoFingerPanned(_ recognizer: UIPanGestureRecognizer) {
		let translation = recognizer.translation(in: self)
		switch recognizer.state {
		case .began:
			twoFingers = .undecided
			lastTwoFingerTranslation = .zero
			wheel.reset()
		case .changed:
			let move = CGPoint(x: translation.x - lastTwoFingerTranslation.x, y: translation.y - lastTwoFingerTranslation.y)
			lastTwoFingerTranslation = translation
			if twoFingers == .undecided, hypot(translation.x, translation.y) > 10 { twoFingers = .scroll }
			let rect = pictureRect
			if twoFingers == .zoom || viewport.zoomed {
				// Moving a zoomed picture, or the fingers' shared travel while pinching.
				let focus = pictureLocal(recognizer.location(in: self))
				viewport = viewport.transformed(factor: 1, focusX: focus.x, focusY: focus.y, moveX: move.x, moveY: move.y, width: rect.width, height: rect.height)
				applyViewport()
			} else if twoFingers == .scroll, interactive {
				let notches = wheel.add(move.y)
				if notches != 0 { onInput([.pointerScroll(deltaX: 0, deltaY: Double(notches) * WheelNotches.wheelDelta)]) }
			}
		default:
			twoFingers = .undecided
		}
	}

	private func click(at point: CGPoint, button: RemotePointerButton) {
		let target = desktopPoint(point)
		onInput([
			.pointerMove(x: target.x, y: target.y),
			.pointerButton(x: target.x, y: target.y, button: button, action: .down),
			.pointerButton(x: target.x, y: target.y, button: button, action: .up),
		])
	}
}

/// A round lens above the finger that shows the desktop under it at twice the size, so a
/// long press lands on the right spot before the right-click goes out on release.
private final class Magnifier: UIView {
	private static let diameter: CGFloat = 116
	private static let power: CGFloat = 2
	private let lens = RTCMTLVideoView()
	private weak var track: RTCVideoTrack?

	init() {
		super.init(frame: CGRect(x: 0, y: 0, width: Self.diameter, height: Self.diameter))
		isHidden = true
		isUserInteractionEnabled = false
		clipsToBounds = true
		layer.cornerRadius = Self.diameter / 2
		layer.borderWidth = 2
		layer.borderColor = UIColor.white.withAlphaComponent(0.9).cgColor
		backgroundColor = .black
		lens.videoContentMode = .scaleToFill
		addSubview(lens)
	}

	@available(*, unavailable)
	required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

	func show(_ track: RTCVideoTrack, over point: CGPoint, picture: CGRect, bounds: CGRect) {
		if self.track !== track {
			self.track?.remove(lens)
			track.add(lens)
			self.track = track
		}
		isHidden = false
		move(over: point, picture: picture, bounds: bounds)
	}

	/// Above the finger, or below it near the top edge; the picture under the finger in the middle.
	func move(over point: CGPoint, picture: CGRect, bounds: CGRect) {
		let gap: CGFloat = 36
		let above = point.y - gap - Self.diameter / 2
		let centreY = above - Self.diameter / 2 < bounds.minY ? point.y + gap + Self.diameter / 2 : above
		center = CGPoint(x: min(max(point.x, Self.diameter / 2), bounds.width - Self.diameter / 2), y: centreY)
		// The shown picture, zoomed further by `power` about the finger.
		lens.frame = CGRect(
			x: Self.diameter / 2 - (point.x - picture.minX) * Self.power,
			y: Self.diameter / 2 - (point.y - picture.minY) * Self.power,
			width: picture.width * Self.power,
			height: picture.height * Self.power
		)
	}

	func hide() {
		isHidden = true
		detach()
	}

	/// Stops drawing frames nobody sees.
	func detach() {
		track?.remove(lens)
		track = nil
	}
}
