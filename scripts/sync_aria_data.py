from __future__ import annotations

import argparse
import json
import pathlib

import librosa
import log
import numpy as np
import scipy.io.wavfile
import scipy.signal
import sync_audios
import util
from log import logger


# don't have separate functions for sync and hstack because doing them together
# in one ffmpeg command is a lot quicker than separating them
@log.Timer()
def sync_and_hstack_videos(
    video_paths: list[pathlib.Path],
    offsets: list[float],
    output_path: pathlib.Path,
    audio_path: pathlib.Path = None,
):
    """Trims the videos and stacks them left-to-right in columns.
    This assumes that the videos have the same height (an error will be thrown by
    ffmpeg otherwise). If audio_path is given, it is added to the final video.

    Parameters
    ----------
    video_paths : list of pathlib.Paths
        The paths to the videos to sync and hstack.
    offsets : list of floats
        The start times in seconds for each video. `offsets[i]` is the offset for
        `video_paths[i]`.
    output_path : pathlib.Path
        The path to save the processed video to.
    audio_path : pathlib.Path, optional
        If given, this audio is added to the output.

    Returns
    -------
    subprocess.CompletedProcess
        The completed process containing info about the `ffmpeg` command that was run.

    Raises
    ------
    Exception
        If `video_paths` has less than 2 elements.
    """
    if len(video_paths) < 2:
        raise Exception("video_paths must have at least 2 elements")
    args = ["ffmpeg", "-y"]

    for video_path, offset in zip(video_paths, offsets):
        minutes, seconds = divmod(offset, 60)
        hours, minutes = divmod(minutes, 60)
        # :02 pads to 2 zeros, i.e. if hours = 5, hours:02 = 05
        # .6f for 6 digits after the decimal point
        start = f"{int(hours):02}:{int(minutes):02}:{seconds:02.6f}"
        args.extend(["-ss", start, "-i", video_path])
    if audio_path is not None:
        args.extend(["-i", audio_path])

    filter_str = ""
    # add the index for each video for stack, e.g. "[0:v][1:v][2:v]"
    for i in range(len(video_paths)):
        filter_str += f"[{i}:v]"
    # add filter specifier. shortest=1 to use the length of the shortest video
    filter_str += f"hstack=inputs={len(video_paths)}:shortest=1[v]"
    args.extend(["-filter_complex", filter_str, "-map", "[v]", "-c:v", "libx264"])
    if audio_path is not None:
        # map the audio to the final output's audio
        # for "-map i:a" the i is the index of the input to get the audio from
        # since these indices are 0 indexed and we input the audio last,
        # the index of the audio file is len(video_paths)
        # "-c:a aac" to reencode the audio since mp4 doesn't support wav audio
        args.extend(["-map", f"{len(video_paths)}:a", "-c:a", "aac"])

    args.append(output_path)
    return log.run_and_log_subprocess(args)


@log.Timer()
def sync_poses(
    pose_paths: list[pathlib.Path],
    offsets: list[float],
    last_time: float,
    output_dir: pathlib.Path,
):
    """ """
    for i in range(len(pose_paths)):
        pose = np.genfromtxt(pose_paths[i], delimiter=",", skip_header=1)
        pose[:, 0] -= pose[0, 0]  # make the timestamps start at 0.0
        pose = pose[pose[:, 0] >= offsets[i]]  # filter out poses where times < offset
        pose = pose[pose[:, 0] <= last_time]  # trim to match length of audio and video
        trimmed_pose_path = output_dir / f"pose{i}.csv"
        if pose.shape[1] == 5:
            header = "t,qw,qx,qy,qz"
        else:
            header = "t,x,y,z,qw,qx,qy,qz"
        np.savetxt(trimmed_pose_path, pose, fmt="%.15f", delimiter=",", header=header)


def needs_reprocessed(output_dir: pathlib.Path, num_paths, reprocess=False):
    audios_need_synced = not output_dir.exists() or reprocess
    videos_need_synced = not output_dir.exists() or reprocess
    poses_need_synced = not output_dir.exists() or reprocess
    if not audios_need_synced:
        if not (output_dir / "microphones-mono.wav").exists():
            audios_need_synced = True
        if not (output_dir / "camera-slam-left.mp4").exists():
            # we need the offsets from sync_audios to sync the videos
            audios_need_synced = True
            videos_need_synced = True
        synced_pose_paths = [output_dir / f"pose{i}.csv" for i in range(num_paths)]
        if not all([path.exists() for path in synced_pose_paths]):
            # we need the offsets from sync_audios to sync the poses
            audios_need_synced = True
            poses_need_synced = True
    return audios_need_synced, videos_need_synced, poses_need_synced


