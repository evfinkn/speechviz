const feather = require("feather-icons");

/**
 * An `Object` containing the icons for play, pause, loop, remove, and
 * image buttons of a `TreeItem`.
 * @typedef {Object.<string, string>} TreeItemButtonIcons
 * @prop {string} play - SVG string for the play button icon.
 * @prop {string} pause - SVG string for the pause button icon.
 * @prop {string} loop - SVG string for the loop button icon.
 * @prop {string} remove - SVG string for the remove button icon.
 * @prop {string} image - SVG string for the image button icon.
 */

// the segment and group button icons have shared properties so just
// combine these into what's needed
const playAndPauseOptions = { stroke: "inherit", fill: "inherit" };
const loopRemoveImageOptions = { stroke: "inherit", "stroke-width": 2.5 };
const widthHeight12 = { width: 12, height: 12 };
const widthHeight15 = { width: 15, height: 15 };
const widthHeight17 = { width: 17, height: 17 };

const segmentPlayPauseOptions = Object.assign(
  {},
  playAndPauseOptions,
  widthHeight12
);
const segmentLoopOptions = Object.assign(
  {},
  loopRemoveImageOptions,
  widthHeight12
);
const segmentRemoveOptions = Object.assign(
  {},
  loopRemoveImageOptions,
  widthHeight15
);
const faceImgOptions = Object.assign({}, loopRemoveImageOptions, widthHeight15);

const segmentPlayIcon = feather.icons.play.toSvg(segmentPlayPauseOptions);
const segmentPauseIcon = feather.icons.pause.toSvg(segmentPlayPauseOptions);
const segmentLoopIcon = feather.icons.repeat.toSvg(segmentLoopOptions);
const segmentRemoveIcon = feather.icons.x.toSvg(segmentRemoveOptions);
const faceImgIcon = feather.icons.image.toSvg(faceImgOptions);

/**
 * The button icons for `Segment`s and `Face`s.
 * @type {TreeItemButtonIcons}
 */
const segmentIcons = {
  play: segmentPlayIcon,
  pause: segmentPauseIcon,
  loop: segmentLoopIcon,
  remove: segmentRemoveIcon,
  image: faceImgIcon,
};

const groupPlayPauseOptions = Object.assign(
  {},
  playAndPauseOptions,
  widthHeight15
);
const groupLoopOptions = Object.assign(
  {},
  loopRemoveImageOptions,
  widthHeight15
);
const groupRemoveOptions = Object.assign(
  {},
  loopRemoveImageOptions,
  widthHeight17
);

const groupPlayIcon = feather.icons.play.toSvg(groupPlayPauseOptions);
const groupPauseIcon = feather.icons.pause.toSvg(groupPlayPauseOptions);
const groupLoopIcon = feather.icons.repeat.toSvg(groupLoopOptions);
const groupRemoveIcon = feather.icons.x.toSvg(groupRemoveOptions);

/**
 * The button icons for `Group`s.
 * @type {TreeItemButtonIcons}
 */
const groupIcons = {
  play: groupPlayIcon,
  pause: groupPauseIcon,
  loop: groupLoopIcon,
  remove: groupRemoveIcon,
};

/**
 * SVG string for the zoom-in button icon.
 * @type {string}
 */
const zoomInIcon = feather.icons["zoom-in"].toSvg({ stroke: "inherit" });

/**
 * SVG string for the zoom-out button icon.
 * @type {string}
 */
const zoomOutIcon = feather.icons["zoom-out"].toSvg({ stroke: "inherit" });

/**
 * SVG string for the undo button icon.
 * @type {string}
 */
const undoIcon = feather.icons["corner-up-left"].toSvg({ stroke: "inherit" });

/**
 * SVG string for the redo button icon.
 * @type {string}
 */
const redoIcon = feather.icons["corner-up-right"].toSvg({ stroke: "inherit" });

/**
 * SVG string for the save button icon.
 * @type {string}
 */
const saveIcon = feather.icons.save.toSvg({ stroke: "inherit" });

/**
 * SVG string for the settings button icon.
 * @type {string}
 */
const settingsIcon = feather.icons.settings.toSvg({ stroke: "inherit" });

/**
 * SVG string for the plus button icon.
 * @type {string}
 */
const plusIcon = feather.icons.plus.toSvg({ stroke: "inherit" });

/**
 * SVG string for the minus button icon.
 * @type {string}
 */
const minusIcon = feather.icons.minus.toSvg({
  stroke: "inherit",
  style: "vertical-align:middle;",
});

const arrowOptions = Object.assign(
  {
    stroke: "inherit",
    style: "vertical-align:middle;",
  },
  widthHeight17
);
const arrowLeftIcon = feather.icons["arrow-left"].toSvg(arrowOptions);
const arrowRightIcon = feather.icons["arrow-right"].toSvg(arrowOptions);

export {
  segmentIcons,
  groupIcons,
  zoomInIcon,
  zoomOutIcon,
  undoIcon,
  redoIcon,
  saveIcon,
  settingsIcon,
  plusIcon,
  minusIcon,
  arrowLeftIcon,
  arrowRightIcon,
};
