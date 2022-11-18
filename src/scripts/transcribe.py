import os
import re
import json
import time
import argparse
import subprocess
from itertools import groupby

# import torch
# import librosa
# from transformers import Wav2Vec2Processor, Wav2Vec2ForCTC

import util

SAMPLE_RATE = 16000
SAMPLE_INTERVAL_STEP = 30 * SAMPLE_RATE
MODEL_NAME = "facebook/wav2vec2-large-960h"

lazies_imported = False  # set to True when slower imports have been imported in transcribe()


def route_file(*args, verbose=0, scan_dir=True, **kwargs):
    if verbose:
        print()  # to visually separate the output of each call to process_audio
    
    if len(args) == 0:
        args = [os.getcwd()]  # if no file or directory given, use directory script was called from
    elif len(args) > 1:  # if multiple files (or directories) given, run function on each one
        for arg in args:
            route_file(arg, verbose=verbose, scan_dir=scan_dir, **kwargs)
        return  # stop function because all processing done in the function calls in the for loop
    
    path = args[0]  # args[0] is--at this point--the only argument in args
    file = util.FileInfo(path)
    
    # if given text file, run the function on each line
    if file.ext.casefold() == ".txt":
        if verbose:
            print(f"{file.path} is a text file. Running process_audio on the file on each line...")
        with open(file.path) as txtfile:
            for line in txtfile.read().split("\n"):
                route_file(line, verbose=verbose, scan_dir=scan_dir, **kwargs)

    # run process audio on every file in file.path if it is a dir and scan_dir is True
    elif file.ext == "" and scan_dir:
        ls = subprocess.run(["ls", file.path], stdout=subprocess.PIPE).stdout.decode().split("\n")[:-1]  # get files in dir
        if "audio" in ls:  # if "audio" dir is in file.path, run route_file on "audio" dir
            if verbose:
                print(f"Detected audio directory. Routing {file.path}/audio")
            route_file(f"{file.path}/audio", verbose=verbose, scan_dir=scan_dir, **kwargs)
        if "video" in ls:  # if "video" dir is in file.path, run route_file on "video" dir
            if verbose:
                if "audio" in ls:
                    print()  # visually separate audio and video sections
                print(f"Detected video directory. Routing {file.path}/video")
            route_file(f"{file.path}/video", verbose=verbose, scan_dir=scan_dir, **kwargs)
        if "audio" not in ls and "video" not in ls:
            if verbose:
                print(f"{file.path} is a directory. Routing each file...")
            for dir_file in ls:
                route_file(f"{file.path}/{dir_file}", verbose=verbose, scan_dir=False, **kwargs)
    
    elif file.ext.casefold() in (".mp3", ".wav", ".flac", ".ogg", ".opus", ".mp4", ".mov"):
        transcribe(file, verbose=verbose, **kwargs)
        
        
def get_data_dir(file_dir):  # data_dir is path to the dir containing vrs and graphical dirs
    global regex  # use global regex so it doesn't need to be re-initialized
    if not "regex" in globals():
        regex = re.compile(r".*(?=/(audio|video)$)")
        
    match = regex.match(file_dir)
    data_dir = match[0] if match else None
    return data_dir
    

