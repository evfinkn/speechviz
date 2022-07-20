# TODO

### Node
 - [ ] Add HTTPS
 - [x] Fix error raised when submitting login: `Error [ERR_HTTP_HEADERS_SENT]: Cannot set headers after they are sent to the client`
 - [x] Get own server working
 - [x] Upload to GitLab
 - [x] Add instructions to README
 - [x] Add users (make it so you need auth to view files, only give us accounts)
 - [x] Add support for multiple files

### Interface
 - [ ] When you save a label with no segments, it doesn't get saved/loaded
 - [ ] Separate into multiple files
 - [ ] Fix custom segment saving / loading? (will save 'Custom Segment 1' and then after loading, adding a custom segment will be 'Custom Segment 1')
 - [ ] When playing group, show segment currently playing
 - [ ] Combinable segments? (take the startTime of first one, endTime of second one, and make into one combined segment)
 - [ ] If possible, button to hide the segment drag things
 - [ ] When renaming segment in a label, don't change labelText when renaming, just change treeText ?
 - [ ] Fix the label not appearing next to speaker after adding it to label
 - [ ] If possible, fix drag things overlapping and dragging together (currently have to disable one segment to be able to drag separately)
 - [ ] Undo and redo button (actions: add segment, remove segment, move segment, rename segment, drag start, drag end, remove group, add to label)
 - [ ] Fix toggling label not toggling its segments' play and loop buttons
 - [ ] Fix custom segment not being checked when added
 - [ ] Document functions
 - [ ] Fix the segment's own label appearing in the segment's popup
 
 - [x] Add reset button (with confirmation popup, I think javascript has a built-in prompt for said popup) that removes all saved segments
 - [x] Show segment start time and end time when hovering over its tree text
 - [x] Make segment popup radio buttons appear on separate lines
 - [x] Move custom segments to label instead of copying
 - [x] Fix drag for the end of a segment is off screen when adding segment at the end of file
 - [x] Change default custom segment duration (lower from 10 to maybe like 5?)
 - [x] Add toFixed() to changeDuration
 - [x] When sorting labels, should it resort when a segment in it is dragged?
 - [x] Fix loading not setting duration
 - [x] Changeable playback speed
 - [x] Fix labels so it sorts chronologically again
 - [x] Determine way to show id of segment when hovering over it
 - [x] Renamable labels
 - [x] Notes input text box in bottom right to write things down
 - [x] Add space between play, loop, and remove buttons
 - [x] Remake labels removable
 - [x] Make updateDuration function
 - [x] Movable custom segments
 - [x] Fix renaming
 - [x] Make renderGroup take group, segments, and snr instead of an array of the three
 - [x] Sort segments within labeled speakers
 - [x] Custom labeling
 - [x] Rename custom segments
 - [x] Make custom segments save-able
 - [x] Make the "Custom-Segments" tree branch hidden when there are no custom segments
 - [x] Play/loop button on segment groups
 - [x] Calculate true speaker
 - [x] Show SNR and duration when cursor hovers over group
 - [x] Duration on segment groups
 - [x] Leave "Segments" checked by default, but make all nested groups unchecked (and hidden on peaks) by default
 - [x] Add SNR to speakers
 - [x] Intro page with file selection, not on main page
 - [x] Re-add custom segments
 - [x] Add play buttons for segments in tree  <sub>Add loop buttons in tree as well??</sub>
 - [x] Add duration for segments

### Pipeline
 - [ ] Add counter to print the number of files proceessed
 - [x] Test the pipeline installation instructions
 - [x] Try different speaker separation
 - [x] Try different speaker separation
 - [x] Add to GitLab
 - [x] Make "help" more informative
 - [x] Export segments as json for GET request
 - [x] Save segments as name-segments.json and waveform as name-waveform.json
