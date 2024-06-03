import Papa from "papaparse";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { binarySearch } from "./util.js";

/**
 * @typedef {Object} RectangleObject
 * @property {number} time - The time the rectangle is visible.
 * @property {number} group - The group the rectangle belongs to.
 * @property {number} color - The color of the rectangle.
 * @property {number} x1 - The x coordinate of the top left corner of the rectangle.
 * @property {number} y1 - The y coordinate of the top left corner of the rectangle.
 * @property {number} z1 - The z coordinate of the top left corner of the rectangle.
 * @property {number} x2 - The x coordinate of the bottom right corner of the rectangle.
 * @property {number} y2 - The y coordinate of the bottom right corner of the rectangle.
 * @property {number} z2 - The z coordinate of the bottom right corner of the rectangle.
 */

const video = document.getElementById("video");

/**
 * Loads a GLTF model from a URL.
 * @param {string} url - The URL of the GLTF model to load.
 * @returns {Promise<THREE.Group>} A promise that resolves with the loaded GLTF model.
 *     The promise is rejected if the model fails to load.
 */
const loadGLTF = (url) => {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => resolve(gltf.scene), undefined, reject);
  });
};

/**
 * Returns the vertices of a rectangle.
 * @param {RectangleObject} rect - The rectangle to get the vertices of.
 * @returns {Array.<number>} The vertices of the rectangle.
 */
const rectVerts = (rect) => {
  const { x1, y1, z1, x2, y2, z2 } = rect;
  // const topLeft = new THREE.Vector3(x1, y1, z1);
  // const bottomRight = new THREE.Vector3(x2, y2, z2);
  // const topRight = new THREE.Vector3(x2, y1, z1);
  // const bottomLeft = new THREE.Vector3(x1, y2, z2);
  // return [topLeft, topRight, bottomRight, bottomLeft];
  return [x1, y1, z1, x2, y1, z1, x2, y2, z2, x1, y2, z2];
};

