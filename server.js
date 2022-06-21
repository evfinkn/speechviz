const args = require("minimist")(process.argv.slice(2));

const express = require("express");
const app = express();
const fs = require("fs");
const path = require("path");
const port = args.port || 8080;

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile("index.html", {root: __dirname});
});

app.get("/filelist", (req, res) => {
  res.send(fs.readdirSync("public/audio").filter(fileName => fileName != ".DS_Store"));
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
