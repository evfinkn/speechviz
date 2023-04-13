import argparse
import csv
import pathlib

import util


def main(survey_path: pathlib.Path, stats_path: pathlib.Path):
    with survey_path.open(newline="") as csvfile:
        reader = csv.DictReader(csvfile)
        for row in reader:
            stats_file = stats_path / f"run{row['run']}-stats.csv"
            data = {"type": row["type"], "eVal": row["eVal"]}
            util.add_to_csv(stats_file, data)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Add survey data to the stats csv files."
    )
    # path to survey data
    parser.add_argument(
        "survey_path",
        type=pathlib.Path,
        help=(
            "Path to the .csv file containing the survey data. The first row must be"
            " column headers and the file must have at least the following columns:"
            " run, type, eVal."
        ),
    )
    parser.add_argument(
        "stats_path", type=pathlib.Path, help="Path to the data/stats folder."
    )
    args = vars(parser.parse_args())
    main(**args)
