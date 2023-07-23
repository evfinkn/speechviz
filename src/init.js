import Split from "split.js"; // library for resizing columns by dragging
import throttle from "lodash/throttle";
import { default as getNestedProp } from "lodash/get";
import globals from "./globals.js";
import {
  TreeItem,
  Group,
  CarouselGroup,
  Segment,
  PeaksGroup,
  Face,
  Word,
  File,
  Stat,
} from "./treeClasses.js";
import { GraphIMU } from "./graphicalClasses.js";
import SettingsPopup from "./SettingsPopup.js";
import CommitsPopup from "./CommitsPopup.js";
import SavePopup from "./SavePopup.js";
import { Channels } from "./ChannelAudio.js";
import { FiltersPopup } from "./FiltersPopup.js";
import { undoStorage, redoStorage, Actions } from "./UndoRedo.js";
import { notification } from "./Notification.js";
import {
  arrayMean,
  objectMap,
  getRandomColor,
  naturalCompare,
  sortByProp,
  toggleButton,
  ResponseError,
  checkResponseStatus,
  parseNumericalCsv,
  getUrl,
} from "./util.js";
import { zoomInIcon, zoomOutIcon, saveIcon, settingsIcon } from "./icon.js";

const peaks = globals.peaks;
const user = globals.user;
const filename = globals.filename;
const basename = globals.basename;
const media = globals.media;
const channelNames = globals.channelNames;
const folder = globals.folder;
const type = globals.type;

const tree = document.getElementById("tree");

const zoomview = peaks.views.getView("zoomview");
const overview = peaks.views.getView("overview");
const fitPeaksToContainer = () => {
  zoomview.fitToContainer();
  overview.fitToContainer();
};

// make tree and viewer columns resizable
// throttle because resizing the waveform is slow
Split(["#column", "#column2"], {
  sizes: [17, 79],
  snapOffset: 0,
  onDrag: throttle(fitPeaksToContainer, 250),
});

// TODO: if this does what I assume it does, it can
//       probably be moved to Segment as a property
const originalGroups = {};

const oldCreateTree = function (id, parent, children, snr) {
  if (!Array.isArray(children[0])) {
    // group of segments
    // FIXME: temp fix, see createTreeItemFromObj
    children.forEach((segment) => (segment.editable = true));
    if (id.includes("Speaker ")) {
      // group is speakers, which need popups
      const group = new PeaksGroup(id, {
        parent,
        snr,
        copyTo: ["Labeled.children"],
      });
      peaks.segments.add(children).forEach((segment) => {
        new Segment(segment, {
          parent: group,
          removable: true,
          renamable: true,
          moveTo: ["Speakers.children"],
          copyTo: ["Labeled.children"],
        });
        originalGroups[segment.id] = id;
      });
    } else {
      // group is VAD or Non-VAD
      const group = new PeaksGroup(id, {
        parent,
        snr,
        copyTo: ["Labeled.children"],
      });
      peaks.segments.add(children).forEach((segment) => {
        new Segment(segment, {
          parent: group,
          removable: true,
          renamable: true,
          copyTo: ["Labeled.children"],
        });
      });
    }
  } else {
    // group of groups
    const group = new Group(id, { parent, playable: true });
    for (const [child, childChildren, childSNR] of children) {
      oldCreateTree(child, group, childChildren, childSNR);
    }
  }
};

