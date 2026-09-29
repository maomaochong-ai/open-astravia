package org.vetta.android.ui.work

import android.webkit.WebView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.viewinterop.AndroidView

@Composable
actual fun HtmlPreview(html: String, modifier: Modifier) {
    // Loaded once per page, so recomposing does not reload it and lose the scroll.
    key(html) {
        AndroidView(
            modifier = modifier.testTag("files.html"),
            factory = { context ->
                WebView(context).apply {
                    // A static look at the page: no scripts, nothing fetched, no file access.
                    settings.javaScriptEnabled = false
                    settings.blockNetworkLoads = true
                    settings.allowFileAccess = false
                    settings.allowContentAccess = false
                    loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
                }
            },
            onRelease = WebView::destroy,
        )
    }
}
