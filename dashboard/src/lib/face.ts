'use client';

/*
 * On-device face descriptors.
 *
 * The phone computes a 128-d vector from the camera frame and sends only that
 * vector. Two reasons this beats uploading the photo:
 *
 *  - Privacy. A descriptor cannot be turned back into a picture of someone's
 *    face, so the server never holds a biometric image.
 *  - Bandwidth. A descriptor is ~128 numbers; a JPEG frame is tens of
 *    kilobytes. That matters on a field worker's mobile data.
 *
 * The comparison itself deliberately does NOT happen here. A client that
 * decided its own verdict could simply answer "match". This module's only job
 * is to produce a vector; the server decides what it means.
 *
 * The model weights are vendored into `public/models` rather than fetched from
 * a CDN, so check-in keeps working on a poor connection and the app does not
 * depend on a third-party host staying up.
 */

/** Where the vendored weights are served from. */
const MODEL_URI = '/models';

/** How many floats the recognition model emits. Mirrors FACE_DESCRIPTOR_LENGTH on the server. */
export const FACE_DESCRIPTOR_LENGTH = 128;

/**
 * Detection tuning.
 *
 * `inputSize` 320 is the accuracy/speed compromise face-api documents for the
 * tiny detector: enough resolution to frame a face that fills the viewfinder,
 * while staying fast enough to run on a mid-range phone every second or so.
 * `scoreThreshold` is left at the library default of 0.5.
 */
const DETECTOR_INPUT_SIZE = 320;
const DETECTOR_SCORE_THRESHOLD = 0.5;

/**
 * Below this the frame is not worth sending: either the face is too small,
 * badly lit, or turned away, and a descriptor computed from it would be noise.
 * This is a UX gate -- the server applies its own distance threshold to
 * whatever it receives.
 */
const MIN_DETECTION_SCORE = 0.6;

export type FaceCaptureFailure =
  | 'model_unavailable'
  | 'no_face'
  | 'multiple_faces'
  | 'low_quality';

export type FaceCaptureResult =
  | {
      ok: true;
      descriptor: number[];
      detectionScore: number;
      box: { x: number; y: number; width: number; height: number };
    }
  | { ok: false; reason: FaceCaptureFailure; message: string };

/*
 * `face-api` is imported dynamically, and only ever from the browser.
 *
 * It pulls in TensorFlow.js, which touches `document` and `navigator` as it
 * initialises. A static top-level import would drag all of that into the
 * module graph of a page that Next prerenders at build time, which fails the
 * export. Importing inside the functions keeps it strictly client-side.
 */
type FaceApi = typeof import('@vladmandic/face-api');

let faceApi: FaceApi | null = null;
let loading: Promise<FaceApi> | null = null;

/**
 * How long a single step of the load may take before it is treated as failed.
 *
 * Generous, because a field worker on a poor connection may legitimately need a
 * while for 6.8 MB -- but finite, because without it a stalled transfer leaves
 * the UI saying "Preparing face recognition..." indefinitely, with no way for
 * the user to tell "still arriving" from "never going to arrive".
 */
const MODEL_LOAD_TIMEOUT_MS = 60_000;

