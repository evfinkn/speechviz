import Peaks from "peaks.js";
import createSegmentMarker from "./CustomSegmentMarker.js";
import { checkResponseStatus, removeExtension, getUrl } from "./util.js";

// query parameters that appear in url, such as ?file=audio.mp3
const urlParams = new URLSearchParams(window.location.search);
const filename = urlParams.get("file"); // name of file with extension
const folder = urlParams.get("folder");
const type = urlParams.get("type");
const mono = urlParams.get("mono") !== null;

// name of the file without the extension
const basename = removeExtension(filename);

// make sure user is viewing their own segments or is admin
let user = urlParams.get("user"); // user in the url params
// the actual logged-in user (should == user unless admin logged in)
const sessionUser = await fetch("/user").then((response) => response.text());
if (!user) {
  user = sessionUser;
} else {
  // non-admin tried switching user url param to view other user's
  // segments, use logged-in user's segments
  if (sessionUser != "admin" && user != sessionUser) {
    user = sessionUser;
  }
  // admin is viewing other user's segments, add note in top right of viz
  else if (user != "admin") {
    document.getElementById("user").innerHTML = `admin (viewing ${user})`;
  }
}

const channelsFile = getUrl("channels", basename, "-channels.csv", folder);
const channelNames = await fetch(channelsFile)
  .then(checkResponseStatus)
  .then((res) => res.text())
  .then((channelsText) => channelsText.split("\n").slice(0, -1))
  .catch(() => []);

/**
 * `Object` containing global constants shared across the javascript files.
 * @prop {string} filename - The name of the media file including its extension.
 * @prop {string} basename - The name of the media file excluding its extension
 * @prop {!Element} media - The audio / video element being visualized.
 * @prop {!Array.<string>} channelNames - The names of the channels in the media file,
 *    if there is a -channels file for the media. Otherwise, an empty array.
 * @prop {boolean} mono - Whether to display the mono waveform.
 * @prop {string} user - The name of the user whose segments are being viewed. Always
 *      equal to the logged-in user, unless "admin" is logged-in (since the admin can
 *      view any user's segments).
 * @prop {!Peaks.PeaksInstance} peaks - Instance of peaks
 * @prop {boolean} dirty - Whether there are unsaved changes.
 * @prop {string} folder - The name of the folder containing the media file, if any.
 * @prop {string} type - The type of media file (audio or video).
 * @type {!Object.<string, any>}
 */
const globals = {};
// would've defined these properties in the object (in the line above this) but then
// VSCode IntelliSense showed them but not properties added later (like globals.peaks)
globals.filename = filename;
globals.basename = basename;
globals.media = document.getElementById("media");
globals.channelNames = channelNames;
globals.mono = mono;
globals.user = user;
globals.dirty = false;
globals.folder = folder;
globals.type = type;

const waveformFile = getUrl(
  "waveforms",
  basename,
  mono ? "-waveform-mono.json" : "-waveform.json",
  folder
);
const options = {
  // options passed to Peaks
  zoomview: {
    container: document.getElementById("zoomview-container"),
    waveformColor: "rgba(0,0,0,0.2)",
    playheadClickTolerance: 3,
    wheelMode: "scroll",
  },
  overview: {
    container: document.getElementById("overview-container"),
    waveformColor: "rgba(0,0,0,0.2)",
  },
  mediaElement: globals.media,
  dataUri: {
    json: waveformFile,
  },
  keyboard: true,
  pointMarkerColor: "#006eb0",
  showPlayheadTime: true,
  waveformCache: true,
  segmentsOptions: {
    startMarkerColor: "rgba(120, 120, 120, 1)",
    endMarkerColor: "rgba(120, 120, 120, 1)",
  },
  zoomLevels: [256, 512, 1024, 2048, 4096],
  createSegmentMarker: createSegmentMarker,
};

Peaks.init(options, function (err, peaksInstance) {
  if (err) {
    throw err;
  }
  globals.peaks = peaksInstance;
});

// Peaks.init() uses a callback, so this will be executed directly after calling
// Peaks.init(). However, we need to make sure globals.peaks has been set to the
// instance, as the other js files use it. This waits for globals.peaks to be set
// https://stackoverflow.com/a/39914235
while (!globals.peaks) {
  await new Promise((r) => setTimeout(r, 250));
}
export default globals;
