var express = require('express');
var router = express.Router();

router.get('/', (req, res, next) => res.render("settings", { user: req.session.user }));

module.exports = router;