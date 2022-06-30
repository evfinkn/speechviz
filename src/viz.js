import Peaks from "peaks.js";

const audio =  document.getElementById('audio');
const segmentsTree = document.getElementById("Segments-nested");
const segmentsTable = document.getElementById("Segments");

var runPeaks = async function (fileName) {
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

  // object containing ALL segments (hidden and visible)
  // {id: segment}
  const segmentsByID = {};
  // segments that aren't visible on peaksjs
  // {group: {childGroup: {...: {id, segment}}}}
  const hiddenSegments = {};
  // segments that are visible on peaksjs
  // {group: {childGroup: {...: {id, segment}}}}
  const visibleSegments = {};

  // dictionary of checkboxes for every group
  // {group: [HTMLInputElement for tree, HTMLInputElement for table]}
  const groupsCheckboxes = { "Segments": document.querySelectorAll("input[data-id='Segments']") };
  // dictionary of buttons for every group
  // {group: [HTMLLinkElement for tree play, HTMLLinkElement for tree loop, HTMLLinkElement for table play, HTMLLinkElement for table loop]}
  const groupsButtons = { "Segments": document.querySelectorAll("a[data-id='Segments']") };

  const segmentsFromGroup = function (group, {visible = false, hidden = false, peaks = undefined, sort = false} = {}) {
    if (peaks) {  // get segments from peaks instead of visibleSegments or hiddenSegments
      return peaks.segments.getSegments().filter(segment => segment.labelText == group);
    }

    let segments = [];
    if (!(group in visibleSegments)) {  // group is a group of groups
      for (let child of groupsCheckboxes[group][0].dataset.children.split("|")) {
        segments = segments.concat(segmentsFromGroup(child, arguments[1]));  // get the groups from the children
      }
    }
    else {  // group is a group of segments
      if (visible) { segments = Object.values(visibleSegments[group]); }  // get segments from visibleSegments
      if (hidden) { segments = segments.concat(Object.values(hiddenSegments[group])); }  // get segments from hiddenSegments
    }
    if (sort) { segments.sort((seg1, seg2) => seg1.startTime > seg2.startTime); }  // sort by start time

    return segments;
  }
  
  const segmentIter = function* (segments, loop = false) {  // custom iterator for infinite iteration (when loop is true)
    for (let i = 0; (i < segments.length) || loop; i++) { yield segments[i % segments.length]; }
  }

  let curPlaying = null;
  
  const playNext = function (peaks, group, iter) {
    const next = iter.next();
    if (curPlaying == group) {
        if (!next.done) {
          peaks.player.playSegment(next.value);  // [1] because each value of Array.entries() is [index of item, item], we want item
          peaks.once("player.ended", function () { playNext(peaks, group, iter); });
        }
        else {
          curPlaying = null;
          iter.return();
        }
    }
    else { iter.return(); }
  }

  const playGroup = function (peaks, group, loop = false) {
    curPlaying = group;
    const segments = segmentsFromGroup(group, {visible: true, sort: true});
    const iter = segmentIter(segments, loop);
    playNext(peaks, group, iter);
  }

  const toggleSegments = function (peaks, group, checked) {
    // groupsCheckboxes has a key for every group, so if not in there, group is a segment id
    if (!(group in groupsCheckboxes)) {
      const segment = segmentsByID[group];
      segment.checkboxes.forEach(function (checkbox) { checkbox.checked = checked; });

      const parent = segment.path.at(-2);  // get group segment belongs to
      if (checked) {    // add the segment back to peaks and remove it from hiddenSegments
        visibleSegments[parent][group] = segment;
        peaks.segments.add(segment);
        segment.buttons.forEach(function (button) { button.style.pointerEvents = "auto"; });
        delete hiddenSegments[parent][group];
      }
      else {  // add the segment to hiddenSegments and remove it from peaks
        hiddenSegments[parent][group] = segment;
        peaks.segments.removeById(group);
        segment.buttons.forEach(function (button) { button.style.pointerEvents = "none"; });
        delete visibleSegments[parent][group];
      }
    }
    else {  // group is not a segment id
      if (checked) { groupsButtons[group].forEach(function (button) { button.style.pointerEvents = "auto"; }); }
      else { groupsButtons[group].forEach(function (button) { button.style.pointerEvents = "none"; }); } 
      const [groupTreeCheckbox, groupTableCheckbox] = groupsCheckboxes[group];
      groupTreeCheckbox.checked = checked;
      groupTableCheckbox.checked = checked;

      if (checked) { groupTreeCheckbox.parentElement.querySelector("ul").classList.add("active"); }
      else { groupTreeCheckbox.parentElement.querySelector("ul").classList.remove("active"); }

      if (!(group in visibleSegments)) {  // group is a group of groups
        for (let child of groupTreeCheckbox.dataset.children.split("|")) { toggleSegments(peaks, child, checked); }
      }
      else {  // group is a group of segments
        if (checked) {
          const segments = segmentsFromGroup(group, {hidden: true});
          segments.forEach(function (segment) {
            segment.checkboxes.forEach(function (checkbox) { checkbox.checked = checked; });
          });
          peaks.segments.add(segments);
          visibleSegments[group] = Object.assign({}, visibleSegments[group], hiddenSegments[group]);
          hiddenSegments[group] = {};
        }
        else {
          segmentsFromGroup(group, {visible: true}).forEach(function (segment) {
            segment.checkboxes.forEach(function (checkbox) { checkbox.checked = checked; });
            peaks.segments.removeById(segment.id);
          });
          hiddenSegments[group] = Object.assign({}, hiddenSegments[group], visibleSegments[group]);
          visibleSegments[group] = {};
        }
      }
    }
  }

  const renderSegment = function (peaks, segment, group, path) {
    // create the tree item for the segment
    const li = document.createElement("li");
    li.style.fontSize = "12px";
    li.innerHTML = `<input type="checkbox" data-action="toggle-segment" data-id="${segment.id}" autocomplete="off">${segment.id.replace("peaks.", "")} <a href="#" style="color:black;text-decoration:none;font-size:16px;" data-id="${segment.id}">&#x25B6;</a><a href="#" style="color:black;text-decoration:none;font-size:14px;" data-id="${segment.id}">&#x1f501;</a><ul id="${segment.id}-nested" class="nested active">Duration: ${(segment.endTime - segment.startTime).toFixed(2)}</ul>`;
    document.getElementById(`${group}-nested`).append(li);

    // create the table item for the segment
    const row = document.getElementById(group).insertRow(-1);
    row.id = segment.id;
    row.innerHTML = `<td><input data-action="toggle-segment" type="checkbox" data-id="${segment.id}">${segment.id}</td><td>${segment.startTime.toFixed(3)}</td><td>${segment.endTime.toFixed(3)}</td><td><a href="#" data-id="${segment.id}">Play</a></td><td><a href="#" data-id="${segment.id}">Loop</a></td>`;

    // segment checkboxes
    const segmentTreeCheckbox = li.firstElementChild;
    const segmentTableCheckbox = row.firstElementChild.firstElementChild;

    segmentTreeCheckbox.addEventListener("click", function () { toggleSegments(peaks, this.dataset.id, this.checked); });
    segmentTableCheckbox.addEventListener("click", function () { toggleSegments(peaks, this.dataset.id, this.checked); });

    // segment play/loop buttons
    const segmentTreePlay = li.children[1];
    const segmentTreeLoop = li.children[2];
    const segmentTablePlay = row.children[3].firstElementChild;
    const segmentTableLoop = row.children[4].firstElementChild;

    segmentTreePlay.addEventListener("click", function () { peaks.player.playSegment(segment); });
    segmentTreeLoop.addEventListener("click", function () { peaks.player.playSegment(segment, true); });
    segmentTablePlay.addEventListener("click", function () { peaks.player.playSegment(segment); });
    segmentTableLoop.addEventListener("click", function () { peaks.player.playSegment(segment, true); });

    segment.path = path.concat(group, segment.id);  // path is a list of groups the segment belongs to
    segment.checkboxes = [segmentTreeCheckbox, segmentTableCheckbox];
    segment.buttons = [segmentTreePlay, segmentTreeLoop, segmentTablePlay, segmentTableLoop];

    segmentsByID[segment.id] = segment;
    visibleSegments[group][segment.id] = segment;
  }

  const renderGroup = function (peaks, group, path, {renderEmpty = false} = {}) {
    if (typeof group == "string") { group = [group, []]; }
    if (group[1].length == 0 && !renderEmpty) { return; } 	// if group has no segments, return

    const parent = path.at(-1);  // parent needed to find where in tree to nest group
    // add group to the parents children
    groupsCheckboxes[parent].forEach(function (parentInput) {
      const parentChildren = parentInput.dataset.children;
      parentInput.dataset.children = parentChildren === undefined ? group[0] : `${parentChildren}|${group[0]}`;
    });

    // create the tree item for the group
    const branch = document.createElement("li");
    branch.innerHTML = `<input type="checkbox" data-action="toggle-segment" data-id="${group[0]}" autocomplete="off">${group[0]} <a href="#" style="color:black;text-decoration:none;font-size:16px;" data-id="${group[0]}">&#x25B6;</a><a href="#" style="color:black;text-decoration:none;font-size:14px;" data-id="${group[0]}">&#x1f501;</a><ul id="${group[0]}-nested" class="nested"></ul>`;
    document.getElementById(`${parent}-nested`).append(branch);

    // create the table item for the group
    const tbody = segmentsTable.createTBody();
    tbody.id = group[0];
    const head = tbody.insertRow(-1);
    head.innerHTML = `<th><input data-action="toggle-segment" type="checkbox" data-id="${group[0]}">${group[0]}</th><th></th><th></th><th><a href="#" data-id="${group[0]}">Play</a></th><th><a href="#" data-id="${group[0]}">Loop</a></th>`;

    // add inputs for group to groupInputs and add event listeners to them
    const groupTreeCheckbox = branch.firstChild
    const groupTableCheckbox = head.firstChild.firstChild;
    groupTreeCheckbox.addEventListener("click", function () { toggleSegments(peaks, group[0], this.checked); });
    groupTableCheckbox.addEventListener("click", function () { toggleSegments(peaks, group[0], this.checked); });

    const groupTreePlay = branch.children[1];
    const groupTreeLoop = branch.children[2];
    const groupTablePlay = head.children[3].firstElementChild;
    const groupTableLoop = head.children[4].firstElementChild;
    groupTreePlay.addEventListener("click", function () { playGroup(peaks, group[0]); });
    groupTreeLoop.addEventListener("click", function () { playGroup(peaks, group[0], true); });
    groupTablePlay.addEventListener("click", function () { playGroup(peaks, group[0]); });
    groupTableLoop.addEventListener("click", function () { playGroup(peaks, group[0], true); });

    groupsCheckboxes[group[0]] = [groupTreeCheckbox, groupTableCheckbox];
    groupsButtons[group[0]] = [groupTreePlay, groupTreeLoop, groupTablePlay, groupTableLoop];

    if (!Array.isArray(group[1][0])) {
      hiddenSegments[group[0]] = {};
      visibleSegments[group[0]] = {};
      peaks.segments.add(group[1]).forEach(function (segment) { renderSegment(peaks, segment, group[0], path); });
    }
    else {
      for (let nestedGroup of group[1]) { renderGroup(peaks, nestedGroup, path.concat(group[0])); }
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
    document.querySelector('[data-action="zoom-in"]').addEventListener('click', function () { peaksInstance.zoom.zoomIn(); });
    document.querySelector('[data-action="zoom-out"]').addEventListener('click', function () { peaksInstance.zoom.zoomOut(); });

    // Seek
    document.querySelector('button[data-action="seek"]').addEventListener('click', function () {
      const seconds = parseFloat(seekTime.value);
      if (!Number.isNaN(seconds)) { peaksInstance.player.seek(seconds); }
    });
    document.getElementById('enable-seek').addEventListener('change', function () {
      zoomview.enableSeek(this.checked);
      overview.enableSeek(this.checked);
    });

    let segmentCounter = 1;

    // Add (custom) segment
    document.querySelector('button[data-action="add-segment"]').addEventListener('click', function () {
      const label = 'Custom segment' + segmentCounter++;
      let segment = {
        startTime: peaksInstance.player.getCurrentTime(),
        endTime: peaksInstance.player.getCurrentTime() + 10,
        labelText: label,
        editable: true
      };
      segment = peaksInstance.segments.add(segment);
      renderSegment(peaksInstance, segment, "Custom-Segments");
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
    peaksInstance.on("segments.dragend", function (event) {
      const segment = event.segment;
      const startTime = segment.startTime;
      const endTime = segment.endTime;
      segment.startText.innerHTML = startTime.toFixed(3);
      segment.endText.innerHTML = endTime.toFixed(3);
      segment.durationText.innerHTML = (segment.endTime - segment.startTime).toFixed(2);
    });

    // generate the tree and the table
    renderGroup(peaksInstance, "Custom-Segments", ["Segments"], {renderEmpty: true});
    for (let segmentsGroup of importedSegments) { renderGroup(peaksInstance, segmentsGroup, ["Segments"]); }

    toggleSegments(peaksInstance, "Segments", false);
    segmentsTree.classList.add("active");
    groupsCheckboxes["Segments"].forEach(function (button) {
      button.checked = true;
      button.addEventListener("click", function () { toggleSegments(peaksInstance, "Segments", this.checked); })
    });
    groupsButtons["Segments"].forEach(function (button) {
      button.style.pointerEvents = "auto";
      if (button.innerHTML == "\u25B6" || button.innerHTML == "Play") {
        button.addEventListener("click", function () { playGroup(peaksInstance, "Segments"); });
      }
      else { button.addEventListener("click", function () { playGroup(peaksInstance, "Segments", true); }); }
    });
  });
}

const urlParams = new URLSearchParams(window.location.search);
const fileName = urlParams.get("audiofile");
runPeaks(fileName);
