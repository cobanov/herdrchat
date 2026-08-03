package dev.herdr.herdrchat.core.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

/** Semantic agent state reported by herdr. Unknown values decode to [UNKNOWN]
 *  so a newer herdr can't break the app. */
@Serializable(with = AgentStatusSerializer::class)
enum class AgentStatus(val raw: String) {
    IDLE("idle"),
    WORKING("working"),
    BLOCKED("blocked"),
    DONE("done"),
    UNKNOWN("unknown");

    /** Whether this status needs the user's attention (drives the unread badge). */
    val needsAttention: Boolean get() = this == BLOCKED

    companion object {
        fun from(raw: String): AgentStatus = entries.firstOrNull { it.raw == raw } ?: UNKNOWN
    }
}

object AgentStatusSerializer : KSerializer<AgentStatus> {
    override val descriptor = PrimitiveSerialDescriptor("AgentStatus", PrimitiveKind.STRING)
    override fun serialize(encoder: Encoder, value: AgentStatus) = encoder.encodeString(value.raw)
    override fun deserialize(decoder: Decoder): AgentStatus = AgentStatus.from(decoder.decodeString())
}
