var express = require('express');
var router = express.Router();
const fs = require("fs");




/* GET home page. */
router.get('/', (req, res, next) => {
    folder = req.query.folder;
    faceFolder = req.query.faces;
    console.log(folder);
    console.log(faceFolder);
    var dir = "faceClusters/" + folder + "/"
    var faces;

    fs.readdir(("data/" + dir), function(err, files){
        faces = files;
    });
    
    fs.readdir(("data/"+ dir + "testLabel0/"), function(err, files){
        console.log(faces);
        res.render("facecluster", { "images": files, "originalDirectory": dir, "dir": dir, "faces": faces, inFaceFolder: false });//send to views/facecluster.pug
    });
});

module.exports = router;
