import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tripRouter from "./trips";
import documentationRouter from "./documentation";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tripRouter);
router.use(documentationRouter);

export default router;
