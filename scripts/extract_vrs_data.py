from __future__ import annotations

import argparse
import csv
import re
import shutil
from pathlib import Path

import numpy as np
import orjson

import log
import util
from constants import DATA_DIR
from log import logger

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
# VIDEO_STREAMS = ("1201-1", "1201-2", "211-1", "214-1")
VIDEO_STREAMS = ("1201-1", "1201-2", "214-1")
STREAM_UNITS = {  # dicts containing the units of the sensor's measurements
    "247-1": {"temperature": "deg. C", "pressure": "Pa"},
    "281-1": {"latitude": "dec. deg.", "longitude": "dec. deg.", "altitude": "m"},
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


@log.Timer()
def create_video(
    images_dir: Path,
    keep_images: bool = False,
    rotate: bool = True,
    pattern: str = r"(?i)(\d+\.\d+)\.(jpg|jpeg|png)$",
):
    """Creates an mp4 video file from a directory of images."""
    # this generates the video by using a concat file with ffmpeg
    # a concat file basically just lists the file names and their durations

    stem = images_dir.stem
    output_dir = images_dir.parent
    concat_path = images_dir / "concat.txt"
    video_path = output_dir / f"{stem}.mp4"
    timestamps_path = output_dir / f"{stem}-original.csv"

    # using absolute paths with ffmpeg concat causes issues sometimes so just use
    # relative paths. ffmpeg interprets relative paths to be relative to the concat
    # file, not the working directory, so this works fine because concat file is in
    # the same directory as the images
    images = [image.relative_to(images_dir) for image in images_dir.glob("*")]
    images = sorted(map(str, images))
    timestamps = []
    for i, image in enumerate(images):
        match = re.search(pattern, image, re.IGNORECASE)
        if match:
            # * 1000 for ffmpeg fps (see comment above the util.ffmpeg call)
            timestamps.append(float(match.group(1)) * 1000)
        else:
            images.pop(i)
    timestamps = np.asarray(timestamps)
    durations = np.diff(timestamps)
    timestamps /= 1000  # only needed * 1000 for durations, remove now

    with concat_path.open("w") as concat_file:
        # need images[0] separate because it's not in durations since np.diff just
        # takes differences between each 2 entries and there isn't an entry before
        # the 1st. just assume it has the average duration
        # FIXME: actually I think the last image is the one missing a duration since
        #        we know the times between 1st and 2nd (therefore 1st's duration).
        #        Not changing it yet tho just because this works and want to make sure
        concat_file.write(f"file '{images[0]}'\nduration {np.mean(durations)}\n")
        for image, duration in zip(images[1:], durations):
            concat_file.write(f"file '{image}'\nduration {duration}\n")

    with timestamps_path.open("w") as timestamps_file:
        # map the timestamps to str before join because join expects iterable of str
        timestamps_file.write("\n".join(map(str, timestamps)))

    # with ffmpeg, you can't have a variable frame rate video when using a concat file.
    # we can get around this by multiplying the durations by some factor (I'm guessing
    # to get the durations in whole seconds??) and then that factor is divided out with
    # the -vf "settb.../1000" option. -vsync vfr and -r 1000 are also used for this.
    # See Arnon Weinberg's answer on this question: https://stackoverflow.com/a/72442310
    # And here's an archived link just in case:
    # https://web.archive.org/web/20230109224607/https://stackoverflow.com/questions/25073292/how-do-i-render-a-video-from-a-list-of-time-stamped-images)
    # -c:v libx264 sets the video codec to maintain picture quality
    # -pix_fmt yuv420p sets the pixel format to one that is widely compatible
    util.ffmpeg(
        concat_path,
        video_path,
        input_options=["-f", "concat"],
        output_options=[
            "-vf",
            "settb=1/1000,setpts=PTS/1000",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-vsync",
            "vfr",
            "-r",
            "1000",
        ],
    )

    if rotate:
        rotated_video_path = output_dir / f"{stem}-rotated.mp4"
        # aria glasses output slam and rgb video sideways since that's how it's filmed
        # this rotates a video 90 degrees clockwise to correct the orientation
        util.ffmpeg(
            video_path,
            rotated_video_path,
            output_options=["-vf", "transpose=1"],
        )
        rotated_video_path.replace(video_path)  # rename rotated video

    if not keep_images:
        shutil.rmtree(images_dir, ignore_errors=True)


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
def load_json_with_nan(s: str):
    """Loads a JSON string containing "NaN" using orjson.
    orjson normally throws an exception if the JSON contains "NaN", so this
    function loads the JSON after replacing "NaN" with "null".
    """
    return orjson.loads(s.replace("NaN", "null"))


def route_dir(dir, scan_dir=True, **kwargs):
    logger.debug("Running extract_vrs_data on each file in {}", dir)
    for path in dir.iterdir():
        route_file(path, scan_dir=scan_dir, **kwargs)


def route_file(*paths: Path, scan_dir: bool = True, **kwargs):
    """Handles the different types of files that can be input into this script."""
    if len(paths) == 0:
        paths = [
            Path.cwd()
        ]  # if no file or directory given, use directory script was called from
    elif (
        len(paths) > 1
    ):  # if multiple files (or directories) given, run function on each one
        for path in paths:
            route_file(path, scan_dir=scan_dir, **kwargs)
        # stop function because all of the processing is
        # done in the function calls in the for loop
        return

    path = paths[0].absolute()  # paths[0] is--at this point--the only argument in paths

    if path.suffix.casefold() == ".vrs":
        extract_vrs_data(path, **kwargs)

    elif path.name == "metadata.jsons":
        extract_sensor_data(path, **kwargs)

    # route every file in file.path if it is a dir and scan_dir is True
    elif path.is_dir() and scan_dir:
        if path.name == "data":  # the data dir was passed so run on data/vrs
            route_dir(path / "vrs", scan_dir=scan_dir, **kwargs)
        else:
            route_dir(path, scan_dir=False, **kwargs)


def run_from_pipeline(args):
    # path should be a str or list of str so convert to list of Paths
    paths = util.expand_files(args.pop("path"), to_paths=True)
    with log.Timer("Extraction took {}"):
        route_file(*paths, **args)


# cam slam left is excluded to check for it separately since it might be moved
expected_images = {
    Path(path)
    for path in (
        # "camera-eye-tracking",
        "camera-slam-left",
        "camera-slam-right",
    )
}
expected_videos = {path.with_suffix(".mp4") for path in expected_images}


def vrs_needs_reprocessed(
    output_dir: Path,
    reprocess=False,
    move=False,
    images=False,
    metadata=False,
    reprocess_metadata=True,
):
    """

    Returns
    -------
    bool
        Whether `vrs extract-all` needs to be run.
    bool
        Whether the videos for the images need to be created.
    """
    needs_extracted = not output_dir.exists() or reprocess
    needs_videos = not output_dir.exists() or reprocess
    if not needs_extracted:
        parent_dir = output_dir.parent.relative_to(DATA_DIR / "graphical")
        file_stem = output_dir.stem
        files = {path.relative_to(output_dir) for path in output_dir.iterdir()}
        # if we want to keep the images but they don't exist
        if images:
            if not expected_images.issubset(files):
                needs_extracted = True
            elif not (move or Path("camera-rgb") in files):
                needs_extracted = True
            elif (
                move
                and not (
                    DATA_DIR / "imagesForEncoding" / parent_dir / file_stem
                ).exists()
            ):
                needs_extracted = True
        elif (metadata or reprocess_metadata) and Path("metadata.jsons") not in files:
            needs_extracted = True
        # elif not (move or Path("microphones.wav") in files):
        elif not (move or Path("microphone1.wav") in files):
            needs_extracted = True
        elif (
            move and not (DATA_DIR / "audio" / parent_dir / f"{file_stem}.wav").exists()
        ):
            needs_extracted = True
        # missing the videos
        if not expected_videos.issubset(files):
            needs_videos = True
            # if we don't have videos then we need images to create them
            # if there aren't images, we need to reextract
            if not expected_images.issubset(files):
                needs_extracted = True
        elif not (move or Path("camera-slam-left.mp4") in files):
            needs_videos = True
            if not Path("camera-slam-left") in files:
                needs_extracted = True
        elif (
            move and not (DATA_DIR / "video" / parent_dir / f"{file_stem}.mp4").exists()
        ):
            needs_videos = True
            if not Path("camera-slam-left") in files:
                needs_extracted = True
    return needs_extracted, needs_videos


expected_sensors = {
    Path(path)
    for path in ("barometer.csv", "imu-left.csv", "imu-right.csv", "magnetometer.csv")
}


def metadata_needs_reprocessed(output_dir: Path, reprocess=False, calib=True):
    needs_processed = not output_dir.exists() or reprocess
    if not needs_processed:
        files = {path.relative_to(output_dir) for path in output_dir.iterdir()}
        if calib and Path("calib.json") not in files:
            needs_processed = True
        if not expected_sensors.issubset(files):
            needs_processed = True
    return needs_processed


def extract_vrs_data(
    path: Path,
    reprocess=False,
    calib=True,
    move=False,
    images=False,
    metadata=False,
    **kwargs,
):
    """Extract video, audio, and metadata from a VRS file."""
    log.log_vars(
        log_separate_=True,
        path=path,
        reprocess=reprocess,
        calib=calib,
        move=move,
        images=images,
        metadata=metadata,
    )

    # I didn't want to name the options stuff like --keep-metadata because then the
    # opposite would be --no-keep-metadata which doesn't really make sense, but I also
    # didn't want to name them just the regular --metadata because then the actual data
    # would have to be named stuff like metadata_obj, so renaming these here is my
    # compromise
    # save_calib = calib
    keep_images = images
    keep_metadata = metadata

    # manually use timer instead of wrapping function because we don't want the timer
    # to include extract_sensor_data
    timer = log.Timer("extract_vrs_data took {}")
    timer.start()

    try:
        parent_dir = path.parent.relative_to(DATA_DIR / "vrs")
    except ValueError:
        raise ValueError("Input file must be in a directory in data/vrs")
    output_dir = DATA_DIR / "graphical" / parent_dir / path.stem
    log.log_vars(output_dir=output_dir)

    # reprocess_metadata = metadata_needs_reprocessed(output_dir, reprocess, save_calib)
    reprocess_metadata = False
    needs_extracted, needs_videos = vrs_needs_reprocessed(
        output_dir, reprocess, move, keep_images, keep_metadata, reprocess_metadata
    )

    if needs_extracted:
        output_dir.mkdir(parents=True, exist_ok=True)
        # log.run_and_log_subprocess(["vrs", "extract-all", path, "--to", output_dir])
        log.run_and_log_subprocess(
            ["vrs", "extract-audio", path, "--to", output_dir / "231-1"]
        )
        # # Don't export eye-tracking images
        # log.run_and_log_subprocess(
        #     ["vrs", "extract-images", path, "--to", output_dir, "-", "211"]
        # )
        # ^ Actually can't do that because then it's all extracted into output_dir
        # instead of each stream in its own directory
        for stream in VIDEO_STREAMS:
            output_to = output_dir / stream
            log.run_and_log_subprocess(
                ["vrs", "extract-images", path, "--to", output_to, "+", stream]
            )
        # move the audio file out of its directory and remove the directory
        # there should only be one audio file, so [0] is getting the only one
        audio_dir_files = list((output_dir / "231-1").glob("*.wav"))
        if len(audio_dir_files) > 1:
            logger.warning(
                "There are multiple audio files in {}. Using the first one.",
                output_dir.stem / "231-1",
            )
        logger.trace("Renaming the audio and video files")
        old_audio_path = audio_dir_files[0]
        util.ffmpeg(
            old_audio_path,
            output_dir / "microphone1.wav",
            # This is needed so that ffmpeg doesn't try to guess the layout of the
            # input audio (making it 6.1 instead of just saying it's 7 channels). I'm
            # not sure it matters, but I'm doing it just in case.
            input_options=["-guess_layout_max", "0"],
            # Argument is file.stream.channel. 0.0.1 gives 2nd channel (which is mic1,
            # the mic in the center of the glasses).
            output_options=["-map_channel", "0.0.1"],
        )
        # old_audio_path.replace(output_dir / "231-1.wav")
        # old_audio_path.replace(output_dir / "microphones.wav")
        old_audio_path.unlink()
        shutil.rmtree(output_dir / "231-1", ignore_errors=True)
        for stream in VIDEO_STREAMS:
            old_path = output_dir / f"{stream}"
            new_path = output_dir / f"{STREAM_NAMES[stream]}"
            old_path.replace(new_path)
    else:
        logger.info("{} has already been processed. To reprocess it, pass -r", path)

    if needs_videos:
        logger.trace("Creating videos from the images")
        with log.Timer("Creating videos took {}"):
            for stream in VIDEO_STREAMS:
                # rotate=stream != "211-1" to not rotate the eye tracking camera
                # because its orientation is already correct
                create_video(
                    output_dir / STREAM_NAMES[stream],
                    keep_images,
                    rotate=stream != "211-1",
                )
    else:
        logger.info("Videos have already been created. To recreate them, pass -r")

    if move:
        # old_audio_path = output_dir / "microphones.wav"
        old_audio_path = output_dir / "microphone1.wav"
        if old_audio_path.exists():
            new_audio_path = DATA_DIR / "audio" / parent_dir / f"{path.stem}.wav"
            new_audio_path.parent.mkdir(parents=True, exist_ok=True)
            old_audio_path.replace(new_audio_path)

        old_video_path = output_dir / "camera-slam-left.mp4"
        if old_video_path.exists():
            new_video_path = DATA_DIR / "video" / parent_dir / f"{path.stem}.mp4"
            new_video_path.parent.mkdir(parents=True, exist_ok=True)
            old_video_path.replace(new_video_path)

        old_images_path = output_dir / "camera-rgb"
        if old_images_path.exists():
            new_images_path = (
                DATA_DIR / "imagesForEncoding" / parent_dir / f"{path.stem}"
            )
            new_images_path.parent.mkdir(parents=True, exist_ok=True)
            old_images_path.replace(new_images_path)

    timer.stop()

    # if reprocess_metadata:
    #     extract_sensor_data(
    #         output_dir / "metadata.jsons",
    #         reprocess,
    #         calib=save_calib,
    #         metadata=keep_metadata,
    #         **kwargs,
    #     )
    # else:
    #     logger.info(
    #         "{} has already been processed. To reprocess it, pass -r",
    #         output_dir / "metadata.jsons",
    #     )


@log.Timer()
def extract_sensor_data(
    path: Path,
    reprocess=False,
    calib=True,
    headers=True,
    nanoseconds=False,
    metadata=False,
    **kwargs,  # kwargs to catch any arguments meant for extract_vrs_data
):
    """Extract sensor data from a VRS file's extracted metadata.jsons file."""
    log.log_vars(
        log_separate_=True,
        path=path,
        reprocess=reprocess,
        calib=calib,
        headers=headers,
        nanoseconds=nanoseconds,
        metadata=metadata,
    )

    # I didn't want to name the options stuff like --keep-metadata because then the
    # opposite would be --no-keep-metadata which doesn't really make sense, but I also
    # didn't want to name them just the regular --metadata because then the actual data
    # would have to be named stuff like metadata_obj, so renaming these here is my
    # compromise
    save_calib = calib
    keep_metadata = metadata

    try:
        path.parent.relative_to(DATA_DIR / "graphical")
    except ValueError:
        raise ValueError("Input file must be in a directory in data/graphical")
    output_dir = path.parent
    log.log_vars(output_dir=output_dir)

    # check if vrs has already been processed and only process if reprocess is True
    if not metadata_needs_reprocessed(output_dir, reprocess, save_calib):
        logger.info("{} has already been processed. To reprocess it, pass -r", path)
        return

    logger.trace("Extracting sensor data from metadata.jsons")
    # manually use timer instead of using context manager to save an indent level
    metadata_timer = log.Timer("Extracting sensor data from metadata.jsons took {}")
    metadata_timer.start()

    with path.open(encoding="utf-8") as metadata_file:
        # main metadata of the file containing info about the different streams
        # the rest of the file contains data from non-audial and non-visual streams
        metadata_json = metadata_file.readline()
        metadata = load_json_with_nan(metadata_json)
        # save the calibration string to use it in create_poses.py
        calib = metadata["tags"]["calib_json"]
        metadata = util.recurse_load_json(metadata)

        arrays = create_device_data_arrays(metadata["devices"], requested_streams)
        indices = dict.fromkeys(arrays.keys(), 0)

        # loop through records of the streams
        while (info_line := metadata_file.readline()) != "":
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

    metadata_timer.stop()  # this will log the timing info for us
    logger.trace("Converting to unix timestamps")

    if arrays.get("285-1") is not None:
        first_device_timestamp, first_unix_timestamp = arrays["285-1"][0]
        if not nanoseconds:
            first_device_timestamp *= 1e-9
            first_unix_timestamp *= 1e-9

        for stream, data in arrays.items():
            # exclude 285-1 because it's the only stream without "capture_timestamp_ns"
            if stream != "285-1":
                if not nanoseconds:
                    data["capture_timestamp_ns"] *= 1e-9
                data["capture_timestamp_ns"] -= first_device_timestamp
                # data["capture_timestamp_ns"] += first_unix_timestamp

        # convert the timestamps extracted from the image filenames to unix timestamps
        for stream in VIDEO_STREAMS:
            video_timestamps_path = output_dir / f"{STREAM_NAMES[stream]}-original.csv"
            if video_timestamps_path.exists():
                video_timestamps = np.genfromtxt(video_timestamps_path)
                video_timestamps -= first_device_timestamp
                video_timestamps += first_unix_timestamp
                np.savetxt(
                    str(output_dir / f"{STREAM_NAMES[stream]}.csv"),
                    video_timestamps,
                    "%.7f",
                )
                video_timestamps_path.unlink()

    logger.trace("Writing files")
    # manually use timer instead of using context manager to save an indent level
    write_timer = log.Timer("Writing files took {}")
    write_timer.start()

    with open(output_dir / "vrs-info.json", "w") as info_file:
        info_file.write(metadata_json)
    if save_calib:
        with open(output_dir / "calib.json", "w") as calib_file:
            calib_file.write(calib)
    for stream, data in arrays.items():
        if headers:
            header = []  # info about what data is in each column
            for name, dtype in data.dtype.fields.items():
                # special case to make timestamp more clear
                name = "timestamp" if name == "capture_timestamp_ns" else name
                if "timestamp" in name:
                    if not nanoseconds:
                        # names other than capture_timestamp_ns have timestamp in the
                        # name (like for 285-1 names), so this'll replace _ns for those
                        name = name.replace("_ns", "")
                        units = "s"
                    else:
                        units = "ns"
                else:
                    units = STREAM_UNITS.get(stream, {}).get(name, "")
                shape = dtype[0].shape
                cols = []
                if len(shape) > 0:
                    if shape[0] == 3:  # special case for 3d
                        # i.e. accelerometer x, accelerometer y, accelerometer z
                        cols.extend([f"{name} {dim}" for dim in ("x", "y", "z")])
                    else:  # adds note of number of values, i.e. quaternion (4)
                        cols.extend([f"{name} {i}" for i in range(shape[0])])
                else:  # only 1 number for column, i.e. timestamp
                    cols.append(name)
                cols = [f"{col} ({units})" for col in cols]
                header.extend(cols)

        with open(
            output_dir / f"{STREAM_NAMES[stream]}.csv", "w", newline=""
        ) as csv_file:
            writer = csv.writer(csv_file)
            if headers:
                # first row is the header row, add # to indicate it's a comment
                csv_file.write("# ")
                writer.writerow(header)
            for row in data:
                # have to use a custom flatten function because np.flatten
                # doesn't work the same on structured arrays
                writer.writerow(util.flatten(row))

    write_timer.stop()

    if not keep_metadata:
        logger.debug("Removing metadata.jsons")
        (output_dir / "metadata.jsons").unlink()
    (output_dir / "ReadMe.md").unlink()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract sensor data from VRS files.")
    parser.add_argument(
        "path",
        nargs="*",
        type=Path,
        help=(
            "The path to the file to process. If a VRS file, "
            "processes the VRS file. If a directory, processes "
            "every VRS file in the directory."
        ),
    )
    parser.add_argument(
        "-r",
        "--reprocess",
        action=argparse.BooleanOptionalAction,  # allows --no-reprocess
        default=False,
        help="Reprocess VRS files detected to have already been processed.",
    )
    parser.add_argument(
        "--calib",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Save the calibration data required for create_poses.py. Default is True.",
    )
    # parser.add_argument("--no-headers",
    #                     action="store_true",
    #                     help="Don't add the headers to the CSV files")
    # parser.add_argument(
    #     "--rename",
    #     action=argparse.BooleanOptionalAction,
    #     default=True,
    #     help=(
    #         "Rename the audio and video files from the stream's id to the stream's "
    #         "device name. Default is True."
    #     ),
    # )
    parser.add_argument(
        "--move",
        action=argparse.BooleanOptionalAction,
        default=False,
        help=(
            "Moves the extracted files to their respective data folders, i.e. the audio"
            " file is moved to data/audio, the video file is moved to data/video,"
            " and--if --images is passed--the directory of images from the RGB camera"
            " are moved to data/imagesForEncoding. The moved files' names are all set"
            " to the stem of the input file. Default is False."
        ),
    )
    # parser.add_argument("--nanoseconds",
    #                     action="store_true",
    #                     help="Save the data's timestamps in nanoseconds")
    parser.add_argument(
        "--images",
        action=argparse.BooleanOptionalAction,
        default=False,
        help="Save the cameras' image files. Default is False.",
    )
    parser.add_argument(
        "--metadata",
        action=argparse.BooleanOptionalAction,
        default=False,
        help="Save the metadata.jsons file. Default is False.",
    )
    log.add_log_level_argument(parser)

    args = vars(parser.parse_args())
    log.setup_logging(args.pop("log_level"))
    with log.Timer("Extraction took {}"):
        route_file(*args.pop("path"), **args)
