# annotations removes the need to put quotes around types that are undefined at runtime
from __future__ import annotations

import argparse
import csv
import glob
import itertools
import random
import re
import subprocess
from operator import itemgetter
from pathlib import Path
from typing import Iterable, Iterator, Sequence, TypeVar

import numpy as np

try:
    import orjson as json
except ImportError:
    import json

from _types import KeyFunc, List2D, PathLike
from log import run_and_log_subprocess

T = TypeVar("T")  #: Generic type variable.
K = TypeVar("K")  #: Generic type variable for keys in a mapping.
V = TypeVar("V")  #: Generic type variable for values in a mapping.


class _Missing:
    pass


_missing = _Missing()


def split_path_at(
    path: PathLike, part: str, *, inclusive: bool = True
) -> tuple[Path, Path]:
    """Split a path at a given part, returning the paths before and after.

    Parameters
    ----------
    path : PathLike
        The path to split.
    part : str
        The part of the path to split at.
    inclusive : bool, default=True
        Whether to include the part in the paths.

    Returns
    -------
    tuple[Path, Path]
        The path before the part and the path after the part.

    Raises
    ------
    ValueError
        If the part is not in the path.

    Examples
    --------
    >>> audio_path = "/home/user/speechviz/data/audio/example.wav"
    >>> split_path_at(audio_path, "data")
    (PosixPath('/home/user/speechviz/data'), PosixPath('data/audio/example.wav'))
    >>> split_path_at(audio_path, "data", inclusive=False)
    (PosixPath('/home/user/speechviz'), PosixPath('audio/example.wav'))
    """
    path = Path(path)
    for parent in path.parents:
        if parent.name == part:
            if inclusive:
                return parent, path.relative_to(parent.parent)
            else:
                return parent.parent, path.relative_to(parent)
    raise ValueError(f"{part} is not in the path {path}")


def get_path_up_to(path: Path, part: str, *, inclusive: bool = True) -> Path:
    """Get the path up to a given part.

    See Also
    --------
    split_path_at : Split a path at a given part, returning the paths before and after.

    Examples
    --------
    >>> audio_path = "/home/user/speechviz/data/audio/example.wav"
    >>> get_path_up_to(audio_path, "data")
    PosixPath('/home/user/speechviz/data')
    >>> get_path_up_to(audio_path, "data", inclusive=False)
    PosixPath('/home/user/speechviz')
    """
    return split_path_at(path, part, inclusive=inclusive)[0]


def get_path_after(path: Path, part: str, *, inclusive: bool = True) -> Path:
    """Get the path after a given part.

    See Also
    --------
    split_path_at : Split a path at a given part, returning the paths before and after.

    Examples
    --------
    >>> audio_path = "/home/user/speechviz/data/audio/example.wav"
    >>> get_path_after(audio_path, "data")
    PosixPath('data/audio/example.wav')
    >>> get_path_after(audio_path, "data", inclusive=False)
    PosixPath('audio/example.wav')
    """
    return split_path_at(path, part, inclusive=inclusive)[1]


def expand_files(
    files: Iterable[PathLike], wildcard: bool = False, to_paths: bool = False
) -> Iterator[Path]:
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
    if isinstance(files, (str, Path)):
        files = [files]
    if wildcard:
        # convert to str because glob doesn't work on Path
        files = flatten([glob.glob(str(file)) for file in files])
    if to_paths:
        # map is an iterator so no need to do `yield from`
        files = map(Path, files)
    yield from files


def ffmpeg(
    input: str,
    output: str,
    *,
    input_options: list[str] | None = None,
    output_options: list[str] | None = None,
    check: bool = True,
) -> subprocess.CompletedProcess:
    """Wrapper for the `ffmpeg` command.
    Supports a single input and output.

    Parameters
    ----------
    input : str
        The file to input into `ffmpeg`.
    output : str
        The file for `ffmpeg` to output to. If a file at the path already exists,
        it will be overwritten.
    input_options : list of str, optional
        `ffmpeg` options to apply to the input file.
    output_options : list of str, optional
        `ffmpeg` options to apply to the output file.
    check : bool, default=True
        Whether to raise an exception if the command fails.

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
    return run_and_log_subprocess(args, check=check)


def audiowaveform(
    input: str,
    output: str,
    *,
    split_channels: bool = False,
    options: list[str] | None = None,
    check: bool = True,
) -> subprocess.CompletedProcess:
    """Wrapper for the `audiowaveform` command.

    Parameters
    ----------
    input : str
        The file to input into `audiowaveform`.
    output : str
        The file for `audiowaveform` to output to. If a file at the path already
        exists, it will be overwritten.
    split_channels : boolean, default=False
        Generate a waveform for each channel instead of merging into 1 waveform.
    options : list of str, optional
        Additional options to pass in.
    check : bool, default=True
        Whether to raise an exception if the command fails.

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
    return run_and_log_subprocess(args, check=check)


# functions that yield have return type Iterator (not Iterable)
def flatten(arr: Iterable) -> Iterator:
    for val in arr:
        if isinstance(val, Iterable) and not isinstance(val, str):
            yield from flatten(val)
        else:
            yield val


# https://stackoverflow.com/a/26026189
def get_nearest_index(array: Sequence[T], value: T) -> int:
    i = np.searchsorted(array, value)
    if i > 0 and (
        i == len(array) or np.abs(value - array[i - 1]) < np.abs(value - array[i])
    ):
        return i - 1
    else:
        return i


