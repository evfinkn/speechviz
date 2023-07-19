import argparse
import csv
import json
import os
import pathlib
import sqlite3

from scipy.io import wavfile


def calculate_complement_times(time_tuples, duration):
    complement_times = []
    start_time = 0

    for time_tuple in time_tuples:
        stop_time = time_tuple[0]

        if start_time != stop_time:
            complement_times.append((start_time, stop_time))

        start_time = time_tuple[1]
    complement_times.append((start_time, duration))

    return complement_times


def calculate_overlap_duration(time_tuples1, time_tuples2):
    overlap_duration = 0

    for interval1 in time_tuples1:
        for interval2 in time_tuples2:
            start1, stop1 = interval1
            start2, stop2 = interval2

            overlap_start = max(start1, start2)
            overlap_stop = min(stop1, stop2)

            if overlap_start < overlap_stop:
                overlap_duration += overlap_stop - overlap_start

    return overlap_duration


def compare_annotations(json_file, output_file):
    for ancestor in json_file.parents:
        if ancestor.name == "segments":
            if ancestor.parent.name == "data":
                data_dir = ancestor.parent
                parent_dir = json_file.parent.relative_to(ancestor)
                break

    file_id = parent_dir / f"{json_file.stem.replace('-segments', '')}.wav"

    # Get the audio file path
    audio_file_path = file_id

    # Load automatic detection data
    with open(json_file, "r") as file:
        data = json.load(file)

    automatic_segments = []
    for element in data:
        if element.get("arguments") == ["News"]:
            children = element.get("options", {}).get("children", [])
            for child in children:
                segment = child.get("arguments", [{}])[0]
                start_time = segment.get("startTime")
                end_time = segment.get("endTime")
                automatic_segments.append((start_time, end_time))

    print(automatic_segments)

    # Connect to the SQLite database
    conn = sqlite3.connect("speechviz.sqlite3")
    c = conn.cursor()

    # Retrieve hand annotations from the database
    c.execute(
        """
        SELECT startTime, endTime
        FROM annotations
        WHERE fileId = (
            SELECT id
            FROM audiofiles
            WHERE audiofile = ?
        )
        AND labelId = (
            SELECT id
            FROM labels
            WHERE label LIKE '%News%'
        )
    """,
        (str(file_id),),
    )

    hand_annotations = c.fetchall()

    # Get the audio file duration
    sample_rate, audio = wavfile.read(data_dir / "audio" / audio_file_path)
    total_file_duration = len(audio) / sample_rate

    print(hand_annotations)

    hand_annotation_complement = calculate_complement_times(
        hand_annotations, total_file_duration
    )
    auto_segments_complement = calculate_complement_times(
        automatic_segments, total_file_duration
    )

    non_overlap_1 = calculate_overlap_duration(
        automatic_segments, hand_annotation_complement
    )
    non_overlap_2 = calculate_overlap_duration(
        hand_annotations, auto_segments_complement
    )
    non_overlap = non_overlap_1 + non_overlap_2

    match_percent = ((total_file_duration - non_overlap) / total_file_duration) * 100
    match_percent = round(match_percent, 2)  # Round to two decimal places

    print(f"Match Percentage: {match_percent:.2f}%")
    print(f"Total File Duration: {total_file_duration:.2f} seconds")

    # Create a list to store the results
    results = [("File Name", "Match Percentage", "Duration")]

    # Append the results to the list
    results.append(
        (str(file_id), f"{match_percent:.2f}%", f"{total_file_duration:.2f} seconds")
    )

    # Check if the output file already exists
    if os.path.isfile(output_file):
        # Read the existing data from the file
        existing_data = []
        with open(output_file, "r") as file:
            reader = csv.reader(file)
            existing_data = list(reader)

        # Find the index of the existing file name (first column)
        file_name_index = existing_data[0].index("File Name")
        existing_file_names = [row[file_name_index] for row in existing_data[1:]]

        # If the file name already exists, remove the existing entry
        if str(file_id) in existing_file_names:
            existing_data = [
                row for row in existing_data if row[file_name_index] != str(file_id)
            ]

        # Append the updated results to the existing data
        updated_data = existing_data + results[1:]

        # Write the updated data to the file
        with open(output_file, "w", newline="") as file:
            writer = csv.writer(file)

            # Write the updated data
            writer.writerows(updated_data)
    else:
        # Open the output file in write mode and write the results
        with open(output_file, "w", newline="") as file:
            writer = csv.writer(file)

            # Write the header row
            writer.writerow(results[0])

            # Write the results
            writer.writerows(results[1:])

    # Close the database connection
    conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Compare automatic detection with hand annotations"
    )
    parser.add_argument(
        "json_file",
        type=pathlib.Path,
        help="Path to the JSON file of automatic detection",
    )

    args = parser.parse_args()

    output_file = "scripts/output/llmMatchPercentages.csv"
    compare_annotations(args.json_file, output_file)
