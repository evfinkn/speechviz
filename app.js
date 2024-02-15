import fs from "fs/promises";
import path from "path";

import cookieParser from "cookie-parser";
import express from "express";
// use sessions
import session from "express-session";
import logger from "morgan";

import fossil from "./server/fossil.js";
import fossilUtil from "./server/fossilUtil.js";
import { dataDir, speechvizDir } from "./server/globals.js";
import { readdirAndFilter, write } from "./server/io.js";
import propagate from "./server/propagate.js";

import changePassword from "./routes/change-password-route.js";
import clusteredFaces from "./routes/face-cluster-route.js";
import index from "./routes/index-route.js";
import login from "./routes/login-route.js";
import settings from "./routes/settings-route.js";
import viz from "./routes/viz-route.js";

const app = express();

app.use(
  session({
    name: "speechviz",
    secret: "clinic annotations here",
    resave: false,
    saveUninitialized: true,
  }),
);

// view engine setup
app.set("views", path.join(speechvizDir, "views"));
app.set("view engine", "pug");

/**
 * The checkAuthentification method will be executed on all incoming requests
 * (excluding pages starting with /login).
 * It is based on the example from https://gist.github.com/smebberson/1581536
 * Essentially, you will have to obtain an authorization per session.
 */
function checkAuthentification(req, res, next) {
  const reqUrl = req.originalUrl;
  if (reqUrl.startsWith("/login") || req?.session?.authenticated) {
    // If the user is authenticated, then we can continue to the next handler
    // Otherwise if the user is trying to login, we need to let them through
    next();
  } else {
    // not authenticated so redirect to login page
    let loginUrl = "/login";
    // only add the requested url as a parameter if it isn't "/"
    // because "/" is the default when no referer is given
    if (reqUrl !== "/") {
      // reqUrl needs to be encoded so that characters like "&" don't break the url
      // encodeURI doesn't encode "&" so we need to use encodeURIComponent
      loginUrl += `?referer=${encodeURIComponent(reqUrl)}`;
    }
    res.redirect(loginUrl);
  }
}
app.use(logger("dev"));
app.use(express.json({ limit: "50mb" }));
app.use(express.json());
// urlencoded is needed for the login form
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(speechvizDir, "public")));
app.use(checkAuthentification);

app.use("/", index);
app.use("/clustered-faces", clusteredFaces);
app.use("/viz", viz);
app.use("/login", login);
app.use("/change-password", changePassword);
app.use("/settings", settings);

app.get("/logout", (req, res) => {
  req.session.authenticated = false;
  delete req.session.user;
  res.redirect("/login");
  return;
});

app.get("/user", (req, res) => {
  res.send(req.session.user);
});

const DEFAULT_ANNOTATIONS = {
  formatVersion: 3,
  annotations: [],
  notes: "",
};

// GET /versions/:file(*)?limit=n&branch=branchName
// Returns the version history of the specified file, optionally limited to the
// specified number of versions and/or the specified branch.
// (*) allows any characters, including slashes, in the file parameter
// this is necessary for when the file is in a subdirectory of the annotations folder
// if we ever upgrade to express 5.x, "(*)" will be incorrect and need to be replaced
// with "(.*)": https://github.com/expressjs/express/issues/2495
app.get("/versions/:file(*)", async (req, res) => {
  const { limit = -1, branch = null } = req.query; // limit -1 means no limit
  // req.params.file is the matched value of :file(*)
  const file = path.join(dataDir, "annotations", req.params.file);
  try {
    await fossilUtil.addAndCommit(file);
  } catch (err) {
    // ENOENT means the file doesn't exist
    if (err.code !== "ENOENT") {
      res.status(500).send(err.toString());
      return;
    }
    try {
      // Create the file with the default format
      await write(file, JSON.stringify(DEFAULT_ANNOTATIONS, null, "  "));
      await fossilUtil.addAndCommit(file, "Create empty annotations file");
    } catch (err) {
      res.status(500).send(err.toString());
      return;
    }
  }
  const versionEntries = await fossil.versions(file, { limit, branch });
  res.json(versionEntries);
});

