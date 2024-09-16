# Want to be able to annotate which box is target speaker.
import argparse
import colorsys
import json
import os
import pathlib
import subprocess
from typing import Callable, cast

import cv2
import numpy as np
import torch
from moviepy.video.io.ImageSequenceClip import ImageSequenceClip
from moviepy.video.io.VideoFileClip import VideoFileClip
from projectaria_tools.core import data_provider
from projectaria_tools.core.calibration import CameraCalibration, DeviceCalibration
from projectaria_tools.core.sensor_data import TimeDomain
from projectaria_tools.core.sophus import SE3, SO3
from projectaria_tools.core.stream_id import StreamId

from create_poses import create_poses
from ego_blur_undistorted_video import get_device, visualize_video
from util_aria import UndistortVrsVideoTransform, VrsVideoClip

AnyInt = int | np.int_
DistFunc = Callable[[np.ndarray, np.ndarray], np.floating]


def box_pipeline(path: pathlib.Path, reprocess: bool = False):
    for ancestor in path.parents:
        if ancestor.name == "vrs":
            if ancestor.parent.name == "data":
                data_dir = ancestor.parent
                parent_dir = path.parent.relative_to(ancestor)
                break
    # an else for a for loop is executed if break is never reached
    else:
        raise ValueError(
            "Input file must be a descendant of data/audio, data/video, or data/views"
        )

    os.makedirs(data_dir / "video" / parent_dir, exist_ok=True)

    blurred_video_path = data_dir / "video" / parent_dir / f"{path.stem}.mp4"
    output_video_path = data_dir / "video" / parent_dir / f"{path.stem}_blurred.mp4"
    if reprocess or not output_video_path.exists():
        # Step 1: Undistort unblurred vrs
        print("Undistorting video...")
        fps = 10

        vrs_path = data_dir / "vrs" / parent_dir / f"{path.stem}.vrs"

        stream_id = StreamId("1201-1")
        with VrsVideoClip(vrs_path, stream_id, audio=True) as clip:
            undistort_transform = UndistortVrsVideoTransform.from_clip(clip)
            clip.fl(undistort_transform)
            clip.write_videofile(str(data_dir / "undistorted.mp4"), fps=fps)
            clip.close()

        cap = cv2.VideoCapture(str(data_dir / "undistorted.mp4"))
        if not cap.isOpened():
            print("Error: Could not open video file")
            return
        else:
            fps = cap.get(cv2.CAP_PROP_FPS)
            print("FPS:", fps)

        command = (
            f"ffmpeg -y -i {str(data_dir / 'undistorted.mp4')} -vf \"transpose=1\" -c:a"
            f" copy {str(data_dir / 'rotated.mp4')}"
        )
        subprocess.run(command, shell=True)

        cap.release()

        # Step 2: Run Ego Blur on undistorted unblurred video and store what bounding
        # boxes are on each frame
        print("Running Ego Blur...")

        face_model_path = pathlib.Path("scripts", "models", "ego_blur_face.jit")
        input_video_path = str(data_dir / "rotated.mp4")
        output_video_fps = fps

        face_detector = None
        face_detector = torch.jit.load(face_model_path, map_location="cpu").to(
            get_device()
        )
        face_detector.eval()

        # visualize_video wil create the output video with
        # the bounding boxes drawn on it, and
        # a csv with the boxes for faces called faces.csv
        visualize_video(
            input_video_path=input_video_path,
            face_detector=face_detector,
            lp_detector=None,
            face_model_score_threshold=0.9,
            lp_model_score_threshold=None,
            nms_iou_threshold=0.3,
            output_video_path=str(blurred_video_path),
            scale_factor_detections=1,
            output_video_fps=output_video_fps,
        )

        # Remove the unblurred videos now that the blurred videos are made
        os.remove(data_dir / "undistorted.mp4")
        os.remove(data_dir / "rotated.mp4")

        # Step 3: Group the face boxes, and draw them on the video.
        # Also output the files in data/faceBoxes etc.
        print("Grouping face boxes...")

        # Create the poses for the video
        # TODO: find out why create_poses doesn't work on my end...
        create_poses(vrs_path, reprocess, headers=True, positions=True)

        orientation_path = (
            data_dir / "graphical" / parent_dir / f"{path.stem}" / "pose.csv"
        )
        faces_path = "faces.csv"

        orientations = np.loadtxt(orientation_path, delimiter=",", skiprows=1)
        # The output of create_poses.py is almost normalized, but slightly off
        # (likely due to floating point errors). We normalize it here.
        orientations[:, 1:] /= np.linalg.norm(
            orientations[:, 1:], axis=1, keepdims=True
        )

        rects = np.loadtxt(faces_path, delimiter=",", skiprows=1, dtype=np.int64)

        dp: data_provider.VrsDataProvider = data_provider.create_vrs_data_provider(
            str(vrs_path)
        )
        # type: ignore
        device_calib = cast(DeviceCalibration, dp.get_device_calibration())
        csl_calib = cast(
            CameraCalibration, device_calib.get_camera_calib("camera-slam-left")
        )
        t_cpf_csl = cast(SE3, device_calib.get_transform_cpf_sensor("camera-slam-left"))

        # shape of the images before they were rotated
        unrot_img_shape = csl_calib.get_image_size()

        csl_config = dp.get_image_configuration(StreamId("1201-1"))
        img_rate = csl_config.nominal_rate_hz
        img_time_diff = 1 / img_rate

        # The frames' times relative to the beginning of the VRS recording
        rect_times = np.asarray([get_frame_time(dp, i) for i in rects[:, 0]])

        # Note to Blake: I can't remember why it was possible for some times to be
        # negative but I definitely put this here for a reason. I think it might've
        # been because the last frames in rects weren't in the VRS for some reason
        # and so it returned -1 for those
        if rect_times[0] < 0:
            # Fall back to using the first frame's time (relative to the beginning
            # of the video) as the time of the first rectangle
            rect_times[0] = rects[0, 0] * img_time_diff
        for j in np.where(rect_times < 0):
            # rect_times[j - 1] will be positive since np.where returns indices
            # in order and rect_times[0] must be positive from above
            rect_times[j] = rect_times[j - 1] + img_time_diff

        # The quaternion orientations nearest whose times are closest to the
        # rectangles' times
        rect_quats = orientations[find_nearest(orientations[:, 0], rect_times), 1:]
        # SO3 is *basically* projectaria_tools' special quaternion class
        # type: ignore
        rect_so3 = cast(SO3, SO3.from_quat(rect_quats[:, 0], rect_quats[:, 1:]))
        # cpf_rects stores the frame number and rectangle coordinates (now in 3D)
        cpf_rects = np.empty((rects.shape[0], 7), dtype=np.float64)
        # type: ignore
        for j, (rect, quat) in enumerate(zip(rects.astype(np.float64), rect_so3)):
            # Rotate the points since the rectangles are on the rotated images (which
            # rotated 90 degrees clockwise) so we rotate the points 90 degrees
            # counterclockwise)
            p1 = rot_point_90cw(*rect[1:3], *unrot_img_shape, k=-1)
            p2 = rot_point_90cw(*rect[3:], *unrot_img_shape, k=-1)

            cpf_rects[j, 0] = rect[0]  # frame number
            # Transforming them to 3D and then the central pupil frame is necessary to
            # Multiply by the quaternion to rotate the points to orientation of
            # the device (at least I think that's how the math works). It returns a
            # column vector so we transpose it to get a row vector
            cpf_rects[j, 1:4] = (quat @ transform(p1, t_cpf_csl, csl_calib)).T
            cpf_rects[j, 4:] = (quat @ transform(p2, t_cpf_csl, csl_calib)).T

        groups: list[list[tuple[int, np.ndarray]]] = []
        with open("grouping_log.txt", "w") as file:
            for j, rect in enumerate(cpf_rects):
                # Play around with the frame_tol and dist_tol values, 10 and 1 were
                # just what I tried last
                group_rect(
                    j, rect, groups, frame_tol=10, dist_tol=1, var_dist=False, file=file
                )

        # Use the indices of the rectangles to create the final list of grouped
        # rectangles. We group based on the unprojected rects (the rects in 3D space)
        # so use the indices from each group to get the corresponding 2D rects grouped
        continuous_rects = [[rects[i] for i, _ in group] for group in groups]

        group_colors = generate_colors(len(continuous_rects))

        if output_video_path.exists():
            os.remove(output_video_path)

        draw_rects_to_video(
            str(blurred_video_path),
            continuous_rects,
            str(output_video_path),
            group_colors,
        )

        colors_path = (
            data_dir / "faceBoxes" / parent_dir / f"{path.stem}_egoblur_colors.json"
        )
        if not os.path.exists(data_dir / "faceBoxes" / parent_dir):
            os.makedirs(data_dir / "faceBoxes" / parent_dir)
        if colors_path.exists():
            os.remove(colors_path)
        with open(colors_path, "w") as f:
            json.dump(group_colors, f)

        # Convert ndarray to list
        continuous_rects_list = [
            [arr.tolist() if isinstance(arr, np.ndarray) else arr for arr in sublist]
            for sublist in continuous_rects
        ]

        continuous_rects_path = (
            data_dir / "faceBoxes" / parent_dir / f"{path.stem}_egoblur_rects.json"
        )
        with open(continuous_rects_path, "w") as f:
            json.dump(continuous_rects_list, f)

        fps_path = data_dir / "faceBoxes" / parent_dir / f"{path.stem}_egoblur_fps.txt"
        # Write the fps to fps.txt
        with open(fps_path, "w") as f:
            f.write(str(output_video_fps))

        # Step 4: Remove all the files we made
        if os.path.exists("faces.csv"):
            os.remove("faces.csv")
        if os.path.exists("grouping_log.txt"):
            os.remove("grouping_log.txt")
        if os.path.exists(blurred_video_path):
            os.remove(blurred_video_path)
        return


