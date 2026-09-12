/** Preserve option IDs and metadata when placing Backlog before Todo. */
export interface ProjectStatusOption {
  readonly id?: string;
  readonly name: string;
  readonly color: string;
  readonly description: string;
}
export function backlogBeforeTodo(
  options: readonly ProjectStatusOption[],
): ProjectStatusOption[] | undefined {
  const todos = options.filter((option) => option.name === "Todo");
  const backlogs = options.filter((option) => option.name === "Backlog");
  // A custom status scheme without Todo is not replaced by the defaults.
  if (!todos.length) return undefined;
  if (todos.length !== 1 || backlogs.length > 1) {
    throw new Error("Resolve duplicate Backlog or Todo status options first.");
  }
  if (
    backlogs.length && options.indexOf(backlogs[0]) < options.indexOf(todos[0])
  ) return undefined;
  const ordered = options.filter((option) => option.name !== "Backlog");
  ordered.splice(
    ordered.indexOf(todos[0]),
    0,
    backlogs[0] ??
      {
        name: "Backlog",
        color: "GRAY",
        description: "Work awaiting prioritization",
      },
  );
  return ordered;
}
