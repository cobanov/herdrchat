# sshj + bouncycastle reflect heavily; keep them intact for release builds.
-keep class net.schmizz.** { *; }
-keep class org.bouncycastle.** { *; }
-keep class net.i2p.crypto.** { *; }
-dontwarn org.slf4j.**
-dontwarn org.bouncycastle.**
-dontwarn net.schmizz.**
# kotlinx.serialization generated serializers.
-keepclassmembers class ** {
    *** Companion;
}
-keepclasseswithmembers class ** {
    kotlinx.serialization.KSerializer serializer(...);
}
