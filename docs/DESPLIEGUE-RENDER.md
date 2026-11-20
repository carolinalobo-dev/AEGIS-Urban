# Subir AEGIS Urban a Render (guía simple)

Render levanta **todo en un solo servicio**: la web y la API juntas, más una base de datos PostgreSQL. No hace falta configurar nada a mano: el archivo `render.yaml` ya lo describe.

## Antes de empezar
- El código tiene que estar en GitHub en la rama `master` (ver el PR).
- Una cuenta en [render.com](https://render.com) conectada a tu GitHub.

## Pasos
1. En Render: **New +** → **Blueprint**.
2. Elegí el repositorio **AEGIS-Urban** y la rama `master`. Render lee `render.yaml`.
3. Te pide un valor: **ADMIN_PASSWORD**. Escribí la contraseña que quieras para el usuario `admin` (anotala).
4. **Apply**. Render crea la base y el servicio y empieza a construir (tarda unos 5–10 minutos la primera vez).
5. Cuando diga **Live**, abrí la URL que te da (algo como `https://aegis-urban.onrender.com`).

Al arrancar, la aplicación **crea sola todas las tablas y los datos iniciales**. No hay que correr nada más.

## Usuarios para la demo
| Usuario | Contraseña | Rol |
|---|---|---|
| `admin` | la que pusiste en ADMIN_PASSWORD | Administración |
| `defensa`, `transito`, `auditor` | `Aegis2026!` (del seed) | Defensa Civil, Tránsito, Auditoría |

Si el sitio va a ser público, poné `CARGAR_USUARIOS_DEMO` en `false` antes del primer arranque (o cambiá esas contraseñas).

## Lo que conviene saber para mañana
- **Plan gratis:** el servicio se **duerme** si nadie lo usa un rato, y la primera visita tarda en responder (hasta un minuto). **Abrí la URL 5 minutos antes** de presentar y dejala abierta.
- La base gratis de Render **vence a los 30 días** (dato de memoria: confirmalo en el panel de Render).
- Los datos de sensores y alertas son simulados y las alertas aparecen a los pocos segundos de arrancar (el sistema las genera cada 15 s).
- El correo de verificación no se envía: los dos códigos se **muestran en pantalla**. Si querés correo real, cargá las variables `SMTP_*` y poné `VERIFICACION_EMAIL_REAL=true`.
- Los respaldos funcionan; el **simulacro de restauración** crea una base temporal y puede no estar permitido en la base gratis de Render. Si falla, no lo uses en la demo (crear respaldos sí anda).

## Si algo falla
- Mirá la pestaña **Logs** del servicio: los mensajes empiezan con `[ARRANQUE]` y dicen qué paso falló.
- «No se pudo conectar a la base»: revisá que el servicio y la base estén en la misma región.
- Pantalla en blanco: esperá a que el servicio termine de despertar y recargá.

## Cómo se probó
La imagen de Docker se construyó y se levantó contra una base vacía: se aplicaron las 18 migraciones y los seeds, la web y la API respondieron, pasaron las pruebas de seguridad y de roles, las 6 pruebas de punta a punta y un respaldo. **No se probó en Render mismo** (hace falta tu cuenta).
