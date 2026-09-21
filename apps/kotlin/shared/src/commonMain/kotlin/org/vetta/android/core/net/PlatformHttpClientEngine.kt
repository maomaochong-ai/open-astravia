package org.vetta.android.core.net

import io.ktor.client.engine.HttpClientEngineFactory

expect fun platformHttpClientEngine(): HttpClientEngineFactory<*>
