# Want to be able to annotate which box is target speaker.
import argparse
import colorsys
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, cast

import cv2
import numpy as np
import torch
from moviepy.video.io.ImageSequenceClip import ImageSequenceClip
from moviepy.video.io.VideoFileClip import VideoFileClip
from projectaria_tools.core import calibration, data_provider
from projectaria_tools.core.calibration import CameraCalibration, DeviceCalibration
from projectaria_tools.core.data_provider import VrsDataProvider
from projectaria_tools.core.sensor_data import TimeDomain
from projectaria_tools.core.sophus import SE3, SO3
from projectaria_tools.core.stream_id import StreamId
from typing_extensions import Self

import log
from _types import AnyBool, AnyFloat, AnyInt, NpFloat, StrPath
from constants import DATA_DIR, FACE_BOXES_DIR, GRAPHICAL_DIR, VIDEO_DIR, VRS_DIR
from create_poses import create_poses
from ego_blur_undistorted_video import get_device, visualize_video
from log import logger
from util_aria import UndistortVrsVideoTransform, VrsVideoClip

Rect = np.ndarray
Rect2D = np.ndarray[tuple[Literal[4]], np.dtype[NpFloat]]
Rect3D = np.ndarray[tuple[Literal[6]], np.dtype[NpFloat]]
Point = np.ndarray
Point2D = np.ndarray[tuple[Literal[2]], np.dtype[NpFloat]]
Point3D = np.ndarray[tuple[Literal[3]], np.dtype[NpFloat]]


@dataclass(slots=True)
class Face:
    index: int
    """The face's overall index in the video."""

    frame: AnyInt
    """The video frame number where the face was detected."""

    rect2d: Rect2D
    """The face's bounding box in the video frame."""

    center2d: Point2D = field(init=False)
    """The center of this face's rect2d."""

    center3d: Point3D | None
    """The unprojection of this face's center2d to 3D space."""

    def __post_init__(self):
        self.center2d = rect_center(self.rect2d)

        if self.center3d is not None and np.isnan(self.center3d).any():
            self.center3d = None

    def dist2d(self, other: Self) -> AnyFloat:
        return np.linalg.norm(self.center2d - other.center2d)

    def dist3d(self, other: Self) -> AnyFloat:
        if self.center3d is None or other.center3d is None:
            raise ValueError("One or both faces do not have 3D centers.")
        return np.linalg.norm(self.center3d - other.center3d)

    def is_close2d(self, other: Self, dtol: AnyFloat, ftol: AnyFloat) -> AnyBool:
        """Check if two faces are close in 2D space and frames.

        Parameters
        ----------
        other : Face
            The other face to compare with.
        dtol : AnyFloat
            The maximum distance between the centers of the two faces.
        ftol : AnyFloat
            The maximum difference in frames between the two faces.
        """
        return abs(self.frame - other.frame) <= ftol and self.dist2d(other) <= dtol

    def is_close3d(self, other: Self, dtol: AnyFloat, ftol: AnyFloat) -> AnyBool:
        """Check if two faces are close in 3D space and frames.

        Parameters
        ----------
        other : Face
            The other face to compare with.
        dtol : AnyFloat
            The maximum distance between the centers of the two faces.
        ftol : AnyFloat
            The maximum difference in frames between the two faces.
        """
        return abs(self.frame - other.frame) <= ftol and self.dist3d(other) <= dtol


Group = list[Face]


