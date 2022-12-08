#!/bin/bash

file="$1"
if [[ "$file" != *.vrs ]]; then
	echo "$file isn't a vrs file" 1>&2
	exit 1
fi
file_first_id=${file%-*}
save_dir=${2-.}  # save data to directory passed in or current directory
save_dir=${save_dir%/}  # remove last slash from path if present

# vrs extract-all "$file" --to "$save_dir"
vrs print-json "$file" + 247-1 > "${save_dir}/barometer.jsons"
vrs print-json "$file" + 281-1 > "${save_dir}/gps.jsons"
vrs print-json "$file" + 283-1 > "${save_dir}/bluetooth.jsons"
vrs print-json "$file" + 285-1 > "${save_dir}/time.jsons"
vrs print-json "$file" + 1202-1 > "${save_dir}/imu1.jsons"  # imu-right
vrs print-json "$file" + 1202-2 > "${save_dir}/imu2.jsons"  # imu-left
vrs print-json "$file" + 1203-1 > "${save_dir}/magnetometer.jsons"