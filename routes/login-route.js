import * as argon2 from "argon2";
import express from "express";

import db from "../server/db.js";

const router = express.Router();

const redirectToReferer = function (referer, res) {
  referer = referer ? decodeURIComponent(referer) : "/";
  res.redirect(referer);
};

/* GET login page. */
router.get("/", (req, res) => {
  if (req.session.authenticated) {
    redirectToReferer(req.query.referer, res);
  } else {
    res.render("login", {
      referer: req.query.referer,
      retry: "retry" in req.query,
    });
  }
});

router.post("/credentials", async (req, res) => {
  const { user, password, referer } = req.body;
  const row = db.prepare("SELECT password FROM users WHERE user=?").get(user);
  if (row && (await argon2.verify(row.password, password))) {
    req.session.authenticated = true;
    req.session.user = user;
    redirectToReferer(referer, res);
  } else {
    res.redirect("/login?retry");
  }
});
export default router;
