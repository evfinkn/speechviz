from __future__ import annotations

import os
import re
import json
import time
import pathlib
import argparse
import subprocess
from typing import Optional

import numpy as np
import librosa

import util

AUDIO_FILES = {".mp3", ".wav", ".flac", ".ogg", ".opus"}
VIDEO_FILES = {".mp4", ".mov"}


def format_segment(start, end, color, label):
    return {"startTime": start,
            "endTime": end,
            "color": color,
            "labelText": label}
    
    
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
    times = [(seg["startTime"], seg["endTime"]) for seg in segments] if times is None else times
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
        noise_samps = samples_from_times(get_complement_times(signal_times, len(samples) / sr), samples, sr)
        noise_powers = np.square(noise_samps)
        noise_rms = rms(noise_powers)
    return snr(signal_powers, noise_rms)


def get_diarization(file, auth_token, samples, sr, verbose=0):
    # use global diar_pipe so it doesn't need to be re-initialized (which is time-consuming)
    global diar_pipe
    # lazy import Pipeline because it takes a while to import. If it were imported at the top,
    # then someone doing `python process_audio.py -h` would have to wait a while just to see the
    # help message. We don't need to do `if "Pipeline" in globals()` because python caches imports,
    # so it isn't actually getting reimported every time get_diarization is called
    from pyannote.audio import Pipeline # lazy import because 
    
    # quiet doesn't matter because we only use verbose_level > 0 in this function
    vprint = util.verbose_printer(False, verbose)

    if not "diar_pipe" in globals():  # diar_pipe hasn't been initialized yet
        vprint("Initializing diarization pipeline")
        diar_pipe = Pipeline.from_pretrained("pyannote/speaker-diarization@2.1", use_auth_token=auth_token)
    
    vprint("Running the diarization pipeline")
    start_time = time.perf_counter()
    diar = diar_pipe(file.path)
    vprint(f"Diarization pipeline completed in {time.perf_counter() - start_time:.4f} seconds")
    vprint("Looping through the annotations to create the speaker segments")
    loop_start_time = time.perf_counter()

    # format the speakers segments for peaks
    colors = util.random_color_generator(2)
    spkrs_colors = {}   # dictionary to store speaker's colors   key = speaker, value = color
    spkrs_segs = {}
    spkrs_times = {}
    diar_times = []
    is_speech = np.full(len(samples), False)
    for turn, _, spkr in diar.itertracks(yield_label=True):
        start = turn.start
        end = turn.end
        spkr = f"Speaker {int(spkr.split('_')[1]) + 1}"
        
        if not spkr in spkrs_colors:
            spkrs_colors[spkr] = next(colors)   # each speaker has a color used for all of their segments
            spkrs_segs[spkr] = []
            spkrs_times[spkr] = []

        spkrs_segs[spkr].append(format_segment(start, end, spkrs_colors[spkr], spkr))
        spkrs_times[spkr].append((start, end))
        diar_times.append((start, end))
    spkrs = sorted(spkrs_segs)
    for srange in librosa.time_to_samples(diar_times, sr=sr):
        is_speech[srange[0]:srange[1]] = True
    diar_indices = np.where(is_speech == True)[0]
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
        diar_times = [(diar_times[i], diar_times[i + 1]) for i in range(0, len(diar_times), 2)]

    vprint(f"Speaker segments created in {(time.perf_counter() - loop_start_time) * 1000:.4f} milliseconds")
    vprint("Calculating SNRs")
    snr_start_time = time.perf_counter()
    
    noise_times = get_complement_times(diar_times, len(samples) / sr)
    noise_samps = samples_from_times(noise_times, samples, sr)
    noise_powers = np.square(noise_samps)
    noise_rms = rms(noise_powers)
    spkrs_snrs = {spkr: snr_from_times(spkrs_times[spkr], samples, sr, noise_rms) for spkr in spkrs}
    
    vprint(f"SNRs calculated in {(time.perf_counter() - snr_start_time) * 1000:.4f} milliseconds")
    vprint(f"get_diarization completed in {time.perf_counter() - start_time:.4f} seconds")

    # TODO: Change this to return a dict and then change viz.js to take a dict
    # because this is confusing. It could be something like:
    # {"type": "GroupOfGroups", name="Speakers", children=[{"type": "Group", ...}, ...]}
    # arrange spkrs_segs so that it's an array of tuples containing a speaker, that speaker's segments, and that speaker's snr
    # i.e. spkrs_segs = [ ("Speaker 1", [...], spkr_1_snr), ("Speaker 2", [...], spkr_2_snr), ... ]
    return ("Speakers", [(spkr, spkrs_segs[spkr], spkrs_snrs[spkr]) for spkr in spkrs])


