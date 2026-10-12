import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { DEFAULT_GEMINI_MODEL } from "../trips/gemini";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({
    status: "ok",
    mode: "gemini_api",
    model: process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
  });
  res.json(data);
});

export default router;
