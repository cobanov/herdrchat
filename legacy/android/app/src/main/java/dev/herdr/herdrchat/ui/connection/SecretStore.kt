package dev.herdr.herdrchat.ui.connection

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** Encrypted store for connection secrets (SSH password or private key), keyed by
 *  the connection id. Backed by the Android Keystore — the Keychain equivalent. */
class SecretStore(context: Context) {

    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "herdrchat_secrets",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun set(account: String, value: String) {
        prefs.edit().putString(account, value).apply()
    }

    fun get(account: String): String? = prefs.getString(account, null)

    fun delete(account: String) {
        prefs.edit().remove(account).apply()
    }
}
