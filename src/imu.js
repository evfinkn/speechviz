import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import Stats from 'three/addons/libs/stats.module.js';

const FILE_ID = "b903d8ed";  // "ccf5a3cc";

const media = document.getElementById("media");  // the element of the video

// load the glasses' rotations
const [quatTimes, quaternions] = await fetch(`/aria/${FILE_ID}/quaternion.csv`)
    .then(response => response.text())
    .then(text => {
        const rows = text.split("\n").map(row => row.split(","));
        const times = rows.map(row => parseFloat(row[0]));
        const quats = rows.map(row => row.slice(1).map(n => parseFloat(n)));
        return [times, quats];
    });
// load the glasses' positions
const positions = await fetch(`/aria/${FILE_ID}/position.csv`)
    .then(response => response.text())
    .then(text => {
        const rows = text.split("\n").map(row => row.split(","));
        return rows.map(row => row.slice(1).map(n => parseFloat(n)));
        // return pos.map(([x, y, z]) => [x * 100, y * 100, z * 100]);
    });

// const [posTimes, positions] = await fetch(`/aria/${FILE_ID}/gps-position.csv`)
//     .then(response => response.text())
//     .then(text => {
//         const rows = text.split("\n").map(row => row.split(","));
//         const times = rows.map(row => parseFloat(row[0]));
//         const pos = rows.map(row => row.slice(1).map(n => parseFloat(n)));
//         return [times, pos];
//     });

let rendererWidth = window.innerWidth - media.offsetWidth;
let rendererHeight = window.innerHeight;
let aspectRatio = rendererWidth / rendererHeight;

const stats = new Stats();  // shows the FPS
document.body.appendChild(stats.dom);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf0f0f0);

const renderer = new THREE.WebGLRenderer();
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.setSize(rendererWidth, rendererHeight);
renderer.domElement.style.float = "right";  // show renderer to the right of the video
document.body.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff); // soft white light
scene.add(ambientLight);

// const pointLight = new THREE.PointLight(0xffffff);
// pointLight.position.set(4, 8, 16);
// pointLight.castShadow = true;
// scene.add(pointLight);

// 1 to not render stuff too close to the camera, 50 to not render stuff far away from camera
const camera = new THREE.PerspectiveCamera(45, aspectRatio, 1, 50);
scene.add(camera);
camera.position.set(2, 4, 8);
camera.zoom = 3;

// allows rotating (left mouse), moving (right click), and zooming (scroll) the camera
const controls = new OrbitControls(camera, renderer.domElement);
controls.maxPolarAngle = Math.PI / 2;

// red (x), green (y), blue (z) lines of the axes
const axes = new THREE.AxesHelper(500);
scene.add(axes);

// grid in the xz plane
const grid = new THREE.GridHelper(1000, 1000);
// slightly lower so that the axes lines render (otherwise the axes and grid collide)
grid.position.y -= 0.001;
scene.add(grid);

// let glasses = new THREE.ArrowHelper(  // use arrow for glasses while the model is loading
//     new THREE.Vector3(0, 0, 1),
//     new THREE.Vector3(0, 0, 0),
//     2, 0xffff00, 0.4, 0.16
// );
// glasses.setColor(0x990077);  // set to darker color so more visible against background
// scene.add(glasses);

let glasses;
const loader = new GLTFLoader();
loader.load(  // load the glasses' model
    // https://free3d.com/3d-model/frame-glasses-314946.html
    "models/glasses.glb",  // resource URL
    function (gltf) {  // called when the resource is loaded
        // scene.remove(glasses);  // remove the temporary arrow
        glasses = gltf.scene;
        scene.add(glasses);
    },
    undefined,  // called while loading is progressing
    function (error) {  // called when loading has errors
        console.error(error);
    }
)

// https://stackoverflow.com/a/29018745
function binarySearch(arr, val, compareFn) {
    let start = 0;
    let end = arr.length - 1;
    while (start <= end) {
        let mid = (start + end) >> 1;
        let cmp = compareFn(val, arr[mid]);

        if (cmp > 0) { start = mid + 1; }
        else if (cmp < 0) { end = mid - 1; } 
        else { return mid; }
    }
    return -start - 1;
}

while (!glasses) { await new Promise(r => setTimeout(r, 250)); }  // wait for glasses model to load

// how close quat / pos is slerped / lerped towards the destination
// can't use 1 for some reason because otherwise the object becomes invisible
const interpolationFactor = 0.999999;

renderer.setAnimationLoop(() => {  // run on every frame
    // index of the data's time closest to the video's current time
    const index = Math.abs(binarySearch(quatTimes, media.currentTime, (t1, t2) => t1 - t2));
    // check to make sure in bounds (otherwise out of bounds error when video has ended)
    if (index < quaternions.length) {
        // update glasses' orientation
        let [w, x, y, z] = quaternions[index];
        // use y, z, x instead of x, y, z because otherwise glasses' axes are wrong (idk why)
        glasses.quaternion.slerp(new THREE.Quaternion(y, z, x, w), interpolationFactor);  // rotate
        glasses.rotateZ(Math.PI / 2);  // rotate z 90 degrees for same reason as above

        // update glasses' position
        const [x0, y0, z0] = glasses.position;  // save current position so can calculate pos change
        [x, y, z] = positions[index];  // new position
        // y and z instead of x and z for same reason as above (I really don't know why, something wacky)
        const newPosition = new THREE.Vector3(y, 1, z);
        glasses.position.lerp(newPosition, interpolationFactor);  // move

        controls.target = newPosition;  // so that controls orbit around glasses at its new position
        
        // update camera position so that distance from glasses is maintained
        const [camx, camy, camz] = camera.position;
        const [dx, dy, dz] = [y - x0, x - y0, z - z0];  // glasses' change in position
        camera.position.lerp(new THREE.Vector3(camx + dx, camy, camz + dz), interpolationFactor);  // move
        
        controls.update();  // have to update controls after updating camera position
        stats.update();  // update stats (which updates the FPS counter)
    }

    renderer.render(scene, camera);  // render changes
});

window.addEventListener("resize", () => {  // update the renderer size when window is resized
    rendererWidth = window.innerWidth - media.offsetWidth;
    rendererHeight = window.innerHeight;
    aspectRatio = rendererWidth / rendererHeight;
    camera.aspect = aspectRatio;
    camera.updateProjectionMatrix();
    renderer.setSize(rendererWidth, rendererHeight);
});