import Peaks from "peaks.js";

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
  ] */
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
  // dictionary of checkboxes for eveery group
  // {group: [HTMLInputElement for tree, HTMLInputElement for table]}
  const groupsInputs = {"Segments": document.querySelectorAll("input[data-id='Segments']")};

  const toggleSegments = function (peaks, group, checked) {
    // groupInputs has a key for every group, so if not in there, group is a segment id
    if (!(group in groupsInputs)) {
      const segment = segmentsByID[group];
      segment.treeCheckbox.checked = checked;
      segment.tableCheckbox.checked = checked;

      const parent = segment.path.at(-2);  // get group segment belongs to
      if (checked) {    // add the segment back to peaks and remove it from hiddenSegments
        visibleSegments[parent][group] = segment;
        peaks.segments.add(segment);
        delete hiddenSegments[parent][group];
      }
      else {  // add the segment to hiddenSegments and remove it from peaks
        hiddenSegments[parent][group] = segment;
        peaks.segments.removeById(group);
        delete visibleSegments[parent][group];
      }
    }
    else {  // group is not a segment id
      const [treeInput, tableInput] = groupsInputs[group];
      treeInput.checked = checked;
      tableInput.checked = checked;

      if (checked) { treeInput.parentElement.querySelector("ul").classList.add("active"); }
      else { treeInput.parentElement.querySelector("ul").classList.remove("active"); }

      if (!(group in visibleSegments)) {  // group is a group of groups
        for (let child of treeInput.dataset.children.split("|")) { toggleSegments(peaks, child, checked); }
      }
      else {  // group is a group of segments
        if (checked) {
          Object.values(hiddenSegments[group]).forEach(function (segment) {
            segment.treeCheckbox.checked = checked;
            segment.tableCheckbox.checked = checked;
          });
          peaks.segments.add(Object.values(hiddenSegments[group]));
          visibleSegments[group] = Object.assign({}, visibleSegments[group], hiddenSegments[group]);
          hiddenSegments[group] = {};
        }
        else {
          Object.values(visibleSegments[group]).forEach(function (segment) {
            segment.treeCheckbox.checked = checked;
            segment.tableCheckbox.checked = checked;
            peaks.segments.removeById(segment.id);
          });
          hiddenSegments[group] = Object.assign({}, hiddenSegments[group], visibleSegments[group]);
          visibleSegments[group] = {};
        }
      }
    }
  }

  const renderGroup = function (peaks, group, path) {
    if (group[1].length == 0) { return; } 	// if group has no segments, return

    const parent = path.split("|").at(-1);  // parent needed to find where in tree to nest group
    // add group to the parents children
    document.querySelectorAll(`input[data-id="${parent}"]`).forEach(function (parentInput) {
      const parentChildren = parentInput.dataset.children;
      parentInput.dataset.children = parentChildren === undefined ? group[0] : `${parentChildren}|${group[0]}`;
    });

    // create the tree item for the group
    const branch = document.createElement("li");
    branch.innerHTML = `<input type="checkbox" data-action="toggle-segment" data-id="${group[0]}" checked autocomplete="off">${group[0]}<ul id="${group[0]}-nested" class="nested active"></ul>`;
    document.getElementById(`${parent}-nested`).append(branch);

    // create the table item for the group
    const tbody = segmentsTable.createTBody();
    tbody.id = group[0];
    const head = tbody.insertRow(-1);
    head.innerHTML = `<th><input data-action="toggle-segment" type="checkbox" data-id="${group[0]}" checked>${group[0]}</th>`;

    // add inputs for group to groupInputs and add event listeners to them
    const treeInput = branch.firstChild
    const tableInput = head.firstChild.firstChild;
    groupsInputs[group[0]] = [treeInput, tableInput];
    treeInput.addEventListener("click", function() { toggleSegments(peaks, group[0], this.checked); });
    tableInput.addEventListener("click", function() { toggleSegments(peaks, group[0], this.checked); });
    
    if (!Array.isArray(group[1][0])) {
      hiddenSegments[group[0]] = {}
      visibleSegments[group[0]] = {};
      
      if (group.length == 3)
      	peaks.segments.add(group[2]);
      else
	peaks.segments.add(group[1]);
      const segments = peaks.segments.getSegments().filter(segment => segment.labelText == group[0]);
      for (let segment of segments) {
        segment.path = path.split("|").concat(group[0], segment.id);

        // create the tree item for the segment
        const li = document.createElement("li");
        li.id = segment.id;
        li.style.fontSize = "12px";
        li.innerHTML = `<input type="checkbox" data-action="toggle-segment" data-id="${segment.id}" checked autocomplete="off">${segment.id.replace("peaks.", "")} <a href="#${segment.id}" style="color:black;text-decoration:none;font-size:16px"; data-action="play-segment" data-id="${segment.id}">&#x25B6;</a><a href="#${segment.id}" style="color:black;text-decoration:none;font-size:14px"; data-action="loop-segment" data-id="${segment.id}">&#x1f501;</a><ul id="${segment.id}-nested" class="nested active">Duration: ${(segment.endTime - segment.startTime).toFixed(2)}</ul>`;
        document.getElementById(`${group[0]}-nested`).append(li);

        // create the table item for the segment
        const row = tbody.insertRow(-1);
        row.id = segment.id;
        row.innerHTML = `<td><input data-action="toggle-segment" type="checkbox" data-id="${segment.id}" checked>${segment.id}</td><td>${segment.startTime.toFixed(3)}</td><td>${segment.endTime.toFixed(3)}</td><td><a href="#${segment.id}" data-action="play-segment" data-id="${segment.id}">Play</a></td><td><a href="#${segment.id}" data-action="loop-segment" data-id="${segment.id}">Loop</a></td>`;

        // add the checkboxes for the segment to the segment and add event listeners to them
        const treeCheckbox = li.firstChild;
        const tableCheckbox = row.firstChild.firstChild;
        segment.treeCheckbox = treeCheckbox;
        segment.tableCheckbox = tableCheckbox;
        treeCheckbox.addEventListener("click", function() { toggleSegments(peaks, this.dataset.id, this.checked); });
        tableCheckbox.addEventListener("click", function() { toggleSegments(peaks, this.dataset.id, this.checked); });

        segmentsByID[segment.id] = segment;
        visibleSegments[group[0]][segment.id] = segment;
      }
    }
    else {
      for (let nestedGroup of group[1]) { renderGroup(peaks, nestedGroup, `${path}|${group[0]}`); }
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
    mediaElement: document.getElementById('audio'),
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

    var segmentCounter = 1;

    // Add (custom) segment
    document.querySelector('button[data-action="add-segment"]').addEventListener('click', function () {
      const segName = 'Test segment' + segmentCounter++;
      var segment = {
        startTime: peaksInstance.player.getCurrentTime(),
        endTime: peaksInstance.player.getCurrentTime() + 10,
        labelText: segName,
        editable: true
      };
      segment = peaksInstance.segments.add(segment);
      segment.path = ["Segments", "Custom-Segments", segment.id];

      // make it visible in tree and table (path???)
      const li = document.createElement("li");
      li.id = segment.id;
      li.style.fontSize = "12px";
      li.innerHTML = `<input type="checkbox" data-action="toggle-segment" data-id="${segment.id}" checked autocomplete="off">${segment.id.replace("peaks.", "")} <a href="#${segment.id}" style="color:black;text-decoration:none;font-size:16px"; data-action="play-segment" data-id="${segment.id}">&#x25B6;</a><a href="#${segment.id}" style="color:black;text-decoration:none;font-size:14px"; data-action="loop-segment" data-id="${segment.id}">&#x1f501;</a><ul id="${segment.id}-nested" class="nested active">Duration: <span id="${segment.id}-duration">${(segment.endTime - segment.startTime).toFixed(2)}<span></ul>`;
      document.getElementById("Custom-Segments-nested").append(li);

      li.children[1].addEventListener("click", function() { peaksInstance.player.playSegment(segment); });
      li.children[2].addEventListener("click", function() { peaksInstance.player.playSegment(segment, true); });

      // create the table item for the segment
      const row = tbody.insertRow(-1);
      row.id = segment.id;
      row.innerHTML = `<td><input data-action="toggle-segment" type="checkbox" data-id="${segment.id}" checked>${segment.id}</td><td id="${segment.id}-start">${segment.startTime.toFixed(3)}</td><td id="${segment.id}-end">${segment.endTime.toFixed(3)}</td><td><a href="#${segment.id}" data-action="play-segment" data-id="${segment.id}">Play</a></td><td><a href="#${segment.id}" data-action="loop-segment" data-id="${segment.id}">Loop</a></td>`;

      row.children[3].firstChild.addEventListener("click", function() { peaksInstance.player.playSegment(segment); });
      row.children[4].firstChild.addEventListener("click", function() { peaksInstance.player.playSegment(segment, true); });

      segment.durationText = document.getElementById(`${segment.id}-duration`);
      segment.startText = document.getElementById(`${segment.id}-start`);
      segment.endText = document.getElementById(`${segment.id}-end`);
      
      // add the checkboxes for the segment to the segment and add event listeners to them
      const treeCheckbox = li.firstChild;
      const tableCheckbox = row.firstChild.firstChild;
      segment.treeCheckbox = treeCheckbox;
      segment.tableCheckbox = tableCheckbox;
      treeCheckbox.addEventListener("click", function() { toggleSegments(peaksInstance, this.dataset.id, this.checked); });
      tableCheckbox.addEventListener("click", function() { toggleSegments(peaksInstance, this.dataset.id, this.checked); });
      
      // add segment to visible segments and segmentsByID
      visibleSegments["Custom-Segments"][segment.id] = segment;
      segmentsByID[segment.id] = segment;
    
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
    })

    // generate Custom-Segments branch of tree

    // add custom segments to table
    const tbody = segmentsTable.createTBody();
    tbody.id = "Custom-Segments";
    const head = tbody.insertRow(-1);
    head.innerHTML = `<th><input data-action="toggle-segment" type="checkbox" data-id="Custom-Segments" checked>Custom Segments</th>`;

    //!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
    // generate the tree and the table
    for (let segmentsGroup of importedSegments) { renderGroup(peaksInstance, segmentsGroup, "Segments"); }

    // add custom segments to tree
    const customSeg = document.createElement("li");
    customSeg.innerHTML = `<input type="checkbox" data-action="toggle-segment" data-id="Custom-Segments" checked autocomplete="off">Custom-Segments<ul id="Custom-Segments-nested" class="nested active"></ul>`;
    segmentsTree.append(customSeg);

    // initialize hidden/visible segments
    hiddenSegments["Custom-Segments"] = {};
    visibleSegments["Custom-Segments"] = {};
    
    // add inputs for customSeg and add event listeners to them
    const treeInput = customSeg.firstChild
    const tableInput = head.firstChild.firstChild;
    groupsInputs["Custom-Segments"] = [treeInput, tableInput];
    treeInput.addEventListener("click", function() { toggleSegments(peaksInstance, "Custom-Segments", this.checked); });
    tableInput.addEventListener("click", function() { toggleSegments(peaksInstance, "Custom-Segments", this.checked); });

    // Event listeners for Segments checkboxes
    groupsInputs.Segments[0].addEventListener("click", function() { toggleSegments(peaksInstance, "Segments", this.checked); })
    groupsInputs.Segments[1].addEventListener("click", function() { toggleSegments(peaksInstance, "Segments", this.checked); })

    // Event listeners for the "play" and "loop" buttons in the table
    document.querySelectorAll("a[data-action='play-segment']").forEach(function (button) {
      const segment = peaksInstance.segments.getSegment(button.getAttribute("data-id"));
      button.addEventListener("click", function() { peaksInstance.player.playSegment(segment); });
    });
    document.querySelectorAll("a[data-action='loop-segment']").forEach(function (button) {
      const segment = peaksInstance.segments.getSegment(button.getAttribute("data-id"));
      button.addEventListener("click", function() { peaksInstance.player.playSegment(segment, true); });
    });

    // if there are no segments, remove the table and tree so that only peaks is visible
    if (segmentsTable.tBodies.length === 0) {
      document.getElementById("log").classList.add("hide");
      document.getElementById("column").classList.add("hide");
      document.getElementById("column2").classList.remove("column2");
    }
  });
};

const urlParams = new URLSearchParams(window.location.search);
const fileName = urlParams.get("audiofile");
runPeaks(fileName);
