# from pyannote.audio import Pipeline
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
# encode faces requirements
from imutils import paths
import face_recognition
import pickle
import cv2
import os
import numpy as np
from PIL import Image
# cluster faces requirements
import shutil
from sklearn.cluster import DBSCAN
from sklearn.cluster import OPTICS
from imutils import build_montages
import os




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


def get_diarization(file_path, samples, sr, verbose):
    # use global pipeline so it doesn't need to be re-initialized (which is time-consuming)
    global diar_pipe, Pipeline

    if not "Pipeline" in globals():
        from pyannote.audio import Pipeline
        
    random.seed(2)
    
    if not "diar_pipe" in globals():  # diar_pipe hasn't been initialized yet
        if verbose:
            print("Initializing diarization pipeline")
        diar_pipe = Pipeline.from_pretrained("pyannote/speaker-diarization@2022.07")
    
    if verbose:
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

    # arrange spkrs_segs so that it's an array of tuples containing a speaker, that speaker's segments, and that speaker's snr
    # i.e. spkrs_segs = [ ("Speaker 1", [...], spkr_1_snr), ("Speaker 2", [...], spkr_2_snr), ... ]
    return ("Speakers", [(spkr, spkrs_segs[spkr], spkrs_snrs[spkr]) for spkr in spkrs])


def get_vad(file_path, duration, verbose):
    # use global pipeline so it doesn't need to be re-initialized (which is time-consuming)
    global vad_pipe, Pipeline
    
    if not "Pipeline" in globals():
        from pyannote.audio import Pipeline
    
    if not "vad_pipe" in globals():  # vad_pipe hasn't been initialized yet
        if verbose:
            print("Initializing VAD pipeline")
        vad_pipe = Pipeline.from_pretrained("pyannote/voice-activity-detection")
    
    if verbose:
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
        print(f"VAD completed in {time.perf_counter() - start_time:.4f} seconds")
        
    return (("VAD", vad_segs), ("Non-VAD", non_vad_segs))


