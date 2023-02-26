from __future__ import annotations

import argparse
import glob
import json
import pathlib
import random
import subprocess
from collections.abc import Callable, Iterable, Iterator
from typing import List, Optional, Union

import numpy as np

Path = Union[str, pathlib.Path]
Paths = List[Path]


def verbose_printer(quiet: bool, verbose: int) -> Callable[[str, int], None]:
    def inner(string: str, verbose_level: int = 1) -> None:
        if (verbose_level == 0 and not quiet) or (verbose >= verbose_level):
            print(string)

    return inner


def flatten(arr):
    for val in arr:
        if isinstance(val, Iterable) and not isinstance(val, str):
            yield from flatten(val)
        else:
            yield val


# https://stackoverflow.com/a/26026189
def get_nearest_index(array, value):
    i = np.searchsorted(array, value)
    if i > 0 and (
        i == len(array) or np.abs(value - array[i - 1]) < np.abs(value - array[i])
    ):
        return i - 1
    else:
        return i


def recurse_loads(string):
    """Recursively loads JSON contained in a string.
    For example, a JSON string might contain more nested JSON strings
    in the loaded dicts and arrays.
    """
    obj = string
    try:  # try to catch any JSON errors and obj not being dict errors
        if isinstance(obj, str):
            obj = json.loads(string)
        for key in obj.keys():  # load JSON from any strings, dicts, and arrays in obj
            if isinstance(obj[key], (str, dict)):
                obj[key] = recurse_loads(obj[key])
            elif isinstance(obj[key], list):
                for i in range(len(obj[key])):
                    obj[key][i] = recurse_loads(obj[key][i])
    finally:
        return obj


def random_color_generator(seed: Optional[int] = None) -> Iterator[str]:
    """Indefinitely generates random colors as hexadecimal strings.

    Parameters
    ----------
    seed : int, optional
        The seed to initialize the random number generator with.

    Yields
    -------
    str
        A hex color string in the form "#RRGGBB".
    """
    rng = random.Random(seed)  # Random instance because we don't want to share context
    while True:  # while True because this is an infinite generator
        r = rng.randrange(255)
        g = rng.randrange(255)
        b = rng.randrange(255)
        yield f"#{r:02x}{g:02x}{b:02x}"


def expand_files(files: Paths, wildcard=False, to_paths=False) -> Iterator[Path]:
    """Generates an expanded list of files.

    Parameters
    ----------
    files : str or list of str
    wildcard : bool, default=False
        Whether any of the file paths contain a wildcard ("*")
        that needs to be expanded.
    to_paths : bool, default=False
        Whether each file in the expanded files should be converted to `pathlib.Path`.

    Yields
    ------
    str or pathlib.Path
        If `wildcard` is `False`, this function simply yields the files. Otherwise, this
        function yields the files expanded from the wildcards in the files.
    """
    if isinstance(files, (str, pathlib.Path)):
        files = [files]
    if wildcard:
        # convert to str because glob doesn't work on pathlib.Path
        files = flatten([glob.glob(str(file)) for file in files])
    if to_paths:
        # map is an iterator so no need to do `yield from`
        files = map(pathlib.Path, files)
    yield from files


def mv(
    srcs: Paths, dest: str, wildcard: bool = False
) -> subprocess.CompletedProcess[str]:
    """Wrapper for the "mv" shell command.

    Parameters
    ----------
    srcs : str or list of str
        The paths of the files to move.
    dest : str
        The path to move the files to.
    wildcard : bool, default=False
        Whether any of the file paths contain a wildcard ("*")
        that needs to be expanded.

    Returns
    -------
    subprocess.CompletedProcess
        The completed process containing info about the "mv" command that was run.
    """
    return subprocess.run(
        ["mv", *expand_files(srcs, wildcard), dest], capture_output=True
    )


def rm(files: Paths, wildcard: bool = False) -> subprocess.CompletedProcess[str]:
    """Wrapper for the "rm" shell command.
    The "-r" and "-f" options are always passed.

    Parameters
    ----------
    files : str or list of str
        The paths of the files to remove.
    wildcard : bool, default=False
        Whether any of the file paths contain a wildcard ("*")
        that needs to be expanded.

    Returns
    -------
    subprocess.CompletedProcess
        The completed process containing info about the "rm" command that was run.
    """
    return subprocess.run(
        ["rm", "-r", "-f", *expand_files(files, wildcard)], capture_output=True
    )


def mkdir(dirs: Paths) -> subprocess.CompletedProcess[str]:
    """Wrapper for the "mkdir" shell command.

    Parameters
    ----------
    dirs : str or list of str
        The paths of the directories to create.

    Returns
    -------
    subprocess.CompletedProcess
        The completed process containing info about the "mkdir" command that was run.
    """
    return subprocess.run(["mkdir", *expand_files(dirs)], capture_output=True)


