import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.androidApplication)
    alias(libs.plugins.composeCompiler)
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_11
    }
}
dependencies {
    implementation(project(":shared"))

    implementation(libs.androidx.activity.compose)

    implementation(libs.compose.uiToolingPreview)
    debugImplementation(libs.compose.uiTooling)
}

android {
    namespace = "org.vetta.android"
    compileSdk = libs.versions.android.compileSdk.get().toInt()

    defaultConfig {
        applicationId = "org.vetta.android"
        minSdk = libs.versions.android.minSdk.get().toInt()
        targetSdk = libs.versions.android.targetSdk.get().toInt()
        versionCode = providers.gradleProperty("vettaAndroidVersionCode").get().toInt()
        versionName = providers.gradleProperty("vettaAndroidVersionName").get()
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
    signingConfigs {
        create("release") {
            storeFile = providers.environmentVariable("VETTA_ANDROID_KEYSTORE_PATH").orNull?.let { file(it) }
            storePassword = providers.environmentVariable("VETTA_ANDROID_KEYSTORE_PASSWORD").orNull
            keyAlias = providers.environmentVariable("VETTA_ANDROID_KEY_ALIAS").orNull
            keyPassword = providers.environmentVariable("VETTA_ANDROID_KEY_PASSWORD").orNull
        }
    }
    splits {
        abi {
            // CI produces the arm64 installer; local Debug builds stay universal.
            isEnable = providers.gradleProperty("vettaSplitApks").orElse("false").get().toBooleanStrict()
            reset()
            include(providers.gradleProperty("vettaAndroidAbi").get())
            isUniversalApk = false
        }
    }
    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        compose = true
    }
}

// Fail before packaging; an unsigned or freshly debug-signed APK cannot update the published app.
val releaseConfiguration = listOf(
    "VETTA_ANDROID_KEYSTORE_PATH",
    "VETTA_ANDROID_KEYSTORE_PASSWORD", "VETTA_ANDROID_KEY_ALIAS", "VETTA_ANDROID_KEY_PASSWORD"
).associateWith { providers.environmentVariable(it).orNull }
val validateVettaReleaseSigning = tasks.register("validateVettaReleaseSigning") {
    doLast {
        val missing = releaseConfiguration.filterValues { it.isNullOrEmpty() }.keys
        require(missing.isEmpty()) { "Missing Android release configuration: ${missing.joinToString()}" }
    }
}
tasks.matching { it.name == "preReleaseBuild" }.configureEach {
    dependsOn(validateVettaReleaseSigning)
}
