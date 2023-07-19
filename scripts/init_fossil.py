import json
import platform
import re
import tarfile
import zipfile
from pathlib import Path
from urllib import request

import log
from constants import DATA_DIR, DATA_REPO, FOSSIL_PATH
from log import logger


# this won't get the correct download for raspberry pi
def get_filename_re() -> str:
    # regular expressions taken from fossil:
    # https://fossil-scm.org/home/uv/download.js
    system = platform.system()
    machine = platform.machine()
    if system == "Linux":
        return "-linux-"
    elif system == "Darwin":
        if machine == "arm64":
            return "-mac-arm6?4?-"
        return "-mac(-x64|osx)-"
    elif system == "Windows":
        if machine == "x86_64":
            return "-w64-"
        return "-w32-"
    raise Exception(f"Unknown system {system} and machine {machine}")


def get_latest_filename() -> str:
    filename_re = get_filename_re()
    # juvlist returns array of objects with keys name, mtime, hash, size, and user
    juvlist = request.urlopen("https://fossil-scm.org/home/juvlist")
    juvlist = json.loads(juvlist.read())
    filename = None
    version = None
    for item in juvlist:
        # test if the file name is for the correct system
        if re.search(filename_re, item["name"]):
            # we want the latest version of fossil, so compare the version number
            # of the current item to the current version number
            item_version = re.search(r"(\d+).(\d+)", item["name"])
            if item_version:
                # map to int because groups returns strings
                item_version = tuple(map(int, item_version.groups()))
                # tuples are compared element by element, so (3, 0) > (2, 22)
                if version is None or version < item_version:
                    version = item_version
                    filename = item["name"]
    if filename is None:
        raise Exception("Could not find download url")
    return filename


def download_fossil(filename: str, filepath: Path = None):
    if filepath is None:
        filepath = Path(filename)
    fossil_url = f"https://fossil-scm.org/home/uv/{filename}"
    with request.urlopen(fossil_url) as response, open(filepath, "wb") as file:
        while True:
            # 8192 is bytes, so 8 KB. Reading in chunks saves memory for large files
            chunk = response.read(8192)
            if not chunk:
                break
            file.write(chunk)


def extract_archive(filepath: Path, remove: bool = True):
    # use endswith instead of suffix because suffix only includes the last suffix
    # and instead of suffixes because minor version numbers will be counted as suffixes
    # and having to slice suffixes is more complicated / confusing than using endswith
    if str(filepath).endswith(".tar.gz"):
        with tarfile.open(filepath, "r:gz") as tar:
            tar.extractall(filepath.parent)
    elif filepath.suffix == ".zip":
        with zipfile.ZipFile(filepath) as zip:
            zip.extractall(filepath.parent)
    else:
        raise Exception(f"Unexpected file type on file {filepath}")

    if remove:
        filepath.unlink()


def make_executable(filepath: Path):
    # we don't need a special case for windows because Path.chmod handles it
    # 0o100, 0o010, 0o001 is execute for owner, group, others respectively
    # so makes it executable for everyone
    filepath.chmod(filepath.stat().st_mode | 0o111)


def install_fossil():
    if FOSSIL_PATH.exists():
        logger.info("fossil is already installed")
        return

    archive_name = get_latest_filename()
    # extract_archive extracts to the parent directory so download to the same directory
    # that fossil is expected to be in
    archive_path = FOSSIL_PATH.parent / archive_name
    download_fossil(archive_name, archive_path)
    extract_archive(archive_path)
    if not FOSSIL_PATH.exists():
        raise Exception(f'"fossil" was not in {archive_path}')
    make_executable(FOSSIL_PATH)


def init_repo():
    if DATA_REPO.exists():
        logger.info("{} already exists", DATA_REPO.name)
    else:
        log.run_and_log_subprocess(
            [FOSSIL_PATH, "init", "--project-name", "speechviz", DATA_REPO], check=False
        )
    # fossil open won't overwrite an existing checkout so we don't need an if for that
    log.run_and_log_subprocess(
        # -f makes open work even if data isn't empty
        [FOSSIL_PATH, "open", "-f", "--workdir", DATA_DIR, DATA_REPO],
        check=False,
    )


if __name__ == "__main__":
    install_fossil()
    init_repo()
