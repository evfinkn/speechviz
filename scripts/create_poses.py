import argparse
import csv
from dataclasses import dataclass
from pathlib import Path

import imufusion
import numpy as np
from projectaria_tools.core import data_provider
from projectaria_tools.core.data_provider import VrsDataProvider
from projectaria_tools.core.stream_id import StreamId
from scipy import interpolate

import log
import util
from constants import DATA_DIR
from log import logger
from util_aria import first_time_ns, get_stream_data

RADIAN_TO_DEGREE_FACTOR = 180 / np.pi
DEGREE_TO_RADIAN_FACTOR = np.pi / 180
EARTH_GRAVITATIONAL_ACCELERATION = 9.8067


def run_ahrs(timestamp, accelerometer, gyroscope, magnetometer, sample_rate):
    # Instantiate algorithms
    offset = imufusion.Offset(sample_rate)
    ahrs = imufusion.Ahrs()

    ahrs.settings = imufusion.Settings(
        imufusion.CONVENTION_ENU,
        0.5,  # gain
        2000,  # gyroscope range
        10,  # acceleration rejection
        20,  # magnetic rejection
        5 * sample_rate,  # recovery trigger period = 5 seconds
    )

    # Process sensor data
    delta_time = np.diff(timestamp, prepend=timestamp[0])
    # euler = np.empty((len(timestamp), 3))
    quaternion = np.empty((len(timestamp), 4))
    acceleration = np.empty((len(timestamp), 3))

    for i in range(len(timestamp)):
        gyroscope[i] = offset.update(gyroscope[i])
        # no need to check if magnetometer is 0 and call ahrs.update_no_magnetometer
        # if it is because update_no_magnetometer just calls update with the zero
        # vector anyway
        ahrs.update(gyroscope[i], accelerometer[i], magnetometer[i], delta_time[i])
        quaternion[i] = ahrs.quaternion.wxyz
        # euler[i] = ahrs.quaternion.to_euler()

    return quaternion, acceleration


# https://github.com/xioTechnologies/Gait-Tracking/blob/main/gait_tracking.py
def calculate_position(timestamp, acceleration, sample_rate):
    delta_time = np.diff(timestamp, prepend=timestamp[0])
    margin = int(0.05 * sample_rate)
    log.log_vars(margin=margin)

    # Identify moving periods
    is_moving = np.empty(len(timestamp))
    for index in range(len(timestamp)):
        # threshold = 2 m/s/s
        is_moving[index] = np.sqrt(acceleration[index].dot(acceleration[index])) > 2

    for index in range(len(timestamp) - margin):
        # add leading margin
        is_moving[index] = any(is_moving[index : (index + margin)])
    for index in range(len(timestamp) - 1, margin, -1):
        # add trailing margin
        is_moving[index] = any(is_moving[(index - margin) : index])

    # Calculate velocity (includes integral drift)
    velocity = np.zeros((len(timestamp), 3))
    for index in range(len(timestamp)):
        if is_moving[index]:  # only integrate if moving
            velocity[index] = (
                velocity[index - 1] + delta_time[index] * acceleration[index]
            )

    # Find start and stop indices of each moving period
    @dataclass
    class IsMovingPeriod:
        start_index: int = -1
        stop_index: int = -1

    is_moving_diff = np.diff(is_moving, append=is_moving[-1])
    is_moving_periods = []
    is_moving_period = IsMovingPeriod()

    for index in range(len(timestamp)):
        if is_moving_period.start_index == -1:
            if is_moving_diff[index] == 1:
                is_moving_period.start_index = index
        elif is_moving_period.stop_index == -1:
            if is_moving_diff[index] == -1:
                is_moving_period.stop_index = index
                is_moving_periods.append(is_moving_period)
                is_moving_period = IsMovingPeriod()

    # Remove integral drift from velocity
    velocity_drift = np.zeros((len(timestamp), 3))
    for is_moving_period in is_moving_periods:
        start_index = is_moving_period.start_index
        stop_index = is_moving_period.stop_index

        t = [timestamp[start_index], timestamp[stop_index]]
        x = [velocity[start_index, 0], velocity[stop_index, 0]]
        y = [velocity[start_index, 1], velocity[stop_index, 1]]
        z = [velocity[start_index, 2], velocity[stop_index, 2]]
        t_new = timestamp[start_index : (stop_index + 1)]

        velocity_drift[start_index : (stop_index + 1), 0] = interpolate.interp1d(t, x)(
            t_new
        )
        velocity_drift[start_index : (stop_index + 1), 1] = interpolate.interp1d(t, y)(
            t_new
        )
        velocity_drift[start_index : (stop_index + 1), 2] = interpolate.interp1d(t, z)(
            t_new
        )
    velocity = velocity - velocity_drift

    # Calculate position
    position = np.zeros((len(timestamp), 3))
    for index in range(len(timestamp)):
        position[index] = position[index - 1] + delta_time[index] * velocity[index]

    return position


