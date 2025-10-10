# Blueprint de la Aplicación de Registro de Personal

## Descripción General

Esta aplicación permite a los usuarios registrar y visualizar al personal de una empresa. La aplicación cuenta con una página de inicio de sesión y una página de perfil donde se puede agregar y ver al personal.

## Estructura del Proyecto

El proyecto sigue una estructura estándar de React, con los componentes principales en la carpeta `src`.

- `src/main.jsx`: Punto de entrada de la aplicación.
- `src/App.jsx`: Componente principal que gestiona las rutas.
- `src/pages/LoginPage.jsx`: Página de inicio de sesión.
- `src/pages/ProfilePage.jsx`: Página de perfil que contiene el formulario, la reportería y la lista de personal.
- `src/components/PersonnelForm.jsx`: Formulario para agregar nuevo personal.
- `src/components/PersonnelList.jsx`: Tabla que muestra el personal registrado.
- `src/pages/SearchPage.jsx`: Página de búsqueda de personal para el usuario "Admin2".
- `src/pages/VerificationPage.jsx`: Endpoint de API para la verificación de personal desde la aplicación móvil.

## Funcionalidades

### Versión Inicial

- **Inicio de sesión:** Un formulario de inicio de sesión básico que redirige al perfil.
- **Registro de personal:** Un formulario para agregar personal con los siguientes campos:
  - RUT
  - Nombres
  - Apellidos
  - Teléfono
  - Empresa
  - Actividad
- **Visualización de personal:** Una tabla que muestra el personal registrado.

### Versión Actual

- **Se ha añadido un campo de "Fecha de Inicio" al formulario y a la tabla de personal.**
- **Se ha encerrado el formulario de acceso del personal en un recuadro para mejorar la interfaz de usuario.**
- **Se ha añadido un campo de "Fecha de Término" al formulario y a la tabla de personal.**
- **Se ha añadido un campo para registrar a la "Persona a Cargo" del nuevo personal.**
- **Se ha implementado una validación para que todos los campos del formulario sean obligatorios.**
- **Se han añadido 10 usuarios de ejemplo para facilitar las pruebas de la aplicación.**
- **Se ha añadido un segundo usuario administrador ("Admin2") con su respectiva contraseña ("Admin2").**
- **El usuario "Admin2" es redirigido a una página de búsqueda donde puede buscar personal por RUT, nombre o empresa.**
- **Se ha creado un endpoint de API en `/verify` para que la aplicación móvil de Android pueda verificar si un empleado está registrado y si su contrato está activo.**
- **Se ha añadido una sección de Reportería en la página de perfil del Administrador principal con las siguientes características:**
  - **Filtro por Rango de Fechas:** Permite seleccionar una fecha de inicio y una fecha de término para filtrar al personal cuyos contratos estuvieron activos durante ese período.
  - **Botones de Rango Rápido:** Incluye botones para filtrar rápidamente por "Hoy", "Esta Semana", "Este Mes" y "Últimos 3 Meses".
  - **Descarga de Reportes en CSV:** Un botón para descargar la lista de personal filtrada en un archivo CSV, ideal para análisis y registros.

## Endpoint de Verificación para la App Móvil

- **URL:** `/verify`
- **Método:** `GET`
- **Parámetros:**
  - `rut` (obligatorio): El RUT del empleado.
  - `nombre` (obligatorio): El nombre del empleado.
- **Respuesta (JSON):**
  - **Éxito (disponible):**
    ```json
    {
      "status": "success",
      "found": true,
      "available": true,
      "message": "Personal disponible para ingresar.",
      "data": { ... }
    }
    ```
  - **Éxito (no disponible):**
    ```json
    {
      "status": "success",
      "found": true,
      "available": false,
      "message": "El contrato del personal no está activo en la fecha actual.",
      "data": { ... }
    }
    ```
  - **No encontrado:**
    ```json
    {
      "status": "success",
      "found": false,
      "message": "Personal no encontrado."
    }
    ```
  - **Error (parámetros faltantes):**
    ```json
    {
      "status": "error",
      "message": "Los parámetros RUT y nombre son obligatorios."
    }
    ```

## Plan de Desarrollo Actual

- No hay ningún plan de desarrollo activo en este momento.
