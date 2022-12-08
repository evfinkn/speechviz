# import the necessary packages
from imutils import paths
import face_recognition
import argparse
import pickle
import cv2
import os
import numpy as np
from PIL import Image

# construct the argument parser and parse the arguments
ap = argparse.ArgumentParser()
ap.add_argument("-i", "--dataset", type=str, required=True,
	help="path to input directory of faces + images")
ap.add_argument("-e", "--encodings", type=str, required=True,
	help="path to serialized db of facial encodings")
ap.add_argument("-d", "--detection-method", type=str, default="cnn",
	help="face detection model to use: either `hog` or `cnn`")
ap.add_argument("-o", "--outputs", type=str, required=False,
	help="If given, will output detected faces to this folder")
args = vars(ap.parse_args())

# grab the paths to the input images in our dataset, then initialize
# out data list (which we'll soon populate)
print("[INFO] quantifying faces...")
imagePaths = list(paths.list_images(args["dataset"]))
data = []

if args["outputs"] is not None:
	if not os.path.isdir(args["outputs"]):
		os.makedirs(args["outputs"])

counter = 0	
# loop over the image paths
for (i, imagePath) in enumerate(imagePaths):
	# load the input image and convert it from RGB (OpenCV ordering)
	# to dlib ordering (RGB)
	if (i + 1) % 100 == 0:
		print("[INFO] processing image {}/{}".format(i + 1, len(imagePaths)))
		print(imagePath)
	image = cv2.imread(imagePath)
	rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

	# detect the (x, y)-coordinates of the bounding boxes
	# corresponding to each face in the input image
	boxes = face_recognition.face_locations(rgb, model=args["detection_method"])

	# compute the facial embedding for the face
	encodings = face_recognition.face_encodings(rgb, boxes)

	# build a dictionary of the image path, bounding box location,
	# and facial encodings for the current image
	d = [{"imagePath": imagePath, "loc": box, "encoding": enc}
		for (box, enc) in zip(boxes, encodings)]
	data.extend(d)

	if args["outputs"] is not None:
		print("There were {} face(s) in this image.".format(len(boxes)))
		for box in boxes:
			#Print the location of each face in this image
			top, right, bottom, left = box

			face_image = image[top:bottom, left:right]
			pil_image = np.array(Image.fromarray(face_image))
			cv2.imwrite(args["outputs"] + "/Num" + str(counter) + ".jpg", pil_image)
			counter += 1

# dump the facial encodings data to disk
print("[INFO] serializing encodings...")
f = open(args["encodings"], "wb")
f.write(pickle.dumps(data))
f.close()

#based off of https://pyimagesearch.com/2018/07/09/face-clustering-with-python/
