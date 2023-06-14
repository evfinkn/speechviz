import argparse
import itertools
import pathlib
from typing import Literal

import librosa
import numpy as np
import scipy.io.wavfile
import scipy.signal

import log
import util
from log import logger

Mode = Literal["trim", "pad"]


def pad_axis(
    arr: np.ndarray, axis_pad_width: tuple[int, int], axis: int = -1, **kwargs
) -> np.ndarray:
    """Pads an array along a single axis.

    Parameters
    ----------
    arr : np.ndarray
        The array to pad.
    axis_pad_width : tuple[int, int]
        The number of elements to pad on each side of the axis.
    axis : int
        The axis to pad along. Defaults to the last axis.
    **kwargs
        Additional arguments to pass to np.pad.
    """
    pad_width = [(0, 0)] * arr.ndim
    pad_width[axis] = axis_pad_width
    return np.pad(arr, pad_width, **kwargs)


def load_audios(
    audio_paths: list[pathlib.Path], *, mono: bool = False
) -> tuple[list[np.ndarray], int]:
    """Loads multiple audio files.
    The audio files must all have the same sample rate.

    Parameters
    ----------
    audio_paths : list[pathlib.Path]
        The paths to the audio files to load.
    mono : bool
        Whether to load the audio as mono. Defaults to False.

    Returns
    -------
    tuple[list[np.ndarray], int]
        The loaded audio data and the sample rate.

    Raises
    ------
    Exception
        If not all of the audio files exist.
    Exception
        If there are less than 2 audio files in audio_paths.
    """
    if not all(audio_path.exists() for audio_path in audio_paths):
        raise Exception("Not all of the audio files exist.")
    if len(audio_paths) < 2:
        raise Exception("Can't sync less than 2 audio files")

    audio, sr = librosa.load(audio_paths[0], sr=None, mono=mono)
    audios = [audio]
    for audio_path in audio_paths[1:]:
        audio, _ = librosa.load(audio_path, sr=sr, mono=mono)
        audios.append(audio)

    return audios, sr


def _get_best_corr_and_lag(
    i: int,
    j: int,
    xcorr: np.ndarray,
    xcorr_lags: np.ndarray,
    bounds: np.ndarray,
    threshold: float,
) -> tuple[int, int]:
    """
    Parameters
    ----------
    i : int
        The index of the first audio.
    j : int
        The index of the second audio that is being correlated relative to the
        first audio.
    xcorr : np.ndarray
    xcorr_lags : np.ndarray
    bounds : np.ndarray
    threshold : float

    Returns
    -------
    The lag of audio j relative to audio i.
    """

    best_corr_index = np.argmax(xcorr)
    best_corr = xcorr[best_corr_index]
    best_lag = xcorr_lags[best_corr_index]

    if bounds is None:
        return best_corr, best_lag
    lower, upper = bounds[j] - bounds[i]
    if lower > upper:
        lower, upper = upper, lower
    if lower <= best_lag <= upper or threshold <= 0:
        return best_corr, best_lag

    xcorr_guess_indices = np.where((lower <= xcorr_lags) & (xcorr_lags <= upper))
    if len(xcorr_guess_indices) == 0:
        return best_corr, best_lag
    xcorr_guess = xcorr[xcorr_guess_indices]
    xcorr_lags_guess = xcorr_lags[xcorr_guess_indices]

    best_corr_guess_index = np.argmax(xcorr_guess)
    best_corr_guess = xcorr_guess[best_corr_guess_index]
    best_lag_guess = xcorr_lags_guess[best_corr_guess_index]

    if abs(best_corr - best_corr_guess) / best_corr <= threshold:
        return best_corr_guess, best_lag_guess
    else:
        return best_corr, best_lag


def _remove_pairly_dependent(indices, corrs, *, exclude=None):
    if exclude is None:
        exclude = set()
    for i, j in itertools.combinations(range(len(indices)), 2):
        if indices[i] == j and indices[j] == i:
            if i in exclude or j in exclude:
                continue
            corrs[i, j] = float("-inf")
            corrs[j, i] = float("-inf")
            next_best_i = np.argmax(corrs[i])
            next_best_j = np.argmax(corrs[j])
            if corrs[i, next_best_i] > corrs[j, next_best_j]:
                indices[i] = next_best_i
            else:
                indices[j] = next_best_j
            _remove_pairly_dependent(indices, corrs, exclude=exclude)
            break  # break because recursive call will handle the rest


def _recursive_calculate_lags(best_corr_indices, lags, final_lags, i):
    if final_lags[i] is not None:
        return final_lags[i]
    j = best_corr_indices[i]
    _recursive_calculate_lags(best_corr_indices, lags, final_lags, j)
    final_lags[i] = lags[j, i] + final_lags[j]
    return final_lags[i]


