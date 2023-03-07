var express = require("express");
var router = express.Router();
const fs = require("fs");
const mime = require("mime/lite");

/* GET home page. */
router.get("/", (req, res) => {
  const file = req.query.file;
  const folder = req.query.folder;
  // for displaying clustered faces
  if (req.query.file !== undefined) {
    // sometimes when accessing a page
    // through a referrer file isn't set
    req.session.dir = req.query.file.replace(/\.[^/.]+$/, "");
    req.session.inFaceFolder = false;
  }

  if (req.query.type === "video") {
    if (fs.readdirSync("data/video").includes(file)) {
      if (fs.readdirSync("data/faceClusters").includes(file)) {
        res.render("viz", {
          user: req.session.user,
          file: file,
          mimetype: mime.getType(file),
          isVideo: true,
          isFolder: false,
        });
      } else {
        res.render("viz", {
          user: req.session.user,
          file: file,
          mimetype: mime.getType(file),
          isVideo: true,
          isFolder: false,
        });
      }
    } else {
      res.redirect("/");
    }
  } else {
    if (folder !== undefined && folder !== null) {
      // we have opened a folder
      if (fs.readdirSync("data/audio/" + folder).includes(file)) {
        res.render("viz", {
          user: req.session.user,
          file: file,
          folder: folder,
          mimetype: mime.getType(file),
          isVideo: false,
          isFolder: true,
        });
      }
    } else {
      if (fs.readdirSync("data/audio").includes(file)) {
        if (folder !== undefined && folder !== null) {
          // we have opened a folder
          res.render("viz", {
            user: req.session.user,
            file: file,
            folder: folder,
            mimetype: mime.getType(file),
            isVideo: false,
            isFolder: true,
          });
        } else {
          res.render("viz", {
            user: req.session.user,
            file: file,
            mimetype: mime.getType(file),
            isVideo: false,
            isFolder: false,
          });
        }
      } else {
        res.redirect("/");
      }
    }
  }
});

module.exports = router;
