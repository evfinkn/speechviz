# Speech Visualization

This will take an audio file and visualize various characteristics. Currently, you can see when speakers speak in the file and when there is voice activity (and conversely no voice activity). Additionally, you can play any given segment of speech by a given speaker by pressing the play button. If you press the loop button right next to it, the segment will play on repeat.

## Installation

```
git clone https://research-git.uiowa.edu/uiowa-audiology-reu-2022/speechviz.git
cd speechviz
npm install
```

## Usage

To start the server, run
```
npm start
```
and then open http://localhost:8080 in your browser.

By default, the server listens on port 8080. You can specify a different port by running
```
npm start -- --port=PORT
```
where PORT is the port you want the server to listen on.

To actually display any audio, you need to:
1. Add the audio file to the `public/audio` directory.
2. Add the json file for the waveform (generated by the pipeline) to the `public/waveforms` directory.
3. Add the json file for the segments (generated by the pipeline) to the `public/segments` directory.

For example, for the file `example.mp3`, there should be `public/audio/example.mp3`, `public/waveforms/example-waveform.json`, and `public/segments/example-segments.json`.