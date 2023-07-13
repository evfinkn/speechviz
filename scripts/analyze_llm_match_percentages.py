import csv

result_file = "scripts/output/llmMatchPercentages.csv"

total_weighted_percentage = 0
total_duration = 0

# Read the result file
with open(result_file, "r") as file:
    reader = csv.DictReader(file)

    for row in reader:
        match_percentage = float(row["Match Percentage"].rstrip("%"))
        duration = float(row["Duration"].split()[0])

        weighted_percentage = match_percentage * duration
        total_weighted_percentage += weighted_percentage
        total_duration += duration

# Calculate the weighted average percentage
weighted_average_percentage = total_weighted_percentage / total_duration

print(f"Weighted Average Percentage: {weighted_average_percentage:.2f}%")