def rect_center(rect: np.ndarray) -> np.ndarray:
    """Returns the center of a rectangle.

    Parameters
    ----------
    rect : np.ndarray
        A 1xN array where N is twice the number of dimensions of the rectangle. The
        first N/2 elements are the top-left corner of the rectangle, and the last N/2
        elements are the bottom-right corner. For example, for a 2D rectangle, the
        array would be [x1, y1, x2, y2].
    """
    split = len(rect) // 2
    return (rect[:split] + rect[split:]) / 2


def rect_center_dist(rect1: np.ndarray, rect2: np.ndarray) -> np.floating:
    """Returns the distance between the centers of two rectangles.

    Parameters
    ----------
    rect1, rect2 : np.ndarray
        The rectangles to get the distance between. Each rectangle is represented by a
        1xN array of the top-left and bottom-right corners, where N is twice the number
        of dimensions (see `rect_center`).
    """
    split = len(rect1) // 2
    center1 = (rect1[:split] + rect1[split:]) / 2
    center2 = (rect2[:split] + rect2[split:]) / 2
    return np.linalg.norm(center1 - center2)


def are_rects_close(
    rect1: np.ndarray, rect2: np.ndarray, tol: float = 10
) -> bool | np.bool_:
    """Checks whether two rectangles' centers are within a certain distance of each
    other.

    Parameters
    ----------
    rect1, rect2 : np.ndarray
        The rectangles to compare. Each rectangle is represented by a 1xN array of
        the top-left and bottom-right corners, where N is twice the number of
        dimensions (see `rect_center`).
    """
    return rect_center_dist(rect1, rect2) < tol


