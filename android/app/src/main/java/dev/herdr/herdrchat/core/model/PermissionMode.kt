package dev.herdr.herdrchat.core.model

/**
 * How much Claude asks before acting, chosen when a chat is started.
 *
 * This matters more from a phone than from a desk: the default mode stops for
 * confirmation on essentially every tool call, and answering those one tap at a time
 * over SSH is the opposite of why you'd drive an agent from your pocket. So new chats
 * default to [BYPASS] — the mode you'd pick by hand anyway — while the stricter modes
 * stay one tap away.
 */
enum class PermissionMode(
    /** The value passed to `claude --permission-mode`. */
    val flagValue: String,
    val title: String,
    val detail: String,
) {
    BYPASS(
        "bypassPermissions",
        "Full access",
        "Runs tools without asking. Best from a phone.",
    ),
    ACCEPT_EDITS(
        "acceptEdits",
        "Auto-accept edits",
        "Edits apply automatically; other tools ask.",
    ),
    MANUAL(
        "manual",
        "Ask every time",
        "Confirms every tool call. Claude's default.",
    ),
    PLAN(
        "plan",
        "Plan only",
        "Proposes a plan and changes nothing until approved.",
    ),
    ;

    /**
     * The shell command that launches an agent in this mode.
     *
     * [MANUAL] is spelled out rather than left implicit: the host's own settings may
     * set a different default, and a chat started as "Ask every time" must actually ask.
     */
    fun launchCommand(executable: String = "claude"): String =
        "$executable --permission-mode $flagValue"

    companion object {
        fun fromFlag(raw: String?): PermissionMode? =
            entries.firstOrNull { it.flagValue == raw }
    }
}
