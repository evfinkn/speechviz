var express = require("express");
var router = express.Router();
const fs = require("fs");
const mime = require("mime/lite");

// A set of files to exclude file lists.
// ".DS_STORE" is a hidden file on mac in all folders
const excludedFiles = new Set([".DS_Store"]);
const readdirAndFilter = (path) =>
  fs.readdirSync(path).filter((file) => !excludedFiles.has(file));

/* GET home page. */
router.get("/", (req, res) => {
  const file = req.query.file;
  const folder = req.query.folder;
  const user = req.query.user;
  // for displaying clustered faces
  if (req.query.file !== undefined) {
    // sometimes when accessing a page
    // through a referrer file isn't set
    req.session.dir = req.query.file.replace(/\.[^/.]+$/, "");
    req.session.inFaceFolder = false;
  }

  if (req.query.type === "video") {
    if (folder !== undefined && folder !== null) {
      if (fs.readdirSync("data/video/" + folder)) {
        if (file === undefined || file === null) {
          // the first time you click a folder there will be no file
          const firstFile = readdirAndFilter("data/video/" + folder).at(0);
          res.redirect(
            `/viz?file=${firstFile}&user=${user}&type=video&folder=${folder}`
          );
        }
        res.render("viz", {
          user: req.session.user,
          file: file,
          folder: folder,
          mimetype: mime.getType(file),
          isVideo: true,
          isFolder: true,
        });
      } else {
        res.redirect("/");
      }
    } else {
      if (fs.readdirSync("data/video").includes(file)) {
        res.render("viz", {
          user: req.session.user,
          file: file,
          mimetype: mime.getType(file),
          isVideo: true,
          isFolder: false,
        });
      } else {
        res.redirect("/");
      }
    }
  } else {
    if (folder !== undefined && folder !== null) {
      // we have opened a folder
      if (fs.readdirSync("data/audio/" + folder)) {
        if (file === undefined || file === null) {
          // the first time you click a folder there will be no file
          const firstFile = readdirAndFilter("data/audio/" + folder).at(0);
          res.redirect(
            `/viz?file=${firstFile}&user=${user}&type=audio&folder=${folder}`
          );
        }
        res.render("viz", {
          user: req.session.user,
          file: file,
          folder: folder,
          mimetype: mime.getType(file),
          isVideo: false,
          isFolder: true,
        });
      } else {
        res.redirect("/");
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
