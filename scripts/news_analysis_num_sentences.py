import argparse
import json
import pathlib
import re
from typing import Optional, Sequence

from llama_cpp import Llama

from _types import PeaksGroup, Segment, TreeItem


def prompt_open_llama(
    path: pathlib.Path,
    numbers,
    reprocess=False,
):
    for ancestor in path.parents:
        if ancestor.name == "transcriptions":
            if ancestor.parent.name == "data":
                data_dir = ancestor.parent
                parent_dir = path.parent.relative_to(ancestor)
                break
    # an else for a for loop is executed if break is never reached
    else:
        raise ValueError("Input file must be a descendant of data/transcriptions.")

    print("Current file", path)

    segs_path = (
        data_dir
        / "segments"
        / parent_dir
        / f"{path.stem.replace('-transcription', '')}-segments.json"
    )

    with open(segs_path, "r") as file:
        data = json.load(file)

    found = False
    for index, element in enumerate(data):
        if element.get("arguments") == ["News"]:
            found = True
            break
    # if "News" is already in segments and we don't
    # wish to reprocess, return and go to next file
    if found and not reprocess:
        return

    with open(path, "r") as file:
        data = json.load(file)

    grouped_sentences = group_sentences(data, numbers)

    llm = Llama(
        model_path="scripts/models/open-llama-13b-open-instruct.ggmlv3.q6_K.bin",
        verbose=False,
    )

    prompt_template = (
        "Below is an instruction that describes a task. Write a response that"
        " appropriately completes the request.\n\n###"
        " Instruction:\n{instruction}\n\n### Response:"
    )

    pattern = r"\bother\b"

    news_segs = []
    # news_times = []

    # non_news_times = []
    # non_news_segs = []

    for items in zip(*grouped_sentences):
        group = items[0]
        start = items[1]
        stop = items[2]

        prompt = (
            'Classify the Transcript as "news" or "other" in a word.\nTranscript:'
            ' "{current_group}"'
        )

        inserted_prompt = prompt.format(current_group=group)
        inputt = prompt_template.format(instruction=inserted_prompt)

        output = llm(inputt, max_tokens=32)

        # print(inputt)
        print(output.get("choices")[0].get("text"))

        # if the answer did noet contain other, it was news
        matches = re.findall(pattern, output.get("choices")[0].get("text").lower())
        if not matches:
            print(start, stop)
            news_segs.append(format_segment(start, stop, "#880808", "News"))
            # news_times.append((start, end))

    news_options = {
        "parent": "Analysis",
        "copyTo": ["Labeled.children"],
        "childrenOptions": {"copyTo": ["Labeled.children"]},
        "children": news_segs,
    }
    news = format_peaks_group("News", news_options)

    # non_news_times = get_complement_times(news_times, duration)
    # non_news_segs =

    segs_path = (
        data_dir
        / "segments"
        / parent_dir
        / f"{path.stem.replace('-transcription', '')}-segments.json"
    )

    with open(segs_path, "r") as file:
        data = json.load(file)

    found = False
    for index, element in enumerate(data):
        if element.get("arguments") == ["News"]:
            # replace previous news
            data[index] = news
            found = True
            break
    if not found:
        # add news for first time
        data.append(news)

    with open(segs_path, "w") as file:
        json.dump(data, file)


def group_sentences(data, numbers):
    paragraphs = []
    paragraph_start = []
    paragraph_stop = []
    current_paragraph = ""
    current_sentence_number = 0
    start = True

    for item in data:
        label_text = item["labelText"]
        time = item["time"]

        current_paragraph += label_text + " "

        if start:
            paragraph_start.append(time)
            start = False

        # if it ends with a period we have to update what sentence we are on
        if label_text.endswith("."):
            current_sentence_number += 1

        # we have passed `numbers` amount of sentences or the context
        # would be too big for running, thus time for a new paragraph
        if (current_sentence_number >= numbers) or (
            len(label_text) + len(current_paragraph.strip()) > 900
        ):
            paragraphs.append(current_paragraph.strip())
            paragraph_stop.append(time)
            start = True
            current_paragraph = ""
            current_sentence_number = 0

    if current_paragraph:
        paragraphs.append(current_paragraph.strip())
        paragraph_stop.append(time)

    print(paragraphs)

    return [paragraphs, paragraph_start, paragraph_stop]


