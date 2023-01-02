from __future__ import annotations

import argparse
import json
import os
import pathlib
import subprocess
import time
from typing import Optional

import librosa
import numpy as np
import util

AUDIO_FILES = {".mp3", ".wav", ".flac", ".ogg", ".opus"}
VIDEO_FILES = {".mp4", ".mov"}


def format_segment(start, end, color, label):
    return {"startTime": start, "endTime": end, "color": color, "labelText": label}


def get_complement_times(times, duration):
    comp_times = []
    if len(times) == 0:
        comp_times.append((0, duration))
    else:
        start_index = 1
        if times[0][0] == 0:
            start_index = 2
            if len(times) == 1:
                if times[0][1] != duration:
                    comp_times.append((times[0][1], duration))
            else:
                comp_times.append((times[0][1], times[1][0]))
        else:
            comp_times.append((0, times[0][0]))
        for i in range(start_index, len(times)):
            comp_times.append((times[i - 1][1], times[i][0]))
        if times[-1][1] != duration:
            comp_times.append((times[-1][1], duration))
    return comp_times


def get_complement_segments(segments, duration, color, label, times=None):
    times = (
        [(seg["startTime"], seg["endTime"]) for seg in segments]
        if times is None
        else times
    )
    comp_times = get_complement_times(times, duration)
    return [format_segment(start, end, color, label) for start, end in comp_times]


def rms(powers):  # give it a list, and it finds the root mean squared
    squares_sum = np.sum(np.square(powers))
    if len(powers) != 0:
        return np.sqrt(squares_sum / (len(powers)))
    return 0


def snr(signal, noise):
    signal_rms = rms(signal) if not isinstance(signal, float) else signal
    noise_rms = rms(noise) if not isinstance(noise, float) else noise
    return (signal_rms - noise_rms) / noise_rms


def samples_from_times(times, samples, sr):
    indices = (np.array(times) * sr).astype(int)
    samps = np.empty(np.sum(np.clip(indices[:, 1] - indices[:, 0], 0, None)))
    offset = 0
    for start, stop in indices:
        to = offset + stop - start if stop - start >= 0 else offset
        samps[offset:to] = samples[start:stop]
        offset = to
    return samps


def snr_from_times(signal_times, samples, sr, noise_rms=None):
    signal_samps = samples_from_times(signal_times, samples, sr)
    signal_powers = np.square(signal_samps)
    if noise_rms is None:
        noise_samps = samples_from_times(
            get_complement_times(signal_times, len(samples) / sr), samples, sr
        )
        noise_powers = np.square(noise_samps)
        noise_rms = rms(noise_powers)
    return snr(signal_powers, noise_rms)