def get_audios_lags(
    audios: list[np.ndarray],
    bounds: list[tuple[int, int]] = None,
    threshold: float = 1 / 3,
) -> list[int]:
    """Get the lags between audios.

    Parameters
    ----------
    audios : list[np.ndarray]
        The audios to get the lags between.
    bounds : list[tuple[int, int]], optional
        The guessed / expected bounds of the lags between the audios. The bounds
        are inclusive. The length of the list must be the same as the length of
        `audios`. The first element of each tuple is the lower bound and the
        second element is the upper bound. If None (default), then there are no
        bounds.
    threshold : float, default 1/3
        The threshold for the relative error between the best correlation and
        the best guess correlation, where the best guess correlation is the
        best correlation for lags within the bounds. If the relative error is
        less than or equal to the threshold, then the best guess correlation is
        used. Otherwise, the best correlation is used. Only used if `bounds` is
        not None.

    Returns
    -------
    list[int]
        The lag between each audio and the base audio. The lag is the offset index to
        make the audios line up. A negative lag means the audio starts that many
        samples before the base audio. A positive lag means the audio starts that many
        samples after the base audio. The lag for the base audio is always 0.

    Raises
    ------
    Exception
        If `audios` has less than 2 elements.
    Exception
        If `bounds` is not None and the length of `bounds` is not the same as the
        length of `audios`.
    """
    if len(audios) < 2:
        raise Exception("audios must have at least 2 elements")
    if bounds is not None and len(bounds) != len(audios):
        raise Exception("bounds must be the same length as audios")

    audios = [librosa.to_mono(audio) for audio in audios]
    if bounds is not None:
        bounds = np.asarray(bounds)

    if len(audios) == 2:
        xcorr = scipy.signal.correlate(audios[0], audios[1], mode="full")
        xcorr_lags = scipy.signal.correlation_lags(len(audios[0]), len(audios[1]))
        return [
            0,
            _get_best_corr_and_lag(0, 1, xcorr, xcorr_lags, bounds, threshold)[1],
        ]

    square_shape = (len(audios),) * 2
    corr = np.zeros(square_shape)
    lags = np.zeros(square_shape, dtype=np.int64)

    for i, j in itertools.combinations(range(len(audios)), 2):
        xcorr = scipy.signal.correlate(audios[i], audios[j], mode="full")
        xcorr_lags = scipy.signal.correlation_lags(len(audios[i]), len(audios[j]))
        best_corr, best_lag = _get_best_corr_and_lag(
            i, j, xcorr, xcorr_lags, bounds, threshold
        )
        corr[i, j] = corr[j, i] = best_corr
        lags[i, j] = best_lag
        lags[j, i] = -lags[i, j]

    # Determine the best correlation for each audio
    best_corr_index = np.argmax(corr, axis=1)

    pairly_dependent = []
    for i, j in itertools.combinations(range(len(audios)), 2):
        if best_corr_index[i] == j and best_corr_index[j] == i:
            pairly_dependent.append((i, j))

    depended_on_counts = dict(zip(*np.unique(best_corr_index, return_counts=True)))
    if len(pairly_dependent) == 0:
        # Use the most depended on audio as the reference audio so there is less
        # recursion when computing the lags
        ref_index = max(depended_on_counts, key=depended_on_counts.get)
    else:
        # use the most depended on audio that is piarly dependent with another audio
        # as the reference audio and remove other pairly dependent audios by setting
        # their best correlation index to the next best correlation index for that
        # audio until it is no longer pairly dependent with another audio
        ref_index = max(util.flatten(pairly_dependent), key=depended_on_counts.get)
        if len(pairly_dependent) > 1:
            _remove_pairly_dependent(best_corr_index, corr, exclude={ref_index})

    final_lags = [None] * len(audios)
    final_lags[ref_index] = 0
    for i in range(len(audios)):
        _recursive_calculate_lags(best_corr_index, lags, final_lags, i)

    return final_lags