def box_pipeline(path: Path, reprocess: bool = False):
    try:
        parent_dir = path.parent.relative_to(VRS_DIR)
    except ValueError:
        raise ValueError("Input file must be in a directory in data/vrs")

    (VIDEO_DIR / parent_dir).mkdir(parents=True, exist_ok=True)
    blurred_video_path = VIDEO_DIR / parent_dir / f"{path.stem}.mp4"
    output_video_path = VIDEO_DIR / parent_dir / f"{path.stem}_blurred.mp4"
    if not reprocess and output_video_path.exists():
        logger.info("{} already processed. Skipping.", path)
        return

    # Step 1: Undistort unblurred vrs
    logger.info("Undistorting video...")

    vrs_path = VRS_DIR / parent_dir / f"{path.stem}.vrs"

    stream_id = StreamId("1201-1")
    with VrsVideoClip(vrs_path, stream_id, audio=True) as clip:
        fps = clip.fps
        undistort_transform = UndistortVrsVideoTransform.from_clip(clip)
        with clip.fl(undistort_transform) as undistorted_clip:
            undistorted_clip.write_videofile(str(DATA_DIR / "undistorted.mp4"))

    # Step 2: Run Ego Blur on undistorted unblurred video and store what bounding
    # boxes are on each frame
    logger.info("Running Ego Blur...")

    face_model_path = Path("scripts", "models", "ego_blur_face.jit")
    input_video_path = DATA_DIR / "undistorted.mp4"
    output_video_fps = fps

    face_detector = None
    face_detector = torch.jit.load(face_model_path, map_location="cpu").to(get_device())
    face_detector.eval()

    # visualize_video wil create the output video with
    # the bounding boxes drawn on it, and
    # a csv with the boxes for faces called faces.csv
    visualize_video(
        input_video_path=str(input_video_path),
        face_detector=face_detector,
        lp_detector=None,
        face_model_score_threshold=0.9,
        lp_model_score_threshold=None,
        nms_iou_threshold=0.3,
        output_video_path=str(blurred_video_path),
        scale_factor_detections=1,
        output_video_fps=output_video_fps,  # type: ignore
    )

    # Remove the unblurred video now that the blurred videos are made
    try:
        input_video_path.unlink()
    except FileNotFoundError as e:
        logger.warning("Could not remove undistorted video:")
        logger.exception(e)

    # Step 3: Group the face boxes, and draw them on the video.
    # Also output the files in data/faceBoxes etc.
    logger.info("Grouping face boxes...")

    # Create the poses for the video
    # TODO: find out why create_poses doesn't work on my end...
    create_poses(vrs_path, reprocess, headers=True, positions=False)

    orientation_path = GRAPHICAL_DIR / parent_dir / f"{path.stem}" / "pose.csv"
    faces_path = Path("faces.csv")

    orientations = np.loadtxt(orientation_path, delimiter=",", skiprows=1)
    orientation_times = orientations[:, 0]
    orientations = orientations[:, 1:]
    # The output of create_poses.py is almost normalized, but slightly off
    # (likely due to floating point errors). We normalize it here.
    orientations /= np.linalg.norm(orientations, axis=1, keepdims=True)

    rects_with_frames = np.loadtxt(
        faces_path, delimiter=",", skiprows=1, dtype=np.int64
    )
    if rects_with_frames.size == 0:
        logger.warning("No faces detected in the video {}", path)
        faces_path.unlink(missing_ok=True)
        # Move the blurred video to the output video path so that the file won't be
        # reprocessed if the script is run again (unless -r is passed)
        blurred_video_path.rename(output_video_path)
        return

    rect_frames, rects = rects_with_frames[:, 0], rects_with_frames[:, 1:]

    dp: VrsDataProvider = data_provider.create_vrs_data_provider(str(vrs_path))
    device_calib = cast(DeviceCalibration, dp.get_device_calibration())

    # Ego blur is run on the undistorted, rotated video, so we need to get the
    # calibration for that video. This way, the unprojected 3D points will be in
    # the correct space, and the transformation to the central pupil frame will be
    # correct.
    linear_camera_calib = undistort_transform._linear
    linear_cw90_camera_calib = calibration.rotate_camera_calib_cw90deg(
        linear_camera_calib
    )

    t_device_camera = cast(SE3, linear_cw90_camera_calib.get_transform_device_camera())
    t_device_cpf = cast(SE3, device_calib.get_transform_device_cpf())
    t_cpf_device = t_device_cpf.inverse()
    # t_a_b @ t_b_c = t_a_c
    t_cpf_camera = t_cpf_device @ t_device_camera

    camera_id = StreamId("1201-1")
    camera_config = dp.get_image_configuration(camera_id)
    img_rate = camera_config.nominal_rate_hz
    img_time_diff = 1 / img_rate

    first_time = get_first_time_all(dp)
    # The frames' times relative to the beginning of the VRS recording
    rect_times = np.asarray([get_frame_time(dp, i, first_time) for i in rect_frames])

    # Note to Blake: I can't remember why it was possible for some times to be
    # negative but I definitely put this here for a reason. I think it might've
    # been because the last frames in rects weren't in the VRS for some reason
    # and so it returned -1 for those
    if rect_times[0] < 0:
        # Fall back to using the first frame's time (relative to the beginning
        # of the video) as the time of the first rectangle
        rect_times[0] = rect_frames[0] * img_time_diff
    for j in np.where(rect_times < 0):
        # rect_times[j - 1] will be positive since np.where returns indices
        # in order and rect_times[0] must be positive from above
        rect_times[j] = rect_times[j - 1] + img_time_diff

    # The quaternion orientations nearest whose times are closest to the rectangles'
    # times. Column 0 is the scalar part of the quaternion (w)
    rect_quats = orientations[find_nearest(orientation_times, rect_times)]
    # SO3 is *basically* projectaria_tools' special quaternion class
    # from_quat takes the scalar part of the quaternion as the first argument and
    # the vector part as the second argument
    rect_so3 = cast(SO3, SO3.from_quat(rect_quats[:, 0], rect_quats[:, 1:]))  # type: ignore # noqa: E501

    rect_centers3d = np.full((rects.shape[0], 3), np.nan, dtype=np.float64)
    for j, (rect, quat) in enumerate(zip(rects.astype(np.float64), rect_so3)):  # type: ignore # noqa: E501
        # Note: ego blur is run on the undistorted, rotated video, so we don't need
        # to rotate the points back to the original image orientation
        center2d = rect_center(rect)

        try:
            rect_centers3d[j] = (
                quat @ transform(center2d, t_cpf_camera, linear_cw90_camera_calib)
            ).T
        except ValueError:
            # If the center is outside the image bounds, we just leave it as NaN
            pass

    faces = [
        Face(*t) for t in zip(range(len(rects)), rect_frames, rects, rect_centers3d)
    ]
    groups: list[Group] = []
    for face in faces:
        group_face(face, groups, 30, 7, 0.75, 7, var_dist=False)

    continuous_rects = [
        [rects_with_frames[face.index] for face in group] for group in groups
    ]

    group_colors = generate_colors(len(groups))

    draw_rects_to_video(
        blurred_video_path,
        groups,
        output_video_path,
        group_colors,
    )

    colors_path = FACE_BOXES_DIR / parent_dir / f"{path.stem}_egoblur_colors.json"
    colors_path.parent.mkdir(parents=True, exist_ok=True)
    with colors_path.open("w") as f:
        json.dump(group_colors, f)

    # Convert ndarray to list
    continuous_rects_list = [
        [arr.tolist() if isinstance(arr, np.ndarray) else arr for arr in sublist]
        for sublist in continuous_rects
    ]

    continuous_rects_path = (
        FACE_BOXES_DIR / parent_dir / f"{path.stem}_egoblur_rects.json"
    )
    with continuous_rects_path.open("w") as f:
        json.dump(continuous_rects_list, f)

    fps_path = FACE_BOXES_DIR / parent_dir / f"{path.stem}_egoblur_fps.txt"
    # Write the fps to fps.txt
    fps_path.write_text(str(output_video_fps))

    # Step 4: Remove all the files we made
    faces_path.unlink(missing_ok=True)
    blurred_video_path.unlink(missing_ok=True)


