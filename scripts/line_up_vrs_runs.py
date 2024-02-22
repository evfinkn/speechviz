import argparse
import os
import pathlib
import subprocess
from collections import OrderedDict
from datetime import datetime

import numpy as np
import pandas as pd
import soundfile as sf
from moviepy.video.io.VideoFileClip import AudioFileClip, VideoFileClip

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
                time_difference * sr * 60
            )  # Calculate duration in samples
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
        sf.write(output_file, combined_audio, sr)
        combined_audios = []


def cut_video_into_runs(
    time_differences, video_file, start_time, sr, output_folder, run_number
):
    start_time_seconds = int(start_time / sr)
    chunk_duration = 60  # seconds, adjust as needed

    if not os.path.exists(output_folder):
        os.makedirs(output_folder)

    start_times = []
    # Loop through time differences
    for time_difference in time_differences:
        print(f"Processing run {run_number}")
        start_time_seconds = start_time_seconds + time_difference * 60 + 60
        start_times.append(start_time_seconds)

        # Define output path for the video chunk
        output_path = pathlib.Path(output_folder, f"run{run_number}.mp4")

        video_run = VideoFileClip(str(video_file)).subclip(
            start_time_seconds, start_time_seconds + chunk_duration
        )

        video_run.write_videofile(str(output_path))
        # Increment run number
        run_number += 1
    return run_number


def cut_video_into_runs_individually(
    adjusted_input_video_path,
    input_video_path,
    video_sr,
    output_folder,
    runs_folder,
    run_number,
    time_differences,
    bounds,
):
    if not os.path.exists(output_folder):
        os.makedirs(output_folder)

    chunk_duration = 60  # seconds, adjust as needed

    # time_differences has the same length as the number of runs for this vrs
    for _ in time_differences:
        audio_file = pathlib.Path(runs_folder, f"run{run_number}.wav")
        audios, sr = sync_audios.load_audios([adjusted_input_video_path, audio_file])
        lags = sync_audios.get_audios_lags(audios, bounds, threshold=float("inf"))

        start_time_seconds = int(lags[1] / sr)
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
    log.add_log_level_argument(parser)

    args = parser.parse_args()
    log.setup_logging(args.log_level)

    # Read CSV data
    data = pd.read_csv(args.csv)

    prevTime = None
    currTime = None
    minutes_difference = None
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
                time_difference = currTime - prevTime
                minutes_difference = time_difference.total_seconds() / 60
                minutes_difference -= (
                    1  # Subtract 1 minute to account for the 1 minute run themselves
                )

                # Check if session changed

                if video_file[:-4] != current_session:
                    if video_file[:-4] not in session_time_differences:
                        session_time_differences[video_file[:-4]] = []
                    if firstTime:
                        logger.debug(
                            "FIRST TIME: Run {} has a time difference of {} minutes",
                            run_number,
                            minutes_difference,
                        )
                        session_time_differences[video_file[:-4]].append(
                            minutes_difference
                        )
                        firstTime = False
                    if current_session is not None:
                        session_time_differences[current_session].append(
                            0
                        )  # end with a 0 difference
                    current_session = video_file[:-4]  # Update current session
                else:
                    session_time_differences[current_session].append(minutes_difference)
                    logger.debug(
                        "Run {} has a time difference of {} minutes",
                        run_number,
                        minutes_difference,
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
        clip = VideoFileClip(str(video_file))
        duration_seconds_video = clip.duration
        video_file = pathlib.Path(args.videos, f"{session}.mp4")
        clip = AudioFileClip(str(video_file))
        sample_rate_video = clip.fps

        # Change the video's audio sample rate to match the audio sample rate
        input_video = pathlib.Path(args.videos, f"{session}.mp4")
        output_video = pathlib.Path(args.videos, f"{session}_AUDIOADJUSTED.mp4")
        change_audio_sample_rate(input_video, output_video, sample_rate_audio)
        print("Audio SR: ", sample_rate_audio)
        print("Audio Duration (seconds):", duration_seconds_audio)
        print("Video Duration (seconds):", duration_seconds_video)
        print("Video Audio Sample Rate:", sample_rate_video)

        if duration_seconds_audio > duration_seconds_video:
            logger.warning(
                "Audio is longer than video {}, instead finding individually where in"
                " the video each run is, accuracy will vary",
                session,
            )
            new_run_number = cut_video_into_runs_individually(
                output_video,
                input_video,
                sample_rate_video,
                args.output_videos,
                args.runs,
                run_number,
                time_differences,
                [(0, 0), (0, (duration_seconds_video - 60) * sample_rate_audio)],
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
                int(lags[1] * (sample_rate_video / sample_rate_audio)),
                sample_rate_video,
                args.output_videos,
                run_number,
            )
        run_number = new_run_number
        os.remove(str(pathlib.Path(args.videos, f"{session}.wav")))
        os.remove(str(pathlib.Path(args.videos, f"{session}_AUDIOADJUSTED.mp4")))


if __name__ == "__main__":
    main()
