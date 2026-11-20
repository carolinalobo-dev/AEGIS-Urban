/**
 * Pruebas de seguridad automatizadas (caja negra sobre la API en ejecución).
 * Cubren: autenticación, manipulación de JWT, inyección SQL, control de acceso,
 * cabeceras de seguridad y limitación de intentos.
 */
import jwt from "jsonwebtoken";
import { llamar, loginAdmin } from "./cliente";

const RUTAS_PROTEGIDAS: Array<[string, string]> = [
  ["GET", "/api/sensores"], ["GET", "/api/alertas"], ["GET", "/api/telemetry/estadisticas"],
  ["GET", "/api/admin/usuarios"], ["GET", "/api/admin/bitacora"], ["GET", "/api/admin/backups"],
  ["POST", "/api/admin/backups"], ["GET", "/api/simulation/scenarios"], ["GET", "/api/auth/me"],
  ["PATCH", "/api/alertas/1/reconocer"], ["POST", "/api/alertas/1/evacuar"],
];

describe("Seguridad — autenticación", () => {
  test.each(RUTAS_PROTEGIDAS)("%s %s sin token responde 401", async (m, ruta) => {
    expect((await llamar(m, ruta)).status).toBe(401);
  });

  test("token basura es rechazado", async () => {
    expect((await llamar("GET", "/api/sensores", { token: "no.es.un.jwt" })).status).toBe(401);
  });

  test("JWT firmado con otra clave es rechazado", async () => {
    const falso = jwt.sign({ sub: 1, username: "admin", familyId: 1 }, "clave-del-atacante");
    expect((await llamar("GET", "/api/admin/usuarios", { token: falso })).status).toBe(401);
  });

  test("JWT con algoritmo 'none' es rechazado", async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const sinFirma = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: 1, username: "admin", familyId: 1 })}.`;
    expect((await llamar("GET", "/api/admin/usuarios", { token: sinFirma })).status).toBe(401);
  });

  test("JWT vencido es rechazado", async () => {
    const vencido = jwt.sign({ sub: 1, username: "admin", familyId: 1 }, "x", { expiresIn: -10 });
    expect((await llamar("GET", "/api/auth/me", { token: vencido })).status).toBe(401);
  });

  test("login con credenciales incorrectas responde 401 sin revelar si el usuario existe", async () => {
    const a = await llamar("POST", "/api/auth/login", { body: { username: "admin", password: "incorrecta-1" } });
    const b = await llamar("POST", "/api/auth/login", { body: { username: "no_existe_xyz", password: "incorrecta-1" } });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error ?? a.body.message).toEqual(b.body.error ?? b.body.message);
  });

  test("login sin campos responde 400", async () => {
    expect((await llamar("POST", "/api/auth/login", { body: {} })).status).toBe(400);
  });
});

describe("Seguridad — inyección", () => {
  const CARGAS = ["' OR '1'='1", "admin'--", "'; DROP TABLE users;--", "\" OR \"\"=\""];

  test.each(CARGAS)("login con payload SQL %j no inicia sesión ni da 500", async (p) => {
    const r = await llamar("POST", "/api/auth/login", { body: { username: p, password: p } });
    expect([400, 401, 429]).toContain(r.status);
    expect(r.body.token).toBeUndefined();
  });

  test("parámetros de consulta con SQL no provocan 500 y la tabla sigue existiendo", async () => {
    const token = await loginAdmin();
    for (const p of CARGAS) {
      const r = await llamar("GET", `/api/alertas?severidad=${encodeURIComponent(p)}&zona=${encodeURIComponent(p)}`, { token });
      expect(r.status).toBeLessThan(500);
    }
    expect((await llamar("GET", "/api/admin/usuarios", { token })).status).toBe(200);
  });

  test("identificador no numérico en la ruta no provoca 500", async () => {
    const token = await loginAdmin();
    const r = await llamar("PATCH", "/api/alertas/1;DROP/reconocer", { token });
    expect(r.status).toBeLessThan(500);
  });

  test("el nombre de archivo de un respaldo con ../ no permite recorrer directorios", async () => {
    const token = await loginAdmin();
    const r = await llamar("POST", `/api/admin/backups/${encodeURIComponent("../../etc/passwd")}/simulacro`, { token });
    expect([400, 404]).toContain(r.status);
  });
});

describe("Seguridad — cabeceras y configuración", () => {
  test("no expone X-Powered-By y envía cabeceras de helmet", async () => {
    const r = await llamar("GET", "/api/health");
    expect(r.headers.get("x-powered-by")).toBeNull();
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("strict-transport-security")).toBeTruthy();
  });

  test("envía el origen en el Referer (OpenStreetMap bloquea los mapas sin él) pero no la ruta completa", async () => {
    const r = await llamar("GET", "/api/health");
    expect(r.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  test("CORS no refleja orígenes ajenos", async () => {
    const r = await llamar("GET", "/api/health", { headers: { Origin: "http://sitio-malicioso.example" } });
    expect(r.headers.get("access-control-allow-origin")).not.toBe("http://sitio-malicioso.example");
  });

  test("la respuesta de login no incluye el hash de la contraseña", async () => {
    const token = await loginAdmin();
    const r = await llamar("GET", "/api/admin/usuarios", { token });
    expect(JSON.stringify(r.body)).not.toMatch(/password|\$2[aby]\$/i);
  });

  test("un 404 no filtra trazas de pila", async () => {
    const r = await llamar("GET", "/api/ruta-inexistente");
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toMatch(/at .*\.(ts|js):\d+/);
  });
});

describe("Seguridad — limitación de intentos", () => {
  test("tras 10 intentos fallidos el login responde 429", async () => {
    const usuario = `fuerza_bruta_${Date.now()}`;
    let ultimo = 0;
    for (let i = 0; i < 12; i++) {
      ultimo = (await llamar("POST", "/api/auth/login", { body: { username: usuario, password: "x" } })).status;
    }
    expect(ultimo).toBe(429);
  });
});
