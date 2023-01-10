import pathlib
import sys

print(f"renaming instances of {sys.argv[1]} to {sys.argv[2]}")
print(f"\ninstances of {sys.argv[1]}:")
to_rename = list(pathlib.Path.cwd().glob(f"**/{sys.argv[1]}*"))
for path in to_rename:
    print(path)

print("\nrenaming to:")
rename_to = [
    pathlib.Path(str(path).replace(sys.argv[1], sys.argv[2])) for path in to_rename
]
for path in rename_to:
    print(path)

if any([path.exists() for path in rename_to]):
    raise Exception("Renaming would overwrite other files.")
