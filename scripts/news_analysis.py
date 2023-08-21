import argparse
import json
import pathlib
import re
from typing import Optional, Sequence

from llama_cpp import Llama

from _types import PeaksGroup, Segment, TreeItem

# global variable for the model
llm = Llama(
    model_path="scripts/models/open-llama-13b-open-instruct.ggmlv3.q6_K.bin",
    verbose=False,
)


def prompt_open_llama(
    path: pathlib.Path,
    numbers,
    threshold,
    model,
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
        / "annotations"
        / parent_dir
        / f"{path.stem.replace('-transcription', '')}-annotations.json"
    )

    with open(segs_path, "r") as file:
        data = json.load(file)

    annotations = data.get("annotations", [])

    found = False
    for index, element in enumerate(annotations):
        if element.get("arguments") == ["News"]:
            found = True
            break
    # if "News" is already in segments and we don't
    # wish to reprocess, return and go to next file
    if found and not reprocess:
        print("File already processed")
        return

    with open(path, "r") as file:
        data = json.load(file)

    grouped_sentences = group_sentences(data, numbers, threshold)

    # llama 2 takes different instruction set
    # if model == "scripts/models/ggml-model-q4_0.bin":
    #     prompt_template = (
    #         "{instruction}\n\nClassifying the transcript as "
    #         "news or other in only one word, it is "
    #     )
    # else:
    #     prompt_template = (
    #         "Below is an instruction that describes a task. Write a response that"
    #         " appropriately completes the request.\n\n###"
    #         " Instruction:\n{instruction}\n\n### Response:"
    #     )
    prompt_template = (
        "Below is an instruction that describes a task. Write a response that"
        " appropriately completes the request.\n\n###"
        " Instruction:\n{instruction}\n\n### Response:"
    )

    pattern_other = r"\bother\b|\sother\s"
    pattern_news = r"\bnews\b|\snews\s"

    news_segs = []
    # news_times = []

    # non_news_times = []
    # non_news_segs = []

    for items in zip(*grouped_sentences):
        group = items[0]
        start = items[1]
        stop = items[2]

        # SAY DO IT IN JSON, OUTPUT A SINGLE CLASS
        prompt = (
            'Classify the Transcript as "news" or "other" in a one word answer of news'
            ' or other.\nTranscript: "{current_group}"'
        )

        inserted_prompt = prompt.format(current_group=group)
        inputt = prompt_template.format(instruction=inserted_prompt)

        # reset model state
        llm.reset()

        output = llm(inputt, max_tokens=100)

        print(output.get("choices")[0].get("text"))

        matches_other = re.findall(
            pattern_other, output.get("choices")[0].get("text").lower()
        )
        matches_news = re.findall(
            pattern_news, output.get("choices")[0].get("text").lower()
        )
        # whichever was said more news and other, that is what the answer is
        # err on side of other, need more news than other
        if len(matches_news) > len(matches_other):
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
        / "annotations"
        / parent_dir
        / f"{path.stem.replace('-transcription', '')}-annotations.json"
    )

    with open(segs_path, "r") as file:
        data = json.load(file)

    annotations = data.get("annotations", [])

    found = False
    for index, element in enumerate(annotations):
        if element.get("arguments") == ["News"]:
            # replace previous news
            annotations[index] = news
            found = True
            break
    if not found:
        # add news for first time
        annotations.append(news)

    data["annotations"] = annotations

    with open(segs_path, "w") as file:
        json.dump(data, file)


def group_sentences(data, numbers, threshold):
    paragraphs = []
    paragraph_start = []
    paragraph_stop = []
    current_paragraph = ""
    current_sentence_number = 0
    start = True

    prev_time = None

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

        # over `threshold` amount of time has happened since the last word, so we are
        # probably on another topic/speaker
        if (prev_time is not None and time - prev_time > threshold) or (
            len(label_text) + len(current_paragraph.strip()) > 800
        ):
            paragraphs.append(current_paragraph.strip())
            paragraph_stop.append(time)
            start = True
            current_paragraph = ""
            current_sentence_number = 0

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

        prev_time = time

    if current_paragraph:
        paragraphs.append(current_paragraph.strip())
        paragraph_stop.append(time)

    print(paragraphs)

    return [paragraphs, paragraph_start, paragraph_stop]


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


def main(args):
    route_file(*args.pop("path"), **args)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=(
            "Group sentences based on number of sentences and time between words from"
            " transcription file."
        )
    )
    parser.add_argument(
        "path",
        nargs="*",
        type=pathlib.Path,
        help="Path to the transcription JSON file",
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
        default=0.75,
        help="Time threshold for grouping sentences",
    )
    parser.add_argument(
        "-r",
        "--reprocess",
        action="store_true",
        help="Reprocess transcriptions detected to have already been processed",
    )
    parser.add_argument(
        "-m",
        "--model",
        type=str,
        default="scripts/models/open-llama-13b-open-instruct.ggmlv3.q6_K.bin",
        help="Pass in an llm model to classify news/other",
    )

    args = vars(parser.parse_args())

    print(args["model"])

    llm = Llama(
        model_path=args["model"],
        verbose=False,
    )
    main(args)
