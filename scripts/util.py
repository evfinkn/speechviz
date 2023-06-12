# annotations removes the need to put quotes around types that are undefined at runtime
# such as types from a stub file (like what loguru uses)
from __future__ import annotations

import argparse
import csv
import datetime  # for type hinting Retention
import functools
import glob
import itertools
import json
import math
import operator
import pathlib
import random
import re
import subprocess
import sys
import time
import typing
from collections.abc import Callable, Iterable, Iterator
from typing import Any, List, Literal, Optional, TypeVar, Union

import loguru
import numpy as np
from loguru import logger

T = TypeVar("T")
Path = Union[str, pathlib.Path]
Paths = List[Path]
LogLevel = Literal[
    "TRACE",
    "DEBUG",
    "TIMING",
    "INFO",
    "SUCCESS",
    "WARNING",
    "ERROR",
    "CRITICAL",
]
Retention = Optional[Union[int, datetime.timedelta, str, Callable]]

_missing = object()
# between DEBUG (10) and INFO (20) (13 was kind of arbitrary but closer to debug)
# the icon is the unicode number for a clock emonji
TIMING_LEVEL = logger.level(
    "TIMING",
    no=13,
    # color="<fg #915cd6><bold>",  # light purple -- only works on Jupyter?
    color="<magenta><bold>",
    icon="\U0001F551",  # clock emoji (loguru's other levels use emojis for icons)
)
LOG_LEVELS = typing.get_args(LogLevel)  # get the tuple of levels from the Literal
SPEECHVIZ_DIR = pathlib.Path(__file__).parent.parent
DATA_DIR = SPEECHVIZ_DIR / "data"
LOGS_DIR = SPEECHVIZ_DIR / "logs"
LOGS_DIR.mkdir(exist_ok=True)


def setup_logging(
    level: LogLevel = "WARNING",
    *,
    calling_file: str = None,
    log_file_level: Optional[LogLevel] = "TRACE",
    retention: Retention = 3,
):
    """Sets the minimum severity level of messages to output to stderr and sets up
    logging to a file.

    Parameters
    ----------
    level : str, default="WARNING"
        The minimum severity level of messages to output to stderr. Must be one of
        "TRACE", "DEBUG", "TIMING", "INFO", "SUCCESS", "WARNING", "ERROR", or
        "CRITICAL".
    calling_file : str, optional
        The script that called this function. Defaults to the __main__ script. Used
        to name the log file. For example, if the main script is named "foo.py", the
        log file will be named "foo_{time}.log". The log file will be saved in the
        logs directory of Speechviz.
    log_file_level : str, default="TRACE"
        The minimum severity level of messages to output to the log file. Valid values
        are the same as for `level` or None. If None, no log file will be created.
    retention : int, datetime.timedelta, str, or callable, default=3
        A directive filtering old log files that should be removed. If None, no log
        files will be removed. For more information, see the `retention` section at
        https://loguru.readthedocs.io/en/stable/api/logger.html#file.

    Returns
    -------
    stderr_sink_id : int
        The ID of the sink for stderr.
    file_sink_id : int or None
        The ID of the sink for the log file, or None if no log file is being used.

    """
    level = level.upper()
    log_file_level = log_file_level.upper()
    # can't log the invalid level messages because the logger isn't set up yet
    invalid_levels_messages = []
    if level not in LOG_LEVELS:
        invalid_levels_messages.append(f"Invalid log level {level}.")
        level = "WARNING"
    if log_file_level not in LOG_LEVELS and log_file_level is not None:
        invalid_levels_messages.append(f"Invalid log file level {log_file_level}.")
        log_file_level = "TRACE"

    logger.remove()
    stderr_sink_id = logger.add(sys.stderr, level=level)
    if log_file_level is None:
        return stderr_sink_id, None  # not logging to a file
    if calling_file is None:
        try:
            import __main__

            calling_file = __main__.__file__
        except (ImportError, AttributeError):
            calling_file = "log.log"  # log file will be "log_{time}.log"
    log_path = LOGS_DIR / f"{pathlib.Path(calling_file).stem}_{{time}}.log"
    file_sink_id = logger.add(log_path, level=log_file_level, retention=retention)

    for message in invalid_levels_messages:
        logger.warning(message)

    return stderr_sink_id, file_sink_id


