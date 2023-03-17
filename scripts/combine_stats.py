import argparse
import csv
import pathlib
import time

import util


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
    quiet: bool = False,
):
    if output_path.exists() and not reprocess:
        if not quiet:
            print(
                "The stats have already been combined. To resync them, use the -r"
                " argument."
            )
        return
    file_paths = flatten_dirs_to_files(*paths)
    fieldnames = ["file"]
    rows = []
    for file_path in file_paths:
        with file_path.open(newline="") as file:
            reader = csv.DictReader(file)
            extend_not_in(fieldnames, reader.fieldnames)
            row = next(reader)  # read first line of data (that isn't the fieldnames)
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
    parser.add_argument(
        "-q", "--quiet", action="store_true", help="Don't print anything."
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="count",
        default=0,
        help="Print various debugging information.",
    )

    args = vars(parser.parse_args())
    verbose = args.pop("verbose")  # pop because verbose isn't used in main
    start_time = time.perf_counter()
    route_file(args.pop("path"), args.pop("output"), **args)
    if not args["quiet"] or verbose:
        print(
            "Combining the stats took a total of"
            f" {time.perf_counter() - start_time:.4f} seconds"
        )
