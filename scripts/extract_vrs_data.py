from __future__ import annotations

import argparse
import csv
import pathlib
import subprocess
import time

import numpy as np
import orjson
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
    "247-1": {"temperature": "deg. C", "pressure": "Pa"},
    "281-1": {"latitude": "dec. deg.", "latitude": "dec. deg.", "altitude": "m"},
    "1202-1": {"accelerometer": "m/s^2", "gyroscope": "rad/s"},
    "1202-2": {"accelerometer": "m/s^2", "gyroscope": "rad/s"},
    "1203-1": {"magnetometer": "T"},
}
requested_streams = {  # what fields from the data of the streams should be saved
    # values are tuples instead of sets to ensure order is maintained
    "247-1": ("capture_timestamp_ns", "temperature", "pressure"),  # barometer
    "281-1": ("capture_timestamp_ns", "latitude", "longitude", "altitude"),  # gps
    "285-1": ("monotonic_timestamp_ns", "real_timestamp_ns"),  # time
    "1202-1": ("capture_timestamp_ns", "accelerometer", "gyroscope"),  # imu-right
    "1202-2": ("capture_timestamp_ns", "accelerometer", "gyroscope"),  # imu-left
    "1203-1": ("capture_timestamp_ns", "magnetometer"),  # magnetometer
}


def get_device_stream_id(device):
    """Gets the stream ID from the dict of a device, i.e. "1201-1"."""
    return f"{device['device_type_id']}-{device['device_instance_id']}"


def create_device_dtype(device, stream_id, requested_streams):
    # if this is None, either it's not in requested_streams or the
    # value for stream_id is None, which means include no fields
    if stream_id not in requested_streams:
        return None  # don't create dtype for this stream because not saving its data

    vrs_tag = device["vrs_tag"]
    # not sure why but some streams use DL:Data:2:0 and others use DL:Data:1:0
    data_layout = vrs_tag.get("DL:Data:2:0") or vrs_tag.get("DL:Data:1:0")
    data_layout = data_layout["data_layout"]

    fields = []
    requested_fields = requested_streams[stream_id]
    for field in data_layout:
        field_name = field.get("name")
        # if requested_fields is ... (Ellipsis, a Python built-in like None),
        # then all fields are extracted for stream_id
        if requested_fields is not ... and field_name not in requested_fields:
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

            if (
                "Array" in field_type
            ):  # need to pass size to the returned lambda function
                field_dtype = field_dtype(field["size"])  # create the dtype from size

        fields.append((field_name, field_dtype))

    # Need to save the field names for formatting later. Otherwise, if you just use the
    # field names of the record being formatted, there might be fields that weren't
    # included in the dtype (i.e. strings)
    if requested_fields is ...:
        if len(fields) == 0:
            requested_streams[stream_id] = None
        else:
            requested_streams[stream_id] = tuple(field[0] for field in fields)

    if len(fields) == 0:
        return None
    return np.dtype(fields)


def create_device_data_arrays(devices, requested_streams):
    device_data_arrays = {}
    for device in devices:
        number_of_records = device["data"]["number_of_records"]
        if number_of_records == 0:
            continue  # skip because no data to save

        stream_id = get_device_stream_id(device)
        if stream_id not in requested_streams:
            continue  # skip this stream because not saving its data
        device_dtype = create_device_dtype(device, stream_id, requested_streams)
        if device_dtype is not None:
            device_data_arrays[stream_id] = np.empty(
                number_of_records, dtype=device_dtype
            )
    return device_data_arrays


def format_data_record(data_record, stream_id, requested_streams):
    fields = requested_streams[stream_id]
    if fields is ...:
        formatted_data = list(data_record.values())
    else:
        formatted_data = []
        for field in fields:
            formatted_data.append(data_record[field])
    return tuple(formatted_data)


def build_dict_from_dict_list(dict_list, out_dict=None):
    """Builds a dict from an array of dicts with keys "name" and "value"."""
    if out_dict is None:
        out_dict = {}
    for d in dict_list:
        # use .get to avoid KeyErrors if input dicts are bad
        out_dict[d.get("name", "")] = d.get("value", "")
    return out_dict


scripts_dir = pathlib.Path(__file__).parent
create_video_script = scripts_dir / "create-video.sh"


def create_video(
    output_dir: pathlib.Path, stream: str, keep_images: bool = False, verbose: int = 0
):
    """Creates an mp4 video file from a directory of images."""
    # quiet doesn't matter because we only use verbose_level > 0 in this function
    vprint = util.verbose_printer(False, verbose)
    vprint(f"Creating the video for {stream}")
    start_time = time.perf_counter()

    subprocess.run(
        ["bash", create_video_script, output_dir / stream], capture_output=not verbose
    )
    util.mv(output_dir / stream / f"{stream}.mp4", output_dir / f"{stream}.mp4")
    if not keep_images:
        util.rm(output_dir / stream)

    vprint(
        f"Created the video for {stream} in"
        f" {time.perf_counter() - start_time:.4f} seconds"
    )


