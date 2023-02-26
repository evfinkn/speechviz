import argparse
import importlib
import time
from pathlib import Path
from typing import Any, Dict, List, TypedDict

import util
import yaml


# this isn't an actual class, just a type for type hinting
class Step(TypedDict):
    script: str
    arguments: Dict[str, Any]


def create_pipeline(
    steps: List[Step], on_error: str = "next_file", quiet: bool = False
):
    # copy the dicts in the list because we're gonna add items to them
    steps = [step.copy() for step in steps]
    for step in steps:
        script_name = step["script"]
        if script_name.endswith(".py"):
            script_name = script_name[:-3]
        script = importlib.import_module(script_name)
        step["run_step"] = getattr(script, "run_from_pipeline")

    def pipeline(file: Path):
        for step in steps:
            # (shallow) copy because we're replacing the values that're strings
            arguments = step["arguments"].copy()
            for key, value in arguments.items():
                if isinstance(value, str):
                    # replace the file placeholders like {file.stem}
                    arguments[key] = value.format(file=file)
            try:
                step["run_step"](arguments)
            except Exception as err:
                if on_error == "next_file":
                    if not quiet:
                        print(
                            "WARNING: the following error was encountered while"
                            f" running {step['script']} on {file} with the arguments"
                            f" {arguments}:"
                        )
                        print(err)
                        print(
                            'Because on_error is "next_file", the rest of the steps on'
                            " this file will not be run and the pipeline will restart"
                            " with the next file."
                        )
                    return
                elif on_error == "exit":
                    print(
                        f"Encountered an error while running {file} through"
                        f" {step['script']} with the arguments {arguments}"
                    )
                    raise err
                elif on_error == "next_step":
                    if not quiet:
                        print(
                            "WARNING: the following error was encountered while"
                            f" running {step['script']} on {file} with the arguments"
                            f" {arguments}:"
                        )
                        print(err)
                        print(
                            'Because on_error is "next_step", the rest of the steps on'
                            " this file will still be run."
                        )
                    # this doesn't really need to be here but it's more explicit
                    continue

    return pipeline


def run_pipeline(
    config_path: Path,
    files: List[Path],
    dirs: List[Path],
    on_error: str = "next_file",
    quiet: bool = False,
    verbose: int = 0,
):
    config_yaml = config_path.read_text()
    config = yaml.safe_load(config_yaml)

    if files is None or len(files) == 0:
        files = config.get("files", [])
    if dirs is None or len(dirs) == 0:
        dirs = config.get("directories", [])

    if len(files) == 0 and len(dirs) == 0:
        raise Exception(
            "You must give at least 1 file or directory in the command line or"
            " config file."
        )

    steps = config.get("steps", [])
    if len(steps) == 0:
        raise Exception("At least 1 step must be specified in the config file.")
    pipeline = create_pipeline(steps, on_error, quiet)

    files = list(util.expand_files(files, to_paths=True))
    dirs = util.expand_files(dirs, to_paths=True)
    for dir in dirs:
        files.extend(dir.iterdir())
    for file in files:
        if verbose:
            print(f"Running the pipeline on {file}")
        pipeline(file)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Run files through the scripts given in the config file."
    )
    parser.add_argument(
        "config",
        type=Path,
        help=(
            "The YAML file containing the scripts to run and the arguments to run them"
            ' with. If neither "file" nor "directory" are specified on the command'
            " line, then the files and directories listed in the config file will be"
            " processed instead."
        ),
    )
    parser.add_argument(
        "-f",
        "--file",
        nargs="*",
        type=Path,
        help="A path to a file to run through the scripts specified in the config.",
    )
    parser.add_argument(
        "-d",
        "--directory",
        nargs="*",
        type=Path,
        help=(
            "A path to a directory. The pipeline will be run on each file in the"
            " directory."
        ),
    )
    parser.add_argument(
        "--on-error",
        choices=("next_file", "next_step", "exit"),
        default="next_file",
        help=(
            "What to do when an error is encountered in one of the steps of the"
            ' pipeline. If "next_file", a warning message will be output and the'
            " pipeline will run on the next file--the pipeline will not finish on the"
            ' file that caused the error. If "next_step", a warning message will be'
            " output and the file that caused the error will be run through the"
            ' remaining steps. If "exit", the pipeline will exit with the error.'
        ),
    )
    parser.add_argument(
        "-q", "--quiet", action="store_true", help="Don't print anything"
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="count",
        default=0,
        help="Print various debugging information",
    )

    args = vars(parser.parse_args())
    start_time = time.perf_counter()
    run_pipeline(args.pop("config"), args.pop("file"), args.pop("directory"), **args)
    if not args["quiet"] or args["verbose"]:
        print(
            f"The pipeline completed in {time.perf_counter() - start_time:.4f} seconds"
        )
