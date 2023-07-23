import csv
import os
import pathlib

import numpy as np

import analyze_llm_match_percentages
import compare_llm_news_to_truth
import news_analysis

# the randomly selected files which were hand annotated
transcription_file_paths = [
    "data/transcriptions/SWII1008/run200-transcription.json",
    "data/transcriptions/SWII1003/run122-transcription.json",
    "data/transcriptions/SWII1008/run57-transcription.json",
    "data/transcriptions/SWII1001/run54-transcription.json",
    "data/transcriptions/SWII1001/run7-transcription.json",
    "data/transcriptions/SWII1006/run100-transcription.json",
    "data/transcriptions/SWII1008/run266-transcription.json",
    "data/transcriptions/SWII1002/run99-transcription.json",
    "data/transcriptions/SWII1010/run176-transcription.json",
    "data/transcriptions/SWII1002/run239-transcription.json",
    "data/transcriptions/SWII1001/run55-transcription.json",
    "data/transcriptions/SWII1010/run5-transcription.json",
    "data/transcriptions/SWII1005/run96-transcription.json",
    "data/transcriptions/SWII1003/run121-transcription.json",
    "data/transcriptions/SWII1005/run193-transcription.json",
    "data/transcriptions/SWII1011/run8-transcription.json",
    "data/transcriptions/SWII1007/run9-transcription.json",
    "data/transcriptions/SWII1008/run155-transcription.json",
    "data/transcriptions/SWII1006/run209-transcription.json",
    "data/transcriptions/SWII1006/run169-transcription.json",
    "data/transcriptions/SWII1009/run126-transcription.json",
    "data/transcriptions/SWII1002/run44-transcription.json",
    "data/transcriptions/SWII1007/run19-transcription.json",
    "data/transcriptions/SWII1010/run39-transcription.json",
    "data/transcriptions/SWII1005/run199-transcription.json",
    "data/transcriptions/SWII1008/run188-transcription.json",
    "data/transcriptions/SWII1008/run184-transcription.json",
    "data/transcriptions/SWII1007/run206-transcription.json",
    "data/transcriptions/SWII1002/run43-transcription.json",
    "data/transcriptions/SWII1005/run48-transcription.json",
]

segment_file_paths = [
    "data/annotations/SWII1008/run200-annotations.json",
    "data/annotations/SWII1003/run122-annotations.json",
    "data/annotations/SWII1008/run57-annotations.json",
    "data/annotations/SWII1001/run54-annotations.json",
    "data/annotations/SWII1001/run7-annotations.json",
    "data/annotations/SWII1006/run100-annotations.json",
    "data/annotations/SWII1008/run266-annotations.json",
    "data/annotations/SWII1002/run99-annotations.json",
    "data/annotations/SWII1010/run176-annotations.json",
    "data/annotations/SWII1002/run239-annotations.json",
    "data/annotations/SWII1001/run55-annotations.json",
    "data/annotations/SWII1010/run5-annotations.json",
    "data/annotations/SWII1005/run96-annotations.json",
    "data/annotations/SWII1003/run121-annotations.json",
    "data/annotations/SWII1005/run193-annotations.json",
    "data/annotations/SWII1011/run8-annotations.json",
    "data/annotations/SWII1007/run9-annotations.json",
    "data/annotations/SWII1008/run155-annotations.json",
    "data/annotations/SWII1006/run209-annotations.json",
    "data/annotations/SWII1006/run169-annotations.json",
    "data/annotations/SWII1009/run126-annotations.json",
    "data/annotations/SWII1002/run44-annotations.json",
    "data/annotations/SWII1007/run19-annotations.json",
    "data/annotations/SWII1010/run39-annotations.json",
    "data/annotations/SWII1005/run199-annotations.json",
    "data/annotations/SWII1008/run188-annotations.json",
    "data/annotations/SWII1008/run184-annotations.json",
    "data/annotations/SWII1007/run206-annotations.json",
    "data/annotations/SWII1002/run43-annotations.json",
    "data/annotations/SWII1005/run48-annotations.json",
]

# try to find the best threshold and/or number of sentences to group by
# for accuracy in detecting news

# workflow
# 1. run scripts/news_analysis.py on hand annotated files
#    with different num sentences and thresholds
# 2. compare them to the hand annotations
# 3. output the average found for this sentence number and threshold

result_file = "scripts/output/maximize_news_accuracy.csv"


for num_sentences in np.arange(1, 6):
    for threshold in np.arange(0.5, 2.1, 0.1):
        for file in transcription_file_paths:
            news_analysis.main(
                {
                    "path": [pathlib.Path(file)],
                    "numbers": num_sentences,
                    "threshold": threshold,
                    "reprocess": True,
                }
            )
        for file in segment_file_paths:
            compare_llm_news_to_truth.compare_annotations(
                pathlib.Path(file),
                pathlib.Path("scripts/output/llmMatchPercentages.csv"),
            )
        average = analyze_llm_match_percentages.output_weighted_avg_percent()

        if not os.path.isfile(result_file):
            header = ["Match Percentage", "Num Sentences", "Threshold"]
            with open(result_file, mode="w", newline="") as csvfile:
                writer = csv.writer(csvfile)
                writer.writerow(header)
        with open(result_file, mode="a", newline="") as csvfile:
            writer = csv.writer(csvfile)
            writer.writerow([average, num_sentences, threshold])