@log.Timer()
def sync_audios(
    audios: list[np.ndarray], lags: list[int], mode: Mode = "trim"
) -> list[np.ndarray]:
    """Synchronizes audios so that each starts and stops at the same real-world time.

    Parameters
    ----------
    audios : array_like
        Array containing the data of each audio to sync. Must have at least
        2 elements.
    lags : list of ints
        The lags returned by get_audios_lags on `audios`.
    mode : str
        Either "trim" or "pad". If "trim", every audio is trimmed so that they all
        start at the same time. If "pad", every audio is padded with silence at
        the start and end where necessary so that the synced audios start at the
        earliest audio and end at the latest.

    Returns
    -------
    synced : list of array_likes
        The synchronized audio data.

    Raises
    ------
    Exception
        If `audios` has less than 2 elements.
    """
    if len(audios) < 2:
        # can't synchronize less than 2 audios
        raise Exception("audios must have at least 2 elements.")
    if mode != "trim" and mode != "pad":
        raise Exception('mode must be either "trim" or "pad".')

    if mode == "trim":
        # if lags[i] is negative, audios[i] needs to be trimmed to start at -lag to
        # line up with base_audio. if lags[i] is positive, that means base_audio needs
        # to be trimmed to start at lag to line up with audios[i]. since we're lining
        # up all of the audio, we want to offset base_audio by the max lag of the
        # positive lags--base_lag. If there aren't any positive lags, base_lag = 0
        # since in that case base_audio doesn't need to be offset. Because the negative
        # lags are relative to base_audio, they also need to be offset by base_lag
        # base_lag (i.e. the offset after negating is -lag + base_lag). For the positive
        # lags, the respective audio needs to be offset by lag - base_lag, since for
        # positive lags < base_lag, the original matching index has been cut off
        pos_lags = [lag for lag in lags if lag > 0]
        base_lag = max(pos_lags, default=0)
        # change lags so that lags[i] is the start index to slice audios[i]
        lags = [base_lag - lag for lag in lags]
        synced = [audio[..., lag:] for audio, lag in zip(audios, lags)]
        min_len = min([audio.shape[-1] for audio in synced])
        # trim the end of the audios so they all have the same length and can be mixed
        synced = [audio[..., :min_len] for audio in synced]

    elif mode == "pad":
        neg_lags = [lag for lag in lags if lag < 0]
        base_left_pad = -min(neg_lags, default=0)
        left_pads = [base_left_pad + lag for lag in lags]
        max_len = max(audios[i].shape[-1] + left_pads[i] for i in range(len(audios)))
        right_pads = []
        for audio, left_pad in zip(audios, left_pads):
            right_pads.append(max_len - audio.shape[-1] - left_pad)
        pads = zip(left_pads, right_pads)
        synced = [pad_axis(audio, pad) for audio, pad in zip(audios, pads)]

    return synced


def mix_audios(audios: list[np.ndarray]) -> np.ndarray:
    """Mixes audios into one mono audio.

    Parameters
    ----------
    audios : list of np.ndarray
        Array containing the data of each audio to mix. Must be synced.

    Returns
    -------
    mixed : np.ndarray
        The mixed audio.
    """
    audios = [librosa.to_mono(audio) for audio in audios]
    return np.add.reduce(audios) / len(audios)


def overlay_audios(audios: list[np.ndarray]) -> np.ndarray:
    """Overlays audios into a single audio, where each audio is a channel.

    Parameters
    ----------
    audios : list of np.ndarray
        Array containing the data of each audio to overlay. Must be synced.

    Returns
    -------
    overlaid : np.ndarray
        The overlaid audio.
    """
    channels = []
    for audio in audios:
        if audio.ndim == 1:
            channels.append(audio)
        else:
            channels.extend(audio)
    return np.asarray(channels) / len(channels)


def main(
    audio_paths: list[pathlib.Path],
    output_path: pathlib.Path,
    mode: str = "pad",
    mono: bool = False,
    reprocess: bool = False,
):
    if output_path.exists() and not reprocess:
        logger.info("The audio files have already been synced. To resync them, pass -r")
        return

    audios, sr = load_audios(audio_paths, mono=mono)
    lags = get_audios_lags(audios)
    synced_audios = sync_audios(audios, lags, mode=mode)
    if mono:
        synced_audio = mix_audios(synced_audios)
    else:
        synced_audio = overlay_audios(synced_audios)

    # synced_audio.T because it expects (Nsamples, Nchannels), but synced_audio
    # is (Nchannels, Nsamples) because that's what librosa uses
    scipy.io.wavfile.write(output_path, sr, synced_audio.T)


def route_file(paths: list[pathlib.Path], output_path: pathlib.Path, **kwargs):
    paths = [path.absolute() for path in paths]
    main(paths, output_path, **kwargs)


def run_from_pipeline(args: dict):
    paths = util.expand_files(args.pop("path"), to_paths=True)
    route_file(list(paths), args.pop("output"), **args)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Synchronize audio files.")
    parser.add_argument(
        "path", nargs="*", type=pathlib.Path, help="Paths to the audio files to sync."
    )
    parser.add_argument(
        "output", type=pathlib.Path, help="The path to output the synced audio file to."
    )
    parser.add_argument(
        "-m",
        "--mode",
        default="pad",
        choices=("trim", "pad"),
        help=(
            'If "pad", every audio is padded with silence for any parts it\'s not'
            ' playing. If "trim", the synced audio will be trimmed to the'
            ' latest-starting and earliest-ending audio. Default is "pad".'
        ),
    )
    parser.add_argument(
        "--mono",
        action="store_true",
        help=(
            "If True, the synced audio file will be mono. Otherwise, the channels are"
            " the synced channels of all the input audio. Default is False."
        ),
    )
    parser.add_argument(
        "-r",
        "--reprocess",
        action=util.BooleanOptionalAction,
        default=False,
        help=(
            'Resync the audio files even if "output" already exists. Default is False.'
        ),
    )
    log.add_log_level_argument(parser)

    args = vars(parser.parse_args())
    log.setup_logging(args.pop("log_level"))
    with log.Timer("Synchronization took {}"):
        main(args.pop("path"), args.pop("output"), **args)