/**
 * An object representing a tree item.
 * @typedef {Object} TreeItemObj
 * @property {string} type - The type of the tree item. Must be a key in
 *      {@link TreeItem.types}.
 * @property {Array} [arguments] - The arguments to pass to the constructor of the tree
 *      item's class, excluding the options object.
 * @property {Object} [options] - The options passed as the last argument to the
 *      constructor of the tree item's class. For example, the last argument to
 *      {@link TreeItem} is an object with options like `text` and `removable`. Any
 *      option that takes some form of TreeItem as a value should be passed as the
 *      id of the TreeItem. Besides `parent`, `moveTo` and `copyTo` are examples of
 *      such options, being arrays of TreeItem ids. If new options like this are
 *      added, the constructor should either 1. handle the conversion from id to
 *      TreeItem itself or 2. accept the ids temporarily and let the caller of
 *      `createTreeItemFromObj` fix it after the tree item is created. The latter
 *      is usually necessary, since some of the TreeItems being referenced might not
 *      have been created yet.
 * @property {string} [options.parent] - The id of the parent tree item. Mostly only
 *      useful for direct children of the root tree item, `"Analysis"`, since items
 *      defined in a tree item's `children` property will have their parent set to that
 *      tree item automatically.
 * @property {Array.<TreeItemObj>} [options.children] - For tree items that can have
 *      children, an array of tree item objects representing the children. The children
 *      aren't passed to the constructor of the tree item's class but are instead
 *      created after the tree item is created.
 * @property {Object} [options.childrenOptions] - For tree items that can have
 *      children, an object whose properties are options to pass to the constructor
 *      of the tree item's class for each child. This is useful for when all the
 *      children share one or more options. The options are overridden by the
 *      `options` property of each child if defined there. The property can be
 *      nested within itself. E.g., `"childrenOptions": { "childrenOptions": {
 *      "playable": true } }` will make all grandchildren playable.
 * @example <caption>Example tree item object</caption>
 * {
 *   "type": "PeaksGroup",
 *   "arguments": ["Speaker 1"], // "Speaker 1" is the group's id
 *   "options": {
 *     "parent": "Analysis",
 *     "snr": 0.1,
 *     "childrenOptions": {
 *       "copyTo": ["Labeled.children"],  // . allows nested properties, children
 *       "moveTo": ["Speakers.children"]  // lets you move item to any child of Labeled
 *     },
 *     "children": [
 *       {
 *         // note that this object doesn't have a "parent" property
 *         // since it's defined in `children` of its parent
 *         "type": "Segment",
 *         "arguments": [
 *           {
 *             "startTime": 1.32259,
 *             "endTime": 3.67215,
 *             "color": "#f4dcf2",
 *             "labelText": "Speaker 1"
 *           }
 *         ]
 *       },
 *       {
 *         "type": "Segment",
 *         "arguments": [
 *           {
 *            "startTime": 4.02100,
 *            "endTime": 5.10923,
 *            "color": "#f4dcf2",
 *            "labelText": "Speaker 1"
 *           }
 *         ],
 *         "options": {
 *           "copyTo": ["Custom"] // this overrides copyTo from childrenOptions
 *         }
 *       }
 *     ] // end of children
 *   } // end of options
 * } // end of tree item object
 */

/**
 *
 * @param {(!TreeItemObj|!Array.<TreeItemObj>)} obj - The tree item object or array of
 *     tree item objects to create.
 * @param {?TreeItem} parent - The parent of the tree item(s) being created. If not
 *     specified, the root tree item ("Analysis") is used.
 * @returns {(!TreeItem|!Array.<TreeItem>)} The tree item(s) created.
 */
const createTreeItemFromObj = (obj, parent = null) => {
  if (Array.isArray(obj)) {
    return obj.map((subObj) => createTreeItemFromObj(subObj, parent));
  }

  const type = TreeItem.types[obj.type];
  if (type === undefined) {
    throw new Error(`No TreeItem type "${obj.type}" exists.`);
  }

  const args = obj.arguments || [];
  const options = obj.options || {};
  parent = parent || options.parent;
  if (parent == undefined) {
    parent = tree;
  } else if (typeof options.parent === "string") {
    parent = TreeItem.byId[options.parent];
  }
  options.parent = parent;
  const children = options.children;
  delete options.children;
  const childrenOptions = options.childrenOptions;
  delete options.childrenOptions;

  // FIXME: this is a temporary fix to make Speakers, VAD, and Non-VAD editable
  //        remove this when process_audio.py is updated to use the new format
  //        and there's a way to convert the old format to the new format
  if (type === Segment) {
    args[0].editable = true; // args[0] is the options object for Peaks
    options.removable = true;
    options.renamable = true;
  }

  const treeItem = new type(...args, options);
  children?.forEach((child) => {
    // imported groups can have a property "childrenOptions" that will be
    // applied to each of its children's options which can save space if
    // its children all have the same properties. It's a property of options
    // so that it can be nested within itself, e.g.
    // "childrenOptions": { "childrenOptions": { "playable": true } }
    // will make all grandchildren playable
    if (childrenOptions !== undefined) {
      if (child.options !== undefined) {
        // child.options is after so that properties in child.options have
        // priority over and will overwrite ones in obj.childrenProperties
        child.options = { ...childrenOptions, ...child.options };
      } else {
        child.options = { ...childrenOptions }; // make a copy
      }
    }
    createTreeItemFromObj(child, treeItem);
  });
  return treeItem;
};

/**
 * Adds a circled number to the left of every `PeaksGroup`s' text representing that
 * `PeaksGroup`'s rank. These ranks are determined from the `PeaksGroup`'s SNR and
 * duration. The `PeaksGroup` with rank 1 is the predicted primary signal.
 */
