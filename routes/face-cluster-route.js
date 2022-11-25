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

    if (req.query.inFaceFolder == "false"){ //always in url to update
        inFace = false;
    }
    else{
        inFace = true;
    }
    req.session.inFaceFolder = inFace;
    
    if (typeof req.query.faceFolder !== 'undefined'){//if faceFolder is in url they just selected a cluster to view
        faceFolder = req.query.faceFolder;
        req.session.faceFolder = faceFolder;
    }
    else if (typeof req.session.faceFolder !== 'undefined'){//if faceFolder is already defined and wasn't in url keep it the same
        faceFolder = req.session.faceFolder;
    }

    if (typeof req.query.dir !== 'undefined'){ //update dir if it is in url
        folder = req.query.dir;
        req.session.dir = folder;
    }
    else { //keep the same dir
        folder = req.session.dir;
    }

    console.log("face cluster route");
    console.log(req.session);
    console.log(req.query);

    var dir = "faceClusters/" + folder + "/"

    if (!inFace){ //user needs to pick which face folder to view
        req.session.inFaceFolder = false;
        console.log(req.session);
        res.render("facecluster", { "dir": dir, inFaceFolder: false });//send to views/facecluster.pug
    }
    else { //we are in a face folder so face folder is defined, and can therefore send names of the images to pug to render
        fs.readdir(("data/"+ dir + faceFolder + "/"), function(err, files){
            console.log(files);
            req.session.inFaceFolder = true;
            console.log(req.session);
            res.render("facecluster", { "images": files, "faceFolder": faceFolder, "dir": dir, "faceFolder": faceFolder,  inFaceFolder: true });//send to views/facecluster.pug
        });
    }
});

module.exports = router;
