import express from "express";

const router = express.Router();

router.get("/", (req, res) =>
  res.render("settings", { user: req.session.user }),
);

export default router;