def rect_center(rect: Rect) -> Point:
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
    video_path: StrPath,
    rect_groups: list[Group],
    output_path: StrPath,
    colors: list[list[int]] | None = None,
    font: int = cv2.FONT_HERSHEY_SIMPLEX,
):
    """Draws rectangles to a video and saves the result.

    Parameters
    ----------
    video_path : str | Path
        The path to the video file.
    rect_groups : list[Group]
        The rectangles to draw. Each list in rect_groups contains the rectangles for
        that group. Groups are drawn in different colors and with different labels. A
        rectangle is represented by a 1x5 array, with the first element being the frame
        number and the remaining four elements being the top-left and bottom-right
        corners (i.e., [frame, x1, y1, x2, y2]).
    output_path : str | Path
        The path to save the output video.
    colors : list[list[int]] | None, optional
        The colors to use for each group. If None, colors are generated automatically.
    font : int, optional
        A cv2 font constant to use for the labels.
    """

    with VideoFileClip(str(video_path)) as video:
        if colors is None:
            colors = generate_colors(len(rect_groups))
        labels = [str(i) for i in range(len(rect_groups))]

        frames_iter = video.iter_frames()
        frames = []
        for group, color, label in zip(rect_groups, colors, labels):
            for rect_num, face in enumerate(group):
                while len(frames) <= face.frame:
                    frames.append(recolor_frame(next(frames_iter)))
                frame = frames[face.frame]

                text = f"{label}, {rect_num}"
                org = (face.rect2d[0], face.rect2d[1] - 10)
                cv2.putText(frame, text, org, font, 0.5, color, 2)
                cv2.rectangle(
                    frame, tuple(face.rect2d[:2]), tuple(face.rect2d[2:]), color, 2
                )

                frames[face.frame] = frame

        frames.extend(frames_iter)  # add the remaining frames

        with ImageSequenceClip(frames, fps=video.fps) as clip:
            # Set the audio of the clip to the audio of the original video
            clip = clip.set_audio(video.audio)
            clip.write_videofile(str(output_path), fps=video.fps)


