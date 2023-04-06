from __future__ import annotations

import argparse
import collections
import json
import math
import os
import pathlib
import subprocess
import time

import entropy
import librosa
import numpy as np
import util

AUDIO_FILES = {".mp3", ".wav", ".flac", ".ogg", ".opus"}
VIDEO_FILES = {".mp4", ".mov"}

COPY_TO_LABELED = {"copyTo": ["Labeled.children"]}


def format_tree_item(item_type: str, arguments: list, options: dict = None):
    item = {"type": item_type, "arguments": arguments}
    if options is not None:
        item["options"] = options
    return item


def format_group(name: str, options: dict = None):
    return format_tree_item("Group", [name], options)


def format_peaks_group(name: str, options: dict = None):
    return format_tree_item("PeaksGroup", [name], options)


def format_segment(start, end, color, label, options=None):
    # round start and end to save space in the json file and because many times from
    # the pyannote pipelines look like 5.3071874999999995 and 109.99968750000001
    start = round(start, 7)
    end = round(end, 7)
    peaks_seg = {"startTime": start, "endTime": end, "color": color, "labelText": label}
    return format_tree_item("Segment", [peaks_seg], options)


def get_complement_times(times, duration, pauses=False):
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
            if not pauses:
                comp_times.append((times[i - 1][1], times[i][0]))
            elif (
                times[i][0] - times[i - 1][1] < 2
            ):  # if the nonvad time is less than 2 seconds it's prob. a pause in speech
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


def remove_overlapped(grouped, in_place=False):
    if not in_place:
        grouped = [group[:] for group in grouped]
    i = 1
    n = len(grouped)
    while i < n:
        if len(grouped[i]) == 0:
            grouped.pop(i)
            n -= 1
            continue

        if grouped[i][0][1] < grouped[i - 1][-1][1]:
            grouped[i].pop(0)
        else:
            i += 1
    return grouped


def get_num_convo_turns(times):
    grouped = util.sort_and_regroup(times)
    return len(remove_overlapped(grouped))


def rms(samps):  # give it a list, and it finds the root mean squared
    return np.sqrt(np.mean(np.square(samps)))


def snr(signal, noise):  # https://en.m.wikipedia.org/wiki/Signal-to-noise_ratio
    signal_rms = rms(signal) if not isinstance(signal, float) else signal
    noise_rms = rms(noise) if not isinstance(noise, float) else noise
    snr = ((signal_rms - noise_rms) / noise_rms) ** 2
    snr_db = 10 * (math.log(snr, 10))
    return snr_db


def samples_from_times(times, samples, sr):
    indices = (np.array(times) * sr).astype(int)
    samps = np.empty(np.sum(np.clip(indices[:, 1] - indices[:, 0], 0, None)))
    offset = 0
    for start, stop in indices:
        to = offset + stop - start if stop - start >= 0 else offset
        samps[offset:to] = samples[start:stop]
        offset = to
    return samps


def snr_from_times(signal_times, samples, sr, noise_rms):
    if len(signal_times) == 0:
        return 0
    signal_samps = samples_from_times(signal_times, samples, sr)
    return snr(signal_samps, noise_rms)


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

        # don't need to give segment options because the speaker PeaksGroups handles it
        spkrs_segs[spkr].append(format_segment(start, end, spkrs_colors[spkr], spkr))
        spkrs_times[spkr].append((start, end))

    vprint(
        f"get_diarization completed in {time.perf_counter() - start_time:.4f} seconds"
    )
    return (spkrs_segs, spkrs_times)


