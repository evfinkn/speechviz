import os
from datetime import timedelta
from typing import Any, Callable, Generic, Literal, Protocol, TypedDict, TypeVar

T = TypeVar("T")  #: Generic type variable.
PathLike = str | os.PathLike
Retention = int | timedelta | str | Callable | None
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
        return list[list[item]]


# SupportsGT, SupportsLT, and SupportsRichComparison are from typeshed:
# https://github.com/python/typeshed/blob/main/stdlib/_typeshed/__init__.pyi
class SupportsGT(Protocol[T]):
    def __gt__(self, __other: T) -> bool:
        ...


class SupportsLT(Protocol[T]):
    def __lt__(self, __other: T) -> bool:
        ...


SupportsRichComparison = SupportsGT[Any] | SupportsLT[Any]


class KeyFunc(Generic[T]):
    def __class_getitem__(cls, item):
        return Callable[[item], SupportsRichComparison]


class TreeItem(TypedDict, total=False):
    type: str
    arguments: tuple
    options: dict


class Group(TypedDict, total=False):
    type: Literal["Group"]
    arguments: tuple[str]
    options: dict


# can't inherit from Group because we change the type of `type`
class PeaksGroup(TypedDict, total=False):
    type: Literal["PeaksGroup"]
    arguments: tuple[str]
    options: dict


class PeaksSegment(TypedDict):
    startTime: float
    endTime: float
    color: str
    labelText: str


class Segment(TypedDict, total=False):
    type: Literal["Segment"]
    arguments: tuple[PeaksSegment]
    options: dict
