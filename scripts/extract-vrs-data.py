import os
import re
import csv
import json
import time
import argparse
import subprocess

import numpy as np

import util

DATA_TYPES = {  # numpy data types corresponding to data types in the VRS metadata
    "DataPieceValue<uint32_t>": np.uint32, 
    "DataPieceValue<uint64_t>": np.uint64, 
    "DataPieceValue<int32_t>": np.int32, 
    "DataPieceValue<int64_t>": np.int64, 
    "DataPieceValue<float>": np.float32, 
    "DataPieceValue<double>": np.float64, 
    "DataPieceValue<Bool>": np.bool8, 
    "DataPieceValue<Point3Df>": np.dtype((np.float32, 3)), 
    "DataPieceArray<uint32_t>": lambda size: np.dtype((np.uint32, size)), 
    "DataPieceArray<uint64_t>": lambda size: np.dtype((np.uint64, size)), 
    "DataPieceArray<int32_t>": lambda size: np.dtype((np.int32, size)), 
    "DataPieceArray<int64_t>": lambda size: np.dtype((np.float32, size)), 
    "DataPieceArray<float>": lambda size: np.dtype((np.float32, size)), 
    "DataPieceArray<double>": lambda size: np.dtype((np.float64, size)), 
    "DataPieceArray<Bool>": lambda size: np.dtype((np.bool8, size)), 
}
STREAM_NAMES = {  # used to get the file name from a stream id
    "211-1": "camera-eye-tracking", 
    "214-1": "camera-rgb", 
    "231-1": "microphones", 
    "247-1": "barometer", 
    "281-1": "gps", 
    "282-1": "wifi", 
    "283-1": "bluetooth", 
    "285-1": "time", 
    "1201-1": "camera-slam-left", 
    "1201-2": "camera-slam-right", 
    "1202-1": "imu-right", 
    "1202-2": "imu-left", 
    "1203-1": "magnetometer", 
}
STREAM_UNITS = {  # dicts containing the units of the sensor's measurements
    # "211-1": {}, # "214-1": {}, # "231-1": {}, 
    "247-1": {"temperature": "deg. C", "pressure": "Pa"}, 
    "281-1": {"latitude": "dec. deg.", "latitude": "dec. deg.", "altitude": "m"}, 
    # "282-1": {}, # "283-1": {}, # "285-1": {}, # "1201-1": {}, # "1201-2": {}, 
    "1202-1": {"accelerometer": "m/s^2", "gyroscope": "rad/s"}, 
    "1202-2": {"accelerometer": "m/s^2", "gyroscope": "rad/s"}, 
    "1203-1": {"magnetometer": "T"}, 
}
STREAM_DATA_TO_OUTPUT = {  # what fields from the data of the streams should be saved
    # values are tuples instead of sets to ensure order is maintained
    # "211-1": (), # "214-1": (), # "231-1": (), 
    "247-1": ("capture_timestamp_ns", "temperature", "pressure"),  # barometer
    "281-1": ("capture_timestamp_ns", "latitude", "longitude", "altitude"),  # gps
    # "282-1": (), # "283-1": (), 
    "285-1": ("monotonic_timestamp_ns", "real_timestamp_ns"),  # time
    # "1201-1": (), # "1201-2": (), 
    "1202-1": ("capture_timestamp_ns", "accelerometer", "gyroscope"),  # imu-right
    "1202-2": ("capture_timestamp_ns", "accelerometer", "gyroscope"),  # imu-left
    "1203-1": ("capture_timestamp_ns", "magnetometer"),  # magnetometer
}


def get_device_stream_id(device):
    """ Gets the stream ID from the dict of a device, i.e. "1201-1" """
    return f"{device['device_type_id']}-{device['device_instance_id']}"


def create_device_dtype(device, stream_id):
    if stream_id not in STREAM_DATA_TO_OUTPUT:
        return None  # don't create dtype for this stream because not saving its data
        
    vrs_tag = device["vrs_tag"]
    data_layout = vrs_tag.get("DL:Data:2:0") or vrs_tag.get("DL:Data:1:0")
    data_layout = data_layout["data_layout"]
    
    fields = []
    for field in data_layout:
        field_name = field.get("name")
        if field_name not in STREAM_DATA_TO_OUTPUT[stream_id]:
            continue  # skip this field because not saving its data
        
        # timestamps are ints in nanoseconds but we want float so that we can convert
        # to seconds later (by multiplying by 1e-9) without having to cast the dtype
        if "timestamp" in field_name:
            field_dtype = np.float64
        else:
            field_type = field.get("type")
            field_dtype = DATA_TYPES.get(field_type)
            if field_dtype is None:
                continue  # field_type is not a defined DATA_TYPE so skip this field

            if "Array" in field_type:  # need to pass size to the returned lambda function
                field_dtype = field_dtype(field["size"])  # create the dtype from size
        
        fields.append((field_name, field_dtype))
    
    if len(fields) == 0:
        return None
    return np.dtype(fields)