def process_audio(*args, scan_dir=True, reprocess=False, quiet=False, verbose=False, split_channels=False):
    global regex  # use global regex so it doesn't need to be re-initialized
    
    if verbose:
        print()  # to visually separate the output of each call to process_audio
    
    if len(args) == 0:
        args = [os.getcwd()]  # if no file or directory given, use directory script was called from
    elif len(args) > 1:  # if multiple files (or directories) given, run function on each one
        for arg in args:
            process_audio(arg, scan_dir=scan_dir, reprocess=reprocess, quiet=quiet, verbose=verbose, split_channels=split_channels)
        return  # stop function because all processing done in the function calls in the for loop
    
    file_path = args[0]  # args[0] is--at this point--the only argument in args
    file_dir = os.path.dirname(file_path)  # get the file directory
    file_dir = "." if file_dir == "" else file_dir
    file_name, file_ext = os.path.splitext(os.path.basename(file_path)) # get the file name and extension
    
    # if given text file, run the function on each line
    if file_ext == ".txt":
        if verbose:
            print(f"{file_path} is a text file. Running process_audio on the file on each line...")
        with open(file_path) as file:
            for line in file.read().split("\n"):
                process_audio(line, scan_dir=scan_dir, reprocess=reprocess, quiet=quiet, verbose=verbose, split_channels=split_channels)
        return
    
    # run process audio on every file in file_path if it is a dir and scan_dir is True
    elif file_ext == "" and scan_dir:
        ls = subprocess.run(["ls", file_path], stdout=subprocess.PIPE).stdout.decode().split("\n")[:-1]  # get files in dir
        if "audio" in ls:  # if "audio" dir is in file_path, run process_audio on "audio" dir
            if verbose:     
                print(f"Detected audio directory. Running process_audio on {file_path}/audio")
            process_audio(f"{file_path}/audio", scan_dir=scan_dir, reprocess=reprocess, quiet=quiet, verbose=verbose, split_channels=split_channels)
        if "video" in ls:  # if "video" dir is in file_path, run process_audio on "video" dir
            if verbose:
                if "audio" in ls:
                    print()
                print(f"Detected video directory. Running process_audio on {file_path}/video")
            process_audio(f"{file_path}/video", scan_dir=scan_dir, reprocess=reprocess, quiet=quiet, verbose=verbose, split_channels=split_channels)
        if "audio" not in ls and "video" not in ls:
            if verbose:
                print(f"{file_path} is a directory. Running process_audio on each file...")
            for file in ls:
                process_audio(f"{file_path}/{file}", scan_dir=False, reprocess=reprocess, quiet=quiet, verbose=verbose, split_channels=split_channels)
        return
    
    elif file_ext.casefold() in (".mp4", ".mov"):
        if not quiet or verbose:
            print(f"processing {file_path}")
        if verbose:
            print(f"{file_path} is a video. Extracting the audio")
            
        audio_path = f"{file_dir}/{file_name}.wav"
        subprocess.run(["ffmpeg", "-y", "-i", file_path, audio_path], capture_output=not verbose, check=True)
        process_audio(audio_path, reprocess=reprocess, quiet=quiet, verbose=verbose)
        subprocess.run(["rm", "-f", audio_path], capture_output=True)
    
    # if file_path is a sound file, process it
    elif file_ext.casefold() in (".mp3", ".wav", ".flac", ".ogg", ".opus", ".mp4", ".mov"):
        # check if output is being split between audio, waveforms, and segments directories
        # and if so, get the base directory for the three subdirectories
        if not quiet or verbose:
            print(f"processing {file_path}")
            start_time = time.perf_counter()
        
        separate_dirs = False
        if not "regex" in globals():
            regex = re.compile(r".*(?=/(audio|video)$)")    
        match = regex.match(file_dir)
        if match:
            data_dir = match[0]  # data_dir is file_path for the dir containing audio, waveforms, and segments dirs
            if verbose:
                print(f"Separating files into audio, waveforms, and segments directories. Data directory path is '{data_dir}'")
            separate_dirs = True
            subprocess.run(["mkdir", f"{data_dir}/waveforms"], capture_output=True)
            subprocess.run(["mkdir", f"{data_dir}/segments"], capture_output=True)
                
        # filepaths for the waveform, and segments files
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
        if verbose:
            print(f"Creating {json_path}")
        if split_channels:
            subprocess.run(["audiowaveform", f"-i{file_path}", f"-o{json_path}", "-b", "8", "--split-channels"], capture_output=not verbose, check=True)
        else:
            subprocess.run(["audiowaveform", f"-i{file_path}", f"-o{json_path}", "-b", "8"], capture_output=not verbose, check=True)

        # if the audio isn't in wav format, convert it to wav (pipeline requires wav)
        made_wav = False
        if file_ext != ".wav":
            old_path = file_path
            file_path = f"{file_dir}/{file_name}.wav"
            if verbose:
                print(f"Creating {file_path}")
            subprocess.run(["ffmpeg", "-y", "-i", old_path, file_path], capture_output=not verbose, check=True)
            made_wav = True
        
        samples, sr = librosa.load(file_path, sr=None)
        duration = librosa.get_duration(y=samples, sr=sr)
        
        segs = []
        segs.append(get_diarization(file_path, samples, sr, verbose))
        segs.extend(get_vad(file_path, duration, verbose))

        # save the segments
        if verbose:
            print(f"Creating {segs_path}")
        with open(segs_path, "w") as file:
            json.dump(segs, file)
            
        # if converted to wav, remove that wav file (since it was only needed for the diarization
        if made_wav:
            if verbose:
                print(f"Deleting {file_path}")
            subprocess.run(["rm", "-f", file_path], capture_output=True)
        
        if not quiet or verbose:
            # if wav file was made, switch file_path back to original file
            file_path = old_path if "old_path" in locals() else file_path
            print(f"Processed {file_path} in {time.perf_counter() - start_time:.4f} seconds")
            
