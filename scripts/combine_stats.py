import argparse
import csv
import pathlib

import log
import util
from log import logger


def flatten_dirs_to_files(*paths: pathlib.Path):
    file_paths = []
    for path in paths:
        if path.is_dir():
            file_paths.append(flatten_dirs_to_files(*path.iterdir()))
        else:
            file_paths.append(path)
    yield from util.flatten(file_paths)


def extend_not_in(to_extend: list, extend_with: list):
    to_extend.extend([item for item in extend_with if item not in to_extend])


def main(
    paths: pathlib.Path,
    output_path: pathlib.Path,
    reprocess: bool = False,
):
    if output_path.exists() and not reprocess:
        logger.info("The stats have already been combined. To resync them, pass -r")
        return
    file_paths = flatten_dirs_to_files(*paths)
    fieldnames = ["file"]
    rows = []
    for file_path in file_paths:
        with file_path.open(newline="") as file:
            reader = csv.DictReader(file)
            # we use a list instead of a set because we want to preserve the order,
            # but we don't want duplicates, hence the use of extend_not_in
            extend_not_in(fieldnames, reader.fieldnames)
            for row in reader:  # read the data (this doesn't include the header row)
                if row.get("file") is not None:
                    # this CSV is from a file that has already been combined, so we
                    # add this CSV's file name to the beginning of the file column
                    row["file"] = f"{file_path.stem} {row['file']}"
                else:
                    row["file"] = file_path.stem
                rows.append(row)
    with output_path.open("w", newline="") as output:
        writer = csv.DictWriter(output, fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def route_file(paths, output_path: pathlib.Path, **kwargs):
    paths = [path.absolute() for path in paths]
    main(paths, output_path.absolute(), **kwargs)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Combine stats files into one CSV.")
    parser.add_argument(
        "path",
        nargs="*",
        type=pathlib.Path,
        help="Paths to the files to sync. Directories will be flattened.",
    )
    parser.add_argument(
        "output", type=pathlib.Path, help="The path to output the combined stats to."
    )
    parser.add_argument(
        "-r",
        "--reprocess",
        action=util.BooleanOptionalAction,
        default=False,
        help='Recombine the stats even if "output" already exists. Default is False.',
    )
    log.add_log_level_argument(parser)

    args = vars(parser.parse_args())
    log.setup_logging(args.pop("log_level"))
    with log.Timer("Combining the stats took {}"):
        route_file(args.pop("path"), args.pop("output"), **args)
