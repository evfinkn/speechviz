import os
from datetime import timedelta
from typing import Any, Callable, Literal, Protocol, Sequence, TypedDict, TypeVar

import numpy as np
from numpy.typing import NDArray
from typing_extensions import NotRequired, ReadOnly

_T = TypeVar("_T")  #: Generic type variable.
_T_contra = TypeVar("_T_contra", contravariant=True)

PathLike = str | os.PathLike
# https://github.com/python/typeshed/blob/main/stdlib/_typeshed/__init__.pyi
StrPath = str | os.PathLike[str]
GenericPath = StrPath | bytes | os.PathLike[bytes]
StrOrBytesPath = str | bytes | os.PathLike[str] | os.PathLike[bytes]
# https://github.com/python/typeshed/blob/main/stdlib/subprocess.pyi
Command = StrOrBytesPath | Sequence[StrOrBytesPath]

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
JSON = dict[str, "JSON"] | list["JSON"] | str | int | float | bool | None

NpInt = np.integer[Any]
NpFloat = np.floating[Any]
NpComplex = np.complexfloating[Any, Any]

AnyInt = int | NpInt
AnyFloat = float | NpFloat
AnyBool = bool | np.bool_

Number = int | float | complex
NumberT = TypeVar("NumberT", int, float, complex)

NpNumber = NpInt | NpFloat | NpComplex
# TODO: NpNumberT won't remember if it was e.g. np.int32 or np.int64 because that only
#       works when using bound=(...). We could use bound=Union[NpInt, ..., NpComplex]
#       but that allows them to be mixed (in the same list for example) which is usually
#       not what we want.
NpNumberT = TypeVar("NpNumberT", NpInt, NpFloat, NpComplex)

AnyNumber = Number | NpNumber
AnyNumberT = TypeVar("AnyNumberT", int, float, complex, NpInt, NpFloat, NpComplex)

FloatArray = NDArray[NpFloat]  # np.ndarray with any precision floating point numbers

Sequence2D = Sequence[Sequence[_T]]
List2D = list[list[_T]]


# SupportsGT, SupportsLT, and SupportsRichComparison are from typeshed:
# https://github.com/python/typeshed/blob/main/stdlib/_typeshed/__init__.pyi
class SupportsGT(Protocol[_T_contra]):
    def __gt__(self, __other: _T_contra) -> bool:
        ...


class SupportsLT(Protocol[_T_contra]):
    def __lt__(self, __other: _T_contra) -> bool:
        ...


SupportsRichComparison = SupportsGT[Any] | SupportsLT[Any]
KeyFunc = Callable[[_T], SupportsRichComparison]


class TreeItem(TypedDict):
    type: ReadOnly[str]
    arguments: ReadOnly[Sequence]
    options: NotRequired[dict[str, Any]]


class Group(TreeItem):
    type: ReadOnly[Literal["Group"]]
    arguments: tuple[str]


# can't inherit from Group because we change the type of `type`
class PeaksGroup(TreeItem):
    type: ReadOnly[Literal["PeaksGroup"]]
    # arguments: tuple[str]


class PeaksSegment(TypedDict):
    startTime: float
    endTime: float
    color: str
    labelText: str


class Segment(TreeItem):
    type: ReadOnly[Literal["Segment"]]
    arguments: tuple[PeaksSegment]


class Annotations(TypedDict):
    formatVersion: int
    annotations: list[TreeItem]