def encode_faces(images, encode_output, detection_model, images_output):
    # grab the paths to the input images in our dataset, then initialize
    # out data list (which we'll soon populate)
    print("[INFO] quantifying faces...")
    imagePaths = list(paths.list_images(images))
    data = []

    if images_output is not None:
        if not os.path.isdir(images_output):
            os.makedirs(images_output)

    counter = 0	
    # loop over the image paths
    for (i, imagePath) in enumerate(imagePaths):
        # load the input image and convert it from RGB (OpenCV ordering)
        # to dlib ordering (RGB)
        if (i + 1) % 100 == 0:
            print("[INFO] processing image {}/{}".format(i + 1, len(imagePaths)))
            print(imagePath)
        image = cv2.imread(imagePath)
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

        # detect the (x, y)-coordinates of the bounding boxes
        # corresponding to each face in the input image
        boxes = face_recognition.face_locations(rgb, model=detection_model)

        # compute the facial embedding for the face
        encodings = face_recognition.face_encodings(rgb, boxes)

        # build a dictionary of the image path, bounding box location,
        # and facial encodings for the current image
        d = [{"imagePath": imagePath, "loc": box, "encoding": enc}
            for (box, enc) in zip(boxes, encodings)]
        data.extend(d)

        if images_output is not None:
            print("There were {} face(s) in this image.".format(len(boxes)))
            for box in boxes:
                #Print the location of each face in this image
                top, right, bottom, left = box

                face_image = image[top:bottom, left:right]
                pil_image = np.array(Image.fromarray(face_image))
                cv2.imwrite(images_output + "/Num" + str(counter) + ".jpg", pil_image)
                counter += 1

    # dump the facial encodings data to disk
    print("[INFO] serializing encodings...")
    f = open(encode_output, "wb")
    f.write(pickle.dumps(data))
    f.close()

    #call cluster_faces

    #based off of https://pyimagesearch.com/2018/07/09/face-clustering-with-python/


