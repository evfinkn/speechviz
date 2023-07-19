import argparse
import os
import pathlib
import shutil


def rename_and_move_files(source_folder):
    # Iterate through all files in the source folder (including subfolders)
    for root, _, files in os.walk(source_folder):
        for filename in files:
            # Split the relative path to identify the folder structure
            source = root.split(os.path.sep)
            source.append(filename)

            target = root.split(os.path.sep)
            target.append(filename)

            # Modify the relative path as needed
            # (here, replace "segments" with "annotations")
            for i, value in enumerate(target):
                if "segments" in value:
                    target[i] = value.replace("segments", "annotations")

            # Build the target folder path
            target_path = pathlib.Path(*target)

            # Create the parent directory of the target path if it doesn't exist
            if not os.path.exists(str(target_path.parent)):
                os.makedirs(str(target_path.parent))

            # Build the source and target paths
            source_path = pathlib.Path(*source)

            # Move the file using shutil.move
            shutil.move(str(source_path), str(target_path))
            print(f"Moved: {source_path} -> {target_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Rename and move files from a source folder to a target folder."
    )
    parser.add_argument("source_folder", help="Path to the source folder.")
    args = parser.parse_args()

    rename_and_move_files(args.source_folder)
