import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const media = document.getElementById("media");
console.log(media.currentTime);

const [timestamps, quaternions] = await fetch("/aria/ccf5a3cc/quaternion.csv")
    .then(response => response.text())
    .then(text => {
        const rows = text.split("\n").map(row => row.split(","));
        const times = rows.map(row => row[0]);  // * 1000);  // convert to milliseconds
        const quats = rows.map(row => row.slice(1));
        return [times, quats];
    });

let rendererWidth = window.innerWidth - media.offsetWidth;
let rendererHeight = window.innerHeight;
let aspectRatio = rendererWidth / rendererHeight;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf0f0f0);

const renderer = new THREE.WebGLRenderer();
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.setSize(rendererWidth, rendererHeight);
renderer.domElement.style.float = "right";
document.body.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff); // soft white light
scene.add(ambientLight);

// const pointLight = new THREE.PointLight(0xffffff);
// pointLight.position.set(4, 8, 16);
// pointLight.castShadow = true;
// scene.add(pointLight);


const camera = new THREE.PerspectiveCamera(45, aspectRatio, 1, 1000);
camera.position.set(2, 4, 8);
scene.add(camera);
camera.zoom = 3;

const controls = new OrbitControls(camera, renderer.domElement);
controls.maxPolarAngle = Math.PI / 2;

const axes = new THREE.AxesHelper(20);
// const xColor = new THREE.Color(0xff0000);
// const yColor = new THREE.Color(0x00ff00);
// const zColor = new THREE.Color(0x0000ff);
// axes.setColors(xColor, yColor, zColor);
scene.add(axes);

// const axesRotated = new THREE.AxesHelper(20);
// axesRotated.rotation.set(0, Math.PI, 0);
// scene.add(axesRotated);
// renderer.render(scene, camera);

// let glasses = new THREE.ArrowHelper(
//     new THREE.Vector3(0, 1, 0),
//     new THREE.Vector3(0, 0, 0),
//     2, 0xffff00, 0.4, 0.16
// );
// glasses.setColor(0x990077);
// scene.add(glasses);

let arrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 0),
    2, 0xffff00, 0.4, 0.16
);
arrow.setColor(0x990077);
// arrow.position.x = -1;
// arrow.position.z = -3;
scene.add(arrow);

// const arrowAxes = new THREE.AxesHelper(20);
// arrow.add(arrowAxes);

let glasses;
const loader = new GLTFLoader();
loader.load(
    // https://free3d.com/3d-model/frame-glasses-314946.html
    "models/glasses.glb",  // resource URL
    function (gltf) {  // called when the resource is loaded
        // scene.remove(glasses);
        glasses = gltf.scene;
        // glasses.position.x = 1;
        // glasses.position.z = 2;
        // const glassesAxes = new THREE.AxesHelper(20);
        // glasses.add(glassesAxes);
        // glasses.up.set(0, 0, 1);
        scene.add(glasses);
    },
    undefined,  // called while loading is progressing
    function (error) {  // called when loading has errors
        console.error(error);
    }
)

// https://stackoverflow.com/a/29018745
function binarySearch(arr, val, compareFn) {
    var start = 0;
    var end = arr.length - 1;
    while (start <= end) {
        var mid = (start + end) >> 1;
        var cmp = compareFn(val, arr[mid]);
        if (cmp > 0) {
            start = mid + 1;
        } else if (cmp < 0) {
            end = mid - 1;
        } else {
            return mid;
        }
    }
    return -start - 1;
}
while (!glasses) { await new Promise(r => setTimeout(r, 250)); }
// const [w, x, y, z] = quaternions[1000]; const quaternion = new THREE.Quaternion(x, y, z, w);
// arrow.quaternion.slerp(quaternion, 0.99);
// glasses.quaternion.slerp(new THREE.Quaternion(-x, -z, -y, w), 0.99);
renderer.setAnimationLoop(() => {
    const index = Math.abs(binarySearch(timestamps, media.currentTime, (t1, t2) => t1 - t2));
    if (index < quaternions.length) {
        const [w, x, y, z] = quaternions[index];
        const curOrientQuat = new THREE.Quaternion(x, y, z, w);
        arrow.quaternion.slerp(curOrientQuat, 0.99);
        glasses.quaternion.slerp(new THREE.Quaternion(x, y, z, w), 0.99);
        glasses.rotateX(Math.PI / 2);
    }
    renderer.render(scene, camera);
});

window.addEventListener("resize", () => {
    rendererWidth = window.innerWidth - media.offsetWidth;
    rendererHeight = window.innerHeight;
    aspectRatio = rendererWidth / rendererHeight;
    camera.aspect = aspectRatio;
    camera.updateProjectionMatrix();
    renderer.setSize(rendererWidth, rendererHeight);
});