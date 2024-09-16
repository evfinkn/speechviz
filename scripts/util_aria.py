from __future__ import annotations

import json
import os
import tempfile
from collections.abc import Callable, Iterable, Iterator, Mapping
from dataclasses import dataclass
from typing import NamedTuple

import cv2
import numpy as np
import numpy.typing as npt
from moviepy.audio.io.AudioFileClip import AudioFileClip
from moviepy.video.io.ImageSequenceClip import ImageSequenceClip
from projectaria_tools.core import calibration, data_provider, vrs
from projectaria_tools.core.data_provider import VrsDataProvider
from projectaria_tools.core.sensor_data import SensorData, TimeDomain
from projectaria_tools.core.stream_id import StreamId

from _types import StrPath
from log import logger

_DEVICE_TIME = TimeDomain.DEVICE_TIME
RawProperty = tuple[str, npt.DTypeLike]


class AudioExtractionError(Exception):
    """Exception raised when audio extraction from a VRS file fails."""

    ...


class VrsAudioClip(AudioFileClip):
    """Audio clip created from a VRS file.

    A `moviepy` `AudioClip` whose audio is extracted from a VRS file.

    Examples
    --------
    >>> from util_aria import VrsAudioClip
    >>> with VrsAudioClip("path/to/vrs/file.vrs") as clip:
    ...     clip.write_audiofile("output.wav")
    """

    def __init__(self, vrs_path: StrPath):
        """Create an `AudioClip` from a VRS file.

        Parameters
        ----------
        vrs_path : StrPath
            Path to the VRS file that contains the audio stream.

        Raises
        ------
        AudioExtractionError
            If the audio extraction fails.
        """

        # Code for extracting audio is from
        # https://github.com/facebookresearch/projectaria_tools/blob/35d071c/projectaria_tools/utils/vrs_to_mp4.py#L32
        vrs_fspath = os.fspath(vrs_path)
        self._fspath = vrs_fspath  # This is mostly for parity with the other classes
        self._temp_folder = tempfile.TemporaryDirectory()
        temp_folder_fspath = os.path.join(self._temp_folder.name, "audio.wav")

        json_output_string = vrs.extract_audio_track(vrs_fspath, temp_folder_fspath)
        json_output = json.loads(json_output_string)  # Convert string to Dict
        if not json_output and json_output["status"] != "success":
            raise AudioExtractionError(
                f"Audio extraction failed with status {json_output['status']}"
            )

        audio_fspath = json_output["output"]
        logger.info(f"VRS audio temporarily extracted to {audio_fspath}")
        super().__init__(audio_fspath)

    def close(self):
        super().close()
        self._temp_folder.cleanup()


class VrsVideoClip(ImageSequenceClip):
    """Video clip created from a VRS file.

    A `moviepy` `VideoClip` whose frames are extracted from a VRS file video stream.

    Examples
    --------
    >>> from projectaria_tools.core.stream_id import StreamId
    >>> from util_aria import VrsVideoClip
    >>> with VrsVideoClip("path/to/vrs/file.vrs", StreamId("214-1")) as clip:
    ...     clip.write_videofile("output.mp4")
    """

    def __init__(self, path: StrPath, stream_id: StreamId, *, audio=True):
        """
        Parameters
        ----------
        path : StrPath
            Path to the VRS file that contains the video stream.
        stream_id : StreamId
            The ID of the video stream to extract. Common video stream IDs are

            - `"214-1"` for the RGB camera,
            - `"1201-1"` for the left SLAM camera, and
            - `"1201-2"` for the right SLAM camera.

        audio : bool, default=True
            If True, the audio track will be extracted from the VRS file and added to
            the video clip. If the audio extraction fails, the video clip will be
            created without audio.
        """
        fspath = os.fspath(path)
        dp: VrsDataProvider = data_provider.create_vrs_data_provider(fspath)
        self._fspath = fspath
        self._dp = dp
        self._stream_id = stream_id

        deliver_queue_options = dp.get_default_deliver_queued_options()
        deliver_queue_options.deactivate_stream_all()
        deliver_queue_options.activate_stream(stream_id)
        deliver_queue = dp.deliver_queued_sensor_data(deliver_queue_options)

        fps = int(dp.get_nominal_rate_hz(stream_id))
        frames = list(map(self._frame, deliver_queue))

        super().__init__(frames, fps=fps)

        self.audio = None
        if audio:
            try:
                self.audio = VrsAudioClip(fspath)
            except Exception as e:
                logger.error("Error creating audio for {}", fspath)
                logger.exception(e)

    def _frame(self, sensor_data: SensorData) -> np.ndarray:
        img = sensor_data.image_data_and_record()[0].to_numpy_array()
        if img.ndim == 2:
            # Convert grayscale image to RGB since moviepy requires RGB images
            return cv2.cvtColor(img, cv2.COLOR_GRAY2RGB)
        return img.copy()

    def close(self):
        super().close()
        if self.audio:
            self.audio.close()
            self.audio = None


