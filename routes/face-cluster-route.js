var express = require('express');
var router = express.Router();
const fs = require("fs");




/* GET home page. */
router.get('/', (req, res, next) => {
    file = req.query.file;
    console.log(file);
    var dir = "faceClusters/" + file 

    fs.readdir("data/" + dir).forEach(function (err, files){
        print(files);
    });
    
    fs.readdir(("data/"+ dir + "/testLabel0/"), function(err, files){
        //console.log(files);
        res.render("facecluster", { "images": files, "dir": dir });//send to views/facecluster.pug
    });
});

module.exports = router;
