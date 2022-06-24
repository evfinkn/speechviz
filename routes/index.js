var express = require('express');
var router = express.Router();
var db = require('better-sqlite3')("speechviz.sqlite3");

/* GET home page. */
router.get('/', (req, res, next) => {
    const user = req.session.user;
    // obtain the id of the user based on its user
    const r = db.prepare('SELECT id FROM users WHERE user=?').get(user);
    const userid = r.id;
    res.render("index");
});

module.exports = router;
