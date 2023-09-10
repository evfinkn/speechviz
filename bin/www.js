#!/usr/bin/env node
import http from "http";
import os from "os";

import app from "../app.js";
import forceSSL from "express-force-ssl";
import minimist from "minimist";

const args = minimist(process.argv.slice(2));
app.use(forceSSL);

// HTTPS setup
// import fs from 'fs';
// import https from 'https';
// const ssl_options = {
//     key: fs.readFileSync( './encryption/localhost.key' ),
//     cert: fs.readFileSync( './encryption/localhost.cert'),
//     requestCert: false,
//     rejectUnauthorized: false
// };

const port = args.port || 3000;
app.set("port", port);
const server = http.createServer(app);
// const secureServer = https.createServer(ssl_options, app);

const nets = os.networkInterfaces();
const netIP = Object.values(nets) // get ip accessible from computers on the network
  .map((net) => net.filter((net) => net.family === "IPv4" && !net.internal)) // IPv4s
  .map((net) => net?.[0]?.address) // get the address from the the nets
  .filter((address) => address)[0]; // filter out undefined and get the 1st element

server.listen(port, () => {
  console.log("Server accessible at the addresses:");
  console.log(`http://localhost:${port}`);
  console.log(`http://${netIP}:${port}`);
});
server.on("error", onError);
// secureServer.listen(443)

function onError(error) {
  if (error.syscall !== "listen") {
    throw error;
  }
  // handle specific listen errors with friendly messages
  switch (error.code) {
    case "EACCES":
      console.log(
        "Non-privileged users can't listen on ports below 1024.\n" +
          "Run the server using sudo or use a different port.",
      );
      process.exit(1);
    case "EADDRINUSE": // eslint-disable-line no-fallthrough
      console.log(`Port ${port} is already in use.`);
      process.exit(1);
    default: // eslint-disable-line no-fallthrough
      throw error;
  }
}
