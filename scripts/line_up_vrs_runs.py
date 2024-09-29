import argparse
from collections import defaultdict
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import cast

import librosa
import numpy as np
import pandas as pd
from moviepy.video.io.VideoFileClip import VideoFileClip

import log
import sync_audios
from _types import AnyFloat
from constants import FACE_BOXES_DIR
from log import logger

RunInfo = tuple[int, float, float, str]
"""Tuple containing the run number, start time, end time, and VRS file name."""


def combine_audio_files(
    runs_folder: Path,
    session: str,
    run_time_diffs: Sequence[tuple[int, float]],
) -> tuple[np.ndarray, float]:
    if len(run_time_diffs) == 0:
        raise ValueError(f"No runs for session {session}")
    logger.debug("Processing session {}", session)

    sr: float | None = None
    audios: list[np.ndarray] = []
    for run_number, time_difference in run_time_diffs:
        logger.debug(
            "Processing run {}, time difference: {}", run_number, time_difference
        )
        audio_file = runs_folder / f"run{run_number}.wav"
        # First run will set the sample rate, the rest will be resampled to it
        audio_segment, sr = librosa.load(audio_file, sr=sr, mono=True)
        # Add silent duration between audio clips
        silence_duration = int(time_difference * sr)  # Calculate duration in samples
        log.log_vars(run_number=run_number, sr=sr, silence_duration=silence_duration)
        if silence_duration > 0:
            silence_clip = np.zeros(silence_duration, dtype=audio_segment.dtype)
            audios.append(silence_clip)
        audios.append(audio_segment)

    combined_audio = np.concatenate(audios)
    logger.debug("Combined audio shape: {}", combined_audio.shape)
    logger.debug("Combined audio dtype: {}", combined_audio.dtype)
    # We know sr is not None because it was set in the loop. The loop runs at least
    # once since len(time_differences) > 0
    return combined_audio, sr  # type: ignore


def convert(seconds: float) -> str:
    seconds = seconds % (24 * 3600)
    hour = seconds // 3600
    seconds %= 3600
    minutes = seconds // 60
    seconds %= 60

    return "%d:%02d:%02d" % (hour, minutes, seconds)


def cut_video_into_runs(
    run_time_diffs: list[tuple[int, float]],
    video_file: Path,
    start_time: float,
    output_folder: Path,
    vrs: str,
    start_before: float = 45,  # seconds
    chunk_duration: float = 60,  # seconds
    dry_run: bool = False,
) -> list[RunInfo]:
    start_time = start_time - start_before

    if not dry_run:
        output_folder.mkdir(parents=True, exist_ok=True)

    video = VideoFileClip(str(video_file))

    run_times: list[RunInfo] = []
    # Loop through time differences
    for run_number, time_difference in run_time_diffs:
        start_time += time_difference
        if start_time > video.duration:
            logger.warning(
                "Run {} starts at {}, which is past the end of the video at {}",
                run_number,
                convert(start_time),
                convert(video.duration),
            )
            run_times.append((run_number, video.duration, video.duration, vrs))
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

        run_times.append((run_number, start_time, end_time, vrs))

        if not dry_run:
            # Define output path for the video chunk
            output_path = output_folder / f"run{run_number}.mp4"
            video_run = video.subclip(start_time, end_time)
            video_run.write_videofile(str(output_path))

    video.close()

    return run_times


def cut_video_into_runs_individually(
    video_audio: np.ndarray,
    sr: float,
    input_video_path: Path,
    output_folder: Path,
    runs_folder: Path,
    run_time_diffs: list[tuple[int, float]],
    bounds: Sequence[tuple[int, int]] | np.ndarray | None,
    vrs: str,
    start_before: float = 45,  # seconds
    chunk_duration: float = 60,  # seconds
    dry_run: bool = False,
) -> list[RunInfo]:
    if not dry_run:
        output_folder.mkdir(parents=True, exist_ok=True)

    video = VideoFileClip(str(input_video_path))

    run_times: list[RunInfo] = []
    for run_number, _ in run_time_diffs:
        try:
            audio_file = runs_folder / f"run{run_number}.wav"
            audio, _ = librosa.load(audio_file, sr=sr, mono=True)
            audios = [video_audio, audio]
            lags = sync_audios.get_audios_lags(audios, bounds, threshold=float("inf"))

            start_time_seconds = lags[1] / sr - start_before

            logger.debug(
                "Processing run {} with start time: {}", run_number, start_time_seconds
            )

            end_time_seconds = start_time_seconds + chunk_duration
            run_times.append((run_number, start_time_seconds, end_time_seconds, vrs))

            if not dry_run:
                # Define output path for the video chunk
                output_path = output_folder / f"run{run_number}.mp4"
                video_run = video.subclip(start_time_seconds, end_time_seconds)
                video_run.write_videofile(str(output_path))
        except Exception as e:
            logger.error("Error processing run {}", run_number)
            logger.exception(e)

    video.close()

    return run_times