# It might be surprising, but using replace + orjson is actually faster than using other
# json libraries that support "NaN". Here were my tests of the main while loop using the
# different json libraries:
# ccf5a3cc - 56.1 MB (%%timeit -n 10 -r 10)
#   - json: 887 ms ± 3.82 ms per loop
#   - orjson + .replace: 330 ms ± 2.41 ms per loop
#   - ujson: 488 ms ± 6.95 ms per loop
# b903d8ed - 6.4 GB (%%timeit -n 1 -r 1)
# - json: 1min 40s
# - orjson + .replace: 37.9 s
# - ujson: 55 s
def load_json_with_nan(s):
    """Loads a JSON string containing "NaN" using orjson.
    orjson normally throws an exception if the JSON contains "NaN", so this
    function loads the JSON after replacing "NaN" with "null".
    """
    return orjson.loads(s.replace("NaN", "null"))


def route_dir(dir, verbose=0, scan_dir=True, **kwargs):
    if verbose:
        print(f"Running process_audio on each file in {dir}")
    for path in dir.iterdir():
        route_file(path, verbose=verbose, scan_dir=scan_dir, **kwargs)


def route_file(*paths: pathlib.Path, verbose: int = 0, scan_dir: bool = True, **kwargs):
    """Handles the different types of files that can be input into this script."""
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

    path = paths[0]  # paths[0] is--at this point--the only argument in paths

    if path.suffix.casefold() == ".vrs":
        extract_data(path, verbose=verbose, **kwargs)

    # route every file in file.path if it is a dir and scan_dir is True
    elif path.is_dir() and scan_dir:
        if path.name == "data":  # the data dir was passed so run on data/vrs
            route_dir(path / "vrs", verbose=verbose, scan_dir=scan_dir, **kwargs)
        else:
            route_dir(path, verbose=verbose, scan_dir=False, **kwargs)


# The next functions are separate from the main function just in case another script
# wants to import and use them, as well as for readability
def vrs_extract_all(vrsfile, to, verbose=0):
    """Wrapper for the "vrs extract-all" shell command."""
    return subprocess.run(
        ["vrs", "extract-all", vrsfile, "--to", to],
        capture_output=verbose < 2,
        check=True,
    )


