import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getActiveModelInfo } from "../trips/model-provider";

const router: IRouter = Router();

router.get(["/healthz", "/health"], (_req, res) => {
  const info = getActiveModelInfo();
  const data = HealthCheckResponse.parse({
    status: "ok",
    mode: "groq_api",
    model: info.model,
    groqConfigured: info.configured,
  });
  res.json(data);
});

export default router;
