<!-- claude-setup part: tidy -->

### Clean up after yourself
- When a task that created files, worktrees or containers is done, run `/tidy` before the final reply: delete your throwaways outside the scratchpad, remove your worktrees whose branch is merged and clean, stop and remove containers you started, and list in the reply anything you kept (path + why). Never delete what you did not create, or anything tracked by git. If unsure, keep it and list it.
