import Group from "./Group";
import Groups from "./Groups";
import globals from "./globals";
import Segment from "./Segment";

import { zoomInIcon, zoomOutIcon, settingsIcon } from "./icon";

const peaks = globals.peaks;
const user = globals.user;
const filename = globals.filename;

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

const importedSegments = await fetch(`/segments/${globals.basename}-segments.json`).then(response => response.json());

const segmentsTree = new Groups("Segments");
document.getElementById("tree").append(segmentsTree.li);

const custom = new Group("Custom", { parent: segmentsTree });
const labeled = new Groups("Labled", { parent: segmentsTree });

for (let [group, children, snr] of importedSegments) {
    createTree(group, segmentsTree, children, snr);
}

Group.rankSnrs();
const highestId = Segment.highestId;

// segmentsTree.children.forEach(child => child.toggle(false));






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
document.querySelector('button[data-action="seek"]').addEventListener('click', function () {
    const seconds = parseFloat(seekTime.value);
    if (!Number.isNaN(seconds)) { peaks.player.seek(seconds); }
});

const overview = peaks.views.getView('overview');
const zoomview = peaks.views.getView('zoomview');
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
    new Group(labelInput.value, { parent: labeled, removable: true });
    labelInput.value = "";  // clear text box after submitting
});


let segmentCounter = 1;
const audioDuration = peaks.player.getDuration();
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
    new Segment(segment, { parent: custom })
    custom.sort("startTime");
    custom.open();

    // newChanges = true;
});


const notes = document.getElementById("notes");

(function () {
    const record = { 'user': user, 'filename': filename }
    const json = JSON.stringify(record);
    var loadRequest = new XMLHttpRequest();

    loadRequest.open('POST', 'load', true);
    loadRequest.setRequestHeader('Content-Type', 'application/json; charset=UTF-8');

    loadRequest.send(json)
    loadRequest.onload = function () {
        const jsonData = JSON.parse(loadRequest.response);

        notes.value = jsonData.notes || notes.value;

        const regex = /Custom Segment /;
        peaks.segments.add(jsonData.segments, { "overwrite": true }).forEach(function (segment) {
            let parent = segment.path.at(-1);
            if (!(parent in Group.byId)) {
                parent = new Group(parent, { parent: Groups.byId[segment.path.at(-2)] })
            }
            else { parent = Group.byId[parent]; }

            if (segment.id in Segment.byId) {
                const treeSegment = Segment.byId[segment.id];
                treeSegment.segment = segment;
                treeSegment.parent = parent;
            }
            else {
                new Segment(segment, { parent });
            }
            parent.sort("startTime");

            if (segment.labelText.match(regex)) { segmentCounter++; }
        });

        segmentsTree.children.forEach(child => child.toggle(false));
    };
})();


peaks.on("segments.dragend", function (event) {
    const id = event.segment.id;
    Segment.byId[id].updateDuration();
    // newChanges = true;
});


document.querySelector('button[data-action="save"]').addEventListener("click", function () {
    const groupRegex = /Speaker |VAD|Non-VAD/;
    const groups = Object.values(Group.byId).filter(group => !group.id.match(groupRegex));
    let segments = [];
    groups.forEach(group => segments.push(...group.getSegments({ hidden: true, visible: true })));

    segments = segments.map(segment => segment.toSimple(["color"]));

    let idCounter = highestId + 1;
    segments.map((segment, index) => { return { "index": index, "id": parseInt(segment.id.split(".").at(-1)) }; })
        .sort((seg1, seg2) => seg1.id - seg2.id)
        .map(seg => segments[seg.index])
        .forEach(function (segment) { segment.id = `peaks.segment.${idCounter++}`; });

    const customRegex = /Custom Segment /;
    let numCustom = 1;
    const customChanged = {};
    segments.forEach(function (segment) {
        if (segment.labelText in customChanged) {
            segment.labelText = customChanged[segment.labelText];
        }
        else if (segment.labelText.match(customRegex)) {
            const nextCustom = `Custom Segment ${numCustom++}`;
            customChanged[segment.labelText] = nextCustom;
            segment.labelText = nextCustom;
        }
        if (segment.treeText in customChanged) {
            segment.treeText = customChanged[segment.treeText];
        }
        else if (segment.treeText.match(customRegex)) {
            const nextCustom = `Custom Segment ${numCustom++}`;
            customChanged[segment.treeText] = nextCustom;
            segment.treeText = nextCustom;
        }
    })

    const record = { 'user': user, 'filename': filename, 'segments': segments, "notes": notes.value }
    const json = JSON.stringify(record);
    var request = new XMLHttpRequest();
    request.open('POST', 'save', true);
    request.setRequestHeader('Content-Type', 'application/json; charset=UTF-8');

    request.send(json);
    request.onload = function () {
        // done
        console.log('Annotations saved');
    };
    // newChanges = false;
});


document.querySelector(`button[data-action="reset-moved"]`).addEventListener("click", function () {
    if (confirm("This will reset all moved speaker segments.\nAre you sure you want to continue?")) {
        const record = { "user": user, "filename": filename, "highestId": highestId };
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
        const record = { "user": user, "filename": filename };
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


// // https://stackoverflow.com/a/7317311
// window.onload = function () {
//     window.addEventListener("beforeunload", function (event) {
//         if (!newChanges) { return undefined; }

//         var confirmationMessage = "You have unsaved changes. If you leave before saving, these changes will be lost.";
//         // returnValue and return for cross compatibility 
//         (event || window.event).returnValue = confirmationMessage;
//         return confirmationMessage;
//     });
// };