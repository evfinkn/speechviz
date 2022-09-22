import Split from 'split.js';
import globals from "./globals";
import { Groups, Group, Segment } from "./treeClasses";
import { getRandomColor, toggleButton } from "./util";
import { zoomInIcon, zoomOutIcon, settingsIcon } from "./icon";

Split(["#column", "#column2"], { sizes: [17, 79], snapOffset: 0 });

const peaks = globals.peaks;
const user = globals.user;
const filename = globals.filename;

const createTree = function (id, parent, children, snr) {
    if (!Array.isArray(children[0])) {  // group of segments
        if (id.includes("Speaker ")) {  // group is speakers, which need popups
            const group = new Group(id, { parent, snr, copyTo: ["Labeled"] });
            peaks.segments.add(children).forEach(function (segment) {
                new Segment(segment, { parent: group, moveTo: ["Speakers"], copyTo: ["Labeled"] });
            });
        }
        else {  // group is VAD or Non-VAD, which don't need popups
            const group = new Group(id, { parent, snr });
            peaks.segments.add(children).forEach(function (segment) {
                new Segment(segment, { parent: group });
            });
        }
    }
    else {  // group of groups
        const group = new Groups(id, { parent });
        for (let [child, childChildren, childSNR] of children) {
            createTree(child, group, childChildren, childSNR);
        }
    }
}

const importedSegments = await fetch(`/segments/${globals.basename}-segments.json`).then(response => response.json());

const segmentsTree = new Groups("Segments");
document.getElementById("tree").append(segmentsTree.li);

const custom = new Group("Custom", { parent: segmentsTree, color: getRandomColor() });
const labeled = new Groups("Labeled", { parent: segmentsTree });

for (let [group, children, snr] of importedSegments) {
    createTree(group, segmentsTree, children, snr);
}

Group.rankSnrs();

const ids = Object.keys(Segment.byId);
// since ids are of the form 'peaks.segment.#', parse the # from all of the ids
const idNums = ids.map(id => parseInt(id.split(".").at(-1)));
const highestId = Math.max(...idNums);  // used when saving to re-number segment ids to fill in gaps



// code below initializes the interface

const zoomIn = document.querySelector("[data-action='zoom-in']");
const zoomOut = document.querySelector("[data-action='zoom-out']");
zoomIn.innerHTML = zoomInIcon;
zoomOut.innerHTML = zoomOutIcon;
zoomIn.addEventListener('click', function () {
    peaks.zoom.zoomIn();
    const zoomLevel = peaks.zoom.getZoom();
    if (zoomLevel == 0) {  // can't zoom in any further, disable zoom in button
        toggleButton(zoomIn, false);
    }
    else if (zoomLevel == 3) {  // not at max zoom out level, enable zoom out button
        toggleButton(zoomOut, true)
    }
});
zoomOut.addEventListener('click', function () {
    peaks.zoom.zoomOut();
    const zoomLevel = peaks.zoom.getZoom();
    if (zoomLevel == 4) {  // can't zoom out any further, disable zoom out button
        toggleButton(zoomOut, false);
    }
    else if (zoomLevel == 1) {  // not at max zoom in level, enable zoom in button
        toggleButton(zoomIn, true)
    }
});

// utility to jump to an input time
const seekTime = document.getElementById('seek-time');
document.querySelector('button[data-action="seek"]').addEventListener('click', function () {
    const seconds = parseFloat(seekTime.value);
    if (!Number.isNaN(seconds)) { peaks.player.seek(seconds); }
});

// setting to enable seeking (clicking peaks to jump to a time)
const overview = peaks.views.getView('overview');
const zoomview = peaks.views.getView('zoomview');
document.getElementById('enable-seek').addEventListener('change', function () {
    zoomview.enableSeek(this.checked);
    overview.enableSeek(this.checked);
});

// setting to enable auto-scroll (peaks viewer moves forward with audio)
document.getElementById('auto-scroll').addEventListener('change', function () { zoomview.enableAutoScroll(this.checked); });

