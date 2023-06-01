var express = require("express");
var router = express.Router();
var db = require("better-sqlite3")("speechviz.sqlite3");

const redirectToReferer = function (referer, res) {
  referer = referer ? decodeURI(referer) : "/";
  const json = JSON.parse(referer);
  // if there is no file don't redirect
  if (!json.file) res.redirect("/");
  else if (json.user) {
    // is a folder if .type shows up
    if (json.type)
      res.redirect(
        `${json.referer}&type=${json.type}&folder=${json.folder}&user=${json.user}`
      );
    // is not a folder, just these show up
    else res.redirect(`${json.referer}&file=${json.file}&user=${json.user}`);
  } else {
    // is a folder if .type shows up
    if (json.type)
      res.redirect(`${json.referer}&type=${json.type}&folder=${json.folder}`);
    // is not a folder, just these show up
    else res.redirect(`${json.referer}&file=${json.file}`);
  }
};

/* GET login page. */
router.get("/", (req, res) => {
  if (req.session.authenticated) {
    redirectToReferer(req.query.referer, res);
  } else {
    res.render("login", {
      referer: req.query,
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
    } else {
      res.redirect("/login?retry");
    }
  } else {
    res.redirect("/login?retry");
  } // incorrect login
});
module.exports = router;
