# import the neccessary packages
import argparse
import pathlib
import pickle
import shutil

import cv2
import numpy as np
from sklearn.cluster import DBSCAN


def run_from_pipeline(args):
    encodings = pathlib.Path(args.pop("encodings"))
    outputs = pathlib.Path(args.pop("outputs"))
    main(encodings, outputs, **args)


def main(
    encodings: pathlib.Path, outputs: pathlib.Path, jobs: int = 1, epsilon: float = 0.4
):
    # load the serialized face encodings + bounding box locations from
    # disk, then extract the set of encodings to so we can cluster on
    # them
    print("[INFO] loading encodings...")
    data = pickle.loads(encodings.read_bytes())
    data = np.array(data)
    encodings = [d["encoding"] for d in data]

    # cluster the embeddings
    print("[INFO] clustering...")
    # dbscan
    clt = DBSCAN(float(epsilon), metric="euclidean", n_jobs=jobs)

    # uncomment this and recomment clt above, OPTICS is like dbscan but sweeps through
    # different epsilon values, and picks which one it thinks is right. I haven't had
    # success with it but could be worth a shot later.
    # clt = OPTICS(min_samples=2)
    clt.fit(encodings)

    # determine the total number of unique faces found in the dataset
    labelIDs = np.unique(clt.labels_)
    numUniqueFaces = len(np.where(labelIDs > -1)[0])
    print(f"[INFO] # unique faces: {numUniqueFaces}")

    if outputs.exists():
        # overwrite old clusters so they don't build
        # upon an old version and mix together
        shutil.rmtree(outputs)
    outputs.mkdir(parents=True, exist_ok=True)

    # loop over the unique face integers
    for labelID in labelIDs:
        print(f"[INFO] faces for face ID: {labelID}")
        idxs = np.where(clt.labels_ == labelID)[0]
        faces = []
        # loop over the sampled indexes
        for i in idxs:
            # load the input image and extract the face ROI
            image = cv2.imread(data[i]["imagePath"])
            (top, right, bottom, left) = data[i]["loc"]
            face = image[top:bottom, left:right]
            # resize image so it displays better on speechviz,
            # https://stackoverflow.com/questions/64609524/resize-an-image-with-a-max-width-and-height-using-opencv
            maxwidth, maxheight = 200, 200
            f1 = maxwidth / face.shape[1]
            f2 = maxheight / face.shape[0]
            f = min(f1, f2)  # resizing factor
            dim = (int(face.shape[1] * f), int(face.shape[0] * f))
            resized = cv2.resize(face, dim)

            faces.append(resized)
        counter = 0

        for face in faces:
            counter += 1
            faceFolder = outputs / f"face{labelID}"
            faceFolder.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(faceFolder / f"Num{counter}.jpg"), face)

    # built off of https://pyimagesearch.com/2018/07/09/face-clustering-with-python/


if __name__ == "__main__":
    # construct the argument parser and parse the arguments
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "-e",
        "--encodings",
        required=True,
        type=pathlib.Path,
        help="path to serialized db of facial encodings",
    )
    ap.add_argument(
        "-j",
        "--jobs",
        type=int,
        default=-1,
        help="# of parallel jobs to run (-1 will use all CPUs)",
    )
    ap.add_argument(
        "-eps",
        "--epsilon",
        type=float,
        default=0.4,
        help=(
            "Controls how far away points can be from one antoher to still be a"
            " cluster. Too small and all will be considered noise, too large and all"
            " will be grouped as 1 face."
        ),
    )
    ap.add_argument(
        "-o",
        "--outputs",
        required=True,
        type=pathlib.Path,
        help=(
            "Folder the clustered faces will be output to. Should match the video name"
            " without its extension, and be of the format data/faceClusters/videoName"
            " or you will have to manually move it to match this"
        ),
    )
    args = vars(ap.parse_args())
    main(**args)
