import Split from "split.js"; // library for resizing columns by dragging
import globals from "./globals.js";
import {
  GroupOfGroups,
  Group,
  Segment,
  TreeItem,
  Face,
} from "./treeClasses.js";
import { GraphIMU } from "./graphicalClasses.js";
import SettingsPopup from "./SettingsPopup.js";
import {
  getRandomColor,
  sortByProp,
  toggleButton,
  checkResponseStatus,
} from "./util.js";
import {
  zoomInIcon,
  zoomOutIcon,
  undoIcon,
  redoIcon,
  saveIcon,
  settingsIcon,
} from "./icon.js";

// make tree and viewer columns resizable
Split(["#column", "#column2"], { sizes: [17, 79], snapOffset: 0 });

const peaks = globals.peaks;
const user = globals.user;
const filename = globals.filename;
const basename = globals.basename;
const media = globals.media;
const undoStorage = globals.undoStorage;
// const redoStorage = globals.redoStorage;

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
      const group = new Group(id, { parent, snr, copyTo: ["Labeled"] });
      peaks.segments.add(children).forEach(function (segment) {
        new Segment(segment, {
          parent: group,
          moveTo: ["Speakers"],
          copyTo: ["Labeled"],
        });
        originalGroups[segment.id] = id;
      });
    } else {
      // group is VAD or Non-VAD, which don't need popups
      const group = new Group(id, { parent, snr });
      peaks.segments.add(children).forEach(function (segment) {
        new Segment(segment, { parent: group });
      });
    }
  } else {
    // group of groups
    const group = new GroupOfGroups(id, { parent });
    for (const [child, childChildren, childSNR] of children) {
      createTree(child, group, childChildren, childSNR);
    }
  }
};

const analysis = new GroupOfGroups("Analysis");
document.getElementById("tree").append(analysis.li);

const clusters = new Group("Clusters");
clusters.playButton.style.display = "none";
clusters.loopButton.style.display = "none";
document.getElementById("tree").append(clusters.li);

const custom = new Group("Custom", {
  parent: analysis,
  color: getRandomColor(),
  colorable: true,
});
const labeled = new GroupOfGroups("Labeled", { parent: analysis });

fetch(`/segments/${basename}-segments.json`)
  .then(checkResponseStatus)
  .then((response) => response.json())
  .then((segments) => {
    for (const [group, children, snr] of segments) {
      createTree(group, analysis, children, snr);
    }
    Group.rankSnrs();
    const ids = Object.keys(Segment.byId);
    // since ids are of the form 'peaks.segment.#', parse the # from all of the ids
    const idNums = ids.map((id) => parseInt(id.split(".").at(-1)));
    globals.highestId = Math.max(...idNums); // used when saving to re-number segments

    // after loading, toggle everything off (usually end up
    // disabling most groups right away so just do it automatically)
    analysis.children.forEach((child) => child.toggle(false));
  })
  .catch(() => {
    console.log("No segments for media.");
    globals.highestId = 0;
  });

fetch(`/clustered-files/`)
  .then((res) => {
    if (!res.ok) {
      throw new Error("Network response was not OK");
    } // Network error
    else if (res.status != 200) {
      throw new Error(`${res.status} ${res.statusText}`);
    } // not 200 is error
    return res.json();
  })
  .then((fileList) => {
    const clusterfolders = fileList.cluster; // folder of each found cluster
    // name of the overal folder, same as the video shown in speechviz
    const dir = fileList.dir;
    // default image for each of the faces to show in speechviz
    const images = fileList.images;

    clusterfolders.forEach(function (folderName) {
      var imagePath = images[folderName];
      new Face(folderName, {
        parent: clusters,
        assocWith: ["Speakers"],
        dir: dir,
        imagePath: imagePath,
      });
    });
  })
  .catch(() => {
    console.log("No clustered faces for media.");
  });

fetch(`/transcriptions/${basename}-transcription.json`)
  .then(checkResponseStatus)
  .then((response) => response.json())
  .then((words) => words.map((word) => peaks.points.add(word)))
  .catch(() => console.log("No transcription for media."));

