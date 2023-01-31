# Usage

## Contents

- [Usage](#usage)
  - [Contents](#contents)
  - [Processing](#processing)
    - [Audio and video files](#audio-and-video-files)
    - [VRS files](#vrs-files)
    - [Speech recognition](#speech-recognition)
    - [Face detection and clustering](#face-detection-and-clustering)
  - [Interface](#interface)

## Processing

All the Python scripts have a list of useful options that can be viewed by passing
the `-h` option.

### Audio and video files

To process an audio (.mp3, .wav, .flac, .ogg, or .opus) file or a video
(.mp4 or .mov) file, run

```bash
# to process an audio file
python3 scripts/process_audio.py data/audio/FILE
# processing a video file is the same command, just a different directory
python3 scripts/process_audio.py data/video/FILE
```

While the file doesn't have to be in `data/audio` or `data/video`, if it is,
it outputs the waveform and segments files into the appropriate directories used
by the interface. Otherwise, the files are output to the same directory that the
input file is in.

The waveform file contains the data used to visualize the waveform of the audio on
the interface. The segments file contains the annotations of the unique speakers,
the voice activity, and the non-voice activity.

### VRS files

To process a .vrs file created by
[Project Aria glasses](https://about.meta.com/realitylabs/projectaria/),
move the file to `data/vrs` and run

```bash
python3 scripts/extract_vrs_data.py data/vrs/FILE
```

Unlike `process_audio.py`, the file must be in `data/vrs` for `extract_vrs_data.py`
to work. The files are output to `data/graphical/FILE_NAME` where `FILE_NAME` is
`FILE` without the extension.

The script extracts the videos from the eye-tracking, SLAM-left, SLAM-right, and
RGB cameras; the audio from the microphones; the magnetometer data; the IMU-left
and IMU-right data; the GPS data (if any); and the barometer data (if any).

Pose data (data specifying the position and rotation) of the glasses can be created
by running

```bash
python3 scripts/create_poses.py data/graphical/FILE_NAME
```

To visualize the pose data in the interface, you'll need to process one of the
videos from the cameras. After picking one of the videos, you can optionally run
these commands:

```bash
# Rotate the video to the correct orientation
ffmpeg -i input.mp4 -vf transpose=1 output.mp4
# Combine the audio and video
ffmpeg -i input.mp4 -i input.wav -c:v copy -c:a aac output.mp4
```

Finally, rename the video to `FILE_NAME.mp4`, move it to `data/video`, and run

```bash
python3 scripts/process_audio.py data/video/FILE_NAME.mp4
```

Once finished, open it in the interface (which will automatically detect the pose file).

### Speech recognition

The following command will run speech recognition on a file:

```bash
# whisper.cpp requires 16-bit WAV files
ffmpeg -i input.mp3 -ar 16000 -ac 1 -c:a pcm_s16le converted.wav
# transcribe the audio file
scripts/transcribe -ml 1 \
    -m scripts/models/whisper-base.en.bin \
    -f converted.wav
```

This requires the audio file to be `data/audio`. The transcription file is output
to `data/transcripts`.

### Face detection and clustering

First we need to build dlib. This assumes you have a gpu; if you just want to use the
cpu, use `DDLIB_USE_CUDA=0` instead.

```bash
git clone https://github.com/davisking/dlib.git
cd dlib
mkdir build
cd build
cmake .. -DDLIB_USE_CUDA=1
cd ..
python3 setup.py install
```

A rather annoying bug can occur where the version of your gcc compiler is higher than
versions compatible with cuda. If you get a message saying `DLIB WILL NOT USE CUDA`,
try changing `cmake` and `python3` lines to the following respectively:

```bash
cmake .. -DDLIB_USE_CUDA=1 -DUSE_AVX_INSTRUCTIONS=1 \
    -DCUDA_HOST_COMPILER=/path/to/gcc/compiler/version10/or/lower
python3 setup.py install \
    --set CUDA_HOST_COMPILER=/path/to/gcc/compiler/version10/or/lower
```

Now gpu use should be supported for dlib.

If you want to automatically encode and cluster, and have it put the correct
information in the appropriate directories for visualization, run

```bash
python3 scripts/encode_and_cluster.py \
    -i data/imagesForEncoding/nameOfFolderWithImages
```

Note: It is very important that the name of the folder with images from the video
matches the name of the video that it corresponds to. For example, if your video is
called `video1.mp4`, the `nameOfFolderWithImages` should also be called `video1.mp4`
before you use encode_and_cluster.py.

If you want to manually just encode or just re-cluster, you can use the appropriate
script between scripts/encode_faces.py and scripts/cluster_faces.py.

The script encode_faces.py encodes information about detecting faces in 128 dimensions.
This can later be clustered based on the encodings.

Encoding faces is able to be done without human intervention and takes a while, so
you don't want to repeat doing it once it has been already done once. Clustering
requires some human input, doesn't take as long, and its accuracy can change
dramatically based on the parameter --epsilon making it appealing to rerun just
clustering to improve results.

To run encoding,

```bash
python3 scripts/encode_faces.py \
    --dataset videoNamedFolderWithImages \
    --encodings data/imagesForEncoding/videoName/videoName.pickle \
    -d cnn --outputs optionalFolderForFacesDetected
```

Second, we can cluster/re-cluster the faces to see how many unique people have been
identified.

```bash
python3 scripts/cluster_faces.py \
    --encodings data/imagesForEncoding/videoName/videoName.pickle \
    --outputs data/faceClusters/videoName --epsilon epsilonFloatNumber
```

where `epsilonFloatNumber` is a parameter for the clustering method DBSCAN. DBSCAN
clusters groups based on density of points
([comparison of DBSCAN to other clustering](https://scikit-learn.org/stable/auto_examples/cluster/plot_cluster_comparison.html)).
Epsilon controls how far points can be from one another and still considered a
neighborhood. As a result, having too small of a value and no clusters will be found
(they will all be considered noise). Having too large of a value and all will be
considered the same cluster. Finding the correct epsilon can take some trial and
error, and for the few tests I've done with this data, it has fallen around .35 and
.4. As a rule of thumb, when you find too many faces, increase epsilon; if you find
too few, lower epsilon.

This will make a few folders in a folder given to outputs. `Face-1` is faces that it
found to be noise, and `Face0`, `Face1`, etc. are folders containing the faces it
thinks are the same person.

## Interface

The interface can only be accessed if the server is running. To start it, run

```bash
npm start
```

and open http://localhost:3000 (or the IP address output in the console). By default,
the server listens on port 3000. To specify a different port, run with `-- --port=PORT`
(where `PORT` is the port you want the server to listen on):

```bash
npm start -- --port=PORT
```

Once you open up the interface, you will be greeted with a login page. The default
login is username `user` and password `pass`. Other users can be created with

```bash
python3 scripts/db_user.py USERNAME PASSWORD
```

where `USERNAME` is the username of the new user and `PASSWORD` is the password to
give them. If `USERNAME` is an already existing user, then the command will instead
update their password. A user's password can also be changed by logging in as that
user and navigating to `/change-password` (i.e. http://localhost:3000/change-password).
If you'd like to remove a user, run the following:

```bash
python3 scripts/db_user.py --delete USERNAME
```

After logging in, you will be redirected to an index page containing a list of audio
and video files. These are the files found in `data/audio` and `data/video`
respectively. Your files need to be moved to these directories to be found by the
interface. Each file `FILE` in these directories also needs a respective waveform file
in `data/waveforms` named `FILE_NAME-waveform.json` where `FILE_NAME` is `FILE` without
the extension. If you ran `process_audio.py` on `FILE` while it was in its respective
directory, the waveform file will already be in its correct folder, and a segments file
containing the annotations will be in `data/segments`. Segments files aren't required
to view a file in the interface.

Clicking on a file in the list open's up the main interface which contains the waveform
and annotations (if any) for the file. Some notable features:

- On the left of the screen is a tree containing the analysis for the file. Checking
  an item will enable that group / segment in the waveform and show its children in
  the tree (if any).
- Some tree items have a popup that is displayed when the tree item's text is clicked.
  This popup contains options for its respective tree item which differ depending on
  the kind of group / segment it is. For example, a segment under a speaker can be
  moved and copied; a custom segment can be moved and renamed; and a labeled group can
  be moved, renamed, and recolored.
- A labeled group can be created by entering a name into the textbox and clicking the
  `Add Label` button next to it. It will then appear in the `Labeled` group. Other
  groups can then be moved to that label.
- Custom segments can be added by clicking the `Add Segment` button, which will add a
  2.5-second-long segment at the current time under the `Custom` group.
- Editable segments (such as custom ones) have handles at their start and end that can
  be dragged to change when it starts and end.
- Notes can help to remember who is who (e.g. "Speaker 1 is the man with the raspy
  voice") and can be taken in the big text box. The notes are saved.
- A change can be undone by clicking the undo button or using the keyboard shortcut
  `Ctrl+Z` (`Cmd+Z` on Mac). Redoing changes is currently unimplemented.
- Other options can be found by clicking the settings button (its icon is a gear).
- To save, click the save button (its icon is a floppy disk) or press `Ctrl+S`
  (`Cmd+S` on Mac).

This is by no means an exhaustive list.
