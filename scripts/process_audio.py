from __future__ import annotations

import argparse
import functools
import json
import os
import pathlib
import re
import subprocess
from collections import defaultdict
from typing import Optional, Sequence

import librosa
import numpy as np
import pandas as pd

import entropy
import log
import snr
import util
from _types import Group, PeaksGroup, Segment, TreeItem
from constants import AUDIO_EXTS, VIDEO_EXTS
from log import logger

COPY_TO_LABELED = {"copyTo": ["Labeled.children"]}


def format_tree_item(
    item_type: str, arguments: Sequence, options: Optional[dict] = None
) -> TreeItem:
    item = {"type": item_type, "arguments": arguments}
    if options is not None:
        item["options"] = options
    return item


def format_group(name: str, options: Optional[dict] = None) -> Group:
    return format_tree_item("Group", [name], options)


def format_peaks_group(name: str, options: Optional[dict] = None) -> PeaksGroup:
    return format_tree_item("PeaksGroup", [name], options)


def format_segment(
    start: float, end: float, color: str, label: str, options: Optional[dict] = None
) -> Segment:
    # round start and end to save space in the json file and because many times from
    # the pyannote pipelines look like 5.3071874999999995 and 109.99968750000001
    start = round(start, 7)
    end = round(end, 7)
    peaks_seg = {"startTime": start, "endTime": end, "color": color, "labelText": label}
    return format_tree_item("Segment", [peaks_seg], options)


# new complement times is changed to accept custom start and stop times
# for processing whole view files of concat audio
def get_complement_times(times, start_time, stop_time):
    comp_times = []
    if len(times) == 0:
        comp_times.append((start_time, stop_time))
    else:
        start_index = 1
        if times[0][0] == start_time:
            start_index = 2
            if len(times) == 1:
                if times[0][1] != stop_time:
                    comp_times.append((times[0][1], stop_time))
            else:
                comp_times.append((times[0][1], times[1][0]))
        else:
            comp_times.append((start_time, times[0][0]))
        for i in range(start_index, len(times)):
            comp_times.append((times[i - 1][1], times[i][0]))
        if times[-1][1] != stop_time:
            comp_times.append((times[-1][1], stop_time))
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

        new_times = []
        for i in range(0, len(times), 2):
            new_times.append((times[i], times[i + 1]))
        times = new_times
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


def samples_from_times(times, samples, sr):
    indices = (np.array(times) * sr).astype(int)
    if len(indices) == 0:
        return []
    samps = np.empty(np.sum(np.clip(indices[:, 1] - indices[:, 0], 0, None)))
    offset = 0
    for start, stop in indices:
        to = offset + stop - start if stop - start >= 0 else offset
        samps[offset:to] = samples[start:stop]
        offset = to
    return samps


def snr_from_times(signal_times, samples, sr, noise_rms):
    signal_samps = samples_from_times(signal_times, samples, sr)
    return snr.snr(signal_samps, noise_rms)


# Try applying a linear adjustment, to see if that makes it
# more accurate and better correlations.
def snr_with_linear_from_times(signal_times, samples, sr, noise_rms):
    signal_samps = samples_from_times(signal_times, samples, sr)
    return snr.snr_with_linear_amp(signal_samps, noise_rms)


