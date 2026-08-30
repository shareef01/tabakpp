rootProject.name = "tabakpp"
include(":shared")
include(":composeApp")
include(":androidApp")

pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}
