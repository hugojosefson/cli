/** @module Trusted identities for dependency checks. */
export const githubDependencyContext = String
  .raw`import json, os, re, subprocess, time

def require(condition, message):
    if not condition:
        raise RuntimeError(message)

def api(path, body=None, paginate=False):
    args = ["gh", "api", path]
    if paginate:
        args += ["--paginate", "--slurp"]
    if body is not None:
        args += ["--method", "POST", "--input", "-"]
    result = subprocess.run(args, input=json.dumps(body) if body is not None else None,
                            text=True, capture_output=True, check=True)
    return json.loads(result.stdout)

repo = os.environ["GITHUB_REPOSITORY"]
repo_id = int(os.environ["GITHUB_REPOSITORY_ID"])
run_id = int(os.environ["GITHUB_RUN_ID"])
attempt = int(os.environ["GITHUB_RUN_ATTEMPT"])
head, base = os.environ["HEAD_SHA"], os.environ["BASE_SHA"]
require(all(re.fullmatch("[a-f0-9]{40}", sha) for sha in [head, base]), "Invalid commit SHA.")
metadata = api("repos/" + repo)
default = metadata["default_branch"]
require(metadata["id"] == repo_id and metadata["full_name"] == repo, "Repository differs.")
require(os.environ["GITHUB_REF"] == "refs/heads/" + default, "Workflow Git ref differs.")
require(os.environ["GITHUB_WORKFLOW_REF"] == repo + "/.github/workflows/hj-deps.yaml@refs/heads/" + default,
        "Workflow source differs.")
require(os.environ["GITHUB_WORKFLOW_SHA"] == base == os.environ["GITHUB_SHA"], "Workflow commit differs.")

workflow = api(f"repos/{repo}/actions/workflows/hj-deps.yaml")
require(workflow["path"] == ".github/workflows/hj-deps.yaml", "Workflow path differs.")

def observe():
    run = api(f"repos/{repo}/actions/runs/{run_id}")
    require(run["id"] == run_id and run["run_attempt"] == attempt and
            run["workflow_id"] == workflow["id"] and run["status"] == "in_progress" and
            run["conclusion"] is None and
            run["repository"]["id"] == repo_id and run["head_repository"]["id"] == repo_id and
            run["head_sha"] == base and run["head_branch"] == default and
            run["path"] == ".github/workflows/hj-deps.yaml" and
            run["event"] in ["schedule", "workflow_dispatch"], "Workflow identity differs.")
    branch = api(f"repos/{repo}/git/ref/heads/{default}")
    require(branch["object"]["sha"] == base, "Default Git branch changed.")
    pulls = api(f"repos/{repo}/pulls?state=open&head={repo.split('/')[0]}:hj/deps&base={default}&per_page=100")
    require(len(pulls) == 1, "Dependency PR is ambiguous.")
    pr = pulls[0]
    require(pr["state"] == "open" and pr["user"]["id"] == 41898282 and
            pr["head"]["repo"]["id"] == repo_id == pr["base"]["repo"]["id"] and
            pr["head"]["ref"] == "hj/deps" and pr["base"]["ref"] == default and
            pr["head"]["sha"] == head and pr["base"]["sha"] == base,
            "Dependency PR changed.")
    return pr["number"]

for retry in range(10):
    try:
        pr_number = observe()
        break
    except (RuntimeError, subprocess.CalledProcessError):
        if retry == 9:
            raise
        time.sleep(2)
`;