const rankSnrs = () => {
  const groups = Object.values(PeaksGroup.byId).filter(
    (group) => group.snr !== null
  );
  if (groups.length == 0) {
    return; // no groups have SNRs
  }

  const snrs = {};
  const durations = {};
  groups.forEach((group) => {
    snrs[group.id] = group.snr;
    durations[group.id] = group.duration;
  });

  // add the numbers in the circles next to the text of the speakers in the tree
  // decreasing order because want highest snr to be 1
  sortByProp(groups, "snr", { reverse: true });
  for (let i = 0; i < groups.length; i++) {
    // uses HTML symbol codes for the circled numbers
    // (can be found at https://www.htmlsymbols.xyz/search?q=circled)
    // numbers 1 - 20 use 9312 - 9331 (inclusive),
    // numbers 21 - 35 use 12881 - 12895 (inclusive)
    // only show the top 15
    if (i <= 14) {
      groups[i].text = `&#${9312 + i} ${groups[i].text}`;
    }
  }

  // for the next lines (snrMean to durZScores), it would be faster to loop
  // through snrs and durations together, but it's a lot more readable this way,
  // and this code is only executed once so it shouldn't be too big of a problem
  const snrMean = arrayMean(Object.values(snrs));
  const durMean = arrayMean(Object.values(durations));

  // calculate standard deviations
  const standardDeviation = (num, mean) => (num - mean) ** 2;
  const snrStdDev = Math.sqrt(
    arrayMean(Object.values(snrs), standardDeviation, snrMean)
  );
  const durStdDev = Math.sqrt(
    arrayMean(Object.values(durations), standardDeviation, durMean)
  );

  // calculate z scores
  const zScore = (num, mean, stdDev) => (num - mean) / stdDev;
  const snrZScores = objectMap(snrs, zScore, snrMean, snrStdDev);
  const durZScores = objectMap(durations, zScore, durMean, durStdDev);

  const overallZScores = {};
  for (const key in snrZScores) {
    overallZScores[key] = snrZScores[key] + durZScores[key];
  }

  let maxSpeaker = groups[0].id;
  let maxZ = overallZScores[maxSpeaker];
  for (const key of Object.keys(snrZScores)) {
    if (maxZ < overallZScores[key]) {
      maxSpeaker = key;
      maxZ = overallZScores[key];
    }
  }
  // highlight text of speaker with highest z score
  PeaksGroup.byId[maxSpeaker].span.style.color = "violet";
};

const analysis = new Group("Analysis", { parent: tree, playable: true });
// declare custom and labeled here so they can be accessed anywhere, but we
// have to wait to define them until after the annotations are loaded in case
// they're in the annotations
let custom, labeled;

if (folder !== undefined && folder !== null) {
  // in a folder
  const files = new CarouselGroup("Files", {
    parent: tree,
    playable: false,
    saveable: false,
  });
  fetch(`${type}/${folder}`)
    .then(checkResponseStatus)
    .then((response) => response.json())
    .then((fileList) => {
      fileList.forEach(
        (file) => new File(file, { parent: files, curFile: filename })
      );
      File.byId[filename].toggleTree(true); // turn on button for current file
      // sort in natural sort order
      files.sort((file1, file2) =>
        naturalCompare(file1.filename, file2.filename)
      );
    })
    .catch((error) => output404OrError(error, "folder grabbing runs"));
}

/**
 * Outputs a helpful message to the console stating what's missing if `error` is
 * a 404 and otherwise errors `error` to the console.
 * @param {Error} error - The `Error` caused in a `fetch` block.
 * @param {string} missing - The name of the thing that would be missing if
 *      `error` were a `404 Not Found` error.
 */
const output404OrError = (error, missing) => {
  if (error instanceof ResponseError && error.status == 404) {
    console.log(`No ${missing} for media.`);
  } else {
    // other errors are likely caused by the code, which we want to know
    console.error(error);
  }
};

// for copying a segment to its copyTo via dragging
function dragToLabel(segment) {
  let newX = 0,
    newY = 0,
    currentX = 0,
    currentY = 0;
  // when you hold mouse make segment follow cursor
  segment.span.onmousedown = dragMouse;

  function dragMouse() {
    // on a new click reset listening for a where the mouse goes for copying
    segment.copyTo[0].forEach((eachCopyTo) => {
      eachCopyTo.li.onmouseover = undefined;
    });
    segment.li.style.position = "absolute";
    window.event.preventDefault();
    currentX = window.event.pageX;
    currentY = window.event.pageY;

    // account for different top when scrolled
    segment.li.style.top =
      segment.li.offsetTop - document.getElementById("column").scrollTop + "px";
    segment.li.style.left =
      segment.li.offsetLeft -
      document.getElementById("column").scrollLeft +
      "px";

    // when you let go of mouse stop dragging
    document.onmouseup = stopDragging;
    document.onmousemove = dragSegment;
  }

  function dragSegment() {
    // do not allow a segment to be dragged if it has its popup open
    const popup = segment.li.children[segment.li.children.length - 1];
    if (popup.style.display !== "block") {
      window.event.preventDefault();
      newX = currentX - window.event.pageX;
      newY = currentY - window.event.pageY;
      currentX = window.event.pageX;
      currentY = window.event.pageY;
      // move the segments position to track cursor
      segment.li.style.top = segment.li.offsetTop - newY + "px";
      segment.li.style.left = segment.li.offsetLeft - newX + "px";
      if (
        window.event.pageY - document.getElementById("column").scrollTop <
        10
      ) {
        document.getElementById("column").scrollBy(0, -20);
      }
      // TODO: add downwards and maybe sideways scrolling, also
      // make all 4 work for scrolling longer distances?
    }
  }

  function stopDragging() {
    document.onmouseup = null;
    document.onmousemove = null;

    segment.copyTo[0].forEach((eachCopyTo) => {
      eachCopyTo.li.onmouseover = () => {
        // if was dragged to a spot it can be copied to copy it there
        copyThere(eachCopyTo);
      };
    });

    function copyThere(dest) {
      const copied = segment.copy(dest);
      if (copied) {
        undoStorage.push(new Actions.CopyAction(copied));
        dest.sortBy("startTime");
      }
      dest.open();
    }
    // move it back
    segment.li.style.top = "";
    segment.li.style.left = "";
    segment.li.style.position = "static";
    // bug fix: if you drag something and don't copy it,
    // if you hover over after it copies anyways. Remove event listeners
    setTimeout(reset, 100);
    function reset() {
      segment.copyTo[0].forEach((eachCopyTo) => {
        eachCopyTo.li.onmouseover = undefined;
      });
    }
  }
}

