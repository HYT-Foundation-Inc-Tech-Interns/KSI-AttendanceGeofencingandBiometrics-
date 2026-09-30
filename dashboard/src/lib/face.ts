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
 *
 * ---------------------------------------------------------------------------
 * Why this file is fussy about capture quality
 *
 * Live data showed an employee's account accepting a *different* person's face
 * at a match score of 0.51. Measured against real photographs, that should be
 * impossible: two clean captures of the same person sit 0.05-0.20 apart and two
 * different people sit 0.86-0.92 apart -- a gap of more than four times. The
 * only way to land in the middle is for one of the two captures to be bad.
 *
 * So the fix is not "lower the threshold and hope". It is to refuse to build a
 * descriptor from a frame that cannot support one, and to average several good
 * frames so the vector is stable. Measured degradation effects (640x480,
 * inputSize 416, three-frame burst):
 *
 *   condition             distance to own enrolment   distance to a stranger
 *   clean                 0.05                        0.87
 *   dim                   0.11                        0.89
 *   far (face ~1/4 frame) 0.12                        0.91
 *   sensor noise          0.26                        0.88
 *   low-res 0.15x         0.23                        0.90
 *   low-res 0.10x         0.41                        0.91
 *   heavy blur            no detection at all
 *
 * Note which way that moves: degradation pushes the *genuine* distance up and
 * leaves the impostor distance alone. A bad capture therefore causes false
 * rejections, never false accepts. That is what makes a tight server-side
 * threshold safe, and it is why the gates below are tuned to avoid turning away
 * a real employee rather than to chase impostors -- the threshold does that.
 */

/** Where the vendored weights are served from. */
const MODEL_URI = '/models';

/** How many floats the recognition model emits. Mirrors FACE_DESCRIPTOR_LENGTH on the server. */
export const FACE_DESCRIPTOR_LENGTH = 128;

/**
 * Detector resolution.
 *
 * 416 rather than face-api's default 320, because 320 could not see a face that
 * filled less than about a third of the frame. Measured at 640x480:
 *
 *   face fills   detected at 320      detected at 416
 *   0.18         no                   yes, score 0.763
 *   0.25         yes, score 0.548     yes, score 0.788
 *   0.40         yes, score 0.830     yes, score 0.868
 *   1.00         yes, score 0.828     yes, score 0.996
 *
 * Detection is the gate everything else sits behind, so a face the detector
 * cannot see is a face the worker cannot check in with. 416 costs about 1.7x
 * the detector's work -- still well inside a phone's frame budget.
 */
const DETECTOR_INPUT_SIZE = 416;

/**
 * Score the *live framing indicator* accepts, and the floor the detector itself
 * reports at. Kept low so the overlay can reassure the worker early; the real
 * bar is MIN_DETECTION_SCORE below.
 */
const DETECTOR_SCORE_THRESHOLD = 0.6;

/**
 * Score a descriptor may be built from. Stricter than the indicator, because a
 * marginal detection produces a marginal vector.
 *
 * Measured at inputSize 416, a real face scores 0.763-0.997 -- 0.65 clears the
 * weakest observed case by a wide margin. A frame that cannot reach 0.65 is one
 * where the face is genuinely hard to see, and the honest answer is to ask for
 * better light rather than to send the server a vector built from guesswork.
 */
const MIN_DETECTION_SCORE = 0.65;

/**
 * The face box must cover at least this fraction of the frame's shorter side.
 *
 * The recognition model reads a 112x112 patch, so a small face is upscaled and
 * its descriptor comes out noisy. Measured at inputSize 416, a face filling
 * about a quarter of the frame lands at ratio 0.264 and still yields a clean
 * 0.12 same-person distance, so 0.20 refuses only faces too small to describe.
 */
const MIN_FACE_FRAME_RATIO = 0.2;