const poseRegex = /pose.*\.csv/;
const visualContainer = document.getElementById("visual");
if (visualContainer) {
  // get the list of files in the graphical dir for the file being visualized
  const dir = `/graphical/${basename}`;
  fetch(dir)
    .then(checkResponseStatus)
    // response is json string containing an array of file names
    .then((response) => response.json())
    .then((files) => {
      if (files.length == 0) {
        throw new Error("No pose data for media.");
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
    .then((texts) =>
      texts.map((text) => {
        return text
          .split("\n")
          .slice(1) // exclude header row
          .map((row) => row.split(",").map(parseFloat));
      })
    )
    .then((data) => {
      let width;
      if (media.offsetWidth > visualContainer.offsetWidth) {
        // video is wider than the column so resize it to fit
        media.width = visualContainer.offsetWidth;
        width = media.width;
      } else {
        // size the GraphIMU so that it fills the rest of the column
        width = visualContainer.offsetWidth - media.offsetWidth;
      }
      const height = media.offsetHeight;
      new GraphIMU(visualContainer, data, { width: width, height: height });
    })
    .catch(() => console.log("No pose data for media."));
}

// code below initializes the interface

const zoomIn = document.getElementById("zoomin");
const zoomOut = document.getElementById("zoomout");
zoomIn.innerHTML = zoomInIcon;
zoomOut.innerHTML = zoomOutIcon;

const undoButton = document.getElementById("undo");
const redoButton = document.getElementById("redo");
undoButton.innerHTML = undoIcon;
redoButton.innerHTML = redoIcon;

const saveButton = document.getElementById("save");
saveButton.innerHTML = saveIcon;

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

// input to add a label group
const labelInput = document.getElementById("label");
document
  .querySelector("button[data-action='add-label']")
  .addEventListener("click", function () {
    if (labelInput.value != "") {
      new Group(labelInput.value, {
        parent: labeled,
        removable: true,
        renamable: true,
        color: getRandomColor(),
        colorable: true,
        copyTo: ["Labeled"],
      });
      labelInput.value = ""; // clear text box after submitting
      labeled.open(); // open labeled in tree to show newly added label
    }
  });

// counts number of custom segments added, used for custom segment's labelText
let segmentCounter = 1;
const audioDuration = peaks.player.getDuration();
document
  .querySelector('button[data-action="add-segment"]')
  .addEventListener("click", function () {
    const label = "Custom Segment " + segmentCounter++;
    const curTime = peaks.player.getCurrentTime();
    // endTime is either 2.5 seconds after current time
    // or the end of the audio (whichever's shortest)
    // if endTime > audioDuration, drag handle for changing
    // segment's endTime is off screen and unusable
    const endTime =
      curTime + 2.5 > audioDuration ? audioDuration : curTime + 2.5;
    let segment = {
      startTime: curTime,
      endTime: endTime,
      labelText: label,
      editable: true,
      treeText: label,
    };
    segment = peaks.segments.add(segment);
    const seg = new Segment(segment, {
      parent: custom,
      removable: true,
      renamable: true,
      moveTo: ["Labeled"],
    });
    undoStorage.push([
      "added segment",
      segment,
      seg.getProperties(["id", "duration", "color", "labelText"]),
    ]);
    // redoStorage.length = 0;  // clear redos
    custom.sort("startTime");
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
      .forEach(function (segment) {
        let parent = segment.path.at(-1);
        if (!(parent in Group.byId)) {
          // parent group doesn't exist yet so add it
          parent = new Group(parent, {
            parent: GroupOfGroups.byId[segment.path.at(-2)],
            removable: true,
            renamable: true,
            color: getRandomColor(),
            colorable: true,
            copyTo: ["Labeled"],
          });
        } else {
          parent = Group.byId[parent];
        }

        if (segment.id in Segment.byId) {
          // segment is a moved segment
          const treeSegment = Segment.byId[segment.id];
          treeSegment.segment = segment;
          treeSegment.parent = parent;
        } else {
          new Segment(segment, {
            parent: parent,
            removable: true,
            renamable: true,
            moveTo: ["Labeled"],
          });
        }
        parent.sort("startTime");

        if (segment.labelText.match(regex)) {
          segmentCounter++;
        }
      });

    // after loading, toggle everything off (usually end up
    // disabling most groups right away, just do it automatically)
    analysis.children.forEach((child) => child.toggle(false));
  })
  .catch((error) => console.error(error)); // catch err thrown by res if any

peaks.on("segments.dragstart", function (event) {
  undoStorage.push([
    "dragged",
    event.segment.id,
    event.segment.endTime,
    event.segment.startTime,
  ]);
  // redoStorage.length = 0;  // clear redos
});

peaks.on("segments.dragend", function (event) {
  const id = event.segment.id;
  Segment.byId[id].updateDuration();
});

// TODO: make undo use enum instead of strings
// TODO: make undo a singleton array subclass ?
// TODO: resort a group after re-adding segments to it
const undo = function () {
  if (undoStorage.length != 0) {
    const undoThing = undoStorage.pop();
    if (undoThing[0] == "deleted segment") {
      // unpack undoThing (ignoring first element)
      const [, peaksSegment, options] = undoThing;
      Object.assign(options, { parent: TreeItem.byId[options.path.at(-1)] });
      const segment = new Segment(peaks.segments.add(peaksSegment), options);
      segment.parent.sort("startTime");
    } else if (undoThing[0] == "deleted group") {
      // unpack undoThing (ignoring first element)
      const [, id, options] = undoThing;
      Object.assign(options, { parent: TreeItem.byId[options.path.at(-1)] });
      new Group(id, options);
      while (
        undoStorage.length != 0 &&
        undoStorage.at(-1)[0] == "deleted segment" &&
        undoStorage.at(-1)[3]
      ) {
        undo();
      }
    } else if (undoThing[0] == "moved") {
      const parent = TreeItem.byId[undoThing[2]];
      TreeItem.byId[undoThing[1]].parent = parent;
      parent.sort("startTime");
    } else if (undoThing[0] == "copied") {
      while (undoThing[1].length != 0) {
        TreeItem.byId[undoThing[1].pop()].remove();
      }
    } else if (undoThing[0] == "renamed") {
      TreeItem.byId[undoThing[1]].rename(undoThing[2]);
    } else if (undoThing[0] == "dragged") {
      Segment.byId[undoThing[1]].endTime = undoThing[2];
      Segment.byId[undoThing[1]].startTime = undoThing[3];
      Segment.byId[undoThing[1]].updateDuration();
    } else if (undoThing[0] == "added segment") {
      // redoStorage.push(undoThing)
      Segment.byId[undoThing[1].id].remove();
    } else {
      console.log("SOME OTHER CASE FOR UNDOTHING HAS COME OUT");
      console.log(undoThing[0]);
    }
  }
};

undoButton.addEventListener("click", undo);
// document.querySelector('button[data-action="undo"]').addEventListener('click', undo);

// document.querySelector('button[data-action="redo"]')
//   .addEventListener('click', function () {
//     if (redoStorage.length != 0){
//         console.log(redoStorage);
//         let redoThing = redoStorage.pop();
//         if (redoThing[0] == "added segment") {
//             undoStorage.push(redoThing);
//             // unpack undoThing (ignoring first element)
//             const [, peaksSegment, options] = redoThing;
//             Object.assign(options, { parent: TreeItem.byId[options.path.at(-1)] });
//             const segment = new Segment(peaks.segments.add(peaksSegment), options);
//             segment.parent.sort("startTime");
//         }
//     }
// });

const fileParagraph = document.getElementById("file");
/** Saves the custom segments and labeled speakers to the database. */
const save = function () {
  // fileParagraph.innerHTML = `${filename} - Saving`;
  const groupRegex = /Speaker |VAD|Non-VAD/;
  // only save groups that aren't from the pipeline
  const groups = Object.values(Group.byId).filter(
    (group) => !group.id.match(groupRegex)
  );
  let segments = [];
  // array.push(...) is faster than array.concat
  groups.forEach((group) =>
    segments.push(...group.getSegments({ hidden: true, visible: true }))
  );

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

  const movedSegments = GroupOfGroups.byId["Speakers"]
    .getSegments({ hidden: true, visible: true })
    .filter((segment) => segment.parent.id != originalGroups[segment.id])
    .map((segment) => segment.getProperties(["text", "duration", "color"]));
  segments.push(...movedSegments);

  fetch("save", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ user, filename, segments, notes: notes.value }),
  })
    .then(checkResponseStatus)
    .then(() => (fileParagraph.innerHTML = `${filename} - Saved`))
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
        console.log("ctrl + shift + z");
        event.preventDefault();
      } else {
        // ctrl + z is undo shortcut
        undo();
        event.preventDefault();
      }
    } else if (event.key == "y") {
      // ctrl + y is redo shortcut
      console.log("ctrl + y");
      event.preventDefault();
    }
  }
});

// // https://stackoverflow.com/a/7317311
// // warns user when they try to close page that they have unsaved changes
// window.onload = function () {
//     window.addEventListener("beforeunload", function (event) {
//         if (!newChanges) { return undefined; }

//         var confirmationMessage = "You have unsaved changes. "
//              + "If you leave before saving, these changes will be lost.";
//         // returnValue and return for cross compatibility
//         (event || window.event).returnValue = confirmationMessage;
//         return confirmationMessage;
//     });
// };