def get_vad(file, auth_token, duration, verbose=0):
    # use global pipeline so it doesn't need to be re-initialized (which is time-consuming)
    global vad_pipe
    from pyannote.audio import Pipeline

    # quiet doesn't matter because we only use verbose_level > 0 in this function
    vprint = util.verbose_printer(False, verbose)
    
    if not "vad_pipe" in globals():  # vad_pipe hasn't been initialized yet
        vprint("Initializing VAD pipeline")
        vad_pipe = Pipeline.from_pretrained("pyannote/voice-activity-detection", use_auth_token=auth_token)
    
    vprint("Running the VAD pipeline")
    start_time = time.perf_counter()
    vad = vad_pipe(file.path)
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
        
    vprint(f"VAD segments created in {(time.perf_counter() - loop_start_time) * 1000:.4f} milliseconds")
    vprint("Creating the non-VAD segments")
    non_vad_start_time = time.perf_counter()
        
    non_vad_segs = get_complement_segments(vad_segs, duration, "#b59896", "Non-VAD", times=vad_times)
    
    vprint(f"Non-VAD segments created in {(time.perf_counter() - non_vad_start_time) * 1000:.4f} milliseconds")
    vprint(f"get_vad completed in {time.perf_counter() - start_time:.4f} seconds")
        
    # TODO: See TODO at end of get_diarization
    return (("VAD", vad_segs), ("Non-VAD", non_vad_segs))


def route_file(*args, verbose=0, scan_dir=True, **kwargs):
    if len(args) == 0:
        args = [os.getcwd()]  # if no file or directory given, use directory script was called from
    elif len(args) > 1:  # if multiple files (or directories) given, run function on each one
        for arg in args:
            route_file(arg, verbose=verbose, scan_dir=scan_dir, **kwargs)
        return  # stop function because all processing done in the function calls in the for loop
    
    file_path = args[0]  # args[0] is--at this point--the only argument in args
    file = util.FileInfo(file_path)
    vprint = util.verbose_printer(False, verbose)
    
    # if given text file, run the function on each line
    if file.ext == ".txt":
        vprint(f"{file.path} is a text file. Running process_audio on the file on each line...")
        with open(file.path) as txtfile:
            for line in txtfile.read().split("\n"):
                route_file(line, verbose=verbose, scan_dir=scan_dir, **kwargs)
        return
    
    # run process audio on every file in file.path if it is a dir and scan_dir is True
    elif file.ext == "" and scan_dir:
        dir_files = util.ls(file.path)
        if "audio" in dir_files:  # if "audio" dir is in file.path, run process_audio on "audio" dir
            vprint(f"Detected audio directory. Running process_audio on {file.path}/audio")
            route_file(f"{file.path}/audio", verbose=verbose, scan_dir=scan_dir, **kwargs)
        if "video" in dir_files:  # if "video" dir is in file.path, run process_aduio on "video" dir
            vprint(f"Detected video directory. Running process_audio on {file.path}/video")
            route_file(f"{file.path}/video", verbose=verbose, scan_dir=scan_dir, **kwargs)
        if "audio" not in dir_files and "video" not in dir_files:
            vprint(f"{file.path} is a directory. Running process_audio on each file...")
            for dir_file in dir_files:
                route_file(f"{file.path}/{dir_file}", verbose=verbose, scan_dir=False, **kwargs)
    
    # if file.path is an audio or video file, process it
    elif file.ext.casefold() in AUDIO_FILES or file.ext.casefold() in VIDEO_FILES:
        process_audio(file, verbose=verbose, **kwargs)


def ffmpeg(
    input: str,
    output: str,
    verbose: int = 0, 
    input_options: Optional[list[str]] = None,
    output_options: Optional[list[str]] = None):
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
    options: Optional[list[str]] = None):
    """Wrapper for the `audiowaveform` command.

    Parameters
    ----------
    input : str
        The file to input into `audiowaveform`.
    output : str
        The file for `audiowaveform` to output to. If a file at the path already exists,
        it will be overwritten.
    verbose : int, default=0
        If greater than or equal to 2, `audiowaveforms`'s output to stdout will be printed.
    split_channels : boolean, default=False
        Generate a waveform for each channel instead of merging into 1 waveform.
    options : list of str, optional
        Additional options to pass in.

    Returns
    -------
    subprocess.CompletedProcess
        The completed process containing info about the `audiowaveform` command that was run.
    """
    args = ["audiowaveform", f"-i{input}", f"-o{output}", "-b", "8"]
    if split_channels:
        args.append("--split-channels")
    if options:
        args.extend(options)
    return subprocess.run(args, capture_output=verbose < 2, check=True)


