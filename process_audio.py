from signal import signal
from pyannote.audio import Pipeline
import numpy as np
import librosa
import json
import os
import re
import subprocess
import argparse
import random
import math
import time


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
    return [{"startTime": start, "endTime": end, "color": color, "labelText": label} for start, end in comp_times]


def rms(powers):  # give it a list, and it finds the root mean squared
    return np.sqrt(np.mean(np.square(powers), axis=-1))


def snr(signal, noise):
    signal_rms = rms(signal) if not isinstance(signal, float) else signal
    #noise_rms = rms(noise) if not isinstance(noise, float) else noise
    noise_rms = noise
    print("Signal RMS is " + str(signal_rms))
    print("Noise RMS is " + str(noise_rms))
    return (signal_rms - noise_rms) / noise_rms


def get_noise_times(signal_times, noise_times):
    adjacent_noise = []    
    for start, stop in signal_times:
        left=noise_times[0]
        right=noise_times[1]
        for noiseSegTuple in noise_times:
            print(noiseSegTuple)
            if abs(noiseSegTuple[0] - start) < left[1] - start:
                left = noiseSegTuple
                print("the signal time is: " + str(start))
                print("the new left noise is: " + str(left))
            if abs(noiseSegTuple[1] - stop) < right[0] - stop:
                right = noiseSegTuple
                print("the signal time is: " + str(stop))
                print("the new right noise is:" + str(right))
        #left = (np.abs(noise_times - start)).argmin()
        #right = (np.abs(noise_times - stop)).argmin()
        #if right == left:
            #right += 1
        adjacent_noise.append(left)
        adjacent_noise.append(right)
    adjacent_noise = np.asarray(adjacent_noise)
    return adjacent_noise
        


def samples_from_times(times, samples, sr):
    indices = (np.array(times) * sr).astype(int)
    samps = np.empty(np.sum(np.clip(indices[:, 1] - indices[:, 0], 0, None)))
    offset = 0
    for start, stop in indices:
        to = offset + stop - start if stop - start >= 0 else offset
        samps[offset:to] = samples[start:stop]
        offset = to
    return samps


def snr_from_times(signal_times, samples, sr, *, noise_times):
    signal_samps = samples_from_times(signal_times, samples, sr)
    signal_powers = np.square(signal_samps)
    adjacent_noise = get_noise_times(signal_times, noise_times)
    noise_samps = samples_from_times(adjacent_noise, samples, sr)
    noise_rms = rms(noise_samps)
    return snr(signal_powers, noise_rms)


def get_diarization(file_path, samples, sr, quiet, verbose):
    global diar_pipe  # use global pipeline so it doesn't need to be re-initialized (which is time-consuming)
    
    random.seed(2)
    
    if not "diar_pipe" in globals():  # diar_pipe hasn't been initialized yet
        if not quiet or verbose:
            print("Initializing diarization pipeline")
        diar_pipe = Pipeline.from_pretrained("pyannote/speaker-diarization")
    if not quiet or verbose:
        print("Running the diarization pipeline")
        start_time = time.perf_counter()
    diar = diar_pipe(file_path)
    if verbose:
        print(f"Diarization pipeline completed in {time.perf_counter() - start_time:.4f} seconds")
        print("Looping through the annotations")
        loop_start_time = time.perf_counter()
        

    # format the speakers segments for peaks
    colors = iter(lambda: f"#{random.randrange(255):02x}{random.randrange(255):02x}{random.randrange(255):02x}", 1)
    spkrs_colors = {}   # dictionary to store speaker's colors   key = speaker, value = color
    spkrs_segs = {}
    spkrs_times = {}
    diar_times = []
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
    
    if verbose:
        print(f"Loop completed in {(time.perf_counter() - loop_start_time) * 1000:.4f} milliseconds")
        print("Calculating SNRs")
        snr_start_time = time.perf_counter()
    
    #for key in spkrs_times:

    noise_times = get_complement_times(diar_times, len(samples) / sr)
    #noise_samps = samples_from_times(noise_times, samples, sr)
    #noise_powers = np.square(noise_samps)
    #noise_rms = rms(noise_powers)
    spkrs_snrs = {spkr: snr_from_times(spkrs_times[spkr], samples, sr, noise_times=noise_times) for spkr in spkrs}
    
    if verbose:
        print(f"SNRs calculated in {(time.perf_counter() - snr_start_time) * 1000:.4f} milliseconds")
    
    if not quiet or verbose:
        print(f"Diarization completed in {time.perf_counter() - start_time:.4f} seconds")

    # arrange spkrs_segs so that it's an array of tuples containing a speaker, that speaker's segments, and that speaker's snr
    # i.e. spkrs_segs = [ ("Speaker 1", [...], spkr_1_snr), ("Speaker 2", [...], spkr_2_snr), ... ]
    return ("Speakers", [(spkr, spkrs_segs[spkr], spkrs_snrs[spkr]) for spkr in spkrs])


