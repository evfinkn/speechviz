var express = require('express');
var router = express.Router();
const fs = require("fs");


var dir = "/faceClusters/video1.mp4/testLabel0/"


/* GET home page. */
router.get('/', (req, res, next) => {
    file = req.query.file;
    test = req.query.test;
    
    fs.readdir(dir, function(err, files){
        res.render("facecluster", { "images": files, "dir": dir });
    });
});

module.exports = router;
