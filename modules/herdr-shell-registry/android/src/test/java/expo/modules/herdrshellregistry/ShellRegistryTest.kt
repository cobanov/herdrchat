package expo.modules.herdrshellregistry

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ShellRegistryTest {
  private fun registry() = ShellRegistry { it.run() }
  private fun bytes(text: String) = text.toByteArray()

  @Test fun outputBeforeTheViewIsHandedOverOnAttach() {
    val registry = registry()
    registry.register("t1", ShellRegistry.Input({}, { _, _ -> }))
    registry.deliver("t1", bytes("first "))
    registry.deliver("t1", bytes("screen"))
    val seen = StringBuilder()
    registry.attach("t1") { seen.append(String(it)) }
    registry.deliver("t1", bytes("!"))
    assertEquals("first screen!", seen.toString())
  }

  @Test fun outputAfterForgetIsNotHeld() {
    val registry = registry()
    registry.register("t1", ShellRegistry.Input({}, { _, _ -> }))
    registry.forget("t1")
    registry.deliver("t1", bytes("late"))
    val seen = StringBuilder()
    registry.attach("t1") { seen.append(String(it)) }
    assertEquals("", seen.toString())
  }

  @Test fun theBacklogKeepsOnlyTheNewestBytes() {
    val registry = registry()
    registry.register("t1", ShellRegistry.Input({}, { _, _ -> }))
    registry.deliver("t1", ByteArray(ShellRegistry.MAX_BACKLOG_BYTES) { 'a'.code.toByte() })
    registry.deliver("t1", bytes("z"))
    var held = ByteArray(0)
    registry.attach("t1") { held = it }
    assertEquals(ShellRegistry.MAX_BACKLOG_BYTES, held.size)
    assertEquals('z'.code.toByte(), held.last())
  }

  @Test fun anOldTokenCannotDetachItsSuccessor() {
    val registry = registry()
    registry.register("t1", ShellRegistry.Input({}, { _, _ -> }))
    val old = registry.attach("t1") {}
    val seen = StringBuilder()
    registry.attach("t1") { seen.append(String(it)) }
    registry.detach("t1", old)
    registry.deliver("t1", bytes("still here"))
    assertEquals("still here", seen.toString())
  }

  @Test fun inputAndSizeReachOnlyAnOpenShell() {
    val registry = registry()
    val written = StringBuilder()
    var size = 0 to 0
    registry.register("t1", ShellRegistry.Input({ written.append(String(it)) }, { c, r -> size = c to r }))
    assertTrue(registry.send("t1", bytes("ls")))
    assertTrue(registry.resize("t1", 80, 24))
    assertFalse(registry.resize("t1", 0, 24))
    assertEquals("ls", written.toString())
    assertEquals(80 to 24, size)
    registry.unregister("t1")
    assertFalse(registry.send("t1", bytes("x")))
    assertFalse(registry.isOpen("t1"))
  }

  @Test fun theEchoShellCooksReturnAndDelete() {
    assertArrayEquals(bytes("ls\r\n"), EchoShell.cooked(bytes("ls\r")))
    assertArrayEquals(byteArrayOf(0x08, 0x20, 0x08), EchoShell.cooked(byteArrayOf(0x7F)))
  }
}