// setting to change size of waveform amplitudes (how tall the peaks of the waveform are)
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

// input to add a label group
const labelInput = document.getElementById("label");
document.querySelector("button[data-action='add-label']").addEventListener('click', function () {
    if (labelInput.value != "") {
        new Group(labelInput.value, { parent: labeled, removable: true, renamable: true, color: getRandomColor(), copyTo: ["Labeled"] });
        labelInput.value = "";  // clear text box after submitting
        labeled.open();  // open labeled in tree to show newly added label
    }
});


let segmentCounter = 1;  // counts number of custom segments added, used for custom segment's labelText
const audioDuration = peaks.player.getDuration();
document.querySelector('button[data-action="add-segment"]').addEventListener('click', function () {
    const label = 'Custom Segment ' + segmentCounter++;
    const curTime = peaks.player.getCurrentTime();
    // endTime is either 2.5 seconds after current time or the end of the audio (whichever's shortest)
    // if endTime > audioDuration, drag handle for changing segment's endTime is off screen and unusable
    const endTime = curTime + 2.5 > audioDuration ? audioDuration : curTime + 2.5;
    let segment = {
        startTime: curTime,
        endTime: endTime,
        labelText: label,
        editable: true,
        treeText: label,
    };
    segment = peaks.segments.add(segment);
    new Segment(segment, { parent: custom, removable: true, renamable: true, moveTo: ["Labeled"] });
    custom.sort("startTime");
    custom.open();  // open custom in tree to show newly added segment
});


const notes = document.getElementById("notes");
// load the segments from the database
(function () {
    const record = { 'user': user, 'filename': filename }
    const json = JSON.stringify(record);
    var loadRequest = new XMLHttpRequest();

    loadRequest.open('POST', 'load', true);
    loadRequest.setRequestHeader('Content-Type', 'application/json; charset=UTF-8');

    loadRequest.send(json);
    loadRequest.onload = function () {
        const jsonData = JSON.parse(loadRequest.response);

        notes.value = jsonData.notes || notes.value;

        const regex = /Custom Segment /;
        peaks.segments.add(jsonData.segments, { "overwrite": true }).forEach(function (segment) {
            let parent = segment.path.at(-1);
            if (!(parent in Group.byId)) {  // parent group doesn't exist yet so add it
                parent = new Group(parent, { parent: Groups.byId[segment.path.at(-2)], removable: true, renamable: true, color: getRandomColor(), copyTo: ["Labeled"] });
            }
            else { parent = Group.byId[parent]; }

            if (segment.id in Segment.byId) {  // segment is a moved segment
                const treeSegment = Segment.byId[segment.id];
                treeSegment.segment = segment;
                treeSegment.parent = parent;
            }
            else { new Segment(segment, { parent, removable: true, renamable: true, moveTo: ["Labeled"] }); }
            parent.sort("startTime");

            if (segment.labelText.match(regex)) { segmentCounter++; }
        });

        // after loading, toggle everything off (usually end up disabling most groups right away, just do it automatically)
        segmentsTree.children.forEach(child => child.toggle(false));
    };
})();


peaks.on("segments.dragend", function (event) {
    const id = event.segment.id;
    Segment.byId[id].updateDuration();
});

