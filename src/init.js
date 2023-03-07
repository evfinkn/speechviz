import Split from "split.js"; // library for resizing columns by dragging
import globals from "./globals.js";
import { Group, Segment, PeaksGroup, Face, Word, Run } from "./treeClasses.js";
import { GraphIMU } from "./graphicalClasses.js";
import SettingsPopup from "./SettingsPopup.js";
import { undoStorage, redoStorage, Actions } from "./UndoRedo.js";
import {
  arrayMean,
  objectMap,
  getRandomColor,
  sortByProp,
  toggleButton,
  ResponseError,
  checkResponseStatus,
  parseNumericalCsv,
  htmlToElement,
  removeExtension,
} from "./util.js";
import { zoomInIcon, zoomOutIcon, saveIcon, settingsIcon } from "./icon.js";

// make tree and viewer columns resizable
Split(["#column", "#column2"], { sizes: [17, 79], snapOffset: 0 });

const peaks = globals.peaks;
const user = globals.user;
const filename = globals.filename;
const basename = globals.basename;
const media = globals.media;
const folder = globals.folder;

// TODO: if this does what I assume it does, it can
//       probably be moved to Segment as a property
const originalGroups = {};

// TODO: edit how process_audio.py outputs segments and then edit this to make it more
//       extensibile, e.g. maybe in process_audio make each dict have a "type" property
//       specifying if it's a Group or GroupOfGroups or Segment and also use property
//       names e.g. "children" instead of an array
//       After rewriting, add documentation if left as a function
const createTree = function (id, parent, children, snr) {
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
      // group is VAD or Non-VAD, which don't need popups
      const group = new PeaksGroup(id, { parent, snr });
      peaks.segments.add(children).forEach((segment) => {
        new Segment(segment, { parent: group });
      });
    }
  } else {
    // group of groups
    const group = new Group(id, { parent, playable: true });
    for (const [child, childChildren, childSNR] of children) {
      createTree(child, group, childChildren, childSNR);
    }
  }
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
    return;
  } // no groups have SNRs

  const snrs = {};
  const durations = {};
  groups.forEach((group) => {
    snrs[group.id] = group.snr;
    durations[group.id] = group.duration;
  });

  // add the numbers in the circles next to the text of the speakers in the tree
  // decreasing order because want highest snr to be 1
  sortByProp(groups, "snr", true);
  for (let i = 0; i < groups.length; i++) {
    // uses HTML symbol codes for the circled numbers
    // (can be found at https://www.htmlsymbols.xyz/search?q=circled)
    // numbers 1 - 20 use 9312 - 9331 (inclusive),
    // numbers 21 - 35 use 12881 - 12895 (inclusive)
    // should probably add case for numbers 36 - 50?
    // Extremely unlikely ever have that many speakers but still
    groups[i].text = `&#${(i <= 19 ? 9312 : 12861) + i} ${groups[i].text}`;
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

const analysis = new Group("Analysis", { playable: true });
document.getElementById("tree").append(analysis.li);

const custom = new PeaksGroup("Custom", {
  parent: analysis,
  color: getRandomColor(),
  colorable: true,
});
const labeled = new Group("Labeled", { parent: analysis, playable: true });

if (folder !== undefined && folder !== null) {
  // in a folder
  console.log("the file was a folder");
  const runs = new Group("Runs", { playable: false });
  document.getElementById("tree").append(runs.li);
  console.log(`audio/${folder}`);
  fetch(`audio/${folder}`)
    .then(checkResponseStatus)
    .then((response) => response.json())
    .then((fileList) => {
      fileList.forEach((run) => {
        new Run(run, { parent: runs });
      });
      runs.children.sort(function (a, b) {
        function getRunNum(aOrB) {
          const fileAndExt = aOrB.id.split(".");
          const file = fileAndExt[0];
          const number = file.replace("run", "");
          return parseInt(number);
        }
        return getRunNum(a) - getRunNum(b);
      });
      runs.children.forEach((child) => {
        runs.nested.append(child.li);
        const childBasename = removeExtension(child.id);
        if (childBasename === basename) {
          // make radio button of audio selected
          child.toggle();
        }
        console.log(child);
        child.addEventListener("click", function () {
          window.location.href = window.location.href.replace(
            `file=${basename}`,
            `file=${childBasename}`
          );
        });
      });
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

let channelsFetch = `/channels/${basename}-channels.csv`;
if (folder !== undefined && folder !== null) {
  channelsFetch = `/channels/${folder}/${basename}-channels.csv`;
}
fetch(channelsFetch)
  .then(checkResponseStatus)
  .then((res) => res.text())
  .then((channelsText) => {
    const channelNames = channelsText.split("\n").slice(0, -1);
    const numChannels = channelNames.length;
    if (numChannels <= 1) {
      return;
    }

    // resize peaks so that the waveforms aren't so small
    const zoomview = document.getElementById("zoomview-container");
    const overview = document.getElementById("overview-container");
    zoomview.style.height = `${
      zoomview.scrollHeight * Math.log2(numChannels)
    }px`;
    overview.style.height = `${
      overview.scrollHeight * Math.log2(numChannels)
    }px`;
    peaks.views.getView("zoomview").fitToContainer();
    peaks.views.getView("overview").fitToContainer();

    const context = new AudioContext();
    // source is the audio from the <audio> or <video> element being visualized
    const source = context.createMediaElementSource(globals.media);
    const splitter = context.createChannelSplitter(numChannels);
    const merger = context.createChannelMerger(numChannels);

    source.connect(splitter);
    const controlsDiv = document.getElementById("controls");
    // create volume controls for each channel
    for (let i = 0; i < numChannels; i++) {
      // create the gain node that actually controls the volume
      const gainNode = context.createGain();
      splitter.connect(gainNode, i); // connect splitter's ith channel to a gain node
      gainNode.connect(merger, 0, i); // connect the gain node to merger's ith channel

      // create the volume slider
      const label = htmlToElement(`<label>${channelNames[i]}: </label>`);
      // gain nodes volumes are between 0 and 1
      const slider = htmlToElement(
        `<input type="range" min="0" max="1" step="0.01">`
      );
      slider.value = "1"; // default volume is 100%
      label.appendChild(slider);
      slider.addEventListener("input", () => {
        gainNode.gain.value = parseFloat(slider.value);
      });
      controlsDiv.append(label);
      controlsDiv.append(document.createElement("br"));
    }
    // connect the re-merged audio to the user's audio output device
    merger.connect(context.destination);
  })
  .catch((error) => output404OrError(error, "channels"));

let segmentsFetch = `/segments/${basename}-segments.json`;
if (folder !== undefined && folder !== null) {
  segmentsFetch = `/segments/${folder}/${basename}-segments.json`;
}
const segmentLoading = fetch(segmentsFetch)
  .then(checkResponseStatus)
  .then((response) => response.json())
  .then((segments) => {
    for (const [group, children, snr] of segments) {
      createTree(group, analysis, children, snr);
    }
    const speakers = Group.byId["Speakers"];
    speakers.children.forEach((speaker) => {
      speaker.copyTo.push(labeled.children);
      speaker.children.forEach((segment) => {
        segment.moveTo.push(speakers.children);
        segment.copyTo.push(labeled.children);
      });
    });
    rankSnrs();
    const ids = Object.keys(Segment.byId);
    // since ids are of the form 'peaks.segment.#', parse the # from all of the ids
    const idNums = ids.map((id) => parseInt(id.split(".").at(-1)));
    globals.highestId = Math.max(...idNums); // used when saving to re-number segments

    // after loading, toggle everything off (usually end up
    // disabling most groups right away so just do it automatically)
    analysis.children.forEach((child) => child.toggle(false));
  })
  .catch((error) => {
    output404OrError(error, "segments");
    globals.highestId = 0;
  });

const facesLoading = fetch(`/clustered-files/`)
  .then(checkResponseStatus)
  .then((response) => response.json())
  .then((fileList) => {
    const clusters = new Group("Clusters", { playable: false });
    document.getElementById("tree").append(clusters.li);
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

let transcripFetch = `/transcriptions/${basename}-transcription.json`;
if (folder !== undefined && folder !== null) {
  transcripFetch = `/transcriptions/${folder}/${basename}-transcription.json`;
}
fetch(transcripFetch)
  .then(checkResponseStatus)
  .then((response) => response.json())
  .then((words) => {
    const wordsGroup = new PeaksGroup("Words", {
      parent: analysis,
      playable: false,
      color: "#00000000",
    });
    // words.map((word) => {
    //   word["color"] = "#00000000";
    //   peaks.points.add(word);
    // })
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

fetch("load", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=UTF-8" },
  body: JSON.stringify({ user, filename }),
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
        parent.sort("startTime");

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
  const groupRegex = /Speaker |VAD|Non-VAD|Words/;
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

  const movedSegments = recurseGetSegments(Group.byId["Speakers"])
    .filter((segment) => segment.parent.id != originalGroups[segment.id])
    .map((segment) => segment.getProperties(["text", "duration", "color"]));
  segments.push(...movedSegments);

  fetch("save", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      user,
      filename,
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
