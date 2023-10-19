import path from "path";

import express from "express";

import { dataDir } from "../server/globals.js";
import { readdirAndFilter } from "../server/io.js";

const audioDir = path.join(dataDir, "audio");
const videoDir = path.join(dataDir, "video");
const viewsDir = path.join(dataDir, "views");
const faceClusterDir = path.join(dataDir, "faceClusters");

const router = express.Router();

/* GET home page. */
router.get("/", async (req, res) => {
  const audios = await readdirAndFilter(audioDir);
  const videos = await readdirAndFilter(videoDir);
  const views = (await readdirAndFilter(viewsDir)).filter(
    (viewFile) => !viewFile.endsWith("-times.csv"),
  );
  const faces = await readdirAndFilter(faceClusterDir);
  res.render("index", { audios, videos, views, faces });
});

export default router;
