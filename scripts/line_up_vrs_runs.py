import argparse
import os
import pathlib
import subprocess
from collections import OrderedDict
from datetime import datetime

import librosa
import numpy as np
import pandas as pd
import soundfile as sf
from moviepy.video.io.VideoFileClip import VideoFileClip

import log
import sync_audios
from log import logger


def change_audio_sample_rate(video_file, output_file, target_sample_rate):
    cmd = [
        "ffmpeg",
        "-i",
        str(video_file),
        "-ar",
        str(target_sample_rate),
        "-ac",
        "2",  # Keep the number of audio channels the same
        "-y",  # Overwrite output file if it already exists
        str(output_file),
    ]
    subprocess.run(cmd)


def combine_audio_files(runs_folder, session_time_differences, video_folder):
    combined_audios = []
    run_number = 0

    for session, time_differences in session_time_differences.items():
        logger.debug(
            "Processing session {} with time differences: {}", session, time_differences
        )
        for time_difference in time_differences:
            logger.debug(
                "Processing run {}, time difference: {}", run_number, time_difference
            )
            audio_file = pathlib.Path(runs_folder, f"run{run_number}.wav")
            audio_segment, sr = sf.read(str(audio_file))
            # Add silent duration between audio clips
            silence_duration = int(
                time_difference * sr
            )  # Calculate duration in samples
            log.log_vars(
                run_number=run_number, sr=sr, silence_duration=silence_duration
            )
            if silence_duration > 0:
                silence_clip = np.zeros(
                    (silence_duration, audio_segment.shape[1]),
                    dtype=audio_segment.dtype,
                )
                combined_audios.append(silence_clip)
            combined_audios.append(audio_segment)

            run_number += 1

        combined_audio = np.concatenate(combined_audios)
        output_file = pathlib.Path(video_folder, f"{session}.wav")
        logger.debug("Combined audio shape: {}", combined_audio.shape)
        logger.debug("Combined audio dtype: {}", combined_audio.dtype)
        logger.debug("Writing combined audio to {}", output_file)
        sf.write(output_file, combined_audio, sr)  # type: ignore
        combined_audios = []


def convert(seconds):
    seconds = seconds % (24 * 3600)
    hour = seconds // 3600
    seconds %= 3600
    minutes = seconds // 60
    seconds %= 60

    return "%d:%02d:%02d" % (hour, minutes, seconds)


def cut_video_into_runs(
    time_differences,
    video_file,
    start_time,
    output_folder,
    run_number,
    start_before=45,  # seconds
    chunk_duration=60,  # seconds
):
    start_time = start_time - start_before

    if not os.path.exists(output_folder):
        os.makedirs(output_folder)

    video = VideoFileClip(str(video_file))

    # start_times = []
    # Loop through time differences
    for time_difference in time_differences:
        if start_time > video.duration:
            logger.warning(
                "Run {} starts at {}, which is past the end of the video at {}",
                run_number,
                convert(start_time),
                convert(video.duration),
            )
            run_number += 1
            # We have to continue instead of breaking we need to increment
            # the run numbers. Otherwise, next session will be messed up
            continue

        logger.debug(
            "Processing run {} with start time: {}",
            run_number,
            convert(start_time),
        )

        end_time = start_time + chunk_duration
        if end_time > video.duration:
            logger.warning(
                "Run {} ends at {}, which is past the end of the video at {}",
                run_number,
                convert(end_time),
                convert(video.duration),
            )
            end_time = video.duration

        # Define output path for the video chunk
        output_path = pathlib.Path(output_folder, f"run{run_number}.mp4")

        video_run = video.subclip(start_time, end_time)
        start_time = start_time + time_difference

        video_run.write_videofile(str(output_path))
        # Increment run number
        run_number += 1
    return run_number


def cut_video_into_runs_individually(
    adjusted_input_video_path,
    input_video_path,
    output_folder,
    runs_folder,
    run_number,
    time_differences,
    bounds,
    start_before=45,  # seconds
    chunk_duration=60,  # seconds
):
    if not os.path.exists(output_folder):
        os.makedirs(output_folder)

    # time_differences has the same length as the number of runs for this vrs
    for _ in time_differences:
        audio_file = pathlib.Path(runs_folder, f"run{run_number}.wav")
        audios, sr = sync_audios.load_audios([adjusted_input_video_path, audio_file])
        lags = sync_audios.get_audios_lags(audios, bounds, threshold=float("inf"))

        start_time_seconds = lags[1] / sr - start_before
        # Define output path for the video chunk
        output_path = pathlib.Path(output_folder, f"run{run_number}.mp4")

        logger.debug(
            "Processing run {} with start time: {}", run_number, start_time_seconds
        )

        video_run = VideoFileClip(str(input_video_path)).subclip(
            start_time_seconds, start_time_seconds + chunk_duration
        )

        video_run.write_videofile(str(output_path))
        # Increment run number
        run_number += 1
    return run_number


