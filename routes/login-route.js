import express from "express";
import Database from "better-sqlite3";

const router = express.Router();
const db = Database("speechviz.sqlite3");

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

router.post("/credentials", (req, res) => {
  const { user, password, referer } = req.body;
  const row = db.prepare("SELECT password FROM users WHERE user=?").get(user);
  if (row) {
    const expectedPassword = row.password;

    if (password === expectedPassword) {
      // success
      req.session.authenticated = true;
      req.session.user = user;
      redirectToReferer(referer, res);
    } else {
      res.redirect("/login?retry");
    }
  } else {
    res.redirect("/login?retry");
  } // incorrect login
});
export default router;
