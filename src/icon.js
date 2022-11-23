const feather = require('feather-icons');

/**
 * An `Object` containing the icons for play, pause, loop, and remove buttons of a `TreeItem`.
 * @typedef {Object.<string, string>} TreeItemButtonIcons
 * @prop {string} play - SVG string for the play button icon.
 * @prop {string} pause - SVG string for the pause button icon.
 * @prop {string} loop - SVG string for the loop button icon.
 * @prop {string} remove - SVG string for the remove button icon.
 */

const playAndPauseOptions = { "stroke": "black", "fill": "black" };
const loopAndRemoveOptions = { "stroke": "black", "stroke-width": 2.5 }
const widthHeight12 = { "width": 12, "height": 12 };
const widthHeight15 = { "width": 15, "height": 15 };
const widthHeight17 = { "width": 17, "height": 17 };

const segmentPlayPauseOptions = Object.assign({}, playAndPauseOptions, widthHeight12);
const segmentLoopOptions = Object.assign({}, loopAndRemoveOptions, widthHeight12);
const segmentRemoveOptions = Object.assign({}, loopAndRemoveOptions, widthHeight15);

const segmentPlayIcon = feather.icons.play.toSvg(segmentPlayPauseOptions);
const segmentPauseIcon = feather.icons.pause.toSvg(segmentPlayPauseOptions);
const segmentLoopIcon = feather.icons.repeat.toSvg(segmentLoopOptions);
const segmentRemoveIcon = feather.icons.x.toSvg(segmentRemoveOptions);

/**
 * The button icons for `Segment`s.
 * @type {TreeItemButtonIcons}
 */
const segmentIcons = {
    "play": segmentPlayIcon,
    "pause": segmentPauseIcon,
    "loop": segmentLoopIcon,
    "remove": segmentRemoveIcon
}

const groupPlayPauseOptions = Object.assign({}, playAndPauseOptions, widthHeight15);
const groupLoopOptions = Object.assign({}, loopAndRemoveOptions, widthHeight15);
const groupRemoveOptions = Object.assign({}, loopAndRemoveOptions, widthHeight17);

const groupPlayIcon = feather.icons.play.toSvg(groupPlayPauseOptions);
const groupPauseIcon = feather.icons.pause.toSvg(groupPlayPauseOptions);
const groupLoopIcon = feather.icons.repeat.toSvg(groupLoopOptions);
const groupRemoveIcon = feather.icons.x.toSvg(groupRemoveOptions);

/**
 * The button icons for `Group`s.
 * @type {TreeItemButtonIcons}
 */
const groupIcons = {
    "play": groupPlayIcon,
    "pause": groupPauseIcon,
    "loop": groupLoopIcon,
    "remove": groupRemoveIcon
};

/**
 * SVG string for the zoom-in button icon.
 * @type {string}
 */
const zoomInIcon = feather.icons["zoom-in"].toSvg({ "stroke": "gray" });

/**
 * SVG string for the zoom-out button icon.
 * @type {string}
 */
const zoomOutIcon = feather.icons["zoom-out"].toSvg({ "stroke": "black" });

/**
 * SVG string for the undo button icon.
 * @type {string}
 */
const undoIcon = feather.icons["corner-up-left"].toSvg({ "stroke": "gray" });

/**
 * SVG string for the redo button icon.
 * @type {string}
 */
const redoIcon = feather.icons["corner-up-right"].toSvg({ "stroke": "gray" });

/**
 * SVG string for the settings button icon.
 * @type {string}
 */
const settingsIcon = feather.icons.settings.toSvg({ "stroke": "black" });

export {
    segmentIcons,
    groupIcons,
    zoomInIcon,
    zoomOutIcon,
    undoIcon,
    redoIcon,
    settingsIcon
};
