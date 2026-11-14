"""Rebuild public/models/fal/fal-local-drn.onnx from the FALdetector local detector.

Upstream: https://github.com/PeterWang512/FALdetector (Apache-2.0), Wang et al., ICCV 2019.
Steps: clone the pinned upstream revision, download local.pth and verify its SHA-256, load it with
weights_only=True (no pickle code execution), export DRNSeg(2) to ONNX (opset 17, dynamic H/W),
check PyTorch-vs-ONNX parity on the upstream examples, and print the SHA-256 to compare with
src/features/inspect/warp/models.json.

Usage (from the repo root, in an isolated venv with requirements.txt installed):
    python scripts/export/fal/export_fal.py
"""
import hashlib, os, subprocess, sys, tempfile, urllib.request

REV = '64e44e868fcb213da264a616b89d87ec27116049'
WEIGHTS_URL = 'https://www.dropbox.com/s/pby9dhpr6cqziyl/local.pth?dl=1'
WEIGHTS_SHA = 'f4413d59e61f6ecb2960263385e3b17e248acd3d1db4575666c0a02d121c7aaa'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(ROOT, 'public', 'models', 'fal', 'fal-local-drn.onnx')


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    work = tempfile.mkdtemp(prefix='fal-export-')
    src = os.path.join(work, 'src')
    subprocess.run(['git', 'clone', '-q', 'https://github.com/PeterWang512/FALdetector.git', src], check=True)
    subprocess.run(['git', '-C', src, 'checkout', '-q', REV], check=True)
    weights = os.path.join(work, 'local.pth')
    urllib.request.urlretrieve(WEIGHTS_URL, weights)
    if sha256(weights) != WEIGHTS_SHA:
        sys.exit('local.pth checksum mismatch; refusing to export')

    import numpy as np, torch, onnxruntime as ort
    from PIL import Image
    sys.path.insert(0, src)
    from networks.drn_seg import DRNSeg

    model = DRNSeg(2)
    model.load_state_dict(torch.load(weights, map_location='cpu', weights_only=True)['model'])
    model.eval()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    torch.onnx.export(model, torch.randn(1, 3, 400, 528), OUT, input_names=['image'], output_names=['flow'],
                      dynamic_axes={'image': {2: 'h', 3: 'w'}, 'flow': {2: 'h', 3: 'w'}}, opset_version=17, dynamo=False)

    mean = np.array([0.485, 0.456, 0.406], np.float32)
    std = np.array([0.229, 0.224, 0.225], np.float32)
    sess = ort.InferenceSession(OUT, providers=['CPUExecutionProvider'])
    for name in ('modified.jpg', 'original.jpg'):
        im = Image.open(os.path.join(src, 'examples', name)).convert('RGB')
        w, h = im.size
        size = (400, int(400 * h / w)) if w < h else (int(400 * w / h), 400)
        x = ((np.asarray(im.resize(size, Image.BICUBIC), np.float32) / 255 - mean) / std).transpose(2, 0, 1)[None]
        x = np.ascontiguousarray(x)
        with torch.no_grad():
            ref = model(torch.from_numpy(x)).numpy()
        got = sess.run(None, {'image': x})[0]
        mag = np.sqrt((got[0] ** 2).sum(0))
        print(f'{name}: max |torch - onnx| {np.abs(ref - got).max():.1e}, warp max {mag.max():.2f} px')
    print('wrote', OUT)
    print('sha256', sha256(OUT), 'bytes', os.path.getsize(OUT))


if __name__ == '__main__':
    main()
