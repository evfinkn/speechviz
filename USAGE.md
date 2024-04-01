# Usage

## Contents

- [Usage](#usage)
  - [Contents](#contents)
  - [Processing](#processing)
    - [Audio and video files](#audio-and-video-files)
    - [VRS files](#vrs-files)
    - [Speech recognition](#speech-recognition)
    - [Face detection and clustering](#face-detection-and-clustering)
  - [University of Iowa specific](#university-of-iowa-specific)
    - [Add survey data to stats tree on interface](#add-survey-data-to-stats)
    - [Combine stats](#combine-stats)
  - [Combine folders of data](#combine-folders)
    - [Combine speechviz stats](#combine-speechviz-stats)
    - [Combine audio](#combine-audio)
  - [Large Language Model Scripts](#llm)
    - [Auto Annotate News](#auto-annotate-news)
    - [Compare Manual to Auto News](#compare-manual-news-annotation-to-llm-annotations)
    - [Maximize Auto News Accuracy](#maximize-accuracy-with-different-parameters)
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

Additionally, the path to a folder containing audio or video files can be passed
as the first parameter, and process_audio will be run on each file.

The script outputs a waveform file which contains the data used to visualize the
waveform of the audio on the interface. It also outputs an annotations file
which contains the annotations of when each unique speaker speaks, when voice
activity occurs, and when the non-voice activity occurs. Lastly it outputs a
stats file which contains various metrics about the file including but not
limited to sampling rate, duration, number of speakers, and snr.

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
ffmpeg -i input.mp4 -i input.wav -c:v copy -c:a aac -ac 1 output.mp4
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
    -f data/audio/converted.wav
```

This requires the audio file to be `data/audio`. The transcription file is output
to `data/transcripts`. Be sure to have downloaded the whisper model if not using
our speechviz container that comes with it. To download the model, run

```bash
bash scripts/install_tools.sh
```

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

A bug can occur where the version of your gcc compiler is higher than
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
matches the name of the video that it corresponds to without its extension. For example,
if your video is called `video1.mp4`, the `nameOfFolderWithImages` should also be called
`video1`before you use encode_and_cluster.py. If it does not match, you will have to
manually rename the folder created to be the extensionless video name.

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

## University of Iowa specific

Some scripts are specific to a study conducted by the University of Iowa on hearing aids. Below are some instructions on how to use these scripts and specifications of what they do.

### Add survey data to stats

If you have a file of the survey data from the uiowa study, you can add it to the interface by running

```bash
python3 scripts/add_survey_to_stats.py path/to/survey data/stats/folder
```

where path/to/survey is the path to the file containing the survey data. The file should be a csv file with the following columns:run, type, eVal. and where stats folder is the folder containing the stats files. This will add the survey data to the stats files in the stats folder.

### Combine stats

With the folder containing the text files from PhaseII and PhaseIII of the University of Iowa study, you can combine all the stats files of a folder with one another into one large
csv file allowing for comparison of the various ema and time between all runs accross experiments. See Combine speechviz stats for how to combine the stats file this code generates
for each participant with each other.

To generate the combined stats file for a participant run

```bash
python3 scripts/combine_facebook_stats.py path/to/study/participant output/stat/path.csv
```

## Combine folders

### Combine speechviz stats

With this script you can combine all the stats files of a folder with one another into one large csv file allowing for comparison of the various stats collected (i.e. snr, number of conversation turns, etc.) between all files in that folder.

```bash
python3 scripts/combine_stats.py data/stats/folder output/file/path
```

where data/stats/folder is the path to the folder containing all the seperate stats files. This will create a file called output/file/path (or whatever you substitute it with) that has all the stats in one folder.

### Combine audio

With this script you can combine all the audio files of a folder into one audio file allowing for annotations made from this file to be back propagated to all the files that make it up (in development).

```bash
python3 scripts/concat_audio_in_folder.py data/audio/folder
```

where data/audio/folder is the path to the folder containing all the seperate audio files. This will create a file called data/views/folder.wav.

## LLM

For the LLM scripts, one must download a quantized llm that uses the standard alpaca prompt template (or rewrite the prompts the scripts use to match your llms prompt). The exact model used when coding this (open-llama-7B-open-instruct.ggmlv3.q6_K.bin) can be downloaded here https://huggingface.co/TheBloke/open-llama-7b-open-instruct-GGML and should be placed in scripts/models.

### Auto annotate news

To automatically generate annotations on files for what is suspected to be news, one must first perform speech recognition as detailed above. The llm takes in the transcript and decides if it is more likely to be news or not news (other). If the llm thinks it is news, it will annotate the part of the file where that transcript starts and ends as news. To run this script, run

```bash
python3 scripts/news_analysis.py data/transcription/folder
```

where data/transcription/folder is the path to the folder containing the transcription file. This will automatically update the annotation file for that file to reflect what is thought to be news on the interface

### Compare manual news annotation to llm annotations

If you wish to compare the accuracy of the llm's news annotations with manual annotations you have done via the interface (where you add a label that contains News in the name, i.e. ManualNews, and give the segments added to it the same name,i.e. ManualNews1 etc.) you can run

```bash
python3 scripts/compare_llm_news_to_truth.py data/annotations/file
```

where data/annotations file is the path to the annotations file/folder you wish to compare the accuracy of. This will output the accuracy of the llm's news annotations compared to the manual annotations at the file scripts/output/llmMatchPercentages.csv.

### Maximize accuracy with different parameters

If you have manual news annotations to compare and want to find what parrameters on news_analysis.py result in the highest accuracy you can use this script as an example (needs to be updated to whatever files you annotated manually) and look at the results. It does a combination of news_analyis.py with different parameters, followed by compare_llm_news_to_truth.py and analyze_llm_match_percentages.py to output into one csv at scripts/output/llmMatchPercentages.csv. To run this script, run

```bash
python3 scripts/maximize_news_numbers_and_threshold_accuracy.py
```

This will output the average accuracy of all the llm's news annotations compared to all the manual annotations at the file scripts/output/llmMatchPercentages.csv and you can see which is highest and use that.

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
