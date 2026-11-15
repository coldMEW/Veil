# Face-swap detector evaluation (2026-11-14)

Candidate: `onnx-community/Deep-Fake-Detector-v2-Model-ONNX` (ViT-B/16, Apache-2.0, FP16, 172 MB), run with onnxruntime on 224x224 inputs.
Test data: 60 fake and 60 real faces sampled from the test split of `JamieWithofs/Deepfake-and-real-images` (public, likely close to the model's training distribution, so these numbers are optimistic), 10 face crops from our own real phone photos, and 12 face crops of the illustrated demo character.

| P(fake) threshold | Fakes caught (of 60) | Real sample faces flagged (of 60) | Our real photos flagged (of 10) |
|---|---|---|---|
| 0.50 | 48 | 4 | 2 |
| 0.85 | 34 | 2 | 1 |
| 0.90 | 19 | 2 | 0 |

Decision: not shipped. No threshold gives useful recall without flagging real people's photos, and a wrong "this is a deepfake of you" is worse than no answer. The stronger research detector (Self-Blended Images) is licensed for non-commercial research only and could not be redistributed.
Check therefore reports what can be shown from the file (signed AI labels, edits after signing, preview mismatch, changes from the original, the Veil mark) and treats the AI-image model score as a lead, not proof.
