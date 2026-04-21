# Fix Access

MVP inicial del sistema de control de acceso descrito para:

- Administrador
- Creador de ticket
- Verificador
- Operador

## Levantar con Docker

```bash
docker compose up --build
```

La aplicacion queda disponible en:

- `http://localhost:2000`

## Credenciales demo

- `admin / admin123`
- `creador / creador123`
- `verificador / verificador123` o `verificador / verificador 123`
- `operador / operador123`

Desde el panel de `admin` ya puedes crear usuarios nuevos para cualquier rol y luego iniciar sesion con esas credenciales creadas en la demo.

## Exponer con ngrok

Si necesitas compartir la demo hacia afuera:

```bash
ngrok http 2000
```

## Endpoints iniciales

- `GET /`
- `GET /health`
- `GET /api/tickets`
- `GET /api/operator-requests`
- `GET /api/access/check?rut=15.123.456-7`