def pt_dist(pt1: np.ndarray, pt2: np.ndarray) -> np.floating:
    """Returns the distance between two points."""
    return np.linalg.norm(pt1 - pt2)


def generate_colors(n: int) -> list:
    """Generates `n` distinct colors in HSV space."""
    colors = np.asarray([colorsys.hsv_to_rgb(i / n, 1, 1) for i in range(n)])
    np.random.default_rng(0).shuffle(colors)
    return (colors * 255).astype(np.uint8).tolist()


def recolor_frame(frame: np.ndarray) -> np.ndarray:
    """Converts an RGB or GRAY frame to BGR."""
    if len(frame.shape) == 2:
        frame = cv2.cvtColor(frame, cv2.COLOR_GRAY2RGB)
    else:
        frame = frame.copy()
    return cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)


def draw_rects_to_video(
    video_path: str,
    rect_groups: list[list[np.ndarray]],
    output_path: str,
    colors: list[list[int]] | None = None,
    font: int = cv2.FONT_HERSHEY_SIMPLEX,
):
    """Draws rectangles to a video and saves the result.

    Parameters
    ----------
    video_path : str
        The path to the video file.
    rect_groups : list[list[np.ndarray]]
        The rectangles to draw. Each list in rect_groups contains the rectangles for
        that group. Groups are drawn in different colors and with different labels. A
        rectangle is represented by a 1x5 array, with the first element being the frame
        number and the remaining four elements being the top-left and bottom-right
        corners (i.e., [frame, x1, y1, x2, y2]).
    output_path : str
        The path to save the output video.
    colors : list[list[int]] | None, optional
        The colors to use for each group. If None, colors are generated automatically.
    font : int, optional
        A cv2 font constant to use for the labels.
    """

    with VideoFileClip(video_path) as video:
        if colors is None:
            colors = generate_colors(len(rect_groups))
        labels = [str(i) for i in range(len(rect_groups))]

        frames_iter = video.iter_frames()
        frames = []
        for group, color, label in zip(rect_groups, colors, labels):
            for rect_num, (frame_num, *rect) in enumerate(group):
                if len(frames) <= frame_num:
                    while len(frames) <= frame_num:
                        frames.append(next(frames_iter))
                frame = recolor_frame(frames[frame_num])

                text = f"{label}, {rect_num}"
                org = (rect[0], rect[1] - 10)
                cv2.putText(frame, text, org, font, 0.5, color, 2)
                cv2.rectangle(frame, tuple(rect[:2]), tuple(rect[2:]), color, 2)

                frames[frame_num] = frame

        frames.extend(frames_iter)  # add the remaining frames

        with ImageSequenceClip(frames, fps=video.fps) as clip:
            clip = clip.set_audio(
                video.audio
            )  # Set the audio of the clip to the audio of the original video
            clip.write_videofile(output_path, fps=video.fps)
            clip.close()
        video.close()
        return


