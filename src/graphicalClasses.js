import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import globals from "./globals";
import { binarySearch } from "./util";

const media = globals.media;

var Disposer = class Disposer extends Set {
    add(disposable, ...disposables) {
        if (disposables.length > 0) { disposables.forEach(d => this.add(d)); }
        if (disposable == undefined) { return; }
        if (Array.isArray(disposable)) { disposable.forEach(d => this.add(d)); }

        if (disposable instanceof THREE.Object3D) {
            super.add(disposable)  // so that removed from parent even if not disposable.dispose()
            this.add(disposable.geometry);
            this.add(disposable.material);
            this.add(disposable.children);
        }
        else if (disposable.dispose != undefined) {
            super.add(disposable);
        }
    }

    dispose() {
        for (const disposable of this) {
            if (disposable.dispose) { disposable.dispose(); }
            if (disposable instanceof THREE.Object3D && disposable.parent) {
                disposable.parent.remove(disposable);
            }
        }
        this.clear();
    }
}

var GraphIMU = class GraphIMU {

    // how close quat / pos is slerped / lerped towards the destination
    // can't use 1 for some reason because otherwise the object becomes invisible
    static interpolationFactor = 0.999999;

    container;

    width;
    height;
    aspect;

    renderer;
    scene;
    camera;

    disposer;

    controls;
    glasses;

    poseFile;
    timestamps;
    positions;
    quaternions;

    constructor(container, data, { width = undefined, height = undefined, aspect = undefined } = {}) {
        // this.canvas = canvas;
        this.container = container;

        this.width = width != undefined ? width : canvas.offsetWidth;
        this.height = height != undefined ? height : canvas.offsetHeight;
        this.aspect = aspect != undefined ? aspect : width / height;

        this.disposer = new Disposer();

        this.parseData(data);
        this.init();
    }

    parseData(data) {
        // load the pose data from the CSV file. Columns are one of the following:
        // t x y z qw qx qy qz
        // t qw qx qy qz
        // where (x, y, z) is the position and (qx, qy, qz, qw) is the quaternion of the orientation
        // const rows = await fetch(this.poseFile)
        //     .then(checkResponseStatus)
        //     .then(response => response.text())
        //     .then(text => text.split("\n").map(row => row.split(",").map(parseFloat)));
        // if (rows.length == 0) { throw new Error(`${this.poseFile} doesn't contain any data.`); }

        this.timestamps = data.map(row => row[0]);
        if (data[0].length == 5) { this.quaternions = data.map(row => row.slice(1)); }
        else if (data[0].length == 8) {
            this.positions = data.map(row => row.slice(1, 4));
            this.quaternions = data.map(row => row.slice(4));
        }
        else { throw new Error(`data must have either 5 or 8 columns.`); }

        if (this.quaternions) {
            for (let i = 0; i < this.quaternions.length; i++) {
                const [qw, qx, qy, qz] = this.quaternions[i];
                // use qy, qz, qx instead of qx, qy, qz because otherwise glasses' axes are wrong
                // I don't actually know the reason, but I think it might have something to do with
                // the vector of the imu-left sensor pointing unexpected directions (see
                // https://facebookresearch.github.io/Aria_data_tools/docs/sensors-measurements/#coordinate-systems)
                // and the glasses' model's local axes not lining up with that vector
                this.quaternions[i] = new THREE.Quaternion(qy, qz, qx, qw);
            }
        }

        if (this.positions) {
            for (let i = 0; i < this.positions.length; i++) {
                const [x, y, z] = this.positions[i];
                this.positions[i] = new THREE.Vector3(y, 1, z);  // y and z for same reasons as above
            }
        }
    }

    init() {
        const disposer = this.disposer;
        const renderer = new THREE.WebGLRenderer();  // ({ canvas: this.canvas });
        renderer.setSize(this.width, this.height);

        renderer.domElement.style.float = "right";  // TODO: unhardcode this
        this.container.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xf0f0f0);

        // 1 to not render stuff too close to the camera, 50 to not render stuff far away from camera
        const camera = new THREE.PerspectiveCamera(45, this.aspect, 1, 50);
        camera.position.set(2, 4, 8);
        camera.zoom = 3;

        // allows rotating (left mouse), moving (right click), and zooming (scroll) the camera
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.maxPolarAngle = Math.PI / 2;

        const axes = new THREE.AxesHelper(500);  // red (x), green (y), blue (z) lines of the axes

        const grid = new THREE.GridHelper(1000, 1000);  // grid in the xz plane
        // slightly lower so that the axes lines render (otherwise the axes and grid collide)
        grid.position.y -= 0.001;

        const light = new THREE.AmbientLight(0xffffff); // soft white light

        scene.add(camera, axes, grid, light);
        disposer.add(renderer, scene, camera, controls, axes, grid, light);

        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.controls = controls;
        this.axes = axes;
        this.grid = grid;
        this.light = light;

        // load the glasses' model
        // glasses' model is from https://free3d.com/3d-model/frame-glasses-314946.html
        const loader = new GLTFLoader();
        loader.load(
            "models/glasses.glb",
            (gltf) => {  // called when the resource is loaded
                const glasses = gltf.scene;
                scene.add(glasses);
                disposer.add(glasses);
                this.glasses = glasses;
                this.animate();
            },
            undefined,  // called while loading is progressing
            (error) => console.error(error)  // called when loading has errors
        );
    }

    animate() {
        window.requestAnimationFrame(this.animate.bind(this));

        const factor = GraphIMU.interpolationFactor;

        const glasses = this.glasses;
        const camera = this.camera;

        // index of the data's time closest to the video's current time
        const index = Math.abs(binarySearch(this.timestamps, media.currentTime, (t1, t2) => t1 - t2));
        if (index > this.quaternions.length) { return; }  // prevent out of bounds errors

        // update glasses' orientation
        glasses.quaternion.slerp(this.quaternions[index], factor);  // rotate
        glasses.rotateZ(Math.PI / 2);  // rotate z 90 degrees for same reason as above

        // update glasses' position
        if (this.positions) {  // might not be visualizing positions
            const [x, y, z] = this.positions[index];  // new position

            const ogGlassesPosition = glasses.position.clone();
            const newGlassesPosition = this.positions[index];
            const positionChange = ogGlassesPosition.negate().add(newGlassesPosition).setY(0);
            const newCameraPosition = positionChange.add(camera.position);

            // move the glasses and camera
            glasses.position.lerp(newGlassesPosition, factor);
            // update camera position so that distance from glasses is maintained
            camera.position.lerp(newCameraPosition, factor);

            this.controls.target = newGlassesPosition;  // so that controls orbit around glasses at its new position
            this.controls.update();  // have to update controls after updating camera position
        }

        this.renderer.render(this.scene, camera);
    }

    dispose() { this.disposer.dispose(); }
}

export { GraphIMU };