def get_diarization(path: pathlib.Path, auth_token, samples, sr, verbose=0):
    # use global diar_pipe so that it doesn't need
    # to be re-initialized (which is time-consuming)
    global diar_pipe
    # lazy import Pipeline because it takes a while to import. If it were
    # imported at the top, then someone doing `python process_audio.py -h`
    # would have to wait a while just to see the help message.
    # We don't need to do `if "Pipeline" in globals()` because python caches imports,
    # so it isn't actually getting reimported every time get_diarization is called
    from pyannote.audio import Pipeline

    # quiet doesn't matter because we only use verbose_level > 0 in this function
    vprint = util.verbose_printer(False, verbose)

    if "diar_pipe" not in globals():  # diar_pipe hasn't been initialized yet
        vprint("Initializing diarization pipeline")
        diar_pipe = Pipeline.from_pretrained(
            "pyannote/speaker-diarization@2.1", use_auth_token=auth_token
        )

    vprint("Running the diarization pipeline")
    start_time = time.perf_counter()
    diar = diar_pipe(path)
    vprint(
        "Diarization pipeline completed in"
        f" {time.perf_counter() - start_time:.4f} seconds"
    )
    vprint("Looping through the annotations to create the speaker segments")
    loop_start_time = time.perf_counter()

    # format the speakers segments for peaks
    colors = util.random_color_generator(2)
    spkrs_colors = (
        {}
    )  # dictionary to store speaker's colors. key = speaker, value = color
    spkrs_segs = {}
    spkrs_times = {}
    diar_times = []
    is_speech = np.full(len(samples), False)
    for turn, _, spkr in diar.itertracks(yield_label=True):
        start = turn.start
        end = turn.end
        spkr = f"Speaker {int(spkr.split('_')[1]) + 1}"

        if spkr not in spkrs_colors:
            spkrs_colors[spkr] = next(
                colors
            )  # each speaker has a color used for all of their segments
            spkrs_segs[spkr] = []
            spkrs_times[spkr] = []

        spkrs_segs[spkr].append(format_segment(start, end, spkrs_colors[spkr], spkr))
        spkrs_times[spkr].append((start, end))
        diar_times.append((start, end))
    spkrs = sorted(spkrs_segs)
    for srange in librosa.time_to_samples(diar_times, sr=sr):
        is_speech[srange[0] : srange[1]] = True
    diar_indices = np.where(is_speech)[0]
    if len(diar_indices) != 0:
        diar_times = [diar_indices[0]]
    for i in range(1, len(diar_indices) - 1):
        if diar_indices[i] + 1 != diar_indices[i + 1]:
            diar_times.append(diar_indices[i])
        if diar_indices[i] != diar_indices[i - 1] + 1:
            diar_times.append(diar_indices[i])
    if len(diar_indices) != 0:
        diar_times.append(diar_indices[-1])
        diar_times = librosa.samples_to_time(diar_times, sr=sr)
        diar_times = [
            (diar_times[i], diar_times[i + 1]) for i in range(0, len(diar_times), 2)
        ]

    vprint(
        "Speaker segments created in"
        f" {(time.perf_counter() - loop_start_time) * 1000:.4f} milliseconds"
    )
    vprint("Calculating SNRs")
    snr_start_time = time.perf_counter()

    noise_times = get_complement_times(diar_times, len(samples) / sr)
    noise_samps = samples_from_times(noise_times, samples, sr)
    noise_powers = np.square(noise_samps)
    noise_rms = rms(noise_powers)
    spkrs_snrs = {
        spkr: snr_from_times(spkrs_times[spkr], samples, sr, noise_rms)
        for spkr in spkrs
    }

    vprint(
        "SNRs calculated in"
        f" {(time.perf_counter() - snr_start_time) * 1000:.4f} milliseconds"
    )
    vprint(
        f"get_diarization completed in {time.perf_counter() - start_time:.4f} seconds"
    )

    # TODO: Change this to return a dict and then change viz.js to take a dict
    # because this is confusing. It could be something like:
    # {"type": "GroupOfGroups", name="Speakers", children=[{"type": "Group", ...}, ...]}
    # arrange spkrs_segs so that it's an array of tuples containing a speaker,
    # that speaker's segments, and that speaker's snr i.e.
    # spkrs_segs = [ ("Speaker 1", [...], spkr_1_snr), ... ]
    return ("Speakers", [(spkr, spkrs_segs[spkr], spkrs_snrs[spkr]) for spkr in spkrs])


def get_vad(path: pathlib.Path, auth_token, duration, verbose=0):
    # use global vad_pipe so that it doesn't need
    # to be re-initialized (which is time-consuming)
    global vad_pipe
    from pyannote.audio import Pipeline

    # quiet doesn't matter because we only use verbose_level > 0 in this function
    vprint = util.verbose_printer(False, verbose)

    if "vad_pipe" not in globals():  # vad_pipe hasn't been initialized yet
        vprint("Initializing VAD pipeline")
        vad_pipe = Pipeline.from_pretrained(
            "pyannote/voice-activity-detection", use_auth_token=auth_token
        )

    vprint("Running the VAD pipeline")
    start_time = time.perf_counter()
    vad = vad_pipe(path)
    vprint(f"VAD pipeline completed in {time.perf_counter() - start_time:.4f} seconds")
    vprint("Looping through the annotations to create the VAD segments")
    loop_start_time = time.perf_counter()

    # format the vad segments for peaks
    vad_segs = []
    vad_times = []
    for turn, _ in vad.itertracks():
        start = turn.start
        end = turn.end
        vad_segs.append(format_segment(start, end, "#5786c9", "VAD"))
        vad_times.append((start, end))

    vprint(
        "VAD segments created in"
        f" {(time.perf_counter() - loop_start_time) * 1000:.4f} milliseconds"
    )
    vprint("Creating the non-VAD segments")
    non_vad_start_time = time.perf_counter()

    non_vad_segs = get_complement_segments(
        vad_segs, duration, "#b59896", "Non-VAD", times=vad_times
    )

    vprint(
        "Non-VAD segments created in"
        f" {(time.perf_counter() - non_vad_start_time) * 1000:.4f} milliseconds"
    )
    vprint(f"get_vad completed in {time.perf_counter() - start_time:.4f} seconds")

    # TODO: See TODO at end of get_diarization
    return (("VAD", vad_segs), ("Non-VAD", non_vad_segs))


