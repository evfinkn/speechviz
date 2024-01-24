import queue
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from typing import NamedTuple

import numpy as np
import numpy.typing as npt
from projectaria_tools.core.data_provider import VrsDataProvider
from projectaria_tools.core.sensor_data import SensorData, SensorDataType, TimeDomain
from projectaria_tools.core.stream_id import StreamId

DEVICE_TIME = TimeDomain.DEVICE_TIME


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
    def make(cls, id: str, name: str, properties: Iterable[tuple], timestamp=True):
        props = [TIMESTAMP_PROPERTY] if timestamp else []
        props.extend(Property(*p) for p in properties)
        return cls(id, name, tuple(props))

    def create_dtype(self):
        # remember that each property is just a tuple of (name, dtype)
        return np.dtype(list(self.properties))

    def without(self, *names: str):
        return StreamInfo(
            self.id,
            self.name,
            tuple(p for p in self.properties if p.name not in names),
        )

    def with_only(self, *names: str):
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
    return {
        str(s_id): dp.get_label_from_stream_id(s_id) for s_id in dp.get_all_streams()
    }


def get_active_streams(dp: VrsDataProvider) -> list[StreamId]:
    return [
        s_id
        for s_id in dp.get_all_streams()
        if dp.get_first_time_ns(s_id, DEVICE_TIME) != -1
    ]


def create_stream_dtype(
    dp: VrsDataProvider,
    s_id: StreamId,
    *,
    stream_info: dict[str, StreamInfo] = STREAM_INFO,
    without: Iterable[str] = None,
    with_only: Iterable[str] = None,
) -> np.dtype:
    info = stream_info[str(s_id)]
    if without is not None:
        info = info.without(*without)
    if with_only is not None:
        info = info.with_only(*with_only)
    return info.create_dtype()


def create_stream_array(
    dp: VrsDataProvider, s_id: StreamId, **kwargs: dict[str, Iterable[str]]
) -> np.ndarray:
    return np.empty(dp.get_num_data(s_id), create_stream_dtype(dp, s_id, **kwargs))


# Reimplementation of projectaria_tools' SensorDataIterator because for some
# reason it doesn't work. Source code is here:
# https://github.com/facebookresearch/projectaria_tools/blob/main/core/data_provider/SensorDataSequence.cpp
def generate_sensor_data(
    dp: VrsDataProvider, *, streams: list[StreamId] = None
) -> Iterator[SensorData]:
    if streams is None:
        streams = get_active_streams(dp)
    else:
        streams = [
            s_id for s_id in streams if dp.get_first_time_ns(s_id, DEVICE_TIME) != -1
        ]

    data_queue = queue.PriorityQueue()

    def enqueue(data: SensorData):
        # Wrap in tuple to make the queue prioritize by time (earliest first)
        data_queue.put((data.get_time_ns(DEVICE_TIME), data))

    # Enqueue the first data point from each stream
    for stream_id in streams:
        data = dp.get_sensor_data_by_index(stream_id, 0)
        # data_queue.put((data.get_time_ns(DEVICE_TIME), data))
        enqueue(data)

    # Have to use str(stream_id) because StreamId isn't hashable
    next_indices = {str(stream_id): 1 for stream_id in streams}

    while not data_queue.empty():
        _, data = data_queue.get()
        if data.sensor_data_type() != SensorDataType.NOT_VALID:
            yield data

        stream_id = data.stream_id()
        next_index = next_indices[str(stream_id)]
        if next_index < dp.get_num_data(stream_id):
            next_data = dp.get_sensor_data_by_index(stream_id, next_index)
            # data_queue.put((next_data.get_time_ns(DEVICE_TIME), next_data))
            enqueue(next_data)
            next_indices[str(stream_id)] += 1


def first_time_ns(dp: VrsDataProvider, time_domain: TimeDomain = DEVICE_TIME) -> int:
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
    stream_info: dict[str, StreamInfo] = STREAM_INFO,
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
