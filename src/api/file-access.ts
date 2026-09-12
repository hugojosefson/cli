/** @module Current-user filesystem access observations. */

/** Access granted to the current user, including group membership and ACLs. */
export interface FileAccess {
  readonly readable: boolean;
  readonly writable: boolean;
  readonly executable: boolean;
  /** Unix permission class used when planning chmod (owner, group, or other). */
  readonly shift: number;
}