def rot_point_90cw(
    x: AnyInt, y: AnyInt, M: AnyInt, N: AnyInt, k: int = 1
) -> tuple[AnyInt, AnyInt]:
    """Transforms an index to its corresponding index after a rotation.

    Parameters
    ----------
    x, y : int
        The original 2D index.
    M, N : int
        The array's shape before rotation.
    k : int, default=1
        The number of 90-degree clockwise rotations to apply. Negative values rotate
        counterclockwise.
    """
    k %= 4
    if k == 0:
        return (x, y)
    elif k == 1:
        return (N - 1 - y, x)
    elif k == 2:
        return (M - 1 - x, N - 1 - y)
    else:
        return (y, M - 1 - x)


def get_first_time_all(dp: data_provider.VrsDataProvider) -> float:
    """Gets the minimum first time of all streams."""
    return (
        min(
            first_time
            for s_id in dp.get_all_streams()
            if str(s_id) != "231-1"  # I can't remember why this stream is excluded
            and (first_time := dp.get_first_time_ns(s_id, TimeDomain.DEVICE_TIME)) >= 0
        )
        / 1e9
    )


def get_frame_time(
    dp: data_provider.VrsDataProvider, frame: int, from_beginning: bool = True
) -> float:
    """Gets the time of a frame in the VRS' IMU left camera stream.

    Parameters
    ----------
    dp : data_provider.VrsDataProvider
        The data provider to use.
    frame : int
    from_beginning : bool, default=True
        If True, the time is relative to the beginning of the recording. If False, the
        time is the absolute time of the frame.
    """
    _, img_metadata = dp.get_image_data_by_index(StreamId("1201-1"), frame)
    img_time_s = img_metadata.capture_timestamp_ns / 1e9
    return (img_time_s - get_first_time_all(dp)) if from_beginning else img_time_s


