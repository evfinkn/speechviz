import argparse
import re
import subprocess
from collections import defaultdict

import scipy.io.wavfile

import log
import sync_audios
from constants import DATA_DIR
from log import logger

AUDIO_DIR = DATA_DIR / "audio"

run_num_regex = re.compile(r"_run(\d*?)_")


def sync_runs(name: str):
    phone_dir = AUDIO_DIR / f"{name} Phone"
    watch_dir = AUDIO_DIR / f"{name} Watch"
    output_dir = AUDIO_DIR / f"{name}"
    output_dir.mkdir(parents=True, exist_ok=True)
    channels_dir = DATA_DIR / "channels" / name
    channels_dir.mkdir(parents=True, exist_ok=True)

    logger.debug(f"Syncing runs for {name}")
    log.log_vars(
        phone_dir=phone_dir,
        watch_dir=watch_dir,
        output_dir=output_dir,
        log_separate_=True,
    )

    runs = defaultdict(list)
    for dir in (phone_dir, watch_dir):
        for file in dir.iterdir():
            if m := re.search(run_num_regex, str(file)):
                run_num = int(m.group(1))
                runs[run_num].append(file)

    for n, audio_paths in runs.items():
        try:
            output_path = output_dir / f"run{n}.wav"
            if output_path.exists():
                logger.warning(f"Output file {output_path} already exists, skipping")
                continue
            if len(audio_paths) == 1:
                logger.debug(f"Copying {audio_paths[0]} to {output_path}")
                subprocess.run(["cp", audio_paths[0], output_path], capture_output=True)
                continue

            logger.debug(f"Syncing run {n}")
            # sync_audios.main(audio_paths, output_path)
            audios, sr = sync_audios.load_audios(audio_paths, mono=False)
            lags = sync_audios.get_audios_lags(
                audios, bounds=[(1, 40000), (0, 0)], threshold=0.75
            )
            synced_audios = sync_audios.sync_audios(audios, lags, mode="pad")
            synced_audio = sync_audios.overlay_audios(synced_audios)
            # synced_audio.T because it expects (Nsamples, Nchannels), but synced_audio
            # is (Nchannels, Nsamples) because that's what librosa uses
            scipy.io.wavfile.write(output_path, sr, synced_audio.T)
            logger.debug(f"Saved synced audio to {output_path}")

            channels_file = channels_dir / f"run{n}-channels.csv"
            channels_file.write_text("Phone\nWatch\n")
            logger.debug(f"Saved channels to {channels_file}")
        except Exception as e:
            logger.error(f"Error syncing run {n}")
            logger.exception(e)
            continue


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Sync audio files from phone and watch for each run"
    )
    parser.add_argument(
        "name",
        help=(
            "Name of the subject to sync. Phone audio files should be in "
            "'data/audio/<name> Phone' and watch audio files should be in "
            "'data/audio/<name> Watch'. Synced audio files will be saved in "
            "'data/audio/<name>'."
        ),
    )
    log.add_log_level_argument(parser)

    args = parser.parse_args()
    log.setup_logging(args.log_level)

    sync_runs(args.name)