def add_log_level_argument(parser: argparse.ArgumentParser, *args, **kwargs):
    """Adds the --log-level argument to an `ArgumentParser`.

    The --log-level argument sets the minimum severity level of messages to output to
    stderr. The default is "WARNING". The default choices are "TRACE", "DEBUG",
    "TIMING", "INFO", "SUCCESS", "WARNING", "ERROR", and "CRITICAL".

    Parameters
    ----------
    parser : argparse.ArgumentParser
        The parser to add the argument to.
    *args, **kwargs
        Additional arguments to pass to `parser.add_argument`.
    """
    choices = kwargs.pop("choices", LOG_LEVELS)
    default = kwargs.pop("default", "WARNING")
    help_ = kwargs.pop(
        "help",
        f"The minimum severity level of messages to output. Default is {default}.",
    )
    parser.add_argument(
        "--log-level",
        *args,
        choices=choices,
        default=default,
        help=help_,
        **kwargs,
    )


# TODO: make the various log_ functions have consistent params and param names
# arguments are prefixed with "_" so that they don't conflict with the names of
# variables the user might want to log
def log_vars(
    _format: str = "{key}={val!r}",  # !r so that strings are quoted
    log_separate_: bool = False,
    _level: LogLevel = "DEBUG",
    # couldn't use a type alias because loguru.Record is from a stub file
    _patcher: Optional[Callable[[loguru.Record], None]] = None,
    _depth: int = 0,
    **kwargs,
):
    """Logs the values of variables.

    Parameters
    ----------
    _format : str, default="{key} = {val}"
        The format string to use when logging each variable. The format string should
        contain "{key}" and "{val}" placeholders. The "key" placeholder is replaced
        with the name of the variable, and the "val" placeholder is replaced with the
        value of the variable.
    _log_separate : bool, default=False
        Whether each variable should be logged on a separate line.
    _level : str, default="DEBUG"
        The severity level to log the variables at.
    _patcher : Patcher, optional
        A function that modifies a record before it is logged.
    _depth : int, default=0
        The depth of the caller in the stack. This is used to determine the correct
        source file and function name to log. (This usually doesn't need to be changed.)
    """
    # we want lazy if we're not logging separately so that we can pass a function
    vars_logger = logger.opt(depth=_depth + 1, lazy=not log_separate_)
    if _patcher is not None:
        vars_logger = vars_logger.patch(_patcher)

    if log_separate_:
        for key, val in kwargs.items():
            vars_logger.log(_level, _format, key=key, val=val)
    else:

        def build_message():
            return " ".join(
                _format.format(key=key, val=val) for key, val in kwargs.items()
            )

        # pass the message as a function so that it is only evaluated if the message is
        # actually logged
        vars_logger.log(_level, "{}", build_message)


def format_seconds(seconds: float, *, prec: int = 3) -> str:
    """Formats a number of seconds as HH:MM:SS[.ffffff]

    Parameters
    ----------
    seconds : float
        The number of seconds to format.
    prec : int, default=3
        The number of decimal places to include in the fractional seconds.

    Returns
    -------
    str
        The formatted time string.

    Examples
    --------
    >>> format_seconds(123.456)
    '00:02:03.456'
    >>> format_seconds(123.456, prec=0)
    '00:02:03'
    >>> format_seconds(123.456789, prec=4)
    '00:02:03.4568'
    """
    m, s = divmod(seconds, 60)
    h, m = divmod(m, 60)
    frac_s, s = math.modf(s)  # split into fractional and integer parts
    frac_s = f"{frac_s:.{prec}f}"[2:]  # remove leading "0."
    string = f"{h:02.0f}:{m:02.0f}:{s:02.0f}"
    if prec > 0:
        string += f".{frac_s}"
    return string


def log_timing(
    seconds: float,
    message: str = "took {}",
    *args,
    prec: int = 6,
    _patcher: Optional[Callable[[loguru.Record], None]] = None,
    _depth: int = 0,
    **kwargs,
):
    """Logs timing information.

    Parameters
    ----------
    seconds : float
        The number of seconds taken.
    message : str, optional
        The message to log. Use "{}" to indicate where the time taken should be
        inserted. The time taken is the first positional argument passed to the
        message. Additional positional and keyword arguments can be passed to the
        message using the `args` and `kwargs` parameters.
    prec : int, default=6
        The number of decimal places to include when logging the time taken.
    _patcher : Patcher, optional
        A function that modifies a record before it is logged.
    _depth : int, default=0
        The depth of the caller in the stack. This is used to determine the correct
        source file and function name to log. (This usually doesn't need to be changed.)

    See Also
    --------
    format_seconds : Format a number of seconds as HH:MM:SS[.ffffff]
    loguru.Logger.patch : Attach a function to modify records before they are logged.
    """
    timing_logger = logger.opt(depth=_depth + 1)
    if _patcher is not None:
        timing_logger = timing_logger.patch(_patcher)
    timing_logger.log(
        "TIMING", message, format_seconds(seconds, prec=prec), *args, **kwargs
    )