const numChannels = channelNames.length;
if (numChannels > 1) {
  if (!globals.mono) {
    // resize peaks so that the waveforms aren't so small
    const zoomviewContainer = document.getElementById("zoomview-container");
    const overviewContainer = document.getElementById("overview-container");
    zoomviewContainer.style.height = `${
      zoomviewContainer.scrollHeight * Math.log2(numChannels)
    }px`;
    overviewContainer.style.height = `${
      overviewContainer.scrollHeight * Math.log2(numChannels)
    }px`;
    fitPeaksToContainer();
  }

  const context = new AudioContext();
  context.destination.channelCount = 1; // downmix to mono
  // source is the audio from the <audio> or <video> element being visualized
  const source = context.createMediaElementSource(globals.media);

  const channels = new Channels(context, source, channelNames, {
    volumeMax: 200,
  });
  channels.output.connect(context.destination);
  document.getElementById("controls").append(channels.div);
}

const loadStats = async () => {
  const statsFile = getUrl("stats", basename, "-stats.csv", folder);
  try {
    const statCsv = await fetch(statsFile)
      .then(checkResponseStatus)
      .then((response) => response.text());
    const stats = new Group("Stats", {
      parent: analysis,
      playable: false,
    });

    // https://gist.github.com/Jezternz/c8e9fafc2c114e079829974e3764db75
    const csvStringToArray = (strData) => {
      const objPattern = new RegExp(
        '(\\,|\\r?\\n|\\r|^)(?:"([^"]*(?:""[^"]*)*)"|([^\\,\\r\\n]*))',
        "gi"
      );
      let arrMatches = null;
      const arrData = [[]];
      while ((arrMatches = objPattern.exec(strData))) {
        if (arrMatches[1].length && arrMatches[1] !== ",") arrData.push([]);
        arrData[arrData.length - 1].push(
          arrMatches[2]
            ? arrMatches[2].replace(new RegExp('""', "g"), '"')
            : arrMatches[3]
        );
      }
      return arrData;
    };
    const arrays = csvStringToArray(statCsv);

    let longestHeader = 0;
    for (let i = 0; i < arrays[0].length; i++) {
      if (arrays[0][i].length > longestHeader) {
        longestHeader = arrays[0][i].length;
      }
    }

    for (let i = 0; i < arrays[0].length; i++) {
      let statToDisplay = `${arrays[0][i]}: ${arrays[1][i]}`;
      if (arrays[0][i].length < longestHeader) {
        const difference = longestHeader - arrays[0][i].length;
        statToDisplay =
          arrays[0][i] + " ".repeat(difference) + ": " + arrays[1][i];
      }
      new Stat(statToDisplay, {
        parent: stats,
        playable: false,
      });
    }
  } catch (error) {
    output404OrError(error, "stats");
  }
};

const loadWords = async () => {
  const wordsFile = getUrl(
    "transcriptions",
    basename,
    "-transcription.json",
    folder
  );
  try {
    const words = await fetch(wordsFile)
      .then(checkResponseStatus)
      .then((response) => response.json());
    const wordsGroup = new PeaksGroup("Words", {
      parent: analysis,
      playable: false,
      color: "#00000000",
    });
    words.map((word) => {
      // posibile bug in peaks.js, previously we let the color get set by wordsGroup,
      // but in latest version we need to set it here because calling points.update
      // doesn't update the color on the waveform
      word["color"] = "#00000000";
    });
    peaks.points.add(words).forEach((word) => {
      new Word(word, { parent: wordsGroup });
    });
  } catch (error) {
    output404OrError(error, "transcription");
  }
};

