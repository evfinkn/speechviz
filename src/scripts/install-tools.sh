export DEBIAN_FRONTEND="noninteractive"

sudo apt install --no-install-recommends -y \
	cmake ninja-build ccache doxygen git wget ffmpeg \
	libgtest-dev libfmt-dev libcereal-dev libturbojpeg-dev \
	libpng-dev liblz4-dev libzstd-dev libxxhash-dev \
	libboost-system-dev libboost-filesystem-dev \
	libboost-thread-dev libboost-chrono-dev libboost-date-time-dev \
	libboost-program-options-dev libboost-regex-dev \
	libpython3-dev python3-pip \
	gcc g++ libmad0-dev libid3tag0-dev libsndfile1-dev libgd-dev

wget -qO- https://deb.nodesource.com/setup_16.x | sudo -E bash -
sudo apt install --no-install-recommends -y nodejs

sudo apt clean

sudo pip3 install --no-cache-dir \
	pybind11[global] numpy \
	typing dataclasses pytest parameterized Pillow

# install VRS	
cd /tmp
git clone https://github.com/facebookresearch/vrs.git
mkdir vrs_Build
cd vrs_Build
cmake -DCMAKE_BUILD_TYPE=Release ../vrs/ .
sudo make -j$(nproc) install
rm -rf /tmp/vrs /tmp/vrs_Build

# install audiowaveform
cd /tmp
git clone https://github.com/bbc/audiowaveform.git
cd audiowaveform
wget https://github.com/google/googletest/archive/release-1.12.1.tar.gz
tar xzf release-1.12.1.tar.gz
ln -s googletest-release-1.12.1 googletest
mkdir build
cd build
cmake -D ENABLE_TESTS=0 ..
sudo make -j$(nproc) install
rm -rf /tmp/audiowaveform

# install speechviz
cd /app
sudo pip3 install --no-cache-dir -r /app/requirements.txt
npm install
npm run mkdir
python3 /src/scripts/db_init.py