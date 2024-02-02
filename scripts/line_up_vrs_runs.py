import argparse
import os
import pathlib

import pandas as pd
from moviepy.video.io.VideoFileClip import VideoFileClip

import sync_audios


def save_run_info_to_csv(
    participant, video_file, output_csv, run_number, sample_offset, scene
):
    # Save run information to a CSV file
    header = ["Participant", "Video", "RunNumber", "SampleOffset, SessionScene"]
    if not os.path.exists(output_csv):
        with open(output_csv, "w") as csv_file:
            csv_file.write(",".join(header) + "\n")

    with open(output_csv, "a") as csv_file:
        csv_file.write(
            f"{participant},{video_file},{run_number},{sample_offset},{scene}\n"
        )


def get_lags(video_file, run_number, runs_folder):
    # Replace this function with your logic to load the corresponding audio file
    audio_file = pathlib.Path(runs_folder, f"run{run_number}.wav")
    audios, sr = sync_audios.load_audios([video_file, audio_file])
    lags, sr = sync_audios.get_audios_lags(audios)
    if lags < 0:
        print(
            f"Run {run_number} has negative lag {lags} seconds, likely lags were"
            " incorrectly calculated. Skipping this run."
        )
        return None, sr
    return sync_audios.get_audios_lags(audios), sr


def cut_video_into_runs(
    input_video, output_video, start_time, duration, sr, output_folder
):
    if not os.path.exists(output_folder):
        os.makedirs(output_folder)
    # Convert sample offset to seconds
    start_time_seconds = start_time / sr

    video_run = VideoFileClip(str(input_video)).subclip(
        start_time_seconds, start_time_seconds + duration
    )
    video_run.write_videofile(str(output_video))


def main():
    # Parse command-line arguments
    parser = argparse.ArgumentParser(
        description="Extract video segments based on CSV data."
    )
    parser.add_argument("--participant", type=str, required=True, help="Participant ID")
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
        "--output-csv",
        type=pathlib.Path,
        required=True,
        help="Path to the output CSV file",
    )
    parser.add_argument(
        "--output-videos",
        type=pathlib.Path,
        required=True,
        help="Path to the folder to contain output video files",
    )
    args = parser.parse_args()

    # Read CSV data
    data = pd.read_csv(args.csv)

    # Iterate through runs
    for index, row in data.iterrows():
        run_number = row["run"]
        vrs = row["VRSFile"]
        # replace .vrs at the end with .mp4
        video_file = vrs[:-4] + ".mp4"
        scene = row["SessionScene"]

        # Load corresponding audio files
        lags, sr = get_lags(
            pathlib.Path(args.videos, video_file), run_number, pathlib.Path(args.runs)
        )

        if lags is not None:
            # Obtain sample offset
            sample_offset = lags[
                1
            ]  # Assuming lags is a tuple (base_to_base, samples_from_beginning)
            save_run_info_to_csv(
                args.participant,
                video_file,
                args.output_csv,
                run_number,
                sample_offset,
                scene,
            )
            cut_video_into_runs(
                pathlib.Path(args.videos, video_file),
                pathlib.Path(args.output_videos, "run" + str(run_number) + ".mp4"),
                sample_offset,
                60,
                sr,
                args.output_videos,
            )


if __name__ == "__main__":
    main()