/*
 * Geometry gates.
 *
 * The 68-point landmark model always returns 68 points, whatever it is given --
 * aim it at a collarbone and it will fit them there. So the presence of
 * landmarks proves nothing; their *arrangement* does. A real face keeps the
 * eyes a fairly fixed fraction of the box apart, the nose below the eyes, the
 * mouth below the nose, and the landmark cloud covering most of the box.
 *
 * Measured on real photographs across framing, brightness, rotation, JPEG
 * quality and low-resolution conditions, a real face stays inside these bands
 * with a wide margin:
 *
 *   eye distance / box width   0.275 - 0.401   (bounds 0.20 - 0.55)
 *   landmark width  / box       0.652 - 0.946   (bounds 0.55 - 0.95)
 *   landmark height / box       0.673 - 1.014   (bounds 0.55 - 0.95)
 *   eye line, down the box      0.153 - 0.286   (bounds 0.05 - 0.55)
 *   mouth, down the box         0.455 - 0.596   (bounds 0.30 - 0.95)
 *
 * The landmark *upper* bound is the one that earns its place, and it was found
 * by measurement rather than assumed. A face held too close, cropped to eyes
 * and nose, produced landmarks whose cloud was 101% of the box height -- the
 * model fitting points outside the detection box, which cannot happen for a
 * well-fitted face. It cleared every other gate, and its descriptor sat 0.347
 * from the same person's clean enrolment, against 0.074-0.099 for a good
 * capture. Every legitimate capture measured stayed at or below 0.946 wide and
 * 0.881 tall, so 0.95 refuses the bad fit with room to spare.
 *
 * The eye-line and mouth bounds are the ones that answer "make sure only a face
 * is accepted". A partial-face fit moves the eye line or the mouth out of that
 * band. The detector does not fire on a neck, a chest or a logo at all (0 faces
 * in every case), so these are cheap defence-in-depth against the partial fit
 * rather than a response to a measured failure, and are set wide precisely so
 * they cannot turn away a real face.
 */
const MIN_EYE_OVER_BOX = 0.2;
const MAX_EYE_OVER_BOX = 0.55;
const MIN_LANDMARK_COVERAGE = 0.55;
const MAX_LANDMARK_COVERAGE = 0.95;
const MIN_EYE_BOX_Y = 0.05;
const MAX_EYE_BOX_Y = 0.55;
const MIN_MOUTH_BOX_Y = 0.3;
const MAX_MOUTH_BOX_Y = 0.95;

/*
 * A descriptor is averaged over a burst of frames.
 *
 * One frame carries whatever motion blur and sensor noise happened at that
 * instant. Averaging three spread over ~0.4s cancels most of it and pulls the
 * same-person distance towards the 0.05 the model is capable of, which is what
 * makes a tight server-side threshold safe to enforce. Frames that fail a gate
 * are dropped rather than averaged in, and one weak frame in three is tolerated
 * because that is normal for a hand-held phone.
 */
const DESCRIPTOR_SAMPLES = 3;
const SAMPLE_INTERVAL_MS = 200;
const MIN_DESCRIPTOR_SAMPLES = 2;

/*
 * The face frame that gets filed alongside the punch.
 *
 * This is a record for a human to look at, not an input to verification --
 * the descriptor above is what decides anything. It exists because "distance
 * 0.539 exceeded the maximum of 0.450" tells an administrator nothing about
 * whether the person standing at the gate was actually the employee, and a
 * picture of who was there does.
 *
 * Cropped rather than full-frame: a 640x480 frame of a car park with a small
 * face in it is both useless and a much larger privacy footprint than the face
 * itself. The crop is squared around the detection box and padded, so the
 * result reads as a face rather than as a tight rectangle of skin.
 */
const FRAME_PAD_RATIO = 0.35;
const FRAME_OUTPUT_SIZE = 200;
const FRAME_QUALITY = 0.72;

/**
 * Encoded length the client will not exceed.
 *
 * The server caps `captureImage` at 400,000 characters and rejects the *whole
 * check-in* when a field is too long. A thumbnail must never be the reason
 * someone cannot clock in, so the client aims well under that and treats
 * anything oversized as "no image" rather than sending it.
 */
const FRAME_BUDGET_CHARS = 250_000;

/**
 * Progressively cheaper encodings, tried in order.
 *
 * The first is the normal case at roughly 8-12 KB. The others exist because a
 * noisy low-light frame compresses badly, and because a very large crop (a
 * face close to the lens) carries more detail than a small one.
 */
const FRAME_ENCODINGS: ReadonlyArray<{ size: number; quality: number }> = [
  { size: FRAME_OUTPUT_SIZE, quality: FRAME_QUALITY },
  { size: 160, quality: 0.6 },
  { size: 128, quality: 0.5 },
];

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
      /**
       * The face as a small JPEG data URL, for the attendance record.
       *
       * null when the crop could not be produced (no 2D context, canvas
       * blocked) or could not be squeezed into the budget. Never a reason to
       * fail a capture: the descriptor is the part that matters.
       */
      captureImage: string | null;
    }
  | { ok: false; reason: FaceCaptureFailure; message: string };