// GET /annotations/:file(*)?commit=commitHash&branch=branchName
// Returns the contents of the specified file, optionally from the specified commit
// or branch.
app.get("/annotations/:file(*)", async (req, res) => {
  const file = path.join(dataDir, "annotations", req.params.file);
  try {
    const { commit, branch } = req.query;
    const annotations = await fossilUtil.catAnnotations(file, {
      commit,
      branch,
    });
    // can't use res.json because annotations is a string
    res.type("json").send(annotations);
  } catch (err) {
    res.status(500).send(err.toString());
  }
});

// GET /branch/list
// Returns the list of branches in the fossil repository.
app.get("/branch/list", async (req, res) => {
  try {
    res.json(await fossil.branch.list());
  } catch (err) {
    res.status(500).send(err.toString());
  }
});

// POST /annotations/:file(*)
// Saves the annotations to the specified file. The annotations (and optionally the
// branch and commit message) are in the request body as JSON.
app.post("/annotations/:file(*)", async (req, res) => {
  const user = req.session.user;
  const file = path.join(dataDir, "annotations", req.params.file);
  const { annotations, branch, message } = req.body;
  try {
    // I used "  " for the indent because I think fossil uses line-based diffs and
    // using "  " makes the json use multiple lines
    const json = JSON.stringify(annotations, null, "  ");
    await fossil.writeAndCommit(file, json, { user, branch, message });
    // unless the server has commit something else after the commit above,
    // the latest version will be the one we just committed
    // (we should handle this better in the future, but the same issue exists
    // elsewhere in the code so for now it's fine)
    const version = await fossil.latestVersion(file, { branch });
    res.json(version);
  } catch (err) {
    res.status(500).send(err.toString());
  }
});

// POST /propagate/:file(*)
// Propagates the new TreeItems in the annotations to the files the view was
// created from and saves the new annotations to the file.
app.post("/propagate/:file(*)", async (req, res) => {
  const user = req.session.user;
  const file = req.params.file;
  const { annotations, branch, message } = req.body;
  try {
    await propagate(file, annotations, { user, branch, message });
    res.status(200).end();
  } catch (err) {
    res.status(500).send(err.toString());
  }
});

const dataSubdirs = await readdirAndFilter("data", ["annotations"]);
// matches any request that start with "/subdir" where subdir is
// a subdirectory of the data directory
// escape is there because regex interprets string as is and doesn't escape for you
// eslint-disable-next-line no-useless-escape
const dataSubdirRegex = new RegExp(`\/(${dataSubdirs.join("|")})`);
app.get(dataSubdirRegex, async (req, res) => {
  const url = "data" + req.url;
  try {
    const stat = await fs.stat(url);
    // if it's a directory, return list of file names in that directory
    if (stat.isDirectory()) {
      return res.send(await readdirAndFilter(url));
    }
    // if it's a file, return the file
    else {
      return res.sendFile(url, { root: speechvizDir });
    }
  } catch (err) {
    // catch error from stat when file doesn't exist
    return res.status(404).send("Not Found");
  }
});

app.post("/isSplitChannel", async (req, res) => {
  const folder = req.body.folder;
  const basename = req.body.basename;
  let waveforms;
  if (folder) {
    waveforms = await readdirAndFilter(`data/waveforms/${folder}`);
  } else {
    waveforms = await readdirAndFilter("data/waveforms");
  }
  // if it has a -mono waveform it must be a split-channel file
  res.send(waveforms.indexOf(`${basename}-waveform-mono.json`) !== -1);
});

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  const err = new Error("Not Found");
  err.status = 404;
  next(err);
});

// error handler
app.use(function (err, req, res) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = err;

  // render the error page
  res.status(err.status || 500);
  res.render("error");
});

export default app;