class UndistortVrsVideoTransform:
    """Callable transform that undistorts a `VrsVideoClip`'s frames.

    This transform is meant to be used with `moviepy`'s `VideoClip`'s `fl` and
    `fl_image` methods.

    Examples
    --------
    >>> from projectaria_tools.core.stream_id import StreamId
    >>> from util_aria import VrsVideoClip, UndistortVrsVideoTransform
    >>> vrs_path = "path/to/vrs/file.vrs"
    >>> stream_id = StreamId("214-1")
    >>> with VrsVideoClip(vrs_path, stream_id) as clip:
    ...     undistort_transform = UndistortVrsVideoTransform.from_clip(clip)
    ...     clip.fl(undistort_transform)
    ...     clip.write_videofile("undistorted.mp4")
    """

    @classmethod
    def from_clip(cls, clip: VrsVideoClip, *, rotate: bool = True):
        """Create an `UndistortVrsVideoTransform` from a `VrsVideoClip`.

        Parameters
        ----------
        clip : VrsVideoClip
            The video clip to undistort.
        rotate : bool, default=True
            If True, the undistorted video will be rotated 90 degrees clockwise.

        Returns
        -------
        UndistortVrsVideoTransform
        """
        return cls(clip._fspath, clip._stream_id, rotate=rotate)

    def __init__(self, path: StrPath, stream_id: StreamId, *, rotate: bool = True):
        """
        Parameters
        ----------
        path : StrPath
            Path to the VRS file that contains the video stream.
        stream_id : StreamId
            The ID of the video stream being transformed. Common video stream IDs are

            - `"214-1"` for the RGB camera,
            - `"1201-1"` for the left SLAM camera, and
            - `"1201-2"` for the right SLAM camera.

        rotate : bool, default=True
            If True, the undistorted video will be rotated 90 degrees clockwise.

        Raises
        ------
        ValueError
            If the stream does not have a label or calibration in the VRS file.
        """
        self._stream_id = stream_id
        self._rotate = rotate

        fspath = os.fspath(path)
        dp: VrsDataProvider = data_provider.create_vrs_data_provider(fspath)
        self._dp = dp

        stream_label = dp.get_label_from_stream_id(stream_id)
        if stream_label is None:
            raise ValueError(f"Stream {stream_id} does not have a label")

        sensor_calib = dp.get_sensor_calibration(stream_id)
        if sensor_calib is None:
            raise ValueError(f"Stream {stream_id} does not have a calibration")
        self._calib = sensor_calib.camera_calibration()

        width, height = self._calib.get_image_size()
        width, height = int(width * 1.25), int(height * 1.25)
        focal_length = self._calib.get_focal_lengths()[0]
        transform = self._calib.get_transform_device_camera()
        self._linear = calibration.get_linear_camera_calibration(
            width, height, focal_length, stream_label, transform
        )

    def __call__(
        self, get_frame: Callable[[float], np.ndarray], t: float
    ) -> np.ndarray:
        frame = get_frame(t)
        undistorted = calibration.distort_by_calibration(
            frame, self._linear, self._calib
        )
        if self._rotate:
            return np.rot90(undistorted, -1)
        return undistorted


class Property(NamedTuple):
    name: str
    dtype: npt.DTypeLike


STREAM_DATA_PROPERTIES = {
    "247-1": ("capture_timestamp_ns", "pressure"),  # barometer
    "281-1": ("capture_timestamp_ns", "latitude", "longitude", "altitude"),  # gps
    "1202-1": ("capture_timestamp_ns", "accel_msec2", "gyro_radsec"),  # imu-right
    "1202-2": ("capture_timestamp_ns", "accel_msec2", "gyro_radsec"),  # imu-left
    "1203-1": ("capture_timestamp_ns", "mag_tesla"),  # magnetometer
}

# dtype for 3D points. float32, float64, etc.
int32_3d = np.dtype((np.int32, (3,)))
int64_3d = np.dtype((np.int64, (3,)))
float32_3d = np.dtype((np.float32, (3,)))
float64_3d = np.dtype((np.float64, (3,)))

TIMESTAMP_PROPERTY = Property("capture_timestamp_ns", np.int64)


@dataclass(order=False, frozen=True, slots=True)
class StreamInfo:
    id: str
    name: str
    properties: tuple[Property, ...]

    @classmethod
    def make(
        cls, id: str, name: str, properties: Iterable[RawProperty], timestamp=True
    ):
        props = [TIMESTAMP_PROPERTY] if timestamp else []
        props.extend(Property(*p) for p in properties)
        return cls(id, name, tuple(props))

    def create_dtype(self) -> np.dtype:
        # remember that each property is just a tuple of (name, dtype)
        return np.dtype(list(self.properties))

    def without(self, *names: str) -> StreamInfo:
        return StreamInfo(
            self.id,
            self.name,
            tuple(p for p in self.properties if p.name not in names),
        )

    def with_only(self, *names: str) -> StreamInfo:
        return StreamInfo(
            self.id,
            self.name,
            tuple(p for p in self.properties if p.name in names),
        )