def main():
    # Parse command-line arguments
    parser = argparse.ArgumentParser(
        description="Extract video segments based on CSV data."
    )
    parser.add_argument(
        "--videos",
        type=pathlib.Path,
        required=True,
        help="Path to the folder containing video files",
    )
    parser.add_argument(
        "--runs",
        type=pathlib.Path,
        required=True,
        help="Path to the folder containing runs",
    )
    parser.add_argument(
        "--csv",
        type=pathlib.Path,
        required=True,
        help="Path to the CSV file with evaluation data",
    )
    parser.add_argument(
        "--output-videos",
        type=pathlib.Path,
        required=True,
        help="Path to the folder to contain output video files",
    )
    parser.add_argument(
        "--start-times",
        type=pathlib.Path,
        help=(
            "Path to the CSV file containing a start time (relative to the start of"
            " the video) for one run per session. The file should have the header row"
            ' "run,start_time" (without quotes). The start times should be in seconds'
            ' or in the format "mm:ss.SSS". If this option is not provided, the start'
            " time will be determined using cross-correlation."
        ),
    )
    parser.add_argument(
        "--start-before",
        type=float,
        default=45,
        help="Number of seconds before the start of the run to include in the video",
    )
    parser.add_argument(
        "--chunk-duration",
        type=float,
        default=60,
        help="Number of seconds to include in each run",
    )
    log.add_log_level_argument(parser)

    args = parser.parse_args()
    log.setup_logging(args.log_level)

    # Resolve symlinks and convert to absolute; otherwise, soundfile will error
    args.videos = args.videos.resolve()
    args.runs = args.runs.resolve()
    args.csv = args.csv.resolve()
    args.output_videos = args.output_videos.resolve()

    start_before = args.start_before
    chunk_duration = args.chunk_duration

    if chunk_duration < 0:
        raise ValueError(f"Chunk duration must be positive, not {chunk_duration}")

    # Read CSV data
    data = pd.read_csv(args.csv)
    # Add a column to the dataframe to store the file name without the extension
    data = data.assign(File=[vrs[:-4] for vrs in data["VRSFile"]])

    start_times = None
    if args.start_times is not None:
        logger.trace("Calculating start times")
        run_starts = pd.read_csv(args.start_times)
        # Convert the start times (which are in the format mm:ss.SSS) to seconds.
        # Need to add "00:" to the start of it so that pandas understands the format
        timedeltas = [
            pd.Timedelta(f"00:{t}").total_seconds() for t in run_starts["start_time"]
        ]
        run_starts = run_starts.assign(start_time=timedeltas)
        logger.debug("run_starts=\n{}", run_starts)

        start_times = {}
        for _index, (run_num, start_time) in run_starts.iterrows():
            run = data[data["run"] == run_num].iloc[0]
            file = run["File"]

            if file in start_times:
                continue
            if run["eTime"] == "NAN":
                raise ValueError(f"eTime required for run {run_num}")

            # Calculate the start time of the first run for the VRS file
            first_run = data[data["File"] == file].iloc[0]
            if first_run["run"] == run_num:
                logger.trace("Run {} is the first run for {}", run_num, file)
                start_times[file] = start_time
            else:
                if first_run["eTime"] == "NAN":
                    raise ValueError(f"eTime required for run {first_run['run']}")
                run_date = pd.to_datetime(run["eTime"])
                first_run_date = pd.to_datetime(first_run["eTime"])
                # Number of seconds between their start times
                time_offset = (run_date - first_run_date).total_seconds()
                start_times[file] = start_time - time_offset

        for file in data["File"].unique():
            if file not in start_times:
                raise ValueError(f"Start time required for VRS file {file}")

        logger.debug("start_times=\n{}", start_times)

    prevTime = None
    currTime = None
    time_difference = None
    current_session = None
    session_time_differences = (
        OrderedDict()
    )  # Dictionary to store time differences per session

    # Initialize the first session
    current_video = data.iloc[0]["VRSFile"][:-4]
    session_time_differences[current_video] = []

    firstTime = True

    # Iterate through runs
    for _, row in data.iterrows():
        run_number = row["run"]
        vrs = row["VRSFile"]

        # Replace .vrs at the end with .mp4
        video_file = vrs[:-4] + ".mp4"

        if not row["eTime"] == "NAN":
            if prevTime is None:
                prevTime = datetime.strptime(row["eTime"], "%m/%d/%y %H:%M")
            else:
                currTime = datetime.strptime(row["eTime"], "%m/%d/%y %H:%M")
                time_difference = (currTime - prevTime).total_seconds()

                # Check if session changed

                if video_file[:-4] != current_session:
                    if video_file[:-4] not in session_time_differences:
                        session_time_differences[video_file[:-4]] = []
                    if firstTime:
                        logger.debug(
                            "FIRST TIME: Run {} has a time difference of {} minutes",
                            run_number,
                            time_difference / 60,
                        )
                        session_time_differences[video_file[:-4]].append(
                            time_difference
                        )
                        firstTime = False
                    if current_session is not None:
                        session_time_differences[current_session].append(
                            0
                        )  # end with a 0 difference
                    current_session = video_file[:-4]  # Update current session
                else:
                    session_time_differences[current_session].append(time_difference)
                    logger.debug(
                        "Run {} has a time difference of {} minutes",
                        run_number,
                        time_difference / 60,
                    )

                prevTime = currTime
        else:
            # There is only 1 spot of NAN for eTime, and before it is 7:03,
            # after is 7:04, I assume there is no time difference betweent these
            # with changes in code this may
            if video_file[:-4] not in session_time_differences:
                session_time_differences[video_file[:-4]] = []
            if current_session is not None:
                session_time_differences[current_session].append(
                    0
                )  # end with a 0 difference

    session_time_differences[current_session].append(0)  # end with a 0 difference

    # Combine audio files that are from the same vrsfile given the time differences
    # gotten from that vrs file
    combine_audio_files(args.runs, session_time_differences, args.videos)

    run_number = 0
    # print(session_time_differences)
    for session, time_differences in session_time_differences.items():
        audio_file = pathlib.Path(args.videos, f"{session}.wav")
        audio_data, sample_rate_audio = sf.read(str(audio_file))
        duration_seconds_audio = len(audio_data) / sample_rate_audio

        video_file = pathlib.Path(args.videos, f"{session}.mp4")
        video_audio, sample_rate_video = librosa.load(video_file, sr=None)

        duration_seconds_video = len(video_audio) / sample_rate_video

        # Change the video's audio sample rate to match the audio sample rate
        input_video = pathlib.Path(args.videos, f"{session}.mp4")
        output_video = pathlib.Path(args.videos, f"{session}_AUDIOADJUSTED.mp4")
        change_audio_sample_rate(input_video, output_video, sample_rate_audio)
        logger.debug(
            "Session: {}, Audio SR: {}, Audio Duration (seconds): {}, Video Duration"
            " (seconds): {}, Video Audio Sample Rate: {}",
            session,
            sample_rate_audio,
            duration_seconds_audio,
            duration_seconds_video,
            sample_rate_video,
        )

        # if args.start_times:
        if start_times is not None:
            logger.trace("Using calculated start times")
            new_run_number = cut_video_into_runs(
                time_differences,
                str(pathlib.Path(args.videos, f"{session}.mp4")),
                start_times[session],
                args.output_videos,
                run_number,
                start_before,
                chunk_duration,
            )
        elif duration_seconds_audio > duration_seconds_video:
            logger.warning(
                "Audio is longer than video {}, instead finding individually where in"
                " the video each run is, accuracy will vary",
                session,
            )
            new_run_number = cut_video_into_runs_individually(
                output_video,
                input_video,
                args.output_videos,
                args.runs,
                run_number,
                time_differences,
                [(0, 0), (0, (duration_seconds_video - 60) * sample_rate_audio)],
                start_before,
                chunk_duration,
            )
        else:
            audios, sr = sync_audios.load_audios(
                [
                    pathlib.Path(args.videos, f"{session}_AUDIOADJUSTED.mp4"),
                    pathlib.Path(args.videos, f"{session}.wav"),
                ]
            )
            lags = sync_audios.get_audios_lags(
                audios=audios,
                bounds=[
                    (0, 0),
                    (
                        0,
                        (duration_seconds_video - duration_seconds_audio - 60)
                        * sample_rate_audio,
                    ),
                ],
                threshold=float("inf"),
            )

            new_run_number = cut_video_into_runs(
                time_differences,
                str(pathlib.Path(args.videos, f"{session}.mp4")),
                lags[1] / sample_rate_audio,
                args.output_videos,
                run_number,
                start_before,
                chunk_duration,
            )

        run_number = new_run_number
        os.remove(str(pathlib.Path(args.videos, f"{session}.wav")))
        os.remove(str(pathlib.Path(args.videos, f"{session}_AUDIOADJUSTED.mp4")))


if __name__ == "__main__":
    main()
