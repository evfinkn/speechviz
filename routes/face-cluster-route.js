var express = require('express');
var router = express.Router();
const fs = require("fs");




/* GET home page. */
router.get('/', (req, res, next) => {
    
    console.log(req.session);
    console.log(req.session.inFaceFolder);
    var folder;
    var faceFolder;
    var inFace;

    if (req.query.inFaceFolder == "false"){
            inFace = false;
    }
    else{
        inFace = true;
    }
    
    //isn't first time visiting
    if (req.session.inFaceFolder == true || req.session.inFaceFolder == false){
        folder = req.session.dir; //the overall directory for each cluster
        faceFolder = req.session.faceFolder; //the current cluster folder
    }
    else{//need to grab info from query
        console.log("in else");
        folder = req.query.dir;
        faceFolder = req.query.faceFolder;

        req.session.dir = folder;
        req.session.inFaceFolder = inFace;
    }

    console.log("face cluster route");
    console.log(req.session);
    console.log(req.query);
    //req.session.save; //https://github.com/expressjs/session/issues/790

    var dir = "faceClusters/" + folder + "/"
    var faces;

    //find folders of faces, and pass that 
    fs.readdir(("data/" + dir), function(err, files){
        faces = files;
    });

    if (!inFace){ //user needs to pick which face folder to view
        console.log(faces);
        req.session.inFaceFolder = false;
        console.log(req.session);
        res.render("facecluster", { "dir": dir, "faces": faces, inFaceFolder: false });//send to views/facecluster.pug
    }
    else { //we are in a face folder so face folder is defined, and can therefore send names of the images to pug to render
        fs.readdir(("data/"+ dir + faceFolder + "/"), function(err, files){
            console.log(files);
            req.session.inFaceFolder = true;
            console.log(req.session);
            res.render("facecluster", { "images": files, "dir": dir, "faceFolder": faceFolder, "faces": faces, inFaceFolder: true });//send to views/facecluster.pug
        });
    }
});

module.exports = router;