@log.Timer()
def sync_aria_data(
    paths: list[pathlib.Path],
    output_dir: pathlib.Path,
    reprocess: bool = False,
    offsets: bool = True,
):
    """ """
    log.log_vars(
        log_separate_=True,
        paths=paths,
        output_dir=output_dir,
        reprocess=reprocess,
        offsets=offsets,
    )
    save_offsets = offsets  # rename to save_offsets to avoid confusion

    needs_resynced = needs_reprocessed(output_dir, len(paths), reprocess)
    if not any(needs_resynced):
        logger.info("Paths have already been synced. To resync them, pass -r")
        return

    # TODO: use offsets.json instead of always reprocessing audio
    #       also need to save last_time for that to work
    # we don't need resync_audios because at this point, audio needs to be synced
    # no matter what (because it's used for syncing videos and poses)
    _, resync_videos, resync_poses = needs_resynced

    output_dir.mkdir(parents=True, exist_ok=True)

    audio_paths = [path / "microphones-mono.wav" for path in paths]
    if not all([audio_path.exists() for audio_path in audio_paths]):
        raise Exception("One of the paths is missing microphones-mono.wav")
    # for path in paths:
    #     # prefer mono audio file because it takes up less memory
    #     if (audio_path := path / "microphones-mono.wav").exists():
    #         audio_paths.append(audio_path)
    #     elif (audio_path := path / "microphones.wav").exists():
    #         audio_paths.append(audio_path)
    #     else:
    #         raise Exception(f"No audio for {path} exists")

    # Load after getting paths so that we don't waste time loading only to
    # find a path without audio later
    audios = []
    srs = []
    for audio_path in audio_paths:
        # I know scipy.io.wavfile has a read method and that using it instead of
        # librosa.load would've meant 1 less import, but when I tried sync_audios
        # with audio loaded with scipy.io.wavfile, sync_audios ran forever.
        audio, sr = librosa.load(audio_path, sr=None)
        audios.append(audio)
        srs.append(sr)
    if not all([sr == srs[0] for sr in srs]):
        raise Exception(f"Audios must all have the same sample rate, but srs = {srs}")
    sr = srs[0]

    lags = sync_audios.get_audios_lags(audios)
    synced_audios = sync_audios.sync_audios(audios, lags, mode="trim")
    mixed_audio = sync_audios.mix_audios(synced_audios)
    mixed_audio_path = output_dir / "microphones-mono.wav"
    scipy.io.wavfile.write(mixed_audio_path, sr, mixed_audio)

    if save_offsets:
        offsets = [lag / sr for lag in lags]
        offsets_obj = {path.name: offset for path, offset in zip(paths, offsets)}
        with open(output_dir / "offsets.json", "w") as offsets_file:
            json.dump(offsets_obj, offsets_file)

    if resync_videos:
        video_paths = [path / "camera-slam-left.mp4" for path in paths]
        if all([video_path.exists() for video_path in video_paths]):
            mixed_video_path = output_dir / "camera-slam-left.mp4"
            sync_and_hstack_videos(
                video_paths, offsets, mixed_video_path, mixed_audio_path
            )
        else:
            logger.info("Skipping sync_and_hstack_videos (not all paths have a video)")
    else:
        logger.info("Videos have already been mixed. To reprocess them, pass -r")

    if resync_poses:
        pose_paths = [path / "pose.csv" for path in paths]
        if all([pose_path.exists() for pose_path in pose_paths]):
            last_time = len(mixed_audio) / sr
            sync_poses(pose_paths, offsets, last_time, output_dir)
        else:
            logger.info("Skipping sync_poses (not all paths have a pose file)")
    else:
        logger.info("Poses have already been synced. To reprocess them, pass -r")


def route_file(paths: list[pathlib.Path], output_dir: pathlib.Path, **kwargs):
    # I know there's is_file but not is_dir felt safer in my mind idk why
    if any([not path.is_dir() for path in paths]):
        raise Exception("All paths must be paths to directories")
    paths = [path.absolute() for path in paths]

    sync_aria_data(paths, output_dir, **kwargs)


def run_from_pipeline(args):
    # path should be a str or list of str so convert to list of Paths
    paths = util.expand_files(args.pop("path"), to_paths=True)
    output_dir = args.pop("output_dir", None) or args.pop("output-dir", None)
    route_file(list(paths), output_dir, **args)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Synchronize data from Aria glasses.")
    parser.add_argument(
        "path",
        nargs="*",
        type=pathlib.Path,
        help="Paths to the directories containing the Aria data to synchronize.",
    )
    parser.add_argument(
        "output_dir",
        type=pathlib.Path,
        help="The directory to output the synchronized data to.",
    )
    parser.add_argument(
        "-r",
        "--reprocess",
        action=util.BooleanOptionalAction,  # allows --no-reprocess
        default=False,
        help="Reprocess VRS files detected to have already been processed.",
    )
    parser.add_argument(
        "--offsets",
        action=util.BooleanOptionalAction,
        default=True,
        help="Save the offsets between the recordings. Default is True.",
    )
    log.add_log_level_argument(parser)

    args = vars(parser.parse_args())
    log.setup_logging(args.pop("log_level"))
    with log.Timer("Syncing took {}"):
        route_file(args.pop("path"), args.pop("output_dir"), **args)