// const loadAnnotations = async (annotsFile, { uuid, branch, version } = {}) => {
const loadAnnotations = async (annotsFile, { commit, branch } = {}) => {
  // await reinit();
  // add branch, version, and uuid as query parameters if they are defined
  const url = new URL(annotsFile, window.location.href);
  if (commit) {
    url.searchParams.set("commit", commit);
  }
  if (branch) {
    url.searchParams.set("branch", branch);
  }
  // if (version) {
  //   url.searchParams.set("version", version);
  // }
  let annots = await fetch(url)
    .then(checkResponseStatus)
    .then((response) => response.json())
    .catch((error) => output404OrError(error, "annotations"));
  if (annots === undefined) {
    global.highestId = 0;
    return; // no annotations found (the fetch failed), so just return
  }
  // If annots is an object, get the annotations from it. Otherwise, annots is an array
  annots = annots?.annotations ?? annots;
  const isOldFormat = Array.isArray(annots[0]);
  // backwards compatibility for our old annots format
  if (isOldFormat) {
    for (const [group, children, snr] of annots) {
      oldCreateTree(group, analysis, children, snr);
    }
  } else {
    // the annots file is in the new format
    createTreeItemFromObj(annots);
  }

  if (TreeItem.byId.Custom) {
    custom = TreeItem.byId.Custom;
  } else {
    custom = new PeaksGroup("Custom", {
      parent: analysis,
      color: getRandomColor(),
      colorable: true,
    });
  }
  if (TreeItem.byId.Labeled) {
    labeled = TreeItem.byId.Labeled;
  } else {
    labeled = new Group("Labeled", { parent: analysis, playable: true });
  }

  if (!TreeItem.byId.Stats) {
    loadStats();
  }
  if (!TreeItem.byId.Words) {
    loadWords();
  }

  // moveTo and copyTo for imported annots are arrays of strings like
  // `["Speakers.children"]` and `["Labeled.children"]`. The TreeItems with these
  // ids might not exist until all annots are imported, so that's why we update
  // them here instead of in createTreeItemFromObj
  for (const item of analysis.preorder()) {
    item?.moveTo?.forEach((dest, i) => {
      if (typeof dest === "string") {
        // getNestedProp because string might be path to property,
        // like "Speakers.children"
        item.moveTo[i] = getNestedProp(TreeItem.byId, dest);
      }
    });
    item?.copyTo?.forEach((dest, i) => {
      if (typeof dest === "string") {
        item.copyTo[i] = getNestedProp(TreeItem.byId, dest);
      }
    });
  }

  rankSnrs();
  const ids = Object.keys(Segment.byId);
  // since ids are of the form 'peaks.segment.#', parse the # from all of the ids
  const idNums = ids.map((id) => parseInt(id.split(".").at(-1)));
  globals.highestId = Math.max(...idNums); // used when saving to re-number segments

  // after loading, toggle everything off (usually end up
  // disabling most groups right away so just do it automatically)
  analysis.children.forEach((child) => child.toggle(false));

  Group.byId["Speakers"].children.forEach((speaker) => {
    dragToLabel(speaker);
    speaker.children.forEach((segment) => dragToLabel(segment));
  });

  const vadAndNonVad = [
    ...Group.byId["VAD"].children,
    ...Group.byId["Non-VAD"].children,
  ];
  vadAndNonVad.forEach((segment) => dragToLabel(segment));
};

const annotsFile = getUrl("annotations", basename, "-annotations.json", folder);
const branch = globals.urlParams.get("branch");
// const version = globals.urlParams.get("version");
const commit = globals.urlParams.get("commit");
// const annotsLoading = loadAnnotations(annotsFile, { branch, version, uuid });
const annotsLoading = loadAnnotations(annotsFile, { branch, commit });

const facesLoading = fetch(`/clustered-files/`)
  .then(checkResponseStatus)
  .then((response) => response.json())
  .then((fileList) => {
    const clusters = new Group("Clusters", { parent: tree, playable: false });
    const clusterfolders = fileList.cluster; // folder of each found cluster
    // name of the overall folder, same as video in speechviz w/out extension
    const dir = fileList.dir;
    // default image for each of the faces to show in speechviz
    const images = fileList.images;

    clusterfolders.forEach(async function (folderName) {
      var imagePath = images[folderName];
      await annotsLoading; // the segments must be loaded to get speakers
      new Face(folderName, {
        parent: clusters,
        assocWith: [Group.byId["Speakers"].children],
        dir: dir,
        imagePath: imagePath,
      });
    });
  })
  .catch((error) => output404OrError(error, "clustered faces"));

const poseRegex = /pose.*\.csv/;
const poseContainer = document.getElementById("poses");
if (poseContainer) {
  // get the list of files in the graphical dir for the file being visualized
  const dir = `/graphical/${basename}`;
  fetch(dir)
    .then(checkResponseStatus)
    // response is json string containing an array of file names
    .then((response) => response.json())
    .then((files) => {
      if (files.length == 0) {
        // create a fake 404 Not Found response so that
        // outputHelpfulFetchErrorMessage on the caught error
        // correctly outputs "No pose data for media."
        const response = Response(null, { status: 404 });
        throw new ResponseError(response);
      } else {
        // filter out non-pose files
        files = files.filter((file) => poseRegex.test(file));
        // fetch each pose file
        return Promise.all(files.map((file) => fetch(`${dir}/${file}`)));
      }
    })
    .then((responses) =>
      Promise.all(responses.map((response) => response.text()))
    )
    .then((texts) => texts.map((text) => parseNumericalCsv(text)))
    .then((data) => {
      poseContainer.style.display = "";
      new GraphIMU(poseContainer, data, { width: 400, height: 400 });
    })
    .catch((error) => output404OrError(error, "pose data"));
}

