if [[ "$PYANNOTE_AUTH_TOKEN" == "" ]]; then
	# 1>&2 makes the echo output to stderr
	echo "ERROR: You need to pass in the PYANNOTE_AUTH_TOKEN environment variable." 1>&2
	echo "If you're building with docker, use -e PYANNOTE_AUTH_TOKEN" 1>&2
	echo "If you're building with podman, use --env=PYANNOTE_AUTH_TOKEN" 1>&2
	echo "If you don't specify =value after PYANNOTE_AUTH_TOKEN," \
		"the value from your environment will be used." 1>&2
	exit 1
fi

# Currently there's an issue with numpy 1.24 and numba that breaks a lot of things,
# including pyannote.audio.Pipeline. aria_data_tools installs the latest numpy
# (1.24.1 at the time of this comment) so we need to downgrade it until the issue
# is fixed. See https://github.com/numba/numba/issues/8615
pip3 install --force-reinstall "numpy<1.24"

# -E on sudo to preserve environment variables like http_proxy
sudo apt install --no-install-recommends -y \
	wget ffmpeg \
	libboost-program-options-dev libboost-regex-dev \
	libmad0-dev libid3tag0-dev libsndfile1-dev libgd-dev

wget -qO- https://deb.nodesource.com/setup_16.x | sudo bash -
sudo apt install --no-install-recommends -y nodejs

sudo apt clean

# sudo -E pip3 install --no-cache-dir -U pip
# sudo -E pip3 install --no-cache-dir \
# 	typing dataclasses pytest parameterized

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

DDLIB_USE_CUDA=0
EXTRA_INDEX_URL="https://download.pytorch.org/whl/cpu"
# ,, to make the value of cuda all lowercase
if [[ ${cuda,,} == "true" || ${cuda} -eq 1 ]]; then
	DDLIB_USE_CUDA=1
	# cuda-python and nvidia-cudnn to make dlib work with cuda
	sudo pip3 install --no-cache-dir cuda-python nvidia-cudnn
	EXTRA_INDEX_URL="https://download.pytorch.org/whl/cu116"
fi

# install dlib
cd /tmp
git clone https://github.com/davisking/dlib.git
cd dlib
mkdir build
cd build
cmake -DDLIB_USE_CUDA=$DDLIB_USE_CUDA ..
cd ..
python3 setup.py install
rm -rf /tmp/dlib

# install speechviz
cd /speechviz
sudo pip3 install --no-cache-dir \
	--extra-index-url $EXTRA_INDEX_URL
	-r requirements.txt
# sudo and --unsafe-perm so that post-install (patch-package) works
sudo npm install --unsafe-perm
npm run mkdir
# remove data directory created by npm run mkdir because user will mount in their data
# speechviz.sqlite3 should be mounted as well, so don't run python3 scripts/db_init.py
rm -rf data
# this scripts downloads the models so that they don't
# need to be redownloaded everytime the image is run
python3 scripts/download_models.py
