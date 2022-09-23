# TODO

### Other
 - [ ] Make script (probably Python) to extract saved annotations from database to json
 - [ ] Make script (probably Python) to import saved annotations from json into database

### Node
 - [ ] Add HTTPS
 - [x] Fix error raised when submitting login: `Error [ERR_HTTP_HEADERS_SENT]: Cannot set headers after they are sent to the client`
 - [x] Get own server working
 - [x] Upload to GitLab
 - [x] Add instructions to README
 - [x] Add users (make it so you need auth to view files, only give us accounts)
 - [x] Add support for multiple files

### Interface
 - [ ] When undo implemented, and dirty functionality re-added, merge into main
 - [ ] Re-add saving moved segments (segments moved between speakers)
 - [ ] Probably need to update database to save properties from non-pipeline groups instead of only group name
 - [ ] Undo functionality
   - [ ] Dirty functionality (warning user when they have unsaved changes and they try to close page) - should be maybe somewhat easy with undo implemented, if has undos and hasn't saved, then there are changes
 - [ ] Change XMLHttpRequests in init.js to use fetch function for consistency
 - [ ] Maybe make Moveable and Copyable interface? Segment and Group's expandMoveTo() and expandCopyTo() methods are the same (I think)
 - [ ] Make use of change password pug and route somewhere
   - [ ] Very rough idea but once we add more settings for the UI, could make clicking on username take you to a user page where you can edit global settings (which are saved in a database) and also in that page theres a link to the change password page?
 - [ ] Add more things to settings to configure sizes of different things
   - [ ] Make user settings save to database (user's global settings, per-file settings), with global settings used for files without saved settings
 - [ ] Right now, Segment.copy() hard sets the copied Segment's properties. Somehow make specifiable?
 - [ ] Make save annotations save renamable property in database
 - [ ] When playing group, show segment currently playing
 - [ ] Combinable segments? (take the startTime of first one, endTime of second one, and make into one combined segment)
 - [ ] Undo and redo button (actions: add segment, remove segment, move segment, rename segment, drag start, drag end, remove group, add to label)
 - [ ] If possible, button to hide the segment drag things - actually this could be done by making all segments un-editable (but remembering which ones were editable) and then re-making segments editable (using segment.update({ editable: }) to change editable)
 
 - [ ] If possible, fix drag things overlapping and dragging together (currently have to disable one segment to be able to drag separately)


 - [x] Change settings button to use a popup (not a dropdown)
 - [x] Make left column (tree column) fill webpage height
 - [x] Make size of top header (thing with "back to file selection" and username) smaller
 - [x] Rewrite code to relabel custom segments when saving them if necessary (look at comment in that section)
 - [x] Fix custom segment re-numbering when saving
 - [x] Reorder class methods and properties by functionality (I think they're already mostly ordered logically but make sure)
 - [x] Rearrange import statements at top of files to be ordered somewhat by importance (i.e. import globals first, then classes, then utils, then icons)
 - [x] Separate into multiple files
 - [x] Document functions
 - [x] Admin account flip between all annotations that you can view
 - [x] Fix custom segment saving / loading? (will save 'Custom Segment 1' and then after loading, adding a custom segment will be 'Custom Segment 1')
 - [x] Fix the segment's own label appearing in the segment's popup
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
