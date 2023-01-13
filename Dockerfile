FROM aria_data_tools:latest

ARG cuda=false
ARG PYANNOTE_AUTH_TOKEN
ENV PYANNOTE_AUTH_TOKEN=${PYANNOTE_AUTH_TOKEN}

# copy git repo to the image
COPY . /speechviz/

# install dependencies
RUN apt update --fix-missing && apt upgrade -y && \
	# DEBIAN_FRONTEND="noninteractive" && TZ="America/New_York" && \
	# apt install --no-install-recommends -y sudo tzdata && \
	bash /speechviz/scripts/install_tools.sh
