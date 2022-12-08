var express = require('express');
var router = express.Router();
const fs = require("fs");

/* GET home page. */
router.get('/', (req, res, next) => {
    
    var inFace = req.query.inFaceFolder == "false" ? false : true;
    req.session.inFaceFolder = inFace; //for app.js
    
    var faceFolder;
    if (typeof req.query.faceFolder !== 'undefined'){//face folder changed
        faceFolder = req.query.faceFolder;
        req.session.faceFolder = faceFolder; //for app.js get images for face folder we are in
    }
    else if (typeof req.session.faceFolder !== 'undefined'){//keep face folder the same
        faceFolder = req.session.faceFolder;
    }

    var folder;
    if (typeof req.query.dir !== 'undefined'){ //video changed
        folder = req.query.dir;
        req.session.dir = folder;
    }
    else { //keep the same dir
        folder = req.session.dir;
    }
    var dir = "faceClusters/" + folder + "/"

    if (!inFace){ //user needs to pick which face folder to view
        req.session.inFaceFolder = false;
        res.render("facecluster", { "dir": dir, inFaceFolder: false });//send to faceCluster.pug
    }
    else { //we are in a face folder, and can therefore send paths of the images to pug to render
        fs.readdir(("data/"+ dir + faceFolder + "/"), function(err, files){
            req.session.inFaceFolder = true;
            res.render("facecluster", { "images": files, "faceFolder": faceFolder, "dir": dir,
                                        "faceFolder": faceFolder,  inFaceFolder: true });
            //send to views/facecluster.pug
        });
    }
});

module.exports = router;
