import Peaks from "peaks.js";
import createSegmentMarker from "./CustomSegmentMarker";

const urlParams = new URLSearchParams(window.location.search);  // query parameters that appear in url, such as ?file=audio.mp3
const filename = urlParams.get("file");  // name of file with extension
const basename = filename.replace(/\.[^/.]+$/, "");  // name of the file without the extension;

// make sure user is viewing their own segments or is admin
let user = urlParams.get("user");  // user in the url params
const sessionUser = await fetch("/user").then(response => response.text());  // actual logged-in user
if (!user) { user = sessionUser; }
else {
    // non-admin tried switching user url param to view other user's segments, use logged-in user's segments
    if (sessionUser != "admin" && user != sessionUser) {
        user = sessionUser;
    }
    // admin is viewing other user's segments, add note in top right of viz
    else if (user != "admin") {
        document.getElementById("user").innerHTML = `admin (viewing ${user})`;
    }
}

/**
 * Object containing global variables shared across js files
 * @property {boolean} dirty - Whether any changes have been made. If true, shows a warning before closing page
 * @property {string} filename - Name of the file, including its extension
 * @property {string} basename - Name of the file, excluding its extension
 * @property {string} user - Name of the user whose segments are being viewed. Always equal to the logged-in user unless admin is logged in
 * @property {Peaks.PeaksInstance} peaks - Instance of peaks
 * @type {Object}
 */
const globals = {};
globals.dirty = false;
globals.filename = filename;
globals.basename = basename;
globals.user = user;

const options = {  // options passed to Peaks
    zoomview: {
        container: document.getElementById('zoomview-container'),
        waveformColor: 'rgba(0,0,0,0.2)',
        playheadClickTolerance: 3,
        wheelMode: "scroll"
    },
    overview: {
        container: document.getElementById('overview-container'),
        waveformColor: 'rgba(0,0,0,0.2)'
    },
    mediaElement: document.getElementById("media"),
    dataUri: {
        json: `waveforms/${basename}-waveform.json`
    },
    keyboard: true,
    pointMarkerColor: '#006eb0',
    showPlayheadTime: true,
    waveformCache: true,
    zoomLevels: [256, 512, 1024, 2048, 4096],
    segmentStartMarkerColor: "rgba(120, 120, 120, 1)",
    segmentEndMarkerColor: "rgba(120, 120, 120, 1)",
    createSegmentMarker: createSegmentMarker
};

Peaks.init(options, function (err, peaksInstance) {
    if (err) { throw err; }
    globals.peaks = peaksInstance;
});

// Peaks.init() uses a callback, so this will be executed directly after calling Peaks.init()
// However, we need to make sure globals.peaks has been set to the instance, as the other
// js files use it. This waits for globals.peaks to be set
while (!globals.peaks) { await new Promise(r => setTimeout(r, 250)); }  // https://stackoverflow.com/a/39914235
export default globals;