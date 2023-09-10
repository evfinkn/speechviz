import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import globals from "./globals.js";
import { binarySearch } from "./util.js";

const media = globals.media;

/**
 * A `THREE` type that needs to be disposed of when no longer in use.
 * Many types from `THREE` don't free their resources automatically when no longer
 * in use, and instead need to be disposed of manually by calling a `dispose()` method
 * and / or removing the object from its parent. This type is a generic for such
 * `THREE` types.
 * @typedef {any} Disposable
 */

/**
 * A `Set` that keeps track of disposable THREE elements.
 * @extends Set.<Disposable>
 */
var Disposer = class Disposer extends Set {
  /**
   * Adds `Disposable`s to this disposer.
   * This includes adding disposable properties of `disposable` and its children
   * (if any). Items are only added if they have a `dispose()` method and / or can
   * be removed from a parent.
   * @param {!Disposable|Array.<Disposable>} disposable - The `Disposable` item to
   *      add to this disposer. If `disposable` is an array of `Disposables`, each
   *      one is added.
   * @param  {...Disposable} disposables - Extra `Disposables` to add to this disposer.
   *      This allows passing in multiple items instead of having to call `add()` on
   *      each one individually.
   */
  add(disposable, ...disposables) {
    if (disposables.length > 0) {
      disposables.forEach((d) => this.add(d));
    }
    if (disposable == undefined) {
      return;
    }
    if (Array.isArray(disposable)) {
      disposable.forEach((d) => this.add(d));
    }

    if (disposable instanceof THREE.Object3D) {
      // so that it's removed from its parent even if it's not disposable.dispose()
      super.add(disposable);
      this.add(disposable.geometry);
      this.add(disposable.material);
      this.add(disposable.children);
    } else if (disposable.dispose != undefined) {
      super.add(disposable);
    }
  }

  /**
   * Disposes of the items in this disposer.
   * Calls `dispose()` on the items that define it and removes items from their
   * parent if they have one.
   */
  dispose() {
    for (const disposable of this) {
      if (disposable.dispose) {
        disposable.dispose();
      }
      if (disposable instanceof THREE.Object3D && disposable.parent) {
        disposable.parent.remove(disposable);
      }
    }
    this.clear();
  }
};

/**
 * A `THREE` visualization of IMU pose data.
 * It renders a pair of glasses that move and rotate over time according to
 * the pose data.
 */
