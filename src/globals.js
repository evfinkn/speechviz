import Peaks from "peaks.js";
import createSegmentMarker from "./CustomSegmentMarker";

const globals = { dirty: false };

const urlParams = new URLSearchParams(window.location.search);
const filename = urlParams.get("audiofile");
globals.filename = filename;
const basename = filename.replace(/\.[^/.]+$/, "");  // name of the file without the extension;
globals.basename = basename;

let user = urlParams.get("user");
const sessionUser = await fetch("/user").then(response => response.text());
if (!user) {
    user = sessionUser;
}
else {
    if (sessionUser != "admin" && user != sessionUser) {
        user = sessionUser;
    }
    else if (user != "admin") {
        document.getElementById("user").innerHTML = `admin (viewing ${user})`;
    }
}
globals.user = user;

const options = {
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
    mediaElement: audio,
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

let initialized = false;

Peaks.init(options, function (err, peaksInstance) {
    if (err) { throw err; }
    globals.peaks = peaksInstance;
    initialized = true;
});
while (!initialized) { await new Promise(r => setTimeout(r, 250)); }  // https://stackoverflow.com/a/39914235
export default globals;