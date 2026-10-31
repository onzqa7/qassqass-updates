// ES-module loader for the bundled three.js (app/lib/three, r169, MIT). Exposes window.THREE (+ addons under THREE.X)
// for the classic scripts (js/s3d*.js, js/ui_3d.js) and resolves GW.S3D's ready promise.
import * as T from '../lib/three/three.module.js';
import { GLTFLoader } from '../lib/three/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from '../lib/three/jsm/loaders/OBJLoader.js';
import { MTLLoader } from '../lib/three/jsm/loaders/MTLLoader.js';
import { FBXLoader } from '../lib/three/jsm/loaders/FBXLoader.js';
import { STLLoader } from '../lib/three/jsm/loaders/STLLoader.js';
import { PLYLoader } from '../lib/three/jsm/loaders/PLYLoader.js';
import { RoomEnvironment } from '../lib/three/jsm/environments/RoomEnvironment.js';
import { OrbitControls } from '../lib/three/jsm/controls/OrbitControls.js';
import { TransformControls } from '../lib/three/jsm/controls/TransformControls.js';
import { RectAreaLightUniformsLib } from '../lib/three/jsm/lights/RectAreaLightUniformsLib.js';
import { RectAreaLightHelper } from '../lib/three/jsm/helpers/RectAreaLightHelper.js';
import { RoundedBoxGeometry } from '../lib/three/jsm/geometries/RoundedBoxGeometry.js';
import * as SkeletonUtils from '../lib/three/jsm/utils/SkeletonUtils.js';
import { EffectComposer } from '../lib/three/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../lib/three/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../lib/three/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../lib/three/jsm/postprocessing/OutputPass.js';
import { BokehPass } from '../lib/three/jsm/postprocessing/BokehPass.js';

const THREE = Object.assign({}, T);
THREE.X = { GLTFLoader, OBJLoader, MTLLoader, FBXLoader, STLLoader, PLYLoader, RoomEnvironment, OrbitControls, TransformControls, RectAreaLightUniformsLib, RectAreaLightHelper, RoundedBoxGeometry, SkeletonUtils, EffectComposer, RenderPass, UnrealBloomPass, OutputPass, BokehPass };
try { RectAreaLightUniformsLib.init(); } catch (e) { console.warn('rect area lib', e); }
window.THREE = THREE;
if (window.GW && GW.S3D && GW.S3D._threeLoaded) GW.S3D._threeLoaded(THREE);
else window.__threeReady = THREE;