@log.Timer()
def get_diarization(path: pathlib.Path, auth_token, num_speakers=None):
    # use global diar_pipe so that it doesn't need
    # to be re-initialized (which is time-consuming)
    global diar_pipe
    # lazy import Pipeline because it takes a while to import. If it were
    # imported at the top, then someone doing `python process_audio.py -h`
    # would have to wait a while just to see the help message.
    # We don't need to do `if "Pipeline" in globals()` because python caches imports,
    # so it isn't actually getting reimported every time get_diarization is called
    from pyannote.audio import Pipeline

    if "diar_pipe" not in globals():  # diar_pipe hasn't been initialized yet
        logger.trace("Initializing diarization pipeline")
        with log.Timer("Initializing diarization pipeline took {}"):
            diar_pipe = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-3.0", use_auth_token=auth_token
            )

    try:
        logger.trace("Running diarization pipeline")
        if num_speakers is not None:
            diar = diar_pipe(path, num_speakers=num_speakers)
        else:
            diar = diar_pipe(path)
    except ValueError:
        logger.warning("{} failed diarization or has no speakers.", path)
        return (defaultdict(list), defaultdict(list))

    logger.trace("Formatting diarization results as segments")
    # format the speakers segments for peaks
    colors = util.random_color_generator(seed=2)
    # dictionary to store speaker's colors. key = speaker, value = color
    spkrs_colors = {}
    spkrs_segs = defaultdict(list)
    spkrs_times = defaultdict(list)
    for turn, _, spkr in diar.itertracks(yield_label=True):
        start = turn.start
        end = turn.end
        spkr = f"Speaker {int(spkr.split('_')[1]) + 1}"

        if spkr not in spkrs_colors:
            # each speaker has a color used for all of their segments
            spkrs_colors[spkr] = next(colors)

        # don't need to give segment options because the speaker PeaksGroups handles it
        spkrs_segs[spkr].append(format_segment(start, end, spkrs_colors[spkr], spkr))
        spkrs_times[spkr].append((start, end))

    return (spkrs_segs, spkrs_times)


@log.Timer()
def get_vad(path: pathlib.Path, auth_token, onset, offset):
    # use global vad_pipe so that it doesn't need
    # to be re-initialized (which is time-consuming)
    global vad_pipe
    from pyannote.audio import Pipeline

    if "vad_pipe" not in globals():  # vad_pipe hasn't been initialized yet
        logger.trace("Initializing VAD pipeline")
        with log.Timer("Initializing VAD pipeline took {}"):
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

    logger.trace("Running VAD pipeline")
    vad = vad_pipe(path)
    logger.trace("Formatting VAD results as segments")
    # format the vad segments for peaks
    vad_segs = []
    vad_times = []
    for turn, _ in vad.itertracks():
        start = turn.start
        end = turn.end
        # don't need to give segment options because the VAD PeaksGroup handles it
        vad_segs.append(format_segment(start, end, "#5786c9", "VAD"))
        vad_times.append((start, end))

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


def route_dir(dir, scan_dir=True, **kwargs):
    logger.debug("Running process_audio on each file in {}", dir)
    for path in dir.iterdir():
        route_file(path, scan_dir=scan_dir, **kwargs)


def route_file(*paths: pathlib.Path, scan_dir=True, **kwargs):
    if len(paths) == 0:
        # if no file or directory given, use directory script was called from
        paths = [pathlib.Path.cwd()]
    # if multiple files (or directories) given, run function on each one
    elif len(paths) > 1:
        for path in paths:
            route_file(path, scan_dir=scan_dir, **kwargs)
        # stop function because all of the processing is
        # done in the function calls in the for loop
        return

    path = paths[0].absolute()  # paths[0] is--at this point--the only argument in paths

    # if file.path is an audio or video file, process it
    if path.suffix.casefold() in AUDIO_EXTS or path.suffix.casefold() in VIDEO_EXTS:
        process_audio(path, **kwargs)

    # run process audio on every file in file.path if it is a dir and scan_dir is True
    elif path.is_dir() and scan_dir:
        # the data dir was passed so run on data/audio and data/video
        if path.name == "data":
            route_dir(path / "audio", scan_dir=scan_dir, **kwargs)
            route_dir(path / "video", scan_dir=scan_dir, **kwargs)
            route_dir(path / "views", scan_dir=scan_dir, **kwargs)
        else:
            route_dir(path, scan_dir=False, **kwargs)


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


