import argparse
import csv
import os
import pathlib
import re

from pydub import AudioSegment


def append_audio_files(
    input_files: pathlib.Path,
    output_file: pathlib.Path,
    csv_output_file: pathlib.Path,
    silence_duration: int = 2000,  # Default is 2 seconds of silence
):
    combined_audio = AudioSegment.silent(
        duration=0
    )  # Create an initial silent audio segment
    audio_durations = []

    current_position = 0  # Track the current position in the combined audio

    for file_path in input_files:
        audio_segment = AudioSegment.from_file(file_path)

        # Convert the audio segment to mono or stereo as needed
        if audio_segment.channels != combined_audio.channels:
            audio_segment = audio_segment.set_channels(combined_audio.channels)

        # Append the current audio segment followed by silence
        combined_audio = (
            combined_audio[:current_position]
            + audio_segment
            + AudioSegment.silent(duration=silence_duration)
            + combined_audio[current_position:]
        )

        audio_durations.append(
            (
                os.path.basename(file_path),
                current_position / 1000.0,
                (current_position + len(audio_segment)) / 1000.0,
            )  # Convert time to seconds
        )

        current_position += len(audio_segment) + silence_duration

    # Create the output directory if it doesn't exist
    output_directory = os.path.dirname(output_file)
    os.makedirs(output_directory, exist_ok=True)

    combined_audio.export(
        output_file, format="wav"
    )  # Export the combined audio to a file

    # Write the order of file names and their start/end times to a CSV file
    with open(csv_output_file, "w", newline="") as csv_file:
        csv_writer = csv.writer(csv_file)
        csv_writer.writerow(["File Name", "Start Time (seconds)", "End Time (seconds)"])
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
    parser.add_argument(
        "--silence_duration",
        type=int,
        default=2000,
        help="Duration of silence between concatenated audio files (in milliseconds)",
    )

    args = parser.parse_args()

    path = args.path[0]
    folder = path.name
    output_filename = f"{folder}.wav"

    output_file = pathlib.Path("data", "views", output_filename)

    output_csvname = f"{folder}-times.csv"
    output_csv_file = pathlib.Path("data", "views", output_csvname)

    file_names = get_file_names_in_folder(path, folder)

    append_audio_files(
        file_names,
        output_file,
        output_csv_file,
        silence_duration=args.silence_duration,
    )
