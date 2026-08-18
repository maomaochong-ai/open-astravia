package org.vetta.android.ui.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeContentPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import org.vetta.android.domain.error.UiError
import org.vetta.android.ui.components.PrimaryBlackButton
import org.vetta.android.ui.components.VettaErrorBanner
import org.vetta.android.ui.i18n.Str
import org.vetta.android.ui.theme.vettaExtra

@Composable
fun WelcomeScreen(
    onLogin: () -> Unit,
    onServerSetup: () -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .safeContentPadding()
                .padding(horizontal = 24.dp)
                .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(Str.welcomeTitle, style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(12.dp))
        Text(
            Str.welcomeSubtitle,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.vettaExtra.secondaryText,
        )
        Spacer(Modifier.height(28.dp))
        FeatureRow(Icons.Default.Computer, Str.featureDesktop, Str.featureDesktopDesc)
        FeatureRow(Icons.Default.Cloud, Str.featureCloud, Str.featureCloudDesc)
        FeatureRow(Icons.Default.Schedule, Str.featureStatus, Str.featureStatusDesc)
        FeatureRow(Icons.Default.Lock, Str.featureSecure, Str.featureSecureDesc)
        Spacer(Modifier.height(28.dp))
        PrimaryBlackButton(text = Str.getStarted, onClick = onLogin)
        TextButton(onClick = onServerSetup, modifier = Modifier.align(Alignment.End)) {
            Text(Str.advancedServer, color = MaterialTheme.vettaExtra.secondaryText)
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun FeatureRow(
    icon: ImageVector,
    title: String,
    desc: String,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(12.dp))
        Column {
            Text(title, style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(2.dp))
            Text(desc, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LoginScreen(
    loading: Boolean,
    error: UiError?,
    loginModeEmail: Boolean,
    passwordVisible: Boolean,
    serverUrl: String,
    onToggleMode: (Boolean) -> Unit,
    onTogglePassword: (Boolean) -> Unit,
    onLogin: (account: String, password: String) -> Unit,
    onServerSetup: () -> Unit,
    onClearError: () -> Unit,
    onBack: () -> Unit,
) {
    var account by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    Scaffold(
        containerColor = MaterialTheme.vettaExtra.pageBackground,
        topBar = {
            TopAppBar(
                title = { Text(Str.loginTitle, style = MaterialTheme.typography.titleMedium) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = Str.back)
                    }
                },
                colors =
                    TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.vettaExtra.pageBackground,
                    ),
            )
        },
    ) { padding ->
        Column(
            modifier =
                Modifier
                    .padding(padding)
                    .fillMaxSize()
                    .imePadding()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 24.dp, vertical = 12.dp),
        ) {
            Text(
                Str.loginSubtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.vettaExtra.secondaryText,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                "${Str.serverHint}：$serverUrl",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.vettaExtra.secondaryText,
            )
            Spacer(Modifier.height(16.dp))
            if (error != null) {
                VettaErrorBanner(error = error, onDismiss = onClearError)
                Spacer(Modifier.height(12.dp))
            }
            OutlinedTextField(
                value = account,
                onValueChange = { account = it },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                label = { Text(if (loginModeEmail) Str.email else Str.account) },
                keyboardOptions =
                    KeyboardOptions(
                        keyboardType = if (loginModeEmail) KeyboardType.Email else KeyboardType.Text,
                        imeAction = ImeAction.Next,
                    ),
                shape = MaterialTheme.shapes.medium,
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                label = { Text(Str.password) },
                visualTransformation =
                    if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                trailingIcon = {
                    IconButton(onClick = { onTogglePassword(!passwordVisible) }) {
                        Icon(
                            if (passwordVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                            contentDescription =
                                if (passwordVisible) Str.hidePassword else Str.showPassword,
                        )
                    }
                },
                keyboardOptions =
                    KeyboardOptions(
                        keyboardType = KeyboardType.Password,
                        imeAction = ImeAction.Done,
                    ),
                keyboardActions =
                    KeyboardActions(
                        onDone = {
                            if (!loading && account.isNotBlank() && password.isNotBlank()) {
                                onLogin(account.trim(), password)
                            }
                        },
                    ),
                shape = MaterialTheme.shapes.medium,
            )
            Spacer(Modifier.height(20.dp))
            PrimaryBlackButton(
                text = if (loading) Str.loggingIn else Str.loginAction,
                onClick = { onLogin(account.trim(), password) },
                enabled = !loading && account.isNotBlank() && password.isNotBlank(),
            )
            TextButton(
                onClick = { onToggleMode(!loginModeEmail) },
                modifier = Modifier.align(Alignment.End),
            ) {
                Text(if (loginModeEmail) Str.useAccountLogin else Str.useEmailLogin)
            }
            TextButton(
                onClick = onServerSetup,
                modifier = Modifier.align(Alignment.End),
            ) {
                Text(Str.advancedServer)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ServerSetupScreen(
    serverUrl: String,
    onSave: (String) -> Unit,
    onBack: () -> Unit,
) {
    var value by remember(serverUrl) { mutableStateOf(serverUrl) }
    Scaffold(
        containerColor = MaterialTheme.vettaExtra.pageBackground,
        topBar = {
            TopAppBar(
                title = { Text(Str.server, style = MaterialTheme.typography.titleMedium) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = Str.back)
                    }
                },
                colors =
                    TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.vettaExtra.pageBackground,
                    ),
            )
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .padding(24.dp)
                .fillMaxSize(),
        ) {
            Text(
                Str.serverUrlHint,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.vettaExtra.secondaryText,
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = value,
                onValueChange = { value = it },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                label = { Text(Str.serverUrl) },
                shape = MaterialTheme.shapes.medium,
            )
            Spacer(Modifier.height(20.dp))
            PrimaryBlackButton(
                text = Str.save,
                onClick = { onSave(value) },
                enabled = value.isNotBlank(),
            )
        }
    }
}
