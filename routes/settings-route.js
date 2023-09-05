const express = require("express");
const router = express.Router();

router.get("/", (req, res) =>
  res.render("settings", { user: req.session.user })
);

module.exports = router;
