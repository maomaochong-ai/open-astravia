package org.vetta.android.ui.work

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import kotlin.test.Test
import kotlin.test.assertEquals

class ZoomStateTest {
    private val view = Size(400f, 800f)

    @Test
    fun zoomsAboutThePinchAndKeepsThePictureOverTheView() {
        val zoom = ZoomState()
        zoom.transform(2f, Offset(100f, 400f), Offset.Zero, view)
        assertEquals(2f, zoom.scale)
        assertEquals(Offset(100f, 0f), zoom.offset, "the point under the fingers stays put")

        zoom.transform(1f, Offset.Zero, Offset(-1000f, 5000f), view)
        assertEquals(Offset(-200f, 400f), zoom.offset, "moved no further than the edges")

        zoom.transform(10f, Offset(200f, 400f), Offset.Zero, view)
        assertEquals(5f, zoom.scale, "no closer than the limit")
        zoom.transform(0.01f, Offset(200f, 400f), Offset.Zero, view)
        assertEquals(1f, zoom.scale, "no smaller than fitting")
        assertEquals(Offset.Zero, zoom.offset)
    }

    @Test
    fun doubleTapZoomsInAndBackOut() {
        val zoom = ZoomState()
        zoom.toggle(Offset(200f, 400f), view)
        assertEquals(2.5f, zoom.scale)
        zoom.toggle(Offset(10f, 10f), view)
        assertEquals(1f, zoom.scale)
        assertEquals(Offset.Zero, zoom.offset)
    }
}