/** Live framing reading for the camera overlay. */
export type FaceReading = {
  count: number;
  score: number;
  /**
   * null when a capture taken right now would be accepted; otherwise the same
   * sentence a capture would fail with. The overlay and the capture share every
   * gate, so "Face detected" means the button will work rather than merely that
   * something face-shaped is in shot.
   */
  problem: string | null;
};

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
 * The detector and landmark nets are small (0.19 MB and 0.34 MB). The
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

const NO_FACE_MESSAGE =
  'No face found. Hold the phone at eye level and fill the frame with your face.';
const MULTIPLE_FACES_MESSAGE =
  'More than one face is visible. Make sure only you are in the frame.';
const DIM_MESSAGE =
  'The picture is not clear enough. Move closer, into better light, and hold still.';
const TOO_FAR_MESSAGE = 'Move closer, so your face fills the oval.';
const NOT_A_FACE_MESSAGE =
  'That does not look like a face. Point the camera at your face, not another part of you.';
const INCOMPLETE_MESSAGE = 'Face reading was incomplete. Please try again.';

type Point = { x: number; y: number };

type Box = { x: number; y: number; width: number; height: number };

function meanPoint(points: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/** Landmarks plus a detection box, as the geometry gates need them. */
type Landmarks68 = {
  getLeftEye(): Point[];
  getRightEye(): Point[];
  getNose(): Point[];
  getMouth(): Point[];
  positions: Point[];
};

/**
 * Does this detection actually look like a face, and is it framed usefully?
 *
 * Returns a sentence for the user when it does not, or null when it is
 * acceptable. Kept as one function so the live overlay and the capture can
 * never disagree about whether a frame is good.
 */
function validateFaceGeometry(landmarks: Landmarks68, box: Box): string | null {
  const leftEye = meanPoint(landmarks.getLeftEye());
  const rightEye = meanPoint(landmarks.getRightEye());
  const nose = meanPoint(landmarks.getNose());
  const mouth = meanPoint(landmarks.getMouth());

  const eyeDistance = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y);
  const eyeRatio = eyeDistance / box.width;

  if (eyeRatio < MIN_EYE_OVER_BOX || eyeRatio > MAX_EYE_OVER_BOX) {
    return NOT_A_FACE_MESSAGE;
  }

  // Eyes above nose above mouth. If that does not hold, these are not face
  // landmarks.
  if (!(leftEye.y < nose.y && nose.y < mouth.y)) {
    return NOT_A_FACE_MESSAGE;
  }

  const xs = landmarks.positions.map((p) => p.x);
  const ys = landmarks.positions.map((p) => p.y);
  const spreadWidth = Math.max(...xs) - Math.min(...xs);
  const spreadHeight = Math.max(...ys) - Math.min(...ys);

  if (
    spreadWidth / box.width < MIN_LANDMARK_COVERAGE ||
    spreadHeight / box.height < MIN_LANDMARK_COVERAGE
  ) {
    return NOT_A_FACE_MESSAGE;
  }

  // The landmark cloud spilling out of the detection box means the two models
  // disagree about where the face is -- a fit to something that is not a face.
  if (
    spreadWidth / box.width > MAX_LANDMARK_COVERAGE ||
    spreadHeight / box.height > MAX_LANDMARK_COVERAGE
  ) {
    return NOT_A_FACE_MESSAGE;
  }

  // Where the features sit inside the detection box. A real face keeps its eye
  // line in the upper part of the box and its mouth in the lower part; a fit
  // that has slipped off the box does not.
  const eyeY = ((leftEye.y + rightEye.y) / 2 - box.y) / box.height;
  const mouthY = ((mouth.y + nose.y) / 2 - box.y) / box.height;

  if (eyeY < MIN_EYE_BOX_Y || eyeY > MAX_EYE_BOX_Y) {
    return NOT_A_FACE_MESSAGE;
  }
  if (mouthY < MIN_MOUTH_BOX_Y || mouthY > MAX_MOUTH_BOX_Y) {
    return NOT_A_FACE_MESSAGE;
  }

  return null;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Crop the detected face out of the current frame as a JPEG data URL.
 *
 * Geometry: the detection box is squared around its centre and padded, then
 * clamped inside the video. The square is *slid* back into range rather than
 * shrunk, so a face near an edge produces a full-size crop of a face that is
 * off-centre, not a small crop of a face that is centred. It is also capped at
 * the frame's shorter side, so a face close enough to overflow the frame still
 * yields a square rather than a stretched one.
 *
 * The frame is deliberately NOT mirrored, even though the on-screen preview is
 * (the video element in the check-in page carries `scaleX(-1)`).
 *
 * The two are split on purpose. A worker expects a selfie preview to behave
 * like a mirror -- field testers reported the raw feed as "inverted", because
 * raising a hand moves it the wrong way on screen. But `drawImage` reads the
 * raw video frame, which no CSS transform can reach, so what gets filed is the
 * true orientation: how another person sees the employee. That is the one the
 * administrator's actual question -- "is this the person we enrolled?" --
 * needs, and it is the same frame the descriptor is computed from.
 *
 * This cannot weaken verification. Mirroring is a display concern: a flipped
 * face is still the same face, and enrolment and check-in are both captured
 * through this one un-mirrored path, so they always agree with each other.
 */
function cropFaceFrame(video: HTMLVideoElement, box: Box): string | null {
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  if (!videoWidth || !videoHeight) return null;

  const side = Math.min(
    Math.max(box.width, box.height) * (1 + FRAME_PAD_RATIO * 2),
    Math.min(videoWidth, videoHeight)
  );
  if (!(side > 0)) return null;

  const left = Math.min(
    Math.max(box.x + box.width / 2 - side / 2, 0),
    videoWidth - side
  );
  const top = Math.min(
    Math.max(box.y + box.height / 2 - side / 2, 0),
    videoHeight - side
  );

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null;
  try {
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d');
  } catch {
    return null;
  }
  if (!ctx) return null;

  for (const encoding of FRAME_ENCODINGS) {
    canvas.width = encoding.size;
    canvas.height = encoding.size;

    /*
     * Painted opaque first. A JPEG has no alpha channel, so a transparent
     * canvas would come out with black patches wherever the source had none --
     * which reads as a broken image rather than as a photograph.
     */
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, encoding.size, encoding.size);
    ctx.drawImage(
      video,
      left,
      top,
      side,
      side,
      0,
      0,
      encoding.size,
      encoding.size
    );

    let encoded: string;
    try {
      encoded = canvas.toDataURL('image/jpeg', encoding.quality);
    } catch {
      return null;
    }

    if (encoded.startsWith('data:image/jpeg') && encoded.length <= FRAME_BUDGET_CHARS) {
      return encoded;
    }
  }

  // Every encoding was still too big. Filing no picture beats failing a
  // check-in over a thumbnail.
  return null;
}

