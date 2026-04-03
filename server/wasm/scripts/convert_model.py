#!/usr/bin/env python3
import json
import os
import struct
import sys
import urllib.request

BASE_URL = "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights"
MANIFEST_FILE = "age_gender_model-weights_manifest.json"
SHARD_FILE = "age_gender_model-shard1"

CACHE_DIR = os.path.join(os.path.dirname(__file__), "..", "build", "models")


def download(filename):
    dest = os.path.join(CACHE_DIR, filename)
    if os.path.exists(dest):
        return dest
    os.makedirs(CACHE_DIR, exist_ok=True)
    url = f"{BASE_URL}/{filename}"
    print(f"[convert] Downloading {filename}...")
    urllib.request.urlretrieve(url, dest)
    return dest


def extract_weights():
    manifest_path = download(MANIFEST_FILE)
    shard_path = download(SHARD_FILE)

    with open(manifest_path) as f:
        manifest = json.load(f)

    with open(shard_path, "rb") as f:
        shard = f.read()

    offset = 0
    floats = []

    for group in manifest:
        for weight in group["weights"]:
            shape = weight["shape"]
            count = 1
            for dim in shape:
                count *= dim

            quant = weight.get("quantization")
            if quant and quant.get("dtype") == "uint8":
                scale = quant["scale"]
                minimum = quant["min"]
                raw = struct.unpack_from(f"{count}B", shard, offset)
                values = [v * scale + minimum for v in raw]
                floats.extend(values)
                offset += count
            else:
                values = struct.unpack_from(f"<{count}f", shard, offset)
                floats.extend(values)
                offset += count * 4

    return floats


def generate_c_file(floats, output_path):
    data = struct.pack(f"<{len(floats)}f", *floats)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    with open(output_path, "w") as f:
        f.write("#include <stdint.h>\n\n")
        f.write("const unsigned char AGE_MODEL_DATA[] = {\n")

        for i in range(0, len(data), 16):
            chunk = data[i : i + 16]
            hex_vals = ",".join(f"0x{b:02x}" for b in chunk)
            f.write(f"  {hex_vals},\n")

        f.write("};\n\n")
        f.write(f"const int AGE_MODEL_DATA_LEN" f" = {len(data)};\n")

    print(
        f"[convert] Generated {output_path}"
        f" ({len(floats)} floats, {len(data)} bytes)"
    )


def main():
    output = (
        sys.argv[1]
        if len(sys.argv) > 1
        else os.path.join(
            os.path.dirname(__file__),
            "..",
            "build",
            "age_model_data.c",
        )
    )
    floats = extract_weights()
    generate_c_file(floats, output)


if __name__ == "__main__":
    main()
