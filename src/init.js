import Group from "./Group";
import Groups from "./Groups";
import globals from "./globals";
import Segment from "./Segment";
import TreeItem from "./treeItem";

const peaks = globals.peaks;

const createTree = function (id, parent, children, snr) {
    if (!Array.isArray(children[0])) {
        const group = new Group(id, { parent, snr });
        peaks.segments.add(children).forEach(function (segment) {
            new Segment(segment, { parent: group });
        });
    }
    else {
        const group = new Groups(id, { parent });
        for (let [child, childChildren, childSNR] of children) {
            createTree(child, group, childChildren, childSNR);
        }
    }
}

const importedSegments = await fetch(`/segments/${basename}-segments.json`).then(response => response.json());

const segmentsTree = new TreeItem("Segments");
document.getElementById("tree").append(segmentsTree);

new Group("Custom", { parent: segmentsTree });
new Groups("Labled", { parent: segmentsTree });

for (let [group, children, snr] of importedSegments) {
    createTree(group, segmentsTree, children, snr);
    renderGroup(peaks, group, ["Segments"], { "children": children, "snr": snr });
}





const zoomIn = document.querySelector("[data-action='zoom-in']");
const zoomOut = document.querySelector("[data-action='zoom-out']");
zoomIn.innerHTML = zoomInIcon;
zoomOut.innerHTML = zoomOutIcon;
zoomIn.addEventListener('click', function () {
    peaks.zoom.zoomIn();
    const zoomLevel = peaks.zoom.getZoom();
    if (zoomLevel == 0) {
        toggleButton(zoomIn, false);
    }
    else if (zoomLevel == 3) {
        toggleButton(zoomOut, true)
    }
});
zoomOut.addEventListener('click', function () {
    peaks.zoom.zoomOut();
    const zoomLevel = peaks.zoom.getZoom();
    if (zoomLevel == 4) {
        toggleButton(zoomOut, false);
    }
    else if (zoomLevel == 1) {
        toggleButton(zoomIn, true)
    }
});


const seekTime = document.getElementById('seek-time');
const overview = peaks.views.getView('overview');
const zoomview = peaks.views.getView('zoomview');
// Seek
document.querySelector('button[data-action="seek"]').addEventListener('click', function () {
    const seconds = parseFloat(seekTime.value);
    if (!Number.isNaN(seconds)) { peaks.player.seek(seconds); }
});
document.getElementById('enable-seek').addEventListener('change', function () {
    zoomview.enableSeek(this.checked);
    overview.enableSeek(this.checked);
});


document.getElementById('auto-scroll').addEventListener('change', function () { zoomview.enableAutoScroll(this.checked); });


const amplitudeScales = {
    "0": 0.0,
    "1": 0.1,
    "2": 0.25,
    "3": 0.5,
    "4": 0.75,
    "5": 1.0,
    "6": 1.5,
    "7": 2.0,
    "8": 3.0,
    "9": 4.0,
    "10": 5.0
};
document.getElementById('amplitude-scale').addEventListener('input', function () {
    const scale = amplitudeScales[this.value];
    zoomview.setAmplitudeScale(scale);
    overview.setAmplitudeScale(scale);
});


const labelInput = document.getElementById("label");
document.querySelector("button[data-action='add-label']").addEventListener('click', function () {
    renderGroup(peaks, labelInput.value, ["Segments", "Labeled-Speakers"], { "renderEmpty": true, "removable": true });
    labelInput.value = "";  // clear text box after submitting
});


let segmentCounter = 1;
const audioDuration = peaks.player.getDuration();
// Add (custom) segment
document.querySelector('button[data-action="add-segment"]').addEventListener('click', function () {
    const label = 'Custom Segment ' + segmentCounter++;
    const curTime = peaks.player.getCurrentTime();
    const endTime = curTime + 2.5 > audioDuration ? audioDuration : curTime + 2.5;
    let segment = {
        startTime: curTime,
        endTime: endTime,
        labelText: label,
        editable: true,
        treeText: label,
        removable: true,
    };
    segment = peaks.segments.add(segment);
    renderSegment(peaks, segment, "Custom-Segments", ["Segments"]);
    sortTree("Custom-Segments");
    openNested(["Segments", "Custom-Segments"]);
    newChanges = true;
});
document.getElementById("Custom-Segments-span").addEventListener("click", function () { initPopup(peaks, "Custom-Segments") });