type FrameOk = {
  ok: true;
  score: number;
  box: Box;
  /** Only populated when the caller asked for it; the live overlay does not. */
  descriptor: number[] | null;
};
type FrameBad = { ok: false; reason: FaceCaptureFailure; message: string };
type FrameSample = FrameOk | FrameBad;

/**
 * Apply every gate to one detection.
 *
 * Split out so the descriptor and no-descriptor paths share exactly the same
 * checks -- the live overlay and the capture must never disagree about whether
 * a frame is good.
 */
function gateFrame(
  video: HTMLVideoElement,
  detection: { box: Box; score: number },
  landmarks: Landmarks68,
  descriptor: number[] | null
): FrameSample {
  const { box, score } = detection;

  if (score < MIN_DETECTION_SCORE) {
    return { ok: false, reason: 'low_quality', message: DIM_MESSAGE };
  }

  /*
   * Too far from the camera. A small face yields a noisy descriptor, and a
   * noisy descriptor is how an unreliable comparison reaches the server.
   */
  const frameRatio = box.width / Math.min(video.videoWidth, video.videoHeight);
  if (frameRatio < MIN_FACE_FRAME_RATIO) {
    return { ok: false, reason: 'low_quality', message: TOO_FAR_MESSAGE };
  }

  const geometryProblem = validateFaceGeometry(landmarks, box);
  if (geometryProblem) {
    return { ok: false, reason: 'low_quality', message: geometryProblem };
  }

  if (descriptor) {
    // The server validates this too; catching it here turns a 400 into a clear
    // message instead of a round trip.
    if (descriptor.length !== FACE_DESCRIPTOR_LENGTH) {
      return { ok: false, reason: 'low_quality', message: INCOMPLETE_MESSAGE };
    }
  }

  return {
    ok: true,
    score,
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
    descriptor,
  };
}

/**
 * Read one frame and run every gate over it.
 *
 * One detector pass serves both the "how many faces" check and the landmark
 * fit, rather than detecting once to count and again to measure. The
 * recognition net is only invoked when a descriptor is actually wanted, since
 * it is by far the most expensive of the three models.
 */
