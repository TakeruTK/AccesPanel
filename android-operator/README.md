# Cliente Android Operador

Proyecto Android nativo inicial para el rol `operador`.

Incluye:
- Login contra el backend web de `Fix Access`.
- Uso de sesion web real con cookie.
- Captura de foto del carnet con camara del dispositivo.
- OCR con ML Kit para extraer el RUT desde la imagen.
- Consulta de acceso contra `GET /api/access/check`.

Configuracion esperada:
- Backend local en `http://10.0.2.2:2000` para emulador Android.
- Usuario demo por defecto: `operador`
- Contrasena demo por defecto: `operador123`

Pasos sugeridos:
1. Levantar el backend web con Docker.
2. Abrir `android-operator` en Android Studio.
3. Dejar que Studio sincronice Gradle.
4. Ejecutar la app en un emulador o equipo Android 8+.

Limitaciones actuales:
- El flujo implementado hoy cubre login, OCR y consulta de acceso.
- Aun no registra `check-in`, `check-out` ni solicitudes urgentes desde Android.
- No se verifico compilacion en este entorno porque no hay SDK Android disponible aqui.
