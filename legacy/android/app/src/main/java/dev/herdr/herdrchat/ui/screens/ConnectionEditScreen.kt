package dev.herdr.herdrchat.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Error
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.herdr.herdrchat.core.model.HerdrException
import dev.herdr.herdrchat.ui.connection.ConnectionStore
import dev.herdr.herdrchat.ui.connection.ServerConnection
import dev.herdr.herdrchat.ui.theme.HerdrColors
import kotlinx.coroutines.launch

private sealed interface TestState {
    data object Idle : TestState
    data object Testing : TestState
    data object Ok : TestState
    data class Fail(val message: String) : TestState
}

/** Add or edit a herdr host. The secret is written to encrypted storage on save;
 *  it is never shown pre-filled when editing. A connection must pass a live test
 *  before it can be saved. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConnectionEditScreen(
    store: ConnectionStore,
    existing: ServerConnection?,
    onDone: () -> Unit,
) {
    var name by remember { mutableStateOf(existing?.name ?: "") }
    var host by remember { mutableStateOf(existing?.host ?: "") }
    var port by remember { mutableStateOf((existing?.port ?: 22).toString()) }
    var username by remember { mutableStateOf(existing?.username ?: "") }
    var authKind by remember { mutableStateOf(existing?.authKind ?: ServerConnection.AuthKind.PRIVATE_KEY) }
    var secret by remember { mutableStateOf("") }
    var herdrPath by remember { mutableStateOf(existing?.herdrPath ?: "herdr") }
    var testState by remember { mutableStateOf<TestState>(TestState.Idle) }
    var testHerdrMissing by remember { mutableStateOf(false) }
    var installing by remember { mutableStateOf(false) }

    val scope = rememberCoroutineScope()
    val valid = name.isNotBlank() && host.isNotBlank() && username.isNotBlank() && port.toIntOrNull() != null

    // Any change to connection-relevant fields invalidates a prior test.
    LaunchedEffect(host, port, username, authKind, secret, herdrPath) { testState = TestState.Idle }

    fun makeClient() = store.makeTestClient(
        host = host.trim(),
        port = port.toIntOrNull() ?: 22,
        username = username.trim(),
        authKind = authKind,
        secret = secret,
        herdrPath = herdrPath,
        fallbackId = existing?.id,
    )

    fun test() {
        testState = TestState.Testing
        testHerdrMissing = false
        val client = makeClient()
        scope.launch {
            testState = try {
                client.ping()
                TestState.Ok
            } catch (e: Exception) {
                val herdrError = e as? HerdrException
                testHerdrMissing = herdrError?.code == "herdr_not_found"
                TestState.Fail(herdrError?.message ?: e.message ?: e.toString())
            }
        }
    }

    // Install herdr on the host, then re-test so the connection can be saved.
    fun installHerdr() {
        installing = true
        val client = makeClient()
        scope.launch {
            try {
                client.installHerdr()
                installing = false
                test()
            } catch (e: Exception) {
                installing = false
                testState = TestState.Fail((e as? HerdrException)?.message ?: e.message ?: e.toString())
            }
        }
    }

    fun save() {
        val connection = ServerConnection(
            id = existing?.id ?: java.util.UUID.randomUUID().toString(),
            name = name.trim(),
            host = host.trim(),
            port = port.toIntOrNull() ?: 22,
            username = username.trim(),
            authKind = authKind,
            herdrPath = herdrPath.ifBlank { "herdr" },
        )
        store.save(connection, secret.ifEmpty { null })
        onDone()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (existing == null) "New server" else "Edit") },
                navigationIcon = {
                    IconButton(onClick = onDone) { Icon(Icons.Filled.Close, contentDescription = "Cancel") }
                },
                actions = {
                    TextButton(onClick = { save() }, enabled = valid && testState is TestState.Ok) {
                        Text("Save", color = if (valid && testState is TestState.Ok) Color.White else Color.White.copy(alpha = 0.5f))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = HerdrColors.headerGreen,
                    titleContentColor = Color.White,
                    navigationIconContentColor = Color.White,
                ),
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SectionLabel("Server")
            OutlinedTextField(name, { name = it }, label = { Text("Name (e.g. nuc)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(host, { host = it }, label = { Text("Host / Tailscale address") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(
                port, { port = it }, label = { Text("Port") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(username, { username = it }, label = { Text("Username") }, singleLine = true, modifier = Modifier.fillMaxWidth())

            SectionLabel("Authentication")
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                SegmentedButton(
                    selected = authKind == ServerConnection.AuthKind.PRIVATE_KEY,
                    onClick = { authKind = ServerConnection.AuthKind.PRIVATE_KEY },
                    shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2),
                ) { Text("Private key") }
                SegmentedButton(
                    selected = authKind == ServerConnection.AuthKind.PASSWORD,
                    onClick = { authKind = ServerConnection.AuthKind.PASSWORD },
                    shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2),
                ) { Text("Password") }
            }

            if (authKind == ServerConnection.AuthKind.PRIVATE_KEY) {
                Text(
                    "Paste your OpenSSH private key (id_ed25519):",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value = secret,
                    onValueChange = { secret = it },
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 140.dp),
                    textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace, fontSize = 12.sp),
                )
            } else {
                OutlinedTextField(
                    value = secret,
                    onValueChange = { secret = it },
                    label = { Text("Password") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (existing != null) {
                Text(
                    "Leave blank to keep the existing secret.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            SectionLabel("Advanced")
            OutlinedTextField(herdrPath, { herdrPath = it }, label = { Text("herdr path") }, singleLine = true, modifier = Modifier.fillMaxWidth())

            // Test-before-save.
            OutlinedButton(
                onClick = { test() },
                enabled = valid && testState !is TestState.Testing,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (testState is TestState.Testing) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                    Text("  Testing…")
                } else {
                    Icon(Icons.Filled.Bolt, contentDescription = null)
                    Text("  Test connection")
                }
            }
            TestResult(
                state = testState,
                canInstallHerdr = testHerdrMissing,
                installing = installing,
                onInstall = { installHerdr() },
            )
            Text(
                "Verify the connection works before saving.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun TestResult(
    state: TestState,
    canInstallHerdr: Boolean = false,
    installing: Boolean = false,
    onInstall: () -> Unit = {},
) {
    when (state) {
        is TestState.Ok -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = HerdrColors.accent)
            Text("Connection successful", color = HerdrColors.accent, style = MaterialTheme.typography.bodyMedium)
        }
        is TestState.Fail -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Filled.Error, contentDescription = null, tint = Color(0xFFF15C6D))
                Column {
                    Text("Connection failed", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = Color(0xFFF15C6D))
                    Text(state.message, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (canInstallHerdr) {
                Button(onClick = onInstall, enabled = !installing) {
                    if (installing) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = Color.White)
                        Text("  Installing herdr…")
                    } else {
                        Text("Install herdr on the host")
                    }
                }
            }
        }
        else -> {}
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(top = 8.dp),
    )
}
