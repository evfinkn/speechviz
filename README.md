<div align="center">
    <center>
        <h1>
            Speechviz
        </h1>
        <h3>
            An annotation tool for analyzing real-world auditory soundscapes
        </h3>
        ![interface](/uploads/7815e2d5b3dd463d14d01923eb339510/interface.png)
    </center>
</div>

<br>

# Speechviz

Speechviz is a tool to
1. Automatically process audio and video data—performing speaker diarization,
voice-activity detection, speech recognition, and face detection
2. Visualize the generated annotations in a user-friendly interface that allows
playing the audio segments and refining the generated annotations to correct any errors

## Contents

- [Docker / Podman image](#docker--podman-image)
- [Manual installation](#manual-installation)
    - [Setup the interface](#setup-the-interface)
    - [Install script dependencies](#install-script-dependencies)
        - [pip](#pip)
        - [conda](#conda)
- [Usage](#usage)
- [Troubleshooting](#troubleshooting)

## Docker / Podman image

    git clone https://research-git.uiowa.edu/uiowa-audiology-reu-2022/speechviz.git
    cd speechviz
    docker build . -t speechviz

Note that the above commands build the image with PyTorch CPU support only.
If you'd like to include support for CUDA, follow the instructions for using the
[NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/overview.html)
and add `--build-arg cuda=true` to the `docker build` command above:

    docker build --build-arg cuda=true . -t speechviz

## Manual installation

    git clone https://research-git.uiowa.edu/uiowa-audiology-reu-2022/speechviz.git
    cd speechviz

### Setup the interface

    npm install
    npm run mkdir
    python3 scripts/db_init.py

### Install script dependencies

If you'll be using `extract-vrs-data.py`, you will need to install [VRS](https://github.com/facebookresearch/vrs).
To use `process_audio.py`, you will need to install [audiowaveform](https://github.com/bbc/audiowaveform)
and [ffmpeg](https://ffmpeg.org/). The remaining dependencies for `process_audio.py` can be installed using `pip` or `conda`.

#### pip

To install with PyTorch CPU support only:

    pip3 install --extra-index-url "https://download.pytorch.org/whl/cpu" -r requirements.txt


To install with PyTorch CUDA support (Linux and Windows only):

    pip3 install --extra-index-url "https://download.pytorch.org/whl/cu116" -r requirements.txt

#### conda

    conda env create -f environment.yml

## Usage

Audio can be processed by moving the audio file to `data/audio`
(or `data/video` for video files) and running

    python3 scripts/process_audio.py data/audio/FILE

Then, to view the results on the interface, run

    npm start

and open http://localhost:3000.  
For a more in-depth usage guide, see [USAGE.md](USAGE.md).

## Troubleshooting

[comment]: # (ERROR: Could not install packages due to an OSError: Proxy URL had no scheme, should start with http:// or https://)
If installing on Bigcore, you are likely to run into an error relating to a proxy URL.
To resolve this, run the following command:

    http_proxy="http://$(echo $http_proxy)" && https_proxy="http://$(echo $https_proxy)"

[comment]: # (subprocess.CalledProcessError: Command '['ffmpeg', ... 'output_file_here']' returned non-zero exit status 127.)
If you receive a `subprocess.CalledProcessError` relating to `ffmpeg`, running the
following should resolve the issue:

    conda update ffmpeg