def parse_datetime(value: str | AnyFloat) -> datetime:
    """Parse a datetime value from a string or a timestamp.

    Parameters
    ----------
    value : str or numeric
        The value to parse. If a string, it should be in the format "mm/dd/yy HH:MM".
        If numeric, it should be a timestamp in milliseconds since the epoch.
    """
    if isinstance(value, str):
        return datetime.strptime(value, "%m/%d/%y %H:%M")
    else:
        return datetime.fromtimestamp(cast(float, value / 1000), tz=UTC)


@log.Timer()
@logger.catch(reraise=True)
def main():
    # Parse command-line arguments
    parser = argparse.ArgumentParser(
        description="Extract video segments based on CSV data."
    )
    parser.add_argument(
        "--videos",
        type=Path,
        required=True,
        help="Path to the folder containing video files",
    )
    parser.add_argument(
        "--runs",
        type=Path,
        required=True,
        help="Path to the folder containing runs",
    )
    parser.add_argument(
        "--csv",
        type=Path,
        required=True,
        help="Path to the CSV file with evaluation data",
    )
    parser.add_argument(
        "--output-videos",
        type=Path,
        required=True,
        help="Path to the folder to contain output video files",
    )
    parser.add_argument(
        "--start-times",
        type=Path,
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
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run the script without changing any files (usually for debugging)",
    )
    log.add_log_level_argument(parser)

    args = parser.parse_args()
    log.setup_logging(args.log_level)

    # Resolve symlinks and convert to absolute to prevent any issues with relative paths
    videos_dir: Path = args.videos.resolve()
    run_dir: Path = args.runs.resolve()
    csv_path: Path = args.csv.resolve()
    output_videos_dir: Path = args.output_videos.resolve()

    dry_run: bool = args.dry_run

    start_before: float = args.start_before
    chunk_duration: float = args.chunk_duration

    if chunk_duration < 0:
        raise ValueError(f"Chunk duration must be positive, not {chunk_duration}")

    # Read CSV data
    data = pd.read_csv(csv_path)
    # Add a column to the dataframe to store the file name without the extension
    data = data.assign(File=[vrs[:-4] for vrs in data["VRSFile"]])

    start_times: dict[str, float] | None = None
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
        run_num: int
        start_time: float
        for _index, (run_num, start_time) in run_starts.iterrows():
            run = data[data["run"] == run_num].iloc[0]
            # cast is necessary because pandas is untyped. If we just did an annotation
            # as str, pyright would infer that file is Unknown | str.
            file = cast(str, run["File"])

            if file in start_times:
                continue
            if run["eTime"] == "NAN" or pd.isna(run["eTime"]):
                raise ValueError(f"eTime required for run {run_num}")

            # Calculate the start time of the first run for the VRS file
            first_run = data[data["File"] == file].iloc[0]
            logger.trace("Run {} is the first run for {}", first_run["run"], file)
            if first_run["run"] == run_num:
                start_times[file] = start_time
            else:
                if first_run["eTime"] == "NAN" or pd.isna(first_run["eTime"]):
                    raise ValueError(f"eTime required for run {first_run['run']}")
                logger.trace("Calculating first run's time using run {}", run_num)
                # run_date = parse_datetime(run["eTime"])
                # first_run_date = parse_datetime(first_run["eTime"])
                run_date = parse_datetime(run["eTime"])
                first_run_date = parse_datetime(first_run["eTime"])
                log.log_vars(run=run_num, first_run=first_run["run"])
                log.log_vars(run_date=run_date, first_run_date=first_run_date)
                # Number of seconds between their start times
                time_offset = (run_date - first_run_date).total_seconds()
                start_times[file] = start_time - time_offset
                log.log_vars(time_offset=time_offset, file_start_time=start_time)

        if any(pd.isna(start_time) for start_time in start_times.values()):
            raise ValueError("Start time required for all VRS files")

        for file in data["File"].unique():
            if file not in start_times:
                raise ValueError(f"Start time required for VRS file {file}")

        logger.debug("start_times=\n{}", start_times)

    prevTime: datetime | None = None
    currTime: datetime | None = None
    # Dict containing the runs and their time differences for each session. The item at
    # index i in the list has the amount of time between the run at i and the run at
    # i - 1, or 0 if item i is the first run in the session.
    session_info: dict[str, list[tuple[int, float]]] = defaultdict(list)

    # # dict containing (first_run, time differences) for each session
    # session_info: dict[str, tuple[int, list[float]]] = {}
    # # sort=False prevents pandas from sorting the data by the "File" column
    # for session, runs in data.groupby("File", sort=False)["run"]:
    #     session = cast(str, session)
    #     session_info[session] = (runs.min(), [])

    # Initialize the first session
    current_session = cast(str, data.iloc[0]["File"])

    # Iterate through runs
    for _, row in data.iterrows():
        run_number = cast(int, row["run"])
        session = cast(str, row["File"])

        log.log_vars(level_="TRACE", run=run_number, session=session)

        if row["eTime"] == "NAN" or pd.isna(row["eTime"]):
            # There is only 1 spot of NAN for eTime, and before it is 7:03,
            # after is 7:04, I assume there is no time difference between these
            # with changes in code this may
            # end with a 0 difference
            logger.error("Run {} has no eTime", row["run"])
            # session_info[current_session][1].append(0)
            continue

        if prevTime is None:
            logger.debug("First run is run {}", run_number)
            # start with a 0 difference
            # session_info[current_session][1].append(0)
            session_info[current_session].append((run_number, 0))
            prevTime = parse_datetime(row["eTime"])
            continue

        currTime = parse_datetime(row["eTime"])
        time_difference = (currTime - prevTime).total_seconds()

        # Check if session changed

        if session != current_session:
            logger.trace("Session changed from {} to {}", current_session, session)
            # end with a 0 difference
            # session_info[current_session][1].append(0)
            # start with a 0 difference
            time_difference = 0
            current_session = session  # Update current session
        else:
            logger.debug(
                "Run {} has a time difference of {} minutes",
                # We know run_number won't be unbound because it's set in the
                # `if prevTime is None` block on the first iteration
                run_number,  # type: ignore
                time_difference / 60,
            )

        # session_info[current_session][1].append(time_difference)
        session_info[current_session].append((run_number, time_difference))
        prevTime = currTime

    # session_info[current_session][1].append(0)  # end with a 0 difference
    logger.debug("session_time_differences=\n{}", session_info)

    run_times: list[RunInfo] = []
    # print(session_time_differences)
    # for session, (first_run, time_differences) in session_info.items():
    for session, run_time_diffs in session_info.items():
        video_path = videos_dir / f"{session}.mp4"

        if start_times is not None:
            logger.trace("Using calculated start times for session {}", session)
            new_run_times = cut_video_into_runs(
                run_time_diffs,
                video_path,
                start_times[session],
                output_videos_dir,
                session,
                start_before,
                chunk_duration,
                dry_run,
            )
            run_times.extend(new_run_times)
            continue

        audio_data, sr = combine_audio_files(run_dir, session, run_time_diffs)
        duration_seconds_audio = len(audio_data) / sr

        video_audio, _ = librosa.load(video_path, sr=sr, mono=True)
        duration_seconds_video = len(video_audio) / sr

        # Change the video's audio sample rate to match the audio sample rate
        logger.debug(
            "Session: {}, Audio/Video SR: {}, Audio Duration (seconds): {}, Video"
            " Duration (seconds): {}",
            session,
            sr,
            duration_seconds_audio,
            duration_seconds_video,
        )

        if duration_seconds_audio > duration_seconds_video:
            logger.warning(
                "Audio is longer than video {}, instead finding individually where in"
                " the video each run is, accuracy will vary",
                session,
            )
            new_run_times = cut_video_into_runs_individually(
                video_audio,
                sr,
                video_path,
                output_videos_dir,
                run_dir,
                run_time_diffs,
                [(0, 0), (0, int((duration_seconds_video - 60) * sr))],
                session,
                start_before,
                chunk_duration,
                dry_run,
            )
        else:
            audios = [video_audio, audio_data]
            duration_diff = duration_seconds_video - duration_seconds_audio
            lags = sync_audios.get_audios_lags(
                audios=audios,
                bounds=[(0, 0), (0, int((duration_diff - 60) * sr))],
                threshold=float("inf"),
            )

            new_run_times = cut_video_into_runs(
                run_time_diffs,
                video_path,
                lags[1] / sr,
                output_videos_dir,
                session,
                start_before,
                chunk_duration,
                dry_run,
            )

        run_times.extend(new_run_times)

    face_boxes_dir = FACE_BOXES_DIR / videos_dir.stem
    run_times_file = face_boxes_dir / "run_times.csv"
    logger.debug("Writing run times to {}", run_times_file)
    if not dry_run:
        # Write run times to a CSV file
        run_times_df = pd.DataFrame(
            run_times, columns=["run_number", "start_time", "end_time", "vrs"]
        )
        face_boxes_dir.mkdir(parents=True, exist_ok=True)
        run_times_df.to_csv(run_times_file, index=False, float_format="%.3f")


if __name__ == "__main__":
    main()