def get_first_time_all(dp: VrsDataProvider) -> float:
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
    dp: VrsDataProvider,
    frame: int,
    first_time: float | None = None,
    from_beginning: bool = True,
) -> float:
    """Gets the time of a frame in the VRS' IMU left camera stream.

    Parameters
    ----------
    dp : VrsDataProvider
        The data provider to use.
    frame : int
    from_beginning : bool, default=True
        If True, the time is relative to the beginning of the recording. If False, the
        time is the absolute time of the frame.
    """
    if first_time is None:
        first_time = get_first_time_all(dp)
    _, img_metadata = dp.get_image_data_by_index(StreamId("1201-1"), frame)
    img_time_s = img_metadata.capture_timestamp_ns / 1e9
    return (img_time_s - first_time) if from_beginning else img_time_s


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


def transform(p, t_cpf_camera: SE3, linear_cw90_camera_calib: CameraCalibration):
    # unproject turns a point (the pixel coordinates) into a 3D point vector in the
    # camera frame. We transform this point into the central pupil frame using the
    # t_cpf_camera transform. I no_checks version of unproject because for some reason,
    # the unproject was throwing an error about some points being outside the image
    # bounds (even though I'm fairly certain they weren't). Problem with this is tho
    # that it's probably valid for throwing because the unprojection of the points it
    # would throw on are WAY farther away from the others, which is part of the issue
    # with this method of detecting continuity of the rectangles.

    # TODO: Originally, I thought transforming to the CPF was necessary since the
    # orientations are in the CPF and we need to rotate the points to that orientation,
    # but now I'm not so sure. The rectangle staying in the camera frame might make
    # more sense
    unprojected_camera_point = linear_cw90_camera_calib.unproject(p)
    if unprojected_camera_point is None:
        raise ValueError("Point is outside the image bounds")
    # point_in_a = t_a_c @ point_in_c
    return t_cpf_camera @ unprojected_camera_point


