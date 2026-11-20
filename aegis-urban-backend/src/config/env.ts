import "dotenv/config";
import { validarSecretos } from "./secretos";
import path from "path";
import { validarSmtp } from "./smtp";

// Valida en arranque que las variables críticas existan.
// Si falta algo, el proceso termina con mensaje claro en lugar de fallar silenciosamente.
const required = [
  "DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD",
] as const;

for (const key of required) {
  if (!process.env[key]) {
    console.error(`[ENV] Variable de entorno requerida no encontrada: ${key}`);
    console.error(`[ENV] Copiá .env.example como .env y completá los valores.`);
    process.exit(1);
  }
}

// Los secretos son obligatorios y deben ser fuertes: no hay valores por defecto.
// En tests (NODE_ENV=test) se usan valores fijos que NUNCA deben usarse fuera de las pruebas.
if (process.env.NODE_ENV === "test") {
  process.env.JWT_SECRET     ??= "solo-para-pruebas-automaticas-0123456789abcdef-xyz";
  process.env.AES_SECRET_KEY ??= "0".repeat(64);
  // Las pruebas nunca deben depender del .env local ni poder mandar correos de verdad.
  process.env.VERIFICACION_EMAIL_REAL = "false";
}
const problemasSecretos = validarSecretos(process.env);
if (problemasSecretos.length) {
  console.error("[ENV] Configuración de seguridad inválida:");
  for (const p of problemasSecretos) console.error(`[ENV]   - ${p}`);
  console.error("[ENV] Ejecutá: node scripts/crear-env.js  (genera un .env con secretos aleatorios)");
  process.exit(1);
}

// El correo real (SMTP) es opcional: solo se valida la configuración si está activado.
if (process.env.VERIFICACION_EMAIL_REAL === "true") {
  const problemasSmtp = validarSmtp(process.env);
  if (problemasSmtp.length) {
    console.error("[ENV] VERIFICACION_EMAIL_REAL=true pero falta configurar el correo:");
    for (const p of problemasSmtp) console.error(`[ENV]   - ${p}`);
    console.error("[ENV] Completá las variables SMTP_* en .env o poné VERIFICACION_EMAIL_REAL=false.");
    process.exit(1);
  }
}

export const env = {
  NODE_ENV:     process.env.NODE_ENV      ?? "development",
  PORT:         parseInt(process.env.PORT ?? "3001", 10),
  FRONTEND_URL: process.env.FRONTEND_URL  ?? process.env.RENDER_EXTERNAL_URL ?? "http://localhost:5173",

  db: {
    host:               process.env.DB_HOST!,
    port:               parseInt(process.env.DB_PORT!, 10),
    name:               process.env.DB_NAME!,
    user:               process.env.DB_USER!,
    password:           process.env.DB_PASSWORD!,
    poolMax:            parseInt(process.env.DB_POOL_MAX     ?? "20",    10),
    idleTimeoutMs:      parseInt(process.env.DB_IDLE_TIMEOUT ?? "30000", 10),
    connTimeoutMs:      parseInt(process.env.DB_CONN_TIMEOUT ?? "5000",  10),
  },

  jwt: {
    secret:         process.env.JWT_SECRET!,
    expiresIn:      process.env.JWT_EXPIRES_IN      ?? "24h",
    refreshExpires: process.env.JWT_REFRESH_EXPIRES_IN ?? "7d",
  },

  // Verificación de perfil: el correo puede ser REAL (SMTP) si se activa; el SMS es siempre SIMULADO.
  verificacion: {
    emailReal: process.env.VERIFICACION_EMAIL_REAL === "true",
  },
  smtp: {
    host:   process.env.SMTP_HOST ?? "",
    port:   parseInt(process.env.SMTP_PORT ?? "465", 10),
    secure: (process.env.SMTP_SECURE ?? "true") !== "false",
    user:   process.env.SMTP_USER ?? "",
    pass:   process.env.SMTP_PASS ?? "",
    from:   process.env.SMTP_FROM ?? "",
  },

  // Respaldos de la base: carpeta, modo de invocar pg_dump ("docker" usa el contenedor; "local" usa pg_dump del PATH)
  // y política automática (un respaldo cada 24 h, conservando los últimos N).
  backup: {
    dir:         process.env.BACKUP_DIR ?? path.resolve(__dirname, "../../backups"),
    modo:        (process.env.BACKUP_MODO === "local" ? "local" : "docker") as "docker" | "local",
    contenedor:  process.env.PG_CONTAINER ?? "aegis_postgres",
    automatico:  (process.env.BACKUP_AUTOMATICO ?? "true") !== "false",
    retencion:   parseInt(process.env.BACKUP_RETENCION ?? "7", 10),
  },

  aes: {
    key: process.env.AES_SECRET_KEY!,
  },
} as const;
