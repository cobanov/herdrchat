package dev.herdr.herdrchat

import android.app.Application
import org.bouncycastle.jce.provider.BouncyCastleProvider
import java.security.Security

/**
 * Android ships a stripped-down "BC" security provider that sshj can't use for
 * modern ciphers/keys. Replace it with the full BouncyCastle at startup so SSH
 * (ed25519 + RSA) works.
 */
class HerdrChatApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        Security.removeProvider("BC")
        Security.addProvider(BouncyCastleProvider())
    }
}
