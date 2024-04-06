import argparse
import importlib
from pathlib import Path
from typing import Any, TypedDict

import yaml

import log
import util
from log import logger

ERROR_MSG = (
    "The following error was encountered while running {} on {} with the arguments {}:"
)
NEXT_FILE_MSG = (
    'Because on_error is "next_file", the rest of the steps on this file will not'
    " be run and the pipeline will restart with the next file."
)
NEXT_STEP_MSG = (
    'Because on_error is "next_step", the rest of the steps will still be run on this'
    " file."
)


# this isn't an actual class, just a type for type hinting
class Step(TypedDict):
    script: str
    arguments: dict[str, Any]


def create_pipeline(steps: list[Step], on_error: str = "next_file"):
    # copy the dicts in the list because we're gonna add items to them
    steps = [step.copy() for step in steps]
    for step in steps:
        # replace / with . because modules use . to separate directories
        script_name = step["script"].replace("/", ".")
        if script_name.endswith(".py"):
            script_name = script_name[:-3]
        script = importlib.import_module(script_name)
        try:
            step["run_step"] = getattr(script, "run_from_pipeline")
        except AttributeError:
            raise AttributeError(
                f"{step['script']} is missing a run_from_pipeline function."
            )

    @log.Timer()
    def pipeline(file: Path):
        logger.debug("Running pipeline on {}", file)
        results = []
        for step in steps:
            # (shallow) copy because we're replacing the values that're strings
            arguments = step.get("arguments", {}).copy()
            for key, value in arguments.items():
                if isinstance(value, str):
                    # replace the file placeholders like {file.stem}
                    arguments[key] = value.format(file=file)
            try:
                results.append(step["run_step"](arguments))
            except Exception as err:
                logger.exception(ERROR_MSG, step["script"], file, arguments)
                if on_error == "next_file":
                    logger.warning(NEXT_FILE_MSG)
                    results.append(err)
                    return results
                elif on_error == "exit":
                    # exit instead of raising so exception isn't logged twice
                    exit(1)
                elif on_error == "next_step":
                    logger.warning(NEXT_STEP_MSG)
                    results.append(err)
        return results

    return pipeline


@logger.catch
@log.Timer(message="entire pipeline took {}")
def run_pipeline(
    config_path: Path,
    files: list[Path],
    dirs: list[Path],
    on_error: str = "next_file",
):
    config_yaml = config_path.read_text()
    config = yaml.safe_load(config_yaml)

    if files is None or len(files) == 0:
        files = config.get("files", [])
    if dirs is None or len(dirs) == 0:
        dirs = config.get("directories", [])

    if len(files) == 0 and len(dirs) == 0:
        raise ValueError(
            "You must give at least 1 file or directory in the command line or"
            " config file."
        )

    steps = config.get("steps", [])
    if len(steps) == 0:
        raise ValueError("At least 1 step must be specified in the config file.")
    pipeline = create_pipeline(steps, on_error)

    files = list(util.expand_files(files, to_paths=True))
    dirs = util.expand_files(dirs, to_paths=True)
    for dir in dirs:
        files.extend(dir.iterdir())

    errored_on = []
    for file in files:
        results = pipeline(file)
        if any(isinstance(result, Exception) for result in results):
            errored_on.append(file)
    if len(errored_on) > 0:
        logger.warning("The pipeline errored on the following files: {}", errored_on)


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
            ' pipeline. If "next_file" (the default), a warning message will be output'
            " and the pipeline will run on the next file--the pipeline will not finish"
            ' on the file that caused the error. If "next_step", a warning message will'
            " be output and the file that caused the error will be run through the"
            ' remaining steps. If "exit", the pipeline will exit with the error.'
        ),
    )
    log.add_log_level_argument(parser)

    args = vars(parser.parse_args())  # convert to dict to make it easier to pop
    log.setup_logging(args.pop("log_level"))
    with log.Timer("Running pipeline on all files took {}"):
        run_pipeline(
            args.pop("config"), args.pop("file"), args.pop("directory"), **args
        )
