var express = require('express');
var router = express.Router();
const fs = require("fs");
const mime = require("mime/lite");

/* GET home page. */
router.get('/', (req, res, next) => {
    audiofile = req.query.audiofile;
    if (fs.readdirSync("data/audio").includes(audiofile)) {
        res.render("viz", {"audiofile": audiofile, "mimetype": mime.getType(audiofile), "user": req.session.user});
    }
    else { res.redirect("/"); }
});

module.exports = router;