# https://stackoverflow.com/a/26026189
def find_nearest(array: np.ndarray, values: np.ndarray):
    """Finds the index of the nearest value in `array` for each value in `values`.

    `array` must be sorted in ascending order.
    """
    idx = np.searchsorted(array, values, side="left")
    # Set 0 to 1 and len(array) to len(array) - 1 in idx to prevent
    # out of bounds access on the line after
    idx = idx + (idx == 0) - (idx == len(array))
    idx = idx - (np.abs(values - array[idx - 1]) < np.abs(values - array[idx]))
    return idx


def transform(p, t_cpf_csl, csl_calib):
    # unproject turns a point (the pixel coordinates) into a 3D point vector in the
    # camera frame. We transform this point into the central pupil frame using the
    # t_cpf_csl transform. I no_checks version of unproject because for some reason,
    # the unproject was throwing an error about some points being outside the image
    # bounds (even though I'm fairly certain they weren't). Problem with this is tho
    # that it's probably valid for throwing because the unprojection of the points it
    # would throw on are WAY farther away from the others, which is part of the issue
    # with this method of detecting continuity of the rectangles.

    # TODO: Originally, I thought transforming to the CPF was necessary since the
    # orientations are in the CPF and we need to rotate the points to that orientation,
    # but now I'm not so sure. The rectangle staying in the camera frame might make
    # more sense
    return t_cpf_csl @ csl_calib.unproject_no_checks(p)


# TODO: In _group, we should find the best group to add an array to, not the first group
# that it's close to. (So like calculate the distance to all groups that are within the
# frame tolerance and add it to the one with the smallest distance. A case for when
# the array is on the same frame as the last array in the group should also be added
# like in the current implementation.)
def log(file, *msgs: str):
    if file is not None:
        file.write(", ".join(msgs) + "\n")


def _group(
    arr_num: int,
    arr: np.ndarray,
    groups: list[list[tuple[int, np.ndarray]]],
    frame_tol: int = 3,
    dist_tol: float = 10,
    dist_func: DistFunc | None = None,
    *,
    var_dist: bool = True,  # whether to allow more distance if frames closer in time
    file=None,
):
    """Groups arrays based on their distance and time difference.

    This function only does one iteration of grouping. It is meant to be called in a
    loop over all arrays.

    Parameters
    ----------
    arr_num : int
        The index of the array in the original array list.
    arr : np.ndarray
        The array to group.
    groups : list[list[tuple[int, np.ndarray]]]
        The list of groups to add the array to. Each group is a list of tuples. The
        first element of the tuple is the array's index in the original array list, and
        the second element is the array itself. (So each element is `(arr_num, arr)`.)
    frame_tol : int, default=3
        The maximum number of frames that can separate two arrays for them to be
        considered in the same group.
    dist_tol : float, default=10
        The maximum distance between two arrays for them to be considered in the same
        group. The distance is calculated using `dist_func`.
    dist_func : Callable[[np.ndarray, np.ndarray], np.floating]
        The function to use to calculate the distance between two arrays. If None, an
        error is raised.
    var_dist : bool, default=True
        If True, the distance tolerance is divided by the frame difference between the
        two arrays. This allows for more distance between arrays that are closer in
        time.
        !!! NOTE: I don't know if this helps or hurts the grouping. It was just an
        idea I tried.
    file : file-like object, optional
        A file to write debug messages to. If None, no messages are written.
    """

    if dist_func is None:
        raise ValueError("dist_func must be provided")

    for i, group in enumerate(groups):
        frame_diff = int(arr[0] - group[-1][1][0])
        base_msg = f"{arr_num}, {i}, f diff = {frame_diff}"  # for logging

        if frame_diff > frame_tol:  # if the array is too far in time
            log(file, base_msg, "skipping")
            continue

        # If the array is on the same frame as the last array in the group, compare it
        # to that array and possibly add it to the group (and regroup the other array)
        if frame_diff == 0:
            if len(group) < 2:
                log(file, base_msg, f"len(group {i}) < 2")
                continue

            # group[-2][1][1:] is the actual last arr in the group, since we're
            # comparing the current arr to the one on the same frame (group[-1][1])
            # Sorry this naming is confusing
            last_arr = group[-2][1][1:]
            current_arr_dist = dist_func(last_arr, arr[1:])
            other_arr_dist = dist_func(last_arr, group[-1][1][1:])

            if current_arr_dist < other_arr_dist:
                log(file, base_msg, f"closer than {i}[{len(group) - 1}]")
                other_arr = group.pop()
                group.append((arr_num, arr))
                # Find the next best group to add the other arr to
                _group(
                    *other_arr,
                    groups,
                    frame_tol,
                    dist_tol,
                    dist_func,
                    var_dist=var_dist,
                    file=file,
                )
                break
            else:
                log(file, base_msg, f"not closer than {i}[{len(group) - 1}]")
                continue

        d_tol = (dist_tol / frame_diff) if var_dist else dist_tol
        compar_to = f"{i}[{len(group) - 1}]"  # for logging
        dist = dist_func(group[-1][1][1:], arr[1:])
        if dist < d_tol:
            log(file, base_msg, f"close to {compar_to}, adding to group {i}")
            group.append((arr_num, arr))
            break
        else:
            log(file, base_msg, f"not close to {compar_to} ({dist} > {d_tol})")
    # This runs if the loop doesn't break (i.e., the array wasn't added to any group)
    else:
        log(file, f"{arr_num}, new group ({len(groups)})")
        groups.append([(arr_num, arr)])


