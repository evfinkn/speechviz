import Peaks from "peaks.js";
import { getRandomColor, htmlToElement } from "./util";
const feather = require('feather-icons');

const audio =  document.getElementById('audio');

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

  // dictionary of checkboxes for every group   {group: HTMLInputElement}
  const groupsCheckboxes = { "Segments": document.querySelector("input[data-id='Segments']") };
  // dictionary of buttons for every group      {group: [HTMLLinkElement for play, HTMLLinkElement for loop]}
  const groupsButtons = { "Segments": document.querySelectorAll("a[data-id='Segments']") };
  // array of all labels for labeled speakers
  const labels = [];
  const labelsColors = {};
  
  const segmentsFromGroup = function (group, {visible = false, hidden = false, peaks = undefined, sort = false, simple = false} = {}) {
    let segments = [];
    if (peaks) {  // get segments from peaks instead of visibleSegments or hiddenSegments
      segments = peaks.segments.getSegments().filter(segment => segment.path.includes(group));
    }
    if (!(group in visibleSegments)) {  // group is a group of groups
      for (let child of groupsCheckboxes[group].dataset.children.split("|")) {
        segments = segments.concat(segmentsFromGroup(child, arguments[1]));  // get the groups from the children
      }
    }
    else {  // group is a group of segments
      if (visible) { segments = Object.values(visibleSegments[group]); }  // get segments from visibleSegments
      if (hidden) { segments = segments.concat(Object.values(hiddenSegments[group])); }  // get segments from hiddenSegments
    }
    if (sort) { segments.sort((seg1, seg2) => seg1.startTime > seg2.startTime); }  // sort by start time
    if (simple) {
      segments = segments.map(seg => ({"id": seg.id, "startTime": seg.startTime, "endTime": seg.endTime, "labelText": seg.labelText}));
    }
    return segments;
  }

  const segmentPlayIcon = feather.icons.play.toSvg({"width": 12, "height": 12, "stroke": "black", "fill": "black"});
  const segmentPauseIcon = feather.icons.pause.toSvg({"width": 12, "height": 12, "stroke": "black", "fill": "black"});
  const segmentLoopIcon = feather.icons.repeat.toSvg({"width": 12, "height": 12, "stroke": "black", "stroke-width": 2.5});
  const segmentRemoveIcon = feather.icons.x.toSvg({"width": 15, "height": 15, "stroke": "black", "stroke-width": 2.5});

  //#region playing segments and groups
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
      button.addEventListener("click", pause, {once: true});
      peaks.once("player.pause", function () {
        button.innerHTML = loop ? segmentLoopIcon : segmentPlayIcon;
        button.removeEventListener("click", pause);
        button.addEventListener("click", function () { playSegment(peaks, segment, loop); }, {once: true});
      });
    });
    // peaks.player.pause() only pauses if playing, so have to play audio if not already
    if (!peaks.player.isPlaying()) { peaks.player.play(); }
    peaks.player.pause();
  }

  const groupPlayIcon = feather.icons.play.toSvg({"width": 15, "height": 15, "stroke": "black", "fill": "black"});
  const groupPauseIcon = feather.icons.pause.toSvg({"width": 15, "height": 15, "stroke": "black", "fill": "black"});
  const groupLoopIcon = feather.icons.repeat.toSvg({"width": 15, "height": 15, "stroke": "black", "stroke-width": 2.5});

  const playGroup = function (peaks, group, loop = false) {
    peaks.once("player.pause", function () {
      const segments = segmentsFromGroup(group, {visible: true, sort: true});
      peaks.player.playSegments(segments, loop);
      const button = loop ? groupsButtons[group][1] : groupsButtons[group][0];
      button.innerHTML = groupPauseIcon;

      const pause = function () { peaks.player.pause(); }
      button.addEventListener("click", pause, {once: true});
      peaks.once("player.pause", function () {
        button.innerHTML = loop ? groupLoopIcon : groupPlayIcon;
        button.removeEventListener("click", pause);
        button.addEventListener("click", function () { playGroup(peaks, group, loop); }, {once: true});
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
        for (let child of groupCheckbox.dataset.children.split("|")) { toggleSegments(peaks, child, checked); }
      }
      else {  // group is a group of segments
        if (checked) {
          const segments = segmentsFromGroup(group, {hidden: true});
          segments.forEach(function (segment) {
            segment.checkbox.checked = checked;
          });
          peaks.segments.add(segments);
          visibleSegments[group] = Object.assign({}, visibleSegments[group], hiddenSegments[group]);
          hiddenSegments[group] = {};
        }
        else {
          segmentsFromGroup(group, {visible: true}).forEach(function (segment) {
            segment.checkbox.checked = checked;
            peaks.segments.removeById(segment.id);
          });
          hiddenSegments[group] = Object.assign({}, hiddenSegments[group], visibleSegments[group]);
          visibleSegments[group] = {};
        }
      }
    }
  }

  const popup = document.getElementById("popup");
  const popupContent = document.getElementById("popup-content");
  const initPopup = function(peaks, group) {
    popup.style.display = "block";
    popupContent.appendChild(htmlToElement("<h2>Choose a label: </h2>"));
    popupContent.appendChild(htmlToElement("<a id='close' class='close'>&times</a>"));

    labels.forEach(function (label) {
      // add radio button
      const radio = htmlToElement(`<input type="radio" name="${group}-radios" id="${label}-radio" autocomplete="off">`);
      popupContent.append(radio);
      popupContent.append(htmlToElement(`<label for="${label}-radio">${label}</label>`));
      radio.addEventListener("change", function() {
        addToLabel(peaks, label, group);
        saveLabels(label, group);
        popupContent.innerHTML = "";
        popup.style.display = "none";
      });
    });

    // close popup button
    document.querySelectorAll(".close").forEach(function (button) {
      button.addEventListener("click", function() { 
        popupContent.innerHTML = "";
        popup.style.display = "none";
      });
    });
  }

  const addToLabel = function(peaks, label, group, loading) {
    let segments;
    if (loading){
      segments = segmentsFromGroup(group, { "peaks": peaks, "hidden": true });
    }
    else{
      segments = segmentsFromGroup(group, { "peaks": peaks});
    }

    for (let segment of segments) {
      const copiedSegment = peaks.segments.add({
        "startTime": segment.startTime,
        "endTime": segment.endTime,
        "editable": segment.editable,
        "color": labelsColors[label],
        "labelText": label
      });
      renderSegment(peaks, copiedSegment, label, ["Segments", "Labeled-Speakers", label], { "removable": true, "treeText": segment.id.replace("peaks.", "") });
    }

    document.getElementById(`${group}-button`).firstElementChild.innerHTML += ` (${label})`;
  }

  const renderSegment = function (peaks, segment, group, path, {removable = false, treeText = null} = {}) {
    // create the tree item for the segment
    const li = document.createElement("li");
    li.style.fontSize = "12px";
    li.innerHTML = `<input style="transform:scale(0.85);" type="checkbox" data-id="${segment.id}" autocomplete="off" checked><span id="${segment.id}-span" title="Duration: ${(segment.endTime - segment.startTime).toFixed(2)}">${treeText ? treeText : segment.id.replace("peaks.", "")}</span> <a href="#" style="text-decoration:none;" data-id="${segment.id}">${segmentPlayIcon}</a><a href="#" style="text-decoration:none;" data-id="${segment.id}">${segmentLoopIcon}</a><ul id="${segment.id}-nested" class="nested active"></ul>`;
    document.getElementById(`${group}-nested`).append(li);

    // segment checkboxes
    const checkbox = li.firstElementChild;

    checkbox.addEventListener("click", function () { toggleSegments(peaks, this.dataset.id, this.checked); });

    // segment play/loop buttons
    const play = li.children[2];
    const loop = li.children[3];

    play.addEventListener("click", function () { playSegment(peaks, segment); }, {once: true});
    loop.addEventListener("click", function () { playSegment(peaks, segment, true); }, {once: true});

    segment.path = path.concat(group, segment.id);  // path is a list of groups the segment belongs to
    segment.checkbox = checkbox;
    segment.buttons = [play, loop];

    segmentsByID[segment.id] = segment;
    visibleSegments[group][segment.id] = segment;

    if (segment.editable || removable) {
      let temp = document.getElementById(`${segment.id}-span`)
      document.getElementById(`${segment.id}-span`).outerHTML = '<button id="'+segment.id+'-button" class="nolink">'+ temp.outerHTML +'</button>';
      // rename segment
      document.getElementById(`${segment.id}-span`).addEventListener('click', function(){
        // change innerHTML to an input box
        console.log(document.getElementById(`${segment.id}-span`).innerHTML);
        document.getElementById(`${segment.id}-span`).innerHTML = "<input type='text' id='"+ segment.id +"-rename' value='"+ temp.innerHTML + "'>";
        // rename segment when "enter" is pressed
        document.getElementById(`${segment.id}-rename`).addEventListener("keypress", function(event) {
          if (event.key === "Enter") {
            let newLabel = document.getElementById(`${segment.id}-rename`).value;
            // switch back to text with new name
            temp.innerHTML = newLabel;
            document.getElementById(`${segment.id}-span`).innerHTML = newLabel;
            segment.update({"labelText": newLabel}); 
            console.log(segment);
          }
        });
      });

      const remove = htmlToElement(`<a href="#" data-id="${segment.id}">${segmentRemoveIcon}</a>`);
      loop.after(remove);
      const parent = document.getElementById(group);
      const parentNested = document.getElementById(`${group}-nested`);
      remove.firstElementChild.addEventListener("click", function () {
        const id = segment.id;
        // remove segment from lists
        peaks.segments.removeById(id);
        delete segmentsByID[id];
        if (hiddenSegments[group][id]) { delete hiddenSegments[group][id]; }
        if (visibleSegments[group][id]) { delete visibleSegments[group][id]; }
        // update table and tree
        parentNested.removeChild(segment.checkbox.parentElement);
        if (parentNested.children.length == 0) { parent.hidden = true; }
        newChanges = true;
      });
      segment.durationSpan = li.children[1];
    }
  }

  const renderGroup = function (peaks, group, path, {renderEmpty = false} = {}) {
    if (typeof group == "string") { group = [group, []]; }
    if (group[1].length == 0 && !renderEmpty) { return; } 	// if group has no segments, return

    const parent = path.at(-1);  // parent needed to find where in tree to nest group
    // add group to the parents children
    const parentCheckbox = groupsCheckboxes[parent];
    const parentChildren = parentCheckbox.dataset.children;
    parentCheckbox.dataset.children = parentChildren === undefined ? group[0] : `${parentChildren}|${group[0]}`;

    // create the tree item for the group
    const branch = htmlToElement(`<li id="${group[0]}" style="font-size:18px;"></li>`);
    let spanHTML;
    if(group.length == 3){
      spanHTML = `<button id="${group[0]}-button" class="nolink"><span id="${group[0]}-span" style="font-size:18px;" title="${"SNR: " + group[2].toFixed(2)}">${group[0]}</span></button>`
      snrs[group[0]] = group[2];

      branch.innerHTML = `<input type="checkbox" data-id="${group[0]}" autocomplete="off">${spanHTML} <a href="#" style="text-decoration:none;" data-id="${group[0]}">${groupPlayIcon}</a><a href="#" style="text-decoration:none;" data-id="${group[0]}">${groupLoopIcon}</a><ul id="${group[0]}-nested" class="nested"></ul>`;
      document.getElementById(`${parent}-nested`).append(branch);

      // event listener for clicking on a speaker
      document.getElementById(`${group[0]}-button`).addEventListener("click", function() { initPopup(peaks, group[0]); });    
    }
    else {
      spanHTML = `<span id="${group[0]}-span" style="font-size:18px;">${group[0]}</span>`;

      branch.innerHTML = `<input type="checkbox" data-id="${group[0]}" autocomplete="off">${spanHTML} <a href="#" style="text-decoration:none;" data-id="${group[0]}">${groupPlayIcon}</a><a href="#" style="text-decoration:none;" data-id="${group[0]}">${groupLoopIcon}</a><ul id="${group[0]}-nested" class="nested"></ul>`;
      document.getElementById(`${parent}-nested`).append(branch);
    }

    // add inputs for group to groupInputs and add event listeners to them
    const groupCheckbox = branch.firstElementChild;
    groupCheckbox.addEventListener("click", function () { toggleSegments(peaks, group[0], this.checked); });

    const groupPlay = branch.children[2];
    const groupLoop = branch.children[3];
    groupPlay.addEventListener("click", function () { playGroup(peaks, group[0]); }, {once: true});
    groupLoop.addEventListener("click", function () { playGroup(peaks, group[0], true); }, {once: true});

    groupsCheckboxes[group[0]] = groupCheckbox;
    groupsButtons[group[0]] = [groupPlay, groupLoop];

    if (!Array.isArray(group[1][0])) {
      hiddenSegments[group[0]] = {};
      visibleSegments[group[0]] = {};
      peaks.segments.add(group[1]).forEach(function (segment) { renderSegment(peaks, segment, group[0], path); });
    }
    else {
      for (let nestedGroup of group[1]) { renderGroup(peaks, nestedGroup, path.concat(group[0])); }
    }
    const segments = segmentsFromGroup(group[0], {"peaks": peaks});
    const sum = segments.reduce((prev, cur) => prev + cur.endTime - cur.startTime, 0);
    const span = document.getElementById(`${group[0]}-span`);
    if (span.title == ""){
      span.title += `Duration: ${sum.toFixed(2)}`;
    }
    else{
      span.title += `\n Duration: ${sum.toFixed(2)}`;
      durations[group[0]] = sum;
    }
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
    zoomIn.innerHTML = feather.icons["zoom-in"].toSvg({"stroke": "gray"});
    const zoomInSvg = zoomIn.firstElementChild;
    zoomOut.innerHTML = feather.icons["zoom-out"].toSvg({"stroke": "black"});
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

    renderGroup(peaksInstance, "Custom-Segments", ["Segments"], {renderEmpty: true});
    renderGroup(peaksInstance, "Labeled-Speakers", ["Segments"], {renderEmpty: true});
    for (let segmentsGroup of importedSegments) { renderGroup(peaksInstance, segmentsGroup, ["Segments"]); }

    // add labeled speaker
    const labelInput = document.getElementById("label");
    document.querySelector("button[data-action='add-labeled-speaker']").addEventListener('click',function() {
      // get the label name from the textbox 
      const label = labelInput.value;
      if (!labels.includes(label)) {
        labelInput.value = "";  // clear text box after submitting
        labels.push(label);
        labelsColors[label] = getRandomColor();
        renderGroup(peaksInstance, label, ["Segments", "Labeled-Speakers"], {renderEmpty: true});
      }
    });

    //#region add custom segment
    const customSegmentsBranch = document.getElementById("Custom-Segments");
    const customSpan = document.getElementById("Custom-Segments-span");
    let customDuration = 0;
    let segmentCounter = 1;
    // Add (custom) segment
    document.querySelector('button[data-action="add-segment"]').addEventListener('click', function () {
      customSegmentsBranch.hidden = false;
      const label = 'Custom Segment ' + segmentCounter++;
      let segment = {
        startTime: peaksInstance.player.getCurrentTime(),
        endTime: peaksInstance.player.getCurrentTime() + 10,
        labelText: label,
        editable: true
      };
      segment = peaksInstance.segments.add(segment);
      renderSegment(peaksInstance, segment, "Custom-Segments", ["Segments"], {"treeText": label});
      customDuration += 10;
      customSpan.title = `Duration: ${customDuration.toFixed(2)}`;
      newChanges = true;
    });
    //#endregion

    //#region load annoations
    const record = {
        'user': user.innerHTML,
        'filename': fileName,
    }
    const json = JSON.stringify(record)
    var request = new XMLHttpRequest()
    request.open('POST', 'loadannotations', true);
    request.setRequestHeader('Content-Type', 'application/json; charset=UTF-8');
  
    request.send(json)
    request.onload = function () {
        let jsonData = JSON.parse(request.response);
        const labelRegex = /Custom Segment /;
        for (let i = 0; i < jsonData.length; i++) {
          customSegmentsBranch.hidden = false;
          const label = jsonData[i]["label"];
          if (label.match(labelRegex)) { segmentCounter++; }
          let segment = {
            startTime: jsonData[i]["start"],
            endTime: jsonData[i]["end"],
            labelText: label,
            editable: true
          };
          segment = peaksInstance.segments.add(segment);
          renderSegment(peaksInstance, segment, "Custom-Segments", ["Segments"], {"treeText": label});
          customDuration += jsonData[i]["end"] - jsonData[i]["start"];
          customSpan.title = `Duration: ${customDuration.toFixed(2)}`;
        }
    };
    //#endregion

    request.open('POST', 'loadlabels', true);
    request.setRequestHeader('Content-Type', 'application/json; charset=UTF-8');
    
    request.send(json)
    request.onload = function () {
      let jsonData = JSON.parse(request.response);
      for (let i = 0; i < jsonData.length; i++) {
        var label = jsonData[i]['label'];
        var speakers = jsonData[i]['speakers'].split("|");
        console.log(speakers);
        if (!labels.includes(label)){ //if this label isn't already in add it
          labels.push(label);
          labelsColors[label] = getRandomColor();
          renderGroup(peaksInstance, label, ["Segments", "Labeled-Speakers"], {renderEmpty: true});
          console.log("Added " + label + " to labels");
        }
        for (let speaker of speakers){
          addToLabel(peaksInstance, label, speaker, true);
        }
      }
    };

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
    for (let i = 0; i < snrArray.length; i++){
      for (let j = 0; j < snrArray.length - i - 1; j++){
        if (snrArray[j+1][1] > snrArray[j][1]){
          [snrArray[j + 1], snrArray[j]] = [snrArray[j], snrArray[j + 1]]
        }
      }
    }
    for (let i = 0; i < snrArray.length; i++){
      document.getElementById(`${snrArray[i][0]}-span`).innerHTML += "\n num. " + String(i + 1) + " snr";
    }

    for (var key in snrs){
      counter++;
      snrMean += snrs[key];
      durMean += durations[key];
    }
    snrMean /= counter;
    durMean /= counter;
    var snrStdDev = 0;
    var durStdDev = 0;
    for (var key in snrs){
      snrStdDev += (snrs[key] - snrMean) ** 2;
      durStdDev += (durations[key] - durMean) ** 2;
    }
    snrStdDev /= counter;
    durStdDev /= counter;
    snrStdDev = Math.sqrt(snrStdDev);
    durStdDev = Math.sqrt(durStdDev);
    for (var key in snrs){
      snrs[key] = (snrs[key] - snrMean) / snrStdDev;  // now snrs stores z scores of snrs
      durations[key] = (durations[key] - durMean) / durStdDev;  // now durations stores z scores of durations
    }
    var overallZScores = {};
    for (var key in snrs){
      overallZScores[key] = snrs[key] + durations[key];
    }
    var maxSpeaker = "Speaker 1";
    var maxZ = overallZScores[maxSpeaker];
    for (let key of Object.keys(snrs)){
      if(maxZ < overallZScores[key]){
        maxSpeaker = key;
        maxZ = overallZScores[key];
      }
    }
    var primarySpeakerSpan = document.getElementById(`${maxSpeaker}-span`);
    primarySpeakerSpan.style.color = "violet";
    //#endregion

    document.querySelector('button[data-action="save-annotations"]').addEventListener('click', function(event) {
      saveAnnotations(segmentsFromGroup("Custom-Segments", {"peaks": peaksInstance, "simple": true}));
    });

    const segmentsPlay = groupsButtons["Segments"][0];
    const segmentsLoop = groupsButtons["Segments"][1];
    segmentsPlay.innerHTML = feather.icons.play.toSvg({"width": 17, "height": 17, "stroke": "black", "fill": "black"});
    segmentsLoop.innerHTML = feather.icons.repeat.toSvg({"width": 17, "height": 17, "stroke": "black", "stroke-width": 2.5});

    //#region uncheck everything on start
    toggleSegments(peaksInstance, "Segments", false);
    document.getElementById("Segments-nested").classList.add("active");
    
    groupsCheckboxes["Segments"].checked = true;
    groupsCheckboxes["Segments"].addEventListener("click", function () { toggleSegments(peaksInstance, "Segments", this.checked); });
    toggleSegments(peaksInstance, "Custom-Segments", true);
    customSegmentsBranch.hidden = true;

    segmentsPlay.style.pointerEvents = "auto";
    segmentsLoop.style.pointerEvents = "auto";
    const segmentsPlayIcon = segmentsPlay.firstElementChild;
    const segmentsLoopIcon = segmentsLoop.firstElementChild;
    segmentsPlayIcon.style.stroke = "black";
    segmentsPlayIcon.style.fill = "black";
    segmentsLoopIcon.style.stroke = "black";
    segmentsPlay.addEventListener("click", function () { playGroup(peaksInstance, "Segments"); });
    segmentsLoop.addEventListener("click", function () { playGroup(peaksInstance, "Segments", true); });
    //#endregion
  });
}

