import os
from datetime import timedelta
from typing import (
    Any,
    Callable,
    Generic,
    List,
    Literal,
    Optional,
    Protocol,
    Tuple,
    TypedDict,
    TypeVar,
    Union,
)

T = TypeVar("T")  #: Generic type variable.
PathLike = Union[str, os.PathLike]
Retention = Optional[Union[int, timedelta, str, Callable]]
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


class List2D(Generic[T]):
    def __class_getitem__(cls, item):
        return List[List[item]]


# SupportsGT, SupportsLT, and SupportsRichComparison are from typeshed:
# https://github.com/python/typeshed/blob/main/stdlib/_typeshed/__init__.pyi
class SupportsGT(Protocol[T]):
    def __gt__(self, __other: T) -> bool:
        ...


class SupportsLT(Protocol[T]):
    def __lt__(self, __other: T) -> bool:
        ...


SupportsRichComparison = Union[SupportsGT[Any], SupportsLT[Any]]


class KeyFunc(Generic[T]):
    def __class_getitem__(cls, item):
        return Callable[[item], SupportsRichComparison]


class TreeItem(TypedDict, total=False):
    type: str
    arguments: tuple
    options: dict


class Group(TypedDict, total=False):
    type: Literal["Group"]
    arguments: Tuple[str]
    options: dict


# can't inherit from Group because we change the type of `type`
class PeaksGroup(TypedDict, total=False):
    type: Literal["PeaksGroup"]
    arguments: Tuple[str]
    options: dict


class PeaksSegment(TypedDict):
    startTime: float
    endTime: float
    color: str
    labelText: str


class Segment(TypedDict, total=False):
    type: Literal["Segment"]
    arguments: Tuple[PeaksSegment]
    options: dict