const notes = document.getElementById("notes");
(function () {
    const record = { 'user': user, 'filename': fileName }
    const json = JSON.stringify(record);
    var loadRequest = new XMLHttpRequest();

    loadRequest.open('POST', 'load', true);
    loadRequest.setRequestHeader('Content-Type', 'application/json; charset=UTF-8');

    loadRequest.send(json)
    loadRequest.onload = function () {
        let jsonData = JSON.parse(loadRequest.response);

        notes.value = jsonData.notes || notes.value;

        const regex = /Custom Segment /;
        peaks.segments.add(jsonData.segments, { "overwrite": true }).forEach(function (segment) {
            if (segment.id in segmentsByID) {
                changeSpeaker(peaks, segment.path.concat(segment.id), segmentsByID[segment.id].path, segment);
            }
            else {
                renderSegment(peaks, segment, segment.path.at(-1), segment.path.slice(0, -1));
                sortTree(segment.path.at(-2));
            }
            if (segment.labelText.match(regex)) { segmentCounter++; }
        });

        toggleSegments(peaks, "Segments", false);

        document.getElementById("Segments-nested").classList.add("active");

        groupsCheckboxes["Segments"].checked = true;
        groupsCheckboxes["Segments"].addEventListener("click", function () { toggleSegments(peaks, "Segments", this.checked); });

        segmentsPlay.style.pointerEvents = "auto";
        segmentsLoop.style.pointerEvents = "auto";
        const segmentsPlayIcon = segmentsPlay.firstElementChild;
        const segmentsLoopIcon = segmentsLoop.firstElementChild;
        segmentsPlayIcon.style.stroke = "black";
        segmentsPlayIcon.style.fill = "black";
        segmentsLoopIcon.style.stroke = "black";
        segmentsPlay.addEventListener("click", function () { playGroup(peaks, "Segments"); });
        segmentsLoop.addEventListener("click", function () { playGroup(peaks, "Segments", true); });
    };
})();


peaks.on("segments.dragend", function (event) {
    const segment = event.segment;
    const segmentSpan = segment.durationSpan;

    const oldDuration = parseFloat(segmentSpan.title.split(" ").at(-1));
    const newDuration = segment.endTime - segment.startTime;

    segmentSpan.title = `Start time: ${segment.startTime.toFixed(2)}\nEnd time: ${segment.endTime.toFixed(2)}\nDuration: ${(newDuration).toFixed(2)}`;
    updateDuration(segment.path.slice(1), newDuration - oldDuration);

    sortTree(segment.path.at(-2));
    newChanges = true;
});


document.querySelector(`button[data-action="reset-moved"]`).addEventListener("click", function () {
    if (confirm("This will reset all moved speaker segments.\nAre you sure you want to continue?")) {
        const record = { "user": user, "filename": fileName, "highestId": highestId };
        const json = JSON.stringify(record);
        var request = new XMLHttpRequest();
        request.open("DELETE", "reset-moved", true);
        request.setRequestHeader("Content-Type", "application/json; charset=UTF-8");

        request.send(json);
        request.onload = function () {
            location.reload();
        }
    }
});

document.querySelector(`button[data-action="reset"]`).addEventListener("click", function () {
    if (confirm("This will delete ALL saved segments.\nAre you sure you want to continue?")) {
        const record = { "user": user, "filename": fileName };
        const json = JSON.stringify(record);
        var request = new XMLHttpRequest();
        request.open("DELETE", "reset", true);
        request.setRequestHeader("Content-Type", "application/json; charset=UTF-8");

        request.send(json);
        request.onload = function () {
            location.reload();
        }
    }
});


const speedButton = document.getElementById("speed-button");
const speedDropdown = document.getElementById("speed-dropdown");
speedButton.addEventListener("click", function () {
    speedDropdown.classList.toggle("show");
});

const spdbtns = document.getElementsByClassName("spdbtn");
for (let i = 0; i < spdbtns.length; i++) {
    spdbtns[i].addEventListener("click", function () {
        audio.playbackRate = parseFloat(this.innerHTML.replace("x", ""));
    });
}


const settingsButton = document.getElementById("settings-button");
settingsButton.innerHTML = settingsIcon;
const settingsDropdown = document.getElementById("settings-dropdown");
settingsButton.addEventListener("click", function () {
    settingsDropdown.classList.toggle("show");
});


// https://www.w3schools.com/howto/howto_js_dropdown.asp
// Close the dropdown if the user clicks outside of it
const dropdowns = document.getElementsByClassName("dropdown-content");
window.onclick = function (event) {
    if (!speedButton.contains(event.target) && !settingsButton.contains(event.target) && !settingsDropdown.contains(event.target)) {
        for (let i = 0; i < dropdowns.length; i++) {
            const openDropdown = dropdowns[i];
            if (openDropdown.classList.contains('show')) {
                openDropdown.classList.remove('show');
            }
        }
    }
}


// https://stackoverflow.com/a/7317311
window.onload = function () {
    window.addEventListener("beforeunload", function (event) {
      if (!newChanges) { return undefined; }
  
      var confirmationMessage = "You have unsaved changes. If you leave before saving, these changes will be lost.";
      // returnValue and return for cross compatibility 
      (event || window.event).returnValue = confirmationMessage;
      return confirmationMessage;
    });
  };
  
  // Close the dropdown if the user clicks outside of it
  window.onclick = function (event) {
    if (!event.target.matches('.dropbtn')) {
      var dropdowns = document.getElementsByClassName("dropdown-content");
      var i;
      for (i = 0; i < dropdowns.length; i++) {
        var openDropdown = dropdowns[i];
        if (openDropdown.classList.contains('show')) {
          openDropdown.classList.remove('show');
        }
      }
    }
  }