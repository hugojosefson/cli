/** @module Owned Checks API records for dependency validation. */
import { githubDependencyResults } from "./github-dependency-results.ts";
export const githubDependencyChecks = String.raw`
contexts = ["check", "hj-release-commit-validation"]
prefix = f"hjdep/1/{repo_id}/{pr_number}/{head}/{base}/"
identity = f"{prefix}{run_id}/{attempt}/"

def checks():
    data = api(f"repos/{repo}/commits/{head}/check-runs?filter=all&per_page=100")
    require(data["total_count"] == len(data["check_runs"]), "Check inventory is not complete.")
    relevant = [item for item in data["check_runs"] if item["name"] in contexts]
    require(len({item.get("external_id") for item in relevant}) == len(relevant), "Check ownership is ambiguous.")
    for item in relevant:
        external = item.get("external_id") or ""
        suffix = external.removeprefix(prefix).split("/")
        require(external.startswith(prefix) and len(suffix) == 3 and
                suffix[0].isdigit() and suffix[1].isdigit() and suffix[2] == item["name"] and
                item["app"]["id"] == 15368 and item["head_sha"] == head and
                item["details_url"] in [f"https://github.com/{repo}/actions/runs/{suffix[0]}",
                                       f"https://github.com/{repo}/runs/{item['id']}"],
                "Required check has different ownership.")
        require((int(suffix[0]), int(suffix[1])) <= (run_id, attempt), "A subsequent attempt owns the checks.")
    return relevant

def current_checks():
    selected = {}
    for context in contexts:
        matches = [item for item in checks() if item["external_id"] == identity + context]
        require(len(matches) == 1, "Current check is missing or ambiguous.")
        selected[context] = matches[0]
    return selected

if os.environ["PHASE"] == "select":
    require(not any(item["external_id"].startswith(identity) for item in checks()),
            "This attempt has checks. Start a new workflow attempt.")
    for context in contexts:
        require(observe() == pr_number, "Dependency PR number changed.")
        api(f"repos/{repo}/check-runs", {
            "name": context, "head_sha": head, "status": "in_progress",
            "external_id": identity + context,
            "details_url": f"https://github.com/{repo}/actions/runs/{run_id}",
        })
    require(all(item["status"] == "in_progress" and item["conclusion"] is None
                for item in current_checks().values()), "Checks did not start.")
    rules = [rule for page in api(f"repos/{repo}/rules/branches/{default}", paginate=True) for rule in page]
    protected = any(rule["type"] == "required_status_checks" and
                    any(check["context"] in contexts and check.get("integration_id") in [None, -1, 15368]
                        for check in rule["parameters"]["required_status_checks"]) for rule in rules)
    def require_blocked():
        if not protected:
            return
        query = "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){mergeStateStatus}}}"
        owner, name = repo.split("/")
        for retry in range(10):
            state = api("graphql", {"query": query, "variables": {"owner": owner, "name": name, "number": pr_number}})
            if state["data"]["repository"]["pullRequest"]["mergeStateStatus"] == "BLOCKED":
                break
            require(retry < 9, "New checks did not prevent merger.")
            time.sleep(2)
    require_blocked()
    for item in checks():
        if not item["external_id"].startswith(identity) and item["status"] == "in_progress":
            require(observe() == pr_number, "Dependency PR number changed.")
            require(all(check["status"] == "in_progress" for check in current_checks().values()), "New checks are not pending.")
            subprocess.run(["gh", "api", f"repos/{repo}/check-runs/{item['id']}", "--method", "PATCH", "--input", "-"],
                           input=json.dumps({"status": "completed", "conclusion": "neutral"}), text=True, check=True)
    require_blocked()
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write(f"head={head}\nbase={base}\npr={pr_number}\n")
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as output:
        output.write(f"Dependency PR: https://github.com/{repo}/pull/{pr_number}\n\n")
        output.write(f"Automatic validation: https://github.com/{repo}/actions/runs/{run_id}\n")
else:
    require(os.environ["PHASE"] == "report", "Unknown check phase.")
    require(str(pr_number) == os.environ["PR_NUMBER"], "Selected PR number differs.")
${githubDependencyResults}    selected = current_checks()
    require(all(item["status"] == "in_progress" and item["conclusion"] is None
                for item in selected.values()), "Current check is not pending.")
    for context, item in selected.items():
        require(observe() == pr_number, "Dependency PR number changed.")
        require(current_checks()[context]["id"] == item["id"], "Current check changed.")
        args = ["gh", "api", f"repos/{repo}/check-runs/{item['id']}", "--method", "PATCH", "--input", "-"]
        subprocess.run(args, input=json.dumps({"status": "completed",
                       "conclusion": "success" if success else "failure"}), text=True, check=True)
    require(success, "Dependency validation did not succeed. Examine the workflow jobs.")
`;