const urlParams = new URLSearchParams(window.location.search);
const fileName = urlParams.get("audiofile");
var user = document.getElementById("user");


function saveAnnotations(customSegments) {
  const record = {
      'user': user.innerHTML,
      'filename': fileName,
      'segments': customSegments
  }
  const json = JSON.stringify(record)
  var request = new XMLHttpRequest()
  request.open('POST', 'saveannotations', true);
  request.setRequestHeader('Content-Type', 'application/json; charset=UTF-8');

  request.send(json)
  request.onload = function() {
      // done
      console.log('Annotations saved')
  };
  newChanges = false;
}

// https://stackoverflow.com/a/7317311
window.onload = function() {
  window.addEventListener("beforeunload", function (event) {
      if (!newChanges) { return undefined; }
      
      var confirmationMessage = "You have unsaved changes. If you leave before saving, these changes will be lost.";
      // returnValue and return for cross compatibility 
      (event || window.event).returnValue = confirmationMessage;
      return confirmationMessage;
  });
};

function saveLabels(label, speaker) {
  console.log('Saving label', fileName);
  const record = {
    'user': user.innerHTML,
    'filename': fileName,
    'label': label,
    'speaker': speaker
  }

  const json = JSON.stringify(record)
  console.log(json)
  var request = new XMLHttpRequest()
  request.open('POST', 'savelabels', true);
  request.setRequestHeader('Content-Type', 'application/json; charset=UTF-8');
  request.send(json)
  request.onload = function() {
      // done
      console.log('Labels saved')
  };
}

runPeaks(fileName);
