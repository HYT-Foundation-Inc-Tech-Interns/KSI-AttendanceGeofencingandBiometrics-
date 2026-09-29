# Face model weights

These are the face-api.js model weights, copied verbatim from
`@vladmandic/face-api@1.7.15` (`node_modules/@vladmandic/face-api/model/`).

They are committed rather than fetched from a CDN so that check-in keeps
working on a poor connection and does not depend on a third-party host staying
up. The browser loads them from `/models` at runtime.

| File | Size | Purpose |
| --- | --- | --- |
| `tiny_face_detector_model` | 0.18 MB | Finds the face in the frame |
| `face_landmark_68_model` | 0.34 MB | 68-point alignment, which the recogniser expects |
| `face_recognition_model` | 6.15 MB | Produces the 128-d descriptor |

Total: 6.7 MB. The recognition model dominates, and it is the one that must not
change casually — a different recognition model produces descriptors that are
not comparable with the ones already enrolled. The detector and landmark models
can be swapped (for example to `ssd_mobilenetv1` for better detection of small
or angled faces) without invalidating existing enrollments.

`face_landmark_68_model` is the full model rather than the `_tiny` variant:
the extra 0.27 MB buys better alignment, and alignment quality feeds directly
into descriptor quality.

## Refreshing

```sh
cd dashboard
npm install @vladmandic/face-api@<version>
cp node_modules/@vladmandic/face-api/model/{tiny_face_detector_model,face_landmark_68_model,face_recognition_model}-weights_manifest.json public/models/
cp node_modules/@vladmandic/face-api/model/{tiny_face_detector_model,face_landmark_68_model,face_recognition_model}.bin public/models/
```

If the recognition model is ever replaced, every existing enrollment becomes
unusable and employees must re-enrol — treat that as a breaking change and plan
it, rather than discovering it as a wave of failed check-ins.

## Licence

The weights come from face-api.js (MIT). See the `@vladmandic/face-api` package
for the current notice.
