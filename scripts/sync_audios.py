import argparse
import pathlib
import time

import librosa
import numpy as np
import scipy.io.wavfile
import scipy.signal
import util


def pad_axis(arr, axis_pad_width, axis=-1, **kwargs):
    pad_width = [(0, 0)] * arr.ndim
    pad_width[axis] = axis_pad_width
    return np.pad(arr, pad_width, **kwargs)


def get_audios_lags(audios, verbose=0):
    start_time = time.perf_counter()
    if len(audios) < 2:
        # can't synchronize less than 2 audios
        raise Exception("audios must have at least 2 elements")
    # I think correlating takes a while (like > 30 minutes) if there are multiple
    # channels, so just to be safe, make sure all audio is mono
    audios = [librosa.to_mono(audio) for audio in audios]
    base_audio = audios[0]
    # lags[i] is the lag between base_audio and audios[i + 1]
    # a lag is the offset index to make the audios line up
    lags = [0]
    for other_audio in audios[1:]:
        correlation = scipy.signal.correlate(base_audio, other_audio)
        clags = scipy.signal.correlation_lags(len(base_audio), len(other_audio))
        lags.append(clags[np.argmax(correlation)])
    if verbose:
        print(f"get_audios_lags took {time.perf_counter() - start_time:.4f} seconds")
    return lags


def sync_audios(audios, lags, mode="trim", verbose=0):
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
    start_time = time.perf_counter()
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
        base_lag = 0 if len(pos_lags) == 0 else max(pos_lags)
        # change lags so that lags[i] is the start index to slice audios[i]
        lags = [-lag + base_lag if lag <= 0 else lag - base_lag for lag in lags]
        lags[0] = base_lag
        synced = [audio[..., lag:] for audio, lag in zip(audios, lags)]
        min_len = min([audio.shape[-1] for audio in synced])
        # trim the end of the audios so they all have the same length and can be mixed
        synced = [audio[..., :min_len] for audio in synced]

    elif mode == "pad":
        neg_lags = [lag for lag in lags if lag < 0]
        base_left_pad = 0 if len(neg_lags) == 0 else -min(neg_lags)
        left_pads = [base_left_pad + lag for lag in lags]
        max_len = max(audios[i].shape[-1] + left_pads[i] for i in range(len(audios)))
        right_pads = []
        for audio, left_pad in zip(audios, left_pads):
            right_pads.append(max_len - audio.shape[-1] - left_pad)
        pads = zip(left_pads, right_pads)
        synced = [pad_axis(audio, pad) for audio, pad in zip(audios, pads)]

    if verbose:
        print(f"sync_audios took {time.perf_counter() - start_time:.4f} seconds")
    return synced


def mix_audios(audios):
    """Mixes audios into one mono audio.

    Parameters
    ----------
    audios : array_like
        Array containing the data of each audio to mix. Must be synced.

    Returns
    -------
    mixed : np.ndarray
        The mixed audio.
    """
    audios = [librosa.to_mono(audio) for audio in audios]
    return np.add.reduce(audios) / len(audios)


def overlay_audios(audios):
    """Overlays audios, combining them into one audio with a channel for each.

    Parameters
    ----------
    audios : array_like
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
    audio_paths,
    output_path,
    mode: str = "pad",
    mono: bool = False,
    reprocess: bool = False,
    quiet: bool = False,
    verbose: int = 0,
):
    if output_path.exists() and not reprocess:
        if not quiet:
            print(
                "The audio files have already been synced. To resync them, use the -r"
                " argument"
            )
        return

    if not all(audio_path.exists() for audio_path in audio_paths):
        raise Exception("Not all of the audio files exist.")
    if len(audio_paths) < 2:
        raise Exception("Can't sync less than 2 audio files")

    audio, sr = librosa.load(audio_paths[0], sr=None, mono=mono)
    audios = [audio]
    for audio_path in audio_paths[1:]:
        audio, _ = librosa.load(audio_path, sr=sr, mono=mono)
        audios.append(audio)

    lags = get_audios_lags(audios, verbose=verbose)
    synced_audios = sync_audios(audios, lags, mode=mode, verbose=verbose)
    if mono:
        synced_audio = mix_audios(synced_audios)
    else:
        synced_audio = overlay_audios(synced_audios)

    # synced_audio.T because it expects (Nsamples, Nchannels), but synced_audio
    # is (Nchannels, Nsamples) because that's what librosa uses
    scipy.io.wavfile.write(output_path, sr, synced_audio.T)


def route_file(paths, output_path: pathlib.Path, **kwargs):
    paths = [path.absolute() for path in paths]
    main(paths, output_path, **kwargs)


def run_from_pipeline(args):
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
    parser.add_argument(
        "-q", "--quiet", action="store_true", help="Don't print anything."
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="count",
        default=0,
        help="Print various debugging information.",
    )

    args = vars(parser.parse_args())
    start_time = time.perf_counter()
    main(args.pop("path"), args.pop("output"), **args)
    if not args["quiet"] or args["verbose"]:
        print(
            "Synchronization took a total of"
            f" {time.perf_counter() - start_time:.4f} seconds"
        )
