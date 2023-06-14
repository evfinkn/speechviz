import argparse
import pathlib

import log
import util
from constants import AUDIO_EXTS, SCRIPTS_DIR, VIDEO_EXTS
from log import logger

TRANSCRIBE_SCRIPT = SCRIPTS_DIR / "transcribe"
BASE_MODEL = SCRIPTS_DIR / "models/whisper-base.en.bin"


def route_dir(dir, scan_dir=True, **kwargs):
    logger.trace(f"Running transcribe on each file in {dir}")
    for path in dir.iterdir():
        route_file(path, scan_dir=scan_dir, **kwargs)


def route_file(*paths: pathlib.Path, scan_dir=True, **kwargs):
    if len(paths) == 0:
        # if no file or directory given, use directory script was called from
        paths = [pathlib.Path.cwd()]
    elif len(paths) > 1:
        for path in paths:
            route_file(path, scan_dir=scan_dir, **kwargs)
        # stop function because all of the processing is
        # done in the function calls in the for loop
        return

    path = paths[0].absolute()  # paths[0] is--at this point--the only argument in paths

    # if file.path is an audio or video file, transcribe it
    if path.suffix.casefold() in AUDIO_EXTS or path.suffix.casefold() in VIDEO_EXTS:
        transcribe(path, **kwargs)

    # run process audio on every file in file.path if it is a dir and scan_dir is True
    elif path.is_dir() and scan_dir:
        if path.name == "data":
            # the data dir was passed so run on data/audio and data/video
            route_dir(path / "audio", scan_dir=scan_dir, **kwargs)
            route_dir(path / "video", scan_dir=scan_dir, **kwargs)
        else:
            route_dir(path, scan_dir=False, **kwargs)


def run_from_pipeline(args):
    paths = util.expand_files(args.pop("path"), to_paths=True)
    route_file(*paths, **args)


@log.Timer()
def transcribe(
    path: pathlib.Path,
    model: pathlib.Path = BASE_MODEL,
    max_len: int = 1,
    reprocess: bool = False,
):
    # if len(path.parents) < 2 or path.parents[1].name != "data":
    #     raise Exception("Input file must be in either data/audio or data/video")

    log.log_vars(log_separate_=True, path=path, model=model)
    log.log_vars(max_len=max_len, reprocess=reprocess)

    # transcriptions_dir = path.parents[1] / "transcriptions"
    # transcriptions_dir.mkdir(exist_ok=True)
    # transcription_path = transcriptions_dir / f"{path.stem}-transcription.json"
    for ancestor in path.parents:
        if ancestor.name == "audio" or ancestor.name == "video":
            if ancestor.parent.name == "data":
                data_dir = ancestor.parent
                parent_dir = path.parent.relative_to(ancestor)
                break
    # an else for a for loop is executed if break is never reached
    else:
        raise ValueError("Input file must be a descendant of data/audio or data/video.")

    transcriptions_dir = data_dir / "transcriptions"
    transcriptions_dir.mkdir(exist_ok=True)
    transcription_path = (
        transcriptions_dir / parent_dir / f"{path.stem}-transcription.json"
    )
    log.log_vars(
        log_separate_=True,
        data_dir=data_dir,
        parent_dir=parent_dir,
        transcription_path=transcription_path,
    )
    if transcription_path.exists() and not reprocess:
        logger.info(
            "{} has already been transcribed. To re-transcribe it, pass -r", path
        )
        return

    converted_path = path.parent / f"{path.stem}-pcm_s16le.wav"
    util.ffmpeg(
        path,
        converted_path,
        output_options=["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"],
    )

    log.run_and_log_subprocess(
        [
            TRANSCRIBE_SCRIPT,
            "-m",
            model,
            "-ml",
            str(max_len),
            "-i",
            converted_path,
            "-o",
            transcription_path,
        ]
    )
    logger.info("Transcription saved to {}", transcription_path)
    converted_path.unlink()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Transcribe speech in audio and video files."
    )
    parser.add_argument(
        "path",
        nargs="*",
        type=pathlib.Path,
        help="The path to the audio or video file to transcribe.",
    )
    parser.add_argument(
        "-m",
        "--model",
        type=pathlib.Path,
        default=BASE_MODEL,
        help="Path to the model to use.",
    )
    # parser.add_argument(
    #     "-ml",
    #     "--max-len",
    #     type=int,
    #     default=1,
    #     help=(
    #         "Maximum number of characters per time segment. Using 0 will set no"
    #         " maximum, and using 1 (the default) will give you word-level timestamps."
    #     ),
    # )
    parser.add_argument(
        "-r",
        "--reprocess",
        action="store_true",
        help="Re-transcribe audio files detected to have already been processed.",
    )
    log.add_log_level_argument(parser)

    args = vars(parser.parse_args())
    log.setup_logging(args.pop("log_level"))
    with log.Timer("Transcribing took {}"):
        route_file(*args.pop("path"), **args)
