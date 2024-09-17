import pathlib
import platform

# __file__ is .../speechviz/scripts/dirs.py, so parent is .../speechviz/scripts
SCRIPTS_DIR = pathlib.Path(__file__).parent
SPEECHVIZ_DIR = SCRIPTS_DIR.parent
DATA_DIR = SPEECHVIZ_DIR / "data"
LOGS_DIR = SPEECHVIZ_DIR / "logs"
LOGS_DIR.mkdir(exist_ok=True)

AUDIO_DIR = DATA_DIR / "audio"
VIDEO_DIR = DATA_DIR / "video"
VRS_DIR = DATA_DIR / "vrs"
GRAPHICAL_DIR = DATA_DIR / "graphical"
FACE_BOXES_DIR = DATA_DIR / "faceBoxes"

_fossil_name = "fossil.exe" if platform.system() == "Windows" else "fossil"
FOSSIL_PATH = DATA_DIR / _fossil_name
DATA_REPO = DATA_DIR / "speechviz.fossil"

AUDIO_EXTS = {".mp3", ".wav", ".flac", ".ogg", ".opus"}
VIDEO_EXTS = {".mp4", ".mov"}
