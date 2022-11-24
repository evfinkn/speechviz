import os
import csv
import time
import argparse
import subprocess
from dataclasses import dataclass

import imufusion
import numpy as np
from scipy import interpolate
import pyark.datatools as datatools

import util

RADIAN_TO_DEGREE_FACTOR = 180 / np.pi
DEGREE_TO_RADIAN_FACTOR = np.pi / 180
EARTH_GRAVITATIONAL_ACCELERATION = 9.8067
        

def run_ahrs(timestamp, accelerometer, gyroscope, magnetometer, sample_rate):
    # Instantiate algorithms
    offset = imufusion.Offset(sample_rate)
    ahrs = imufusion.Ahrs()

    ahrs.settings = imufusion.Settings(0.5,  # gain
                                       10,  # acceleration rejection
                                       20,  # magnetic rejection
                                       5 * sample_rate)  # rejection timeout = 5 seconds

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
    
    # Identify moving periods
    is_moving = np.empty(len(timestamp))
    for index in range(len(timestamp)):
        is_moving[index] = np.sqrt(acceleration[index].dot(acceleration[index])) > 2  # threshold = 2 m/s/s
        
    for index in range(len(timestamp) - margin):
        is_moving[index] = any(is_moving[index:(index + margin)])  # add leading margin
    for index in range(len(timestamp) - 1, margin, -1):
        is_moving[index] = any(is_moving[(index - margin):index])  # add trailing margin

    # Calculate velocity (includes integral drift)
    velocity = np.zeros((len(timestamp), 3))
    for index in range(len(timestamp)):
        if is_moving[index]:  # only integrate if moving
            velocity[index] = velocity[index - 1] + delta_time[index] * acceleration[index]

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
        t_new = timestamp[start_index:(stop_index + 1)]

        velocity_drift[start_index:(stop_index + 1), 0] = interpolate.interp1d(t, x)(t_new)
        velocity_drift[start_index:(stop_index + 1), 1] = interpolate.interp1d(t, y)(t_new)
        velocity_drift[start_index:(stop_index + 1), 2] = interpolate.interp1d(t, z)(t_new)
    velocity = velocity - velocity_drift

    # Calculate position
    position = np.zeros((len(timestamp), 3))
    for index in range(len(timestamp)):
        position[index] = position[index - 1] + delta_time[index] * velocity[index]
    
    return position
        

def create_poses(file_dir, 
                 reprocess=False, 
                 headers=True, 
                 quiet=False, 
                 verbose=0):
    
    if not quiet or verbose:
        print(f"Processing {file_dir}")
        start_time = time.perf_counter()
        
    if os.path.exists(f"{file_dir}/pose.csv") and not reprocess:
        if not quiet or verbose:
            print(f"Poses for {file_dir} have already been created. To recreate them, use the '-r' argument")
        return
        
    if verbose:
        print("Loading data")
    
    with open(f"{file_dir}/calib.txt", encoding="utf-8") as file:
        calibration = file.read()
    device_model = datatools.sensors.DeviceModel.fromJson(calibration)
    accelerometer_calibration = device_model.getImuCalib("imu-left").accel
    gyroscope_calibration  = device_model.getImuCalib("imu-left").gyro
    
    imu_data = np.genfromtxt(f"{file_dir}/imu-left.csv", delimiter=",", skip_header=1)
    timestamp = imu_data[:, 0]
    timestamp -= timestamp[0]
    accelerometer = imu_data[:, 1:4]
    gyroscope = imu_data[:, 4:]
    for i in range(len(timestamp)):
        accelerometer[i] = accelerometer_calibration.rectify(accelerometer[i])  # 
        accelerometer[i] /= EARTH_GRAVITATIONAL_ACCELERATION  # imufusion requires acceleration in g
        gyroscope[i] = gyroscope_calibration.rectify(gyroscope[i])
        gyroscope[i] *= RADIAN_TO_DEGREE_FACTOR  # imufusion requires degrees
        
    mag_data = np.genfromtxt(f"{file_dir}/magnetometer.csv", delimiter=",", skip_header=1)
    # ahrs.update ignores the magnetometer measurement if the input is the zero vector, so filling
    # zeros in between the actual measurements and passing those into ahrs.update doesn't mess with
    # the algorithm / results.
    # See https://github.com/xioTechnologies/Fusion/blob/main/Fusion/FusionAhrs.c#L208
    magnetometer = np.zeros((len(timestamp), 3))
    for mag_index in range(len(mag_data)):
        # transform the mag data from its coordinate system to the left imu's coordinate system
        transformed = device_model.transform(mag_data[mag_index, 1:], "mag0", "imu-left")
        # get the index of the imu timestamp closest to the mag timestamp
        nearest_index = util.get_nearest_index(timestamp, mag_data[mag_index, 0])
        magnetometer[nearest_index] = transformed
    
    sample_rates = 1 / np.diff(timestamp)
    sample_rate = round(np.mean(sample_rates))
    
    if verbose:
        print("Running ahrs")
        ahrs_start_time = time.perf_counter()
    
    quaternion, acceleration = run_ahrs(timestamp, accelerometer, gyroscope, magnetometer, sample_rate)
    
    if verbose:
        print(f"ahrs finished in {time.perf_counter() - ahrs_start_time:.4f} seconds")
        print("Calculating position")
        position_start_time = time.perf_counter()
        
    position = calculate_position(timestamp, acceleration, sample_rate)
    
    if verbose:
        print(f"Calculated positions in {time.perf_counter() - position_start_time:.4f} seconds")
        print("Writing files")
    
    with open(f"{file_dir}/pose.csv", "w", newline="") as file:
        # reshape timestamp into a column vector for np.concatenate
        timestamp = timestamp.reshape(timestamp.shape[0], 1)
        data = np.concatenate((timestamp, position, quaternion), axis=1)
        writer = csv.writer(file)
        if headers:
            header = "t,x,y,z,qw,qx,qy,qz".split(",")
            writer.writerow(header)
        writer.writerows(data)
        
    if not quiet or verbose:
        print(f"Processed {file_dir} in {time.perf_counter() - start_time:.4f} seconds")
        
        
