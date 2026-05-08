package cl.fixaccess.operator

import android.graphics.Bitmap
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.CookieHandler
import java.net.CookieManager
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    CookieHandler.setDefault(CookieManager())

    setContent {
      MaterialTheme {
        Surface(modifier = Modifier.fillMaxSize(), color = Color(0xFF08131D)) {
          FixAccessOperatorApp()
        }
      }
    }
  }
}

private data class AccessDecision(
  val severity: String,
  val title: String,
  val message: String,
  val rut: String,
  val personName: String,
  val company: String,
  val ticketCode: String,
  val statusLabel: String,
  val hostName: String,
  val scheduleLabel: String,
  val actionLabel: String,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FixAccessOperatorApp() {
  val scope = rememberCoroutineScope()
  var serverUrl by rememberSaveable { mutableStateOf("http://10.0.2.2:2000") }
  var username by rememberSaveable { mutableStateOf("operador") }
  var password by rememberSaveable { mutableStateOf("operador123") }
  var rut by rememberSaveable { mutableStateOf("") }
  var statusMessage by rememberSaveable { mutableStateOf("Conecta con el backend y luego valida por RUT o foto del carnet.") }
  var lastOcrText by rememberSaveable { mutableStateOf("") }
  var isLoggedIn by rememberSaveable { mutableStateOf(false) }
  var isBusy by rememberSaveable { mutableStateOf(false) }
  var accessDecision by remember { mutableStateOf<AccessDecision?>(null) }

  val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bitmap ->
    if (bitmap == null) {
      statusMessage = "No se obtuvo una imagen desde la camara."
      return@rememberLauncherForActivityResult
    }

    scope.launch {
      isBusy = true
      try {
        val recognizedText = recognizeText(bitmap)
        lastOcrText = recognizedText
        val extractedRut = extractRutFromText(recognizedText)
        if (extractedRut.isBlank()) {
          statusMessage = "La OCR no encontro un RUT valido en la foto del carnet."
        } else {
          rut = extractedRut
          accessDecision = checkAccess(serverUrl, extractedRut)
          statusMessage = "RUT detectado desde camara y consultado correctamente."
        }
      } catch (error: Exception) {
        statusMessage = error.message ?: "No fue posible procesar la imagen."
      } finally {
        isBusy = false
      }
    }
  }

  Scaffold(
    topBar = {
      TopAppBar(
        title = {
          Column {
            Text("Fix Access Operador", fontWeight = FontWeight.Bold)
            Text("Cliente Android inicial con OCR de carnet", style = MaterialTheme.typography.labelMedium)
          }
        }
      )
    },
    containerColor = Color(0xFF08131D)
  ) { innerPadding ->
    Column(
      modifier = Modifier
        .fillMaxSize()
        .padding(innerPadding)
        .padding(16.dp)
        .verticalScroll(rememberScrollState()),
      verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
      Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF10202C))) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
          Text("Conexion", style = MaterialTheme.typography.titleMedium, color = Color.White)
          OutlinedTextField(
            value = serverUrl,
            onValueChange = { serverUrl = it },
            label = { Text("URL backend") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
          )
          OutlinedTextField(
            value = username,
            onValueChange = { username = it },
            label = { Text("Usuario") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
          )
          OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("Contrasena") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            visualTransformation = PasswordVisualTransformation()
          )
          Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(
              enabled = !isBusy,
              onClick = {
                scope.launch {
                  isBusy = true
                  try {
                    login(serverUrl, username, password)
                    isLoggedIn = true
                    statusMessage = "Sesion iniciada correctamente."
                  } catch (error: Exception) {
                    isLoggedIn = false
                    statusMessage = error.message ?: "No fue posible iniciar sesion."
                  } finally {
                    isBusy = false
                  }
                }
              }
            ) {
              Text(if (isLoggedIn) "Sesion activa" else "Iniciar sesion")
            }
            TextButton(onClick = {
              username = "operador"
              password = "operador123"
            }) {
              Text("Usar demo")
            }
          }
        }
      }

      Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF10202C))) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
          Text("Validacion de acceso", style = MaterialTheme.typography.titleMedium, color = Color.White)
          OutlinedTextField(
            value = rut,
            onValueChange = { rut = it },
            label = { Text("RUT") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
          )
          Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(
              enabled = isLoggedIn && !isBusy,
              onClick = {
                scope.launch {
                  isBusy = true
                  try {
                    accessDecision = checkAccess(serverUrl, rut)
                    statusMessage = "Consulta realizada correctamente."
                  } catch (error: Exception) {
                    statusMessage = error.message ?: "No fue posible consultar el acceso."
                  } finally {
                    isBusy = false
                  }
                }
              }
            ) {
              Text("Validar por RUT")
            }
            Button(
              enabled = isLoggedIn && !isBusy,
              onClick = {
                cameraLauncher.launch(null)
              }
            ) {
              Text("Tomar foto del carnet")
            }
          }
          Text(statusMessage, color = Color(0xFFD8EAF6))
          if (lastOcrText.isNotBlank()) {
            Text("OCR reciente: $lastOcrText", color = Color(0xFFA9BCCD))
          }
        }
      }

      accessDecision?.let { decision ->
        val tone = when (decision.severity) {
          "allowed" -> Color(0xFF1F4A2A)
          "warning" -> Color(0xFF5A4318)
          else -> Color(0xFF5A1F28)
        }
        Card(
          shape = RoundedCornerShape(20.dp),
          colors = CardDefaults.cardColors(containerColor = tone)
        ) {
          Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(decision.title, style = MaterialTheme.typography.titleLarge, color = Color.White)
            Text(decision.message, color = Color(0xFFE7F3FA))
            Text("RUT: ${decision.rut}", color = Color.White)
            Text("Persona: ${decision.personName}", color = Color.White)
            Text("Empresa: ${decision.company}", color = Color.White)
            Text("Ticket: ${decision.ticketCode}", color = Color.White)
            Text("Estado: ${decision.statusLabel}", color = Color.White)
            Text("Responsable: ${decision.hostName}", color = Color.White)
            Text("Horario: ${decision.scheduleLabel}", color = Color.White)
            Text("Accion sugerida: ${decision.actionLabel}", fontWeight = FontWeight.Bold, color = Color.White)
          }
        }
      }
    }
  }
}

