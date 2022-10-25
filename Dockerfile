FROM ubuntu:focal

# set DEBIAN_FRONTEND to noninteractive for building process
# avoids annoying warnings

# copy git repo to the image
COPY . /app/

# install dependencies
RUN apt update && apt upgrade -y && \
	DEBIAN_FRONTEND="noninteractive" && TZ="America/New_York" && \
	apt install --no-install-recommends -y sudo tzdata && \
	bash /app/src/scripts/install-tools.sh