// saves the segments
document.querySelector('button[data-action="save"]').addEventListener("click", function () {
    const groupRegex = /Speaker |VAD|Non-VAD/;
    // only save groups that aren't from the pipeline
    const groups = Object.values(Group.byId).filter(group => !group.id.match(groupRegex));
    let segments = [];
    // array.push(...) is faster than array.concat
    groups.forEach(group => segments.push(...group.getSegments({ hidden: true, visible: true })));

    // need to copy the segment properties because otherwise, sending the actual segment causes error 
    // because peaks segments store the peaks instance, and the peaks instance stores the segments, infinite recursive error
    segments = segments.map(segment => segment.toSimple(["color"]));

    // re-number the segments so there aren't gaps in ids from removed segments
    const customRegex = /Custom Segment /;
    let idCounter = 1;
    segments.map((segment, index) => { return { "index": index, "id": parseInt(segment.id.split(".").at(-1)) }; })
        .sort((seg1, seg2) => seg1.id - seg2.id)
        .map(seg => segments[seg.index])
        .forEach(function (segment) {
            segment.id = `peaks.segment.${highestId + idCounter}`;
            if (segment.labelText.match(customRegex)) {
                segment.labelText = `Custom Segment ${idCounter}`;
            } 
            if (segment.treeText.match(customRegex)) {
                segment.treeText = `Custom Segment ${idCounter}`;
            }
            idCounter++;
        });

    // // can this next section just be done above???
    // // if not, wouldn't it be easier to just update all of the custom segments and use their
    // // id instead of needing numCustom and customChanged???
    // // re-label custom segments with new numbers
    // let numCustom = 1;
    // const customChanged = {};
    // segments.forEach(function (segment) {
    //     if (segment.labelText in customChanged) {
    //         segment.labelText = customChanged[segment.labelText];
    //     }
    //     else if (segment.labelText.match(customRegex)) {
    //         const nextCustom = `Custom Segment ${numCustom++}`;
    //         customChanged[segment.labelText] = nextCustom;
    //         segment.labelText = nextCustom;
    //     }
    //     if (segment.treeText in customChanged) {
    //         segment.treeText = customChanged[segment.treeText];
    //     }
    //     else if (segment.treeText.match(customRegex)) {
    //         const nextCustom = `Custom Segment ${numCustom++}`;
    //         customChanged[segment.treeText] = nextCustom;
    //         segment.treeText = nextCustom;
    //     }
    // })

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
});

// resets all of the pipeline segments that have been moved from one group to another
document.querySelector(`button[data-action="reset-moved"]`).addEventListener("click", function () {
    if (confirm("This will reset all moved speaker segments.\nAre you sure you want to continue?")) {
        const record = { "user": user, "filename": filename, "highestId": highestId };
        const json = JSON.stringify(record);
        var request = new XMLHttpRequest();
        request.open("DELETE", "reset-moved", true);
        request.setRequestHeader("Content-Type", "application/json; charset=UTF-8");

        request.send(json);
        request.onload = function () {
            location.reload();  // reload the page to reset the moved segments on the page
        }
    }
});

// deletes all saved segments
document.querySelector(`button[data-action="reset"]`).addEventListener("click", function () {
    if (confirm("This will delete ALL saved segments.\nAre you sure you want to continue?")) {
        const record = { "user": user, "filename": filename };
        const json = JSON.stringify(record);
        var request = new XMLHttpRequest();
        request.open("DELETE", "reset", true);
        request.setRequestHeader("Content-Type", "application/json; charset=UTF-8");

        request.send(json);
        request.onload = function () {
            location.reload();  // reload the page to remove all of the saved segments from the page
        }
    }
});

// setting to change the speed at which the media plays
const speedButton = document.getElementById("speed-button");
const speedDropdown = document.getElementById("speed-dropdown");
speedButton.addEventListener("click", function () {
    speedDropdown.classList.toggle("show");
});

const media = document.getElementById("media");
const spdbtns = document.getElementsByClassName("spdbtn");
for (let i = 0; i < spdbtns.length; i++) {
    spdbtns[i].addEventListener("click", function () {
        media.playbackRate = parseFloat(this.innerHTML.replace("x", ""));
    });
}

// button containing the settings that aren't usually changed
// putting these settings in a dropdown makes interface less crowded
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
// // warns user when they try to close page that they have unsaved changes
// window.onload = function () {
//     window.addEventListener("beforeunload", function (event) {
//         if (!newChanges) { return undefined; }

//         var confirmationMessage = "You have unsaved changes. If you leave before saving, these changes will be lost.";
//         // returnValue and return for cross compatibility 
//         (event || window.event).returnValue = confirmationMessage;
//         return confirmationMessage;
//     });
// };