@log.Timer()
def process_audio(
    path: pathlib.Path,
    auth_token,
    reprocess=False,
    split_channels=False,
    onset=None,
    offset=None,
    num_speakers=None,
):
    log.log_vars(
        log_separate_=True,
        path=path,
        reprocess=reprocess,
        split_channels=split_channels,
        onset=onset,
        offset=offset,
        num_speakers=num_speakers,
    )

    for ancestor in path.parents:
        if (
            ancestor.name == "audio"
            or ancestor.name == "video"
            or ancestor.name == "views"
        ):
            if ancestor.parent.name == "data":
                data_dir = ancestor.parent
                parent_dir = path.parent.relative_to(ancestor)
                break
    # an else for a for loop is executed if break is never reached
    else:
        raise ValueError(
            "Input file must be a descendant of data/audio, data/video, or data/views"
        )

    # filepaths for the waveform, and segments files
    waveform_path = data_dir / "waveforms" / parent_dir / f"{path.stem}-waveform.json"
    segs_path = data_dir / "annotations" / parent_dir / f"{path.stem}-annotations.json"
    stats_path = data_dir / "stats" / parent_dir / f"{path.stem}-stats.csv"
    channels_path = data_dir / "channels" / parent_dir / f"{path.stem}-channels.csv"

    log.log_vars(
        log_separate_=True,
        data_dir=data_dir,
        parent_dir=parent_dir,
        waveform_path=waveform_path,
        segs_path=segs_path,
        stats_path=stats_path,
        channels_path=channels_path,
    )

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
        if (
            reprocess
            or not segs_path.exists()
            or (not waveform_path.exists() and path.suffix.casefold() in VIDEO_EXTS)
        ):
            logger.debug("{} is not a wav file. Creating {}", path.name, new_path.name)
            try:
                util.ffmpeg(old_path, new_path)
                path = new_path
                made_wav = True
            # if a video file has no audio ffmpeg will throw an error
            except subprocess.CalledProcessError:
                logger.error("{} has no audio to process", path)
                # raise ValueError(f"{path} has no audio to process")

    # only recreate the waveform if it doesn't already exist
    if waveform_path.exists() and not reprocess:
        logger.info("{} already exists. To recreate it, pass -r", waveform_path)
    else:  # create the waveform
        util.audiowaveform(path, waveform_path, split_channels=split_channels)
        if split_channels:  # also make a mono wavforms for viewing if user wants
            logger.debug("Creating mono waveform")
            mono_waveform_path = (
                data_dir / "waveforms" / parent_dir / f"{path.stem}-waveform-mono.json"
            )
            util.audiowaveform(path, mono_waveform_path, split_channels=False)

    if segs_path.exists() and not reprocess:
        logger.info("{} has already been processed. To reprocess it, pass -r", path)
    else:
        samples, sr = librosa.load(path, sr=None, mono=not split_channels)
        mono_samples = librosa.to_mono(samples)
        duration = librosa.get_duration(y=mono_samples, sr=sr)

        logger.debug("sr={} duration={:.3f}", sr, duration)

        # Do speaker diarization (just make spkrs_segs and
        # spkrs_times only take before and after filter_start and filter_stop)
        spkrs_segs, spkrs_times = get_diarization(
            path, auth_token, num_speakers=num_speakers
        )

        # Do vad (just make spkrs_segs and spkrs_times only take before and
        # after filter_start and filter_stop)
        vad_segs, vad_times = get_vad(path, auth_token, onset, offset)

        # this is to allow for the stats to be calculated on the entire
        # file or a subsection like a run in a view
        def calc_stats(
            filter_start=0, filter_stop=duration, stats_path=stats_path, entire=True
        ):
            # Make sure it is only within the filter_start and filter_stop
            filtered_spkrs_times = {
                spkr: [
                    tr for tr in times if filter_start <= tr[0] <= tr[1] <= filter_stop
                ]
                for spkr, times in spkrs_times.items()
            }
            filtered_spkrs_segs = {
                spkr: [
                    seg
                    for seg in segs
                    if filter_start
                    <= seg["arguments"][0]["startTime"]
                    <= seg["arguments"][0]["endTime"]
                    <= filter_stop
                ]
                for spkr, segs in spkrs_segs.items()
            }

            spkrs = sorted(filtered_spkrs_segs.keys())

            spkrs_durations = {
                spkr: get_times_duration(spkr_times)
                for spkr, spkr_times in filtered_spkrs_times.items()
            }
            spkrs_num_segs = {
                spkr: len(spkr_segs) for spkr, spkr_segs in filtered_spkrs_segs.items()
            }

            diar_times = [
                time for spkr in filtered_spkrs_times.values() for time in spkr
            ]
            diar_times = flatten_times(diar_times, len(mono_samples), sr)

            filtered_vad_times = list(
                filter(
                    lambda tr: filter_start <= tr[0] <= filter_stop
                    and filter_start <= tr[1] <= filter_stop,
                    vad_times,
                )
            )
            filtered_vad_segs = [
                segment
                for segment in vad_segs
                if filter_start <= segment["arguments"][0]["startTime"] <= filter_stop
                and filter_start <= segment["arguments"][0]["endTime"] <= filter_stop
            ]

            filtered_diar_times = list(
                filter(
                    lambda tr: filter_start <= tr[0] <= filter_stop
                    and filter_start <= tr[1] <= filter_stop,
                    diar_times,
                )
            )

            non_vad_segs = []
            non_vad_times = get_complement_times(
                filtered_vad_times, filter_start, filter_stop
            )
            for start, end in non_vad_times:
                # don't need to give options because the Non-VAD PeaksGroup handles it
                non_vad_segs.append(format_segment(start, end, "#b59896", "Non-VAD"))
            non_vad_samps = samples_from_times(non_vad_times, mono_samples, sr)

            logger.trace("Calculating SNRs")

            # Filter to get segments that are less than 2 seconds long since these
            # are probably pauses in speech (and thus noise)
            noise_times = list(filter(lambda tr: tr[1] - tr[0] < 2, non_vad_times))

            if len(noise_times) == 0:
                logger.trace("No noise found, using non-vad instead")
                # if there are no speech pause times, use regular nonvad instead
                noise_times = non_vad_times

            # todo: decide if we implement this with nonvad and/or
            # speech_pause / or both
            #
            # no noise to base off of, and can't calculate snr?
            # then try again with higher onset and offset (less strict)
            # if not noise_times:
            # originalOnset = onset
            # originalOffset = offset
            # while not noise_times:
            # onset = onset + 0.05
            # offset = offset + 0.05
            # vad_segs, vad_times = get_vad(path, auth_token, onset, offset)
            # speech_pause_times = get_complement_times(
            # vad_times, duration, True
            # )
            # noise_times = speech_pause_times
            # onset = originalOnset
            # offset = originalOffset
            # if still no noise for snr throw exception
            # and let user decide what they'd like to do about it
            # if not noise_times:
            # raise Exception("No non-vad to calculate snr with for file " + str(path))

            noise_samps = samples_from_times(noise_times, mono_samples, sr)
            noise_rms = snr.rms(noise_samps)
            if noise_rms == 0:
                # can't divide by 0, be less picky
                # and take non vad not just speech_pause
                noise_rms = snr.rms(non_vad_samps)

            non_vad_samps = samples_from_times(non_vad_times, mono_samples, sr)
            non_vad_rms = snr.rms(non_vad_samps)

            spkrs_snrs = {
                spkr: snr_from_times(
                    filtered_spkrs_times[spkr], mono_samples, sr, noise_rms
                )
                for spkr in spkrs
            }

            # TODO add this to stats if linear is found to be better
            # spkrs_with_linear_snrs = {
            #     spkr: snr_with_linear_from_times(
            #         filtered_spkrs_times[spkr], mono_samples, sr, noise_rms
            #     )
            #     for spkr in spkrs
            # }

            spkrs_non_vad_snrs = {
                spkr: snr_from_times(
                    filtered_spkrs_times[spkr], mono_samples, sr, non_vad_rms
                )
                for spkr in spkrs
            }

            # TODO add this to stats if linear and non-vad as noise
            # is found to be better
            # spkrs_non_vad_with_linear_snrs = {
            #     spkr: snr_with_linear_from_times(
            #         filtered_spkrs_times[spkr], mono_samples, sr, non_vad_rms
            #     )
            #     for spkr in spkrs
            # }

            if len(spkrs_snrs) != 0:
                max_speaker = max(spkrs_snrs, key=spkrs_snrs.get)
                non_main_spkr_spkrs = []
                for speaker in spkrs:
                    if speaker != max_speaker:
                        non_main_spkr_spkrs.append(speaker)

                non_main_diar_times = [
                    time
                    for spkr in non_main_spkr_spkrs
                    for time in filtered_spkrs_times[spkr]
                ]
                non_main_diar_times = flatten_times(
                    non_main_diar_times, len(mono_samples), sr
                )

            noise_segs = []
            for start, end in noise_times:
                noise_segs.append(format_segment(start, end, "#092b12", "SNR-Noise"))

            logger.trace("Creating tree items for Speechviz")

            tree_items = []

            spkrs_groups = []
            spkrs_children_options = COPY_TO_LABELED.copy()
            spkrs_children_options["moveTo"] = ["Speakers.children"]
            for spkr in spkrs:
                options = {
                    "snr": spkrs_snrs[spkr],
                    "childrenOptions": spkrs_children_options,
                    "children": filtered_spkrs_segs[spkr],
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

            speech_pause_options = vad_options.copy()
            speech_pause_options["children"] = noise_segs
            speech_pause = format_peaks_group("SNR-Noise", speech_pause_options)

            # if this is the calc_stats being run on the entire file
            # (not individual runs of a view) save the segments
            if entire:
                tree_items = {
                    "formatVersion": 3,
                    "annotations": [speakers, vad, non_vad, speech_pause],
                }
                logger.info("Saving segments to {}", segs_path)

                try:
                    with open(segs_path, "r") as annot_file:
                        annot_data = json.load(annot_file)

                    if annot_data.get("formatVersion") != 3:
                        # raise error to catch and rewrite as new format
                        raise ValueError()

                    # just update the annotations if it is already in the updated format
                    annotations = annot_data.get("annotations", [])

                    def replaceElement(name, replacement):
                        found = False
                        for index, element in enumerate(annotations):
                            if element.get("arguments") == [name]:
                                # replace previous
                                annotations[index] = replacement
                                found = True
                                break
                        if not found:
                            # add replacement for first time
                            annotations.append(replacement)

                    replaceElement("Speakers", speakers)
                    replaceElement("VAD", vad)
                    replaceElement("Non-VAD", non_vad)
                    replaceElement("SNR-Noise", speech_pause)

                    tree_items["annotations"] = annotations

                except FileNotFoundError or json.JSONDecodeError or ValueError:
                    # either file doesn't exist yet,
                    # it's empty, or it's in the old format
                    # so we don't need to do anything special with tree_items
                    # (just save it as is, hence the empty except block)
                    pass

                with segs_path.open("w") as segs_file:
                    json.dump(tree_items, segs_file, indent=2)

            logger.trace("Calculating stats")

            # uses speech pause as noise
            overall_snr = snr_from_times(
                filtered_diar_times, mono_samples, sr, noise_rms
            )
            # uses non vad as noise
            overall_non_vad_snr = snr_from_times(
                filtered_diar_times, mono_samples, sr, non_vad_rms
            )
            # uses speech pause as noise
            overall_with_linear_snr = snr_with_linear_from_times(
                filtered_diar_times, mono_samples, sr, noise_rms
            )
            # uses non vad as noise
            overall_non_vad_with_linear_snr = snr_with_linear_from_times(
                filtered_diar_times, mono_samples, sr, non_vad_rms
            )
            # uses vad as overall signal, speech pause as noise
            overall_vad_snr = snr_from_times(
                filtered_vad_times, mono_samples, sr, noise_rms
            )
            # uses vad as overall signal, non vad as noise
            overall_non_vad_vad_snr = snr_from_times(
                filtered_vad_times, mono_samples, sr, non_vad_rms
            )
            # uses vad as overall signal, speech pause as noise
            overall_vad_with_linear_snr = snr_with_linear_from_times(
                filtered_diar_times, mono_samples, sr, noise_rms
            )
            # uses vad as overall signal, non vad as noise
            overall_non_vad_vad_with_linear_snr = snr_with_linear_from_times(
                filtered_diar_times, mono_samples, sr, non_vad_rms
            )

            if len(spkrs_snrs) > 1:
                overall_wout_main_snr = snr_from_times(
                    non_main_diar_times, mono_samples, sr, noise_rms
                )
                overall_non_vad_wout_main_snr = snr_from_times(
                    non_main_diar_times, mono_samples, sr, non_vad_rms
                )
            else:
                overall_wout_main_snr = "N/A"
                overall_non_vad_wout_main_snr = "N/A"

            # entropy should only be calculated on the noise
            e_entropy = util.AggregateData(entropy.energy_entropy(non_vad_samps, sr))
            s_entropy = util.AggregateData(entropy.spectral_entropy(non_vad_samps, sr))
            diar_duration = get_times_duration(filtered_diar_times)
            vad_duration = get_times_duration(filtered_vad_times)
            snr_noise_duration = get_times_duration(noise_times)

            # Bind "N/A" as default to save room when calling these functions
            # default is a tuple of "N/A" and "N/A" so that it can be unpacked
            maxval = functools.partial(util.max_value, default=("N/A", "N/A"))
            minval = functools.partial(util.min_value, default=("N/A", "N/A"))

            # key (speaker) is first item in tuple, value is second
            least_segs_spkr, least_segs = minval(spkrs_num_segs)
            most_segs_spkr, most_segs = maxval(spkrs_num_segs)
            shortest_spkr, shortest_spkr_duration = minval(spkrs_durations)
            longest_spkr, longest_spkr_duration = maxval(spkrs_durations)
            lowest_snr_spkr, lowest_snr = minval(spkrs_snrs)
            highest_snr_spkr, highest_snr = maxval(spkrs_snrs)

            num_speakers = 0
            for spkr in spkrs:
                if len(filtered_spkrs_segs[spkr]) > 0:
                    num_speakers += 1

            stats = {
                "sampling_rate": sr,
                "duration": filter_stop - filter_start,
                "num_speakers": num_speakers,
                "num_convo_turns": get_num_convo_turns(
                    list(filtered_spkrs_times.values())
                ),
                "overall_snr_db": overall_snr,
                "overall_non_vad_snr_db": overall_non_vad_snr,
                "overall_wout_main_snr_db": overall_wout_main_snr,
                "overall_non_vad_wout_main_snr_db": overall_non_vad_wout_main_snr,
                "overall_with_linear_snr_db": overall_with_linear_snr,
                "overall_non_vad_with_linear_snr_db": overall_non_vad_with_linear_snr,
                "overall_vad_snr_db": overall_vad_snr,
                "overall_non_vad_vad_snr_db": overall_non_vad_vad_snr,
                "overall_vad_with_linear_snr_db": overall_vad_with_linear_snr,
                "overall_non_vad_vad_with_linear_snr_db": (
                    overall_non_vad_vad_with_linear_snr
                ),
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
                "non_diar_duration": filter_stop - filter_start - diar_duration,
                "num_diar_segments": sum(spkrs_num_segs.values()),
                "least_segments": least_segs,
                "least_segments_speaker": least_segs_spkr,
                "most_segments": most_segs,
                "most_segments_speaker": most_segs_spkr,
                "shortest_duration": shortest_spkr_duration,
                "shortest_duration_speaker": shortest_spkr,
                "longest_duration": longest_spkr_duration,
                "longest_duration_speaker": longest_spkr,
                "lowest_snr_db": lowest_snr,
                "lowest_snr_db_speaker": lowest_snr_spkr,
                "highest_snr_db": highest_snr,
                "highest_snr_db_speaker": highest_snr_spkr,
                "vad_duration": vad_duration,
                "num_vad_segments": len(filtered_vad_segs),
                "non_vad_duration": filter_stop - filter_start - vad_duration,
                "snr_noise_duration": snr_noise_duration,
            }
            for spkr, spkr_snr in spkrs_snrs.items():
                stats[f"{spkr}_snr_db"] = spkr_snr
            for spkr, spkr_snr in spkrs_non_vad_snrs.items():
                stats[f"{spkr}_non_vad_snr_db"] = spkr_snr
            if split_channels and samples.ndim == 2:
                if channels_path.exists():
                    channel_names = channels_path.read_text().splitlines()
                else:
                    channel_names = [f"channel{i}" for i in range(samples.shape[0])]
                logger.debug("channel_names={}", channel_names)
                for i, channel_name in enumerate(channel_names):
                    c_noise_samps = samples_from_times(noise_times, samples[i], sr)
                    c_noise_rms = snr.rms(c_noise_samps)
                    if c_noise_rms == 0:
                        logger.debug('channel "{}"\'s noise rms is 0', channel_name)
                        # can't divide by 0, be less picky and take
                        # non vad not just speech_pause
                        c_noise_rms = snr.rms(non_vad_samps)
                    c_spkrs_snrs = {
                        spkr: snr_from_times(
                            filtered_spkrs_times[spkr], samples[i], sr, c_noise_rms
                        )
                        for spkr in spkrs
                    }
                    c_overall_snr = snr_from_times(
                        filtered_diar_times, samples[i], sr, c_noise_rms
                    )
                    if len(spkrs_snrs) > 1:
                        c_overall_wout_main_snr = snr_from_times(
                            non_main_diar_times, samples[i], sr, c_noise_rms
                        )
                    else:
                        c_overall_wout_main_snr = "N/A"
                    stats[f"{channel_name}_overall_wout_main_snr_db"] = (
                        c_overall_wout_main_snr
                    )
                    stats[f"{channel_name}_overall_snr_db"] = c_overall_snr

                    for spkr, spkr_snr in c_spkrs_snrs.items():
                        stats[f"{channel_name}_{spkr}_snr_db"] = spkr_snr
            remove_keys = [re.compile(".*_snr")]
            os.makedirs(os.path.dirname(stats_path), exist_ok=True)
            if not os.path.exists(stats_path):
                with open(stats_path, "w"):
                    pass
            util.add_to_csv(stats_path, stats, remove_keys=remove_keys)

        calc_stats()
        if (
            ancestor.name == "views"
        ):  # it is a view file, also do stats on the individual runs
            logger.trace("Calculating SNRs")
            start_stop_df = pd.read_csv(f"data/views/{path.stem}-times.csv")

            for index, row in start_stop_df.iloc[
                0:
            ].iterrows():  # Start from the second row (index 1)
                file_name = row["File Name"]
                file_name = file_name.rstrip(".wav")
                stats_path_run = (
                    data_dir / "stats" / f"{path.stem}-views" / f"{file_name}-stats.csv"
                )
                channels_path = (
                    data_dir / "channels" / path.stem / f"{file_name}-channels.csv"
                )

                start_time = int(row["Start Time (seconds)"])
                end_time = int(row["End Time (seconds)"])
                calc_stats(start_time, end_time, stats_path_run, False)

    # if we converted to wav, remove that wav file
    # (since it was only needed for the pipelines)
    if made_wav:
        logger.debug("Deleting {}", path)
        path.unlink()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Process audio files.")
    parser.add_argument(
        "-r",
        "--reprocess",
        action="store_true",
        help="Reprocess audio files detected to have already been processed",
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
    log.add_log_level_argument(parser)

    args = vars(parser.parse_args())
    args["auth_token"] = get_auth_token(args["auth_token"])
    log.setup_logging(args.pop("log_level"))
    with log.Timer("Processing took {}"):
        route_file(*args.pop("path"), **args)
