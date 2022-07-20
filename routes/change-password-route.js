var express = require('express');
var router = express.Router();
var db = require('better-sqlite3')("speechviz.sqlite3");

router.get('/', (req, res, next) => res.render('change-password', {retry: 'retry' in req.query}));

const selectPassword = db.prepare('SELECT password FROM users WHERE user=?');
const updatePassword = db.prepare("UPDATE users SET password=? WHERE user=?");

router.get('/credentials', (req, res, next) => {
  const user = req.session["user"];
  const password = req.query["password"];
  const newPassword = req.query["new-password"];

  console.log(user);
  console.log(password);
  console.log(newPassword);

  const expectedPassword = selectPassword.get(user)?.password;

  console.log(expectedPassword);

  if (password === expectedPassword) {  // success
    updatePassword.run([newPassword, user]);
    res.redirect('/logout');
    return;
  }

	res.redirect('/change-password?retry');  // incorrect login

});
module.exports = router;