"""Preflight and extract one History3D transport ZIP into an empty directory.

Usage: /usr/bin/python3 unpack_bundle.py INPUT.zip OUTPUT_DIR
The caller limits compressed upload bytes and owns the temporary directory.
"""

import hashlib
import json
import os
import pathlib
import stat
import sys
import zipfile

MAX_FILES = 500
MAX_UNCOMPRESSED = 256 * 1024 * 1024
MAX_GLB = 128 * 1024 * 1024


def safe_name(name):
    if not name or name.startswith("/") or "\\" in name or "\x00" in name:
        return False
    parts = name.rstrip("/").split("/")
    return all(part not in ("", ".", "..") for part in parts)


def check_glb_external_refs(filename, relpath, declared):
    with open(filename, "rb") as stream:
        header = stream.read(20)
        if len(header) < 20 or header[:4] != b"glTF" or int.from_bytes(header[4:8], "little") != 2:
            raise ValueError("invalid GLB header")
        json_len = int.from_bytes(header[12:16], "little")
        if header[16:20] != b"JSON" or json_len > 16 * 1024 * 1024:
            raise ValueError("invalid GLB JSON chunk")
        data = json.loads(stream.read(json_len).decode("utf-8"))
    for image in data.get("images", []):
        uri = image.get("uri")
        if not uri:
            continue
        if uri.startswith("data:"):
            continue
        if not safe_name(uri) or any(char in uri for char in ("%", "?", "#")) or ":" in uri.split("/")[0]:
            raise ValueError("external or unsafe texture reference")
        relative = pathlib.PurePosixPath(relpath).parent.joinpath(uri)
        if relative.as_posix() not in declared:
            raise ValueError("texture referenced by GLB missing from ZIP")
    for buffer in data.get("buffers", []):
        if buffer.get("uri"):
            raise ValueError("external GLB buffer reference")


def main():
    if len(sys.argv) != 3:
        raise SystemExit("expected ZIP and output directory")
    archive = pathlib.Path(sys.argv[1])
    destination = pathlib.Path(sys.argv[2])
    with zipfile.ZipFile(archive) as zipped:
        entries = [info for info in zipped.infolist() if not info.is_dir()]
        if len(entries) > MAX_FILES:
            raise ValueError("too many files")
        total = 0
        seen = set()
        for info in zipped.infolist():
            if not safe_name(info.filename):
                raise ValueError(f"unsafe path: {info.filename}")
            name = info.filename.rstrip("/")
            folded = name.casefold()
            if folded in seen:
                raise ValueError(f"duplicate path: {name}")
            seen.add(folded)
            mode = (info.external_attr >> 16) & 0xFFFF
            file_type = stat.S_IFMT(mode)
            if file_type not in (0, stat.S_IFREG, stat.S_IFDIR):
                raise ValueError(f"non-regular ZIP entry: {name}")
            if info.flag_bits & 1:
                raise ValueError("encrypted ZIP entry unsupported")
            if not info.is_dir():
                if info.filename.lower().endswith(".glb") and info.file_size > MAX_GLB:
                    raise ValueError("GLB exceeds 128 MiB")
                total += info.file_size
                if total > MAX_UNCOMPRESSED:
                    raise ValueError("uncompressed ZIP exceeds 256 MiB")
        if destination.exists() and any(destination.iterdir()):
            raise ValueError("destination must be empty")
        destination.mkdir(parents=True, exist_ok=True)
        manifest = []
        declared = {info.filename for info in entries}
        for info in entries:
            target = destination.joinpath(*info.filename.split("/"))
            target.parent.mkdir(parents=True, exist_ok=True)
            digest = hashlib.sha256()
            size = 0
            with zipped.open(info) as source, open(target, "xb") as output:
                while True:
                    chunk = source.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > info.file_size or size > MAX_UNCOMPRESSED:
                        raise ValueError("ZIP entry expanded beyond declared size")
                    output.write(chunk)
                    digest.update(chunk)
            if size != info.file_size:
                raise ValueError("ZIP entry size mismatch")
            manifest.append({"path": info.filename, "sha256": digest.hexdigest(), "bytes": size})
            if info.filename.lower().endswith(".glb"):
                check_glb_external_refs(target, info.filename, declared)
    print(json.dumps({"files": manifest, "uncompressedBytes": total}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, zipfile.BadZipFile, RuntimeError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        sys.exit(2)
