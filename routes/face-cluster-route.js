const express = require("express");
const router = express.Router();
const fs = require("fs");

/* GET home page. */
router.get("/", (req, res) => {
  const inFace = req.query.inFaceFolder == "false" ? false : true;
  req.session.inFaceFolder = inFace; // for app.js to know what we request

  let faceFolder;
  if (req.query.faceFolder !== undefined) {
    // face folder changed
    faceFolder = req.query.faceFolder;
    // for app.js to get images, it needs to know what face folder we are in
    req.session.faceFolder = faceFolder;
  } else if (req.session.faceFolder !== undefined) {
    // keep face folder the same
    faceFolder = req.session.faceFolder;
  }

  let folder;
  if (req.query.dir !== undefined) {
    // video we are looking at changed
    folder = req.query.dir;
    req.session.dir = folder;
  } else {
    // keep the same dir
    folder = req.session.dir;
  }
  const dir = "faceClusters/" + folder + "/";

  if (!inFace) {
    // user needs to pick which face folder to view
    req.session.inFaceFolder = false;
    // send to faceCluster.pug
    res.render("facecluster", { dir: dir, inFaceFolder: false });
  } else {
    // we are in a face folder, and can therefore
    // send paths of the images to pug to render
    fs.readdir("data/" + dir + faceFolder + "/", function (err, files) {
      req.session.inFaceFolder = true;
      res.render("facecluster", {
        images: files,
        faceFolder: faceFolder,
        dir: dir,
        inFaceFolder: true,
      });
      // send to views/facecluster.pug
    });
  }
});

module.exports = router;
