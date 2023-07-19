var express = require("express");
var router = express.Router();
const fs = require("fs");
const mime = require("mime/lite");

// A set of files to exclude file lists.
// ".DS_STORE" is a hidden file on mac in all folders
// ".fslckout" is a hidden file in fossil repos
const excludedFiles = new Set([".DS_Store", ".fslckout"]);
const readdirAndFilter = (path) =>
  fs.readdirSync(path).filter((file) => !excludedFiles.has(file));

const render = (req, res, file, { folder = null, user = null } = {}) => {
  if (user === null || user === undefined) {
    user = req.session.user;
  }
  res.render("viz", {
    user: user,
    file: file,
    folder: folder,
    mimetype: mime.getType(file),
    isVideo: req.query.type === "video",
    isFolder: folder !== null && folder !== undefined,
  });
};

const getUrl = (file, type, { folder = null, user = null } = {}) => {
  let url = `/viz?file=${file}&type=${type}`;
  if (folder !== null && folder !== undefined) {
    url += `&folder=${folder}`;
  }
  if (user !== null && user !== undefined) {
    url += `&user=${user}`;
  }
  return url;
};

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
          res.redirect(getUrl(firstFile, "video", { folder, user }));
        }
        render(req, res, file, { folder });
      } else {
        res.redirect("/");
      }
    } else {
      if (fs.readdirSync("data/video").includes(file)) {
        render(req, res, file);
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
          res.redirect(getUrl(firstFile, "audio", { folder, user }));
        }
        render(req, res, file, { folder });
      } else {
        res.redirect("/");
      }
    } else {
      if (fs.readdirSync("data/audio").includes(file)) {
        render(req, res, file, { folder });
      } else {
        res.redirect("/");
      }
    }
  }
});

module.exports = router;
