import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import mongoose from "mongoose";
import { authRouter } from "./auth/routes";
import { getConfig } from "./config/env";
import { errorHandler, notFound, originCheck, requireAuth } from "./http/middleware";
import type { JobRunner } from "./jobs/jobRunner";
import { kitsRouter } from "./kits/routes";
import { AppError } from "./lib/errors";
import { PracticeService } from "./practice/practiceService";
import { practiceRouter } from "./practice/routes";
import type { Services } from "./services";

export function createApp(services: Services, runner: JobRunner) {
  const cfg = getConfig();
  const app = express();
  app.disable("x-powered-by");
  if (cfg.TRUST_PROXY) app.set("trust proxy", 1);

  app.use(helmet());
  app.use(
    cors({
      origin: [new URL(cfg.FRONTEND_URL).origin],
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    }),
  );
  app.use(express.json({ limit: "200kb" }));
  app.use(cookieParser());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", db: mongoose.connection.readyState === 1 ? "up" : "down", llm: services.llm.available ? "configured" : "missing" });
  });

  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: cfg.NODE_ENV === "test" ? 10_000 : 600,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (_req, _res, next) => next(new AppError("RATE_LIMITED", "Too many requests. Slow down a little.")),
    }),
  );
  app.use("/api", originCheck);
  app.use("/api/auth", authRouter());

  const practice = new PracticeService(services.llm);
  app.use("/api/kits", requireAuth, kitsRouter(runner));
  app.use("/api/kits/:id", requireAuth, practiceRouter(practice));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
