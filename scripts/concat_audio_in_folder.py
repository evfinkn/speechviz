import argparse
import csv
import os
import pathlib
import re

from pydub import AudioSegment


def append_audio_files(
    input_files: pathlib.Path, output_file: pathlib.Path, csv_output_file: pathlib.Path
):
    combined_audio = AudioSegment.silent(
        duration=0
    )  # Create an initial silent audio segment
    audio_durations = []

    for file_path in input_files:
        audio_segment = AudioSegment.from_file(file_path)

        # Convert the audio segment to mono or stereo as needed
        if audio_segment.channels != combined_audio.channels:
            audio_segment = audio_segment.set_channels(combined_audio.channels)

        combined_audio += audio_segment
        audio_durations.append(
            (os.path.basename(file_path), len(audio_segment) / 1000.0)
        )  # Convert duration to seconds

    # Create the output directory if it doesn't exist
    output_directory = os.path.dirname(output_file)
    os.makedirs(output_directory, exist_ok=True)

    combined_audio.export(
        output_file, format="wav"
    )  # Export the combined audio to a file

    # Write the order of file names and their durations to a CSV file
    with open(csv_output_file, "w", newline="") as csv_file:
        csv_writer = csv.writer(csv_file)
        csv_writer.writerow(["File Name", "Duration (seconds)"])
        csv_writer.writerows(audio_durations)


def get_file_names_in_folder(folder_path, folder):
    file_names = []
    for filename in os.listdir(folder_path):
        if os.path.isfile(os.path.join(folder_path, filename)):
            file_names.append("data/audio/" + folder + "/" + filename)
    file_names.sort(key=lambda f: int(re.sub(r"\D", "", f)))
    return file_names


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Concatenate a folder of audio files into one audio file."
    )
    parser.add_argument(
        "path",
        nargs="*",
        type=pathlib.Path,
        help="The path to the folder of audio files",
    )

    args = parser.parse_args()

    path = args.path[0]
    folder = path.name

    output_file = pathlib.Path("data", "views", folder, "concat.wav")
    output_csv_file = pathlib.Path("data", "views", folder, "audio_durations.csv")

    file_names = get_file_names_in_folder(path, folder)

    append_audio_files(file_names, output_file, output_csv_file)