# https://stackoverflow.com/a/5389547
def grouped(iterable: Iterable[T], n: int) -> Iterator[tuple[T, ...]]:
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


def random_color_generator(seed: int | None = None) -> Iterator[str]:
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


def sort_and_regroup(lists: List2D[T], key: KeyFunc[T] | None = None) -> List2D[T]:
    flat = [(item, i) for i in range(len(lists)) for item in lists[i]]

    if key is None:
        key = itemgetter(0)
    else:
        key = lambda item: key(item[0])  # noqa: E731

    flat.sort(key=key)
    grouped = itertools.groupby(flat, key=itemgetter(1))
    return [[item[0] for item in list(g)] for _, g in grouped]


class AggregateData:
    def __init__(self, data: Sequence, ignore_nan: bool = True):
        self.data = data

        if ignore_nan:
            self.mean = np.nanmean(data, dtype=np.float64)
            self.median = np.nanmedian(data)
            self.std = np.nanstd(data, dtype=np.float64)
            self.max = np.nanmax(data)
            self.min = np.nanmin(data)
        else:
            self.mean = np.mean(data, dtype=np.float64)
            self.median = np.median(data)
            self.std = np.std(data, dtype=np.float64)
            self.max = np.amax(data)
            self.min = np.amin(data)


def min_key(d: dict[K, V], default: tuple[K, V] | _Missing = _missing) -> tuple[K, V]:
    """Returns the item from `d` with the minimum key."""
    if len(d) == 0 and default is not _missing:
        return default
    # if len(d) == 0 and default is _missing, this'll throw error like we want
    # itemgetter is faster than `lambda item: item[0]`
    return min(d.items(), key=itemgetter(0))


def max_key(d: dict[K, V], default: tuple[K, V] | _Missing = _missing) -> tuple[K, V]:
    """Returns the item from `d` with the maximum key."""
    if len(d) == 0 and default is not _missing:
        return default
    return max(d.items(), key=itemgetter(0))


def min_value(d: dict[K, V], default: tuple[K, V] | _Missing = _missing) -> tuple[K, V]:
    """Returns the item from `d` with the minimum value."""
    if len(d) == 0 and default is not _missing:
        return default
    return min(d.items(), key=itemgetter(1))


def max_value(d: dict[K, V], default: tuple[K, V] | _Missing = _missing) -> tuple[K, V]:
    """Returns the item from `d` with the maximum value."""
    if len(d) == 0 and default is not _missing:
        return default
    return max(d.items(), key=itemgetter(1))


def recurse_load_json(obj: str | dict | list) -> dict | list:
    """Recursively loads JSON contained in a string.

    This is preferred over `json.loads` because it can handle JSON strings
    that are nested within other JSON strings.

    Parameters
    ----------
    obj: str, dict, or list
        The object to load JSON from. If `obj` is a string, it will be loaded. If
        `obj` is a dict, the values will be recursively loaded. If `obj` is a list,
        the items will be recursively loaded.

    Examples
    --------
    >>> json_str = '{"key": "{\\"nested_key\\": \\"nested_value\\"}"}'
    >>> json.loads(json_str)
    {'key': '{"nested_key": "nested_value"}'}
    >>> load_json_str(json_str)
    {'key': {'nested_key': 'nested_value'}}
    """
    # use try in case obj is a string that isn't valid JSON
    try:
        if isinstance(obj, str):
            obj: dict | list = json.loads(obj)
        # the next ifs aren't elifs because we want to include obj loaded from str above
        if isinstance(obj, dict):
            obj = {key: recurse_load_json(obj[key]) for key in obj}
        if isinstance(obj, list):
            obj = [recurse_load_json(item) for item in obj]
    finally:
        return obj


def add_to_csv(path: Path, data: dict, remove_keys: list | None = None):
    """Updates the data in the specified CSV file.
    If the file doesn't exist, it is created. The first row of the CSV file is
    assumed to be the fieldnames and the second row is assumed to be the only
    other row. Fields in `data` are added to the end of the fields in the CSV.

    Parameters
    ----------
    path: pathlib.Path
        The path to the CSV file.
    data: dict
        The data to update the CSV file with. Fields in `data` that are already in
        the CSV are updated with the corresponding value, and fields that aren't are
        added.
    remove_keys: list of str or pattern, optional
        Keys to remove from the CSV, if present. The keys are removed before `data`
        is combined with the CSV data. If a key is a string, that key will be removed.
        If a key is a `re.Pattern`, any key that matches the pattern will be removed.
    """
    if path.exists():
        with path.open(newline="") as file:
            reader = csv.DictReader(file)
            try:
                read_data = next(reader)
            except StopIteration:
                read_data = {}  # empty file
        if remove_keys is not None:
            for key in remove_keys:
                if isinstance(key, str):
                    read_data.pop(key, None)
                elif isinstance(key, re.Pattern):
                    for k in list(read_data.keys()):
                        if key.match(k):
                            read_data.pop(k, None)
        read_data.update(data)
        data = read_data
    fieldnames = list(data.keys())
    with path.open("w", newline="") as file:
        writer = csv.DictWriter(file, fieldnames)
        writer.writeheader()
        writer.writerow(data)


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
