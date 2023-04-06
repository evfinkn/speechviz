import librosa
import numpy as np
from scipy import signal

eps = np.finfo(np.float64).eps


def energy_entropy(
    y, sr, window: float = 0.03, overlap: float = 0.02, num_sub_frames: int = 10
):
    """Calculates the energy entropy of an audio signal.

    Parameters
    ----------
    y : array_like
    sr : int
    window : float
        Window size in seconds.
    overlap : float
        Window overlap in seconds.
    num_sub_frames : int
        Number of subframes.

    References
    ----------
    Jorgensen, Erik Jorgen. “ACOUSTIC COMPLEXITY IN REAL-WORLD NOISE AND EFFECTS
    ON SPEECH PERCEPTION FOR LISTENERS WITH NORMAL HEARING AND HEARING LOSS.”
    *University of Iowa*, 2022.
    """
    y = librosa.to_mono(y)

    step = window - overlap  # step size in seconds
    # convert window length and step length from seconds to samples
    window_samples = round(window * sr)
    step_samples = round(step * sr)

    num_samples = len(y)
    num_of_frames = int(np.floor((num_samples - window_samples) / step_samples)) + 1

    index = 0
    entropy = np.zeros(num_of_frames)
    for frame_num in range(num_of_frames):
        frame = y[index : index + window_samples]
        pwr = np.sum(np.square(frame))  # calculate total power
        frame_length = len(frame)

        sub_frame_length = int(np.floor(frame_length / num_sub_frames))
        if frame_length != sub_frame_length * num_sub_frames:
            frame = frame[: sub_frame_length * num_sub_frames]
        # order="F" to make reshape use column major layout because this function is
        # translated from MATLAB (which is column major) so in order to match the
        # calculations from the MATLAB code, we need to use the same layout
        sub_frames = np.reshape(frame, (sub_frame_length, num_sub_frames), order="F")

        # compute normalized sub-frame energies
        s = np.sum(np.square(sub_frames), axis=0) / (pwr + eps)
        # compute entropy of the normalized sub-frame energies
        entropy[frame_num] = -np.sum(s * np.log2(s + eps))

        index += step_samples  # move forward

    return entropy


def spectral_entropy(y, sr, window=0.03, overlap=0.02, freq_range=(80, 8000)):
    """Calculates the spectral entropy of an audio signal.

    Parameters
    ----------
    y : array_like
        The audio signal.
    sr : int
        Sample rate of the audio.
    window : float
        Window size in seconds.
    overlap : float
        Window overlap in seconds.
    freq_range : tuple of 2 ints
        Frequency range in Hz.
    """
    window = signal.windows.hamming(round(window * sr))
    overlap = round(overlap * sr)

    y = librosa.to_mono(y)
    f, t, Sxx = signal.spectrogram(y, sr, window=window, noverlap=overlap)

    # frequency bin indices corresponding to the specified frequency range
    freq_bins = np.where((f >= freq_range[0]) & (f <= freq_range[1]))[0]
    b1 = freq_bins[0]
    b2 = freq_bins[-1]
    Sxx_range = Sxx[freq_bins, :]  # spectral values within freq_range for each time
    sum_Sxx_range = np.sum(Sxx_range, axis=0)
    with np.errstate(divide="ignore", invalid="ignore"):
        # This can give "RuntimeWarning: invalid value encountered in divide" when
        # sum_Sxx_range contains 0s. We can ignore this, since dividing by 0 is
        # nan and we use nansum later to ignore nan
        norm_Sxx_range = Sxx_range / sum_Sxx_range  # normalized spectral values

    # calculate the spectral entropy for each time point
    entropy = np.zeros_like(t)
    for i in range(len(t)):
        sk = norm_Sxx_range[:, i]
        entropy[i] = -np.nansum(sk * np.log2(sk)) / np.log2(b2 - b1)

    return entropy
