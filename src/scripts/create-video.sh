#!/bin/bash

dir="$1"
if [[ ! -e "$dir" || ! -d "$dir" ]]; then
	echo "$dir doesn't exist or isn't a directory" 1>&2
	exit 1
fi
cd "$dir"

concat_file="concat.txt"
rm -f $concat_file
touch $concat_file

re=".*-([[:digit:]]*)\.([[:digit:]]*)\.jpg"
prev_time=0
for file in *; do
	if [[ "$file" =~ $re ]]; then
		time=${BASH_REMATCH[1]}${BASH_REMATCH[2]}
		dur=$((time - prev_time))
		prev_time=$time
		echo "duration ${dur}" >> $concat_file
		echo "file ${file}" >> $concat_file
	fi
done
sed -i -e "1d" $concat_file
ffmpeg -loglevel error -y -f concat -i $concat_file -vf "settb=1/1000,setpts=PTS/1000" \
	-c:v libx264 -pix_fmt yuv420p -vsync vfr -r 1000 "$(basename "$PWD").mp4"
