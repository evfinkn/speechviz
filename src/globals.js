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

// TODO: make a typedef for undo (and redo) elements so that the types aren't {any[]} 
/**
 * `Object` containing global constants shared across the javascript files.
 * @prop {string} filename - The name of the media file including its extension.
 * @prop {string} basename - The name of the media file excluding its extension
 * @prop {!Element} media - The audio / video element being visualized.
 * @prop {any[]} undoStorage - The array holding the actions that have been undone.
 * @prop {string} user - The name of the user whose segments are being viewed. Always equal to the
 *      logged-in user, unless "admin" is logged-in (since the admin can view any user's segments).
 * @prop {!Peaks.PeaksInstance} peaks - Instance of peaks
 * @type {!Object.<string, any>}
 */
const globals = {};
// would've defined these properties in the object (in the line above this) but then
// VSCode IntelliSense showed them but not properties added later (like globals.peaks)
globals.filename = filename;
globals.basename = basename;
globals.media = document.getElementById("media");
globals.undoStorage = [];
// globals.redoStorage = [];
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
    mediaElement: globals.media,
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