import Peaks, { PeaksInstance } from "peaks.js";
import createSegmentMarker from "./CustomSegmentMarker";
import { checkResponseStatus, removeExtension, getUrl } from "./util.js";
import type { VersionEntry } from "../server/fossil.js";

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
 * @typedef {import("../server/fossil.js").VersionEntry} VersionEntry
 * @prop {Date} datetime - The date and time of the commit.
 * @prop {string} url - The url that will open the version in the interface.
 */
/**
 * A list of versions of the media file. The array is sorted in reverse chronological
 * order, so the first element is the latest version. Each version can be accessed
 * by its index in the array or by its commit hash (as a property of the array).
 * @typedef {Array.<VersionEntry>} VersionArray
 */

/**
 * `Object` containing global constants shared across the javascript files.
 * @prop {URLSearchParams} urlParams - The query parameters in the url.
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
 * @prop {!Array.<VersionEntry>} versions - The versions of the media file.
 * @prop {!VersionEntry} currentVersion - The version of the media file that is
 *      currently being viewed.
 * @prop {!Set.<string>} fileBranches - The names of the branches that the media file
 *      has commits on.
 * @prop {!Set.<string>} allBranches - The names of the branches in the repository.
 * @type {!Object.<string, any>}
 */
interface Globals {
  highestId: number;
  urlParams: URLSearchParams;
  filename: string;
  basename: string;
  media: HTMLMediaElement | null;
  channelNames: string[];
  mono: boolean;
  user: string;
  dirty: boolean;
  folder: string;
  type: string;
  versions?: Version[];
  fileBranches?: Set<string>;
  currentVersion?: Version;
  allBranches?: Set<string>;
  peaks?: PeaksInstance;
}

/**
 * Interface representing a version of the media file.
 * @prop {string} url - The URL that will open the version in the interface.
 */
export interface Version extends VersionEntry {
  url: string;
}

const globals: Globals = {
  urlParams: urlParams,
  filename: filename,
  basename: basename,
  media: document.getElementById("media") as HTMLMediaElement,
  channelNames: channelNames,
  mono: mono,
  user: user,
  dirty: false,
  folder: folder,
  type: type,
  highestId: 0,
};

const versionsFetchUrl = getUrl(
  "versions",
  basename,
  "-annotations.json",
  folder
);

/** @type {!Array<Version>} */
const versions = await fetch(versionsFetchUrl)
  .then(checkResponseStatus)
  .then((response) => response.json());
const versionUrl = new URL(window.location.href);
versionUrl.searchParams.delete("branch");
versions.forEach((ver: Version) => {
  // switch the URL to the version's commit
  versionUrl.searchParams.set("commit", ver.commit);
  ver.url = versionUrl.toString();
  versions[ver.commit] = ver; // add version to array by commit hash
});
globals.versions = versions;

globals.fileBranches = new Set(versions.map((ver: Version) => ver.branch));

if (globals.urlParams.has("commit")) {
  const commit = globals.urlParams.get("commit");
  globals.currentVersion = versions.find((ver) => ver.commit === commit);
} else {
  // if no commit is specified in the URL, the interface shows the latest commit,
  // either of any branch (if no branch is specified) or of the specified branch
  const branch = globals.urlParams.get("branch");
  if (branch === null) {
    // latest version is always the first one in the array
    globals.currentVersion = versions[0];
  } else {
    // latest version of a specified branch is always the first one on that branch
    globals.currentVersion = versions.find((ver) => ver.branch === branch);
  }
}

globals.allBranches = new Set(
  await fetch("/branch/list")
    .then(checkResponseStatus)
    .then((response) => response.json())
);

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
    wheelMode: "scroll" as "scroll",
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
