import type { FaceBox } from '../../features/inspect/warp/warpTypes';

/**
 * The FALdetector was trained on dlib face boxes widened by width/2.5 left, right and below and
 * width/1.5 above (utils/tools.py, face_detection). People draw a tight box (eyebrows to chin,
 * ear to ear); this widens it the same way so the model sees the crop geometry it was trained on.
 * Measured on an unedited phone selfie: a tight box gave a 8.2 px peak, the widened box 3.3 px.
 */
export function widenToTrainingCrop(tight: FaceBox, imageWidth: number, imageHeight: number): FaceBox {
  const w = tight.w * imageWidth;
  const left = Math.max(0, tight.x * imageWidth - w / 2.5);
  const top = Math.max(0, tight.y * imageHeight - w / 1.5);
  const right = Math.min(imageWidth, (tight.x + tight.w) * imageWidth + w / 2.5);
  const bottom = Math.min(imageHeight, (tight.y + tight.h) * imageHeight + w / 2.5);
  return { x: left / imageWidth, y: top / imageHeight, w: (right - left) / imageWidth, h: (bottom - top) / imageHeight };
}