var GraphIMU = class GraphIMU {
  // how close quat / pos is slerped / lerped towards the destination
  // can't use 1 for some reason because otherwise the object becomes invisible
  /**
   * How closely the glasses are rotated and moved to the quaternion and vector
   * respectively. Used in `animate()` to `slerp` and `lerp` the glasses. When it's
   * set to 1, the glasses become invisible after updating. Along with this, setting
   * the glasses quaternion and vector directly makes them invisible, which is why
   * they need to be `slerp`ed and `lerp`ed.
   * @type {number}
   */
  static interpolationFactor = 0.999999;

  /**
   * The `Disposer` responsible for freeing the graph's resources when `dispose()`
   * is called.
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
   * Its canvas element is appended to `container` and is the actual graph seen
   * in the interface.
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
   * Clicking and dragging the left mouse button rotates the camera. Clicking and
   * dragging the right mouse button moves the camera. Scrolling zooms in and out.
   * @type {!OrbitControls}
   */
  controls;

  /**
   * Observes changes in the size of `container` and updates the visualization
   * to maintain the correct size and aspect ratio.
   * @type {ResizeObserver}
   */
  resizeObserver;

  /**
   * The 3 lines highlighting the directions.
   * The red line is the x axis, the green line is the y axis, and the blue line is
   * the z axis.
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
   * The number of pairs of glasses being visualized.
   * @type {number}
   */
  numGlasses;

  /**
   * The glasses model displayed in the graph.
   * @type {!Array.<THREE.Group>}
   */
  glasses;

  /**
   * The timestamps of the data.
   * @type {!Array.<Array.<number>>}
   */
  timestamps;

  /**
   * The vectors representing the position of the glasses at a timestamp.
   * `null` if not visualizing the movement of the glasses.
   * @type {?Array.<Array.<THREE.Vector3>>}
   */
  positions;

  /**
   * The quaternions representing the orientation of the glasses at a timestamp.
   * @type {!Array.<Array.<THREE.Quaternion>>}
   */
  quaternions;

  /**
   * @param {!Element} container - The div element to append the graph's canvas to.
   * @param {!Array.<Array.<number>>} data - The pose data to visualize.
   * @param {?Object=} options - Options to customize the graph.
   * @param {number=} options.width - The width of the graph. If `null`, the width of
   *      `container` is used.
   * @param {number=} options.height - The height of the graph. If `null`, the
   *      height of `container` is used.
   */
  constructor(container, data, { width = undefined, height = undefined } = {}) {
    this.container = container;

    this.width = width != undefined ? width : container.offsetWidth;
    this.height = height != undefined ? height : container.offsetHeight;
    this.aspect = width / height;

    this.disposer = new Disposer();

    // so that
    this.timestamps = [];
    this.positions = [];
    this.quaternions = [];
    this.glasses = [];

    this.parseData(data);
    this.init();
  }

  /**
   * Parses the timestamps, quaternions, and positions (if any) from the pose data.
   * @param {!Array.<Array.<Array.<number>>>} data - The pose data of each pair of
   *      glasses to visualize. Each array in the first axis represents a pair of
   *      glasses and that array holds the rows of the pose data. For example,
   *      if the length of `data` is 3, 3 pairs of glasses are being visualized.
   *      If only 1 pair of glasses is being visualized, you can pass a 2D array.
   *      The first entry in each row of pose data is the timestamp for the data in
   *      that row. Then, if the rows have length 5, the rest of the numbers are qw,
   *      qx, qy, and qz for the quaternions. If the rows have length 8, the next 3
   *      items are x, y, and z for the positions, and the rest of the numbers are qw,
   *      qx, qy, and qz for the quaternions. It is okay for some of the glasses to
   *      have position data and others to not, but all of the rows for a single pair
   *      must have the same length.
   * @throws {Error} If the rows of data have a length other than 5 or 8.
   */
  parseData(data) {
    // load the pose data from the CSV file. Columns are one of the following:
    // t x y z qw qx qy qz
    // t qw qx qy qz
    // where (x, y, z) is the position and (qx, qy, qz, qw)
    // is the quaternion of the orientation
    // use qy, qz, qx instead of qx, qy, qz because otherwise glasses' axes
    // are wrong I don't actually know the reason, but I think it might have
    // something to do with the vector of the imu-left sensor pointing unexpected
    // directions (see
    // https://facebookresearch.github.io/Aria_data_tools/docs/sensors-measurements/#coordinate-systems)
    // and the glasses' model's local axes not lining up with that vector
    // y and z for same reasons

    if (!Array.isArray(data?.[0]?.[0])) {
      data = [data];
    }
    const numGlasses = data.length;
    this.numGlasses = numGlasses;
    // index of imu that is in the center of the others (at the origin)
    // e.g. numGlasses = 9 -> centerIndex = (9 - 1) / 2 = 4, with 4 imus on each side
    // numGlasses = 4 -> centerIndex = 1.5, meaning no imu at the origin but the imus
    // but imu1 and imu2 are equidistant from it
    const centerIndex = (numGlasses - 1) / 2; // - 1 because indices start at 0
    // positions for imus without have position data (and therefore don't move in graph)
    const static_positions = [];
    for (let i = 0; i < numGlasses; i++) {
      // left of center is +x, right of center is -x
      // 3 to make each pair of glasses 3 units apart
      const position = new THREE.Vector3(-3 * (i - centerIndex), 0.5, 0);
      static_positions.push(position);
    }

    for (const [index, imu] of data.entries()) {
      const imu_timestamps = [];
      const imu_positions = [];
      const imu_quaternions = [];
      if (imu?.[0]?.length == 5) {
        imu.forEach((row) => {
          imu_timestamps.push(row[0]);
          const [qw, qx, qy, qz] = row.slice(1);
          imu_quaternions.push(new THREE.Quaternion(qy, qz, qx, qw));
        });
      } else if (imu?.[0]?.length == 8) {
        imu.forEach((row) => {
          imu_timestamps.push(row[0]);
          const [, y, z] = row.slice(1, 4);
          imu_positions.push(new THREE.Vector3(y, 1, z));
          const [qw, qx, qy, qz] = row.slice(4);
          imu_quaternions.push(new THREE.Quaternion(qy, qz, qx, qw));
        });
      } else {
        throw new Error("data must have either 5 or 8 columns.");
      }
      this.timestamps.push(imu_timestamps);
      this.quaternions.push(imu_quaternions);
      if (imu_positions.length == 0) {
        this.positions.push(static_positions[index]);
      } else {
        this.positions.push(imu_positions);
      }
    }
  }

  /**
   * Initializes this graph.
   * This involves creating the THREE visualization and loading the glasses model.
   */
  init() {
    const disposer = this.disposer;
    const renderer = new THREE.WebGLRenderer(); // ({ canvas: this.canvas });
    renderer.setSize(this.width, this.height);

    renderer.domElement.style.float = "right"; // TODO: unhardcode this
    this.container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);

    // 1 to not render stuff too close to the camera,
    // 75 to not render stuff far away from camera
    const camera = new THREE.PerspectiveCamera(50, this.aspect, 1, 75);
    camera.position.set(2, 4, 8);
    camera.zoom = 1.5;

    // allows rotating (left mouse), moving (right click),
    // and zooming (scroll) the camera
    const controls = new OrbitControls(camera, renderer.domElement);

    const resizeObserver = new ResizeObserver(() => {
      // - 10 because container has 5px margins on top and bottom
      this.width = this.container.clientWidth - 10;
      this.height = this.container.clientHeight - 10;
      this.aspect = this.width / this.height;
      renderer.setSize(this.width, this.height);
      camera.aspect = this.aspect;
      camera.updateProjectionMatrix();
      controls.update();
    }).observe(this.container);

    // red (x), green (y), blue (z) lines of the axes
    const axes = new THREE.AxesHelper(500);

    const grid = new THREE.GridHelper(1000, 1000); // grid in the xz plane
    // slightly lower so that the axes lines render
    // (otherwise the axes and grid collide)
    grid.position.y -= 0.001;

    const light = new THREE.AmbientLight(0xffffff); // soft white light

    scene.add(camera, axes, grid, light);
    disposer.add(renderer, scene, camera, controls, axes, grid, light);

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.controls = controls;
    this.resizeObserver = resizeObserver;
    this.axes = axes;
    this.grid = grid;
    this.light = light;

    // load the glasses' model
    // glasses' model is from https://free3d.com/3d-model/frame-glasses-314946.html
    const loader = new GLTFLoader();
    loader.load("models/glasses.glb", (gltf) => {
      let glasses = gltf.scene;
      // create glasses for each imu we're visualizing
      for (let i = 0; i < this.numGlasses; i++) {
        scene.add(glasses);
        disposer.add(glasses);
        if (!Array.isArray(this.positions[i])) {
          glasses.position.copy(this.positions[i]);
        }
        this.glasses.push(glasses);
        glasses = glasses.clone();
      }
      this.animate();
    });
  }

  /**
   * Updates this graph on every frame.
   * Rotates the glasses and (if there are positions) moves the glasses and camera.
   * The rotation and position are the quaternion and vector at the index of the
   * closest timestamp to the media's current time.
   */
  animate() {
    window.requestAnimationFrame(() => this.animate());

    const factor = GraphIMU.interpolationFactor;

    const glasses = this.glasses;
    const camera = this.camera;

    for (let i = 0; i < this.numGlasses; i++) {
      // index of the data's time closest to the video's current time
      const index = Math.abs(
        binarySearch(
          this.timestamps[i],
          media.currentTime,
          (t1, t2) => t1 - t2,
        ),
      );
      if (index >= this.quaternions[i].length) {
        return; // prevent out of bounds errors
      }
      // update glasses' orientation
      glasses[i].quaternion.slerp(this.quaternions[i][index], factor); // rotate
      glasses[i].rotateZ(Math.PI / 2); // rotate z 90 degrees for same reason as above

      if (Array.isArray(this.positions[i])) {
        glasses[i].position.lerp(this.positions[i][index], factor); // move
      }
    }

    this.renderer.render(this.scene, camera);
  }

  /** Disposes of this graph, freeing its resources. */
  dispose() {
    this.disposer.dispose();
    this.renderer.domElement.remove();
    this.resizeObserver.unobserve();
  }
};

export { GraphIMU };