const createNewRect = () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();

  const positions = new Float32Array(12);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const material = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    side: THREE.DoubleSide,
  });

  return new THREE.Mesh(geometry, material);
};

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
var Visualizer = class Visualizer {
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
   * The glasses model displayed in the graph.
   * @type {!THREE.Group}
   */
  glasses;

  /**
   * @type {[number, THREE.Quaternion]}
   */
  orientations;

  /**
   * @type {Array.<RectangleObject>}
   */
  rectangles;

  vectors;

  /**
   * @type {Array.<THREE.Mesh>}
   */
  drawnRects = [];

  /** @type {boolean} */
  hasOrientations = false;

  /** @type {boolean} */
  hasRectangles = false;

  /** @type {boolean} */
  hasVectors = false;

  /**
   * @param {!Element} container - The div element to append the graph's canvas to.
   * @param {!Array.<Array.<number>>} orientations - The pose data to visualize.
   * @param {!Array.<Array.<any>>} rectangles - The rectangles to visualize.
   * @param {!Array.<Array.<any>>} vectors - The vectors to visualize.
   * @param {?Object=} options - Options to customize the graph.
   * @param {number=} options.width - The width of the graph. If `null`, the width of
   *      `container` is used.
   * @param {number=} options.height - The height of the graph. If `null`, the
   *      height of `container` is used.
   */
  constructor(
    container,
    // orientations,
    { width = undefined, height = undefined } = {},
  ) {
    this.container = container;

    // this.width = width != undefined ? width : container.offsetWidth;
    // this.height = height != undefined ? height : container.offsetHeight;
    this.width = 800;
    this.height = 800;
    this.aspect = width / height;

    this.disposer = new Disposer();

    // if (orientations !== undefined) {
    //   this.orientations = [];
    //   for (const [t, qw, qx, qy, qz] of orientations) {
    //     this.orientations.push([t, new THREE.Quaternion(qx, qy, qz, qw)]);
    //   }
    //   this.hasOrientations = true;
    // }

    // if (rectangles !== undefined) {
    // }

    this.init();
  }

  /**
   * Initializes this graph.
   * This involves creating the THREE visualization and loading the glasses model.
   */
  async init() {
    const disposer = this.disposer;
    const renderer = new THREE.WebGLRenderer(); // ({ canvas: this.canvas });
    renderer.setSize(this.width, this.height);

    renderer.domElement.style.float = "right";
    this.container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);

    // 1 to not render stuff too close to the camera,
    // 75 to not render stuff far away from camera
    const camera = new THREE.PerspectiveCamera(undefined, this.aspect);
    camera.position.set(2, 4, 8);
    camera.zoom = 1.5;

    // allows rotating (left mouse), moving (right click),
    // and zooming (scroll) the camera
    const controls = new OrbitControls(camera, renderer.domElement);

    const resizeObserver = new ResizeObserver(() => {
      this.width = this.container.clientWidth;
      this.height = this.container.clientHeight;
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

    // load the glasses' model
    // glasses' model is from https://free3d.com/3d-model/frame-glasses-314946.html
    // const loader = new GLTFLoader();
    // loader.load("models/glasses.glb", (gltf) => {
    //   const glasses = gltf.scene;
    //   scene.add(glasses);
    //   disposer.add(glasses);
    //   glasses.position.set(0, 0, 0);
    //   this.glasses = glasses;
    //   this.animate();
    // });

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

    await this.loadOrientations();
    await this.loadRectangles();
    await this.loadVectors();

    if (this.hasOrientations) {
      const glasses = await loadGLTF("models/glasses.glb");
      glasses.position.set(0, 0, 0);
      scene.add(glasses);
      disposer.add(glasses);
      this.glasses = glasses;
    }

    this.animate();
  }

  async loadOrientations() {
    // placeholder
  }

  async loadRectangles() {
    return fetch("/graphical/output/faces_grouped.csv", { cache: "no-cache" })
      .then((response) => response.text())
      .then((csv) => {
        this.rectangles = Papa.parse(csv, {
          header: true,
          dynamicTyping: true,
        }).data;
        if (this.rectangles.at(-1)?.time === null) this.rectangles.pop();
        this.hasRectangles = true;
      })
      .catch(console.error);
  }

  async loadVectors() {
    // placeholder
  }

  updateOrientations() {
    const factor = Visualizer.interpolationFactor;

    // index of the data's time closest to the video's current time
    const index = Math.abs(
      binarySearch(
        this.orientations,
        video.currentTime,
        (val, [time]) => val - time,
      ),
    );
    // prevent out of bounds errors
    if (index < this.quaternions.length) {
      // update glasses' orientation
      this.glasses.quaternion.slerp(this.quaternions[index], factor); // rotate
    }
  }

  updateRectangles() {
    const drawnRects = this.drawnRects;
    const currentTime = video.currentTime;

    let rects = {};
    for (const r of this.rectangles) {
      if (
        r.time >= currentTime &&
        r.time - currentTime <= 0.1 &&
        rects[r.group] === undefined
      ) {
        rects[r.group] = r;
      }
    }
    // We don't need the keys anymore (we needed them to check if the group was
    // already added)
    rects = Object.values(rects);

    while (rects.length > drawnRects.length) {
      const mesh = createNewRect();
      this.scene.add(mesh);
      drawnRects.push(mesh);
    }

    let i = 0; // we need i later so initialize it outside the loop
    for (; i < rects.length; i++) {
      const rect = rects[i];
      const vertices = rectVerts(rect);
      const mesh = drawnRects[i];
      const positionAttr = mesh.geometry.getAttribute("position");

      positionAttr.set(vertices);
      positionAttr.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.material.color.set(rect.color);
      mesh.visible = true;
    }

    for (; i < drawnRects.length; i++) {
      drawnRects[i].visible = false;
    }
  }

  updateVectors() {}

  /**
   * Updates this graph on every frame.
   * Rotates the glasses and (if there are positions) moves the glasses and camera.
   * The rotation and position are the quaternion and vector at the index of the
   * closest timestamp to the media's current time.
   */
  animate() {
    window.requestAnimationFrame(() => this.animate());
    if (this.hasOrientations) this.updateOrientations();
    if (this.hasRectangles) this.updateRectangles();
    if (this.hasVectors) this.updateVectors();
    this.renderer.render(this.scene, this.camera);
  }

  /** Disposes of this graph, freeing its resources. */
  dispose() {
    this.disposer.dispose();
    this.renderer.domElement.remove();
    this.resizeObserver.unobserve();
  }
};

const container = document.getElementById("container");
const visualizer = new Visualizer(container, undefined, {
  width: 800,
  height: 800,
});
console.log(visualizer);

video.addEventListener("keydown", function (e) {
  if (e.key === " ") e.stopPropagation();
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") e.preventDefault();
});
document.addEventListener("keydown", function (e) {
  if (e.key === ".") {
    video.currentTime += 0.1;
  } else if (e.key === ",") {
    video.currentTime -= 0.1;
  } else if (e.key === "ArrowRight") {
    video.currentTime += 1;
  } else if (e.key === "ArrowLeft") {
    video.currentTime -= 1;
  } else if (e.key === " ") {
    if (video.paused) video.play();
    else video.pause();
  }
});
