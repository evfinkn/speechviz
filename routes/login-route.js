var express = require("express");
var router = express.Router();
var db = require("better-sqlite3")("speechviz.sqlite3");

const redirectToReferer = function (referer, res) {
  referer = referer ? decodeURI(referer) : "/";
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
  const user = req.body.user;
  const password = req.body.password;
  const row = db.prepare("SELECT password FROM users WHERE user=?").get(user);
  if (row) {
    const expectedPassword = row.password;

    if (password === expectedPassword) {
      // success
      req.session.authenticated = true;
      req.session.user = user;
      redirectToReferer(req.body.referer, res);
    }
  } else {
    res.redirect("/login?retry");
  } // incorrect login
});
module.exports = router;
