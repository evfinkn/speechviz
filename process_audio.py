import pyannote.core.json
from pyannote.audio import Pipeline
import json
import os
import re
import subprocess
import argparse
import random
import librosa
from itertools import chain
import math

random.seed(2)

def process_audio(*args, 
                  scan_dir=True, 
                  reprocess=False, 
                  do_diar=True, 
                  do_vad=True,
                  verbose=False
                 ):
    
    global regex, diar_pipe, vad_pipe  # use global so that variables can be reused
    
    if verbose:
        print()
    
    if len(args) == 0:
        args = [os.getcwd()]  # if no file or directory given, use directory script was called from
    elif len(args) > 1:  # if multiple files (or directories) given, run function on each one
        for arg in args:
            process_audio(arg, scan_dir=scan_dir, reprocess=reprocess, do_diar=do_diar, do_vad=do_vad)
        return  # stop function because all processing done in the function calls in the for loop
    
    file_path = args[0]  # args[0] is--at this point--the only argument in args
    file_dir = os.path.dirname(file_path)  # get the file directory
    file_name, file_ext = os.path.splitext(os.path.basename(file_path)) # get the file name and extension
    
    # if given text file, run the function on each line
    if file_ext == ".txt":
        if verbose:
            print(f"{file_path} is a text file. Running process_audio on each line...")
        with open(file_path) as file:
            for line in file.read().split("\n"):
                process_audio(line, scan_dir=scan_dir, reprocess=reprocess, do_diar=do_diar, do_vad=do_vad)
        return
    
    # run process audio on every file in file_path if it is a dir and scan_dir is True
    elif file_ext == "" and scan_dir:
        ls = subprocess.run(["ls", file_path], stdout=subprocess.PIPE).stdout.decode().split("\n")[:-1]  # get files in dir
        if "audio" in ls:  # if "audio" dir is in file_path, run process_audio on "audio" dir
            process_audio(f"{file_path}/audio", scan_dir=scan_dir, reprocess=reprocess, do_diar=do_diar, do_vad=do_vad)
        else:
            if verbose:
                print(f"{file_path} is a directory. Running process_audio on each file...")
            for file in ls:
                process_audio(f"{file_path}/{file}", scan_dir=False, reprocess=reprocess, do_diar=do_diar, do_vad=do_vad)
        return
    
    # if file_path is a sound file, process it
    elif file_ext.casefold() in (".mp3", ".wav", ".flac", ".ogg", ".opus"):
        # check if output is being split between audio, waveforms, and segments directories
        # and if so, get the base directory for the three subdirectories
        print(f"processing {file_path}")
        separate_dirs = False
        try:
            match = regex.match(file_dir)
        except NameError:  # if (in the try block) regex isn't defined, initialize it and then run it
            regex = re.compile(r".*(?=/audio$)")
            match = regex.match(file_dir)
        finally:
            if match:
                public_dir = match[0]  # public_dir is file_path for the dir containing audio, waveforms, and segments dirs
                if verbose:
                    print(f"Separating files. Public directory path is '{public_dir}'")
                separate_dirs = True 
                
        # filepaths for the waveform and segments files
        json_dir = file_dir if not separate_dirs else f"{public_dir}/waveforms"
        json_path = f"{json_dir}/{file_name}-waveform.json"
        segments_dir = file_dir if not separate_dirs else f"{public_dir}/segments"
        segments_path = f"{segments_dir}/{file_name}-segments.json"
        # check if audio has already been processed and only process if reprocess is passed in as True
        if os.path.exists(json_path) and os.path.exists(segments_path) and not reprocess:
            if verbose:
                print(f"{file_path} has already been processed. To reprocess it, use the '-r' argument")
            return
        
        if verbose:
            print(f"Creating {json_path}")
        subprocess.run(["audiowaveform", "-q", f"-i{file_path}", f"-o{json_path}", "-b", "8"], capture_output=True, check=True)  # create the waveform


        samples, sr = librosa.load(file_path)
        # if the audio isn't in wav format, convert it to wav (pipeline requires wav)
        made_wav = False
        if file_ext != ".wav":
            old_path = file_path
            file_path = f"{file_dir}/{file_name}.wav"
            if verbose:
                print(f"Creating {file_path}")
            subprocess.run(["ffmpeg", "-y", "-loglevel", "fatal", "-i", old_path, file_path], capture_output=True, check=True)
            made_wav = True
            
        segments = []
        
        if do_diar:
            if verbose:
                print("Running the diarization pipeline")
            # run the diarization pipeline
            try:
                diar = diar_pipe(file_path)
            except NameError:  # if the diarization pipeline is not defined, initialize and then run it
                if verbose:
                    print("Initializing diarization pipeline")
                diar_pipe = Pipeline.from_pretrained("pyannote/speaker-diarization")
                diar = diar_pipe(file_path)

            # get snr
            speakers = dict()
            startStop = []
            for turn, _, speaker in diar.itertracks(yield_label=True):
                startStop.append(turn.start)
                startStop.append(turn.end)
                speaker = f"Speaker {int(speaker.split('_')[1]) + 1}"
                if (speakers.get(speaker) == None):
                    speakers[speaker] = []
                    speakers[speaker].append([turn.start, turn.end])
                else:
                    speakers[speaker].append([turn.start, turn.end])
            end = 0
            listSamp = []
            for x in range(0, len(startStop), 2):
                start = int(startStop[x]*sr)
                listSamp.append(samples[end:start].tolist())
                end = int(startStop[x+1]*sr)

            start = int(len(samples)/sr)
            listSamp.append(samples[end:start].tolist())
            flattenListSamp = [j for sub in listSamp for j in sub]

            for x in range(len(flattenListSamp)):
                flattenListSamp[x] *= flattenListSamp[x] #find power

            def rms(list): #give it a list, and it finds the root mean squared
                sum = 0
                for element in list:
                    sum += element ** 2
                if (len(list) != 0):
                    return math.sqrt(sum/(len(list)))
                else:
                    return 0

            rmsOfNoiseNotDB = rms(flattenListSamp)
            noise = rmsOfNoiseNotDB

            def findSpeakerSNR(speakerName):
                speakerSeg = []
                for segmentTup in speakers.get(speakerName):
                    start = int(segmentTup[0] * sr)
                    end = int(segmentTup[1] * sr)
                    speakerSeg.append(samples[start:end].tolist())
                flattenSpeakerSeg = [j for sub in speakerSeg for j in sub]
                return (rms(flattenSpeakerSeg)-noise)/noise
            

            # format the speakers-segments for peaks
            colors = iter(lambda: f"#{random.randrange(255):02x}{random.randrange(255):02x}{random.randrange(255):02x}", 1)
            speakers_json = json.loads(pyannote.core.json.dumps(diar))
            speakers_segments = {}
            speakers_colors = {}   # dictionary to store speaker's colors   key = speaker, value = color
            for segment in speakers_json["content"]:
                start = segment["segment"]["start"]
                end = segment["segment"]["end"]
                speaker = f"Speaker {int(segment['label'].split('_')[1]) + 1}"   # reformat the speaker label to look nicer
                if not speaker in speakers_colors:
                    speakers_colors[speaker] = next(colors)   # each speaker has a color used for all of their segments
                if not speaker in speakers_segments:
                    speakers_segments[speaker] = []
                speakers_segments[speaker].append(
                    {
                        "startTime": start, 
                        "endTime": end, 
                        "color": speakers_colors[speaker], 
                        "labelText": speaker
                    }
                )
            # sort speakers so that index of 'Speaker i' is i - 1
            #ADD SNR IN BETWEEN SPEAKER, SPEAKERS_SEGMENTS,
            speakers_segments = [(speaker, findSpeakerSNR(speaker), speakers_segments[speaker]) for speaker in sorted(speakers_segments)]
            segments.append(("Speakers", speakers_segments))
            
        if do_vad:
            if verbose:
                print("Running the VAD pipeline")
            # run the vad pipeline
            try:
                vad = vad_pipe(file_path)
            except NameError:  # if the vad pipeline is not defined, initialize and then run it
                if verbose:
                    print("Initializing VAD pipeline")
                vad_pipe = Pipeline.from_pretrained("pyannote/voice-activity-detection")
                vad = vad_pipe(file_path)

            duration = librosa.get_duration(y=samples, sr=sr)
            
            # format the vad-segments for peaks
            vad_json = json.loads(pyannote.core.json.dumps(vad))
            vad_times = []
            vad_segments = []
            color = "#5786c9"
            for segment in vad_json["content"]:
                start = segment["segment"]["start"]
                end = segment["segment"]["end"]
                vad_times.append((start, end))
                vad_segments.append(
                    {
                        "startTime": start, 
                        "endTime": end, 
                        "editable": False, 
                        "color": color, 
                        "labelText": "VAD"
                    }
                )
            segments.append(("VAD", vad_segments))

            # create the times for non-vad segments
            non_vad_times = []
            if len(vad_times) == 0:
                non_vad_times.append((0, duration))
            else:
                start_index = 1
                if vad_times[0][0] == 0:
                    start_index = 2
                    if len(vad_times) == 1:
                        if vad_times[0][1] != duration:
                            non_vad_times.append((vad_times[0][1], duration))
                    else:
                        non_vad_times.append((vad_times[0][1], vad_times[1][0]))
                else:
                    non_vad_times.append((0, vad_times[0][0]))
                for i in range(start_index, len(vad_times)):
                    non_vad_times.append((vad_times[i - 1][1], vad_times[i][0]))
                if vad_times[-1][1] != duration:
                    non_vad_times.append((vad_times[-1][1], duration))

            # format the non-vad segments for peaks
            non_vad_segments = []
            color = "#b59896"
            for start, stop in non_vad_times:
                non_vad_segments.append(
                    {
                        "startTime": start, 
                        "endTime": stop, 
                        "editable": False, 
                        "color": color, 
                        "labelText": "Non-VAD"
                    }
                )
            segments.append(("Non-VAD", non_vad_segments))

        # save the segments
        if verbose:
            print(f"Creating {segments_path}")
        with open(segments_path, "w") as file:
            json.dump(segments, file)
            
        # if converted to wav, remove that wav file (since it was only needed for the diarization
        if made_wav:
            print(f"Deleting {file_path}")
            subprocess.run(["rm", "-f", file_path])
            

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Process audio files.")
    parser.add_argument("-r", "--reprocess", action="store_true", help="reprocess audio files detected to have already been processed")
    parser.add_argument("path", nargs="*", help="path to the audio file, directory, or text file")
    args = parser.parse_args()
    process_audio(*args.path, reprocess=args.reprocess)
