FROM aria_data_tools:latest

ARG cuda=false

# copy git repo to the image
COPY . /speechviz/

# install dependencies
RUN apt update --fix-missing && apt upgrade -y && \
	# DEBIAN_FRONTEND="noninteractive" && TZ="America/New_York" && \
	# apt install --no-install-recommends -y sudo tzdata && \
	bash /speechviz/scripts/install_tools.sh
