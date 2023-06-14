import argparse
import csv
import os
import pathlib
from dataclasses import dataclass

import imufusion
import numpy as np
import pyark.datatools as datatools
from scipy import interpolate

import log
import util
from log import logger

RADIAN_TO_DEGREE_FACTOR = 180 / np.pi
DEGREE_TO_RADIAN_FACTOR = np.pi / 180
EARTH_GRAVITATIONAL_ACCELERATION = 9.8067


def run_ahrs(timestamp, accelerometer, gyroscope, magnetometer, sample_rate):
    # Instantiate algorithms
    offset = imufusion.Offset(sample_rate)
    ahrs = imufusion.Ahrs()

    ahrs.settings = imufusion.Settings(
        0.5,  # gain
        10,  # acceleration rejection
        20,  # magnetic rejection
        5 * sample_rate,
    )  # rejection timeout = 5 seconds

    # Process sensor data
    delta_time = np.diff(timestamp, prepend=timestamp[0])
    # euler = np.empty((len(timestamp), 3))
    quaternion = np.empty((len(timestamp), 4))
    acceleration = np.empty((len(timestamp), 3))

    for i in range(len(timestamp)):
        gyroscope[i] = offset.update(gyroscope[i])
        ahrs.update(gyroscope[i], accelerometer[i], magnetometer[i], delta_time[i])
        quaternion[i] = ahrs.quaternion.array
        # euler[i] = ahrs.quaternion.to_euler()
        # convert from g back to m/s^2
        acceleration[i] = EARTH_GRAVITATIONAL_ACCELERATION * ahrs.earth_acceleration

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
    imu_path: pathlib.Path,
    mag_path: pathlib.Path,
    reprocess: bool = False,
    headers=True,
    positions=False,
):
    log.log_vars(
        log_separate_=True,
        imu_path=imu_path,
        mag_path=mag_path,
        reprocess=reprocess,
        headers=headers,
        positions=positions,
    )

    parent = imu_path.parent

    pose_path = parent / "pose.csv"
    log.log_vars(log_separate_=True, parent=parent, pose_path=pose_path)
    if pose_path.exists() and not reprocess:
        logger.info(
            "Poses for {} have already been created. To recreate them, pass -r",
            parent,
        )
        return

    logger.trace("Loading data")
    with open(parent / "calib.txt", encoding="utf-8") as file:
        calibration = file.read()
    device_model = datatools.sensors.DeviceModel.fromJson(calibration)
    accelerometer_calibration = device_model.getImuCalib("imu-left").accel
    gyroscope_calibration = device_model.getImuCalib("imu-left").gyro

    imu_data = np.genfromtxt(imu_path, delimiter=",", skip_header=1)
    timestamp = imu_data[:, 0]
    accelerometer = imu_data[:, 1:4]
    gyroscope = imu_data[:, 4:]
    for i in range(len(timestamp)):
        accelerometer[i] = accelerometer_calibration.rectify(accelerometer[i])  #
        accelerometer[
            i
        ] /= EARTH_GRAVITATIONAL_ACCELERATION  # imufusion requires acceleration in g
        gyroscope[i] = gyroscope_calibration.rectify(gyroscope[i])
        gyroscope[i] *= RADIAN_TO_DEGREE_FACTOR  # imufusion requires degrees

    mag_data = np.genfromtxt(mag_path, delimiter=",", skip_header=1)
    # ahrs.update ignores the magnetometer measurement if the input is the zero
    # vector, so filling zeros in between the actual measurements and passing those
    # into ahrs.update doesn't mess with the algorithm / results.
    # See https://github.com/xioTechnologies/Fusion/blob/main/Fusion/FusionAhrs.c#L208
    magnetometer = np.zeros((len(timestamp), 3))
    for mag_index in range(len(mag_data)):
        # transform the magnetometer data from its coordinate system
        # to the left imu's coordinate system
        transformed = device_model.transform(
            mag_data[mag_index, 1:], "mag0", "imu-left"
        )
        # get the index of the imu timestamp closest to the mag timestamp
        nearest_index = util.get_nearest_index(timestamp, mag_data[mag_index, 0])
        magnetometer[nearest_index] = transformed

    sample_rates = 1 / np.diff(timestamp)
    sample_rate = round(np.mean(sample_rates))

    with log.Timer("ahrs took {}"):
        quaternion, acceleration = run_ahrs(
            timestamp, accelerometer, gyroscope, magnetometer, sample_rate
        )
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


def route_dir(dir, verbose=0, **kwargs):
    imu_path = dir / "imu-left.csv"
    mag_path = dir / "magnetometer.csv"
    if imu_path.exists() and mag_path.exists():
        create_poses(imu_path, mag_path, verbose=verbose, **kwargs)


def route_file(*paths: pathlib.Path, quiet: bool = False, verbose: int = 0, **kwargs):
    """Handles the different types of files that can be input into this script."""
    if len(paths) == 0:
        # if no file or directory given, use directory script was called from
        paths = [os.getcwd()]
    # if multiple files (or directories) given, run function on each one
    elif len(paths) > 1:
        if len(paths) == 2:
            path1, path2 = paths
            if path1.parent != path2.parent:
                logger.error("{} and {} need to be in the same directory", path1, path2)
            if path1.name == "imu-left.csv" and path2.name == "magnetometer.csv":
                create_poses(path1, path2, quiet=quiet, verbose=verbose, **kwargs)
            elif path2.name == "imu-left.csv" and path1.name == "magnetometer.csv":
                create_poses(path2, path1, quiet=quiet, verbose=verbose, **kwargs)
        elif paths[0].is_dir():  # assume paths is all paths to directories
            for path in paths:
                route_file(path, quiet=quiet, verbose=verbose, **kwargs)
        else:  # paths is a list of imu_left and magnetometer paths
            for path1, path2 in util.grouped(paths, 2):
                route_file(path1, path2, quiet=quiet, verbose=verbose, **kwargs)
        # stop function because all of the processing is
        # done in the function calls in the for loop
        return

    # paths[0] is--at this point--the only argument in paths
    path = paths[0].absolute()

    if path.is_dir():
        if path.name == "data":
            path = path / "graphical"
        if path.name == "graphical":
            for dir in path.iterdir():
                route_dir(dir, quiet=quiet, verbose=verbose, **kwargs)
        elif path.parent.name == "graphical":
            route_dir(path, quiet=quiet, verbose=verbose, **kwargs)
        else:
            logger.error(
                "{} is an invalid directory. Must be either the data directory, the"
                " graphical directory, or a subdirectory of the graphical directory",
                path,
            )


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
        type=pathlib.Path,
        help=(
            "The path to the directory to process. If the directory"
            "contains an imu-left.csv file and a magnetometer.csv file,"
            "Otherwise, it applies that process to the subdirectories"
            "of path"
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