private suspend fun login(serverUrl: String, username: String, password: String) = withContext(Dispatchers.IO) {
  val baseUrl = normalizeBaseUrl(serverUrl)
  val csrfToken = fetchCsrfToken(baseUrl)
  val payload = buildFormBody(
    "username" to username,
    "password" to password,
    "csrfToken" to csrfToken,
  )

  val connection = openConnection("$baseUrl/login", "POST")
  connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
  connection.doOutput = true
  OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { writer ->
    writer.write(payload)
  }

  val statusCode = connection.responseCode
  val location = connection.getHeaderField("Location") ?: ""
  connection.disconnect()

  if (statusCode !in 300..399 || !location.contains("/dashboard")) {
    throw IllegalStateException("No fue posible iniciar sesion con el backend configurado.")
  }
}

private suspend fun checkAccess(serverUrl: String, rut: String): AccessDecision = withContext(Dispatchers.IO) {
  val baseUrl = normalizeBaseUrl(serverUrl)
  val connection = openConnection(
    "$baseUrl/api/access/check?rut=${urlEncode(rut)}&source=${urlEncode("CARD_SCAN")}",
    "GET"
  )
  val statusCode = connection.responseCode
  val rawBody = readResponseBody(connection)
  connection.disconnect()

  if (statusCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
    throw IllegalStateException("La sesion no esta autenticada. Inicia sesion nuevamente.")
  }

  if (statusCode !in 200..299) {
    throw IllegalStateException("El backend rechazo la consulta de acceso.")
  }

  val json = JSONObject(rawBody)
  AccessDecision(
    severity = json.optString("severity", "warning"),
    title = json.optString("title", "Sin titulo"),
    message = json.optString("message", ""),
    rut = json.optString("rut", ""),
    personName = json.optString("personName", ""),
    company = json.optString("company", ""),
    ticketCode = json.optString("ticketCode", ""),
    statusLabel = json.optString("statusLabel", ""),
    hostName = json.optString("hostName", ""),
    scheduleLabel = json.optString("scheduleLabel", ""),
    actionLabel = json.optString("actionLabel", ""),
  )
}

private suspend fun recognizeText(bitmap: Bitmap): String = suspendCoroutine { continuation ->
  val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
  val image = InputImage.fromBitmap(bitmap, 0)
  recognizer.process(image)
    .addOnSuccessListener { result ->
      continuation.resume(result.text)
      recognizer.close()
    }
    .addOnFailureListener { error ->
      continuation.resumeWithException(error)
      recognizer.close()
    }
}

private fun normalizeBaseUrl(value: String): String {
  return value.trim().trimEnd('/')
}

private fun buildFormBody(vararg entries: Pair<String, String>): String {
  return entries.joinToString("&") { (key, value) ->
    "${urlEncode(key)}=${urlEncode(value)}"
  }
}

private fun urlEncode(value: String): String {
  return URLEncoder.encode(value, Charsets.UTF_8.name())
}

private fun fetchCsrfToken(baseUrl: String): String {
  val connection = openConnection("$baseUrl/", "GET")
  val body = readResponseBody(connection)
  connection.disconnect()

  val match = Regex("""name="csrf-token" content="([^"]+)"""").find(body)
  return match?.groupValues?.getOrNull(1)
    ?: throw IllegalStateException("El login web no expuso un token CSRF.")
}

private fun openConnection(url: String, method: String): HttpURLConnection {
  return (URL(url).openConnection() as HttpURLConnection).apply {
    requestMethod = method
    instanceFollowRedirects = false
    connectTimeout = 12000
    readTimeout = 12000
    setRequestProperty("Accept", "application/json,text/html;q=0.9,*/*;q=0.8")
    setRequestProperty("User-Agent", "FixAccessOperator/0.1")
  }
}

private fun readResponseBody(connection: HttpURLConnection): String {
  val stream = try {
    connection.inputStream
  } catch (_: Exception) {
    connection.errorStream
  } ?: return ""

  return stream.bufferedReader().use { it.readText() }
}

private fun extractRutFromText(text: String): String {
  val direct = Regex("""\b\d{1,2}\.?\d{3}\.?\d{3}-?[0-9Kk]\b""").find(text)?.value
  if (!direct.isNullOrBlank()) {
    return formatRut(direct)
  }

  val compact = Regex("""\b\d{7,8}[0-9Kk]\b""").find(text)?.value
  if (!compact.isNullOrBlank()) {
    return formatRut(compact)
  }

  return ""
}

private fun formatRut(value: String): String {
  val normalized = value
    .trim()
    .replace(".", "")
    .replace("-", "")
    .uppercase()

  if (normalized.length < 2) {
    return normalized
  }

  val body = normalized.dropLast(1)
  val verifier = normalized.takeLast(1)
  val reversed = body.reversed()
  val chunks = reversed.chunked(3).map { it.reversed() }.reversed()
  return "${chunks.joinToString(".")}-$verifier"
}
