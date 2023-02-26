# import the necessary packages
import argparse
import pathlib
import pickle

import cv2
import face_recognition
import numpy as np
from PIL import Image

# standard image file formats that're supported by cv2.imread
image_types = (".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff")


def run_from_pipeline(args):
    if "detection-method" in args:
        args["detection_method"] = args.pop("detection-method")
    args["dataset"] = pathlib.Path(args["dataset"])
    args["encodings"] = pathlib.Path(args["encodings"])
    if "outputs" in args:
        args["outputs"] = pathlib.Path(args["outputs"])
    main(**args)


def main(
    dataset: pathlib.Path,
    encodings: str,
    detection_method: str = "cnn",
    outputs: pathlib.Path = None,
):
    # renaming here instead of just in the function definition meant not needing
    # to pop from args after parsing. It just makes things simpler
    encodings_path = encodings

    if outputs is not None:
        if outputs.is_file():
            raise Exception("outputs must be a directory.")
        outputs.mkdir(parents=True, exist_ok=True)

    # grab the paths to the input images in our dataset, then initialize
    # out data list (which we'll soon populate)
    print("[INFO] quantifying faces...")
    # need to convert file to str because cv2.imread doesn't take Path
    imagePaths = [str(file) for file in dataset.iterdir() if file.suffix in image_types]
    data = []

    counter = 0
    # loop over the image paths
    for i, imagePath in enumerate(imagePaths):
        # load the input image and convert it from RGB (OpenCV ordering)
        # to dlib ordering (RGB)
        if (i + 1) % 100 == 0:
            print("[INFO] processing image {}/{}".format(i + 1, len(imagePaths)))
            print(imagePath)
        image = cv2.imread(imagePath)
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

        # detect the (x, y)-coordinates of the bounding boxes
        # corresponding to each face in the input image
        boxes = face_recognition.face_locations(rgb, model=detection_method)

        # compute the facial embedding for the face
        encodings = face_recognition.face_encodings(rgb, boxes)

        # build a dictionary of the image path, bounding box location,
        # and facial encodings for the current image
        d = [
            {"imagePath": imagePath, "loc": box, "encoding": enc}
            for (box, enc) in zip(boxes, encodings)
        ]
        data.extend(d)

        if outputs is not None:
            print(f"There were {len(boxes)} face(s) in this image.")
            for box in boxes:
                # Print the location of each face in this image
                top, right, bottom, left = box

                face_image = image[top:bottom, left:right]
                pil_image = np.array(Image.fromarray(face_image))
                cv2.imwrite(str(outputs / f"Num{counter}.jpg"), pil_image)
                counter += 1

    # dump the facial encodings data to disk
    print("[INFO] serializing encodings...")
    encodings_path.write_bytes(pickle.dumps(data))

    # based off of https://pyimagesearch.com/2018/07/09/face-clustering-with-python/


if __name__ == "__main__":
    # construct the argument parser and parse the arguments
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "-i",
        "--dataset",
        required=True,
        type=pathlib.Path,
        help="path to input directory of faces + images",
    )
    ap.add_argument(
        "-e",
        "--encodings",
        required=True,
        help="path to serialized db of facial encodings",
    )
    ap.add_argument(
        "-d",
        "--detection-method",
        default="cnn",
        help="face detection model to use: either `hog` or `cnn`",
    )
    ap.add_argument(
        "-o",
        "--outputs",
        type=pathlib.Path,
        help="If given, will output detected faces to this folder",
    )
    args = vars(ap.parse_args())
    main(**args)