def ls(dir: Path) -> list[str]:
    """Wrapper for the "ls" shell command.

    Parameters
    ----------
    dir : str
        The path to the directory to list the contents of.

    Returns
    -------
    list of str
        The contents of the directory.
    """
    # using expand_files doesn't work because it includes the relative path in
    # each file name, i.e. expand_files(".") returns ["./file1.txt", "./file2.txt"]
    # but the actual ls command doesn't do that, it gives ["file1.txt", "file2.txt"]
    # which is what we want

    # stdout=subprocess.PIPE makes the output retrievable
    # .stdout retrieves the output as type bytes
    # .decode() converts bytes to str
    # the individual items are separated by newlines so split by newline into list
    # the last element in the list is always "" so exclude it with [:-1]
    return (
        subprocess.run(["ls", dir], stdout=subprocess.PIPE)
        .stdout.decode()
        .split("\n")[:-1]
    )


def ffmpeg(
    input: str,
    output: str,
    verbose: int = 0,
    input_options: Optional[list[str]] = None,
    output_options: Optional[list[str]] = None,
):
    """Wrapper for the `ffmpeg` command.
    Supports a single input and output.

    Parameters
    ----------
    input : str
        The file to input into `ffmpeg`.
    output : str
        The file for `ffmpeg` to output to. If a file at the path already exists,
        it will be overwritten.
    verbose : int, default=0
        If greater than or equal to 2, `ffmpeg`'s output to stdout will be printed.
    input_options : list of str, optional
        `ffmpeg` options to apply to the input file.
    output_options : list of str, optional
        `ffmpeg` options to apply to the output file.

    Returns
    -------
    subprocess.CompletedProcess
        The completed process containing info about the `ffmpeg` command that was run.
    """
    args = ["ffmpeg", "-y"]
    if input_options:
        args.extend(input_options)
    args.extend(["-i", input])
    if output_options:
        args.extend(output_options)
    args.append(output)
    return subprocess.run(args, capture_output=verbose < 2, check=True)


def audiowaveform(
    input: str,
    output: str,
    verbose: int = 0,
    split_channels: bool = False,
    options: Optional[list[str]] = None,
):
    """Wrapper for the `audiowaveform` command.

    Parameters
    ----------
    input : str
        The file to input into `audiowaveform`.
    output : str
        The file for `audiowaveform` to output to. If a file at the path already
        exists, it will be overwritten.
    verbose : int, default=0
        If greater than or equal to 2, `audiowaveforms`'s output to stdout will
        be printed.
    split_channels : boolean, default=False
        Generate a waveform for each channel instead of merging into 1 waveform.
    options : list of str, optional
        Additional options to pass in.

    Returns
    -------
    subprocess.CompletedProcess
        The completed process containing info about the `audiowaveform` command
        that was run.
    """
    args = ["audiowaveform", f"-i{input}", f"-o{output}", "-b", "8"]
    if split_channels:
        args.append("--split-channels")
    if options:
        args.extend(options)
    return subprocess.run(args, capture_output=verbose < 2, check=True)


# https://stackoverflow.com/a/5389547
def grouped(iterable: Iterable, n: int) -> zip:
    """Groups the elements of an iterable.

    Parameters
    ----------
    iterable : Iterable
    n : int
        The number of elements to put in each group.

    Returns
    -------

    Examples
    --------
    >>> iterable = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    >>> list(grouped(iterable, 3))
    [(1, 2, 3), (4, 5, 6), (7, 8, 9)]
    """
    return zip(*([iter(iterable)] * n))


# I really hate to include this class here, but argparse didn't add it until
# Python 3.9, and aria-data-tools uses Python 3.8. This action is really useful
# though, so I just copied this from the official implementation at
# https://github.com/python/cpython/blob/3.11/Lib/argparse.py#L878
class BooleanOptionalAction(argparse.Action):
    def __init__(
        self,
        option_strings,
        dest,
        default=None,
        type=None,
        choices=None,
        required=False,
        help=None,
        metavar=None,
    ):
        _option_strings = []
        for option_string in option_strings:
            _option_strings.append(option_string)

            if option_string.startswith("--"):
                option_string = "--no-" + option_string[2:]
                _option_strings.append(option_string)

        super().__init__(
            option_strings=_option_strings,
            dest=dest,
            nargs=0,
            default=default,
            type=type,
            choices=choices,
            required=required,
            help=help,
            metavar=metavar,
        )

    def __call__(self, parser, namespace, values, option_string=None):
        if option_string in self.option_strings:
            setattr(namespace, self.dest, not option_string.startswith("--no-"))

    def format_usage(self):
        return " | ".join(self.option_strings)
