import math
from typing import Union

import numpy as np


def rms(samples: np.ndarray) -> float:
    # np.sqrt returns a float64 which is the same as float for calculations,
    # but is not JSON serializable. So we cast it to a float.
    if len(samples) == 0:
        return 0
    return float(np.sqrt(np.mean(np.square(samples))))


def snr(signal: Union[np.ndarray, float], noise: Union[np.ndarray, float]) -> float:
    # https://en.m.wikipedia.org/wiki/Signal-to-noise_ratio
    signal_rms = rms(signal) if not isinstance(signal, float) else signal
    noise_rms = rms(noise) if not isinstance(noise, float) else noise
    if noise_rms == 0:
        return float("inf")
    snr = ((signal_rms - noise_rms) / noise_rms) ** 2
    snr_db = 10 * (math.log(snr, 10))
    return snr_db
