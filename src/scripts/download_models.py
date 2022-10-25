from pyannote.audio import Pipeline
Pipeline.from_pretrained("pyannote/speaker-diarization@2022.07")
Pipeline.from_pretrained("pyannote/voice-activity-detection")