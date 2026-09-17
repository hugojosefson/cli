/** @module Dummy GitHub API for generated dependency check scripts. */
export const dependencyApiFixture = String
  .raw`import atexit, json, os, subprocess, time
case = json.loads(os.environ["CASE"])
head, base = "a" * 40, "b" * 40
repo_id, run_id, attempt, pr_number = 1, 2, 3, 4
prefix = f"hjdep/1/1/4/{head}/{base}/2/3/"
contexts = ["check", "hj-release-commit-validation"]
checks_data, writes, calls = [], [], []
for index, context in enumerate(contexts):
    checks_data.append({"id": index + 10, "name": context, "head_sha": head,
        "external_id": prefix + context, "app": {"id": 15368},
        "details_url": "https://github.com/owner/repo/runs/" + str(index + 10),
        "status": "in_progress", "conclusion": None})
if os.environ["PHASE"] == "select":
    checks_data = [{**item, "external_id": item["external_id"].replace("/2/3/", "/2/2/")}
                   for item in checks_data[:case.get("previous_checks", 0)]]
for change in case.get("checks", []):
    checks_data.append({**checks_data[0], **change})
if "check_change" in case:
    checks_data[0].update(case["check_change"])
if case.get("older"):
    checks_data = [{**item, "external_id": item["external_id"].replace("/2/3/", "/2/2/"),
                    "status": "completed", "conclusion": "success"} for item in checks_data]

def fake(args, input=None, **kwargs):
    assert args[:2] == ["gh", "api"], args
    path = args[2]
    calls.append(path)
    body = json.loads(input) if input is not None else None
    if body is not None:
        if path == "graphql":
            retired = case.get("clean_after_retirement") and any(item["body"].get("conclusion") == "neutral" for item in writes)
            value = {"data": {"repository": {"pullRequest": {"mergeStateStatus": "CLEAN" if retired else case.get("merge", "BLOCKED")}}}}
        else:
            writes.append({"path": path, "body": body})
            if path.endswith("/check-runs"):
                value = {**body, "id": len(checks_data) + 10, "app": {"id": 15368}, "conclusion": None}
                checks_data.append(value)
            else:
                value = next(item for item in checks_data if str(item["id"]) == path.split("/")[-1])
                value.update(body)
    elif path == "repos/owner/repo":
        value = {"id": 1, "full_name": "owner/repo", "default_branch": "main", **case.get("repository", {})}
    elif "/rules/branches/" in path:
        value = [] if case.get("unprotected") else [{"type": "required_status_checks", "parameters": {
            "required_status_checks": [{"context": name, "integration_id": 15368} for name in contexts]}}]
    elif "/actions/workflows/" in path:
        value = {"id": 5, "path": ".github/workflows/hj-deps.yaml"}
    elif "/attempts/" in path:
        names = ["update", "select", "dependency-check", "dependency-source-validation", "report"]
        jobs = [{"name": name, "run_id": 2, "run_attempt": 3, "head_sha": base,
                 "status": "completed" if name != "report" else "in_progress",
                 "conclusion": "success" if name != "report" else None} for name in names]
        jobs[2]["steps"] = [{"name": "Validate dependencies", "status": "completed", "conclusion": "success", **case.get("step", {})}]
        jobs[3]["steps"] = [{"name": "Validate source commits", "status": "completed", "conclusion": "success"}]
        jobs[2].update(case.get("job", {}))
        if case.get("missing_job"):
            jobs.pop(2)
        value = {"jobs": jobs, "total_count": len(jobs) + case.get("extra_job", 0)}
    elif "/actions/runs/" in path:
        value = {"id": 2, "run_attempt": 3, "workflow_id": 5, "status": "in_progress", "conclusion": None,
                 "repository": {"id": 1}, "head_repository": {"id": 1}, "head_sha": base,
                 "head_branch": "main", "path": ".github/workflows/hj-deps.yaml", "event": "schedule", **case.get("run", {})}
    elif "/git/ref/" in path:
        changed = case.get("base_after_selection") and os.environ["PHASE"] == "report"
        changed = changed or case.get("base_after_success") and any(item["body"].get("conclusion") == "success" for item in writes)
        value = {"object": {"sha": "c" * 40 if changed else case.get("base", base)}}
    elif "/pulls?" in path:
        pr = {"number": 4, "state": "open", "user": {"id": 41898282},
              "head": {"repo": {"id": 1}, "ref": "hj/deps", "sha": head},
              "base": {"repo": {"id": 1}, "ref": "main", "sha": base}, **case.get("pr", {})}
        if calls.count(path) < case.get("ready_after", 1):
            pr["head"]["sha"] = "c" * 40
        value = [pr] * case.get("pr_count", 1)
    elif "/check-runs?" in path:
        value = {"total_count": len(checks_data) + case.get("extra_check", 0), "check_runs": checks_data}
    else:
        raise AssertionError(path)
    if "--slurp" in args:
        value = [[], value] if case.get("rules_pages") else [value]
    return subprocess.CompletedProcess(args, 0, json.dumps(value), "")

subprocess.run = fake
time.sleep = lambda seconds: None
atexit.register(lambda: print(json.dumps({"writes": writes, "calls": calls, "checks": checks_data, "has_outputs": os.path.exists(os.environ["GITHUB_OUTPUT"])})))
`;
