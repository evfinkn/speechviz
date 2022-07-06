import Peaks from "peaks.js";
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
  const segmentRemoveIcon = feather.icons.x.toSvg({"width": 12, "height": 12, "stroke": "black", "stroke-width": 2.5});

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
      if (checked) {
        groupsButtons[group].forEach(function (button) {
          button.style.pointerEvents = "auto";
          const buttonIcon = button.firstElementChild;
          buttonIcon.style.stroke = "black";
          if (buttonIcon.getAttribute("fill") != "none") { buttonIcon.style.fill = "black"; }
        });
      }
      else {
        groupsButtons[group].forEach(function (button) {
          button.style.pointerEvents = "none";
          const buttonIcon = button.firstElementChild;
          buttonIcon.style.stroke = "gray";
          if (buttonIcon.getAttribute("fill") != "none") { buttonIcon.style.fill = "gray"; }
        });
      } 
      const groupCheckbox = groupsCheckboxes[group];
      groupCheckbox.checked = checked;

      if (checked) { groupCheckbox.parentElement.querySelector("ul").classList.add("active"); }
      else { groupCheckbox.parentElement.querySelector("ul").classList.remove("active"); }

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

  const initPopup = function(group){
    var popup = document.getElementById("popup");
    var popupContent = document.getElementById("popup-content");
    const header = document.createElement("h2");
    header.innerHTML = "Choose a label: ";
    popupContent.appendChild(header);
    var closeButton = document.createElement("a");
    closeButton.classList.add("close");
    closeButton.id = "close";
    closeButton.innerHTML = "&times";
    popupContent.appendChild(closeButton);

  }

  const renderSegment = function (peaks, segment, group, path) {
    // create the tree item for the segment
    const li = document.createElement("li");
    li.style.fontSize = "12px";
    li.innerHTML = `<input style="transform:scale(0.85);" type="checkbox" data-action="toggle-segment" data-id="${segment.id}" autocomplete="off" checked><span title="Duration: ${(segment.endTime - segment.startTime).toFixed(2)}">${segment.id.replace("peaks.", "")}</span> <a href="#" style="text-decoration:none;" data-id="${segment.id}">${segmentPlayIcon}</a><a href="#" style="text-decoration:none;" data-id="${segment.id}">${segmentLoopIcon}</a><ul id="${segment.id}-nested" class="nested active"></ul>`;
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

    if (segment.editable) {
      const template = document.createElement("template");
      template.innerHTML = `<td><a href="#" data-id="${segment.id}">${segmentRemoveIcon}</a></td>`;
      const remove = template.content.firstElementChild;
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
    const branch = document.createElement("li");
    branch.id = group[0];
    branch.style.fontSize = "18px";
    let spanHTML;
    if(group.length == 3){
      spanHTML = `<span id="${group[0]}-span" style="font-size:18px;" title="${"SNR: " + group[2].toFixed(2)}">${group[0]}</span>`
      snrs[group[0]] = group[2];

      branch.innerHTML = `<input type="checkbox" data-action="toggle-segment" data-id="${group[0]}" autocomplete="off">${spanHTML} <a href="#" style="text-decoration:none;" data-id="${group[0]}">${groupPlayIcon}</a><a href="#" style="text-decoration:none;" data-id="${group[0]}">${groupLoopIcon}</a><ul id="${group[0]}-nested" class="nested"></ul>`;
      document.getElementById(`${parent}-nested`).append(branch);

       // event listener for clicking on a speaker
       document.getElementById(`${group[0]}-button`).addEventListener("click", function(){
        initPopup(group[0]);  
        var popup = document.getElementById("popup");
        var popupContent = document.getElementById("popup-content");
        popup.style.display = "block";

        labels.forEach(label => {
          // add radio button
          var row = `<input type="radio" id="${group[0]}" name="${group[0]}" data-action="toggle-segment" label-id="${label}" autocomplete="off">${label}`;
          popupContent.innerHTML += row;

          // event listener for clicking a radio button
          document.getElementsByName(group[0]).forEach(function(button){           
            button.addEventListener("click", function () {
              const label = button.getAttribute("label-id");
              let children = document.querySelector(`[id='${group[0]}-nested']`);
              document.getElementById(`${label}-nested`).append(children);
              // add event listeners check children if parent is checked
              document.querySelector(`[data-id='${group[0]}']`).remove();
              document.getElementById(group[0]+'-span').remove();             
              popupContent.innerHTML = "";
              popup.style.display = "none";   
            });
          });         
        });
        // close popup function
        document.querySelectorAll(".close").forEach(function (button) {
          button.addEventListener("click", function(){ 
            popupContent.innerHTML = "";
            popup.style.display = "none";});
        });       
      });    
    }
    else{
      spanHTML = `<span id="${group[0]}-span" style="font-size:18px;">${group[0]}</span>`;

      branch.innerHTML = `<input type="checkbox" data-action="toggle-segment" data-id="${group[0]}" autocomplete="off">${spanHTML} <a href="#" style="text-decoration:none;" data-id="${group[0]}">${groupPlayIcon}</a><a href="#" style="text-decoration:none;" data-id="${group[0]}">${groupLoopIcon}</a><ul id="${group[0]}-nested" class="nested"></ul>`;
      document.getElementById(`${parent}-nested`).append(branch);
    }

    // add inputs for group to groupInputs and add event listeners to them
    const groupCheckbox = branch.firstChild;
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
    const span = branch.children[1];
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

    // store elements that are needed multiple times to save time from re-searching for them
    const seekTime = document.getElementById('seek-time');
    const overview = peaksInstance.views.getView('overview');
    const zoomview = peaksInstance.views.getView('zoomview');

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

    // Seek
    document.querySelector('button[data-action="seek"]').addEventListener('click', function () {
      const seconds = parseFloat(seekTime.value);
      if (!Number.isNaN(seconds)) { peaksInstance.player.seek(seconds); }
    });
    document.getElementById('enable-seek').addEventListener('change', function () {
      zoomview.enableSeek(this.checked);
      overview.enableSeek(this.checked);
    });

    // Auto-scroll
    document.getElementById('auto-scroll').addEventListener('change', function () { zoomview.enableAutoScroll(this.checked); });

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

    // Context menus
    peaksInstance.on('segments.contextmenu', function (event) { event.evt.preventDefault(); });
    peaksInstance.on('overview.contextmenu', function (event) { event.evt.preventDefault(); });

    // generate the tree
    renderGroup(peaksInstance, "Custom-Segments", ["Segments"], {renderEmpty: true});
    const customSegmentsBranch = document.getElementById("Custom-Segments");
    // generate labeled speakers branch
    renderGroup(peaksInstance, "Labeled-Speakers", ["Segments"], {renderEmpty: true});
    const labeledSpeakersBranch = document.getElementById("Custom-Segments");

    for (let segmentsGroup of importedSegments) { renderGroup(peaksInstance, segmentsGroup, ["Segments"]); }

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
      renderSegment(peaksInstance, segment, "Custom-Segments", ["Segments"]);
      customDuration += 10;
      customSpan.title = `Duration: ${customDuration.toFixed(2)}`;
      newChanges = true;
    });

    
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
        for (let i = 0; i < jsonData.length; i++) {
          customSegmentsBranch.hidden = false;
          const label = 'Custom Segment ' + segmentCounter++;
          let segment = {
            startTime: jsonData[i]['start'],
            endTime: jsonData[i]['end'],
            labelText: jsonData[i]['label'],
            editable: true
          };
          segment = peaksInstance.segments.add(segment);
          renderSegment(peaksInstance, segment, "Custom-Segments", ["Segments"]);
          customDuration += jsonData[i]['end'] - jsonData[i]['start'];
          customSpan.title = `Duration: ${customDuration.toFixed(2)}`;
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

    //getting z-scores for snrs and durations
    var snrMean = 0;
    var durMean = 0;
    var counter = 0;
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
      snrs[key] = (snrs[key] - snrMean) / snrStdDev; //now snrs stores z scores of snrs
      durations[key] = (durations[key] - durMean) / durStdDev; //now durations stores z scores of durations
    }
    var overallZScores = {};
    for (var key in snrs){
      overallZScores[key] = snrs[key] + durations[key];
    }
    var maxSpeaker;
    var maxZ;
    for (var key in snrs){
      if (maxZ == null){
        maxSpeaker = key;
        maxZ = overallZScores[key];
      }
      else{
        if(maxZ < overallZScores[key]){
          maxSpeaker = key;
          maxZ = overallZScores[key];
        }
      }
    }
    var primarySpeakerSpan = document.getElementById(`${maxSpeaker}-span`);
    primarySpeakerSpan.style = "color:violet"

    document.querySelector('button[data-action="save-annotations"]').addEventListener('click', function(event) {
      saveAnnotations(segmentsFromGroup("Custom-Segments", {"peaks": peaksInstance, "simple": true}));
    });

    const segmentsPlay = groupsButtons["Segments"][0];
    const segmentsLoop = groupsButtons["Segments"][1];
    segmentsPlay.innerHTML = feather.icons.play.toSvg({"width": 17, "height": 17, "stroke": "black", "fill": "black"});
    segmentsLoop.innerHTML = feather.icons.repeat.toSvg({"width": 17, "height": 17, "stroke": "black", "stroke-width": 2.5});

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
  });
}

const urlParams = new URLSearchParams(window.location.search);
const fileName = urlParams.get("audiofile");
var user = document.getElementById("user");


function saveAnnotations(customSegments) {
  console.log('Saving annotations', fileName);
  const record = {
      'user': user.innerHTML,
      'filename': fileName,
      'segments': customSegments
  }
  const json = JSON.stringify(record)
  console.log(json)
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

runPeaks(fileName);