def get_vad(file_path, duration, quiet, verbose):
    global vad_pipe  # use global pipeline so it doesn't need to be re-initialized (which is time-consuming)
    
    if not "vad_pipe" in globals():  # vad_pipe hasn't been initialized yet
        if not quiet or verbose:
            print("Initializing VAD pipeline")
        vad_pipe = Pipeline.from_pretrained("pyannote/voice-activity-detection")
    if not quiet or verbose:
        print("Running the VAD pipeline")
        start_time = time.perf_counter()
    vad = vad_pipe(file_path)
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
        
    if not quiet or verbose:
        print(f"VAD completed in {time.perf_counter() - start_time:.4f} seconds")
        
    return (("VAD", vad_segs), ("Non-VAD", non_vad_segs))


def process_audio(*args, scan_dir=True, reprocess=False, quiet=False, verbose=False):
    global regex  # use global regex so it doesn't need to be re-initialized
    
    if not quiet or verbose:
        print()  # to visually separate the output of each call to process_audio
    
    if len(args) == 0:
        args = [os.getcwd()]  # if no file or directory given, use directory script was called from
    elif len(args) > 1:  # if multiple files (or directories) given, run function on each one
        for arg in args:
            process_audio(arg, scan_dir=scan_dir, reprocess=reprocess, quiet=quiet, verbose=verbose)
        return  # stop function because all processing done in the function calls in the for loop
    
    file_path = args[0]  # args[0] is--at this point--the only argument in args
    file_dir = os.path.dirname(file_path)  # get the file directory
    file_dir = "." if file_dir == "" else file_dir
    file_name, file_ext = os.path.splitext(os.path.basename(file_path)) # get the file name and extension
    
    # if given text file, run the function on each line
    if file_ext == ".txt":
        if not quiet or verbose:
            print(f"{file_path} is a text file. Running process_audio on each line...")
        with open(file_path) as file:
            for line in file.read().split("\n"):
                process_audio(line, scan_dir=scan_dir, reprocess=reprocess, quiet=quiet, verbose=verbose)
        return
    
    # run process audio on every file in file_path if it is a dir and scan_dir is True
    elif file_ext == "" and scan_dir:
        ls = subprocess.run(["ls", file_path], stdout=subprocess.PIPE).stdout.decode().split("\n")[:-1]  # get files in dir
        if "audio" in ls:  # if "audio" dir is in file_path, run process_audio on "audio" dir
            process_audio(f"{file_path}/audio", scan_dir=scan_dir, reprocess=reprocess, quiet=quiet, verbose=verbose)
        else:
            if not quiet or verbose:
                print(f"{file_path} is a directory. Running process_audio on each file...")
            for file in ls:
                process_audio(f"{file_path}/{file}", scan_dir=False, reprocess=reprocess, quiet=quiet, verbose=verbose)
        return
    
    # if file_path is a sound file, process it
    elif file_ext.casefold() in (".mp3", ".wav", ".flac", ".ogg", ".opus"):
        # check if output is being split between audio, waveforms, and segments directories
        # and if so, get the base directory for the three subdirectories
        if not quiet or verbose:
            print(f"processing {file_path}")
            start_time = time.perf_counter()
        
        separate_dirs = False
        if not "regex" in globals():
            regex = re.compile(r".*(?=/audio$)")    
        match = regex.match(file_dir)
        if match:
            data_dir = match[0]  # data_dir is file_path for the dir containing audio, waveforms, and segments dirs
            if not quiet or verbose:
                print(f"Separating files into audio, waveforms, and segments directories. Data directory path is '{data_dir}'")
            separate_dirs = True
            subprocess.run(["mkdir", f"{data_dir}/waveforms"], capture_output=True)
            subprocess.run(["mkdir", f"{data_dir}/segments"], capture_output=True)
                
        # filepaths for the waveform and segments files
        json_dir = file_dir if not separate_dirs else f"{data_dir}/waveforms"
        json_path = f"{json_dir}/{file_name}-waveform.json"
        segs_dir = file_dir if not separate_dirs else f"{data_dir}/segments"
        segs_path = f"{segs_dir}/{file_name}-segments.json"
        # check if audio has already been processed and only process if reprocess is passed in as True
        if os.path.exists(json_path) and os.path.exists(segs_path) and not reprocess:
            if not quiet or verbose:
                print(f"{file_path} has already been processed. To reprocess it, use the '-r' argument")
            return
        
        # create the waveform
        if not quiet or verbose:
            print(f"Creating {json_path}")
        subprocess.run(["audiowaveform", f"-i{file_path}", f"-o{json_path}", "-b", "8"], capture_output=not verbose, check=True)

        # if the audio isn't in wav format, convert it to wav (pipeline requires wav)
        made_wav = False
        if file_ext != ".wav":
            old_path = file_path
            file_path = f"{file_dir}/{file_name}.wav"
            if not quiet or verbose:
                print(f"Creating {file_path}")
            subprocess.run(["ffmpeg", "-y", "-i", old_path, file_path], capture_output=not verbose, check=True)
            made_wav = True
        
        samples, sr = librosa.load(file_path, sr=None)
        duration = librosa.get_duration(y=samples, sr=sr)
        
        segs = []
        segs.append(get_diarization(file_path, samples, sr, quiet, verbose))
        segs.extend(get_vad(file_path, duration, quiet, verbose))

        # save the segments
        if not quiet or verbose:
            print(f"Creating {segs_path}")
        with open(segs_path, "w") as file:
            json.dump(segs, file)
            
        # if converted to wav, remove that wav file (since it was only needed for the diarization
        if made_wav:
            if not quiet or verbose:
                print(f"Deleting {file_path}")
            subprocess.run(["rm", "-f", file_path], capture_output=True)
        
        if not quiet or verbose:
            print(f"Processed {old_path if 'old_path' in locals() else file_path} in {time.perf_counter() - start_time:.4f} seconds")
            

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Process audio files.")
    parser.add_argument("-r", "--reprocess", action="store_true", help="Reprocess audio files detected to have already been processed")
    parser.add_argument("-q", "--quiet", action="store_true", help="Don't print anything")
    parser.add_argument("-v", "--verbose", action="store_true", help="Print various debugging information")
    parser.add_argument("path", nargs="*", help="The path to the file to process. If an audio file, processes the audio file. If a directory, processes every audio file in the directory. If a text file, processes the path on each line")
    args = parser.parse_args()
    if not args.quiet or args.verbose:
        start_time = time.perf_counter()
    process_audio(*args.path, reprocess=args.reprocess, quiet=args.quiet, verbose=args.verbose)
    if not args.quiet or args.verbose:
        print(f"\nProcessing took a total of {time.perf_counter() - start_time:.4f} seconds")
