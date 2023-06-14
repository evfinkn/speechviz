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
