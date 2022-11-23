var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', (req, res, next) => {
    res.render("facecluster");
    file = req.query.file;
    
});

module.exports = router;