def route_dir(dir, verbose=0, scan_dir=True, **kwargs):
    if verbose:
        print(f"Running process_audio on each file in {dir}")
    for path in dir.iterdir():
        route_file(path, verbose=verbose, scan_dir=scan_dir, **kwargs)


def route_file(*paths: pathlib.Path, verbose=0, scan_dir=True, **kwargs):
    if len(paths) == 0:
        paths = [
            pathlib.Path.cwd()
        ]  # if no file or directory given, use directory script was called from
    elif (
        len(paths) > 1
    ):  # if multiple files (or directories) given, run function on each one
        for path in paths:
            route_file(path, verbose=verbose, scan_dir=scan_dir, **kwargs)
        # stop function because all of the processing is
        # done in the function calls in the for loop
        return

    path = paths[0]  # paths[0] is--at this point--the only argument in paths

    # if file.path is an audio or video file, process it
    if path.suffix.casefold() in AUDIO_FILES or path.suffix.casefold() in VIDEO_FILES:
        process_audio(path, verbose=verbose, **kwargs)

    # run process audio on every file in file.path if it is a dir and scan_dir is True
    elif path.is_dir() and scan_dir:
        if (
            path.name == "data"
        ):  # the data dir was passed so run on data/audio and data/video
            route_dir(path / "audio", verbose=verbose, scan_dir=scan_dir, **kwargs)
            route_dir(path / "video", verbose=verbose, scan_dir=scan_dir, **kwargs)
        else:
            route_dir(path, verbose=verbose, scan_dir=False, **kwargs)


def ffmpeg(
    input: str,
    output: str,
    verbose: int = 0,
    input_options: Optional[list[str]] = None,
    output_options: Optional[list[str]] = None,
):
    """Wrapper for the `ffmpeg` command.
    Supports a single input and output.

    Parameters
    ----------
    input : str
        The file to input into `ffmpeg`.
    output : str
        The file for `ffmpeg` to output to. If a file at the path already exists,
        it will be overwritten.
    verbose : int, default=0
        If greater than or equal to 2, `ffmpeg`'s output to stdout will be printed.
    input_options : list of str, optional
        `ffmpeg` options to apply to the input file.
    output_options : list of str, optional
        `ffmpeg` options to apply to the output file.

    Returns
    -------
    subprocess.CompletedProcess
        The completed process containing info about the `ffmpeg` command that was run.
    """
    args = ["ffmpeg", "-y"]
    if input_options:
        args.extend(input_options)
    args.extend(["-i", input])
    if output_options:
        args.extend(output_options)
    args.append(output)
    return subprocess.run(args, capture_output=verbose < 2, check=True)


def audiowaveform(
    input: str,
    output: str,
    verbose: int = 0,
    split_channels: bool = False,
    options: Optional[list[str]] = None,
):
    """Wrapper for the `audiowaveform` command.

    Parameters
    ----------
    input : str
        The file to input into `audiowaveform`.
    output : str
        The file for `audiowaveform` to output to. If a file at the path already
        exists, it will be overwritten.
    verbose : int, default=0
        If greater than or equal to 2, `audiowaveforms`'s output to stdout will
        be printed.
    split_channels : boolean, default=False
        Generate a waveform for each channel instead of merging into 1 waveform.
    options : list of str, optional
        Additional options to pass in.

    Returns
    -------
    subprocess.CompletedProcess
        The completed process containing info about the `audiowaveform` command
        that was run.
    """
    args = ["audiowaveform", f"-i{input}", f"-o{output}", "-b", "8"]
    if split_channels:
        args.append("--split-channels")
    if options:
        args.extend(options)
    return subprocess.run(args, capture_output=verbose < 2, check=True)


