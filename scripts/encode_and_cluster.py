import argparse
import os
from encode_faces import main as encode
from cluster_faces import main as cluster

parser = argparse.ArgumentParser(description="Process audio files.")
# encode face args
parser.add_argument("-i", "--dataset", type=str, required=True,
    help="path to input directory of faces + images, should be in data/imagesForEncoding")
parser.add_argument("-d", "--detection-method", type=str, default="cnn",
    help="face detection model to use: either `hog` or `cnn`")
# cluster face args
parser.add_argument("-j", "--jobs", type=int, default=-1,
    help="# of parallel jobs to run (-1 will use all CPUs)")
parser.add_argument("-eps", "--epsilon", default=.4,
    help="Controls how far away points can be from one another to still be a cluster. Too small and all will be considered noise, too large and all will be grouped as 1 face.")

args = vars(parser.parse_args())

headAndTail = os.path.split(args["dataset"])
videoName = headAndTail[1]

#call encode_faces.py and call cluster_faces.py
#https://stackoverflow.com/questions/44734858/python-calling-a-module-that-uses-argparser
encode(["-i", args["dataset"], "-e", args["dataset"] + "/" + videoName + ".pickle", "-d", args["detection_method"]])
cluster(["-e", args["dataset"] + "/" + videoName + ".pickle", "-j", str(args["jobs"]), "-eps", str(args["epsilon"]), "-o", "data/faceClusters/" + videoName])
