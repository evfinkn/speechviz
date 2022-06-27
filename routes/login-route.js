var express = require('express');
var router = express.Router();
var db = require('better-sqlite3')("speechviz.sqlite3");

/* GET login page. */
router.get('/', (req, res, next) => res.render('login', {retry: 'retry' in req.query}));

router.get('/credentials', (req, res, next) => {
  const user = req.query.user;
  const password = req.query.password;
  const row = db.prepare('SELECT password FROM users WHERE user=?').get(user);
  if (row) {
    const expectedPassword = row.password;

    if (user === user && (password === expectedPassword)) {  // success
      req.session.authenticated = true;
      req.session.user = user;
      res.redirect('/');
      return;
    }
  }

	res.redirect('/login?retry');  // incorrect login

});
module.exports = router;