def transcribe(file, reprocess=False, quiet=False, verbose=0):
    global lazies_imported, torch, librosa, wav2vec2_processor, wav2vec2_model
    
    if not quiet or verbose:
        print(f"Transcribing {file.path}")
        start_time = time.perf_counter()
        
    data_dir = get_data_dir(file.dir)
    if data_dir:
        if verbose:
            print(f"Data directory path is '{data_dir}'")
        output_dir = f"{data_dir}/transcriptions"
        subprocess.run(["mkdir", output_dir], capture_output=True)  # ensure output_dir exists
    else:
        output_dir = file.dir
    
    output_path = f"{output_dir}/{file.name}-words.json"
    # check if file has already been processed and only process if reprocess True
    if os.path.exists(output_path) and not reprocess:
        if not quiet or verbose:
            print(f"{file.path} has already been processed. To reprocess it, use the '-r' argument")
        return
    
    wav_path = f"{file.dir}/{file.name}-resampled.wav"
    wav_file = util.FileInfo(wav_path)
    if verbose:
        print(f"Creating resampled audio file {wav_file.path}")
        resample_start_time = time.perf_counter()
    subprocess.run(["ffmpeg", "-y", "-i", file.path, "-ac", "1", "-ar", str(SAMPLE_RATE), wav_file.path],
                   capture_output=verbose < 2, check=True)
    if verbose:
        time_taken = time.perf_counter() - resample_start_time
        print(f"Resampled audio in {time_taken:.4f} seconds")

    if not lazies_imported:  # slower imports need imported, model needs initialized
        if verbose:
            print("Importing and initializing model")
            import_start_time = time.perf_counter()
            
        import torch
        import librosa
        from transformers import Wav2Vec2Processor, Wav2Vec2ForCTC
        wav2vec2_processor = Wav2Vec2Processor.from_pretrained(MODEL_NAME)
        wav2vec2_model = Wav2Vec2ForCTC.from_pretrained(MODEL_NAME).cuda()
        
        if verbose:
            time_taken = time.perf_counter() - import_start_time
            print(f"Imported and initialized model in {time_taken:.4f} seconds")
    
    data, _ = librosa.load(wav_file.path, sr=None)  # no need to set sr because already resampled
    
    if verbose:
        print("Running main loop")
        loop_start_time = time.perf_counter()
    
    delim_token_id = wav2vec2_processor.tokenizer.word_delimiter_token_id
    words_objects = []
    for sample_offset in range(0, len(data), SAMPLE_INTERVAL_STEP):
        # https://github.com/huggingface/transformers/issues/11307#issuecomment-1107713461

        # run audio through model
        stop_sample = min(sample_offset + SAMPLE_INTERVAL_STEP, len(data))
        speech = data[sample_offset:stop_sample]
        input_values = wav2vec2_processor(speech, sampling_rate=SAMPLE_RATE, return_tensors="pt").input_values.cuda()

        with torch.no_grad():
            logits = wav2vec2_model(input_values).logits

        predicted_ids = torch.argmax(logits, dim=-1)
        transcription = wav2vec2_processor.decode(predicted_ids[0]).lower()

        # this is where the logic starts to get the start and end timestamp for each word
        words = [w for w in transcription.split(' ') if len(w) > 0]
        predicted_ids = predicted_ids[0].tolist()
        duration_sec = input_values.shape[1] / SAMPLE_RATE


        ids_w_time = [(i / len(predicted_ids) * duration_sec, _id) for i, _id in enumerate(predicted_ids)]
        # remove entries which are just "padding" (i.e. no characers are recognized)
        ids_w_time = [i for i in ids_w_time if i[1] != wav2vec2_processor.tokenizer.pad_token_id]
        # now split the ids into groups of ids where each group represents a word
        split_ids_w_time = [list(group) for k, group
                            in groupby(ids_w_time, lambda x: x[1] == delim_token_id) if not k]

        # make sure that there are the same number of id-groups as words. Otherwise something is wrong
        if len(split_ids_w_time) != len(words) and (not quiet or verbose):
            print(f"something went wrong for sample window {sample_offset} - {stop_sample} "
                  + f"(time window {librosa.samples_to_time(sample_offset, sr=SAMPLE_RATE)}"
                  + f" - {librosa.samples_to_time(stop_sample, sr=SAMPLE_RATE)})")
            print(f"len(split_ids_w_time) == {len(split_ids_w_time)} != {len(words)} == len(words)")
            continue
        # assert (lsidswt := len(split_ids_w_time)) == (lw := len(words)), f"{lsidswt} != {lw}\n\n{split_ids_w_time}\n\n{words}"  

        word_start_times = []
        word_end_times = []
        for cur_ids_w_time, cur_word in zip(split_ids_w_time, words):
            _times = [_time for _time, _id in cur_ids_w_time]
            word_start_times.append(min(_times))
            word_end_times.append(max(_times))

        time_offset = librosa.samples_to_time(sample_offset, sr=SAMPLE_RATE)
        for i in range(len(words)):
            words_objects.append({"labelText": words[i], 
                                  "time": time_offset + float(word_start_times[i]), 
                                  "color": "#00000000"})
            
    if verbose:
        time_taken = time.perf_counter() - loop_start_time
        print(f"Main loop finished in {time_taken:.4f} seconds")
        print(f"Writing {output_path}")
            
    with open(output_path, "w") as output_file:
        json.dump(words_objects, output_file)
    
    if verbose:
        print(f"Deleting {wav_file.path}")
    subprocess.run(["rm", "-r", "-f", wav_file.path], capture_output=True)
    
    if not quiet or verbose:
        time_taken = time.perf_counter() - start_time
        print(f"Transcribed {file.path} in {time_taken:.4f} seconds")

    
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Transcribe audio and video files.")
    parser.add_argument("path", 
                        nargs="*", 
                        help="The path to the file to process. If an audio or "
                             "video file, processes the VRS file. If a directory, "
                             "processes every audio and video file in the directory. "
                             "If a text file, processes the path on each line")
    parser.add_argument("-r", "--reprocess", 
                        action="store_true", 
                        help="Retranscribe files detected to have already been transcribed")
    parser.add_argument("-q", "--quiet", 
                        action="store_true", 
                        help="Don't print anything")
    parser.add_argument("-v", "--verbose", 
                        action="count", 
                        default=0, 
                        help="Print various debugging information")
    
    args = parser.parse_args()
    if not args.quiet or args.verbose:
        start_time = time.perf_counter()
    route_file(*args.path, 
               reprocess=args.reprocess, 
               quiet=args.quiet, 
               verbose=args.verbose)
    if not args.quiet or args.verbose:
        time_taken = time.perf_counter() - start_time
        print(f"Transcribing took a total of {time_taken:.4f} seconds")