def get_vad(path: pathlib.Path, auth_token, onset, offset, verbose=0):
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
    old_params = vad_pipe.parameters(instantiated=True)

    new_params = {}
    if onset is not None:
        new_params["onset"] = onset
    if offset is not None:
        new_params["offset"] = offset
    # change default parameters of onset and offset if given
    old_params.update(new_params)
    vad_pipe.instantiate(old_params)

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
        # don't need to give segment options because the VAD PeaksGroup handles it
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
    onset=None,
    offset=None,
    num_speakers=None,
):
    vprint = util.verbose_printer(quiet, verbose)
    vprint(f"Processing {path}", 0)
    start_time = time.perf_counter()

    for ancestor in path.parents:
        if ancestor.name == "audio" or ancestor.name == "video":
            if ancestor.parent.name == "data":
                data_dir = ancestor.parent
                parent_dir = path.parent.relative_to(ancestor)
                break
    # an `else` for a `for` loop is executed if `break` is never reached
    else:
        raise Exception("Input file must be a descendant of data/audio or data/video.")

    # filepaths for the waveform, and segments files
    waveform_path = data_dir / "waveforms" / parent_dir / f"{path.stem}-waveform.json"
    segs_path = data_dir / "segments" / parent_dir / f"{path.stem}-segments.json"
    stats_path = data_dir / "stats" / parent_dir / f"{path.stem}-stats.csv"
    channels_path = data_dir / "channels" / parent_dir / f"{path.stem}-channels.csv"

    # make the directories needed for all of the files
    waveform_path.parent.mkdir(parents=True, exist_ok=True)
    segs_path.parent.mkdir(parents=True, exist_ok=True)
    stats_path.parent.mkdir(parents=True, exist_ok=True)

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
        # if a video file has no audio it will throw an error trying to make
        # segments, but we want to continue execution so other files
        # can have their audio processed
        except subprocess.CalledProcessError:
            print("This file has no audio to process so no segments were made")

        samples, sr = librosa.load(path, sr=None, mono=not split_channels)
        mono_samples = librosa.to_mono(samples)
        duration = librosa.get_duration(y=mono_samples, sr=sr)

        spkrs_segs, spkrs_times = get_diarization(
            path, auth_token, verbose=verbose, num_speakers=num_speakers
        )
        spkrs = sorted(spkrs_segs.keys())
        spkrs_durations = {
            spkr: get_times_duration(spkr_times)
            for spkr, spkr_times in spkrs_times.items()
        }
        spkrs_num_segs = {
            spkr: len(spkr_segs) for spkr, spkr_segs in spkrs_segs.items()
        }
        diar_times = [time for spkr in spkrs_times.values() for time in spkr]
        diar_times = flatten_times(diar_times, len(mono_samples), sr)

        vad_segs, vad_times = get_vad(path, auth_token, onset, offset, verbose)
        non_vad_segs = []
        for start, end in get_complement_times(vad_times, duration):
            # don't need to give options because the Non-VAD PeaksGroup handles it
            non_vad_segs.append(format_segment(start, end, "#b59896", "Non-VAD"))

        speech_pause_times = get_complement_times(
            vad_times, len(mono_samples) / sr, True
        )  # True means we just want what is likely pauses in speech for noise rms calc.

        noise_times = speech_pause_times

        # no noise to base off of, and can't calculate snr?
        # then try again with higher onset and offset (less strict)
        if not noise_times:
            originalOnset = onset
            originalOffset = offset
            while not noise_times:
                onset = onset + 0.05
                offset = offset + 0.05
                vad_segs, vad_times = get_vad(path, auth_token, onset, offset, verbose)
                speech_pause_times = get_complement_times(
                    vad_times, len(mono_samples) / sr, True
                )
                noise_times = speech_pause_times
            onset = originalOnset
            offset = originalOffset
        # if still no noise for snr throw exception
        # and let user decide what they'd like to do about it
        if not noise_times:
            raise Exception("No non-vad to calculate snr with for file " + str(path))

        noise_samps = samples_from_times(noise_times, mono_samples, sr)
        noise_rms = rms(noise_samps)
        spkrs_snrs = {
            spkr: snr_from_times(spkrs_times[spkr], mono_samples, sr, noise_rms)
            for spkr in spkrs
        }

        vad_segs, vad_times = get_vad(path, auth_token, verbose)
        non_vad_segs = []
        for start, end in get_complement_times(vad_times, duration):
            # don't need to give options because the Non-VAD PeaksGroup handles it
            non_vad_segs.append(format_segment(start, end, "#b59896", "Non-VAD"))

        tree_items = []

        spkrs_groups = []
        spkrs_children_options = COPY_TO_LABELED.copy()
        spkrs_children_options["moveTo"] = ["Speakers.children"]
        for spkr in spkrs:
            options = {
                "snr": spkrs_snrs[spkr],
                "childrenOptions": spkrs_children_options,
                "children": spkrs_segs[spkr],
            }
            spkr_group = format_peaks_group(spkr, options)
            spkrs_groups.append(spkr_group)
        spkrs_options = {
            "parent": "Analysis",
            "playable": True,
            "childrenOptions": COPY_TO_LABELED,
            "children": spkrs_groups,
        }
        speakers = format_group("Speakers", spkrs_options)

        vad_options = {
            "parent": "Analysis",
            "copyTo": ["Labeled.children"],
            "childrenOptions": COPY_TO_LABELED,
            "children": vad_segs,
        }
        vad = format_peaks_group("VAD", vad_options)

        non_vad_options = vad_options.copy()
        non_vad_options["children"] = non_vad_segs
        non_vad = format_peaks_group("Non-VAD", non_vad_options)

        # save the segments
        tree_items = [speakers, vad, non_vad]
        vprint(f"Creating {segs_path}")
        with segs_path.open("w") as segs_file:
            json.dump(tree_items, segs_file)

        overall_snr = snr_from_times(diar_times, mono_samples, sr, noise_rms)
        e_entropy = util.AggregateData(entropy.energy_entropy(mono_samples, sr))
        s_entropy = util.AggregateData(entropy.spectral_entropy(mono_samples, sr))
        diar_duration = get_times_duration(diar_times)
        vad_duration = get_times_duration(vad_times)

        stats = {
            "sampling_rate": sr,
            "duration": duration,
            "num_speakers": len(spkrs),
            "num_convo_turns": get_num_convo_turns(list(spkrs_times.values())),
            "overall_snr_db": overall_snr,
            "e_entropy_mean": e_entropy.mean,
            "e_entropy_median": e_entropy.median,
            "e_entropy_std": e_entropy.std,
            "e_entropy_max": e_entropy.max,
            "e_entropy_min": e_entropy.min,
            "s_entropy_mean": s_entropy.mean,
            "s_entropy_median": s_entropy.median,
            "s_entropy_std": s_entropy.std,
            "s_entropy_max": s_entropy.max,
            "s_entropy_min": s_entropy.min,
            "diar_duration": diar_duration,
            "non_diar_duration": duration - diar_duration,
            "num_diar_segments": sum(spkrs_num_segs.values()),
            "least_segments": util.min_value_item(spkrs_num_segs, default="N/A"),
            "most_segments": util.max_value_item(spkrs_num_segs, default="N/A"),
            "shortest_speaker": util.min_value_item(spkrs_durations, default="N/A"),
            "longest_speaker": util.max_value_item(spkrs_durations, default="N/A"),
            "lowest_snr_db": util.min_value_item(spkrs_snrs, default="N/A"),
            "highest_snr_db": util.max_value_item(spkrs_snrs, default="N/A"),
            "vad_duration": vad_duration,
            "num_vad_segments": len(vad_segs),
            "non_vad_duration": duration - vad_duration,
        }
        for spkr, snr in spkrs_snrs.items():
            stats[f"{spkr}_snr_db"] = snr
        if split_channels and samples.ndim == 2:
            if channels_path.exists():
                channel_names = channels_path.read_text().splitlines()
            else:
                channel_names = [f"channel{i}" for i in range(samples.shape[0])]
            for i, channel_name in enumerate(channel_names):
                c_noise_samps = samples_from_times(noise_times, samples[i], sr)
                c_noise_rms = rms(c_noise_samps)
                c_spkrs_snrs = {
                    spkr: snr_from_times(spkrs_times[spkr], samples[i], sr, c_noise_rms)
                    for spkr in spkrs
                }
                c_overall_snr = snr_from_times(diar_times, samples[i], sr, c_noise_rms)
                stats[f"{channel_name}_overall_snr_db"] = c_overall_snr
                for spkr, snr in c_spkrs_snrs.items():
                    stats[f"{channel_name}_{spkr}_snr_db"] = snr
        util.add_to_csv(stats_path, stats)

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
        "--onset",
        type=float,
        help=(
            "When probability of vad goes above this it is vad for vad_pipe. Between"
            " (0,1)"
        ),
    )
    parser.add_argument(
        "--offset",
        type=float,
        help=(
            "When probability of vad goes below this it is nonvad for vad_pipe. Between"
            " (0,1)"
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
