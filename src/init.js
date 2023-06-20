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
import { Channels } from "./ChannelAudio.js";
import { FiltersPopup } from "./FiltersPopup.js";
import { undoStorage, redoStorage, Actions } from "./UndoRedo.js";
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
    if (id.includes("Speaker ")) {
      // group is speakers, which need popups
      const group = new PeaksGroup(id, { parent, snr, copyTo: [] });
      peaks.segments.add(children).forEach((segment) => {
        new Segment(segment, {
          parent: group,
          moveTo: [],
          copyTo: [],
        });
        originalGroups[segment.id] = id;
      });
    } else {
      // group is VAD or Non-VAD
      const group = new PeaksGroup(id, { parent, snr, copyTo: [] });
      peaks.segments.add(children).forEach((segment) => {
        new Segment(segment, { parent: group, copyTo: [] });
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

// TODO: add documentation
const createTreeItemFromObj = (obj, parent = null) => {
  if (Array.isArray(obj)) {
    return obj.map((subObj) => createTreeItemFromObj(subObj));
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
const custom = new PeaksGroup("Custom", {
  parent: analysis,
  color: getRandomColor(),
  colorable: true,
});
const labeled = new Group("Labeled", { parent: analysis, playable: true });

if (folder !== undefined && folder !== null) {
  // in a folder
  const files = new CarouselGroup("Files", { parent: tree, playable: false });
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

const segmentsFile = getUrl("segments", basename, "-segments.json", folder);
const segmentLoading = fetch(segmentsFile)
  .then(checkResponseStatus)
  .then((response) => response.json())
  .then((segments) => {
    const isOldFormat = Array.isArray(segments[0]);
    // backwards compatibility for our old segments format
    if (isOldFormat) {
      for (const [group, children, snr] of segments) {
        oldCreateTree(group, analysis, children, snr);
      }
    } else {
      // the segments file is in the new format
      createTreeItemFromObj(segments);
    }

    // Set moveTo and copyTo for the added tree items
    const speakers = Group.byId["Speakers"];
    const vadAndNonVad = [
      ...Group.byId["VAD"].children,
      ...Group.byId["Non-VAD"].children,
    ];
    if (isOldFormat) {
      speakers.children.forEach((speaker) => {
        speaker.copyTo.push(labeled.children);
        speaker.children.forEach((segment) => {
          segment.moveTo.push(speakers.children);
          segment.copyTo.push(labeled.children);
        });
      });
      Group.byId["VAD"].copyTo = [labeled.children];
      Group.byId["Non-VAD"].copyTo = [labeled.children];
      vadAndNonVad.forEach((segment) => segment.copyTo.push(labeled.children));
    } else {
      // moveTo and copyTo for imported segments are arrays of strings like
      // `["Speakers.children"]` and `["Labeled.children"]`. The TreeItems with these
      // ids might not exist until all segments are imported, so that's why we update
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
    }

    rankSnrs();
    const ids = Object.keys(Segment.byId);
    // since ids are of the form 'peaks.segment.#', parse the # from all of the ids
    const idNums = ids.map((id) => parseInt(id.split(".").at(-1)));
    globals.highestId = Math.max(...idNums); // used when saving to re-number segments

    // after loading, toggle everything off (usually end up
    // disabling most groups right away so just do it automatically)
    analysis.children.forEach((child) => child.toggle(false));

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
          segment.li.offsetTop -
          document.getElementById("column").scrollTop +
          "px";
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

    speakers.children.forEach((speaker) => {
      speaker.children.forEach((segment) => dragToLabel(segment));
    });

    vadAndNonVad.forEach((segment) => dragToLabel(segment));

    speakers.children.forEach((speaker) => dragToLabel(speaker));
  })
  .catch((error) => {
    output404OrError(error, "segments");
    globals.highestId = 0;
  });

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
      await segmentLoading; // the segments must be loaded to get speakers
      new Face(folderName, {
        parent: clusters,
        assocWith: [Group.byId["Speakers"].children],
        dir: dir,
        imagePath: imagePath,
      });
    });
  })
  .catch((error) => output404OrError(error, "clustered faces"));

const wordsFile = getUrl(
  "transcriptions",
  basename,
  "-transcription.json",
  folder
);
fetch(wordsFile)
  .then(checkResponseStatus)
  .then((response) => response.json())
  .then((words) => {
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
  })
  .catch((error) => output404OrError(error, "transcription"));

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

const statsFile = getUrl("stats", basename, "-stats.csv", folder);
fetch(statsFile)
  .then(checkResponseStatus)
  .then((response) => response.text())
  .then((statCsv) => {
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
  })
  .catch((error) => output404OrError(error, "stats"));

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

const notes = document.getElementById("notes");

const folderFile =
  folder !== undefined && folder !== null ? `${folder}/${filename}` : filename;

fetch("load", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=UTF-8" },
  body: JSON.stringify({ user, filename: folderFile }),
})
  .then(checkResponseStatus)
  .then((res) => res.json())
  .then((data) => {
    notes.value = data.notes || notes.value;

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
      await segmentLoading;
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

const recurseGetSegments = (group) => {
  if (group instanceof PeaksGroup) {
    return [...group.visible, ...group.hidden];
  }
  if (group instanceof Group) {
    const segments = [];
    group.children.forEach((child) =>
      segments.push(...recurseGetSegments(child))
    );
    return segments;
  }
};

const fileParagraph = document.getElementById("file");
/**
 * Saves the custom segments, labeled speakers, and associated faces to the database.
 */
const save = () => {
  const faceRegex = /Speaker /;
  const speakers = Object.values(PeaksGroup.byId).filter((speaker) =>
    speaker.id.match(faceRegex)
  );
  const faces = [];
  speakers.forEach((speaker) => {
    // strip face and Speaker so we just have numbers to store
    if (speaker.faceNum !== null) {
      faces.push(
        ...[
          parseInt(speaker.id.replace("Speaker ", "")),
          parseInt(speaker.faceNum.replace("face", "")),
        ]
      );
    }
  });

  const removedFaces = Face.removed;

  removedFaces.forEach((faceNum) =>
    // Speaker -1 represents removed face, because it is impossible to have -1 speaker
    faces.push(...[-1, faceNum])
  );

  // fileParagraph.innerHTML = `${filename} - Saving`;
  const groupRegex = /Speaker |VAD|Non-VAD|Words|SNR-Noise/;
  // only save groups that aren't from the pipeline
  const groups = Object.values(PeaksGroup.byId).filter(
    (group) => !group.id.match(groupRegex)
  );
  let segments = [];
  // array.push(...) is faster than array.concat
  groups.forEach((group) => segments.push(...recurseGetSegments(group)));

  // need to copy the segment properties because
  // otherwise, sending the actual segment causes error
  // because peaks segments store the peaks instance, and
  // the peaks instance stores the segments, infinite recursive error
  segments = segments.map((segment) =>
    segment.getProperties(["text", "duration", "color"])
  );

  // re-number the segments so there aren't gaps in ids from removed segments
  let idCounter = globals.highestId + 1;
  segments
    .map((segment, index) => {
      return { index: index, id: parseInt(segment.id.split(".").at(-1)) };
    })
    .sort((seg1, seg2) => seg1.id - seg2.id)
    .map((seg) => segments[seg.index])
    .forEach((segment) => {
      segment.id = `peaks.segment.${idCounter++}`;
    });

  const customRegex = /Custom Segment /;
  let customCounter = 1;
  sortByProp(segments, "startTime").forEach((segment) => {
    if (segment.labelText.match(customRegex)) {
      segment.labelText = `Custom Segment ${customCounter}`;
      segment.treeText = `Custom Segment ${customCounter}`;
      customCounter++;
    }
  });

  /** DEPRECATED: Things will be able to move between anything
   *  i.e. speaker to vad, new method required
  const movedSegments = recurseGetSegments(Group.byId["Speakers"])
    .filter((segment) => segment.parent.id != originalGroups[segment.id])
    .map((segment) => segment.getProperties(["text", "duration", "color"]));
  segments.push(...movedSegments);
  */

  fetch("save", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      user,
      filename: folderFile,
      segments,
      notes: notes.value,
      faces,
    }),
  })
    .then(checkResponseStatus)
    .then(() => {
      fileParagraph.innerHTML = `${filename} - Saved`;
      globals.dirty = false;
    })
    .catch((error) => {
      fileParagraph.innerHTML = `${filename} - Error while saving`;
      console.error(error);
    });
};

// saves the segments
saveButton.addEventListener("click", save);
// document.querySelector('button[data-action="save"]').addEventListener("click", save);

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
  if (segment.editable) {
    segmentMenu.dataset.id = segment.id;
    // prevent default so that the right click context menu doesn't show
    evt.preventDefault();
    segmentMenu.style.top = `${evt.clientY}px`;
    segmentMenu.style.left = `${evt.clientX}px`;
    segmentMenu.style.display = "block";
  }
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
  undoStorage.push(new Actions.MergeSegmentsAction(segment));
  closeContextMenu(segmentMenu);
});

window.addEventListener("keydown", function (event) {
  // ctrl key for windows, meta key is command for mac
  if (event.ctrlKey || event.metaKey) {
    // following comments use "ctrl + __", same as "cmd + __" for mac
    if (event.key == "s") {
      // ctrl + s is save shortcut
      save();
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
