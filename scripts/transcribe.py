import argparse
import pathlib
import subprocess
import time

import util

AUDIO_FILES = {".mp3", ".wav", ".flac", ".ogg", ".opus"}
VIDEO_FILES = {".mp4", ".mov"}

SCRIPTS_DIR = pathlib.Path(__file__).parent
TRANSCRIBE_SCRIPT = SCRIPTS_DIR / "transcribe"
BASE_MODEL = SCRIPTS_DIR / "models/whisper-base.en.bin"


def route_dir(dir, verbose=0, scan_dir=True, **kwargs):
    if verbose:
        print(f"Running transcribe on each file in {dir}")
    for path in dir.iterdir():
        route_file(path, verbose=verbose, scan_dir=scan_dir, **kwargs)


def route_file(*paths: pathlib.Path, verbose: int = 0, scan_dir=True, **kwargs):
    if len(paths) == 0:
        # if no file or directory given, use directory script was called from
        paths = [pathlib.Path.cwd()]
    elif len(paths) > 1:
        for path in paths:
            route_file(path, verbose=verbose, scan_dir=scan_dir, **kwargs)
        # stop function because all of the processing is
        # done in the function calls in the for loop
        return

    path = paths[0].absolute()  # paths[0] is--at this point--the only argument in paths

    # if file.path is an audio or video file, transcribe it
    if path.suffix.casefold() in AUDIO_FILES or path.suffix.casefold() in VIDEO_FILES:
        transcribe(path, verbose=verbose, **kwargs)

    # run process audio on every file in file.path if it is a dir and scan_dir is True
    elif path.is_dir() and scan_dir:
        if path.name == "data":
            # the data dir was passed so run on data/audio and data/video
            route_dir(path / "audio", verbose=verbose, scan_dir=scan_dir, **kwargs)
            route_dir(path / "video", verbose=verbose, scan_dir=scan_dir, **kwargs)
        else:
            route_dir(path, verbose=verbose, scan_dir=False, **kwargs)


def run_from_pipeline(args):
    paths = util.expand_files(args.pop("path"), to_paths=True)
    route_file(*paths, **args)


def transcribe(
    path: pathlib.Path,
    model: pathlib.Path = BASE_MODEL,
    max_len: int = 1,
    reprocess: bool = False,
    quiet: bool = False,
    verbose: int = 0,
):
    if len(path.parents) < 2 or path.parents[1].name != "data":
        raise Exception("Input file must be in either data/audio or data/video")

    vprint = util.verbose_printer(quiet, verbose)
    vprint(f"Transcribing {path}", 0)
    start_time = time.perf_counter()

    transcriptions_dir = path.parents[1] / "transcriptions"
    transcriptions_dir.mkdir(exist_ok=True)
    transcription_path = transcriptions_dir / f"{path.stem}-transcription.json"
    if transcription_path.exists() and not reprocess:
        vprint(
            f"{path} has already been transcribed. To re-transcribe it, use the -r"
            " argument",
            0,
        )
        return

    converted_path = path.parent / f"{path.stem}-pcm_s16le.wav"
    util.ffmpeg(
        path,
        converted_path,
        verbose,
        [],
        ["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"],
    )

    subprocess.run(
        [TRANSCRIBE_SCRIPT, "-m", model, "-ml", str(max_len), "-f", converted_path],
        capture_output=verbose < 2,
        check=True,
    )
    converted_transcriptions_path = (
        transcriptions_dir / f"{path.stem}-pcm_s16le-transcription.json"
    )
    converted_transcriptions_path.replace(transcription_path)
    converted_path.unlink()

    vprint(f"Transcribing took {time.perf_counter() - start_time:.4f} seconds", 1)


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
    parser.add_argument(
        "-q", "--quiet", action="store_true", help="Don't print anything."
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="count",
        default=0,
        help="Print various debugging information",
    )

    args = vars(parser.parse_args())
    route_file(*args.pop("path"), **args)
