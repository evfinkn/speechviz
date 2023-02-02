import argparse
import csv
import os

parser = argparse.ArgumentParser(
    description=(
        "Convert Aria's location csv from sample dataset to a form usable by speechviz"
    )
)

parser.add_argument(
    "-i",
    "--input",
    type=str,
    required=True,
    help="path to csv for location from aria dataset",
)
parser.add_argument(
    "-n",
    "--videoName",
    type=str,
    required=True,
    help=(
        "name of the video that this pose corresponds to without its extension"
        " (.mp4 etc.)"
    ),
)

args = vars(parser.parse_args())

with open(args["input"]) as csvfile:
    reader = csv.reader(csvfile, delimiter=",")
    with open(
        os.path.join("data", "graphical", args["videoName"], "pose.csv"), "w"
    ) as outfile:
        writer = csv.writer(
            outfile, delimiter=",", quotechar='"', quoting=csv.QUOTE_NONE
        )
        i = 0
        writer.writerow(["t", "x", "y", "z", "qw", "qx", "qy", "qz"])
        for row in reader:
            if i == 1:
                timeOffset = row[0]
                writer.writerow(
                    [0, row[1], row[2], row[3], row[4], row[5], row[6], row[7]]
                )
            elif i != 0:
                # factor in offset from very first time value then convert from ns to s
                newTime = (int(row[0]) - int(timeOffset)) / 1000000000
                writer.writerow(
                    [newTime, row[1], row[2], row[3], row[4], row[5], row[6], row[7]]
                )
            i += 1
