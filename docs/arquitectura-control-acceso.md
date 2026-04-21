# Sistema de Control de Acceso

## 1. Objetivo

Construir una plataforma de control de acceso con dos interfaces:

- Web para administracion, creacion y validacion de tickets.
- Android para operacion en terreno mediante ingreso por RUT o escaneo del carnet.

El sistema debe controlar la entrada y salida de personas externas o internas autorizadas para ingresar a una dependencia.

## 2. Roles del sistema

### Administrador

Permisos:

- Crear usuarios.
- Asignar roles.
- Activar o desactivar usuarios.
- Ver todo el historial del sistema.
- Configurar reglas generales del proceso.

Restriccion:

- Solo el administrador puede crear usuarios.

### Creador de ticket

Permisos:

- Registrar solicitudes de ingreso.
- Crear tickets de acceso.
- Corregir informacion antes de la validacion final.
- Responder solicitudes elevadas por el operador.

No puede:

- Crear usuarios.
- Aprobarse a si mismo como verificador.

### Verificador de ticket

Permisos:

- Revisar los tickets generados.
- Validar que la informacion sea correcta.
- Aprobar o rechazar tickets.
- Dejar observaciones de validacion.

No puede:

- Crear usuarios.
- Registrar ingresos en porteria.

### Operador

Permisos:

- Buscar personas por RUT.
- Escanear carnet de identidad desde Android.
- Registrar entrada y salida.
- Ver si la persona tiene autorizacion vigente.
- Elevar una solicitud de acceso si la persona no aparece autorizada.

No puede:

- Crear usuarios.
- Aprobar tickets.

## 3. Flujo principal del negocio

### Paso 1. Solicitud inicial

La empresa solicita por correo el ingreso de una persona a las dependencias.

### Paso 2. Creacion del ticket

El creador de ticket ingresa la informacion requerida:

- RUT.
- Nombre.
- Apellido.
- Empresa a la que pertenece.
- Persona responsable o anfitrion dentro de la empresa.
- Motivo o actividad a realizar.
- Fecha y hora estimada de entrada.
- Fecha y hora estimada de salida.

Resultado:

- El ticket queda en estado `PENDIENTE_VERIFICACION`.

### Paso 3. Verificacion

El verificador revisa:

- Que los datos personales sean correctos.
- Que exista disponibilidad para realizar la actividad.
- Que el responsable interno corresponda.
- Que los horarios sean validos.

Resultado posible:

- `APROBADO`
- `RECHAZADO`
- `OBSERVADO` si requiere correccion antes de aprobar

### Paso 4. Control de ingreso por operador

En porteria o punto de acceso, el operador:

- Ingresa el RUT manualmente, o
- Escanea el carnet de identidad desde la app Android

El sistema consulta si existe un ticket:

- Aprobado
- Vigente para la fecha y hora
- No vencido
- No bloqueado

Resultado visual esperado:

- Visto bueno verde: la persona puede ingresar.
- X roja: la persona no puede ingresar.

Si puede ingresar:

- Se registra el evento de entrada.

Si no puede ingresar:

- El operador puede elevar una solicitud de acceso con los datos de la persona.

### Paso 5. Solicitud elevada por el operador

Cuando la persona no aparece registrada o no tiene autorizacion vigente, el operador genera una solicitud de acceso urgente con:

- RUT.
- Nombre.
- Apellido.
- Empresa.
- Responsable interno.
- Actividad o motivo.
- Hora estimada de entrada.
- Hora estimada de salida.
- Observaciones del operador.

Resultado:

- La solicitud queda en estado `PENDIENTE_RESPUESTA`.
- El creador de ticket revisa la solicitud y responde.

### Paso 6. Respuesta a la solicitud elevada

El creador de ticket puede:

- Aprobar la solicitud y crear un ticket.
- Rechazar la solicitud.
- Solicitar datos adicionales.

Si se crea el ticket y luego es aprobado por el verificador, el operador podra repetir la consulta y permitir el ingreso.

### Paso 7. Control de salida

Cuando la persona abandona las dependencias, el operador registra la salida con:

- RUT, o
- Escaneo del carnet

Resultado:

- Se marca el evento de salida y se cierra la visita.

## 4. Estados recomendados

### Estados del ticket

- `BORRADOR`
- `PENDIENTE_VERIFICACION`
- `OBSERVADO`
- `APROBADO`
- `RECHAZADO`
- `EN_PROCESO_INGRESO`
- `INGRESADO`
- `SALIDA_REGISTRADA`
- `VENCIDO`
- `CANCELADO`

