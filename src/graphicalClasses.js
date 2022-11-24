import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import globals from "./globals.js";
import { binarySearch } from "./util.js";

const media = globals.media;

/**
 * A `THREE` type that needs to be disposed of when no longer in use.
 * Many types from `THREE` don't free their resources automatically when no longer in use, and
 * instead need to be disposed of manually by calling a `dispose()` method and / or removing the
 * object from its parent. This type is a generic for such `THREE` types.
 * @typedef {any} Disposable
 */

/**
 * A `Set` that keeps track of disposable THREE elements.
 * @extends Set.<Disposable>
 */
var Disposer = class Disposer extends Set {

    /**
     * Adds `Disposable`s to this disposer.
     * This includes adding disposable properties of `disposable` and its children (if any).
     * Items are only added if they have a `dispose()` method and / or can be removed from
     * a parent.
     * @param {!Disposable|Array.<Disposable>} disposable - The `Disposable` item to add to this
     *      disposer. If `disposable` is an array of `Disposables`, each one is added.
     * @param  {...Disposable} disposables - Extra `Disposables` to add to this disposer. This
     *      allows passing in multiple items instead of having to call `add()` on each one
     *      individually.
     */
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

    /**
     * Disposes of the items in this disposer.
     * Calls `dispose()` on the items that define it and removes items from their parent if they
     * have one.
     */
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

/**
 * A `THREE` visualization of IMU pose data.
 * It renders a pair of glasses that move and rotate over time according to the pose data.
 */
var GraphIMU = class GraphIMU {

    // how close quat / pos is slerped / lerped towards the destination
    // can't use 1 for some reason because otherwise the object becomes invisible
    /**
     * How closely the glasses are rotated and moved to the quaternion and vector respectively.
     * Used in `animate()` to `slerp` and `lerp` the glasses. When it's set to 1, the glasses
     * become invisible after updating. Along with this, setting the glasses quaternion and vector
     * directly makes them invisible, which is why they need to be `slerp`ed and `lerp`ed.
     * @type {number}
     */
    static interpolationFactor = 0.999999;

    /**
     * The `Disposer` responsible for freeing the graph's resources when `dispose()` is called.
     * @type {!Disposer}
     */
    disposer;

    /**
     * The div element that the renderer's canvas element is appended to.
     * @type {!Element}
     */
    container;

    /**
     * The width of the renderer's canvas element.
     * @type {number}
     */
    width;

    /**
     * The height of the renderer's canvas element.
     * @type {number}
     */
    height;

    /**
     * The aspect ratio of the camera's video.
     * @type {number}
     */
    aspect;

    /**
     * The object responsible for rendering the scene.
     * Its canvas element is appended to `container` and is the actual graph seen in the interface.
     * @type {!THREE.WebGLRenderer}
     */
    renderer;

    /**
     * The scene that contains all other `THREE` objects.
     * @type {!THREE.Scene}
     */
    scene;

    /**
     * The camera whose video of the scene is rendered.
     * @type {!THREE.PerspectiveCamera}
     */
    camera;

    /**
     * The controls that allow rotating and moving the camera and zooming in and out.
     * Clicking and dragging the left mouse button rotates the camera. Clicking and dragging the
     * right mouse button moves the camera. Scrolling zooms in and out.
     * @type {!OrbitControls}
     */
    controls;

    /**
     * The 3 lines highlighting the directions.
     * The red line is the x axis, the green line is the y axis, and the blue line is the z axis.
     * @type {!THREE.AxesHelper}
     */
    axes;

    /**
     * The grid in the XZ plane.
     * @type {!THREE.GridHelper}
     */
    grid;

    /**
     * The ambient light that lights the objects in the scene.
     * @type {!THREE.AmbientLight}
     */
    light;

    /**
     * The glasses model displayed in the graph.
     * @type {!THREE.Group}
     */
    glasses;

    /**
     * The timestamps of the data.
     * @type {!Array.<number>}
     */
    timestamps;

    /**
     * The vectors representing the position of the glasses at a timestamp.
     * `null` if not visualizing the movement of the glasses.
     * @type {?Array.<THREE.Vector3>}
     */
    positions;

    /**
     * The quaternions representing the orientation of the glasses at a timestamp.
     * @type {!Array.<THREE.Quaternion>}
     */
    quaternions;

    /**
     * @param {!Element} container - The div element to append the graph's canvas to.
     * @param {!Array.<Array.<number>>} data - The pose data to visualize.
     * @param {?Object=} options - Options to customize the graph.
     * @param {number=} options.width - The width of the graph. If `null`, the width of
     *      `container` is used.
     * @param {number=} options.height - The height of the graph. If `null`, the height of
     *      `container` is used.
     * @param {number=} options.aspect - The aspect ratio of the graph. If `null`,
     *      `options.width / options.height` is used.
     */
    constructor(container, data, {
        width = undefined,
        height = undefined,
        aspect = undefined
    } = {}) {

        // this.canvas = canvas;
        this.container = container;

        this.width = width != undefined ? width : canvas.offsetWidth;
        this.height = height != undefined ? height : canvas.offsetHeight;
        this.aspect = aspect != undefined ? aspect : width / height;

        this.disposer = new Disposer();

        this.parseData(data);
        this.init();
    }

    /**
     * Parses the timestamps, quaternions, and positions (if any) from the pose data.
     * @param {!Array.<Array.<number>>} data - The pose data to visualize. The first entry in each
     *      array is the timestamp for the data in that row. Then, if the rows have length 5, the
     *      rest of the numbers are qw, qx, qy, and qz for the quaternions. If the rows have
     *      length 8, the next 3 items are x, y, and z for the positions, and the rest of
     *      the numbers are qw, qx, qy, and qz for the quaternions.
     * @throws {Error} If the row's of data have a length other than 5 or 8.
     */
    parseData(data) {
        // load the pose data from the CSV file. Columns are one of the following:
        // t x y z qw qx qy qz
        // t qw qx qy qz
        // where (x, y, z) is the position and (qx, qy, qz, qw) is the quaternion of the orientation

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

    /**
     * Initializes this graph.
     * This involves creating the THREE visualization and loading the glasses model.
     */
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

    /**
     * Updates this graph on every frame.
     * Rotates the glasses and (if there are positions) moves the glasses and camera.
     * The rotation and position are the quaternion and vector at the index of the
     * closest timestamp to the media's current time.
     */
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

    /** Disposes of this graph, freeing its resources. */
    dispose() { this.disposer.dispose(); }
}

export { GraphIMU };