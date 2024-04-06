import argparse
import json
import pathlib
from typing import Sequence

import log
import util
from _types import PeaksGroup, TreeItem
from constants import AUDIO_EXTS, DATA_DIR, SCRIPTS_DIR, VIDEO_EXTS
from log import logger

TRANSCRIBE_SCRIPT = SCRIPTS_DIR / "transcribe"
BASE_MODEL = SCRIPTS_DIR / "models/whisper-base.en.bin"


def format_tree_item(
    item_type: str, arguments: Sequence, options: dict | None = None
) -> TreeItem:
    item = {"type": item_type, "arguments": arguments}
    if options is not None:
        item["options"] = options
    return item


def format_peaks_group(name: str, options: dict | None = None) -> PeaksGroup:
    return format_tree_item("PeaksGroup", [name], options)


def format_word(id: str, labelText: str, time: float, options: dict | None = None):
    # round start and end to save space in the json file and because many times from
    # the pyannote pipelines look like 5.3071874999999995 and 109.99968750000001
    word = {"id": id, "labelText": labelText, "time": time}
    return format_tree_item("Word", [word], options)


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
    log.log_vars(log_separate_=True, path=path, model=model)
    log.log_vars(max_len=max_len, reprocess=reprocess)

    try:
        if "audio" in path.parts:
            parent_dir = path.parent.relative_to(DATA_DIR / "audio")
        elif "video" in path.parts:
            parent_dir = path.parent.relative_to(DATA_DIR / "video")
        else:
            raise ValueError()
    except ValueError:
        raise ValueError("Input file must be a descendant of data/audio or data/video.")

    transcriptions_dir = DATA_DIR / "transcriptions"
    transcription_path = (
        transcriptions_dir / parent_dir / f"{path.stem}-transcription.json"
    )
    transcription_path.parent.mkdir(exist_ok=True, parents=True)

    log.log_vars(
        log_separate_=True,
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

    # want to grab what transcribe.cpp output
    # and add it to annotations
    annotations_path = (
        DATA_DIR / "annotations" / parent_dir / f"{path.stem}-annotations.json"
    )
    annotations_path.parent.mkdir(exist_ok=True, parents=True)

    # open the transcription file to copy it over to annotations file
    with open(transcription_path, "r") as transc_file:
        transcription_output = json.load(transc_file)

    all_words = []

    point = 0

    for obj in transcription_output:
        label = obj["labelText"]
        time = obj["time"]
        all_words.append(format_word(f"point.{point}", label, time))
        point += 1

    words_options = {
        "parent": "Analysis",
        "children": all_words,
    }
    word_group = format_peaks_group("Words", words_options)

    with open(annotations_path, "r") as annot_file:
        annot_data = json.load(annot_file)

    annotations = annot_data.get("annotations", [])

    found = False

    for index, element in enumerate(annotations):
        if element.get("arguments") == ["Words"]:
            # replace previous words
            annotations[index] = word_group
            found = True
            break
    if not found:
        # add words for first time
        annotations.append(word_group)

    annot_data["annotations"] = annotations

    with open(annotations_path, "w") as file:
        json.dump(annot_data, file)

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
