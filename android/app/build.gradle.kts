import org.gradle.api.DefaultTask
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.tasks.CacheableTask
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "com.cs2balance.assistant.mvp"
    compileSdk = 37
    defaultConfig {
        applicationId = "com.cs2balance.assistant.mvp"
        minSdk = 26
        targetSdk = 37
        versionCode = 2
        versionName = "0.1.1"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    lint { abortOnError = true; warningsAsErrors = true }
    testOptions {
        managedDevices {
            localDevices {
                create("pixel2api35") {
                    device = "Pixel 2"
                    apiLevel = 35
                    systemImageSource = "aosp"
                }
            }
        }
    }
    sourceSets {
        getByName("test").resources.directories.add(rootProject.file("../fixtures").absolutePath)
    }
}
kotlin { jvmToolchain(17) }

@CacheableTask
abstract class GenerateCandidateAssets : DefaultTask() {
    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val inputFile: RegularFileProperty

    @get:OutputDirectory
    abstract val outputDirectory: DirectoryProperty

    @TaskAction
    fun generate() {
        val directory = outputDirectory.get().asFile
        if (!directory.isDirectory && !directory.mkdirs()) error("Cannot create candidate asset directory")
        inputFile.get().asFile.copyTo(directory.resolve("candidate-pool.json"), overwrite = true)
    }
}

androidComponents.onVariants { variant ->
    val capitalized = variant.name.replaceFirstChar { it.uppercaseChar() }
    val assetTask = tasks.register<GenerateCandidateAssets>("generate${capitalized}CandidateAssets") {
        inputFile.set(rootProject.layout.projectDirectory.file("../fixtures/candidate-pool.json"))
    }
    val assets = requireNotNull(variant.sources.assets) { "Asset sources required for built-in candidates" }
    assets.addGeneratedSourceDirectory(assetTask, GenerateCandidateAssets::outputDirectory)
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
    implementation("org.brotli:dec:0.1.2")
    implementation("com.github.luben:zstd-jni:1.5.7-21@aar")
    testImplementation("com.github.luben:zstd-jni:1.5.7-21")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
}
