# annotations removes the need to put quotes around types that are undefined at runtime
from __future__ import annotations

import functools
import math
import pathlib
import subprocess
import sys
import time
from typing import TYPE_CHECKING, Callable

from loguru import logger

from _types import LogLevel, PathLike, Retention
from constants import DATA_DIR, LOGS_DIR

if TYPE_CHECKING:
    # argparse is only used for type checking
    import argparse

    # loguru.Record is from a stub file so it isn't actually defined at runtime
    # Without __future__.annotations and this if statement, this file would error
    from loguru import Record

    Patcher = Callable[[Record], None] | None

LOG_LEVELS = [
    "TRACE",
    "DEBUG",
    "TIMING",
    "INFO",
    "SUCCESS",
    "WARNING",
    "ERROR",
    "CRITICAL",
]
TIMING_LEVEL = logger.level(
    "TIMING",
    no=13,
    # color=logger.level("INFO").color,
    color="<magenta><bold>",
    icon="\U0001f551",
)


def setup_logging(
    level: LogLevel = "WARNING",
    *,
    calling_file: str | None = None,
    log_file_level: LogLevel = "TRACE",
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


# TODO: make the various log_ functions have consistent params and param names
# arguments are suffixed with "_" so that they don't conflict with the names of
# variables the user might want to log
def log_vars(
    message_: str = "{key}={val!r}",  # !r so that strings are quoted
    log_separate_: bool = False,
    level_: LogLevel = "DEBUG",
    patcher_: Patcher = None,
    depth_: int = 0,
    **kwargs,
):
    """Logs the values of variables.

    Parameters
    ----------
    format_ : str, default="{key} = {val}"
        The format string to use when logging each variable. The format string should
        contain "{key}" and "{val}" placeholders. The "key" placeholder is replaced
        with the name of the variable, and the "val" placeholder is replaced with the
        value of the variable.
    log_separate_ : bool, default=False
        Whether each variable should be logged on a separate line.
    level_ : str, default="DEBUG"
        The severity level to log the variables at.
    patcher_ : Patcher, optional
        A function that modifies a record before it is logged.
    depth_ : int, default=0
        The depth of the caller in the stack. This is used to determine the correct
        source file and function name to log. This usually doesn't need to be changed.
    """
    # we want lazy if we're not logging separately so that we can pass a function
    vars_logger = logger.opt(depth=depth_ + 1, lazy=not log_separate_)
    if patcher_ is not None:
        vars_logger = vars_logger.patch(patcher_)

    if log_separate_:
        for key, val in kwargs.items():
            vars_logger.log(level_, message_, key=key, val=val)
    else:

        def build_message():
            return " ".join(
                message_.format(key=key, val=val) for key, val in kwargs.items()
            )

        # pass the message as a function so that it is only evaluated if the message is
        # actually logged
        vars_logger.log(level_, "{}", build_message)


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


# TODO: suffix seconds, message, and prec with _
def log_timing(
    seconds: float,
    message: str = "took {}",
    *args,
    prec: int = 6,
    patcher_: Patcher = None,
    depth_: int = 0,
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
    patcher_ : Patcher, optional
        A function that modifies a record before it is logged.
    depth_ : int, default=0
        The depth of the caller in the stack. This is used to determine the correct
        source file and function name to log. This usually doesn't need to be changed.

    See Also
    --------
    format_seconds : Format a number of seconds as HH:MM:SS[.ffffff]
    loguru.Logger.patch : Attach a function to modify records before they are logged.
    """
    timing_logger = logger.opt(depth=depth_ + 1)
    if patcher_ is not None:
        timing_logger = timing_logger.patch(patcher_)
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
    def __init__(self, message: str | None = None, *, prec: int = 3, log: bool = True):
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
            self.log(*args, depth_=1, **kwargs)

    start = __enter__
    stop = __exit__

    def log(
        self,
        *args,
        message: str | None = None,
        prec: int | None = None,
        depth_: int = 0,
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
        depth_ : int, default=0
            The depth of the caller in the stack. This is used to determine the correct
            source file and function name to log. This usually doesn't need to be
            changed.
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
            return

        if message is None:
            message = self.message if self.message is not None else "took {}"
        prec = self.prec if prec is None else prec
        log_timing(
            self.time_taken,
            message,
            *args,
            prec=prec,
            depth_=depth_ + 1,
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
            def func_attrs_patcher(record: Record):
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


def shorten_data_path(path: PathLike, max_length: int = 50) -> str:
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


def run_and_log_subprocess(
    args: list[str],
    *,
    check: bool = True,
    _level: LogLevel = "DEBUG",
    _depth: int = 0,
    **kwargs,
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
        **kwargs,
    )
    timer.stop()

    subprocess_logger.log(
        _level,
        "returncode={} time_taken={}",
        completed_process.returncode,
        timer.time_taken,
    )
    # This has to be after the log line above this one because it resets the color
    subprocess_logger.log(_level, "stdout=\n\033[0m{}", completed_process.stdout)

    if check:
        completed_process.check_returncode()
    return completed_process


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