def process_audio(
    path: pathlib.Path,
    auth_token,
    reprocess=False,
    quiet=False,
    verbose=0,
    split_channels=False,
):
    vprint = util.verbose_printer(quiet, verbose)
    vprint(f"Processing {path}", 0)
    start_time = time.perf_counter()

    if len(path.parents) < 2 or path.parents[1].name != "data":
        raise Exception("Input file must be in either data/audio or data/video")
    data_dir = path.parents[1]
    # ensure that waveforms and segments directories exist
    util.mkdir(data_dir / "waveforms")
    util.mkdir(data_dir / "segments")

    # filepaths for the waveform, and segments files
    waveform_path = data_dir / "waveforms" / f"{path.stem}-waveform.json"
    segs_path = data_dir / "segments" / f"{path.stem}-segments.json"

    # if the audio isn't in wav format, it'll need to be
    # converted to wav (because the pipelines requires wav)
    made_wav = False
    if path.suffix.casefold() != ".wav":
        old_path = path
        new_path = path.with_suffix(".wav")

    # only recreate the waveform if it doesn't already exist
    if waveform_path.exists() and not reprocess:
        vprint(
            f"{waveform_path} already exists. To recreate it, use the -r argument", 0
        )
    else:  # create the waveform
        # audiowaveform requires an audio file, so
        # convert to wav if the file is a video file
        if path.suffix.casefold() in VIDEO_FILES:
            vprint(f"Creating {new_path}")
            ffmpeg(old_path, new_path, verbose)
            path = new_path
            made_wav = True
        vprint(f"Creating {waveform_path}")
        audiowaveform(path, waveform_path, verbose, split_channels)

    if segs_path.exists() and not reprocess:
        vprint(
            f"{path} has already been processed. To reprocess it, use the '-r'"
            " argument",
            0,
        )
    else:
        # if we didn't need to make the waveform, the file might still not be a wav file
        # we could move this conversion to the first if statement that defines old_path
        # and new_path, but that might waste time if the file doesn't need processed
        if path.suffix.casefold() != ".wav":
            vprint(f"Creating {new_path}")
            ffmpeg(old_path, new_path, verbose)
            path = new_path
            made_wav = True

        samples, sr = librosa.load(path, sr=None)
        duration = librosa.get_duration(y=samples, sr=sr)

        segs = []
        segs.append(get_diarization(path, auth_token, samples, sr, verbose))
        segs.extend(get_vad(path, auth_token, duration, verbose))

        # save the segments
        vprint(f"Creating {segs_path}")
        with segs_path.open("w") as segs_file:
            json.dump(segs, segs_file)

    # if we converted to wav, remove that wav file
    # (since it was only needed for the pipelines)
    if made_wav:
        vprint(f"Deleting {path}")
        util.rm(path)

    # if wav file was made, switch file.path back to original file
    path = old_path if "old_path" in locals() else path
    vprint(f"Processed {path} in {time.perf_counter() - start_time:.4f} seconds", 0)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Process audio files.")
    parser.add_argument(
        "-r",
        "--reprocess",
        action="store_true",
        help="Reprocess audio files detected to have already been processed",
    )
    parser.add_argument(
        "-q", "--quiet", action="store_true", help="Don't print anything"
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="count",
        default=0,
        help="Print various debugging information",
    )
    parser.add_argument(
        "--split-channels",
        action="store_true",
        help="Generate a waveform for each channel instead of merging into 1 waveform",
    )
    parser.add_argument(
        "--auth-token",
        help=(
            "PyAnnote authentication token. Retrieved from the environment variable"
            " PYANNOTE_AUTH_TOKEN if not given"
        ),
    )
    parser.add_argument(
        "path",
        nargs="*",
        type=pathlib.Path,
        help=(
            "The path to the file to process. If an audio file, processes the audio"
            " file. If a directory, processes every audio file in the directory."
        ),
    )
    args = parser.parse_args()
    args.auth_token = os.environ.get("PYANNOTE_AUTH_TOKEN", args.auth_token)
    if args.auth_token is None:
        raise Exception(
            "To run the diarization and VAD pipelines, you need a PyAnnotate"
            " authentication token. Pass it in with the --auth-token option or set the"
            " PYANNOTE_AUTH_TOKEN environment variable."
        )
    start_time = time.perf_counter()
    route_file(*util.namespace_pop(args, "path"), **vars(args))
    if not args.quiet or args.verbose:
        print(
            f"Processing took a total of {time.perf_counter() - start_time:.4f} seconds"
        )