fetch("/isSplitChannel", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ folder: folder, basename: basename }),
})
  .then(checkResponseStatus)
  .then((response) => response.text())
  .then((trueOrFalse) => {
    // if it is not a split channel, don't allow switching between mono and split
    if (trueOrFalse !== "true") {
      document.getElementById("switchMono").type = "hidden";
      document.getElementById("switchMonoText").hidden = true;
    }
  });

// This is commented out until we need to use something like this
// const plotContainer = document.getElementById("plot");
// if (plotContainer) {
//   fetch(`/graphical/${basename}/magnetometer.csv`)
//     .then(checkResponseStatus)
//     .then((response) => response.text())
//     .then((text) => parseNumericalCsv(text))
//     .then((data) => {
//       const firstTime = data[0][0];
//       data.forEach((row) => row[0] -= firstTime);
//       plotContainer.style.display = "";
//       new TimeSeries(plotContainer, data);
//     })
//     .catch((error) => output404OrError(error, "magnetometer data"));
// }

// code below initializes the interface

const zoomIn = document.getElementById("zoomin");
const zoomOut = document.getElementById("zoomout");
zoomIn.innerHTML = zoomInIcon;
zoomOut.innerHTML = zoomOutIcon;

const saveButton = document.getElementById("save");
saveButton.innerHTML = saveIcon;

// function () instead of () => because usually event listeners use function
// so that "this" is bound to the element that emit the event
zoomIn.addEventListener("click", function () {
  peaks.zoom.zoomIn();
  const zoomLevel = peaks.zoom.getZoom();
  // can't zoom in any further, disable zoom in button
  if (zoomLevel == 0) {
    toggleButton(zoomIn, false);
  }
  // not at max zoom out level, enable zoom out button
  else if (zoomLevel == 3) {
    toggleButton(zoomOut, true);
  }
});
zoomOut.addEventListener("click", function () {
  peaks.zoom.zoomOut();
  const zoomLevel = peaks.zoom.getZoom();
  // can't zoom out any further, disable zoom out button
  if (zoomLevel == 4) {
    toggleButton(zoomOut, false);
  }
  // not at max zoom in level, enable zoom in button
  else if (zoomLevel == 1) {
    toggleButton(zoomIn, true);
  }
});

/**
 * Creates a new Labeled group using `input`'s value as the id.
 * @param {!HTMLInputElement} input - The element used to enter a new label name.
 */
const addLabel = (input) => {
  if (input.value != "") {
    const label = new PeaksGroup(input.value, {
      parent: labeled,
      removable: true,
      renamable: true,
      color: getRandomColor(),
      colorable: true,
      copyTo: [labeled.children],
    });
    undoStorage.push(new Actions.AddAction(label));
    input.value = ""; // clear text box after submitting
    labeled.open(); // open labeled in tree to show newly added label
  }
};

// input to add a label group
const labelInput = document.getElementById("add-label-input");
labelInput.addEventListener("keypress", (event) => {
  if (event.key === "Enter") {
    addLabel(labelInput);
  }
});
document
  .getElementById("add-label-button")
  .addEventListener("click", function () {
    addLabel(labelInput);
  });

// counts number of custom segments added, used for custom segment's labelText
let segmentCounter = 1;
const audioDuration = peaks.player.getDuration();
document.getElementById("add-segment").addEventListener("click", function () {
  const label = "Custom Segment " + segmentCounter++;
  const curTime = peaks.player.getCurrentTime();
  // endTime is either 2.5 seconds after current time
  // or the end of the audio (whichever's shortest)
  // if endTime > audioDuration, drag handle for changing
  // segment's endTime is off screen and unusable
  const endTime = curTime + 2.5 > audioDuration ? audioDuration : curTime + 2.5;
  const segmentOptions = {
    startTime: curTime,
    endTime: endTime,
    labelText: label,
    editable: true,
    treeText: label,
  };
  const segment = new Segment(segmentOptions, {
    parent: custom,
    removable: true,
    renamable: true,
    moveTo: [labeled.children],
  });
  undoStorage.push(new Actions.AddAction(segment));
  custom.open(); // open custom in tree to show newly added segment
});

const folderFile =
  folder !== undefined && folder !== null ? `${folder}/${filename}` : filename;
