var express = require('express');
var router = express.Router();
const fs = require("fs");




/* GET home page. */
router.get('/', (req, res, next) => {
    folder = req.query.folder;
    faceFolder = req.query.faces;
    console.log(folder);
    var dir = "faceClusters/" + folder 
    
    fs.readdir(("data/"+ dir + "/testLabel0/"), function(err, files){
        //console.log(files);
        res.render("facecluster", { "images": files, "dir": dir });//send to views/facecluster.pug
    });
});

module.exports = router;
