import express from "express";

const router = express.Router();
router.get("/", (req, res) => res.render("vizrects"));

export default router;