// old loading code for backwards compatibility (custom segments will be in database
// until they're saved again)
fetch("load", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=UTF-8" },
  body: JSON.stringify({ user, filename: folderFile }),
})
  .then(checkResponseStatus)
  .then((res) => res.json())
  .then((data) => {
    const notes = document.getElementById("notes");
    // we prioritize notes.value because if notes has a value, then it was loaded from
    // the annotations (which is the new behavior), so we don't want to overwrite it
    // with the database value (which will happen if this file hasn't been saved
    // since the new annotations format was implemented)
    notes.value = notes.value || data.notes || "";

    const regex = /Custom Segment /;
    peaks.segments
      .add(data.segments, { overwrite: true })
      .forEach((segment) => {
        let parent = segment.path.at(-1);
        if (!(parent in PeaksGroup.byId)) {
          // parent group doesn't exist yet so add it
          parent = new PeaksGroup(parent, {
            parent: Group.byId[segment.path.at(-2)],
            removable: true,
            renamable: true,
            color: getRandomColor(),
            colorable: true,
            copyTo: [labeled.children],
          });
        } else {
          parent = PeaksGroup.byId[parent];
        }

        if (segment.id in Segment.byId) {
          // segment is a moved segment
          const treeSegment = Segment.byId[segment.id];
          treeSegment.segment = segment;
          parent.addChildren(treeSegment);
        } else {
          new Segment(segment, {
            parent: parent,
            removable: true,
            renamable: true,
            moveTo: [labeled.children],
          });
        }
        parent.sortBy("startTime");

        if (segment.labelText.match(regex)) {
          segmentCounter++;
        }
      });

    async function waitForFacesThenLoad() {
      // wait for the fetching of faces from file system to finish
      await facesLoading;
      await annotsLoading;
      // move faces to saved spot on tree
      data.faces.forEach((face) => {
        if (face.speaker !== -1) {
          const actualFace = Face.byId["face" + face.faceNum];
          const actualSpeaker = PeaksGroup.byId["Speaker " + face.speaker];
          actualFace.assoc(actualSpeaker);
        } else {
          const removingFace = Face.byId["face" + face.faceNum];
          Face.removed.push(parseInt(face.faceNum));
          removingFace.remove();
        }
      });
    }
    waitForFacesThenLoad();

    // after loading, toggle everything off (usually end up
    // disabling most groups right away, just do it automatically)
    analysis.children.forEach((child) => child.toggle(false));
  })
  .catch((error) => console.error(error)); // catch err thrown by res if any

peaks.on("segments.dragstart", function (event) {
  const segment = Segment.byId[event.segment.id];
  const oldStartTime = segment.startTime;
  const oldEndTime = segment.endTime;
  // add event listener each time so that we can reference the
  // old times to create a DragSegmentAction since at dragend,
  // the segment will have the new start and end times
  peaks.once("segments.dragend", () =>
    undoStorage.push(
      new Actions.DragSegmentAction(segment, oldStartTime, oldEndTime)
    )
  );
});

// saves the segments
const savePopup = new SavePopup();
saveButton.addEventListener("click", function () {
  if (!globals.dirty) {
    notification.show("No changes to save.");
    return;
  }
  savePopup.show();
});

// setting to change the speed at which the media plays
const speedButton = document.getElementById("speed-button");
const speedDropdown = document.getElementById("speed-dropdown");
speedButton.addEventListener("click", function () {
  speedDropdown.classList.toggle("show");
});

const spdbtns = document.getElementsByClassName("spdbtn");
for (let i = 0; i < spdbtns.length; i++) {
  spdbtns[i].addEventListener("click", function () {
    media.playbackRate = parseFloat(this.innerHTML.replace("x", ""));
  });
}

// button for popup containing the settings that aren't usually changed
const settingsButton = document.getElementById("settings");
settingsButton.innerHTML = settingsIcon;
const settingsPopup = new SettingsPopup();
settingsButton.addEventListener("click", function () {
  settingsPopup.show();
});

// button for popup containing the commit versions
const commitsButton = document.getElementById("versions");
const commitsPopup = new CommitsPopup();
commitsButton.addEventListener("click", function () {
  commitsPopup.show();
});

const filtersButton = document.getElementById("filters");
const filtersPopup = new FiltersPopup();
filtersButton.addEventListener("click", function () {
  filtersPopup.show();
});

// https://www.w3schools.com/howto/howto_js_dropdown.asp
// Close the dropdown if the user clicks outside of it
const dropdowns = document.getElementsByClassName("dropdown-content");
window.onclick = function (event) {
  if (!speedButton.contains(event.target)) {
    for (let i = 0; i < dropdowns.length; i++) {
      const openDropdown = dropdowns[i];
      if (openDropdown.classList.contains("show")) {
        openDropdown.classList.remove("show");
      }
    }
  }
};

const contextMenus = [...document.getElementsByClassName("contextmenu")];

const closeContextMenu = (/** @type {HTMLElement} */ menu) => {
  // reset what id the context menu is for, then hide it
  menu.dataset.id = "";
  menu.style.display = "none";
};

