var express = require('express');
var router = express.Router();
const fs = require("fs");




/* GET home page. */
router.get('/', (req, res, next) => {
    folder = req.query.dir;
    faceFolder = req.query.faceFolder;
    overallFolder = req.query.inFaceFolder
    console.log(folder);
    console.log(faceFolder);
    console.log(overallFolder);

    var dir = "faceClusters/" + folder + "/"
    var faces;

    //find folders of faces, and pass that 
    fs.readdir(("data/" + dir), function(err, files){
        faces = files;
    });


    if (overallFolder){ //user needs to pick which face folder to view
        res.render("facecluster", { "dir": dir, "faces": faces, inFaceFolder: false });//send to views/facecluster.pug
    }
    else { //we are in a face folder so face folder is defined, and can therefore send names of the images to pug to render
        fs.readdir(("data/"+ dir + faceFolder + "/"), function(err, files){
            console.log(faces);
            res.render("facecluster", { "images": files, "dir": dir, "faceFolder": faceFolder, "faces": faces, inFaceFolder: true });//send to views/facecluster.pug
        });
    }
    
    
});

module.exports = router;
