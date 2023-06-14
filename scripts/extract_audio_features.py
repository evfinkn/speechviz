import argparse
import pathlib
import subprocess

import librosa
import numpy as np

import log
import util
from constants import AUDIO_EXTS, VIDEO_EXTS
from log import logger


def frames(num_frames: int, frame_length: int, hop_length: int):
    """Gets a sequence of slices to that can be used to frame an array.

    Parameters
    ----------
    num_frames : int
        Number of frames.
    frame_length : int
        Length of each frame.
    hop_length : int
        Number of elements between the start of each frame.

    Returns
    -------
    sequence of slices
        A sequence of slices that can be used to frame an array.

    Examples
    --------
    >>> frames(2, 5, 3)
    (slice(0, 5, None), slice(3, 8, None))
    >>> arr = np.arange(24).reshape(3, 8)
    >>> arr
    array([[ 0,  1,  2,  3,  4,  5,  6,  7],
           [ 8,  9, 10, 11, 12, 13, 14, 15],
           [16, 17, 18, 19, 20, 21, 22, 23]])
    >>> framed = [arr[..., frame] for frame in frames(2, 5, 3)]
    >>> framed
    [array([[ 0,  1,  2,  3,  4],
            [ 8,  9, 10, 11, 12],
            [16, 17, 18, 19, 20]]),
     array([[ 3,  4,  5,  6,  7],
            [11, 12, 13, 14, 15],
            [19, 20, 21, 22, 23]])]
    """
    frame_indices = np.arange(num_frames)
    frame_start = frame_indices * hop_length
    frame_end = frame_start + frame_length
    # return frame_start, frame_end
    return tuple(slice(start, end) for start, end in zip(frame_start, frame_end))


def amplitude_envelope(y: np.ndarray, *, n_fft=2048, hop_length=512):
    """Compute the amplitude envelope of a signal.
    The amplitude envelope is the maximum amplitude of each frame.
    Samples that don't fit into a full frame are still included.

    Parameters
    ----------
    y : np.ndarray [shape=(..., T)]
        The audio signal.
    n_fft : int > 0
        The number of samples to use in each frame.
    hop_length : int > 0
        Number of samples between the start of each frame.

    Returns
    -------
    ae : np.ndarray [shape=(..., num_frames)]
        The amplitude envelope of y.

    Examples
    --------
    >>> arr
    array([[ 0,  1,  2,  3,  4,  5,  6,  7],
           [ 8,  9, 10, 11, 12, 13, 14, 15],
           [16, 17, 18, 19, 20, 21, 22, 23]])
    >>> ae = amplitude_envelope(arr, n_fft=3, hop_length=2)
    >>> ae
    array([[ 2,  4,  6,  7],
           [10, 12, 14, 15],
           [18, 20, 22, 23]])
    """
    if y.ndim == 1:
        # add channel dimension when y is mono
        y = np.expand_dims(y, axis=0)
    num_frames = int(np.ceil(y.shape[-1] / hop_length))
    ae = np.empty((y.shape[0], num_frames), dtype=y.dtype)
    for i, frame in enumerate(frames(num_frames, n_fft, hop_length)):
        ae[:, i] = np.amax(y[..., frame], axis=-1)
    if y.shape[0] == 1:
        # remove channel dimension when y is mono
        ae = np.squeeze(ae, axis=0)
    return ae


def route_dir(dir, scan_dir=True, **kwargs):
    logger.debug("Running extract_features on each file in {}", dir)
    for path in dir.iterdir():
        route_file(path, scan_dir=scan_dir, **kwargs)


def route_file(*paths: pathlib.Path, scan_dir=True, **kwargs):
    if len(paths) == 0:
        # if no file or directory given, use directory script was called from
        paths = [pathlib.Path.cwd()]
    # if multiple files (or directories) given, run function on each one
    elif len(paths) > 1:
        for path in paths:
            route_file(path, scan_dir=scan_dir, **kwargs)
        # stop function because all of the processing is
        # done in the function calls in the for loop
        return

    path = paths[0].absolute()  # paths[0] is--at this point--the only argument in paths

    # if file.path is an audio or video file, process it
    if path.suffix.casefold() in AUDIO_EXTS or path.suffix.casefold() in VIDEO_EXTS:
        extract_features(path, **kwargs)

    # run process audio on every file in file.path if it is a dir and scan_dir is True
    elif path.is_dir() and scan_dir:
        # the data dir was passed so run on data/audio and data/video
        if path.name == "data":
            route_dir(path / "audio", scan_dir=scan_dir, **kwargs)
            route_dir(path / "video", scan_dir=scan_dir, **kwargs)
        else:
            route_dir(path, scan_dir=False, **kwargs)


def run_from_pipeline(args):
    # path should be a str or list of str so convert to list of Paths
    paths = util.expand_files(args.pop("path"), to_paths=True)
    route_file(*paths, **args)


