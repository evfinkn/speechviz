import fs from "fs";

import { readdirAndFilter } from "../server/io.js";
import express from "express";
// .js extension needed because mime doesn't have an "exports" field
import mime from "mime/lite.js";

const router = express.Router();

/* GET home page. */
router.get("/", async (req, res) => {
  const { file, folder, type } = req.query;
  // for displaying clustered faces
  if (file) {
    // sometimes when accessing a page
    // through a referrer file isn't set
    req.session.dir = req.query.file.replace(/\.[^/.]+$/, "");
    req.session.inFaceFolder = false;
  }

  if (!type || (!file && !folder)) {
    // invalid query string so can't get anything to show
    res.redirect("/");
  } else if (folder && !file) {
    // viewing a folder but no file was given, so
    // redirect to the first file in the folder
    const folderPath = `data/${type}/${folder}`;
    try {
      const files = await readdirAndFilter(folderPath);
      const url =
        files.length === 0
          ? "/" // folder is empty so nothing to show
          : `/viz?file=${files[0]}&type=${type}&folder=${folder}`;
      res.redirect(url);
    } catch {
      res.redirect("/"); // folder doesn't exist
    }
  } else {
    const path = folder ? `${type}/${folder}/${file}` : `${type}/${file}`;
    // can't use try catch like above because we don't need to do any IO on the file
    // so we can just check if it exists
    if (!fs.existsSync(`data/${path}`)) {
      res.redirect("/");
    } else {
      res.render("viz", {
        user: req.session.user,
        type,
        file,
        path,
        mimetype: mime.getType(file),
      });
    }
  }
});

export default router;
