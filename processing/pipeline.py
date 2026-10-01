#!/usr/bin/env python3
"""Small, file-based historical scene handoff and optional Tripo generation."""
import argparse
import csv
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import shutil
import sys
import struct
import tempfile
from urllib.request import Request, urlopen

API = "https://api.tripo3d.ai/v2/openapi"
FIELDS = ["entity_id", "prompt", "task_id", "status", "model_path", "note"]


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def save_json(path, value):
    with atomic_file(Path(path), "w") as stream:
        stream.write(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def safe_id(value):
    return isinstance(value, str) and value and all(c.isascii() and (c.isalnum() or c in "_-") for c in value)


def validate(package):
    from contracts import validate_package
    return validate_package(package)


def request_json(method, path, payload=None):
    key = os.environ.get("TRIPO_API_KEY")
    if not key:
        raise RuntimeError("缺少 TRIPO_API_KEY")
    body = None if payload is None else json.dumps(payload).encode()
    req = Request(API + path, data=body, method=method, headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urlopen(req, timeout=30) as response:
        result = json.load(response)
    if result.get("code") != 0:
        raise RuntimeError(f"Tripo 返回错误: {result.get('code')} {result.get('message', '')}")
    return result["data"]


def rows_for(root):
    path = root / "experiments.csv"
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_rows(root, rows):
    with atomic_file(root / "experiments.csv", "w") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def select_model_url(output):
    for name in ("pbr_model", "model"):
        item = output.get(name)
        if isinstance(item, str) and item:
            return item
        if isinstance(item, dict) and item.get("url"):
            return item["url"]
    return None


@contextmanager
def atomic_file(destination, mode):
    destination = Path(destination)
    fd, temporary = tempfile.mkstemp(prefix="." + destination.name + ".", dir=destination.parent)
    try:
        options = {"encoding": "utf-8", "newline": ""} if "b" not in mode else {}
        with os.fdopen(fd, mode, **options) as stream:
            yield stream
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, destination)
        directory = os.open(destination.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextmanager
def package_lock(root):
    with (root / ".pipeline.lock").open("a") as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("场景包正由另一处理进程操作，请稍后重试")
        try:
            yield
        finally:
            fcntl.flock(stream, fcntl.LOCK_UN)


def download_model(url, destination):
    from urllib.parse import urlparse
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise RuntimeError("模型下载地址不是 HTTPS")
    with urlopen(Request(url), timeout=120) as response, atomic_file(destination, "w+b") as out:
        shutil.copyfileobj(response, out)
        validate_glb(out)


def validate_glb(source):
    if isinstance(source, (str, Path)):
        with Path(source).open("rb") as stream:
            return validate_glb(stream)
    source.seek(0, os.SEEK_END)
    size = source.tell()
    source.seek(0)
    header = source.read(12)
    if len(header) != 12:
        raise RuntimeError("模型缺少 GLB 头")
    magic, version, length = struct.unpack("<4sII", header)
    if magic != b"glTF" or version != 2 or length != size:
        raise RuntimeError("模型 GLB 标识、版本或长度无效")


def operate(args, parser, root):
    entities = {x["id"]: x for x in read_json(root / "entities.json")["entities"]}
    rows = rows_for(root)
    if args.command == "recover":
        if not args.entity or not safe_id(args.task_id):
            parser.error("recover 需要 --entity ID --task-id TASK_ID")
        pending = [r for r in rows if r["entity_id"] == args.entity and r["status"] in ("submitting", "submit_unknown")]
        if len(pending) != 1:
            parser.error("该实体必须恰有一个提交状态不明的记录")
        if any(r["task_id"] == args.task_id for r in rows):
            parser.error("此任务 ID 已关联记录")
        task = request_json("GET", "/task/" + args.task_id)
        if task.get("task_id") and task["task_id"] != args.task_id:
            raise RuntimeError("返回的任务 ID 不匹配")
        pending[0].update(task_id=args.task_id, status="queued", note="人工关联已知任务；下一次 sync 获取结果")
        write_rows(root, rows)
        return 0
    if args.command == "submit":
        if not args.confirm_cost or not args.entity:
            parser.error("submit 需要 --entity ID --confirm-cost")
        if args.entity not in entities:
            parser.error("未知实体 ID")
        prompt = entities[args.entity].get("generation_prompt")
        if not prompt or len(prompt) > 1024:
            parser.error("该实体需要 1–1024 字符的 generation_prompt")
        if any(r["entity_id"] == args.entity and r["status"] not in ("failed", "cancelled", "canceled") for r in rows):
            parser.error("该实体已有任务；先 sync，提交状态不明时用 recover 关联任务，禁止重复提交")
        if not os.environ.get("TRIPO_API_KEY"):
            raise RuntimeError("缺少 TRIPO_API_KEY；尚未提交任务")
        row = dict(entity_id=args.entity, prompt=prompt, task_id="", status="submitting", model_path="", note="提交意图已保存；中断后需人工查找任务 ID")
        rows.append(row)
        write_rows(root, rows)
        try:
            task = request_json("POST", "/task", {"type": "text_to_model", "prompt": prompt})
            if not safe_id(task.get("task_id")):
                raise RuntimeError("API 未返回有效任务 ID")
            row.update(task_id=task["task_id"], status="queued", note="")
        except Exception:
            row.update(status="submit_unknown", note="提交结果未知；请在 Tripo 查找任务后用 recover 关联，勿重复付费提交")
            write_rows(root, rows)
            raise
        write_rows(root, rows)
        print(f"已提交 {args.entity}: {row['task_id']}")
        return 0
    scene = read_json(root / "scene.json")
    failures = 0
    for row in rows:
        if row["status"] in ("submitting", "submit_unknown"):
            print(row["entity_id"], row["status"], "需要 recover", file=sys.stderr)
            failures += 1
            continue
        if row["status"] in ("failed", "cancelled", "canceled"):
            continue
        try:
            if not safe_id(row["task_id"]) or row["entity_id"] not in entities:
                raise RuntimeError("任务或实体 ID 无效")
            relative = f"assets/{row['entity_id']}-{row['task_id']}.glb"
            # Scene is persisted before the success row: a crash leaves a retryable row.
            local_ready = False
            if row["status"] in ("success", "download_pending") and row.get("model_path") == relative:
                try:
                    validate_glb(root / relative)
                    local_ready = True
                except (OSError, RuntimeError):
                    row["model_path"] = ""
                    row["status"] = "download_pending"
            if not local_ready:
                task = request_json("GET", "/task/" + row["task_id"])
                status = task.get("status", "unknown")
                row["status"] = status
                if status == "success":
                    row["status"] = "download_pending"
                    url = select_model_url(task.get("output") or {})
                    if not url:
                        raise RuntimeError("任务成功但缺少 GLB 链接；下次 sync 将重新查询")
                    (root / "assets").mkdir(exist_ok=True)
                    download_model(url, root / relative)
                    row["model_path"] = relative
                elif status not in ("queued", "running"):
                    row["note"] = str(task.get("message") or task.get("error") or "请检查 Tripo 任务")
            if row.get("model_path") == relative and (root / relative).is_file() and row["status"] in ("success", "download_pending"):
                for placement in scene["placements"]:
                    if placement["entity_id"] == row["entity_id"]:
                        placement["candidate_asset"] = relative
                save_json(root / "scene.json", scene)
                row.update(status="success", note="已下载；尺寸、朝向、接地和历史外观仍需人工验收")
        except Exception as exc:
            # Persist each task separately so one failed transfer does not lose other progress.
            row["note"] = f"同步失败（{type(exc).__name__}）；下次 sync 可重试"
            failures += 1
            print(row["entity_id"], row["note"], file=sys.stderr)
        write_rows(root, rows)
        print(row["entity_id"], row["status"])
    return 1 if failures else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["validate", "submit", "sync", "recover"])
    parser.add_argument("package", type=Path)
    parser.add_argument("--task-id", help="recover 时关联的已知 Tripo 任务 ID")
    parser.add_argument("--entity", help="submit 时要生成的实体 ID")
    parser.add_argument("--confirm-cost", action="store_true", help="确认提交付费 Tripo 任务")
    args = parser.parse_args()
    root = args.package.resolve()
    if args.command == "sync":
        from contracts import validate_package
        errors = validate_package(root, allow_missing_candidate=True)
    else:
        errors = validate(root)
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    if args.command == "validate":
        print("场景包校验通过")
        return 0
    with package_lock(root):
        return operate(args, parser, root)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, KeyError) as exc:
        print(f"错误: {exc}", file=sys.stderr)
        sys.exit(1)
