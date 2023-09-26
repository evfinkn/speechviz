import path from "path";

import express from "express";

import { dataDir } from "../server/globals.js";
import { readdirAndFilter } from "../server/io.js";

const faceClusterDir = path.join(dataDir, "faceClusters");

const router = express.Router();

router.get("/:video", async (req, res) => {
  const video = req.params.video;
  const videoDir = path.join(faceClusterDir, video);
  try {
    const faces = await readdirAndFilter(videoDir);
    res.render("facecluster", { video, faces });
  } catch (error) {
    res.status(404).send("Not Found");
  }
});

router.get("/:video/thumbnails", async (req, res) => {
  const video = req.params.video;
  const videoDir = path.join(faceClusterDir, video);
  try {
    const faces = await readdirAndFilter(videoDir);
    const thumbnails = {};
    for (const face of faces) {
      const faceDir = path.join(videoDir, face);
      const images = await readdirAndFilter(faceDir);
      thumbnails[face] = path.join("faceClusters", video, face, images[0]);
    }
    res.json(thumbnails);
  } catch (error) {
    res.status(404).send("Not Found");
  }
});

router.get("/:video/:face", async (req, res) => {
  const { video, face } = req.params;
  const faceDir = path.join(faceClusterDir, video, face);
  try {
    const images = await readdirAndFilter(faceDir);
    res.render("facecluster", { video, face, images });
  } catch (error) {
    res.status(404).send("Not Found");
  }
});

export default router;