### Estados de la solicitud elevada por operador

- `PENDIENTE_RESPUESTA`
- `EN_REVISION`
- `APROBADA`
- `RECHAZADA`
- `CERRADA`

## 5. Reglas de negocio

- Solo el administrador puede crear usuarios.
- Todo ticket debe ser creado por un creador de ticket.
- Todo ticket debe ser revisado por un verificador antes de autorizar el ingreso.
- El operador no puede aprobar tickets.
- El ingreso solo se permite si el ticket esta `APROBADO` y dentro del rango horario permitido.
- La salida debe quedar registrada para mantener trazabilidad.
- Toda accion debe quedar auditada.
- Si el RUT ya existe en el sistema, se reutiliza la ficha de la persona y se asocia al nuevo ticket.
- Un ticket puede generar multiples eventos: intento de consulta, entrada, salida y denegacion.

## 6. Modulos del sistema

### Web administrativa

Pantallas sugeridas:

- Inicio de sesion.
- Panel de administrador.
- Gestion de usuarios.
- Bandeja de tickets pendientes.
- Formulario de creacion de ticket.
- Pantalla de verificacion y aprobacion.
- Historial de accesos.
- Bandeja de solicitudes elevadas por operador.
- Reportes por fecha, empresa, responsable y estado.

### Aplicacion Android

Pantallas sugeridas:

- Inicio de sesion del operador.
- Busqueda por RUT.
- Escaneo de carnet.
- Resultado de validacion de acceso.
- Registro de entrada.
- Registro de salida.
- Formulario de solicitud urgente.
- Historial rapido del turno.

## 7. Datos minimos por persona

- RUT
- Nombre
- Apellido
- Empresa
- Estado activo

Opcionales:

- Numero de documento
- Fotografia
- Telefono
- Correo

## 8. Datos minimos por ticket

- Codigo de ticket
- Persona asociada
- Empresa asociada
- Responsable interno
- Actividad a realizar
- Fecha y hora de entrada
- Fecha y hora de salida
- Estado
- Usuario creador
- Usuario verificador
- Observaciones

## 9. Validaciones recomendadas

- Validar formato de RUT.
- Verificar duplicidad de tickets en el mismo rango horario.
- No permitir aprobar tickets con horario de salida menor al de entrada.
- No permitir registrar salida si no existe una entrada previa.
- Alertar si la persona intenta ingresar fuera del horario autorizado.
- Alertar si existe un ticket rechazado o vencido.

## 10. Seguridad y trazabilidad

- Autenticacion con usuario y contrasena.
- Control de acceso por roles.
- Auditoria de acciones criticas.
- Registro de fecha, hora y usuario en cada cambio.
- Proteccion de datos personales.
- Cifrado de contrasenas.
- Cierre de sesion por inactividad en Android y web.

## 11. Arquitectura sugerida

### Backend

- API REST centralizada.
- Motor recomendado: PostgreSQL.
- Autenticacion con JWT o sesiones seguras.

### Frontend web

- Panel para administrador, creador y verificador.

### App Android

- App para operador con camara y lectura de documento.
- Consulta en linea al backend para validar acceso.

## 12. Endpoints iniciales sugeridos

- `POST /auth/login`
- `POST /users`
- `GET /users`
- `POST /tickets`
- `GET /tickets`
- `GET /tickets/{id}`
- `POST /tickets/{id}/submit`
- `POST /tickets/{id}/approve`
- `POST /tickets/{id}/reject`
- `POST /tickets/{id}/observe`
- `GET /access/search?rut=...`
- `POST /access/check-in`
- `POST /access/check-out`
- `POST /operator-requests`
- `GET /operator-requests`
- `POST /operator-requests/{id}/approve`
- `POST /operator-requests/{id}/reject`

## 13. Flujo resumido

1. Llega correo con solicitud de ingreso.
2. El creador registra el ticket.
3. El verificador aprueba o rechaza.
4. El operador consulta por RUT o escanea carnet.
5. Si existe autorizacion vigente, registra el ingreso.
6. Si no existe autorizacion, eleva solicitud.
7. El creador responde la solicitud.
8. Finalmente el operador registra la salida.

## 14. Siguiente etapa recomendada

Para pasar de idea a desarrollo, conviene construir el MVP en este orden:

1. Autenticacion y gestion de usuarios por rol.
2. Registro de personas y tickets.
3. Flujo de aprobacion de tickets.
4. Consulta de acceso por RUT.
5. Registro de entrada y salida.
6. Solicitudes elevadas por operador.
7. Escaneo de carnet en Android.
8. Reportes y auditoria.