def group_rect(*args, **kwargs):
    """Groups rectangles. See `_group`."""
    _group(*args, **kwargs, dist_func=rect_center_dist)


def group_pts(*args, **kwargs):
    """Groups points. See `_group`."""
    _group(*args, **kwargs, dist_func=pt_dist)


def route_dir(dir: pathlib.Path, scan_dir: bool = True, **kwargs) -> None:
    for path in dir.iterdir():
        route_file(path, scan_dir=scan_dir, **kwargs)


def route_file(*paths: pathlib.Path, scan_dir: bool = True, **kwargs) -> None:
    if len(paths) == 0:
        # if no file or directory given, use directory script was called from
        paths = (pathlib.Path.cwd(),)
    # if multiple files (or directories) given, run function on each one
    elif len(paths) > 1:
        for path in paths:
            route_file(path, scan_dir=scan_dir, **kwargs)
        # stop function because all of the processing is
        # done in the function calls in the for loop
        return

    path = paths[0].absolute()  # paths[0] is--at this point--the only argument in paths

    print(path.suffix.casefold())

    # if file.path is an audio or video file, process it
    if path.suffix.casefold() in {".vrs"}:
        box_pipeline(path, **kwargs)
        print("after box_pipeline")
    # blur on every file in file.path if it is a dir and scan_dir is True
    elif path.is_dir() and scan_dir:
        # the data dir was passed so run on data/audio and data/video
        if path.name == "data":
            route_dir(path / "audio", scan_dir=scan_dir, **kwargs)
            route_dir(path / "video", scan_dir=scan_dir, **kwargs)
            route_dir(path / "views", scan_dir=scan_dir, **kwargs)
        else:
            route_dir(path, scan_dir=False, **kwargs)
    return


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Process audio files.")
    parser.add_argument(
        "-r",
        "--reprocess",
        action="store_true",
        help="Reprocess audio files detected to have already been processed",
    )
    parser.add_argument(
        "path",
        nargs="*",
        type=pathlib.Path,
        help=(
            "The path to the vrs file to process. If an audio file, processes the audio"
            " file. If a directory, processes every audio file in the directory."
        ),
    )
    args = vars(parser.parse_args())
    route_file(*args.pop("path"), **args)
    print("after route_file")
    exit(0)
