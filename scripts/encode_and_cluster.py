import argparse
import pathlib

from cluster_faces import main as cluster
from encode_faces import main as encode


def run_from_pipeline(args):
    if "detection-method" in args:
        args["detection_method"] = args.pop("detection-method")
    main(**args)


def main(
    dataset: pathlib.Path,
    detection_method: str = "cnn",
    jobs: int = 0.4,
    epsilon: float = 0.4,
):
    encodings = dataset / f"{dataset.stem}.pickle"
    outputs = pathlib.Path("data/faceClusters", dataset.stem)
    encode(dataset, encodings, detection_method)
    cluster(encodings, outputs, jobs, epsilon)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Encode and cluster faces with just images"
    )
    # encode face args
    parser.add_argument(
        "-i",
        "--dataset",
        type=pathlib.Path,
        required=True,
        help=(
            "path to input directory of faces + images, should be in"
            " data/imagesForEncoding"
        ),
    )
    parser.add_argument(
        "-d",
        "--detection-method",
        default="cnn",
        help="face detection model to use: either `hog` or `cnn`",
    )
    # cluster face args
    parser.add_argument(
        "-j",
        "--jobs",
        type=int,
        default=-1,
        help="# of parallel jobs to run (-1 will use all CPUs)",
    )
    parser.add_argument(
        "-eps",
        "--epsilon",
        type=float,
        default=0.4,
        help=(
            "Controls how far away points can be from one another to still be a"
            " cluster. Too small and all will be considered noise, too large and all"
            " will be grouped as 1 face."
        ),
    )

    args = vars(parser.parse_args())
    main(**args)
