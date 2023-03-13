from __future__ import annotations

import argparse
import collections
import json
import os
import pathlib
import subprocess
import time

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


def flatten_times(times, num_samples, sr):
    is_in_times = np.full(num_samples, False)
    times = times[:]  # copy times
    for srange in librosa.time_to_samples(times, sr=sr):
        is_in_times[srange[0] : srange[1]] = True
    indices = np.where(is_in_times)[0]
    if len(indices) != 0:
        times = [indices[0]]
    for i in range(1, len(indices) - 1):
        if indices[i] + 1 != indices[i + 1]:
            times.append(indices[i])
        if indices[i] != indices[i - 1] + 1:
            times.append(indices[i])
    if len(indices) != 0:
        times.append(indices[-1])
        times = librosa.samples_to_time(times, sr=sr)
        times = [(times[i], times[i + 1]) for i in range(0, len(times), 2)]
    return times


def get_times_duration(times):
    return np.sum(np.diff(times))


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


def get_diarization(path: pathlib.Path, auth_token, verbose=0, num_speakers=None):
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
    if num_speakers is not None:
        diar = diar_pipe(path, num_speakers=num_speakers)
    else:
        diar = diar_pipe(path)
    vprint(
        "Diarization pipeline completed in"
        f" {time.perf_counter() - start_time:.4f} seconds"
    )

    # format the speakers segments for peaks
    colors = util.random_color_generator(2)
    spkrs_colors = (
        {}
    )  # dictionary to store speaker's colors. key = speaker, value = color
    spkrs_segs = collections.defaultdict(list)
    spkrs_times = collections.defaultdict(list)
    for turn, _, spkr in diar.itertracks(yield_label=True):
        start = turn.start
        end = turn.end
        spkr = f"Speaker {int(spkr.split('_')[1]) + 1}"

        if spkr not in spkrs_colors:
            spkrs_colors[spkr] = next(
                colors
            )  # each speaker has a color used for all of their segments

        spkrs_segs[spkr].append(format_segment(start, end, spkrs_colors[spkr], spkr))
        spkrs_times[spkr].append((start, end))

    vprint(
        f"get_diarization completed in {time.perf_counter() - start_time:.4f} seconds"
    )
    return (spkrs_segs, spkrs_times)


def get_vad(path: pathlib.Path, auth_token, verbose=0):
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

    # format the vad segments for peaks
    vad_segs = []
    vad_times = []
    for turn, _ in vad.itertracks():
        start = turn.start
        end = turn.end
        vad_segs.append(format_segment(start, end, "#5786c9", "VAD"))
        vad_times.append((start, end))

    vprint(f"get_vad completed in {time.perf_counter() - start_time:.4f} seconds")
    return (vad_segs, vad_times)


def get_auth_token(auth_token: str):
    """Returns the pyannote authentication token.
    If `auth_token` is not `None`, it is returned. Otherwise, it is gotten from the
    `PPYANNOTE_AUTH_TOKEN` environment variable. If it is also `None`, and `Exception`
    is raised. Otherwise, it is returned.
    """
    auth_token = os.environ.get("PYANNOTE_AUTH_TOKEN", auth_token)
    if auth_token is None:
        raise Exception(
            "To run the diarization and VAD pipelines, you need a PyAnnotate"
            " authentication token. Pass it in with the --auth-token option or set the"
            " PYANNOTE_AUTH_TOKEN environment variable."
        )
    return auth_token


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

    path = paths[0].absolute()  # paths[0] is--at this point--the only argument in paths

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


def run_from_pipeline(args):
    # args might be passed using - instead of _ since the command line arguments
    # use -. Normally, argparse changes them to _, so the other functions expect
    # _. Therefore, replace any dashes with underscores.
    if "split-channels" in args:
        args["split_channels"] = args.pop("split-channels")
    if "auth-token" in args:
        args["auth_token"] = args.pop("auth-token")
    args["auth_token"] = get_auth_token(args.get("auth_token"))

    # path should be a str or list of str so convert to list of Paths
    paths = util.expand_files(args.pop("path"), to_paths=True)
    route_file(*paths, **args)