# TODO: make Timer's message use {time_taken} instead of {} so that it's easier to pass
#       in additional args and kwargs without needing time taken to be the first
class Timer:
    """A context manager / function wrapper for timing code blocks.

    Parameters
    ----------
    message : str, optional
        The message to log when the timer is stopped. If not provided, the message will
        be "took {time_taken}" when used as a context manager and "{function.__name__}
        took {time_taken}" when used as a function decorator. When providing a message,
        use "{}" to indicate where the time taken should be inserted. The time taken
        is the first positional argument passed to the message. Additional positional
        and keyword arguments can be passed to the message using the `args` and
        `kwargs` parameters of the `stop` method or the `log` method.
    prec : int, default=3
        The number of decimal places to include when logging the time taken.
    log : bool, default=True
        Whether to log the time taken when the timer is stopped.

    Examples
    --------
    >>> # Note that the actual time_taken will slightly differ from these examples

    >>> with Timer():
    ...     time.sleep(1)
    {time} | TIMING | {name}:{function}:{line} - took 00:00:01.000

    >>> @Timer()  # to use as a decorator, still need to use parens
    ... def test():
    ...     time.sleep(2.51)
    >>> test()
    {time} | TIMING | {name}:test:{line} - test took 00:00:02.510

    >>> with Timer("custom message, took {}", prec=0) as timer:
    ...     time.sleep(1)
    {time} | TIMING | {name}:{function}:{line} - custom message, took 00:00:01
    >>> timer.time_taken
    1.0

    >>> timer = Timer(log=False)
    >>> timer.start()
    >>> time.sleep(1)
    >>> timer.stop()
    >>> timer.time_taken
    1.0
    >>> timer.log("manually using Timer, slept {}", prec=1)
    {time} | TIMING | {name}:{function}:{line} - manually using Timer, slept 00:00:01.0
    >>> timer.log("{}, extra arg={}", "xyz")
    {time} | TIMING | {name}:{function}:{line} - 00:00:01.000, extra arg=xyz
    """

    # TODO: add format option for the time taken
    def __init__(
        self, message: Optional[str] = None, *, prec: int = 3, log: bool = True
    ):
        self.message = message
        self.prec = prec
        self.log_on_exit = log

        # set these so that they're defined even if the timer hasn't started or stopped
        self.start_time = float("nan")
        self.stop_time = float("nan")
        self.time_taken = float("nan")

    def __enter__(self):
        self.start_time = time.perf_counter()
        return self

    def __exit__(self, *args, **kwargs):
        # stop before checking start_time so that stop_time is still accurate
        self.stop_time = time.perf_counter()

        if math.isnan(self.start_time):
            logger.warning("Timer was stopped before it was started.")

        self.time_taken = self.stop_time - self.start_time
        if self.log_on_exit:
            # depth=1 to remove __exit__ from the stack
            self.log(*args, _depth=1, **kwargs)

    start = __enter__
    stop = __exit__

    def log(
        self,
        *args,
        message: Optional[str] = None,
        prec: Optional[int] = None,
        _depth: int = 0,
        **kwargs,
    ):
        """Log the time taken by the timer.

        Parameters
        ----------
        message : str, optional
            The message to log. Defaults to the message provided when the timer was
            created.
        prec : int, optional
            The number of decimal places to include when logging the time taken.
            Defaults to the precision provided when the timer was created.
        *args, **kwargs
            Additional positional and keyword arguments to pass to the `log_timing`.

        See Also
        --------
        log_timing : Log timing information.
        """
        if math.isnan(self.time_taken):
            if math.isnan(self.start_time):
                logger.warning("Timer.log was called before the timer was started.")
            else:
                logger.warning("Timer.log was called before the timer was stopped.")

        if message is None:
            message = self.message if self.message is not None else "took {}"
        prec = self.prec if prec is None else prec
        log_timing(
            self.time_taken,
            message,
            *args,
            prec=prec,
            _depth=_depth + 1,
            **kwargs,
        )

    def __call__(self, func):
        return self._wrap(func)

    def _wrap(self, func: Callable) -> Callable:
        log_on_exit = self.log_on_exit
        message = self.message
        if message is None:
            message = f"{func.__name__} took {{}}"
        # Copy the timer so that we can set log_on_exit to False without affecting the
        # original timer. We set log_on_exit to False because if we want to log, we
        # need to call log manually so that we can pass in the function name patcher
        # Copying is also beneficial because iaqt allows us to use the same timer for
        # multiple functions without messing up the start_times
        timer = type(self)(message, prec=self.prec, log=False)

        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            # Need to patch the function name and module because loguru retrieves them
            # from the stack frame, but @wraps doesn't change those, just the attributes
            # Basically, this fixes loguru saying `util:wrapper:{line}` instead of
            # the actual module and function name
            # https://github.com/Delgan/loguru/issues/74
            def func_attrs_patcher(record: loguru.Record):
                record["function"] = func.__name__
                record["module"] = func.__module__
                record["name"] = func.__module__

            with timer:
                result = func(*args, **kwargs)
            if log_on_exit:
                timer.log(_patcher=func_attrs_patcher)
            return result

        return wrapper


