import os

from pyannote.audio import Pipeline

auth_token = os.environ.get("PYANNOTE_AUTH_TOKEN")
if auth_token is None:
    raise Exception(
        "To run the diarization and VAD pipelines, you need a PyAnnotate authentication"
        " token and to set the PYANNOTE_AUTH_TOKEN environment variable."
    )
Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", use_auth_token=auth_token)
Pipeline.from_pretrained("pyannote/voice-activity-detection", use_auth_token=auth_token)
