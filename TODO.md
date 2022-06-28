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
 - [ ] Show SNR and duration when cursor hovers over group
 - [ ] Make the "Custom-Segments" tree branch and log row hidden when there are no custom segments
 - [ ] Make custom segments save-able
 - [ ] Custom labeling
 - [ ] Duration on segment groups
 - [ ] Play/loop button on segment groups
 - [ ] Merge-able segments
 - [x] Leave "Segments" checked by default, but make all nested groups unchecked (and hidden on peaks) by default
 - [x] Add SNR to speakers
 - [x] Intro page with file selection, not on main page
 - [x] Re-add custom segments
 - [x] Add play buttons for segments in tree  <sub>Add loop buttons in tree as well??</sub>
 - [x] Add duration for segments

### Pipeline
 - [ ] Use numpy arrays instead of lists (numpy arrays are faster)
 - [ ] Try different speaker separation
 - [ ] Calculate true speaker
 - [x] Try different speaker separation
 - [x] Add to GitLab
 - [x] Make "help" more informative
 - [x] Export segments as json for GET request
 - [x] Save segments as name-segments.json and waveform as name-waveform.json