@log.Timer()
def extract_features(
    path: pathlib.Path,
    n_mfcc: int = 20,
    reprocess: bool = False,
):
    log.log_vars(
        log_separate_=True,
        path=path,
        n_mfcc=n_mfcc,
        reprocess=reprocess,
    )

    for ancestor in path.parents:
        if ancestor.name == "audio" or ancestor.name == "video":
            if ancestor.parent.name == "data":
                data_dir = ancestor.parent
                parent_dir = path.parent.relative_to(ancestor)
                break
    # an `else` for a `for` loop is executed if `break` is never reached
    else:
        raise Exception("Input file must be a descendant of data/audio or data/video.")

    features_path = data_dir / "features" / parent_dir / f"{path.stem}-features.npz"
    if features_path.exists() and not reprocess:
        logger.info("Features already extracted for {}. To reprocess, pass -r", path)
        return
    features_path.parent.mkdir(parents=True, exist_ok=True)

    log.log_vars(
        log_separate_=True,
        data_dir=data_dir,
        parent_dir=parent_dir,
        features_path=features_path,
    )

    made_wav = False
    try:
        if path.suffix.casefold() in VIDEO_EXTS:
            old_path = path
            path = path.with_suffix(".wav")
            logger.debug("{} is not a wav file. Creating {}", old_path.name, path.name)
            util.ffmpeg(old_path, path)
            made_wav = True
    except subprocess.CalledProcessError:
        logger.error("{} has no audio to process", path)
        return

    logger.trace("Loading the audio")
    y, sr = librosa.load(path, sr=None, mono=False)
    n_channels = 1 if y.ndim == 1 else y.shape[0]

    logger.trace("Extracting the audio's features")
    extraction_timer = log.Timer("Extracting features took {}")
    extraction_timer.start()
    features = {}

    S = librosa.stft(y)
    S_mag, _ = librosa.magphase(S)
    S_mel = librosa.feature.melspectrogram(S=S_mag**2, sr=sr)
    S_mel_db = librosa.power_to_db(S_mel)

    # spectral features
    features["spectral_centroid"] = librosa.feature.spectral_centroid(S=S_mag, sr=sr)
    features["spectral_bandwidth"] = librosa.feature.spectral_bandwidth(S=S_mag, sr=sr)
    features["spectral_rolloff"] = librosa.feature.spectral_rolloff(S=S_mag, sr=sr)
    features["spectral_contrast"] = librosa.feature.spectral_contrast(S=S_mag, sr=sr)
    features["spectral_flatness"] = librosa.feature.spectral_flatness(S=S_mag)
    # mono and multi-channels audio have to be handled separately for mfcc because
    # passing multiple channels depends on the peak loudness across all channels
    # so the result is different than if each channel is processed separately
    if n_channels == 1:
        mfcc = librosa.feature.mfcc(S=S_mel_db, sr=sr, n_mfcc=n_mfcc)
    else:
        mfcc = np.empty((n_channels, n_mfcc, S_mel_db.shape[-1]))
        for i in range(S_mel_db.shape[0]):
            mfcc[i] = librosa.feature.mfcc(S=S_mel_db[i], sr=sr, n_mfcc=n_mfcc)
    features["mfcc"] = mfcc

    # time-domain features
    features["amplitude_envelope"] = amplitude_envelope(y)
    features["rms"] = librosa.feature.rms(S=S_mag)
    # this is commented out for now because it can take up a lot of hard drive space
    # features["zero_crossings"] = librosa.zero_crossings(y)
    features["zero_crossing_rate"] = librosa.feature.zero_crossing_rate(y)

    if n_channels != 1:
        # recalculate all of the features after making the audio mono
        y_mono = librosa.to_mono(y)
        S_mono = librosa.stft(y_mono)
        S_mag_mono, _ = librosa.magphase(S_mono)
        S_mel_mono = librosa.feature.melspectrogram(S=S_mag_mono**2, sr=sr)
        S_mel_db_mono = librosa.power_to_db(S_mel_mono)

        # spectral features
        features["spectral_centroid_mono"] = librosa.feature.spectral_centroid(
            S=S_mag_mono, sr=sr
        )
        features["spectral_bandwidth_mono"] = librosa.feature.spectral_bandwidth(
            S=S_mag_mono, sr=sr
        )
        features["spectral_rolloff_mono"] = librosa.feature.spectral_rolloff(
            S=S_mag_mono, sr=sr
        )
        features["spectral_contrast_mono"] = librosa.feature.spectral_contrast(
            S=S_mag_mono, sr=sr
        )
        features["spectral_flatness_mono"] = librosa.feature.spectral_flatness(
            S=S_mag_mono
        )
        features["mfcc_mono"] = librosa.feature.mfcc(
            S=S_mel_db_mono, sr=sr, n_mfcc=n_mfcc
        )

        # time-domain features
        features["amplitude_envelope_mono"] = amplitude_envelope(y_mono)
        features["rms_mono"] = librosa.feature.rms(S=S_mag_mono)
        # this is commented out for now because it can take up a lot of hard drive space
        # features["zero_crossings_mono"] = librosa.zero_crossings(y_mono)
        features["zero_crossing_rate_mono"] = librosa.feature.zero_crossing_rate(y_mono)

    extraction_timer.stop()

    np.savez_compressed(features_path, **features)

    if made_wav:
        logger.debug("Deleting {}", path)
        path.unlink()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract features from audio files.")
    parser.add_argument(
        "-r",
        "--reprocess",
        action="store_true",
        help="Reprocess audio files detected to have already been processed",
    )
    parser.add_argument(
        "path",
        nargs="*",
        type=pathlib.Path,
        help=(
            "The path to the file to process. If an audio file, extracts the features"
            " from it. If a directory, extracts the features from every audio file in"
            " the directory."
        ),
    )
    log.add_log_level_argument(parser)

    args = vars(parser.parse_args())
    log.setup_logging(args.pop("log_level"))
    with log.Timer("Extracting features took {}"):
        route_file(*args.pop("path"), **args)
