var express = require('express');
var router = express.Router();
var db = require('better-sqlite3')("speechviz.sqlite3");

/* GET home page. */
router.get('/', (req, res, next) => res.render("index"));

module.exports = router;
