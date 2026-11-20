#!/usr/bin/env node
/**
 * Arranque para producción (Render / Docker): prepara el entorno, aplica las migraciones que falten
 * y levanta la API. Es idempotente: si se reinicia, no repite lo que ya está aplicado.
 *
 *   1. AES_SECRET_KEY: si no está, se deriva de JWT_SECRET (estable entre reinicios).
 *   2. Migraciones 001..N y seeds, una sola vez cada una (tabla schema_migrations).
 *   3. Si ADMIN_PASSWORD está definida, se la asigna al usuario admin.
 *   4. require("../dist/app.js").
 */
const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

if (!process.env.AES_SECRET_KEY && process.env.JWT_SECRET) {
  process.env.AES_SECRET_KEY = crypto.createHash("sha256").update(`aes:${process.env.JWT_SECRET}`).digest("hex");
  console.log("[ARRANQUE] AES_SECRET_KEY derivada de JWT_SECRET");
}

const sslmode = process.env.DB_SSL === "false" ? "disable" : "require";
const pgEnv = {
  ...process.env,
  PGHOST: process.env.DB_HOST, PGPORT: process.env.DB_PORT, PGDATABASE: process.env.DB_NAME,
  PGUSER: process.env.DB_USER, PGPASSWORD: process.env.DB_PASSWORD, PGSSLMODE: sslmode,
};
// Los .sql nombran al usuario de desarrollo (aegis_app_user); en producción es el de la base que se conecta.
const leerSql = (archivo) => fs.readFileSync(archivo, "utf8").split("aegis_app_user").join(process.env.DB_USER);
const psql = (args, entrada) => spawnSync("psql", args, { env: pgEnv, encoding: "utf8", input: entrada });

async function main() {
  const base = path.resolve(__dirname, "../database");
  const pr = psql(["-tAc", "CREATE TABLE IF NOT EXISTS schema_migrations (nombre TEXT PRIMARY KEY, aplicada TIMESTAMPTZ NOT NULL DEFAULT now())"]);
  if (pr.status !== 0) { console.error("[ARRANQUE] No se pudo conectar a la base:", pr.stderr); process.exit(1); }

  const hechas = new Set((psql(["-tAc", "SELECT nombre FROM schema_migrations"]).stdout || "").split("\n").filter(Boolean));
  const registrar = (n) => psql(["-c", `INSERT INTO schema_migrations (nombre) VALUES ('${n}') ON CONFLICT DO NOTHING`]);

  const migraciones = fs.readdirSync(path.join(base, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const f of migraciones) {
    if (hechas.has(f)) continue;
    const r = psql(["-v", "ON_ERROR_STOP=1", "-1", "-f", "-"], leerSql(path.join(base, "migrations", f)));
    if (r.status !== 0) { console.error(`[ARRANQUE] Falló la migración ${f}:\n${r.stderr}`); process.exit(1); }
    registrar(f);
    console.log(`[ARRANQUE] migración aplicada: ${f}`);
  }

  const seeds = fs.readdirSync(path.join(base, "seeds")).filter((f) => f.endsWith(".sql")).sort();
  for (const f of seeds) {
    const clave = `seed:${f}`;
    if (hechas.has(clave)) continue;
    if (f.startsWith("003") && process.env.CARGAR_USUARIOS_DEMO === "false") { console.log(`[ARRANQUE] seed omitido: ${f}`); continue; }
    const r = psql(["-f", "-"], leerSql(path.join(base, "seeds", f)));   // como en CI: los seeds toleran filas ya existentes
    registrar(clave);
    console.log(`[ARRANQUE] seed aplicado: ${f}${r.status !== 0 ? " (con avisos)" : ""}`);
  }

  if (process.env.ADMIN_PASSWORD) {
    const hash = require("bcrypt").hashSync(process.env.ADMIN_PASSWORD, 12);
    psql(["-c", `UPDATE users SET password_hash = '${hash}' WHERE username = 'admin'`]);
    console.log("[ARRANQUE] contraseña del admin actualizada desde ADMIN_PASSWORD");
  }

  require("../dist/app.js");
}

main().catch((e) => { console.error("[ARRANQUE] error:", e); process.exit(1); });
