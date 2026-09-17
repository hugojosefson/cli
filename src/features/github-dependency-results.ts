/** @module Current workflow results for dependency checks. */
export const githubDependencyResults = String
  .raw`    jobs = api(f"repos/{repo}/actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100")
    names = ["update", "select", "dependency-check", "dependency-source-validation", "report"]
    require(jobs["total_count"] == len(jobs["jobs"]) == len(names) and
            sorted(job["name"] for job in jobs["jobs"]) == sorted(names), "Job inventory differs. Rerun all workflow jobs for a new attempt.")
    require(all(job["run_id"] == run_id and job["run_attempt"] == attempt and job["head_sha"] == base for job in jobs["jobs"]),
            "Job identity differs. Rerun all workflow jobs for a new attempt.")
    report = next(job for job in jobs["jobs"] if job["name"] == "report")
    require(report["status"] == "in_progress" and report["conclusion"] is None, "Reporter job differs.")
    required_steps = {"dependency-check": "Validate dependencies", "dependency-source-validation": "Validate source commits"}
    steps_complete = True
    for job in jobs["jobs"]:
        if job["name"] in required_steps:
            steps = [step for step in job["steps"] if step["name"] == required_steps[job["name"]]]
            steps_complete = steps_complete and len(steps) == 1 and steps[0]["status"] == "completed" and steps[0]["conclusion"] == "success"
    success = steps_complete and all(job["status"] == "completed" and job["conclusion"] == "success"
                  for job in jobs["jobs"] if job["name"] != "report")
`;