BAROMETER = StreamInfo.make("247-1", "barometer", (("pressure", np.float32),))
GPS = StreamInfo.make(
    "281-1",
    "gps",
    (("latitude", np.float64), ("longitude", np.float64), ("altitude", np.float32)),
)
IMU_LEFT = StreamInfo.make(
    "1202-1", "imu-left", (("accel_msec2", float32_3d), ("gyro_radsec", float32_3d))
)
IMU_RIGHT = StreamInfo("1202-2", "imu-right", IMU_LEFT.properties)
MAGNETOMETER = StreamInfo.make("1203-1", "magnetometer", (("mag_tesla", float32_3d),))

STREAM_INFO = {
    "247-1": BAROMETER,
    "281-1": GPS,
    "1202-1": IMU_LEFT,
    "1202-2": IMU_RIGHT,
    "1203-1": MAGNETOMETER,
}


def get_stream_names(dp: VrsDataProvider) -> dict[str, str]:
    # get_label_from_stream_id has return type str | None (which is why we have a
    # type ignore here), but we know that it will always return a str because we
    # only pass in ids from get_all_streams which are guaranteed to have labels
    return {  # pyright: ignore[reportReturnType]
        str(s_id): dp.get_label_from_stream_id(s_id) for s_id in dp.get_all_streams()
    }


def get_active_streams(dp: VrsDataProvider) -> list[StreamId]:
    return [
        s_id
        for s_id in dp.get_all_streams()
        if dp.get_first_time_ns(s_id, _DEVICE_TIME) != -1
    ]


def create_stream_dtype(
    dp: VrsDataProvider,
    s_id: StreamId,
    *,
    stream_info: Mapping[str, StreamInfo] = STREAM_INFO,
    without: Iterable[str] | None = None,
    with_only: Iterable[str] | None = None,
) -> np.dtype:
    info = stream_info[str(s_id)]
    if without is not None:
        info = info.without(*without)
    if with_only is not None:
        info = info.with_only(*with_only)
    return info.create_dtype()


def create_stream_array(
    dp: VrsDataProvider,
    s_id: StreamId,
    stream_info: Mapping[str, StreamInfo] = STREAM_INFO,
    **kwargs: Iterable[str],
) -> np.ndarray:
    return np.empty(
        dp.get_num_data(s_id),
        create_stream_dtype(dp, s_id, stream_info=stream_info, **kwargs),
    )


# Wrapper around deliver_queued_sensor_data that avoids issues with streams having
# having start times = -1. projectaria_tools fixes this in 1.4, so we can remove this
# in the future.
def generate_sensor_data(
    dp: VrsDataProvider, *, streams: Iterable[StreamId] | None = None
) -> Iterator[SensorData]:
    options = dp.get_default_deliver_queued_options()
    options.deactivate_stream_all()
    if streams is None:
        streams = get_active_streams(dp)
    else:
        streams = [
            s_id for s_id in streams if dp.get_first_time_ns(s_id, _DEVICE_TIME) != -1
        ]
    for s_id in streams:
        options.activate_stream(s_id)
    return dp.deliver_queued_sensor_data(options)


def first_time_ns(dp: VrsDataProvider, time_domain: TimeDomain = _DEVICE_TIME) -> int:
    # We only use the first time from some streams because for some reason 231-1
    # (the microphones) sometimes have a way earlier first time (and all of its
    # records are at the same time) than the other streams
    return min(
        dp.get_first_time_ns(s_id, time_domain)
        for s_id in get_active_streams(dp)
        if str(s_id) != "231-1"
    )


def get_stream_data(
    dp: VrsDataProvider,
    streams: Iterable[StreamId] | StreamId,
    *,
    stream_info: Mapping[str, StreamInfo] = STREAM_INFO,
) -> dict[str, np.ndarray]:
    if isinstance(streams, StreamId):
        streams = (streams,)
    data_arrays = {
        str(stream_id): create_stream_array(dp, stream_id, stream_info=stream_info)
        for stream_id in streams
    }
    indices = {str(stream_id): 0 for stream_id in streams}

    for s_data in generate_sensor_data(dp, streams=streams):
        s_id = s_data.stream_id()
        s_type = s_data.sensor_data_type().name.lower()
        if s_type == "image" or s_type == "audio":
            _, s_data = getattr(s_data, f"{s_type}_data_and_record")()
        else:
            s_data = getattr(s_data, f"{s_type}_data")()

        data_array = data_arrays[str(s_id)]
        index = indices[str(s_id)]
        # data_array[index] = [getattr(s_data, name) for name in data_array.dtype.names]
        for name in data_array.dtype.names:
            data_array[index][name] = getattr(s_data, name)
        indices[str(s_id)] += 1

    return data_arrays