def shorten_str(string: str, max_length: int = 50) -> str:
    """Shortens a string to the given length by replacing the middle
    with an ellipsis.

    Parameters
    ----------
    string : str
        The string to shorten.
    max_length : int, optional
        The maximum length of the string.

    Returns
    -------
    str
        The shortened string.
    """
    if len(string) <= max_length:
        return string
    else:
        return string[: max_length // 2 - 2] + "..." + string[-max_length // 2 + 1 :]


def shorten_data_path(path: Path, max_length: int = 50) -> str:
    path = pathlib.Path(path)
    string = str(path)
    if len(string) <= max_length:
        return string
    else:
        if DATA_DIR in path.parents:
            return "..." + str(path.relative_to(DATA_DIR))
        else:
            parts = [str(part).casefold() for part in path.parts]
            if "data" in parts:
                data_index = parts.index("data")
                return "..." + str("/".join(path.parts[data_index + 1 :]))
            else:
                return shorten_str(string, max_length)


def verbose_printer(quiet: bool, verbose: int) -> Callable[[str, int], None]:
    def inner(string: str, verbose_level: int = 1) -> None:
        if (verbose_level == 0 and not quiet) or (verbose >= verbose_level):
            print(string)

    return inner


def flatten(arr: Iterable) -> Iterator:
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


def run_and_log_subprocess(
    args: list[str],
    *,
    check: bool = True,
    _level: LogLevel = "DEBUG",
    _depth: int = 0,
) -> subprocess.CompletedProcess:
    subprocess_logger = logger.opt(depth=_depth + 1)
    subprocess_logger.log(_level, f"Running subprocess: {args}")

    # have to time manually so that we can pass _depth to timer.log
    # (to get the correct function name in the log)
    timer = Timer(log=False)
    timer.start()
    # Specify stdout and stderr like this to capture output in 1 stream instead of 2
    # This way, the subprocess output is in the order it was generated
    # text=True gets the output as a string instead of bytes
    completed_process = subprocess.run(
        args,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=False,
    )
    timer.stop()

    subprocess_logger.log(
        _level,
        "returncode={} time_taken={}",
        completed_process.returncode,
        timer.time_taken,
    )
    subprocess_logger.log(_level, "stdout=\n\033[0m{}", completed_process.stdout)

    if check:
        completed_process.check_returncode()
    return completed_process


def ffmpeg(
    input: str,
    output: str,
    *,
    input_options: Optional[list[str]] = None,
    output_options: Optional[list[str]] = None,
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
    options: Optional[list[str]] = None,
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


def add_to_csv(path: pathlib.Path, data: dict, remove_keys: Optional[list] = None):
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


def min_key_item(d: dict, default=_missing):
    """Returns the item from `d` with the minimum key."""
    # itemgetter is faster than `lambda item: item[0]`
    if len(d) == 0 and default is not _missing:
        return default
    # if len(d) == 0 and default is _missing, this'll throw error like we want
    return min(d.items(), key=operator.itemgetter(0))


def max_key_item(d: dict, default=_missing):
    """Returns the item from `d` with the maximum key."""
    if len(d) == 0 and default is not _missing:
        return default
    return max(d.items(), key=operator.itemgetter(0))


def min_value_item(d: dict, default=_missing):
    """Returns the item from `d` with the minimum value."""
    if len(d) == 0 and default is not _missing:
        return default
    return min(d.items(), key=operator.itemgetter(1))


def max_value_item(d: dict, default=_missing):
    """Returns the item from `d` with the maximum value."""
    if len(d) == 0 and default is not _missing:
        return default
    return max(d.items(), key=operator.itemgetter(1))


def sort_and_regroup(
    lists: List[List[T]], key: Callable[[T], Any] = None
) -> List[List[T]]:
    flat = [(item, i) for i in range(len(lists)) for item in lists[i]]

    if key is None:
        key = operator.itemgetter(0)
    else:
        key = lambda item: key(item[0])  # noqa: E731

    flat.sort(key=key)
    grouped = itertools.groupby(flat, key=operator.itemgetter(1))
    return [[item[0] for item in list(g)] for _, g in grouped]


class AggregateData:
    def __init__(self, data, ignore_nan: bool = True):
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
