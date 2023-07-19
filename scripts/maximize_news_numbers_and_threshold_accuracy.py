import csv
import os
import pathlib

import numpy as np

import analyze_llm_match_percentages
import compare_llm_news_to_truth
import news_analysis_num_sentences

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
    "data/segments/SWII1008/run200-segments.json",
    "data/segments/SWII1003/run122-segments.json",
    "data/segments/SWII1008/run57-segments.json",
    "data/segments/SWII1001/run54-segments.json",
    "data/segments/SWII1001/run7-segments.json",
    "data/segments/SWII1006/run100-segments.json",
    "data/segments/SWII1008/run266-segments.json",
    "data/segments/SWII1002/run99-segments.json",
    "data/segments/SWII1010/run176-segments.json",
    "data/segments/SWII1002/run239-segments.json",
    "data/segments/SWII1001/run55-segments.json",
    "data/segments/SWII1010/run5-segments.json",
    "data/segments/SWII1005/run96-segments.json",
    "data/segments/SWII1003/run121-segments.json",
    "data/segments/SWII1005/run193-segments.json",
    "data/segments/SWII1011/run8-segments.json",
    "data/segments/SWII1007/run9-segments.json",
    "data/segments/SWII1008/run155-segments.json",
    "data/segments/SWII1006/run209-segments.json",
    "data/segments/SWII1006/run169-segments.json",
    "data/segments/SWII1009/run126-segments.json",
    "data/segments/SWII1002/run44-segments.json",
    "data/segments/SWII1007/run19-segments.json",
    "data/segments/SWII1010/run39-segments.json",
    "data/segments/SWII1005/run199-segments.json",
    "data/segments/SWII1008/run188-segments.json",
    "data/segments/SWII1008/run184-segments.json",
    "data/segments/SWII1007/run206-segments.json",
    "data/segments/SWII1002/run43-segments.json",
    "data/segments/SWII1005/run48-segments.json",
]

# try to find the best threshold and/or number of sentences to group by
# for accuracy in detecting news

# workflow
# 1. run scripts/news_analysis_num_sentences.py on hand annotated files
#    with different num sentences and thresholds
# 2. compare them to the hand annotations
# 3. output the average found for this sentence number and threshold

result_file = "scripts/output/maximize_news_accuracy.csv"


for num_sentences in np.arange(1, 6):
    for threshold in np.arange(0.5, 2.1, 0.1):
        for file in transcription_file_paths:
            news_analysis_num_sentences.main(
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
