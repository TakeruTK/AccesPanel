# Fix Access

Sistema web de control de acceso con:

- `Administrador`
- `Creador de ticket`
- `Verificador`
- `Operador`

Incluye persistencia en PostgreSQL, validacion de RUT, tickets de acceso, solicitudes urgentes del operador, registro de entrada y salida, historial de accesos, auditoria, exportacion CSV, bandeja de correo entrante con adjuntos y configuraciones operativas del administrador.

## Levantar con Docker

```bash
docker compose up --build
```

Servicios:

- App web: `http://localhost:2000`
- PostgreSQL: `localhost:5432`

## Credenciales demo

- `admin / admin123`
- `creador / creador123`
- `verificador / verificador123`
- `operador / operador123`

## Funcionalidades principales

- Login por rol con sesiones seguras y expiracion por inactividad.
- Administrador:
  - Crear usuarios.
  - Asignar roles.
  - Bloquear o reactivar cuentas.
  - Configurar politica de seguridad.
  - Configurar tolerancias operativas y duracion por defecto.
  - Configurar bandeja de correo entrante y webhook.
  - Revisar historial de accesos y auditoria.
- Creador:
  - Crear tickets manuales.
  - Tomar solicitudes urgentes del operador.
  - Registrar solicitudes recibidas por correo.
  - Adjuntar respaldos y descargar evidencias.
  - Corregir tickets observados y reenviarlos.
- Verificador:
  - Aprobar tickets.
  - Observar tickets.
  - Rechazar tickets.
- Operador:
  - Consultar por RUT.
  - Procesar un escaneo demo de carnet.
  - Registrar entrada.
  - Registrar salida.
  - Elevar solicitudes urgentes.
- Reportes:
  - Filtros por fecha, empresa, responsable, estado y RUT.
  - Exportacion CSV de tickets y eventos de acceso.
- Android:
  - Subproyecto inicial en `/android-operator`.
  - Login contra el backend.
  - Captura de foto del carnet y OCR para extraer RUT.
  - Consulta de acceso desde el dispositivo.

## Endpoints principales

- `GET /health`
- `GET /api/tickets`
- `GET /api/operator-requests`
- `GET /api/access-events`
- `GET /api/audit-logs`
- `GET /api/email-intake`
- `GET /api/access/check?rut=15.123.456-9`
- `POST /api/access/check-in`
- `POST /api/access/check-out`
- `POST /api/operator-requests`
- `POST /api/email-intake`
- `GET /attachments/:attachmentId/download`

## Pruebas

Con el stack levantado:

```bash
docker compose exec app npm test
```

## Exponer con ngrok

```bash
ngrok http 2000
```

## Cliente Android

El cliente inicial del operador vive en:

- `android-operator/`

Para emulador Android usa por defecto:

- Backend: `http://10.0.2.2:2000`
