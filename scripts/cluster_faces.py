# import the neccessary packages
from sklearn.cluster import DBSCAN
from sklearn.cluster import OPTICS
from imutils import build_montages
import numpy as np
import argparse
import pickle
import cv2
import os
# construct the argument parser and parse the arguments
ap = argparse.ArgumentParser()
ap.add_argument("-e", "--encodings", required=True,
        help="path to serialized db of facial encodings")
ap.add_argument("-j", "--jobs", type=int, default=-1,
        help="# of parallel jobs to run (-1 will use all CPUs)")
ap.add_argument("-eps", "--epsilon", default=.4,
        help="Controls how far away points can be from one antoher to still be a cluster. Too small and all will be considered noise, too large and all will be grouped as 1 face.")
ap.add_argument("-o", "--outputs", required=True)
args = vars(ap.parse_args())

# load the serialized face encodings + bounding box locations from
# disk, then extract the set of encodings to so we can cluster on
# them
print("[INFO] loading encodings...")
data = pickle.loads(open(args["encodings"], "rb").read())
data = np.array(data)
encodings = [d["encoding"] for d in data]

# cluster the embeddings
print("[INFO] clustering...")
#dbscan
clt = DBSCAN(float(args["epsilon"]), metric="euclidean", n_jobs=args["jobs"])
#uncomment this and recomment clt above, OPTICS is like dbscan but sweeps through different epsilon values, and picks which one it thinks is right. I haven't had success with it but could be worth a shot later.
#clt = OPTICS(min_samples=2)
clt.fit(encodings)

# determine the total number of unique faces found in the dataset
labelIDs = np.unique(clt.labels_)
numUniqueFaces = len(np.where(labelIDs > -1)[0])
print("[INFO] # unique faces: {}".format(numUniqueFaces))

# loop over the unique face integers
for labelID in labelIDs:
    print("[INFO] faces for face ID: {}".format(labelID))
    idxs = np.where(clt.labels_ == labelID)[0]
    faces = []
    if not os.path.isdir(args["outputs"]):
        os.makedirs(args["outputs"])
    # loop over the sampled indexes
    for i in idxs:
        # load the input image and extract the face ROI
        image = cv2.imread(data[i]["imagePath"])
        (top, right, bottom, left) = data[i]["loc"]
        face = image[top:bottom, left:right]
        faces.append(face)
    counter = 0
    for face in faces:
        counter += 1
        if not os.path.isdir(args["outputs"] + "/testLabel" + str(labelID)):
        	os.makedirs(args["outputs"] + "/testLabel" + str(labelID))
        cv2.imwrite(args["outputs"] + "/testLabel" + str(labelID) + "/Num" + str(counter) + ".jpg", face)

#built off of https://pyimagesearch.com/2018/07/09/face-clustering-with-python/
