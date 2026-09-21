package org.vetta.android

interface Platform {
    val name: String
}

expect fun getPlatform(): Platform