import "./config/env";
// Hace que un error dentro de un handler async llegue al errorMiddleware en vez de tumbar el proceso.
import "express-async-errors";
import express, { Application, Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import path from "path";
import fs from "fs";
import morgan from "morgan";
import { createServer } from "http";
import { env } from "./config/env";
import { db } from "./config/database";
import { errorMiddleware } from "./shared/errors/error.middleware";
import { inicializarWebSocket } from "./modules/websocket/SocketServer";
import { alertHandler } from "./core/events/handlers/AlertHandler";
import { bitacoraHandler } from "./core/events/handlers/BitacoraHandler";
import { telemetryService } from "./modules/telemetry/telemetry.service";
import { iniciarMantenimiento } from "./modules/backup/mantenimiento";

// ── Rutas
import rutaAuth       from "./modules/auth/auth.controller";
import rutaSensores   from "./modules/sensors/sensor.controller";
import rutaTelemetry  from "./modules/telemetry/telemetry.controller";
import rutaAlertas    from "./modules/alerts/alert.controller";
import rutaAdmin      from "./modules/admin/admin.controller";
import rutaSimulacion from "./modules/simulation/simulation.controller";
import rutaPublico    from "./modules/public/public.controller";
import { detenerEscenariosActivos } from "./modules/simulation/simulation.controller";

const app: Application = express();
const servidorHttp = createServer(app);

// ── Middlewares globales ──────────────────────────────────────────────────────
// El frontend se sirve desde este mismo servidor en producción: la CSP deja pasar lo que usa la web
// (mapa de OpenStreetMap, tipografías de Google y WebSocket al mismo origen).
app.use(helmet({
  // OpenStreetMap bloquea los mapas que no envían el origen (Referer); con no-referrer (valor por defecto) mostraba "Access blocked".
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc:     ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      workerSrc:  ["'self'", "blob:"],
    },
  },
}));
// Respuestas JSON comprimidas con gzip: menos bytes por petición (los WebSockets no se ven afectados).
app.use(compression());
app.use(cors({
  origin:         env.FRONTEND_URL,
  credentials:    true,
  methods:        ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/api/health", async (_req: Request, res: Response) => {
  const bdOk     = await db.verificarConexion();
  const estadsBd = db.obtenerEstadisticas();
  res.status(bdOk ? 200 : 503).json({
    estado:    bdOk ? "ok" : "degradado",
    servicio:  "AEGIS Urban API",
    version:   "1.0.0",
    entorno:   env.NODE_ENV,
    timestamp: new Date().toISOString(),
    baseDatos: { estado: bdOk ? "conectada" : "desconectada", ...estadsBd },
  });
});

// ── Rutas de módulos ──────────────────────────────────────────────────────────
app.use("/api/auth",      rutaAuth);
app.use("/api/sensores",  rutaSensores);
app.use("/api/telemetry", rutaTelemetry);
app.use("/api/alertas",   rutaAlertas);
app.use("/api/admin",     rutaAdmin);
app.use("/api/simulation", rutaSimulacion);
app.use("/api/publico",   rutaPublico);

// ── Frontend compilado (producción): lo sirve este mismo servidor, sin CORS ni proxy ──
const carpetaWeb = process.env.FRONTEND_DIST ?? path.resolve(__dirname, "../public");
if (fs.existsSync(path.join(carpetaWeb, "index.html"))) {
  app.use(express.static(carpetaWeb, { maxAge: "1h", index: false }));
  // Las rutas de la SPA (/alertas, /ciudadano...) devuelven index.html; la API conserva su 404 JSON.
  app.get(/^\/(?!api\/|socket\.io\/).*/, (_req: Request, res: Response) => {
    res.sendFile(path.join(carpetaWeb, "index.html"));
  });
}

// ── Manejo de errores ─────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Endpoint no encontrado" });
});
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  errorMiddleware(err, req, res, next);
});

// ── Inicialización al arrancar ────────────────────────────────────────────────
servidorHttp.listen(env.PORT, async () => {
  console.log(`\n✅ AEGIS Urban API corriendo en http://localhost:${env.PORT}`);
  console.log(`📡 Health: http://localhost:${env.PORT}/api/health`);
  console.log(`🌍 Entorno: ${env.NODE_ENV}\n`);

  // Inicializa WebSocket
  inicializarWebSocket(servidorHttp);

  // Inicializa handlers del EventBus
  alertHandler.iniciar();
  bitacoraHandler.iniciar();

  // Motor de simulación: cada 15 segundos genera lecturas para sensores SIMULATED
  setInterval(async () => {
    try { await telemetryService.ejecutarCicloSimulacion(); } catch { /* silent */ }
  }, 15_000);

  console.log("⚡ Motor de simulación activo (15s/ciclo)");

  // Particiones de sensor_reading al día + respaldo diario con retención
  iniciarMantenimiento();
});

const apagarServidor = async (senal: string) => {
  console.log(`\n[${senal}] Cerrando servidor...`);
  servidorHttp.close(async () => {
    await detenerEscenariosActivos();
    await db.cerrar();
    console.log("Servidor cerrado correctamente.");
    process.exit(0);
  });
};

process.on("SIGTERM", () => apagarServidor("SIGTERM"));
process.on("SIGINT",  () => apagarServidor("SIGINT"));

export { app, servidorHttp };
