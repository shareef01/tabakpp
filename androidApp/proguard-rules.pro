# Firebase rules
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**

# Kotlin Serialization rules
-keepattributes *Annotation*, EnclosingMethod, Signature
-keepclassmembers class ** {
    *** Companion;
    *** companion;
}
-keep class kotlinx.serialization.json.** { *; }
-keepclassmembers class * {
    @kotlinx.serialization.Serializable *;
}
-keepclassmembers class * {
    @kotlinx.serialization.SerialName *;
}

# GitLive Firebase rules
-keep class dev.gitlive.firebase.** { *; }
-dontwarn dev.gitlive.firebase.**

# Firebase App Check
-keep class com.google.firebase.appcheck.** { *; }
-dontwarn com.google.firebase.appcheck.**