# currently unused, but should be able to use
# instead of number of sentences as an argument later
def group_sentences_threshold(data, threshold):
    sentences = []
    current_sentence = ""
    prev_time = None

    for item in data:
        label_text = item["labelText"]
        current_time = item["time"]

        # if we are not on the first one, and this word was within one second of the
        # last word or the prompt would make us run out of memory start a new group
        if (prev_time is not None and current_time - prev_time > threshold) or (
            len(current_sentence.strip()) + len(label_text) > 1000
        ):
            sentences.append(current_sentence.strip())
            current_sentence = ""

        current_sentence += label_text + " "
        prev_time = current_time

    if current_sentence:
        sentences.append(current_sentence.strip())

    return sentences


def format_segment(
    start: float, end: float, color: str, label: str, options: Optional[dict] = None
) -> Segment:
    # round start and end to save space in the json file and because many times from
    # the pyannote pipelines look like 5.3071874999999995 and 109.99968750000001
    start = round(start, 7)
    end = round(end, 7)
    peaks_seg = {"startTime": start, "endTime": end, "color": color, "labelText": label}
    return format_tree_item("Segment", [peaks_seg], options)


def format_tree_item(
    item_type: str, arguments: Sequence, options: Optional[dict] = None
) -> TreeItem:
    item = {"type": item_type, "arguments": arguments}
    if options is not None:
        item["options"] = options
    return item


def format_peaks_group(name: str, options: Optional[dict] = None) -> PeaksGroup:
    return format_tree_item("PeaksGroup", [name], options)


def route_dir(dir, scan_dir=True, **kwargs):
    for path in dir.iterdir():
        route_file(path, scan_dir=scan_dir, **kwargs)


def route_file(*paths: pathlib.Path, scan_dir=True, **kwargs):
    if len(paths) == 0:
        # if no file or directory given, use directory script was called from
        paths = [pathlib.Path.cwd()]
    # if multiple files (or directories) given, run function on each one
    elif len(paths) > 1:
        for path in paths:
            route_file(path, scan_dir=scan_dir, **kwargs)
        # stop function because all of the processing is
        # done in the function calls in the for loop
        return

    path = paths[0].absolute()  # paths[0] is--at this point--the only argument in paths

    # if file.path is a transcription json, analyze it
    if path.suffix.casefold() and path.suffix.casefold() in ".json":
        prompt_open_llama(path, **kwargs)
    # run process audio on every file in file.path if it is a dir and scan_dir is True
    elif path.is_dir() and scan_dir:
        # the data dir was passed so run on data/transcriptions
        if path.name == "data":
            route_dir(path / "transcriptions", scan_dir=scan_dir, **kwargs)
        else:
            route_dir(path, scan_dir=False, **kwargs)


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Group sentences based on number of sentences from transcription file."
        )
    )
    parser.add_argument(
        "path",
        nargs="*",
        type=pathlib.Path,
        help="Path to the JSON file",
    )
    parser.add_argument(
        "--numbers",
        type=int,
        default=4,
        help="Number of consecutive sentences to consider",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=1.0,
        help="Time threshold for grouping sentences",
    )
    parser.add_argument(
        "-r",
        "--reprocess",
        action="store_true",
        help="Reprocess transcriptions detected to have already been processed",
    )

    args = vars(parser.parse_args())
    # json_file = args.path
    # numbers = args.numbers

    route_file(*args.pop("path"), **args)


if __name__ == "__main__":
    main()
