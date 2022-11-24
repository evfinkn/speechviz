import os
import dataclasses
from collections.abc import Iterable

import numpy as np


@dataclasses.dataclass
class FileInfo:
    
    path: str
    dir: str
    name: str
    ext: str
    
    def __init__(self, path):
        directory = os.path.dirname(path)
        directory = "." if directory == "" else directory  # in case file is in cwd
        name, extension = os.path.splitext(os.path.basename(path))
        self.path = path
        self.dir = directory
        self.name = name
        self.ext = extension
        
        
def flatten(arr):
    for val in arr:
        if isinstance(val, Iterable) and not isinstance(val, str):
            yield from flatten(val)
        else:
            yield val
            

# https://stackoverflow.com/a/26026189
def get_nearest_index(array, value):
    i = np.searchsorted(array, value)
    if i > 0 and (i == len(array) or np.abs(value - array[i - 1]) < np.abs(value - array[i])):
        return i - 1
    else:
        return i
