FROM ubuntu:focal

ARG cuda=false

# copy git repo to the image
COPY . /app/

# install dependencies
RUN apt update --fix-missing && apt upgrade -y && \
	DEBIAN_FRONTEND="noninteractive" && TZ="America/New_York" && \
	apt install --no-install-recommends -y sudo tzdata && \
	bash /app/src/scripts/install-tools.sh