def create_device_data_arrays(devices):
    device_data_arrays = {}
    for device in devices:
        number_of_records = device["data"]["number_of_records"]
        if number_of_records == 0:
            continue  # skip because no data to save
        
        stream_id = get_device_stream_id(device)
        if stream_id not in STREAM_DATA_TO_OUTPUT:
            continue  # skip this stream because not saving its data
        device_dtype = create_device_dtype(device, stream_id)
            
        device_data_arrays[stream_id] = np.empty(number_of_records, dtype=device_dtype)
    return device_data_arrays


def format_data_record(data_record, stream_id):
    fields = STREAM_DATA_TO_OUTPUT[stream_id]
    formatted_data = []
    for field in fields:
        formatted_data.append(data_record[field])
    return tuple(formatted_data)
    
    
def build_dict_from_dict_list(dict_list, out_dict=None):
    """ Builds a dict from an array of dicts with keys "name" and "value" """
    if out_dict is None:
        out_dict = {}
    for d in dict_list:
        # use .get to avoid KeyErrors if input dicts are bad
        out_dict[d.get("name", "")] = d.get("value", "")
    return out_dict


def get_data_dir(file_dir):  # data_dir is path to the dir containing vrs and graphical dirs
    global regex  # use global regex so it doesn't need to be re-initialized
    if not "regex" in globals():
        regex = re.compile(r".*(?=/vrs$)")
        
    match = regex.match(file_dir)
    data_dir = match[0] if match else None
    return data_dir


# https://stackoverflow.com/a/595332
scripts_dir = os.path.dirname(os.path.realpath(__file__))  # get directory this script is in
create_video_script = f"{scripts_dir}/create-video.sh"


def create_video(output_dir, stream, keep_images=False, verbose=0):
    """ Creates an mp4 video file from a directory of images """
    if verbose:
        print(f"Creating the video for {stream}")
        start_time = time.perf_counter()
        
    subprocess.run(["bash", create_video_script, f"{output_dir}/{stream}"], capture_output=not verbose)
    subprocess.run(["mv", f"{output_dir}/{stream}/{stream}.mp4", f"{output_dir}/{stream}.mp4"], 
                   capture_output=True)
    if not keep_images:
        subprocess.run(["rm", "-r", "-f", f"{output_dir}/{stream}"], capture_output=True)
    
    if verbose:
        print(f"Created the video for {stream} in {time.perf_counter() - start_time:.4f} seconds")


def route_file(*args, verbose=0, scan_dir=True, **kwargs):
    """ Handles the different types of files (txt, dir, vrs) that can be input to this scripts """
    if verbose:
        print()  # to visually separate the output of each call to extract_data
    
    if len(args) == 0:
        args = [os.getcwd()]  # if no file or directory given, use directory script was called from
    elif len(args) > 1:  # if multiple files (or directories) given, run function on each one
        for arg in args:
            route_file(arg, verbose=verbose, scan_dir=scan_dir, **kwargs)
        return  # stop function because all processing done in the function calls in the for loop
    
    path = args[0]  # args[0] is--at this point--the only argument in args
    file = util.FileInfo(path)
    
    # if given text file, run the function on each line
    if file.ext == ".txt":
        if verbose:
            print(f"{file.path} is a text file. Running extract_data on the file on each line...")
        with open(file.path) as txtfile:
            for line in txtfile.read().split("\n"):
                route_file(line, verbose=verbose, scan_dir=scan_dir, **kwargs)
        return
    
    # route every file in file.path if it is a dir and scan_dir is True
    elif file.ext == "" and scan_dir:
        ls = subprocess.run(["ls", file.path], stdout=subprocess.PIPE).stdout.decode().split("\n")[:-1]  # get files in dir
        if "vrs" in ls:  # if "vrs" dir is in file.path, run extract_data on "vrs" dir
            if verbose:
                print(f"Detected vrs directory. Running extract_data on {file.path}/vrs")
            route_file(f"{file.path}/vrs", verbose=verbose, scan_dir=scan_dir, **kwargs)
        else:
            if verbose:
                print(f"{file.path} is a directory. Running extract_data on each file...")
            # output_dir = kwargs["output_dir"]
            for dir_file in ls:
                # if output_dir:
                #     kwargs["output_dir"] = f"{output_dir}/{file.name}"
                route_file(f"{file.path}/{dir_file}", verbose=verbose, scan_dir=False, **kwargs)
    
    elif file.ext.casefold() == ".vrs":
        extract_data(file, verbose=verbose, **kwargs)


