var express = require('express');
var router = express.Router();
const fs = require("fs");
const mime = require("mime/lite");

/* GET home page. */
router.get('/', (req, res, next) => {
    file = req.query.file;

    if (req.query.type === "video") {
        if (fs.readdirSync("data/video").includes(file)) {
            res.render("viz", { "user": req.session.user, "file": file, "mimetype": mime.getType(file), isVideo: true });
        }
        else { res.redirect("/"); }
    }
    else {
        if (fs.readdirSync("data/audio").includes(file)) {
            res.render("viz", { "user": req.session.user, "file": file, "mimetype": mime.getType(file), isVideo: false });
        }
        else { res.redirect("/"); }
    }
});

module.exports = router;