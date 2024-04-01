import argparse
import csv
import os

parser = argparse.ArgumentParser(
    description=(
        "This script is used to combine the stats text files from PhaseII or PhaseIII"
        " into a single stats csv file"
    )
)
parser.add_argument(
    "input_dir",
    type=str,
    help="The directory containing the text files from the facebook study",
)
parser.add_argument(
    "output_file", type=str, help="The name of the CSV file to be created"
)
args = parser.parse_args()
directory = args.input_dir


# The headers that we want to save
fields = ["wid", "sub", "exp", "run", "type", "dTime", "eVal", "eTime"]
data_list = []

for filename in os.listdir(directory):
    if (
        filename.endswith(".txt")
        and "Bio" not in filename
        and "acc" not in filename
        and "gyro" not in filename
        and "Note" not in filename
    ):
        with open(os.path.join(directory, filename), "r") as file:
            data = {}
            for line in file:
                parts = line.strip().split(":")
                if len(parts) == 2:
                    key, value = parts[0], parts[1].strip()
                    if key in fields:
                        # Have this just in case, to make sure the time isn't truncated
                        if key in ["dTime", "eTime"]:
                            data[key] = int(value)
                        else:
                            data[key] = value
            data_list.append(data)

# Sort the data by exp, then run
if "exp" in data_list[0]:
    data_list.sort(key=lambda x: (int(x["exp"]), int(x["run"])))
else:
    data_list.sort(key=lambda x: int(x["run"]))

# Replace this path with where you want to output the combined csv of stats
with open(args.output_file, "w", newline="") as csvfile:
    writer = csv.DictWriter(csvfile, fieldnames=fields)
    writer.writeheader()
    for data in data_list:
        writer.writerow(data)
