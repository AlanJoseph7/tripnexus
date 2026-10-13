if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile();
  } catch {
    try {
      process.loadEnvFile("../../.env");
    } catch {}
  }
}

import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
app.use(router);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, "Unhandled server error");
  if (res.headersSent) return;
  res.status(500).json({
    code: "INTERNAL_ERROR",
    error: err instanceof Error ? err.message : "Internal server error",
  });
});

export default app;