def process_audio(
    path: pathlib.Path,
    auth_token,
    reprocess=False,
    quiet=False,
    verbose=0,
    split_channels=False,
    num_speakers=None,
):
    vprint = util.verbose_printer(quiet, verbose)
    vprint(f"Processing {path}", 0)
    start_time = time.perf_counter()

    if len(path.parents) < 2 or path.parents[1].name != "data":
        raise Exception("Input file must be in either data/audio or data/video")
    data_dir = path.parents[1]
    # ensure that waveforms and segments directories exist
    (data_dir / "waveforms").mkdir(parents=True, exist_ok=True)
    (data_dir / "segments").mkdir(parents=True, exist_ok=True)
    (data_dir / "stats").mkdir(parents=True, exist_ok=True)

    # filepaths for the waveform, and segments files
    waveform_path = data_dir / "waveforms" / f"{path.stem}-waveform.json"
    segs_path = data_dir / "segments" / f"{path.stem}-segments.json"
    stats_path = data_dir / "stats" / f"{path.stem}-stats.csv"

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
        try:
            if path.suffix.casefold() in VIDEO_FILES:
                vprint(f"Creating {new_path}")
                util.ffmpeg(old_path, new_path, verbose)
                path = new_path
                made_wav = True
            vprint(f"Creating {waveform_path}")
            util.audiowaveform(path, waveform_path, verbose, split_channels)
        # if a video file has no audio it will throw an error trying to make
        # an audiowaveform, but we want to continue execution so other files
        # can have their audio processed
        except subprocess.CalledProcessError:
            print("This file has no audio to process so no waveform was made")

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
        try:
            if path.suffix.casefold() != ".wav":
                vprint(f"Creating {new_path}")
                util.ffmpeg(old_path, new_path, verbose)
                path = new_path
                made_wav = True

            samples, sr = librosa.load(path, sr=None)
            duration = librosa.get_duration(y=samples, sr=sr)

            segs = []
            spkrs_segs, spkrs_times = get_diarization(
                path, auth_token, verbose=verbose, num_speakers=num_speakers
            )
            spkrs = sorted(spkrs_segs)
            spkrs_durations = {
                spkr: get_times_duration(spkr_times)
                for spkr, spkr_times in spkrs_times.items()
            }
            spkrs_num_segs = {
                spkr: len(spkr_segs) for spkr, spkr_segs in spkrs_segs.items()
            }
            diar_times = [time for spkr in spkrs_times.values() for time in spkr]
            diar_times = flatten_times(diar_times, len(samples), sr)
            diar_duration = get_times_duration(diar_times)

            noise_times = get_complement_times(diar_times, len(samples) / sr)
            noise_samps = samples_from_times(noise_times, samples, sr)
            noise_powers = np.square(noise_samps)
            noise_rms = rms(noise_powers)
            overall_snr = snr_from_times(diar_times, samples, sr, noise_rms)
            spkrs_snrs = {
                spkr: snr_from_times(spkrs_times[spkr], samples, sr, noise_rms)
                for spkr in spkrs
            }

            vad_segs, vad_times = get_vad(path, auth_token, verbose)
            vad_duration = get_times_duration(vad_times)
            non_vad_segs = get_complement_segments(
                vad_segs, duration, "#b59896", "Non-VAD", times=vad_times
            )
            segs.append(
                (
                    "Speakers",
                    [(spkr, spkrs_segs[spkr], spkrs_snrs[spkr]) for spkr in spkrs],
                )
            )
            segs.append(("VAD", vad_segs))
            segs.append(("Non-VAD", non_vad_segs))

            # save the segments
            vprint(f"Creating {segs_path}")
            with segs_path.open("w") as segs_file:
                json.dump(segs, segs_file)

            stats = {
                "sampling_rate": sr,
                "duration": duration,
                "overall_snr": overall_snr,
                "num_speakers": len(spkrs),
                "diar_duration": diar_duration,
                "non_diar_duration": duration - diar_duration,
                "num_diar_segments": sum(spkrs_num_segs.values()),
                "least_segments": util.min_value_item(spkrs_num_segs),
                "most_segments": util.max_value_item(spkrs_num_segs),
                "shortest_speaker": util.min_value_item(spkrs_durations),
                "longest_speaker": util.max_value_item(spkrs_durations),
                "lowest_snr": util.min_value_item(spkrs_snrs),
                "highest_snr": util.max_value_item(spkrs_snrs),
                "vad_duration": vad_duration,
                "num_vad_segments": len(vad_segs),
                "non_vad_duration": duration - vad_duration,
            }
            util.add_to_csv(stats_path, stats)

        # if a video file has no audio it will throw an error trying to make
        # segments, but we want to continue execution so other files
        # can have their audio processed
        except subprocess.CalledProcessError:
            print("This file has no audio to process so no segments were made")

    # if we converted to wav, remove that wav file
    # (since it was only needed for the pipelines)
    if made_wav:
        vprint(f"Deleting {path}")
        path.unlink()
        path = old_path

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
    parser.add_argument(
        "--num-speakers",
        type=int,
        help="Number of speakers if known from face clustering",
    )

    args = vars(parser.parse_args())
    args["auth_token"] = get_auth_token(args["auth_token"])
    start_time = time.perf_counter()
    route_file(*args.pop("path"), **args)
    if not args["quiet"] or args["verbose"]:
        print(
            f"Processing took a total of {time.perf_counter() - start_time:.4f} seconds"
        )
