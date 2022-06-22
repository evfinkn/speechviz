const args = require("minimist")(process.argv.slice(2));

const express = require("express");
const app = express();

const fs = require("fs");
const path = require("path");

const os = require("os");
const nets = os.networkInterfaces();
const netIP = Object.values(nets)  // get ip accessible from other computers on the network
  .map(net => net.filter(net => net.family === "IPv4" && !net.internal))  // get external IPv4s
  .map(net => net?.[0]?.address)   // get the address from the the nets
  .filter(address => address)[0];  // filter out undefined and get the 1st element

const port = args.port || 8080;

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile("index.html", {root: __dirname});
});

app.get("/filelist", (req, res) => {
  res.send(fs.readdirSync("public/audio").filter(fileName => fileName != ".DS_Store"));
});

app.listen(port, () => {
  console.log("Server accessible at the addresses:")
  console.log(`http://localhost:${port}`);
  console.log(`http://${netIP}:${port}`);
});