@log.Timer()
def create_poses(
    vrs_path: Path,
    reprocess: bool = False,
    headers=True,
    positions=False,
):
    log.log_vars(
        log_separate_=True,
        vrs_path=vrs_path,
        reprocess=reprocess,
        headers=headers,
        positions=positions,
    )

    try:
        parent_dir = vrs_path.parent.relative_to(DATA_DIR / "vrs")
    except ValueError:
        raise ValueError("Input file must be in a directory in data/vrs")
    pose_path = DATA_DIR / "graphical" / parent_dir / vrs_path.stem / "pose.csv"

    log.log_vars(pose_path=pose_path)
    if pose_path.exists() and not reprocess:
        logger.info(
            "Poses for {} have already been created. To recreate them, pass -r",
            vrs_path.name,
        )
        return

    pose_path.parent.mkdir(parents=True, exist_ok=True)

    logger.trace("Loading data")

    dp: VrsDataProvider = data_provider.create_vrs_data_provider(str(vrs_path))
    imu_label = dp.get_label_from_stream_id(StreamId("1202-2"))
    mag_label = dp.get_label_from_stream_id(StreamId("1203-1"))

    calib = dp.get_device_calibration()
    imu_calib = calib.get_imu_calib(imu_label)
    mag_calib = calib.get_magnetometer_calib(mag_label)
    transform_cpf_imu = calib.get_transform_cpf_sensor(imu_label)
    # True because otherwise throws "[DeviceCalibration][ERROR]: Sensor mag0 is not
    # calibrated by default. Please use ::getT_Device_SensorByLabel(label, true) to use
    # its CAD extrinsics value."
    transform_cpf_mag = calib.get_transform_cpf_sensor(mag_label, True)

    # 1202-2 = imu-left and 1203-1 = magnetometer
    data_arrays = get_stream_data(dp, (StreamId("1202-2"), StreamId("1203-1")))

    imu_data = data_arrays["1202-2"]
    timestamp = imu_data["capture_timestamp_ns"]
    accelerometer = imu_data["accel_msec2"]
    gyroscope = imu_data["gyro_radsec"]
    for i in range(len(timestamp)):
        accelerometer[i] = imu_calib.raw_to_rectified_accel(accelerometer[i])
        gyroscope[i] = imu_calib.raw_to_rectified_gyro(gyroscope[i])

    # transform_cpf_imu @ accelerometer[i] has shape (3, 1), but we need
    # (3,) so use np.squeeze to remove the extra dimension
    accelerometer = (transform_cpf_imu @ accelerometer.T).T
    gyroscope = (transform_cpf_imu @ gyroscope.T).T
    # imufusion requires acceleration in g. We don't need negative because
    # imufusion's default convention is that positive z is up.
    accelerometer /= EARTH_GRAVITATIONAL_ACCELERATION
    gyroscope *= RADIAN_TO_DEGREE_FACTOR  # imufusion requires degrees

    mag_data = data_arrays["1203-1"]
    mag_timestamp = mag_data["capture_timestamp_ns"]
    mag_data = mag_data["mag_tesla"]
    mag_data[:, 0]
    # ahrs.update ignores the magnetometer measurement if the input is the zero
    # vector, so filling zeros in between the actual measurements and passing those
    # into ahrs.update doesn't mess with the algorithm / results.
    # See https://github.com/xioTechnologies/Fusion/blob/main/Fusion/FusionAhrs.c#L208
    magnetometer = np.zeros((len(timestamp), 3))
    for i in range(len(mag_data)):
        mag_data[i] = mag_calib.raw_to_rectified(mag_data[i])
        # transform the magnetometer data from its coordinate system
        # to the central pupil frame
        mag_data[i] = np.squeeze(transform_cpf_mag @ mag_data[i])
        # get the index of the imu timestamp closest to the mag timestamp
        nearest_index = util.get_nearest_index(timestamp, mag_timestamp[i])
        magnetometer[nearest_index] = mag_data[i]

    # Currently, the data has +X is left, +Y is up, and +Z points forward, from the
    # person's perspective. imufusion has different conventions. We'll use the
    # ENU convention (i.e., +X is forward, +Y is left, and +Z is up) because it's
    # a right-handed coordinate system like the current one. So, we need to swap the
    # axes around to get the correct orientation.
    # Note that we use [0, 1, 2] instead of : because otherwise there is no temporary
    # array created, so data can be overwritten before it is moved.
    accelerometer[:, [0, 1, 2]] = accelerometer[:, [2, 0, 1]]
    gyroscope[:, [0, 1, 2]] = gyroscope[:, [2, 0, 1]]
    magnetometer[:, [0, 1, 2]] = magnetometer[:, [2, 0, 1]]

    # convert from ns to s and make relative to the first timestamp of the vrs file
    first_timestamp = first_time_ns(dp)
    timestamp = (timestamp - first_timestamp) / 1e9

    sample_rates = 1 / np.diff(timestamp)
    sample_rate = round(np.mean(sample_rates))

    with log.Timer("ahrs took {}"):
        quaternion, acceleration = run_ahrs(
            timestamp, accelerometer, gyroscope, magnetometer, sample_rate
        )
    # convert back to m/s/s
    acceleration *= EARTH_GRAVITATIONAL_ACCELERATION
    # reconvert to the original coordinate system
    acceleration[:, [2, 0, 1]] = acceleration[:, [0, 1, 2]]
    quaternion[:, [3, 1, 2]] = quaternion[:, [1, 2, 3]]

    if positions:
        logger.trace("Calculating position")
        with log.Timer("Calculating positions took {}"):
            position = calculate_position(timestamp, acceleration, sample_rate)
        header = "t,x,y,z,qw,qx,qy,qz".split(",")
    else:
        header = "t,qw,qx,qy,qz".split(",")

    logger.trace("Writing files")
    with pose_path.open("w", newline="") as file:
        # reshape timestamp into a column vector for np.concatenate
        timestamp = timestamp.reshape(timestamp.shape[0], 1)
        if positions:
            data = np.concatenate((timestamp, position, quaternion), axis=1)
        else:
            data = np.concatenate((timestamp, quaternion), axis=1)
        writer = csv.writer(file)
        if headers:
            # first row is the header row, add # to indicate it's a comment
            file.write("# ")
            writer.writerow(header)
        writer.writerows(data)


