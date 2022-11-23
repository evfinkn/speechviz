var express = require('express');
var router = express.Router();
const fs = require("fs");


var dir = "faceClusters/video1.mp4/testLabel0/"


/* GET home page. */
router.get('/', (req, res, next) => {
    file = req.query.file;
    test = req.query.test;
    
    fs.readdir(("data/"+ dir), function(err, files){
        console.log(files);
        res.render("facecluster", { "images": files, "dir": dir });//send to views/facecluster.pug
    });
});

module.exports = router;
