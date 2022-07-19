import Peaks from "peaks.js";
import { getRandomColor, htmlToElement, compareProperty, propertiesEqual, copySegment } from "./util";
const feather = require('feather-icons');

const audio = document.getElementById('audio');

var snrs = {};
var durations = {};

let newChanges = false;



const runPeaks = async function (fileName) {
  const name = fileName.replace(/\.[^/.]+$/, "");  // name of the file without the extension

  /* importedSegments is an array of groups or segments
  A group is an array, with the first element being the name of the group and
  the second element being an array of groups or an array of segments (objects).
  Example:
  [ 
    ["Speakers",
      [
        ["Speaker 1", [{...}, {...}, {...}]],
        ["Speaker 2", [{...}]]
      ]
    ],
    ["VAD", [{...}, {...}, {...}]],
    ["Non-VAD", [{...}, {...}]]
  ]   */
  const importedSegments = await fetch(`/segments/${name}-segments.json`).then(response => response.json());

  // object containing ALL segments (hidden and visible)    {id: segment}
  const segmentsByID = {};
  // segments that aren't visible on peaksjs    {group: {childGroup: {...: {id, segment}}}}
  const hiddenSegments = {};
  // segments that are visible on peaksjs       {group: {childGroup: {...: {id, segment}}}}
  const visibleSegments = {};

  // dictionary of checkboxes for every group     {group: HTMLInputElement}
  const groupsCheckboxes = { "Segments": document.querySelector("input[data-id='Segments']") };
  // dictionary of buttons for every group        {group: [HTMLLinkElement for play, HTMLLinkElement for loop]}
  const groupsButtons = { "Segments": document.querySelectorAll("a[data-id='Segments']") };
  // dictionary of colors for every group         {group: "#rrggbb"}
  const groupsColors = {};

  const moved = {};



  const segmentsFromGroup = function (group, { visible = false, hidden = false, sort = false, simple = false } = {}) {
    let segments = [];

    if (!(group in visibleSegments)) {  // group is a group of groups
      const children = groupsCheckboxes[group].dataset.children;
      if (children) {
        for (let child of children.split("|")) {
          segments = segments.concat(segmentsFromGroup(child, arguments[1]));  // get the groups from the children
        }
      }
    }
    else {  // group is a group of segments
      if (visible) { segments = Object.values(visibleSegments[group]); }  // get segments from visibleSegments
      if (hidden) { segments = segments.concat(Object.values(hiddenSegments[group])); }  // get segments from hiddenSegments
    }
    if (sort) { segments.sort((seg1, seg2) => compareProperty(seg1, seg2, "startTime")); }  // sort by start time
    if (simple) {
      segments = segments.map(segment => {
        const copied = copySegment(segment);
        Object.assign(copied, { "path": segment.path.slice(0, -1) });
        return copied;
      });
    }
    return segments;
  }

  //#region playing segments and groups
  const segmentPlayIcon = feather.icons.play.toSvg({ "width": 12, "height": 12, "stroke": "black", "fill": "black" });
  const segmentPauseIcon = feather.icons.pause.toSvg({ "width": 12, "height": 12, "stroke": "black", "fill": "black" });
  const segmentLoopIcon = feather.icons.repeat.toSvg({ "width": 12, "height": 12, "stroke": "black", "stroke-width": 2.5 });
  const segmentRemoveIcon = feather.icons.x.toSvg({ "width": 15, "height": 15, "stroke": "black", "stroke-width": 2.5 });

  const playSegment = function (peaks, segment, loop = false) {
    // Have to put in event listener because need to call
    // peaks.player.pause() to switch other pause buttons 
    // back to play buttons, but pausing without
    // the event listener instantly changes the new pause
    // button (from this function call) to change back to
    // a play button.
    peaks.once("player.pause", function () {
      if (typeof segment == "string") {  // segment is an id
        segment = peaks.segments.getSegment();
      }
      peaks.player.playSegment(segment, loop);
      const button = loop ? segment.buttons[1] : segment.buttons[0];
      button.innerHTML = segmentPauseIcon;

      const pause = function () { peaks.player.pause(); }
      button.addEventListener("click", pause, { once: true });
      peaks.once("player.pause", function () {
        button.innerHTML = loop ? segmentLoopIcon : segmentPlayIcon;
        button.removeEventListener("click", pause);
        button.addEventListener("click", function () { playSegment(peaks, segment, loop); }, { once: true });
      });
    });
    // peaks.player.pause() only pauses if playing, so have to play audio if not already
    if (!peaks.player.isPlaying()) { peaks.player.play(); }
    peaks.player.pause();
  }



  const groupPlayIcon = feather.icons.play.toSvg({ "width": 15, "height": 15, "stroke": "black", "fill": "black" });
  const groupPauseIcon = feather.icons.pause.toSvg({ "width": 15, "height": 15, "stroke": "black", "fill": "black" });
  const groupLoopIcon = feather.icons.repeat.toSvg({ "width": 15, "height": 15, "stroke": "black", "stroke-width": 2.5 });
  const groupRemoveIcon = feather.icons.x.toSvg({ "width": 17, "height": 17, "stroke": "black", "stroke-width": 2.5 });

  const playGroup = function (peaks, group, loop = false) {
    peaks.once("player.pause", function () {
      const segments = segmentsFromGroup(group, { visible: true, sort: true });
      peaks.player.playSegments(segments, loop);
      const button = loop ? groupsButtons[group][1] : groupsButtons[group][0];
      button.innerHTML = groupPauseIcon;

      const pause = function () { peaks.player.pause(); }
      button.addEventListener("click", pause, { once: true });
      peaks.once("player.pause", function () {
        button.innerHTML = loop ? groupLoopIcon : groupPlayIcon;
        button.removeEventListener("click", pause);
        button.addEventListener("click", function () { playGroup(peaks, group, loop); }, { once: true });
      });
    });
    if (!peaks.player.isPlaying()) { peaks.player.play(); }
    peaks.player.pause();
  }
  //#endregion



  const toggleSegments = function (peaks, group, checked) {
    // groupsCheckboxes has a key for every group, so if not in there, group is a segment id
    if (!(group in groupsCheckboxes)) {
      const segment = segmentsByID[group];
      segment.checkbox.checked = checked;

      const parent = segment.path.at(-2);  // get group segment belongs to
      if (checked) {    // add the segment back to peaks and remove it from hiddenSegments
        visibleSegments[parent][group] = segment;
        peaks.segments.add(segment);
        segment.buttons.forEach(function (button) {
          button.style.pointerEvents = "auto";
          const buttonIcon = button.firstElementChild;
          buttonIcon.style.stroke = "black";
          if (buttonIcon.getAttribute("fill") != "none") { buttonIcon.style.fill = "black"; }
        });
        delete hiddenSegments[parent][group];
      }
      else {  // add the segment to hiddenSegments and remove it from peaks
        hiddenSegments[parent][group] = segment;
        peaks.segments.removeById(group);
        segment.buttons.forEach(function (button) {
          button.style.pointerEvents = "none";
          const buttonIcon = button.firstElementChild;
          buttonIcon.style.stroke = "gray";
          if (buttonIcon.getAttribute("fill") != "none") { buttonIcon.style.fill = "gray"; }
        });
        delete visibleSegments[parent][group];
      }
    }
    else {  // group is not a segment id
      const groupCheckbox = groupsCheckboxes[group];
      groupCheckbox.checked = checked;
      if (checked) {
        groupCheckbox.parentElement.querySelector("ul").classList.add("active");
        groupsButtons[group].forEach(function (button) {
          button.style.pointerEvents = "auto";
          const buttonIcon = button.firstElementChild;
          buttonIcon.style.stroke = "black";
          if (buttonIcon.getAttribute("fill") != "none") { buttonIcon.style.fill = "black"; }
        });
      }
      else {
        groupCheckbox.parentElement.querySelector("ul").classList.remove("active");
        groupsButtons[group].forEach(function (button) {
          button.style.pointerEvents = "none";
          const buttonIcon = button.firstElementChild;
          buttonIcon.style.stroke = "gray";
          if (buttonIcon.getAttribute("fill") != "none") { buttonIcon.style.fill = "gray"; }
        });
      }

      if (!(group in visibleSegments)) {  // group is a group of groups
        const children = groupCheckbox.dataset.children;
        if (children) {
          for (let child of children.split("|")) { toggleSegments(peaks, child, checked); }
        }
      }
      else {  // group is a group of segments
        if (checked) {
          const segments = segmentsFromGroup(group, { hidden: true });
          segments.forEach(function (segment) {
            segment.checkbox.checked = checked;
          });
          peaks.segments.add(segments);
          visibleSegments[group] = Object.assign({}, visibleSegments[group], hiddenSegments[group]);
          hiddenSegments[group] = {};
        }
        else {
          segmentsFromGroup(group, { visible: true }).forEach(function (segment) {
            segment.checkbox.checked = checked;
            peaks.segments.removeById(segment.id);
          });
          hiddenSegments[group] = Object.assign({}, hiddenSegments[group], visibleSegments[group]);
          visibleSegments[group] = {};
        }
      }
    }
  }



  const removeSegment = function (peaks, segment, group) {
    const parent = document.getElementById(group);
    const parentNested = document.getElementById(`${group}-nested`);
    const id = segment.id;
    // remove segment from lists
    peaks.segments.removeById(id);
    delete segmentsByID[id];
    if (hiddenSegments[group][id]) { delete hiddenSegments[group][id]; }
    if (visibleSegments[group][id]) { delete visibleSegments[group][id]; }
    // update table and tree
    parentNested.removeChild(segment.checkbox.parentElement);
    newChanges = true;
  }



  const removeGroup = function (peaks, group, parent) {
    for (let segment of segmentsFromGroup(group, { visible: true, hidden: true })) {
      removeSegment(peaks, segment, group);
    }

    const parentCheckbox = groupsCheckboxes[parent];
    const parentChildren = parentCheckbox.dataset.children.split("|").filter(child => child != group);
    parentCheckbox.dataset.children = parentChildren.join("|");

    delete groupsCheckboxes[group];
    delete groupsButtons[group];

    document.getElementById(group).remove();

    newChanges = true;
  }



  //#region popup and label functions
  const popup = document.getElementById("popup");
  const popupContent = document.getElementById("popup-content");
  let labelsDataset;
  const initPopup = function (peaks, group) {
    popup.style.display = "block";
    //if group is a speaker group
    if (group.includes("Speaker")){
      popupContent.appendChild(htmlToElement("<h2>Choose a label for this speaker: </h2>"));
      popupContent.appendChild(htmlToElement("<a id='close' class='close'>&times</a>"));
      if (labelsDataset.children && labelsDataset.children != "") {
        labelsDataset.children.split("|").forEach(function (label) {
          // add radio button
          const radio = htmlToElement(`<input type="radio" name="${group}-radios" id="${label}-radio" autocomplete="off">`);
          popupContent.append(radio);
          popupContent.append(htmlToElement(`<label for="${label}-radio">${label}</label>`));
          radio.addEventListener("change", function () {
            const labelSegments = segmentsFromGroup(label, { "visible": true, "hidden": true });
            let segments = segmentsFromGroup(group, { "visible": true, "hidden": true });
            for (let segment of segments) {
              if (!labelSegments.some(labelSegment => propertiesEqual(segment, labelSegment, ["startTime", "endTime"]))) {
                const copied = copySegment(segment, ["path", "id"]);
                Object.assign(copied, { "editable": true, "color": groupsColors[label], "labelText": label, "removable": true });
                renderSegment(peaks, peaks.segments.add(copied), label, ["Segments", "Labeled-Speakers"]);
                addOrSubDuration("Labeled-Speakers", segment, true);
                addOrSubDuration(label, segment, true);
              }
            }
            popupContent.innerHTML = "";
            popup.style.display = "none";
          });
        });
      }
    }
    else if (document.getElementById(`${group}-span`).parentElement.parentElement.id == "Labeled-Speakers-nested"){ //if group is a label group
      popupContent.appendChild(htmlToElement("<h2>Rename label: </h2>"));
      popupContent.appendChild(htmlToElement("<a id='close' class='close'>&times</a>"));
      let span = document.getElementById(`${group}-span`);
      popupContent.appendChild(htmlToElement("<input type='text' id='" + group + "-rename' value='" + span.innerHTML + "'>"));
      // rename segment when "enter" is pressed
      document.getElementById(`${group}-rename`).addEventListener("keypress", function (event) {
        if (event.key === "Enter") {
          let newLabel = document.getElementById(`${group}-rename`).value;
          document.getElementById(`${group}-span`).innerHTML = newLabel;
          document.getElementById(`${group}-span`).id = `${newLabel}-span`;
          const li = document.getElementById(`${group}`);
          li.id = `${newLabel}`;
          li.firstElementChild.dataset.id = newLabel;
          li.children[2].dataset.id = newLabel;
          li.children[3].dataset.id = newLabel;
          if (li.children[5]) {
            li.children[4].dataset.id = newLabel;
            li.children[5].id = `${newLabel}-nested`;
          }
          else { li.children[4].id = `${newLabel}-nested`; }

          for (let segment of segmentsFromGroup(group, {visible: true, hidden: true})){
            segment.path[segment.path.length - 2] = newLabel;
            segment.update({ "labelText": newLabel });
          }

          labelsDataset.children = labelsDataset.children.replace(group, newLabel);
          groupsCheckboxes[newLabel] = groupsCheckboxes[group];
          delete groupsCheckboxes[group];
          groupsButtons[newLabel] = groupsButtons[group];
          delete groupsButtons[group];
          groupsColors[newLabel] = groupsColors[group];
          delete groupsColors[group];

          hiddenSegments[newLabel] = hiddenSegments[group];
          delete hiddenSegments[group];
          visibleSegments[newLabel] = visibleSegments[group];
          delete visibleSegments[group];

          popupContent.innerHTML = "";
          popup.style.display = "none";
        }
      });
    }
    else{
      const segment = segmentsByID[group];
      
      if (segment.editable && document.getElementById(`${group}-span`).parentElement.parentElement.id == "Custom-Segments-nested"){ //it's a custom segment
        // rename box code
        popupContent.appendChild(htmlToElement("<h2>Rename segment or move to label: </h2>"));
        popupContent.appendChild(htmlToElement("<a id='close' class='close'>&times</a>"));
        let span = document.getElementById(`${segment.id}-span`);
        popupContent.appendChild(htmlToElement("<input type='text' id='" + segment.id + "-rename' value='" + span.innerHTML + "'>"));
        // rename segment when "enter" is pressed
        document.getElementById(`${segment.id}-rename`).addEventListener("keypress", function (event) {
          if (event.key === "Enter") {
            let newLabel = document.getElementById(`${segment.id}-rename`).value;
            document.getElementById(`${segment.id}-span`).innerHTML = newLabel;
            segment.update({ "labelText": newLabel, "treeText": newLabel });
          }
        });
      }
      else if (segment.editable && document.getElementById(`${group}-span`).parentElement.parentElement.id == "Labeled-Speakers-nested"){
        popupContent.appendChild(htmlToElement("<h2>Rename segment or move to a different label: </h2>"));
        popupContent.appendChild(htmlToElement("<a id='close' class='close'>&times</a>"));
        let span = document.getElementById(`${segment.id}-span`);
        popupContent.appendChild(htmlToElement("<input type='text' id='" + segment.id + "-rename' value='" + span.innerHTML + "'>"));
        // rename segment when "enter" is pressed
        document.getElementById(`${segment.id}-rename`).addEventListener("keypress", function (event) {
          if (event.key === "Enter") {
            let newLabel = document.getElementById(`${segment.id}-rename`).value;
            document.getElementById(`${segment.id}-span`).innerHTML = newLabel;
            segment.update({ "labelText": newLabel, "treeText": newLabel });
          }
        });
      }
      else{ //it's a speaker segment
      popupContent.appendChild(htmlToElement("<h2>Choose a new speaker/label for this segment: </h2>"));
      popupContent.appendChild(htmlToElement("<a id='close' class='close'>&times</a>"));

      Object.keys(snrs).forEach(function (speaker){
        if (speaker != segment.path[2]){
          const radio = htmlToElement(`<input type="radio" name="${segment.id}-radios" id="${speaker}-radio" autocomplete="off">`);
        popupContent.append(radio);
        popupContent.append(htmlToElement(`<label for="${speaker}-radio">${speaker}</label>`));
        radio.addEventListener("change", function () {
            changeSpeaker(peaks, speaker, segment.path.at(-2), segment);
            popupContent.innerHTML = "";
            popup.style.display = "none";
          });
        }
      });
      }
      if (labelsDataset.children && labelsDataset.children != "") {
      labelsDataset.children.split("|").forEach(function (label) {
        if (label != document.getElementById(`${group}-span`).parentElement.id){
          // add radio button
          const radio = htmlToElement(`<input type="radio" name="${segment.id}-radios" id="${label}-radio" autocomplete="off">`);
          popupContent.append(radio);
          popupContent.append(htmlToElement(`<label for="${label}-radio">${label}</label>`));
          radio.addEventListener("change", function () {
            const labelSegments = segmentsFromGroup(label, { "visible": true, "hidden": true });
            if (!labelSegments.some(labelSegment => propertiesEqual(segment, labelSegment, ["startTime", "endTime"]))) {
              const copiedSegment = peaks.segments.add({
                "startTime": segment.startTime,
                "endTime": segment.endTime,
                "editable": true,
                "color": groupsColors[label],
                "labelText": label,
                "treeText": segment.treeText,
                "removable": true
              });
              renderSegment(peaks, copiedSegment, label, ["Segments", "Labeled-Speakers"]);
              addOrSubDuration("Labeled-Speakers", segment, true);
              addOrSubDuration(label, segment, true);
            }
            popupContent.innerHTML = "";
            popup.style.display = "none";
          });
        }
      });
    }
  }

    // close popup button
    document.querySelectorAll(".close").forEach(function (button) {
      button.addEventListener("click", function () {
        popupContent.innerHTML = "";
        popup.style.display = "none";
      });
    });
  }



  const changeSpeaker = function (peaks, speaker, oldSpeaker, segment) {
    segment.path = ["Segments", "Speakers", speaker, segment.id];
    document.getElementById(`${segment.id}`).remove();
    renderSegment(peaks, segment, speaker, ["Segments", "Speakers"]);
    addOrSubDuration(speaker, segment, true);
    addOrSubDuration(oldSpeaker, segment, false);
    if (visibleSegments[oldSpeaker][segment.id]) { delete visibleSegments[oldSpeaker][segment.id] }
    if (hiddenSegments[oldSpeaker][segment.id]) { delete hiddenSegments[oldSpeaker][segment.id] }
    segment.update({ "labelText": speaker });
    moved[segment.id] = segment;
  }
  //#endregion



  const addOrSubDuration = function (groupToUpdate, segmentMoving, adding){
    const span = document.getElementById(`${groupToUpdate}-span`);
    let titleSplit = span.title.split(" ");
    if (adding){
      titleSplit[titleSplit.length - 1] = parseFloat(titleSplit.at(-1)) + parseFloat(document.getElementById(`${segmentMoving.id}-span`).title.split(" ").at(-1));
    }
    else{
      titleSplit[titleSplit.length - 1] = parseFloat(titleSplit.at(-1)) - parseFloat(document.getElementById(`${segmentMoving.id}-span`).title.split(" ").at(-1));
    }
    let titleRejoined = titleSplit.join(" ");
    titleRejoined = titleRejoined.toFixed(2);
    span.title = titleRejoined;
  }



  const renderSegment = function (peaks, segment, group, path) {
    // if (group.includes("Custom") || group.includes("Labeled")){ //not sure if we need but this used to be in for custom and labeled
    //   document.getElementById(`${group}-nested`).classList.add("active");
    // }
    // create the tree item for the segment

    if (!(group in visibleSegments)) { renderGroup(peaks, group, path, { "renderEmpty": true, "removable": segment.removable }); }

    segment.treeText = segment.treeText || segment.id.replace("peaks.", "");

    const li = document.createElement("li");
    li.id = segment.id;
    li.style.fontSize = "12px";
    li.innerHTML = `<input style="transform:scale(0.85);" type="checkbox" autocomplete="off" checked><span id="${segment.id}-span" title="Duration: ${(segment.endTime - segment.startTime).toFixed(2)}">${segment.treeText}</span> <a href="#" style="text-decoration:none;">${segmentPlayIcon}   </a><a href="#" style="text-decoration:none;">${segmentLoopIcon}   </a><ul id="${segment.id}-nested" class="nested active"></ul>`;
    document.getElementById(`${group}-nested`).append(li);

    // segment checkboxes
    const checkbox = li.firstElementChild;

    checkbox.addEventListener("click", function () { toggleSegments(peaks, segment.id, this.checked); });

    document.getElementById(`${segment.id}-span`).addEventListener("click", function () { initPopup(peaks, segment.id); });

    // segment play/loop buttons
    const play = li.children[2];
    const loop = li.children[3];

    play.addEventListener("click", function () { playSegment(peaks, segment); }, { once: true });
    loop.addEventListener("click", function () { playSegment(peaks, segment, true); }, { once: true });

    segment.path = path.concat(group, segment.id);  // path is a list of groups the segment belongs to
    segment.checkbox = checkbox;
    segment.buttons = [play, loop];
    segment.removable = !!segment.removable;
    if (groupsColors[group]) { segment.update({ "color": groupsColors[group] }); }

    segmentsByID[segment.id] = segment;
    visibleSegments[group][segment.id] = segment;

    if (segment.editable || segment.removable) {
      const remove = htmlToElement(`<a href="#" ">${segmentRemoveIcon}</a>`);
      loop.after(remove);
      remove.addEventListener("click", function () { removeSegment(peaks, segment, group); });
      segment.durationSpan = li.children[1];
    }
  }



  const renderGroup = function (peaks, group, path, { items = [], snr = null, renderEmpty = false, groupOfGroups = false, removable = false } = {}) {
    if (group in groupsCheckboxes) { return; }  // group already exists
    if (items.length == 0 && !renderEmpty) { return; } 	// if group has no segments, return

    if (items.length == 0) { groupsColors[group] = getRandomColor(); }

    const parent = path.at(-1);  // parent needed to find where in tree to nest group
    // add group to the parents children
    const parentCheckbox = groupsCheckboxes[parent];
    const parentChildren = parentCheckbox.dataset.children;
    parentCheckbox.dataset.children = parentChildren === undefined ? group : `${parentChildren}|${group}`;

    // create the tree item for the group
    const branch = htmlToElement(`<li id="${group}" style="font-size:18px;"></li>`);
    let spanHTML;
    if (snr) {
      spanHTML = `<button id="${group}-button" class="nolink"><span id="${group}-span" style="font-size:18px;" title="${"SNR: " + snr.toFixed(2)}">${group}</span></button>`
      snrs[group] = snr;

      branch.innerHTML = `<input type="checkbox" data-id="${group}" autocomplete="off">${spanHTML} <a href="#" style="text-decoration:none;" data-id="${group}">${groupPlayIcon}   </a><a href="#" style="text-decoration:none;" data-id="${group}">${groupLoopIcon}   </a><ul id="${group}-nested" class="nested"></ul>`;
      document.getElementById(`${parent}-nested`).append(branch);

      // event listener for clicking on a speaker
      document.getElementById(`${group}-button`).addEventListener("click", function () { initPopup(peaks, this.id.split("-")[0]); });
    }
    else if (parent == "Labeled-Speakers"){
      spanHTML = `<span id="${group}-span" style="font-size:18px;">${group}</span>`;
      branch.innerHTML = `<input type="checkbox" data-id="${group}" autocomplete="off">${spanHTML} <a href="#" style="text-decoration:none;" data-id="${group}">${groupPlayIcon}   </a><a href="#" style="text-decoration:none;" data-id="${group}">${groupLoopIcon}   </a><ul id="${group}-nested" class="nested"></ul>`;
      document.getElementById(`${parent}-nested`).append(branch);
      // event listener for clicking on a label
      document.getElementById(`${group}-span`).addEventListener("click", function () { initPopup(peaks, this.id.split("-")[0]); });
    }
    else {
      spanHTML = `<span id="${group}-span" style="font-size:18px;">${group}</span>`;
      branch.innerHTML = `<input type="checkbox" autocomplete="off" data-id="${group}">${spanHTML} <a href="#" style="text-decoration:none;" data-id="${group}">${groupPlayIcon}   </a><a href="#" style="text-decoration:none;" data-id="${group}">${groupLoopIcon}   </a><ul id="${group}-nested" class="nested"></ul>`;
      document.getElementById(`${parent}-nested`).append(branch);
    }

    // add inputs for group to groupInputs and add event listeners to them
    const groupCheckbox = branch.firstElementChild;
    groupCheckbox.addEventListener("click", function () { toggleSegments(peaks, this.dataset.id, this.checked); });

    const groupPlay = branch.children[2];
    const groupLoop = branch.children[3];
    groupPlay.addEventListener("click", function () { playGroup(peaks, this.dataset.id); }, { once: true });
    groupLoop.addEventListener("click", function () { playGroup(peaks, this.dataset.id, true); }, { once: true });

    groupsCheckboxes[group] = groupCheckbox;
    groupsButtons[group] = [groupPlay, groupLoop];

    if (!Array.isArray(items[0]) && !groupOfGroups) {
      hiddenSegments[group] = {};
      visibleSegments[group] = {};
      peaks.segments.add(items).forEach(function (segment) {
        if (!(group in groupsColors)) { groupsColors[group] = segment.color; }
        renderSegment(peaks, segment, group, path);
      });
    }
    else {
      for (let [nestedGroup, nestedItems, nestedSNR] of items) {
        renderGroup(peaks, nestedGroup, path.concat(group), { "items": nestedItems, "snr": nestedSNR });
      }
    }
    const segments = segmentsFromGroup(group, { visible: true, hidden: true });
    const sum = segments.reduce((prev, cur) => prev + cur.endTime - cur.startTime, 0);
    const span = document.getElementById(`${group}-span`);
    if (span.title == "") {
      span.title += `Duration: ${sum.toFixed(2)}`;
    }
    else {
      span.title += `\n Duration: ${sum.toFixed(2)}`;
      durations[group] = sum;
    }

    if (removable) {
      const remove = htmlToElement(`<a href="#" data-id="${group}">${groupRemoveIcon}</a>`);
      branch.children[3].after(remove);
      remove.addEventListener("click", function () { removeGroup(peaks, this.dataset.id, parent); });
    }
    return;
  }



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
      json: `waveforms/${name}-waveform.json`
    },
    keyboard: true,
    pointMarkerColor: '#006eb0',
    showPlayheadTime: true,
    waveformCache: true,
    zoomLevels: [256, 512, 1024, 2048, 4096]
  };



  Peaks.init(options, function (err, peaksInstance) {
    if (err) {
      console.error(err.message);
      return;
    }

    // Event listeners for the utilities underneath peaks
    //#region zoom
    // Zoom
    
    const zoomIn = document.querySelector("[data-action='zoom-in']");
    const zoomOut = document.querySelector("[data-action='zoom-out']");
    zoomIn.innerHTML = feather.icons["zoom-in"].toSvg({ "stroke": "gray" });
    const zoomInSvg = zoomIn.firstElementChild;
    zoomOut.innerHTML = feather.icons["zoom-out"].toSvg({ "stroke": "black" });
    const zoomOutSvg = zoomOut.firstElementChild;
    zoomIn.addEventListener('click', function () {
      peaksInstance.zoom.zoomIn();
      const zoomLevel = peaksInstance.zoom.getZoom();
      if (zoomLevel == 0) {
        zoomIn.style.pointerEvents = "none";
        zoomInSvg.style.stroke = "gray";
      }
      else if (zoomLevel == 3) {
        zoomOut.style.pointerEvents = "auto";
        zoomOutSvg.style.stroke = "black";
      }
    });
    zoomOut.addEventListener('click', function () {
      peaksInstance.zoom.zoomOut();
      const zoomLevel = peaksInstance.zoom.getZoom();
      if (zoomLevel == 4) {
        zoomOut.style.pointerEvents = "none";
        zoomOutSvg.style.stroke = "gray";
      }
      else if (zoomLevel == 1) {
        zoomIn.style.pointerEvents = "auto";
        zoomInSvg.style.stroke = "black";
      }
    });
    //#endregion


    //#region seek
    const seekTime = document.getElementById('seek-time');
    const overview = peaksInstance.views.getView('overview');
    const zoomview = peaksInstance.views.getView('zoomview');
    // Seek
    document.querySelector('button[data-action="seek"]').addEventListener('click', function () {
      const seconds = parseFloat(seekTime.value);
      if (!Number.isNaN(seconds)) { peaksInstance.player.seek(seconds); }
    });
    document.getElementById('enable-seek').addEventListener('change', function () {
      zoomview.enableSeek(this.checked);
      overview.enableSeek(this.checked);
    });
    //#endregion


    // Auto-scroll
    document.getElementById('auto-scroll').addEventListener('change', function () { zoomview.enableAutoScroll(this.checked); });


    //#region amplitude scale
    // Amplitude
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
    //#endregion


    peaksInstance.on('segments.contextmenu', function (event) { event.evt.preventDefault(); });
    peaksInstance.on('overview.contextmenu', function (event) { event.evt.preventDefault(); });


    renderGroup(peaksInstance, "Custom-Segments", ["Segments"], { renderEmpty: true });
    renderGroup(peaksInstance, "Labeled-Speakers", ["Segments"], { renderEmpty: true, "groupOfGroups": true });
    labelsDataset = groupsCheckboxes["Labeled-Speakers"].dataset;

    for (let [group, items, snr] of importedSegments) {
      renderGroup(peaksInstance, group, ["Segments"], { "items": items, "snr": snr });
    }

    const highestId = peaksInstance.segments.getSegments()
      .map(seg => parseInt(seg.id.split(".").at(-1)))
      .sort((id1, id2) => id1 - id2).at(-1);


    // add labeled speaker
    const labelInput = document.getElementById("label");
    document.querySelector("button[data-action='add-label']").addEventListener('click', function () {
      renderGroup(peaksInstance, labelInput.value, ["Segments", "Labeled-Speakers"], { "renderEmpty": true, "removable": true });
      labelInput.value = "";  // clear text box after submitting
    });


    //#region add custom segment
    const customSpan = document.getElementById("Custom-Segments-span");
    let customDuration = 0;
    let segmentCounter = 1;
    // Add (custom) segment
    document.querySelector('button[data-action="add-segment"]').addEventListener('click', function () {
      const label = 'Custom Segment ' + segmentCounter++;
      let segment = {
        startTime: peaksInstance.player.getCurrentTime(),
        endTime: peaksInstance.player.getCurrentTime() + 10,
        labelText: label,
        editable: true,
        treeText: label,
        removable: true,
      };
      segment = peaksInstance.segments.add(segment);
      renderSegment(peaksInstance, segment, "Custom-Segments", ["Segments"]);
      customDuration += 10;
      customSpan.title = `Duration: ${customDuration.toFixed(2)}`;
      newChanges = true;
    });
    //#endregion


    //#region load annotations
    (function () {
      const record = { 'user': user, 'filename': fileName }
      const json = JSON.stringify(record);
      var loadRequest = new XMLHttpRequest();

      loadRequest.open('POST', 'load', true);
      loadRequest.setRequestHeader('Content-Type', 'application/json; charset=UTF-8');

      loadRequest.send(json)
      loadRequest.onload = function () {
        let jsonData = JSON.parse(loadRequest.response);
        peaksInstance.segments.add(jsonData, { "overwrite": true }).forEach(function (segment) {
          if (segment.id in segmentsByID) {
            changeSpeaker(peaksInstance, segment.path.at(-1), segmentsByID[segment.id].path.at(-2), segment);
          }
          else { renderSegment(peaksInstance, segment, segment.path.at(-1), segment.path.slice(0, -1)); }
        });

        toggleSegments(peaksInstance, "Segments", false);

        document.getElementById("Segments-nested").classList.add("active");

        groupsCheckboxes["Segments"].checked = true;
        groupsCheckboxes["Segments"].addEventListener("click", function () { toggleSegments(peaksInstance, "Segments", this.checked); });

        segmentsPlay.style.pointerEvents = "auto";
        segmentsLoop.style.pointerEvents = "auto";
        const segmentsPlayIcon = segmentsPlay.firstElementChild;
        const segmentsLoopIcon = segmentsLoop.firstElementChild;
        segmentsPlayIcon.style.stroke = "black";
        segmentsPlayIcon.style.fill = "black";
        segmentsLoopIcon.style.stroke = "black";
        segmentsPlay.addEventListener("click", function () { playGroup(peaksInstance, "Segments"); });
        segmentsLoop.addEventListener("click", function () { playGroup(peaksInstance, "Segments", true); });
      };
    })();
    //#endregion

    peaksInstance.on("segments.dragend", function (event) {
      const segment = event.segment;
      const segmentSpan = segment.durationSpan;

      const oldDuration = parseFloat(segmentSpan.title.split(" ").at(-1));
      const newDuration = segment.endTime - segment.startTime;
      customDuration += newDuration - oldDuration;

      segmentSpan.title = `Duration: ${newDuration.toFixed(2)}`;
      customSpan.title = `Duration: ${customDuration.toFixed(2)}`;

      newChanges = true;
    });

    //#region primary speaker calculation
    //getting z-scores for snrs and durations, sorting via highest to lowest snrs
    var snrMean = 0;
    var durMean = 0;
    var counter = 0;

    var snrArray = Object.entries(snrs);
    for (let i = 0; i < snrArray.length; i++) {
      for (let j = 0; j < snrArray.length - i - 1; j++) {
        if (snrArray[j + 1][1] > snrArray[j][1]) {
          [snrArray[j + 1], snrArray[j]] = [snrArray[j], snrArray[j + 1]]
        }
      }
    }
    for (let i = 0; i < snrArray.length; i++) {
      document.getElementById(`${snrArray[i][0]}-span`).innerHTML += "\n num. " + String(i + 1) + " snr";
    }

    for (var key in snrs) {
      counter++;
      snrMean += snrs[key];
      durMean += durations[key];
    }
    snrMean /= counter;
    durMean /= counter;
    var snrStdDev = 0;
    var durStdDev = 0;
    for (var key in snrs) {
      snrStdDev += (snrs[key] - snrMean) ** 2;
      durStdDev += (durations[key] - durMean) ** 2;
    }
    snrStdDev /= counter;
    durStdDev /= counter;
    snrStdDev = Math.sqrt(snrStdDev);
    durStdDev = Math.sqrt(durStdDev);
    for (var key in snrs) {
      snrs[key] = (snrs[key] - snrMean) / snrStdDev;  // now snrs stores z scores of snrs
      durations[key] = (durations[key] - durMean) / durStdDev;  // now durations stores z scores of durations
    }
    var overallZScores = {};
    for (var key in snrs) {
      overallZScores[key] = snrs[key] + durations[key];
    }
    var maxSpeaker = "Speaker 1";
    var maxZ = overallZScores[maxSpeaker];
    for (let key of Object.keys(snrs)) {
      if (maxZ < overallZScores[key]) {
        maxSpeaker = key;
        maxZ = overallZScores[key];
      }
    }
    var primarySpeakerSpan = document.getElementById(`${maxSpeaker}-span`);
    primarySpeakerSpan.style.color = "violet";
    //#endregion

    document.querySelector('button[data-action="save"]').addEventListener('click', function () {
      const regex = /Speaker |VAD|Non-VAD/;
      const groups = Object.keys(visibleSegments).filter(group => !group.match(regex));
      let segments = [];
      for (const group of groups) {
        segments = segments.concat(segmentsFromGroup(group, { "visible": true, "hidden": true, "simple": true }));
      }

      let idCounter = highestId + 1;
      segments.map((segment, index) => { return { "index": index, "id": parseInt(segment.id.split(".").at(-1)) }; })
        .sort((seg1, seg2) => seg1.id - seg2.id)
        .map(seg => segments[seg.index])
        .forEach(function (segment) { segment.id = `peaks.segment.${idCounter++}`; });

      for (const segment of Object.values(moved)) {
        const copied = copySegment(segment, ["color"]);
        copied.path = copied.path.slice(0, -1);
        segments.push(copied);
      }

      const record = { 'user': user, 'filename': fileName, 'segments': segments }
      const json = JSON.stringify(record);
      var request = new XMLHttpRequest();
      request.open('POST', 'save', true);
      request.setRequestHeader('Content-Type', 'application/json; charset=UTF-8');

      request.send(json);
      request.onload = function () {
        // done
        console.log('Annotations saved');
      };
      newChanges = false;
    });

    document.querySelector("[data-action='show-dropdowns']").addEventListener('click', function () {
      document.getElementById("speedDropdown").classList.toggle("show");
    });

    document.querySelector("[data-action='.5times']").addEventListener('click', function () {
      let myaudio=document.getElementById("audio");
      myaudio.playbackRate=0.5;
    });

    document.querySelector("[data-action='1times']").addEventListener('click', function () {
      let myaudio=document.getElementById("audio");
      myaudio.playbackRate=1;
    });

    document.querySelector("[data-action='2times']").addEventListener('click', function () {
      let myaudio=document.getElementById("audio");
      myaudio.playbackRate=2;
    });

    document.querySelector("[data-action='4times']").addEventListener('click', function () {
      let myaudio=document.getElementById("audio");
      myaudio.playbackRate=4;
    });


    //https://www.w3schools.com/howto/howto_js_dropdown.asp
    // Close the dropdown if the user clicks outside of it
    window.onclick = function(event) {
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

    const segmentsPlay = groupsButtons["Segments"][0];
    const segmentsLoop = groupsButtons["Segments"][1];
    segmentsPlay.innerHTML = feather.icons.play.toSvg({ "width": 17, "height": 17, "stroke": "black", "fill": "black" });
    segmentsLoop.innerHTML = feather.icons.repeat.toSvg({ "width": 17, "height": 17, "stroke": "black", "stroke-width": 2.5 });
  });
}



const urlParams = new URLSearchParams(window.location.search);
const fileName = urlParams.get("audiofile");
var user = document.getElementById("user").innerHTML;

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

function showDropdown() {
  document.getElementById("speedDropdown").classList.toggle("show");
}

// Close the dropdown if the user clicks outside of it
window.onclick = function(event) {
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

runPeaks(fileName);
