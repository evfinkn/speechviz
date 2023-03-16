import argparse
import csv
import os
import pathlib

from util import add_to_csv


def main(
    input: pathlib.Path,
):
    grabFolder = str(input).split("_")
    folder = grabFolder[2].split(".")[0]
    print(folder)
    oldCsvFolder = os.path.join("data", "stats", folder)

    with open(args["input"]) as csvfile:
        reader = csv.reader(csvfile, delimiter=",")
        i = 0
        for row in reader:
            if i != 0:
                run = row[3]
                typeScale = row[4]
                score = row[6]
                dicti = {"type": typeScale, "eVal": score}
                add_to_csv(
                    pathlib.Path(
                        os.path.join(oldCsvFolder, "run" + run + "-stats.csv")
                    ),
                    dicti,
                )
            i += 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Add survey stats to the csv")
    # path to survey data
    parser.add_argument(
        "-i",
        "--input",
        type=pathlib.Path,
        required=True,
        help="path to uiowa survey data",
    )
    args = vars(parser.parse_args())
    main(**args)