def route_file(*args, verbose=0, scan_dir=2, **kwargs):
    """ Handles the different types of files (txt, dir, csv) that can be input to this scripts """
    if verbose:
        print()  # to visually separate the output of each call to extract_data
    
    if len(args) == 0:
        args = [os.getcwd()]  # if no file or directory given, use directory script was called from
    elif len(args) > 1:  # if multiple files (or directories) given, run function on each one
        if len(args) == 2:
            file1 = util.FileInfo(args[0])
            file2 = util.FileInfo(args[1])
            if (file1.dir == file2.dir and file1.ext == file2.ext == ".csv" and
                ((file1.name == "imu-left" and file2.name == "magnetometer") or
                (file1.name == "magnetometer" and file2.name == "imu-left"))):
                
                create_poses(file1.dir, verbose=verbose, **kwargs)
        else:
            for arg in args:
                route_file(arg, scan_dir=scan_dir, **kwargs)
        return  # stop function because all processing done in the function calls in the for loop
    
    path = args[0]  # args[0] is--at this point--the only argument in args
    file = util.FileInfo(path)
    
    # if given text file, run the function on each line
    if file.ext == ".txt":
        if verbose:
            print(f"{file.path} is a text file. Routing the file on each line...")
        with open(file.path) as txtfile:
            for line in txtfile.read().split("\n"):
                route_file(line, scan_dir=scan_dir, **kwargs)
        return
    
    # route every file in file.path if it is a dir and scan_dir is True
    elif file.ext == "" and scan_dir:
        ls = subprocess.run(["ls", file.path], stdout=subprocess.PIPE).stdout.decode().split("\n")[:-1]  # get files in dir
        if "imu-left.csv" in ls and "magnetometer.csv" in ls:  # if the csv files in dir, run create_poses
            create_poses(file.path, verbose=verbose, **kwargs)
        elif scan_dir >= 2:
            if verbose:
                print(f"{file.path} is a directory. Routing the subdirectories...")
            for dir_file in ls:
                route_file(f"{file.path}/{dir_file}", verbose=verbose, scan_dir=scan_dir - 1, **kwargs)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create pose data from IMU and magnetometer data.")
    parser.add_argument("path", 
                        nargs="*", 
                        help="The path to the directory to process. If the directory"
                             "contains an imu-left.csv file and a magnetometer.csv file,"
                             "Otherwise, it applies that process to the subdirectories"
                             "of path")
    parser.add_argument("-r", "--reprocess", 
                        action="store_true", 
                        help="Reprocess files detected to have already been processed")
    # parser.add_argument("--no-headers",
    #                     action="store_true", 
    #                     help="Don't add the headers to the CSV files")
    parser.add_argument("-q", "--quiet", 
                        action="store_true", 
                        help="Don't print anything")
    parser.add_argument("-v", "--verbose", 
                        action="count", 
                        default=0, 
                        help="Print various debugging information")
    
    args = parser.parse_args()
    if not args.quiet or args.verbose:
        start_time = time.perf_counter()
    # route_file(*args.path, 
    #            reprocess=args.reprocess, 
    #            headers=True, 
    #            quiet=args.quiet, 
    #            verbose=args.verbose)
    route_file(*args.path, reprocess=args.reprocess, quiet=args.quiet, verbose=args.verbose)
    if not args.quiet or args.verbose:
        print(f"Pose creation took a total of {time.perf_counter() - start_time:.4f} seconds")
    