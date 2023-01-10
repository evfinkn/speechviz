import pathlib
import sys

# this script is simple enough to not really need argparse
# we can just grab the parsed in arguments directly from sys.argv
# sys.argv[0] is always the script being called, so in this case "rename_files.py"
# the rest of sys.argv is the arguments passed in by the user
if sys.argv[1].casefold() == "-h" or sys.argv[1].casefold() == "--help":
    print('Replaces instances of "old" to "new" in file names.')
    print("usage: python3 rename_files.py old new")
else:
    cwd = pathlib.Path.cwd()
    old = sys.argv[1]
    new = sys.argv[2]

    to_rename = list(cwd.glob(f"**/{old}*"))
    rename_to = [
        # convert to str in order to use .replace
        pathlib.Path(str(old_path).replace(old, new))
        for old_path in to_rename
    ]

    if any([path.exists() for path in rename_to]):
        raise Exception("Renaming would overwrite other files.")

    print("The following file names will be changed:")
    for old_path, new_path in zip(to_rename, rename_to):
        # print relative_to because otherwise the output can be very long and
        # hard to read, especially if a lot of files are being renamed
        print(f"{old_path.relative_to(cwd)} --> {new_path.relative_to(cwd)}")

    confirm = input("Proceed (y/n)? ")
    if confirm.casefold() == "y" or confirm.casefold() == "yes":
        for old_path, new_path in zip(to_rename, rename_to):
            old_path.rename(new_path)
    else:
        print("Canceling renaming.")