async function readFrame(
  api: FaceApi,
  video: HTMLVideoElement,
  wantDescriptor: boolean
): Promise<FrameSample> {
  const options = detectorOptions();
  const chained = api.detectAllFaces(video, options).withFaceLandmarks();

  if (!wantDescriptor) {
    const results = await chained;
    if (results.length === 0) {
      return { ok: false, reason: 'no_face', message: NO_FACE_MESSAGE };
    }
    if (results.length > 1) {
      return { ok: false, reason: 'multiple_faces', message: MULTIPLE_FACES_MESSAGE };
    }
    return gateFrame(video, results[0].detection, results[0].landmarks, null);
  }

  const results = await chained.withFaceDescriptors();

  // Count first, so two people in frame is reported as that rather than as a
  // confusing quality failure.
  if (results.length === 0) {
    return { ok: false, reason: 'no_face', message: NO_FACE_MESSAGE };
  }
  if (results.length > 1) {
    return { ok: false, reason: 'multiple_faces', message: MULTIPLE_FACES_MESSAGE };
  }

  const first = results[0];
  if (!first.descriptor) {
    return { ok: false, reason: 'low_quality', message: DIM_MESSAGE };
  }

  return gateFrame(
    video,
    first.detection,
    first.landmarks,
    Array.from(first.descriptor)
  );
}

/**
 * Live framing reading for the camera overlay.
 *
 * Runs the same gates as a capture, minus the descriptor, so the overlay can
 * tell the worker *why* a frame is not usable while there is still time to fix
 * it -- rather than only after they press the button. The recognition net is
 * deliberately not run here; it is by far the most expensive of the three and
 * this polls on a short interval.
 */
export async function detectFaces(video: HTMLVideoElement): Promise<FaceReading> {
  const empty: FaceReading = { count: 0, score: 0, problem: null };
  if (!faceApi) return empty;
  if (!video.videoWidth) return empty;

  try {
    const frame = await readFrame(faceApi, video, false);

    if (frame.ok) {
      return { count: 1, score: frame.score, problem: null };
    }
    if (frame.reason === 'multiple_faces') {
      return { count: 2, score: 0, problem: frame.message };
    }
    return { count: 0, score: 0, problem: frame.message };
  } catch {
    // A failed poll is not worth surfacing; the next one will retry.
    return empty;
  }
}

/**
 * Compute a descriptor from the current camera frame.
 *
 * Requires exactly one face: with two people in frame there is no way to know
 * whose descriptor to take, and silently picking the larger one would let
 * someone else's face be enrolled or verified.
 *
 * The descriptor is averaged over a burst of frames, so a single unlucky
 * instant cannot decide the result.
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

  const samples: number[][] = [];
  let bestScore = 0;
  let bestBox: Box | null = null;
  let bestCrop: string | null = null;
  let firstFailure: FrameBad | null = null;

  for (let i = 0; i < DESCRIPTOR_SAMPLES; i += 1) {
    if (i > 0) await delay(SAMPLE_INTERVAL_MS);

    const frame = await readFrame(api, video, true);

    if (!frame.ok) {
      /*
       * A framing problem is reported straight away -- making someone hold
       * still for three frames when nobody is in shot is just a longer wait for
       * the same answer. A single weak frame is tolerated, since one blurred
       * frame among several good ones is normal.
       */
      if (frame.reason === 'no_face' || frame.reason === 'multiple_faces') {
        return frame;
      }
      if (!firstFailure) firstFailure = frame;
      continue;
    }

    if (frame.descriptor) samples.push(frame.descriptor);

    /*
     * The crop is taken here, in the same instant as the box it describes,
     * rather than after the loop. Cropping from a later frame would pair the
     * picture with a rectangle from an earlier one -- a face that has moved in
     * between would be cut off by its own bounding box.
     */
    if (frame.score >= bestScore) {
      bestScore = frame.score;
      bestBox = frame.box;
      bestCrop = cropFaceFrame(video, frame.box);
    }
  }

  if (samples.length < MIN_DESCRIPTOR_SAMPLES || !bestBox) {
    return (
      firstFailure ?? {
        ok: false,
        reason: 'low_quality',
        message: DIM_MESSAGE,
      }
    );
  }

  const averaged = new Array<number>(FACE_DESCRIPTOR_LENGTH).fill(0);
  for (const sample of samples) {
    for (let i = 0; i < FACE_DESCRIPTOR_LENGTH; i += 1) {
      averaged[i] += sample[i];
    }
  }
  for (let i = 0; i < FACE_DESCRIPTOR_LENGTH; i += 1) {
    averaged[i] /= samples.length;
  }

  return {
    ok: true,
    descriptor: averaged,
    detectionScore: bestScore,
    box: bestBox,
    captureImage: bestCrop,
  };
}
