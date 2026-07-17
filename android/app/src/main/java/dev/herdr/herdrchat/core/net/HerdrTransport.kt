package dev.herdr.herdrchat.core.net

import kotlinx.coroutines.flow.Flow

/**
 * How commands reach a machine that runs herdr. Everything HerdrChat does is a
 * shell command on that host: `herdr <subcommand>` for control, `tail`/`ls`/`cat`
 * for reading Claude transcripts. The app uses an SSH-over-Tailscale transport.
 */
interface HerdrTransport {
    /** Run a shell command, returning stdout. Throws on non-zero exit. */
    suspend fun shell(command: String): String

    /** Run a long-lived command (e.g. `tail -f`) and stream its stdout lines. */
    fun streamLines(command: String): Flow<String>
}

/** Run an argv without a shell interpreting it, by quoting each element. */
suspend fun HerdrTransport.run(argv: List<String>): String =
    shell(argv.joinToString(" ") { ShellQuoting.quote(it) })

/** POSIX single-quote quoting so arbitrary user text is safe inside a command. */
object ShellQuoting {
    fun quote(argument: String): String = "'" + argument.replace("'", "'\\''") + "'"
}
