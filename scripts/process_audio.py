import os
import re
import math
import json
import time
import argparse
import subprocess

import numpy as np
import librosa

import util


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
        return math.sqrt(squares_sum / (len(powers)))
    else:
        return 0


def snr(signal, noise):
    signal_rms = rms(signal) if not isinstance(signal, float) else signal
    noise_rms = rms(noise) if not isinstance(noise, float) else noise
    print("Signal RMS is " + str(signal_rms))
    print("Noise RMS is " + str(noise_rms))
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


def snr_from_times(signal_times, samples, sr, *, noise_rms=None):
    signal_samps = samples_from_times(signal_times, samples, sr)
    signal_powers = np.square(signal_samps)
    if noise_rms is None:
        noise_samps = samples_from_times(get_complement_times(signal_times, len(samples) / sr), samples, sr)
        noise_powers = np.square(noise_samps)
        noise_rms = rms(noise_powers)
    return snr(signal_powers, noise_rms)


def get_diarization(file, auth_token, samples, sr, verbose=0):
    # use global pipeline so it doesn't need to be re-initialized (which is time-consuming)
    global diar_pipe, Pipeline

    if not "Pipeline" in globals():
        from pyannote.audio import Pipeline
    
    if not "diar_pipe" in globals():  # diar_pipe hasn't been initialized yet
        if verbose:
            print("Initializing diarization pipeline")
        diar_pipe = Pipeline.from_pretrained("pyannote/speaker-diarization@2.1", use_auth_token=auth_token)
    
    if verbose:
        print("Running the diarization pipeline")
        start_time = time.perf_counter()
    diar = diar_pipe(file.path)
    if verbose:
        print(f"Diarization pipeline completed in {time.perf_counter() - start_time:.4f} seconds")
        print("Looping through the annotations")
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

    if verbose:
        print(f"Loop completed in {(time.perf_counter() - loop_start_time) * 1000:.4f} milliseconds")
        print("Calculating SNRs")
        snr_start_time = time.perf_counter()
    
    noise_times = get_complement_times(diar_times, len(samples) / sr)
    noise_samps = samples_from_times(noise_times, samples, sr)
    noise_powers = np.square(noise_samps)
    noise_rms = rms(noise_powers)
    spkrs_snrs = {spkr: snr_from_times(spkrs_times[spkr], samples, sr, noise_rms=noise_rms) for spkr in spkrs}
    
    if verbose:
        print(f"SNRs calculated in {(time.perf_counter() - snr_start_time) * 1000:.4f} milliseconds")
        print(f"Diarization completed in {time.perf_counter() - start_time:.4f} seconds")

    # TODO: Change this to return a dict and then change viz.js to take a dict
    # because this is confusing. It could be something like:
    # {"type": "GroupOfGroups", name="Speakers", children=[{"type": "Group", ...}, ...]}
    # arrange spkrs_segs so that it's an array of tuples containing a speaker, that speaker's segments, and that speaker's snr
    # i.e. spkrs_segs = [ ("Speaker 1", [...], spkr_1_snr), ("Speaker 2", [...], spkr_2_snr), ... ]
    return ("Speakers", [(spkr, spkrs_segs[spkr], spkrs_snrs[spkr]) for spkr in spkrs])


def get_vad(file, auth_token, duration, verbose=0):
    # use global pipeline so it doesn't need to be re-initialized (which is time-consuming)
    global vad_pipe, Pipeline
    
    if not "Pipeline" in globals():
        from pyannote.audio import Pipeline
    
    if not "vad_pipe" in globals():  # vad_pipe hasn't been initialized yet
        if verbose:
            print("Initializing VAD pipeline")
        vad_pipe = Pipeline.from_pretrained("pyannote/voice-activity-detection", use_auth_token=auth_token)
    
    if verbose:
        print("Running the VAD pipeline")
        start_time = time.perf_counter()
    vad = vad_pipe(file.path)
    if verbose:
        print(f"VAD pipeline completed in {time.perf_counter() - start_time:.4f} seconds")
        print("Looping through the annotations")
        loop_start_time = time.perf_counter()

    # format the vad segments for peaks
    vad_segs = []
    vad_times = []
    for turn, _ in vad.itertracks():
        start = turn.start
        end = turn.end
        vad_segs.append(format_segment(start, end, "#5786c9", "VAD"))
        vad_times.append((start, end))
        
    if verbose:
        print(f"Loop completed in {(time.perf_counter() - loop_start_time) * 1000:.4f} milliseconds")
        print("Creating the non-VAD segments")
        non_vad_start_time = time.perf_counter()
        
    non_vad_segs = get_complement_segments(vad_segs, duration, "#b59896", "Non-VAD", times=vad_times)
    
    if verbose:
        print(f"Non-VAD created in {(time.perf_counter() - non_vad_start_time) * 1000:.4f} milliseconds")
        print(f"VAD completed in {time.perf_counter() - start_time:.4f} seconds")
        
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
    
    # if given text file, run the function on each line
    if file.ext == ".txt":
        if verbose:
            print(f"{file.path} is a text file. Running process_audio on the file on each line...")
        with open(file.path) as txtfile:
            for line in txtfile.read().split("\n"):
                route_file(line, verbose=verbose, scan_dir=scan_dir, **kwargs)
        return
    
    # run process audio on every file in file.path if it is a dir and scan_dir is True
    elif file.ext == "" and scan_dir:
        ls = subprocess.run(["ls", file.path], stdout=subprocess.PIPE).stdout.decode().split("\n")[:-1]  # get files in dir
        if "audio" in ls:  # if "audio" dir is in file.path, run process_audio on "audio" dir
            if verbose:
                print(f"Detected audio directory. Running process_audio on {file.path}/audio")
            route_file(f"{file.path}/audio", verbose=verbose, scan_dir=scan_dir, **kwargs)
        if "video" in ls:  # if "video" dir is in file.path, run process_aduio on "video" dir
            if verbose:
                print(f"Detected video directory. Running process_audio on {file.path}/video")
            route_file(f"{file.path}/video", verbose=verbose, scan_dir=scan_dir, **kwargs)
        if "audio" not in ls and "video" not in ls:
            if verbose:
                print(f"{file.path} is a directory. Running process_audio on each file...")
            for dir_file in ls:
                route_file(f"{file.path}/{dir_file}", verbose=verbose, scan_dir=False, **kwargs)
    
    elif file.ext.casefold() in (".mp4", ".mov"):
        if verbose:
            print(f"{file.path} is a video. Extracting the audio")
            
        audio_path = f"{file.dir}/{file.name}.wav"
        subprocess.run(["ffmpeg", "-y", "-i", file.path, audio_path], capture_output=verbose < 2, check=True)
        # could just call process_audio directly on audio_path, but I think it makes more sense
        # to have the next elif statement be the only place process_audio is called
        # FIXME: actually I'm fairly certain this whole elif block can be deleted
        # process_audio converts to wav already
        route_file(audio_path, verbose=verbose, scan_dir=scan_dir, **kwargs)
        subprocess.run(["rm", "-f", audio_path], capture_output=True)
    
    # if file.path is a sound file, process it
    elif file.ext.casefold() in (".mp3", ".wav", ".flac", ".ogg", ".opus", ".mp4", ".mov"):
        process_audio(file, verbose=verbose, **kwargs)


