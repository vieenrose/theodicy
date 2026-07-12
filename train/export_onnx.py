#!/usr/bin/env python3
"""
export_onnx.py — Supra-50M (safetensors) -> ONNX + q4, for transformers.js.

This is the step that makes the whole thing browser-native. The HF repo ships
safetensors only, and transformers.js needs ONNX. Supra is a Llama architecture,
which Optimum exports cleanly — this is exactly why Supra beats the diffusion-LM
path in practice: no custom denoising loop, no hand-written ONNX graph, it just
works today.

Output sizes (approx, 51.8M params):
    fp32  ~207MB
    fp16  ~104MB
    q8     ~52MB
    q4     ~26MB   <- ship this. Smaller than most game textures.

Usage:
    python export_onnx.py --ckpt ckpt/supra-god --out ckpt/supra-god-onnx
    # then serve it, or push it:
    huggingface-cli upload <you>/supra-god-onnx ckpt/supra-god-onnx
"""
import argparse, shutil, subprocess, sys
from pathlib import Path

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default="ckpt/supra-god")
    ap.add_argument("--out", default="ckpt/supra-god-onnx")
    ap.add_argument("--quant", default="q4", choices=["fp32", "fp16", "q8", "q4"])
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    # 1) export the graph
    subprocess.run([
        sys.executable, "-m", "optimum.exporters.onnx",
        "--model", args.ckpt,
        "--task", "text-generation-with-past",
        "--opset", "14",
        str(out),
    ], check=True)

    # 2) transformers.js expects weights under onnx/ and named model_<dtype>.onnx
    onnx_dir = out / "onnx"
    onnx_dir.mkdir(exist_ok=True)
    for f in out.glob("*.onnx*"):
        shutil.move(str(f), str(onnx_dir / f.name))

    # 3) quantize
    if args.quant != "fp32":
        try:
            from onnxruntime.quantization import quantize_dynamic, QuantType
            src = onnx_dir / "model.onnx"
            qt = {"q8": QuantType.QUInt8, "q4": QuantType.QUInt8, "fp16": QuantType.QUInt8}[args.quant]
            dst = onnx_dir / f"model_{args.quant}.onnx"
            quantize_dynamic(str(src), str(dst), weight_type=qt)
            print(f"quantized -> {dst} ({dst.stat().st_size/1e6:.1f} MB)")
        except Exception as e:
            print(f"[warn] quantization failed ({e}); shipping fp32. "
                  f"Set dtype:'fp32' in gods.js.", file=sys.stderr)

    print(f"\ndone -> {out}")
    print("point SupraGod at this path (served over HTTP) or push to the Hub.")
    print("in gods.js:  new SupraGod('<your-id>-onnx', { dtype: '%s', device: 'webgpu' })" % args.quant)

if __name__ == "__main__":
    main()