function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out. Check your connection and try again.`));
    }, MODEL_LOAD_TIMEOUT_MS);

    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Load the three models this flow needs.
 *
 * Idempotent: concurrent callers share one load, and a second call after
 * success returns immediately. A *failed* load clears the cached promise so a
 * retry is possible -- otherwise one flaky download would disable face
 * capture for the rest of the session.
 *
 * The detector and landmark nets are small (0.18 MB and 0.34 MB). The
 * recognition net is 6.15 MB and dominates the wait, which is why the UI
 * shows progress rather than looking frozen.
 */
export async function loadFaceModels(): Promise<FaceApi> {
  if (faceApi) return faceApi;
  if (loading) return loading;

  loading = (async () => {
    const api = await withTimeout(
      import('@vladmandic/face-api'),
      'Loading the face recognition library'
    );

    await withTimeout(
      api.nets.tinyFaceDetector.loadFromUri(MODEL_URI),
      'Loading the face detector'
    );
    await withTimeout(
      api.nets.faceLandmark68Net.loadFromUri(MODEL_URI),
      'Loading the face landmark model'
    );
    await withTimeout(
      api.nets.faceRecognitionNet.loadFromUri(MODEL_URI),
      'Loading the face recognition model'
    );

    faceApi = api;
    return api;
  })();

  try {
    return await loading;
  } catch (error) {
    loading = null;
    throw error;
  }
}

export function areFaceModelsReady(): boolean {
  return faceApi !== null;
}

function detectorOptions() {
  if (!faceApi) throw new Error('Face models are not loaded yet');
  return new faceApi.TinyFaceDetectorOptions({
    inputSize: DETECTOR_INPUT_SIZE,
    scoreThreshold: DETECTOR_SCORE_THRESHOLD,
  });
}

/**
 * Count faces in the frame and report the best detection's score.
 *
 * Used for the live "you are framed" indicator, so it runs on a short
 * interval and stays cheap.
 */
export async function detectFaces(
  video: HTMLVideoElement
): Promise<{ count: number; score: number }> {
  if (!faceApi) return { count: 0, score: 0 };
  if (!video.videoWidth) return { count: 0, score: 0 };

  const detections = await faceApi.detectAllFaces(video, detectorOptions());
  const score = detections.reduce(
    (best, detection) => Math.max(best, detection.score),
    0
  );

  return { count: detections.length, score };
}

/**
 * Compute a descriptor from the current camera frame.
 *
 * Requires exactly one face: with two people in frame there is no way to know
 * whose descriptor to take, and silently picking the larger one would let
 * someone else's face be enrolled or verified.
 */
export async function captureFaceDescriptor(
  video: HTMLVideoElement
): Promise<FaceCaptureResult> {
  if (!video.videoWidth) {
    return {
      ok: false,
      reason: 'no_face',
      message: 'The camera is not showing a picture yet. Give it a moment and try again.',
    };
  }

  let api: FaceApi;
  try {
    api = await loadFaceModels();
  } catch {
    return {
      ok: false,
      reason: 'model_unavailable',
      message:
        'Face recognition could not be loaded. Check your connection and reload the page.',
    };
  }

  const options = detectorOptions();

  // Count first, so two people in frame is reported as that rather than as a
  // confusing quality failure.
  const allFaces = await api.detectAllFaces(video, options);

  if (allFaces.length === 0) {
    return {
      ok: false,
      reason: 'no_face',
      message: 'No face found. Hold the phone at eye level and fill the frame with your face.',
    };
  }

  if (allFaces.length > 1) {
    return {
      ok: false,
      reason: 'multiple_faces',
      message: 'More than one face is visible. Make sure only you are in the frame.',
    };
  }

  const detection = await api
    .detectSingleFace(video, options)
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection?.descriptor) {
    return {
      ok: false,
      reason: 'low_quality',
      message: 'Could not read your face clearly. Move to better light and hold still.',
    };
  }

  if (detection.detection.score < MIN_DETECTION_SCORE) {
    return {
      ok: false,
      reason: 'low_quality',
      message: 'The picture is not clear enough. Move closer and hold still.',
    };
  }

  const { box } = detection.detection;
  const descriptor = Array.from(detection.descriptor);

  // The server validates this too; catching it here turns a 400 into a clear
  // message instead of a round trip.
  if (descriptor.length !== FACE_DESCRIPTOR_LENGTH) {
    return {
      ok: false,
      reason: 'low_quality',
      message: 'Face reading was incomplete. Please try again.',
    };
  }

  return {
    ok: true,
    descriptor,
    detectionScore: detection.detection.score,
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
  };
}
