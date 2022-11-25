var express = require('express');
var router = express.Router();
const fs = require("fs");




/* GET home page. */
router.get('/', (req, res, next) => {
    folder = req.query.dir;
    faceFolder = req.query.faceFolder;
    inFace = req.query.inFaceFolder
    req.session.inFaceFolder = inFace;
    console.log("face cluster route");
    console.log(req.query);
    console.log(folder);
    console.log(faceFolder);
    console.log(inFace);

    var dir = "faceClusters/" + folder + "/"
    var faces;

    //find folders of faces, and pass that 
    fs.readdir(("data/" + dir), function(err, files){
        faces = files;
    });


    if (!inFace){ //user needs to pick which face folder to view
        res.render("facecluster", { "dir": dir, "faces": faces, inFaceFolder: true });//send to views/facecluster.pug
    }
    else { //we are in a face folder so face folder is defined, and can therefore send names of the images to pug to render
        req.session = faceFolder; //send it for app.js to find all the files in the folder
        fs.readdir(("data/"+ dir + faceFolder + "/"), function(err, files){
            console.log(faces);
            res.render("facecluster", { "images": files, "dir": dir, "faceFolder": faceFolder, "faces": faces, inFaceFolder: true });//send to views/facecluster.pug
        });
    }
    
    
});

module.exports = router;
