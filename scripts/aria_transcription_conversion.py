import argparse
import csv
import json
import os

parser = argparse.ArgumentParser(
    description=(
        "Convert Aria's speech2text csv from sample dataset to a form usable by"
        " speechviz"
    )
)

parser.add_argument(
    "-i",
    "--input",
    type=str,
    required=True,
    help="path to csv for speech2text from aria dataset",
)
parser.add_argument(
    "-n",
    "--videoName",
    type=str,
    required=True,
    help=(
        "name of the video that this transcription corresponds to without its extension"
        " (.mp4 etc.)"
    ),
)

args = vars(parser.parse_args())

words = []
time = []

with open(args["input"]) as csvfile:
    reader = csv.reader(csvfile, delimiter=",")
    i = 0
    for row in reader:
        if i != 0:
            # calculate the center of each words time stamp and convert from ms to s
            averageTime = (int(row[0]) + int(row[1])) / 2000

            time.append(averageTime)
            words.append(row[2])
        i += 1

transcription = [{"labelText": w, "time": t} for w, t in zip(words, time)]
json = json.dumps(transcription)
with open(
    os.path.join("data", "transcriptions", args["videoName"] + "-transcription.json"),
    "w",
) as outfile:
    outfile.write(json)