def extract_data(file, 
                 # output_dir, 
                 reprocess=False, 
                 calib=True, 
                 headers=True, 
                 rename=True, 
                 nanoseconds=False, 
                 keep_images=False, 
                 keep_metadata=False, 
                 quiet=False, 
                 verbose=0):
    """ Extract all of the data (videos, audio, and sensor) from a vrs file """
    
    if not quiet or verbose:
        print(f"Processing {file.path}")
        start_time = time.perf_counter()
        
    data_dir = get_data_dir(file.dir)
    if not data_dir:
        raise Exception("Couldn't find the \"data\" directory.")
    output_dir = f"{data_dir}/graphical/{file.name}"
    if verbose:
        print(f"Data directory path is '{data_dir}'")
        print(f"Output directory path is '{output_dir}'")
            
    # check if vrs has already been processed and only process if reprocess is True
    if os.path.exists(output_dir) and not reprocess:
        if not quiet or verbose:
            print(f"{file.path} has already been processed. To reprocess it, use the '-r' argument")
        return
    subprocess.run(["mkdir", output_dir], capture_output=True)
    
    if verbose:
        print("Running \"vrs extract-all\"")
        vrs_start_time = time.perf_counter()
    subprocess.run(["vrs", "extract-all", file.path, "--to", output_dir], capture_output=verbose < 2, check=True)
    if verbose:
        print(f"\"vrs extract-all\" finished in {time.perf_counter() - vrs_start_time:.4f} seconds")
        
    if verbose:
        print("Creating videos from the images")
        video_start_time = time.perf_counter()
    
    for stream in ("1201-1", "1201-2", "211-1", "214-1"):
        create_video(output_dir, stream, keep_images, verbose)
    
    if verbose:
        print(f"Created the videos in {time.perf_counter() - video_start_time:.4f} seconds")
        print("Moving the audio file")

    # str instead of list and shell=True to make shell run command so can use the wildcard
    subprocess.run(f"mv {output_dir}/231-1/* {output_dir}/231-1.wav", shell=True, capture_output=True)
    subprocess.run(["rm", "-r", "-f", f"{output_dir}/231-1"], capture_output=True)
    
    if rename:
        if verbose:
            print("Renaming the audio and video files")
        old_path = f"{output_dir}/231-1.wav"
        new_path = f"{output_dir}/{STREAM_NAMES['231-1']}.wav"
        subprocess.run(["mv", old_path, new_path], capture_output=True)
        for stream in ("1201-1", "1201-2", "211-1", "214-1"):
            old_path = f"{output_dir}/{stream}.mp4"
            new_path = f"{output_dir}/{STREAM_NAMES[stream]}.mp4"
            subprocess.run(["mv", old_path, new_path], capture_output=True)
        
    if verbose:
        print("Extracting sensor data from metadata.jsons")
        metadata_start_time = time.perf_counter()
        
    with open(f"{output_dir}/metadata.jsons", encoding="utf-8") as metadata_file:
        metadata = json.loads(metadata_file.readline())  # main metadata of vrs file
        calib = metadata["tags"]["calib_json"]  # save original calibration string
        metadata = util.recurse_loads(metadata)

        arrays = create_device_data_arrays(metadata["devices"])
        indices = dict.fromkeys(arrays.keys(), 0)

        while (info_line := metadata_file.readline()) != "":  # loop through records of the streams
            record_info = json.loads(info_line)   # loads the record info
            stream = record_info["stream"]  # stream id, i.e. "1201-1"
            if stream not in STREAM_DATA_TO_OUTPUT:
                metadata_file.readline()  # skipping this record since not outputting its data
                continue
            
            record = json.loads(metadata_file.readline())  # read the actual record
            if record_info["type"] == "Data":
                # "metadata" is an array of dicts with keys "name" and "value"
                data = build_dict_from_dict_list(record["content"][0]["metadata"])
                formatted_data = format_data_record(data, stream)
                arrays[stream][indices[stream]] = formatted_data
                indices[stream] += 1
                
    if verbose:
        print(f"Extracting sensor data finished in {time.perf_counter() - metadata_start_time:.4f} seconds")
        print("Converting to unix timestamps")
        
    first_device_timestamp, first_unix_timestamp = arrays["285-1"][0]
    if not nanoseconds:
        first_device_timestamp *= 1e-9
        first_unix_timestamp *= 1e-9
    del arrays["285-1"]  # don't save the time stream data
    
    for data in arrays.values():
        if not nanoseconds:
            data["capture_timestamp_ns"] *= 1e-9
        data["capture_timestamp_ns"] -= first_device_timestamp
        data["capture_timestamp_ns"] += first_unix_timestamp
        
    if verbose:
        print("Writing files")
        
    if calib:
        with open(f"{output_dir}/calib.txt", "w") as calib_file:
            calib_file.write(calib)
    for stream, data in arrays.items():
        if stream == "285-1":
            continue  # don't create file for time stream
        
        if headers:
            header = []  # info about what data is in each column
            for name, dtype in data.dtype.fields.items():
                # special case to make timestamp more clear
                name = "timestamp" if name == "capture_timestamp_ns" else name
                units = STREAM_UNITS[stream][name] if name != "timestamp" else "s"
                shape = dtype[0].shape
                cols = []
                if len(shape) > 0:
                    if shape[0] == 3:  # special case for 3d
                        # i.e. accelerometer x, accelerometer y, accelerometer z
                        cols.extend([f"{name} {dim}" for dim in ("x", "y", "z")])
                    else:  # adds note of number of values, i.e. quaternion (4)
                        cols.append(f"{name} ({shape[0]})")
                else:  # only 1 number for column, i.e. timestamp
                    cols.append(name)
                cols = [f"{col} ({units})" for col in cols]
                header.extend(cols)
        
        with open(f"{output_dir}/{STREAM_NAMES[stream]}.csv", "w", newline="") as csv_file:
            writer = csv.writer(csv_file)
            if headers:
                writer.writerow(header)
            for row in data:
                # have to use custom flatten because np.flatten doesn't work on structured arrays
                writer.writerow(util.flatten(row))
                
    if not keep_metadata:
        if verbose:
            print("Removing metadata.jsons")
        subprocess.run(["rm", "-f", f"{output_dir}/metadata.jsons"], capture_output=True)
    subprocess.run(["rm", "-f", f"{output_dir}/ReadMe.md"], capture_output=True)

    if not quiet or verbose:
        print(f"Processed {file.path} in {time.perf_counter() - start_time:.4f} seconds")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract sensor data from VRS files.")
    parser.add_argument("path", 
                        nargs="*", 
                        help="The path to the file to process. If a VRS file, "
                             "processes the VRS file. If a directory, processes "
                             "every VRS file in the directory. If a text file, "
                             "processes the path on each line")
    # parser.add_argument("-o", "--output-dir", 
    #                     help="The path to the directory to save the extracted data in")
    parser.add_argument("-r", "--reprocess", 
                        action="store_true", 
                        help="Reprocess VRS files detected to have already been processed")
    # parser.add_argument("--no-calib", 
    #                     action="store_true", 
    #                     help="Don't save the calibration data")
    # parser.add_argument("--no-headers",
    #                     action="store_true", 
    #                     help="Don't add the headers to the CSV files")
    parser.add_argument("--no-rename", 
                        action="store_true", 
                        help="Don't rename the audio and video files")
    # parser.add_argument("--nanoseconds", 
    #                     action="store_true", 
    #                     help="Save the data's timestamps in nanoseconds instead of seconds")
    parser.add_argument("--keep-images", 
                        action="store_true",
                        help="Don't delete the camera images after creating the videos")
    parser.add_argument("--keep-metadata", 
                        action="store_true", 
                        help="Don't delete the metadata.jsons file after extracting the data")
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
               # output_dir=args.output_dir, 
               reprocess=args.reprocess, 
               calib=True, 
               headers=True, 
               rename=not args.no_rename, 
               nanoseconds=False, 
               keep_images=args.keep_images, 
               keep_metadata=args.keep_metadata, 
               quiet=args.quiet, 
               verbose=args.verbose)
    if not args.quiet or args.verbose:
        print(f"Extraction took a total of {time.perf_counter() - start_time:.4f} seconds")
