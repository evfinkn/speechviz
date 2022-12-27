import os
import json
import random
import dataclasses
from collections.abc import Iterable, Iterator

import numpy as np


class FileInfo:
    
    path: str
    dir: str
    name: str
    ext: str
    
    def __init__(self, path: str) -> None:
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
    

def recurse_loads(string):
    """ Recursively loads JSON contained in a string, i.e. nested JSON strings in loaded dicts and arrays """
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
    rng = random.Random(seed) # Random instance because we don't want to share context
    while True: # while True because this is an infinite generator
        r = rng.randrange(255)
        g = rng.randrange(255)
        b = rng.randrange(255)
        yield f"#{r:02x}{g:02x}{b:02x}"