def process_audio(file, auth_token, reprocess=False, quiet=False, verbose=0, split_channels=False):
    global regex  # use global regex so it doesn't need to be re-initialized
    
    # check if output is being split between audio, waveforms, and segments directories
    # and if so, get the base directory for the three subdirectories
    if not quiet or verbose:
        print(f"processing {file.path}")
        start_time = time.perf_counter()
    
    separate_dirs = False
    if not "regex" in globals():
        regex = re.compile(r".*(?=/(audio|video)$)")    
    match = regex.match(file.dir)
    if match:
        data_dir = match[0]  # data_dir is file.path for the dir containing audio, waveforms, and segments dirs
        if verbose:
            print(f"Separating files into audio, waveforms, and segments directories. Data directory path is '{data_dir}'")
        separate_dirs = True
        subprocess.run(["mkdir", f"{data_dir}/waveforms"], capture_output=True)
        subprocess.run(["mkdir", f"{data_dir}/segments"], capture_output=True)
            
    # filepaths for the waveform, and segments files
    waveform_dir = file.dir if not separate_dirs else f"{data_dir}/waveforms"
    waveform_path = f"{waveform_dir}/{file.name}-waveform.json"
    segs_dir = file.dir if not separate_dirs else f"{data_dir}/segments"
    segs_path = f"{segs_dir}/{file.name}-segments.json"

    # only recreate the waveform if it doesn't already exist
    if os.path.exists(waveform_path) and not reprocess:
        if verbose:
            print(f"{waveform_path} already exists. To recreate it, use the -r argument")
    else: # create the waveform
        if verbose:
            print(f"Creating {waveform_path}")
        if split_channels:
            subprocess.run(["audiowaveform", f"-i{file.path}", f"-o{waveform_path}", "-b", "8", "--split-channels"], capture_output=verbose < 2, check=True)
        else:
            subprocess.run(["audiowaveform", f"-i{file.path}", f"-o{waveform_path}", "-b", "8"], capture_output=verbose < 2, check=True)

    # check if audio has already been processed and only process if reprocess is passed in as True
    if os.path.exists(segs_path) and not reprocess:
        if not quiet or verbose:
            print(f"{file.path} has already been processed. To reprocess it, use the '-r' argument")
        return

    # if the audio isn't in wav format, convert it to wav (pipeline requires wav)
    made_wav = False
    if file.ext != ".wav":
        old_path = file.path
        file.path = f"{file.dir}/{file.name}.wav"
        if verbose:
            print(f"Creating {file.path}")
        subprocess.run(["ffmpeg", "-y", "-i", old_path, file.path], capture_output=verbose < 2, check=True)
        made_wav = True
    
    samples, sr = librosa.load(file.path, sr=None)
    duration = librosa.get_duration(y=samples, sr=sr)
    
    segs = []
    segs.append(get_diarization(file, auth_token, samples, sr, verbose))
    segs.extend(get_vad(file, auth_token, duration, verbose))

    # save the segments
    if verbose:
        print(f"Creating {segs_path}")
    with open(segs_path, "w") as segs_file:
        json.dump(segs, segs_file)
        
    # if converted to wav, remove that wav file (since it was only needed for the diarization
    if made_wav:
        if verbose:
            print(f"Deleting {file.path}")
        subprocess.run(["rm", "-f", file.path], capture_output=True)
    
    if not quiet or verbose:
        # if wav file was made, switch file.path back to original file
        file.path = old_path if "old_path" in locals() else file.path
        print(f"Processed {file.path} in {time.perf_counter() - start_time:.4f} seconds")
            

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
    if not args.quiet or args.verbose:
        start_time = time.perf_counter()
    route_file(*util.namespace_pop(args, "path"), **vars(args))
    if not args.quiet or args.verbose:
        print(f"\nProcessing took a total of {time.perf_counter() - start_time:.4f} seconds")