def route_dir(dir, scan_dir=True, **kwargs):
    logger.debug("Running create_poses on each file in {}", dir)
    for path in dir.iterdir():
        route_file(path, scan_dir=scan_dir, **kwargs)


def route_file(*paths: Path, scan_dir: bool = True, **kwargs):
    """Handles the different types of files that can be input into this script."""
    if len(paths) == 0:
        paths = [
            Path.cwd()
        ]  # if no file or directory given, use directory script was called from
    elif (
        len(paths) > 1
    ):  # if multiple files (or directories) given, run function on each one
        for path in paths:
            route_file(path, scan_dir=scan_dir, **kwargs)
        # stop function because all of the processing is
        # done in the function calls in the for loop
        return

    path = paths[0].absolute()  # paths[0] is--at this point--the only argument in paths

    if path.suffix.casefold() == ".vrs":
        create_poses(path, **kwargs)

    # route every file in file.path if it is a dir and scan_dir is True
    elif path.is_dir() and scan_dir:
        if path.name == "data":  # the data dir was passed so run on data/vrs
            route_dir(path / "vrs", scan_dir=scan_dir, **kwargs)
        else:
            route_dir(path, scan_dir=False, **kwargs)


def run_from_pipeline(args):
    # path should be a str or list of str so convert to list of Paths
    paths = util.expand_files(args.pop("path"), to_paths=True)
    route_file(*paths, **args)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Create pose data from IMU and magnetometer data."
    )
    parser.add_argument(
        "path",
        nargs="*",
        type=Path,
        help=(
            "The path to the file to process. If a VRS file, creates poses from the VRS"
            " file. If a directory, creates poses from every VRS file in the directory."
        ),
    )
    parser.add_argument(
        "-r",
        "--reprocess",
        action="store_true",
        help="Reprocess files detected to have already been processed",
    )
    # parser.add_argument("--no-headers",
    #                     action="store_true",
    #                     help="Don't add the headers to the CSV files")
    parser.add_argument(
        "--positions",
        action=util.BooleanOptionalAction,
        default=False,
        help=(
            "Whether to calculate positions. Note that the calculation currently isn't"
            " very accurate. Default is False."
        ),
    )
    log.add_log_level_argument(parser)

    args = vars(parser.parse_args())
    log.setup_logging(args.pop("log_level"))
    with log.Timer("Pose creation took {}"):
        route_file(*args.pop("path"), **args)
