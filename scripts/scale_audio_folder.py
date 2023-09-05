import argparse
import os

import librosa
import numpy as np
import soundfile as sf


def main():
    parser = argparse.ArgumentParser(description="Scale audio files in a folder.")
    parser.add_argument(
        "input_folder", help="Path to the input folder containing audio files."
    )
    args = parser.parse_args()

    input_folder = args.input_folder
    output_folder = os.path.join(input_folder + "Scaled")
    desired_range = 0.95

    # Create output folder if it doesn't exist
    os.makedirs(output_folder, exist_ok=True)

    # Collect max amplitudes from all audio files
    max_amplitudes = []
    files_above_threshold = []

    # Iterate through each audio file in the input folder
    for filename in os.listdir(input_folder):
        if filename.endswith(".wav"):
            file_path = os.path.join(input_folder, filename)

            # Load audio
            audio_data, _ = librosa.load(file_path, sr=None, mono=False)

            # Ensure audio_data has two dimensions (channels, samples)
            if len(audio_data.shape) == 1:
                audio_data = audio_data.reshape(
                    1, -1
                )  # Reshape mono audio to (1, samples)

            # Calculate peak amplitude for each channel separately
            peak_amplitudes_per_channel = np.max(np.abs(audio_data), axis=1)

            # Append peak amplitudes for all channels to the list
            max_amplitudes.extend(peak_amplitudes_per_channel)

            # Check if any channel's peak amplitude exceeds 1.0
            if any(peak_amplitudes_per_channel > 1.0):
                files_above_threshold.append(filename)

    # Calculate scaling factor based on the max amplitude across all files
    max_amplitude_overall = np.max(max_amplitudes)
    scaling_factor = desired_range / max_amplitude_overall
    print("Maximum peak amplitude:", max_amplitude_overall)
    print("Scaling factor:", scaling_factor)

    if files_above_threshold:
        print("Files with peaks above 1.0:", files_above_threshold)

    # Iterate through each audio file again and apply scaling
    for filename in os.listdir(input_folder):
        if filename.endswith(".wav"):
            file_path = os.path.join(input_folder, filename)

            # Load audio
            audio_data, sr = librosa.load(file_path, sr=None, mono=False)

            # Scale and normalize audio
            scaled_audio = audio_data * scaling_factor

            # Save processed audio
            output_path = os.path.join(output_folder, filename)
            sf.write(
                output_path, scaled_audio.T, sr, subtype="PCM_16"
            )  # Use appropriate subtype

    max_amplitudes2 = []

    # Iterate through each audio file in the output folder
    for filename in os.listdir(output_folder):
        if filename.endswith(".wav"):  # Adjust for your audio file format
            file_path = os.path.join(output_folder, filename)

            # Load audio
            audio_data, _ = librosa.load(file_path, sr=None, mono=False)

            # Calculate max amplitude
            max_amplitude2 = np.max(np.abs(audio_data))
            max_amplitudes2.append(max_amplitude2)

    # Calculate scaling factor based on the max amplitude across all files
    max_amplitude_overall2 = np.max(max_amplitudes2)

    print("Maximum peak amplitude after scaling:", max_amplitude_overall2)


if __name__ == "__main__":
    main()
