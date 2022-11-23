var express = require('express');
var router = express.Router();
const fs = require("fs");




/* GET home page. */
router.get('/', (req, res, next) => {
    file = req.query.file;
    console.log(file);
    var dir = "faceClusters/" + file + "/testLabel0/"
    test = req.query.test;
    
    fs.readdir(("data/"+ dir), function(err, files){
        //console.log(files);
        res.render("facecluster", { "images": files, "dir": dir });//send to views/facecluster.pug
    });
});

module.exports = router;