def process_audio(file, auth_token, reprocess=False, quiet=False, verbose=0, split_channels=False):
    vprint = util.verbose_printer(quiet, verbose)
    vprint(f"processing {file.path}", 0)
    start_time = time.perf_counter()
    
    # check if output is being split between audio, waveforms, and segments directories
    # and if so, get the base directory for the three subdirectories
    separate_dirs = False
    match = re.match(".*(?=/(audio|video)$)", file.dir)
    if match:
        data_dir = match[0]  # data_dir is file.path for the dir containing audio, waveforms, and segments dirs
        vprint(f"Separating files into audio, waveforms, and segments directories. Data directory path is '{data_dir}'")
        separate_dirs = True
        util.mkdir(f"{data_dir}/waveforms")
        util.mkdir(f"{data_dir}/segments")
            
    # filepaths for the waveform, and segments files
    waveform_dir = file.dir if not separate_dirs else f"{data_dir}/waveforms"
    waveform_path = f"{waveform_dir}/{file.name}-waveform.json"
    segs_dir = file.dir if not separate_dirs else f"{data_dir}/segments"
    segs_path = f"{segs_dir}/{file.name}-segments.json"

    # if the audio isn't in wav format, it'll need to be converted to wav (pipeline requires wav)
    made_wav = False
    if file.ext.casefold() != ".wav":
        old_path = file.path
        new_path = f"{file.dir}/{file.name}.wav"

    # only recreate the waveform if it doesn't already exist
    if os.path.exists(waveform_path) and not reprocess:
        vprint(f"{waveform_path} already exists. To recreate it, use the -r argument", 0)
    else: # create the waveform
        # audiowaveform requires an audio file, so convert to wav if file is a video file
        if file.ext.casefold() in VIDEO_FILES:
            vprint(f"Creating {new_path}")
            ffmpeg(old_path, new_path, verbose)
            file = util.FileInfo(new_path)
            made_wav = True
        vprint(f"Creating {waveform_path}")
        audiowaveform(file.path, waveform_path, verbose, split_channels)

    # check if audio has already been processed and only process if reprocess is passed in as True
    if os.path.exists(segs_path) and not reprocess:
        vprint(f"{file.path} has already been processed. To reprocess it, use the '-r' argument", 0)
    else:
        # I know that this convert to wav part is duplicate code as above, but the original way
        # was that the video files were converted to wav before process_audio was called, even
        # though they might not need to be reprocessed (meaning time is wasted converting)
        # so this fixes that
        # if we didn't need to make the waveform, the file might still not be a wav file
        if file.ext.casefold() != ".wav":
            vprint(f"Creating {new_path}")
            ffmpeg(old_path, new_path, verbose)
            file = util.FileInfo(new_path)
            made_wav = True
            
        samples, sr = librosa.load(file.path, sr=None)
        duration = librosa.get_duration(y=samples, sr=sr)
        
        segs = []
        segs.append(get_diarization(file, auth_token, samples, sr, verbose))
        segs.extend(get_vad(file, auth_token, duration, verbose))

        # save the segments
        vprint(f"Creating {segs_path}")
        with open(segs_path, "w") as segs_file:
            json.dump(segs, segs_file)
            
    # if converted to wav, remove that wav file (since it was only needed for the diarization
    if made_wav:
        vprint(f"Deleting {file.path}")
        util.rm(file.path)
    
    # if wav file was made, switch file.path back to original file
    file.path = old_path if "old_path" in locals() else file.path
    vprint(f"Processed {file.path} in {time.perf_counter() - start_time:.4f} seconds", 0)
            

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Process audio files.")
    parser.add_argument("-r", "--reprocess", action="store_true", help="Reprocess audio files detected to have already been processed")
    parser.add_argument("-q", "--quiet", action="store_true", help="Don't print anything")
    parser.add_argument("-v", "--verbose", action="count", default=0, help="Print various debugging information")
    parser.add_argument("--split-channels", action="store_true", help="Generate a waveform for each channel instead of merging into 1 waveform")
    parser.add_argument("--auth-token", help="PyAnnote authentication token. Retrieved from the environment variable PYANNOTE_AUTH_TOKEN if not given")
    parser.add_argument("path", nargs="*", help="The path to the file to process. If an audio file, processes the audio file. If a directory, processes every audio file in the directory. If a text file, processes the path on each line")
    args = parser.parse_args()
    args.auth_token = os.environ.get("PYANNOTE_AUTH_TOKEN", args.auth_token)
    if args.auth_token is None:
        raise Exception("To run the diarization and VAD pipelines, you need a PyAnnotate authentication token. Pass it in with the --auth-token option or set the PYANNOTE_AUTH_TOKEN environment variable.")
    start_time = time.perf_counter()
    route_file(*util.namespace_pop(args, "path"), **vars(args))
    if not args.quiet or args.verbose:
        print(f"Processing took a total of {time.perf_counter() - start_time:.4f} seconds")