// close context menu when anywhere else is clicked
document.body.addEventListener("click", (e) => {
  contextMenus.forEach((menu) => {
    if (e.target.offsetParent != menu) {
      closeContextMenu(menu);
    }
  });
});

const checkboxMenu = document.getElementById("checkbox-contextmenu");

const collapseItem = document.getElementById("collapse");
collapseItem.addEventListener("click", () => {
  // if collapseItem is clicked checkboxMenu.dataset.id should hypothetically never
  // be "", but leaving this here just in case (same with the other menu items)
  if (checkboxMenu.dataset.id !== "") {
    const treeItem = TreeItem.byId[checkboxMenu.dataset.id];
    treeItem.nested.classList.toggle("active");
    closeContextMenu(checkboxMenu);
  }
});

const invertItem = document.getElementById("invert");
invertItem.addEventListener("click", () => {
  if (checkboxMenu.dataset.id !== "") {
    const treeItem = TreeItem.byId[checkboxMenu.dataset.id];
    treeItem.children.forEach((child) => child.toggle());
    closeContextMenu(checkboxMenu);
  }
});

const unselectItem = document.getElementById("unselect");
unselectItem.addEventListener("click", () => {
  if (checkboxMenu.dataset.id !== "") {
    const treeItem = TreeItem.byId[checkboxMenu.dataset.id];
    const ancestors = treeItem.ancestors;
    if (ancestors === null) {
      // toggling the root doesn't make sense because it has no siblings
      closeContextMenu(checkboxMenu);
      return;
    }
    // exclude treeItem so that treeItem and none of its descendants are toggled
    for (const item of ancestors[0].preorder([treeItem])) {
      // toggle off everything (excluding ancestors so that treeItem item stays open)
      if (!ancestors.includes(item)) {
        item.toggle(false);
      }
    }
    closeContextMenu(checkboxMenu);
  }
});

const segmentMenu = document.getElementById("peakssegment-contextmenu");
peaks.on("segments.contextmenu", function (event) {
  // get the segment and the original mouse event from the peaks event
  // var is needed because event is already declared
  const { segment, evt } = event;
  segmentMenu.dataset.id = segment.id;
  // prevent default so that the right click context menu doesn't show
  evt.preventDefault();
  segmentMenu.style.top = `${evt.clientY}px`;
  segmentMenu.style.left = `${evt.clientX}px`;
  segmentMenu.style.display = "block";
  // hide button's that edit segments if the segment is not editable
  for (const item of segmentMenu.children) {
    if (!item.classList.contains("editonly") || segment.editable) {
      item.style.display = "block";
    } else {
      item.style.display = "none";
    }
  }
});

const showInTreeItem = document.getElementById("show-in-tree");
showInTreeItem.addEventListener("click", function () {
  const segment = Segment.byId[segmentMenu.dataset.id];
  segment.scrollIntoView();
  closeContextMenu(segmentMenu);
});

const splitItem = document.getElementById("split-segment");
splitItem.addEventListener("click", function () {
  const segment = Segment.byId[segmentMenu.dataset.id];
  undoStorage.push(new Actions.SplitSegmentAction(segment));
  closeContextMenu(segmentMenu);
});

const mergeItem = document.getElementById("merge-segments");
mergeItem.addEventListener("click", function () {
  const segment = Segment.byId[segmentMenu.dataset.id];
  const action = new Actions.MergeSegmentsAction(segment);
  if (action.overlapping.length === 0) {
    notification.show("No overlapping segments to merge.");
  } else {
    undoStorage.push(action);
  }
  closeContextMenu(segmentMenu);
});

window.addEventListener("keydown", function (event) {
  // ctrl key for windows, meta key is command for mac
  if (event.ctrlKey || event.metaKey) {
    // following comments use "ctrl + __", same as "cmd + __" for mac
    if (event.key == "s") {
      // ctrl + s is save shortcut
      commitsPopup.show();
      event.preventDefault(); // prevent default action when this shortcut is pressed
    } else if (event.key == "z") {
      if (event.shiftKey) {
        // ctrl + shift + z is redo shortcut
        redoStorage.redo();
        event.preventDefault();
      } else {
        // ctrl + z is undo shortcut
        undoStorage.undo();
        event.preventDefault();
      }
    } else if (event.key == "y") {
      // ctrl + y is redo shortcut
      redoStorage.redo();
      event.preventDefault();
    }
  }
});

// https://stackoverflow.com/a/7317311
// warns user when they try to close page that they have unsaved changes
window.addEventListener("beforeunload", function (event) {
  if (!globals.dirty) {
    return undefined;
  }

  const confirmationMessage =
    "You have unsaved changes. If you leave before saving, these changes will be lost.";
  // returnValue and return for cross compatibility
  (event || window.event).returnValue = confirmationMessage;
  return confirmationMessage;
});
