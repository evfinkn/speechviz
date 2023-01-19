if [[ "$PYANNOTE_AUTH_TOKEN" == "" ]]; then
	# 1>&2 makes the echo output to stderr
	echo "ERROR: You need to pass in the PYANNOTE_AUTH_TOKEN environment variable." 1>&2
	echo "If you're building with docker, use -e PYANNOTE_AUTH_TOKEN" 1>&2
	echo "If you're building with podman, use --env=PYANNOTE_AUTH_TOKEN" 1>&2
	echo "If you don't specify =value after PYANNOTE_AUTH_TOKEN," \
		"the value from your environment will be used." 1>&2
	exit 1
fi

print_section_header () {
	printf "\n"
	# print "=" 40 times - see https://stackoverflow.com/a/5349842
	printf "=%.0s" {1..40}
	# print the first argument
	printf "\n\n$1\n\n"
	printf "=%.0s" {1..40}
	# printf doesn't add a \n so need to output 2 \n to add a blank line
	# and then to put the next output on the line after the blank line
	printf "\n\n"
}

# Currently there's an issue with numpy 1.24 and numba that breaks a lot of things,
# including pyannote.audio.Pipeline. aria_data_tools installs the latest numpy
# (1.24.1 at the time of this comment) so we need to downgrade it until the issue
# is fixed. See https://github.com/numba/numba/issues/8615
print_section_header "INSTALLING NUMPY"
pip3 install --force-reinstall "numpy<1.24"

print_section_header "INSTALLING APT PACKAGES"
sudo apt install --no-install-recommends -y \
	wget ffmpeg \
	libboost-program-options-dev libboost-regex-dev \
	libmad0-dev libid3tag0-dev libsndfile1-dev libgd-dev

# aria_data_tools installs node but we want a newer version
print_section_header "INSTALLING NODE"
wget -qO- https://deb.nodesource.com/setup_16.x | sudo bash -
sudo apt install --no-install-recommends -y nodejs

sudo apt clean

# install audiowaveform
print_section_header "INSTALLING AUDIOWAVEFORM"
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

# print this here so that if the pip3 install in the if runs, it's under this header
print_section_header "INSTALLING DLIB"

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

# install whisper to build transcribe.cpp
print_section_header "INSTALLING WHISPER.CPP"
cd /tmp
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp
cp /speechviz/scripts/transcribe.cpp .
mkdir /speechviz/scripts/models
bash models/download-ggml-model.sh base.en
make ggml.o whisper.o
g++ -std=c++17 -O3 -Iexamples -fPIC -pthread \
	transcribe.cpp ggml.o whisper.o -o /speechviz/scripts/transcribe
mv models/ggml-base.en.bin /speechviz/scripts/models/whisper-base.en.bin
rm -rf /tmp/whisper.cpp

# install speechviz
print_section_header "INSTALLING SPEECHVIZ"
cd /speechviz
sudo pip3 install --no-cache-dir \
	--extra-index-url $EXTRA_INDEX_URL \
	-r requirements.txt
npm install
npm run mkdir
# remove data directory created by npm run mkdir because user will mount in their data
# speechviz.sqlite3 should be mounted as well, so don't run python3 scripts/db_init.py
rm -rf data
# this scripts downloads the models so that they don't
# need to be redownloaded everytime the image is run
python3 scripts/download_models.py
