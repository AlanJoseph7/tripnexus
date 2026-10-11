import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { DEFAULT_GROQ_MODEL } from "../trips/groq";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({
    status: "ok",
    mode: "groq_api",
    model: process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL,
    groqConfigured: Boolean(process.env.GROQ_API_KEY?.trim()),
  });
  res.json(data);
});

export default router;
