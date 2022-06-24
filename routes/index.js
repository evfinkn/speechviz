var express = require('express');
var router = express.Router();
var db = require('better-sqlite3')("speechviz.sqlite3");

/* GET home page. */
router.get('/', (req, res, next) => {
    console.log('---- index ----');
    const user = req.session.user;
    console.log('user', user);

    // obtain the id of the user based on its user
    const r = db.prepare('SELECT id FROM users WHERE user=?').get(user);
    const userid = r.id;
    console.log('user', userid);

    res.render("index");
    console.log('---- index ---- (end)');
});

module.exports = router;