def group_dist(
    face: Face,
    group: Group,
    dtol2d: AnyFloat,
    ftol2d: AnyFloat,
    dtol3d: AnyFloat | None = None,
    ftol3d: AnyFloat | None = None,
) -> AnyFloat | None:
    last_face = group[-1]
    if last_face.frame == face.frame:
        if len(group) < 2:
            return None
        last_face = group[-2]

    if dtol3d is not None and ftol3d is not None:
        try:
            if face.is_close3d(last_face, dtol3d, ftol3d):
                # Divide by dtol3d so that the distance is normalized to the distance
                # tolerance. This allows us to compare 3D distances between faces with
                # 2D distances between faces.
                return face.dist3d(last_face) / dtol3d
        except ValueError:
            pass  # handled by the next block

    if face.is_close2d(last_face, dtol2d, ftol2d):
        return face.dist2d(last_face) / dtol2d

    return None


def group_face(
    face: Face,
    groups: list[Group],
    dtol2d: AnyFloat,
    ftol2d: AnyFloat,
    dtol3d: AnyFloat | None = None,
    ftol3d: AnyFloat | None = None,
    *,
    var_dist: bool = True,  # whether to allow more distance if frames closer in time
):
    """Groups faces based on their distance and frame difference.

    This function only does one iteration of grouping. It is meant to be called in a
    loop over all faces.

    Parameters
    ----------
    face : Face
        The face to group.
    groups : list[Group]
        The list of groups to add the face to. Each group is a list of Faces.
    dtol2d, ftol2d, dtol3d, ftol3d : float | None
        The distance and frame tolerances for grouping. dtol2d and ftol2d must be set
        (since 3D grouping falls back to 2D grouping if the 3D center is None). If
        either/both of the 3D tolerances are not provided, 3D grouping is not done.
    var_dist : bool, default=True
        If True, the distance tolerance is divided by the frame difference between the
        two arrays. This allows for more distance between arrays that are closer in
        time.
        !!! NOTE: I don't know if this helps or hurts the grouping. It was just an
        idea I tried.
    file : file-like object, optional
        A file to write debug messages to. If None, no messages are written.
    """

    tol = (dtol2d, ftol2d, dtol3d, ftol3d)

    dists = [
        (group, dist)
        for group in groups
        if (dist := group_dist(face, group, *tol)) is not None
    ]
    dists.sort(key=lambda x: x[1])

    for group, dist in dists:
        if group[-1].frame != face.frame:
            group.append(face)
            return

        # len(group) is guaranteed >= 2 because of the check in group_dist
        other_face = group[-1]
        other_dist = group_dist(other_face, group, *tol)
        # other_dist can't be None since it was in the group
        if dist < other_dist:  # type: ignore
            other_face = group.pop()
            group.append(face)
            group_face(other_face, groups, *tol, var_dist=var_dist)
            return

    groups.append([face])


def route_dir(dir: Path, scan_dir: bool = True, **kwargs) -> None:
    for path in dir.iterdir():
        route_file(path, scan_dir=scan_dir, **kwargs)


def route_file(*paths: Path, scan_dir: bool = True, **kwargs) -> None:
    if len(paths) == 0:
        # if no file or directory given, use directory script was called from
        paths = (Path.cwd(),)
    # if multiple files (or directories) given, run function on each one
    elif len(paths) > 1:
        for path in paths:
            route_file(path, scan_dir=scan_dir, **kwargs)
        # stop function because all of the processing is
        # done in the function calls in the for loop
        return

    path = paths[0].absolute()  # paths[0] is--at this point--the only argument in paths

    logger.info(path.suffix.casefold())

    # if file.path is an audio or video file, process it
    if path.suffix.casefold() in {".vrs"}:
        box_pipeline(path, **kwargs)
        logger.info("after box_pipeline")
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
        type=Path,
        help=(
            "The path to the vrs file to process. If an audio file, processes the audio"
            " file. If a directory, processes every audio file in the directory."
        ),
    )
    log.add_log_level_argument(parser)

    args = vars(parser.parse_args())
    log.setup_logging(args.pop("log_level"))
    route_file(*args.pop("path"), **args)
    logger.info("after route_file")
    exit(0)
