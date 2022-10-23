FROM ubuntu:focal

# set DEBIAN_FRONTEND to noninteractive for building process
# avoids annoying warnings
ARG DEBIAN_FRONTEND=noninteractive

# fixes errors like:
# "Release file for __ is not valid yet (invalid for another __).
#  Updates for this repository will not be applied."
# ARG TZ="America/New_York"
# RUN apt update --fix-missing && apt install -y tzdata
# RUN echo "Acquire::Check-Valid-Until \"false\";\nAcquire::Check-Date \"false\";" | cat > /etc/apt/apt.conf.d/10no--check-valid-until

# copy git repo to the image
COPY . /app/

# install Node.js and npm
RUN apt update && apt upgrade -y && apt install -y sudo curl && \
	curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash - && \
	apt install -y nodejs

# install dependencies
RUN apt update && apt upgrade -y && apt install -y \
	cmake ninja-build ccache doxygen git wget ffmpeg \
	libgtest-dev libfmt-dev libcereal-dev libturbojpeg-dev \
	libpng-dev liblz4-dev libzstd-dev libxxhash-dev \
	libboost-system-dev libboost-filesystem-dev \
	libboost-thread-dev libboost-chrono-dev libboost-date-time-dev \
	libboost-program-options-dev libboost-regex-dev \
	libpython3-dev python3-pip \
	gcc g++ libmad0-dev libid3tag0-dev libsndfile1-dev libgd-dev && \
	apt clean
	
RUN pip3 install --no-cache-dir \
	pybind11[global] numpy \
	typing dataclasses pytest parameterized Pillow \
	-r /app/requirements.txt
	
# install VRS
RUN cd /tmp && \
	git clone https://github.com/facebookresearch/vrs.git && \
	mkdir vrs_Build && \
	cd vrs_Build && \
	cmake -DCMAKE_BUILD_TYPE=Release ../vrs/ . && \
	make -j$(nproc) install && \
	rm -rf /tmp/vrs /tmp/vrs_Build
	
# install audiowaveform
RUN cd /tmp && \
	git clone https://github.com/bbc/audiowaveform.git && \
	cd audiowaveform && \
	wget https://github.com/google/googletest/archive/release-1.12.1.tar.gz && \
	tar xzf release-1.12.1.tar.gz && \
	ln -s googletest-release-1.12.1 googletest && \
	mkdir build && \
	cd build && \
	cmake -D ENABLE_TESTS=0 .. && \
	make -j$(nproc) install && \
	rm -rf /tmp/audiowaveform

# install speechviz
RUN cd /app && \
	npm install && \
	npm run mkdir && \
	python3 db_init.py
	