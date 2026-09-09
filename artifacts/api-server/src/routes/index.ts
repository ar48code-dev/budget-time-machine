import { Router, type IRouter } from "express";
import healthRouter from "./health";
import productionRouter from "./production";
import authRouter from "./auth";
import roomsRouter from "./rooms";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(roomsRouter);
router.use(productionRouter);

export default router;