def cluster_faces(encode_input, jobs, epsilon, file_path, reprocess=False):
    # load the serialized face encodings + bounding box locations from
    # disk, then extract the set of encodings to so we can cluster on
    # them
    print("[INFO] loading encodings...")
    data = pickle.loads(open(encode_input, "rb").read())
    data = np.array(data)
    encodings = [d["encoding"] for d in data]

    # cluster the embeddings
    print("[INFO] clustering...")
    #dbscan
    clt = DBSCAN(float(epsilon), metric="euclidean", n_jobs=jobs)

    #uncomment this and recomment clt above, OPTICS is like dbscan but sweeps through different
    #epsilon values, and picks which one it thinks is right. I haven't had success with it but could 
    #be worth a shot later.
    #clt = OPTICS(min_samples=2)
    clt.fit(encodings)

    # determine the total number of unique faces found in the dataset
    labelIDs = np.unique(clt.labels_)
    numUniqueFaces = len(np.where(labelIDs > -1)[0])
    print("[INFO] # unique faces: {}".format(numUniqueFaces))

    #setup the output
    file_dir = os.path.dirname(file_path)  # get the file directory
    file_dir = "." if file_dir == "" else file_dir
    file_name, _ = os.path.splitext(os.path.basename(file_path)) # get the file name and extension
                
    separate_dirs = False
    if not "regex" in globals():
        regex = re.compile(r".*(?=/(audio|video)$)")    
    match = regex.match(file_dir)
    if match:
        data_dir = match[0]  # data_dir is file_path for the dir containing audio, waveforms, and segments dirs
        separate_dirs = True
        subprocess.run(["mkdir", f"{data_dir}/faceClusters"], capture_output=True)

    # filepaths for the waveform, and segments files
    face_dir = file_dir if not separate_dirs else f"{data_dir}/faceClusters"
    face_path = f"{face_dir}/{file_name}"

    # check if audio has already been processed and only process if reprocess is passed in as True
    if os.path.exists(face_path) and not reprocess:
        print(f"{file_path} has already been encoded and clustered. To reprocess it, use the '-r' argument")
        return
    elif os.path.exists(face_path) and reprocess:
        shutil.rmtree(face_path, ignore_errors=True) #delete the folder and then remake it



    # loop over the unique face integers
    for labelID in labelIDs:
        print("[INFO] faces for face ID: {}".format(labelID))
        idxs = np.where(clt.labels_ == labelID)[0]
        faces = []
        if not os.path.isdir(args["outputs"]):
            os.makedirs(args["outputs"])
        # loop over the sampled indexes
        for i in idxs:
            # load the input image and extract the face ROI
            image = cv2.imread(data[i]["imagePath"])
            (top, right, bottom, left) = data[i]["loc"]
            face = image[top:bottom, left:right]
            #resize image so it displays better on speechviz, 
            #https://stackoverflow.com/questions/64609524/resize-an-image-with-a-max-width-and-height-using-opencv
            maxwidth, maxheight = 200, 200
            f1 = maxwidth / face.shape[1]
            f2 = maxheight / face.shape[0]
            f = min(f1, f2)  # resizing factor
            dim = (int(face.shape[1] * f), int(face.shape[0] * f))
            resized = cv2.resize(face, dim)
            

            faces.append(resized)
        counter = 0
        def baseFilePath(faceNum): face_path + "/face" + str(faceNum)
        for face in faces:
            counter += 1
            if not os.path.isdir(baseFilePath(labelID)):
                os.makedirs(baseFilePath(labelID))
            cv2.imwrite(baseFilePath(labelID) + "/Num" + str(counter) + ".jpg", face)

    #built off of https://pyimagesearch.com/2018/07/09/face-clustering-with-python/

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Process audio files.")
    parser.add_argument("-r", "--reprocess", action="store_true", help="Reprocess audio files detected to have already been processed")
    parser.add_argument("-q", "--quiet", action="store_true", help="Don't print anything")
    parser.add_argument("-v", "--verbose", action="store_true", help="Print various debugging information")
    parser.add_argument("--split-channels", action="store_true", help="Generate a waveform for each channel instead of merging into 1 waveform")
    parser.add_argument("path", nargs="*", help="The path to the file to process. If an audio file, processes the audio file. If a directory, processes every audio file in the directory. If a text file, processes the path on each line")
    # encode face args
    parser.add_argument("-i", "--dataset", type=str, required=False,
	    help="path to input directory of faces + images")
    parser.add_argument("-e", "--encodings", type=str, required=False,
        help="path to serialized db of facial encodings")
    parser.add_argument("-d", "--detection-method", type=str, default="cnn",
        help="face detection model to use: either `hog` or `cnn`")
    parser.add_argument("-o", "--outputs", type=str, required=False,
        help="If given, will output detected faces to this folder")
    # cluster face args
    parser.add_argument("-j", "--jobs", type=int, default=-1,
        help="# of parallel jobs to run (-1 will use all CPUs)")
    parser.add_argument("-eps", "--epsilon", default=.4,
        help="Controls how far away points can be from one antoher to still be a cluster. Too small and all will be considered noise, too large and all will be grouped as 1 face.")

    args = parser.parse_args()
    if not args.quiet or args.verbose:
        start_time = time.perf_counter()
    process_audio(*args.path, reprocess=args.reprocess, quiet=args.quiet, verbose=args.verbose, split_channels=args.split_channels)
    if not args.quiet or args.verbose:
        print(f"\nProcessing took a total of {time.perf_counter() - start_time:.4f} seconds")
    #handle encode_faces and cluster_faces
    #gave only one file
    if (len(args.path) == 1):
        file_path = args[0]  # args[0] is--at this point--the only argument in args
        file_dir = os.path.dirname(file_path)  # get the file directory
        file_dir = "." if file_dir == "" else file_dir
        file_name, file_ext = os.path.splitext(os.path.basename(file_path)) # get the file name and extension
        if args.dataset and (file_ext == ".mp4" or file_ext == ".mov"):
            encode_faces(images=args.dataset, encode_output=args.encodings,
                        detection_model=args["detection-method"], images_output=args.outputs)
            cluster_faces(encode_input=args.encodings, jobs=args.jobs, epsilon=args.epsilon,
                          file_path=file_path, reprocess=args.reprocess)

        
