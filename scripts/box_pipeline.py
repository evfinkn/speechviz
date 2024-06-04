# Want to be able to annotate which box is target speaker.
import os
import pathlib
import subprocess

import cv2
import torch
from projectaria_tools.core.stream_id import StreamId

from cluster_faces import main as cluster
from ego_blur_undistorted_video import get_device, visualize_video
from encode_array_faces import main as encode
from util_aria import UndistortVrsVideoTransform, VrsVideoClip

# Step 1: Undistort unblurred vrs
print("Undistorting video...")


vrs_path = "/home/blhohmann/miniconda3/envs/myenv/speechviz/data/vrs/video1.vrs"
stream_id = StreamId("1201-1")
with VrsVideoClip(vrs_path, stream_id) as clip:
    undistort_transform = UndistortVrsVideoTransform.from_clip(clip)
    clip.fl(undistort_transform)
    clip.write_videofile(
        "/home/blhohmann/miniconda3/envs/myenv/speechviz/data/video/undistorted.mp4"
    )

cap = cv2.VideoCapture(
    "/home/blhohmann/miniconda3/envs/myenv/speechviz/data/video/undistorted.mp4"
)

fps = 30

if not cap.isOpened():
    print("Error: Could not open video file")
else:
    fps = cap.get(cv2.CAP_PROP_FPS)
    print("FPS:", fps)

fourcc = cv2.VideoWriter_fourcc(*"mp4v")

command = (
    "ffmpeg -y -i "
    "/home/blhohmann/miniconda3/envs/myenv/speechviz/data/video/undistorted.mp4 "
    '-vf "transpose=1" '
    "/home/blhohmann/miniconda3/envs/myenv/speechviz/data/video/rotated.mp4"
)
subprocess.run(command, shell=True)

cap.release()

# Step 2: Run Ego Blur on undistorted unblurred video and store what bounding
# boxes are on each frame
print("Running Ego Blur...")

face_model_path = (
    "/home/blhohmann/miniconda3/envs/myenv/speechviz/scripts/models/ego_blur_face.jit"
)
input_video_path = (
    "/home/blhohmann/miniconda3/envs/myenv/speechviz/scripts"
    "/mps_work/subject_rotated.mp4"
)
output_video_path = (
    "/home/blhohmann/miniconda3/envs/myenv/"
    "speechviz/scripts/mps_work/subject_rotated_blurred.mp4"
)
output_video_fps = 10
output_image_array = "face_images.npy"
# if output_image_array exists delete it

if os.path.exists(output_image_array):
    os.remove(output_image_array)
face_detector = None
face_detector = torch.jit.load(face_model_path, map_location="cpu").to(get_device())
face_detector.eval()

visualize_video(
    input_video_path=input_video_path,
    face_detector=face_detector,
    lp_detector=None,
    face_model_score_threshold=0.9,
    lp_model_score_threshold=None,
    nms_iou_threshold=0.3,
    output_video_path=output_video_path,
    scale_factor_detections=1,
    output_video_fps=output_video_fps,
    output_image_array=output_image_array,
)

# Step 3: Save in an array the cropped faces of the bounding boxes
encode(
    images=output_image_array,
    encodings=pathlib.Path("encodings.pickle"),
    detection_method="cnn",
    outputs=pathlib.Path("face_images"),
)

# # Step 4: Cluster
cluster(
    encodings=pathlib.Path("encodings.pickle"),
    outputs=pathlib.Path("data/faceClusters/video1_blur"),
    jobs=1,
    epsilon=0.25,
)


# # Step 5: Remove all the files we made
os.remove(pathlib.Path("encodings.pickle"))  # the encodings for the face
os.remove(
    pathlib.Path("face_dict.pickle")
)  # the keys are framenums and value a list of the boxes x1 y1 x2 y2
# the unblurred undistorted video
os.remove(
    pathlib.Path(
        "/home/blhohmann/miniconda3/envs/myenv/speechviz/data/video/undistorted.mp4"
    )
)
# the rotated unblurred undistorted video
os.remove(
    pathlib.Path(
        "/home/blhohmann/miniconda3/envs/myenv/speechviz/data/video/rotated.mp4"
    )
)
