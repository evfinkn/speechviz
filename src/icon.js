const feather = require('feather-icons');

const segmentPlayIcon = feather.icons.play.toSvg({ "width": 12, "height": 12, "stroke": "black", "fill": "black" });
const segmentPauseIcon = feather.icons.pause.toSvg({ "width": 12, "height": 12, "stroke": "black", "fill": "black" });
const segmentLoopIcon = feather.icons.repeat.toSvg({ "width": 12, "height": 12, "stroke": "black", "stroke-width": 2.5 });
const segmentRemoveIcon = feather.icons.x.toSvg({ "width": 15, "height": 15, "stroke": "black", "stroke-width": 2.5 });
const segmentIcons = { "play": segmentPlayIcon, "pause": segmentPauseIcon, "loop": segmentLoopIcon, "remove": segmentRemoveIcon }

const groupPlayIcon = feather.icons.play.toSvg({ "width": 15, "height": 15, "stroke": "black", "fill": "black" });
const groupPauseIcon = feather.icons.pause.toSvg({ "width": 15, "height": 15, "stroke": "black", "fill": "black" });
const groupLoopIcon = feather.icons.repeat.toSvg({ "width": 15, "height": 15, "stroke": "black", "stroke-width": 2.5 });
const groupRemoveIcon = feather.icons.x.toSvg({ "width": 17, "height": 17, "stroke": "black", "stroke-width": 2.5 });
const groupIcons = { "play": groupPlayIcon, "pause": groupPauseIcon, "loop": groupLoopIcon, "remove": groupRemoveIcon };

const zoomInIcon = feather.icons["zoom-in"].toSvg({ "stroke": "gray" });
const zoomOutIcon = feather.icons["zoom-out"].toSvg({ "stroke": "black" });

const undoIcon = feather.icons["corner-up-left"].toSvg({ "stroke": "gray" });
const redoIcon = feather.icons["corner-up-right"].toSvg({ "stroke": "gray" });

const settingsIcon = feather.icons.settings.toSvg({ "stroke": "black" });

export { segmentIcons, segmentRemoveIcon, groupIcons, zoomInIcon, zoomOutIcon, undoIcon, redoIcon, settingsIcon };