def extract_data(
    path: pathlib.Path,
    reprocess=False,
    calib=True,
    headers=True,
    rename=True,
    nanoseconds=False,
    images=False,
    metadata=False,
    quiet=False,
    verbose=0,
):
    """Extract all of the data (videos, audio, and sensor) from a VRS file."""
    # I didn't want to name the options stuff like --keep-metadata because then the
    # opposite would be --no-keep-metadata which doesn't really make sense, but I also
    # didn't want to name them just the regular --metadata because then the actual data
    # would have to be named stuff like metadata_obj, so renaming these here is my
    # compromise
    save_calib = calib
    keep_images = images
    keep_metadata = metadata

    vprint = util.verbose_printer(quiet, verbose)
    vprint(f"Processing {path}", 0)
    start_time = time.perf_counter()

    if len(path.parents) < 2 or path.parents[1].name != "data":
        raise Exception("Input file must be in either data/audio or data/video")
    data_dir = path.parents[1]
    output_dir = data_dir / "graphical" / path.stem
    vprint(f"Output directory path is '{output_dir}'")

    # check if vrs has already been processed and only process if reprocess is True
    if output_dir.exists() and not reprocess:
        vprint(
            f"{path} has already been processed. To reprocess it, use the '-r'"
            " argument",
            0,
        )
        return
    util.mkdir(output_dir)

    vprint('Running "vrs extract-all"')
    vrs_start_time = time.perf_counter()
    vrs_extract_all(path, output_dir, verbose)
    vprint(
        '"vrs extract-all" finished in'
        f" {time.perf_counter() - vrs_start_time:.4f} seconds"
    )

    vprint("Creating videos from the images")
    video_start_time = time.perf_counter()
    for stream in ("1201-1", "1201-2", "211-1", "214-1"):
        create_video(output_dir, stream, keep_images, verbose)
    vprint(
        f"Created the videos in {time.perf_counter() - video_start_time:.4f} seconds"
    )
    util.mv(output_dir / "231-1/*", output_dir / "231-1.wav", True)
    util.rm(output_dir / "231-1")

    if rename:
        vprint("Renaming the audio and video files")
        old_path = output_dir / "231-1.wav"
        new_path = output_dir / f"{STREAM_NAMES['231-1']}.wav"
        util.mv(old_path, new_path)
        for stream in ("1201-1", "1201-2", "211-1", "214-1"):
            old_path = output_dir / f"{stream}.mp4"
            new_path = output_dir / f"{STREAM_NAMES[stream]}.mp4"
            util.mv(old_path, new_path)

    vprint("Extracting sensor data from metadata.jsons")
    metadata_start_time = time.perf_counter()
    with open(output_dir / "metadata.jsons", encoding="utf-8") as metadata_file:
        metadata = load_json_with_nan(
            metadata_file.readline()
        )  # main metadata of vrs file
        # save the calibration string to use it in create_poses.py
        calib = metadata["tags"]["calib_json"]
        metadata = util.recurse_loads(metadata)

        arrays = create_device_data_arrays(metadata["devices"], requested_streams)
        indices = dict.fromkeys(arrays.keys(), 0)

        while (
            info_line := metadata_file.readline()
        ) != "":  # loop through records of the streams
            record_info = load_json_with_nan(info_line)  # loads the record info
            # we'll need to read the record because either using it or passing over it
            record_line = metadata_file.readline()
            stream = record_info["stream"]  # stream id, i.e. "1201-1"
            if stream not in requested_streams:
                continue  # skipping this record since not outputting its data

            # load after skipping instead of right away so that we don't
            # waste time parsing a record we're not going to use
            record = load_json_with_nan(record_line)
            if record_info["type"] == "Data":
                # "metadata" is an array of dicts with keys "name" and "value"
                data = build_dict_from_dict_list(record["content"][0]["metadata"])
                formatted_data = format_data_record(data, stream, requested_streams)
                arrays[stream][indices[stream]] = formatted_data
                indices[stream] += 1

    vprint(
        "Extracting sensor data finished in"
        f" {time.perf_counter() - metadata_start_time:.4f} seconds"
    )
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

    vprint("Writing files")

    if save_calib:
        with open(output_dir / "calib.txt", "w") as calib_file:
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

        with open(
            output_dir / f"{STREAM_NAMES[stream]}.csv", "w", newline=""
        ) as csv_file:
            writer = csv.writer(csv_file)
            if headers:
                csv_file.write(
                    "# "
                )  # first row is the header row, add # to indicate it's a comment
                writer.writerow(header)
            for row in data:
                # have to use a custom flatten function because np.flatten
                # doesn't work the same on structured arrays
                writer.writerow(util.flatten(row))

    if not keep_metadata:
        vprint("Removing metadata.jsons")
        util.rm(output_dir / "metadata.jsons")
    util.rm(output_dir / "ReadMe.md")

    vprint(f"Processed {path} in {time.perf_counter() - start_time:.4f} seconds", 0)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract sensor data from VRS files.")
    parser.add_argument(
        "path",
        nargs="*",
        type=pathlib.Path,
        help=(
            "The path to the file to process. If a VRS file, "
            "processes the VRS file. If a directory, processes "
            "every VRS file in the directory."
        ),
    )
    parser.add_argument(
        "-r",
        "--reprocess",
        action=util.BooleanOptionalAction,  # allows --no-reprocess
        default=False,
        help="Reprocess VRS files detected to have already been processed.",
    )
    parser.add_argument(
        "--calib",
        action=util.BooleanOptionalAction,
        default=True,
        help="Save the calibration data required for create_poses.py. Default is True.",
    )
    # parser.add_argument("--no-headers",
    #                     action="store_true",
    #                     help="Don't add the headers to the CSV files")
    parser.add_argument(
        "--rename",
        action=util.BooleanOptionalAction,
        default=True,
        help=(
            "Rename the audio and video files from the stream's id to the stream's"
            "device name. Default is True."
        ),
    )
    # parser.add_argument("--nanoseconds",
    #                     action="store_true",
    #                     help="Save the data's timestamps in nanoseconds")
    parser.add_argument(
        "--images",
        action=util.BooleanOptionalAction,
        default=False,
        help="Save the cameras' image files. Default is False.",
    )
    parser.add_argument(
        "--metadata",
        action=util.BooleanOptionalAction,
        default=False,
        help="Save the metadata.jsons file. Default is False.",
    )
    parser.add_argument(
        "-q", "--quiet", action="store_true", help="Don't print anything."
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="count",
        default=0,
        help="Print various debugging information.",
    )

    args = parser.parse_args()
    start_time = time.perf_counter()
    route_file(*util.namespace_pop(args, "path"), **vars(args))
    if not args.quiet or args.verbose:
        print(
            f"Extraction took a total of {time.perf_counter() - start_time:.4f} seconds"
        )
