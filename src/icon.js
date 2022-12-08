const feather = require('feather-icons');

const segmentOptions = { "width": 12, "height": 12, "stroke": "black", "fill": "black" }
const segmentOptionsWidth = { "width": 15, "height": 15, "stroke": "black", "stroke-width": 2.5 }
const segmentPlayIcon = feather.icons.play.toSvg(segmentOptions);
const segmentPauseIcon = feather.icons.pause.toSvg(segmentOptions);
const segmentLoopIcon = feather.icons.repeat.toSvg(segmentOptionsWidth);
const segmentRemoveIcon = feather.icons.x.toSvg(segmentOptionsWidth);
const faceImgIcon = feather.icons.image.toSvg(segmentOptionsWidth);
const segmentIcons = { "play": segmentPlayIcon, "pause": segmentPauseIcon, 
                       "loop": segmentLoopIcon, "remove": segmentRemoveIcon, 
                       "image": faceImgIcon }

const groupOptions = { "width": 15, "height": 15, "stroke": "black", "fill": "black" }
const groupOptionsWidth = { "width": 15, "height": 15, "stroke": "black", "stroke-width": 2.5 }
const groupPlayIcon = feather.icons.play.toSvg(groupOptions);
const groupPauseIcon = feather.icons.pause.toSvg(groupOptions);
const groupLoopIcon = feather.icons.repeat.toSvg(groupOptionsWidth);
const groupRemoveIcon = feather.icons.x.toSvg({ "width": 17, "height": 17, "stroke": "black", 
                                                "stroke-width": 2.5 });
const groupIcons = { "play": groupPlayIcon, "pause": groupPauseIcon, "loop": groupLoopIcon, 
                     "remove": groupRemoveIcon };

const zoomInIcon = feather.icons["zoom-in"].toSvg({ "stroke": "gray" });
const zoomOutIcon = feather.icons["zoom-out"].toSvg({ "stroke": "black" });

const undoIcon = feather.icons["corner-up-left"].toSvg({ "stroke": "gray" });
const redoIcon = feather.icons["corner-up-right"].toSvg({ "stroke": "gray" });

const settingsIcon = feather.icons.settings.toSvg({ "stroke": "black" });

export { segmentIcons, groupIcons, zoomInIcon, zoomOutIcon, undoIcon, redoIcon, settingsIcon };
