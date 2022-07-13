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
 - [ ] Determine way to show id of segment when hovering over it
 - [ ] Changeable playback speed
 - [ ] Separate into multiple files
 - [ ] Fix custom segment saving / loading? (will save 'Custom Segment 1' and then after loading, adding a custom segment will be 'Custom Segment 1')
 - [ ] Notes input text box in bottom right to write things down
 - [ ] Show segment start time and end time when hovering over its tree text
 - [ ] Change default custom segment duration (lower from 10 to maybe like 5?)
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
