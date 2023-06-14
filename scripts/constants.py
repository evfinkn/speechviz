import pathlib

# __file__ is .../speechviz/scripts/dirs.py, so parent is .../speechviz/scripts
SCRIPTS_DIR = pathlib.Path(__file__).parent
SPEECHVIZ_DIR = SCRIPTS_DIR.parent
DATA_DIR = SPEECHVIZ_DIR / "data"
LOGS_DIR = SPEECHVIZ_DIR / "logs"
LOGS_DIR.mkdir(exist_ok=True)

AUDIO_EXTS = {".mp3", ".wav", ".flac", ".ogg", ".opus"}
VIDEO_EXTS = {".mp4", ".mov"}
