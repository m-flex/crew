use anyhow::{anyhow, Context, Result};
use git2::{
    BranchType, Delta, DiffFindOptions, DiffFlags, DiffOptions, Repository, Status,
    StatusOptions, WorktreeAddOptions, WorktreePruneOptions,
};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::path::{Path, PathBuf};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectInfo {
    pub repo_root: String,
    pub current_branch: Option<String>,
    pub detached: bool,
    pub is_dirty: bool,
}

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub repo_root: String,
    pub branch: Option<String>,
    pub detached: bool,
    pub upstream: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub staged: Vec<FileEntry>,
    pub unstaged: Vec<FileEntry>,
    pub untracked: Vec<FileEntry>,
    pub conflicted: Vec<FileEntry>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub status: &'static str,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRecord {
    pub pane_id: String,
    pub repo_root: String,
    pub worktree_path: String,
    pub branch: String,
    pub auto_created: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeCreated {
    pub worktree_path: String,
    pub branch: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub is_head: bool,
    pub upstream: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchList {
    pub local: Vec<BranchInfo>,
    pub remote: Vec<BranchInfo>,
    pub current: Option<String>,
    pub detached: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub origin: String, // " ", "+", "-", "<", ">", etc.
    pub content: String,
    pub old_lineno: Option<u32>,
    pub new_lineno: Option<u32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub header: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffFile {
    pub path: String,
    pub old_path: Option<String>,
    pub is_binary: bool,
    pub is_new: bool,
    pub is_deleted: bool,
    pub hunks: Vec<DiffHunk>,
}

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiffResult {
    pub files: Vec<DiffFile>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    pub oid: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub oid: String,
    pub short_oid: String,
    pub author: String,
    pub email: String,
    pub time_seconds: i64,
    pub summary: String,
    pub parents: usize,
}

#[derive(Default)]
pub struct GitManager {
    worktrees: Mutex<Vec<WorktreeRecord>>,
    state_dir: Mutex<Option<PathBuf>>,
}

impl GitManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Initialize the on-disk worktree journal. Called from setup() with the
    /// app data directory. Loads existing records, prunes any whose worktree
    /// dir has vanished, and persists the cleaned state.
    pub fn init_state_dir(&self, dir: PathBuf) {
        let path = dir.join("worktrees.json");
        let records: Vec<WorktreeRecord> = if path.exists() {
            std::fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        let alive: Vec<WorktreeRecord> = records
            .into_iter()
            .filter(|r| Path::new(&r.worktree_path).exists())
            .collect();
        // Run a libgit2 prune for each unique repo to clear stale worktree
        // metadata for paths that disappeared.
        let mut seen_repos = std::collections::HashSet::new();
        for r in &alive {
            if seen_repos.insert(r.repo_root.clone()) {
                if let Ok(repo) = Repository::open(&r.repo_root) {
                    prune_repo_worktrees(&repo);
                }
            }
        }
        *self.worktrees.lock() = alive;
        *self.state_dir.lock() = Some(dir);
        let _ = self.persist();
    }

    fn persist(&self) -> Result<()> {
        let dir = self.state_dir.lock().clone();
        if let Some(d) = dir {
            std::fs::create_dir_all(&d).ok();
            let path = d.join("worktrees.json");
            let json = serde_json::to_string_pretty(&*self.worktrees.lock())?;
            std::fs::write(&path, json)?;
        }
        Ok(())
    }

    pub fn detect(&self, path: &str) -> Result<Option<DetectInfo>> {
        let repo = match Repository::discover(Path::new(path)) {
            Ok(r) => r,
            Err(_) => return Ok(None),
        };
        let workdir = repo
            .workdir()
            .ok_or_else(|| anyhow!("bare repository at {path}"))?
            .to_string_lossy()
            .into_owned();
        let head = repo.head().ok();
        let detached = head.as_ref().map(|h| !h.is_branch()).unwrap_or(true);
        let current_branch = head.as_ref().and_then(|h| {
            if h.is_branch() {
                h.shorthand().map(String::from)
            } else {
                None
            }
        });
        let is_dirty = repo_is_dirty(&repo)?;
        Ok(Some(DetectInfo {
            repo_root: workdir,
            current_branch,
            detached,
            is_dirty,
        }))
    }

    pub fn status(&self, cwd: &str) -> Result<GitStatus> {
        let repo = Repository::discover(Path::new(cwd))
            .context("not a git repository")?;
        compute_status(&repo)
    }

    pub fn list_branches(&self, cwd: &str) -> Result<BranchList> {
        let repo = Repository::discover(Path::new(cwd))
            .context("not a git repository")?;
        let head = repo.head().ok();
        let detached = head.as_ref().map(|h| !h.is_branch()).unwrap_or(true);
        let current = head.as_ref().and_then(|h| {
            if h.is_branch() {
                h.shorthand().map(String::from)
            } else {
                None
            }
        });

        let mut local = Vec::new();
        let mut remote = Vec::new();
        for item in repo.branches(None)? {
            let (branch, btype) = match item {
                Ok(v) => v,
                Err(_) => continue,
            };
            let name = match branch.name() {
                Ok(Some(n)) => n.to_string(),
                _ => continue,
            };
            let upstream = if btype == BranchType::Local {
                branch
                    .upstream()
                    .ok()
                    .and_then(|u| u.name().ok().flatten().map(String::from))
            } else {
                None
            };
            let info = BranchInfo {
                name,
                is_head: branch.is_head(),
                upstream,
            };
            match btype {
                BranchType::Local => local.push(info),
                BranchType::Remote => remote.push(info),
            }
        }
        Ok(BranchList {
            local,
            remote,
            current,
            detached,
        })
    }

    pub fn create_worktree(
        &self,
        repo_root: &str,
        branch: &str,
        base: Option<&str>,
        new_branch: bool,
        pane_id: &str,
    ) -> Result<WorktreeCreated> {
        let repo = Repository::open(Path::new(repo_root))
            .context("could not open repository")?;
        let workdir = repo
            .workdir()
            .ok_or_else(|| anyhow!("bare repository"))?
            .to_path_buf();

        let safe = sanitize_branch(branch);
        let parent = workdir.join(".crew-worktrees");
        std::fs::create_dir_all(&parent).ok();
        // Add the worktree parent to `.git/info/exclude` so the main repo's
        // status stays clean. This is local to the user's checkout — we
        // never touch their tracked .gitignore.
        let _ = ensure_excluded(&repo, ".crew-worktrees/");

        // If the target branch is already checked out (in the main repo or
        // another worktree), refuse — git would fail anyway and the message
        // is clearer if we catch it up front.
        if branch_is_checked_out(&repo, branch)? {
            return Err(anyhow!(
                "branch '{branch}' is already checked out in another worktree"
            ));
        }

        // Pick a unique directory name. If the sanitized name collides we
        // append a counter — the on-disk path is purely cosmetic, the branch
        // name is what git stores.
        let mut dir = parent.join(&safe);
        let mut wt_name = format!("crew-{}", safe);
        let mut counter = 2;
        while dir.exists() {
            dir = parent.join(format!("{safe}-{counter}"));
            wt_name = format!("crew-{safe}-{counter}");
            counter += 1;
        }

        // Resolve base commit and prepare the branch reference.
        let base_ref = match base {
            Some(b) => b.to_string(),
            None => repo
                .head()?
                .shorthand()
                .map(String::from)
                .ok_or_else(|| anyhow!("no current branch to base off"))?,
        };
        let base_commit = resolve_commit(&repo, &base_ref)?;

        // Take owned references / strings up front; the git2 borrow checker
        // is strict about overlapping &repo lifetimes.
        let (reference_owned, _branch_name_used) = if new_branch {
            // Force=false so we error rather than silently overwrite an
            // existing branch with the same name.
            let new_ref = repo
                .branch(branch, &base_commit, false)
                .with_context(|| format!("could not create branch '{branch}'"))?;
            let r = new_ref.into_reference();
            (r, branch.to_string())
        } else {
            // Existing branch — use it as the worktree's HEAD.
            let existing = repo
                .find_branch(branch, BranchType::Local)
                .with_context(|| format!("branch '{branch}' not found"))?;
            (existing.into_reference(), branch.to_string())
        };

        let mut opts = WorktreeAddOptions::new();
        opts.reference(Some(&reference_owned));
        repo.worktree(&wt_name, &dir, Some(&opts))
            .context("git worktree add failed")?;

        let record = WorktreeRecord {
            pane_id: pane_id.to_string(),
            repo_root: repo_root.to_string(),
            worktree_path: dir.to_string_lossy().into_owned(),
            branch: branch.to_string(),
            auto_created: true,
        };
        self.worktrees.lock().push(record.clone());
        let _ = self.persist();

        Ok(WorktreeCreated {
            worktree_path: record.worktree_path,
            branch: record.branch,
        })
    }

    /// Removes the worktree associated with a pane. Returns Ok(false) if
    /// the worktree is dirty and `force` is false (caller should re-prompt
    /// the user). Idempotent — if no record exists for this pane, returns Ok.
    pub fn remove_worktree(&self, pane_id: &str, force: bool) -> Result<bool> {
        let record = {
            let guard = self.worktrees.lock();
            guard.iter().find(|r| r.pane_id == pane_id).cloned()
        };
        let Some(record) = record else {
            return Ok(true);
        };

        let path = PathBuf::from(&record.worktree_path);

        if !force && path.exists() {
            // Check dirty.
            if let Ok(wt_repo) = Repository::open(&path) {
                if repo_is_dirty(&wt_repo).unwrap_or(false) {
                    return Ok(false);
                }
            }
        }

        // Try to prune via libgit2 first. This handles the git internal
        // bookkeeping; we then ensure the directory is gone.
        if let Ok(parent_repo) = Repository::open(&record.repo_root) {
            if let Ok(worktrees) = parent_repo.worktrees() {
                for name in worktrees.iter().flatten() {
                    if let Ok(wt) = parent_repo.find_worktree(name) {
                        // Match by canonical path comparison.
                        if same_path(wt.path(), &path) {
                            let mut opts = WorktreePruneOptions::new();
                            opts.valid(true).working_tree(true);
                            let _ = wt.prune(Some(&mut opts));
                            break;
                        }
                    }
                }
            }
        }

        // Belt-and-suspenders: if the dir still exists, remove it ourselves.
        if path.exists() {
            std::fs::remove_dir_all(&path)
                .with_context(|| format!("could not remove {}", path.display()))?;
        }

        self.worktrees.lock().retain(|r| r.pane_id != pane_id);
        let _ = self.persist();
        Ok(true)
    }

    /// Drops the worktree record without touching disk. Used when the user
    /// chooses "Keep folder" on close.
    pub fn forget_worktree(&self, pane_id: &str) -> Result<()> {
        self.worktrees.lock().retain(|r| r.pane_id != pane_id);
        let _ = self.persist();
        Ok(())
    }

    pub fn checkout(&self, cwd: &str, branch: &str, create: bool) -> Result<()> {
        let repo = Repository::discover(Path::new(cwd))
            .context("not a git repository")?;
        let refname = if create {
            let head_commit = repo
                .head()
                .context("repository has no HEAD to branch from")?
                .peel_to_commit()?;
            let new_branch = repo
                .branch(branch, &head_commit, false)
                .with_context(|| format!("could not create branch '{branch}'"))?;
            new_branch
                .into_reference()
                .name()
                .ok_or_else(|| anyhow!("invalid branch reference name"))?
                .to_string()
        } else {
            let existing = repo
                .find_branch(branch, BranchType::Local)
                .with_context(|| format!("branch '{branch}' not found"))?;
            existing
                .into_reference()
                .name()
                .ok_or_else(|| anyhow!("invalid branch reference name"))?
                .to_string()
        };
        // Checkout the target tree FIRST (refuses on conflicts) so HEAD and
        // working dir stay in sync if the operation fails.
        let target = repo.revparse_single(&refname)?;
        let mut opts = git2::build::CheckoutBuilder::new();
        opts.safe();
        repo.checkout_tree(&target, Some(&mut opts))
            .context("checkout failed (uncommitted changes would be lost)")?;
        repo.set_head(&refname)?;
        Ok(())
    }

    pub fn stage(&self, cwd: &str, paths: Vec<String>) -> Result<()> {
        let repo = Repository::discover(Path::new(cwd))
            .context("not a git repository")?;
        let mut index = repo.index()?;
        // add_all matches `git add -A <paths>` — handles new, modified,
        // and deleted entries within the given pathspec.
        index.add_all(paths.iter(), git2::IndexAddOption::DEFAULT, None)?;
        index.write()?;
        Ok(())
    }

    pub fn unstage(&self, cwd: &str, paths: Vec<String>) -> Result<()> {
        let repo = Repository::discover(Path::new(cwd))
            .context("not a git repository")?;
        // No HEAD yet (initial commit) — clear the index entries directly.
        let head = match repo.head() {
            Ok(h) => h,
            Err(_) => {
                let mut index = repo.index()?;
                for p in &paths {
                    let _ = index.remove_path(Path::new(p));
                }
                index.write()?;
                return Ok(());
            }
        };
        let head_obj = head.peel(git2::ObjectType::Any)?;
        repo.reset_default(Some(&head_obj), paths.iter())?;
        Ok(())
    }

    pub fn discard(&self, cwd: &str, paths: Vec<String>) -> Result<()> {
        let repo = Repository::discover(Path::new(cwd))
            .context("not a git repository")?;
        let workdir = repo
            .workdir()
            .ok_or_else(|| anyhow!("bare repository"))?
            .to_path_buf();

        // Determine which paths exist in HEAD (= tracked) vs not.
        let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        let mut tracked: Vec<String> = Vec::new();
        for p in &paths {
            let in_head = head_tree
                .as_ref()
                .map(|t| t.get_path(Path::new(p)).is_ok())
                .unwrap_or(false);
            if in_head {
                tracked.push(p.clone());
            } else {
                let full = workdir.join(p);
                if full.is_dir() {
                    let _ = std::fs::remove_dir_all(&full);
                } else if full.exists() {
                    let _ = std::fs::remove_file(&full);
                }
            }
        }

        if !tracked.is_empty() {
            let mut opts = git2::build::CheckoutBuilder::new();
            opts.force();
            for p in &tracked {
                opts.path(p);
            }
            repo.checkout_head(Some(&mut opts))
                .context("discard failed")?;
        }
        Ok(())
    }

    pub fn diff(
        &self,
        cwd: &str,
        path: Option<&str>,
        staged: bool,
    ) -> Result<DiffResult> {
        let repo = Repository::discover(Path::new(cwd))
            .context("not a git repository")?;
        compute_diff(&repo, path, staged)
    }

    pub fn commit(
        &self,
        cwd: &str,
        message: &str,
        amend: bool,
    ) -> Result<CommitResult> {
        if message.trim().is_empty() {
            return Err(anyhow!("commit message cannot be empty"));
        }
        let repo = Repository::discover(Path::new(cwd))
            .context("not a git repository")?;
        let signature = repo
            .signature()
            .context("git user.name / user.email not configured")?;
        let mut index = repo.index()?;
        let tree_id = index.write_tree()?;
        let tree = repo.find_tree(tree_id)?;

        let oid = if amend {
            let head_commit = repo
                .head()
                .context("nothing to amend (no HEAD)")?
                .peel_to_commit()?;
            head_commit.amend(
                Some("HEAD"),
                Some(&signature),
                Some(&signature),
                None,
                Some(message),
                Some(&tree),
            )?
        } else {
            let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
            match parent {
                Some(p) => repo.commit(
                    Some("HEAD"),
                    &signature,
                    &signature,
                    message,
                    &tree,
                    &[&p],
                )?,
                None => repo.commit(
                    Some("HEAD"),
                    &signature,
                    &signature,
                    message,
                    &tree,
                    &[],
                )?,
            }
        };
        Ok(CommitResult {
            oid: oid.to_string(),
        })
    }

    pub fn log(
        &self,
        cwd: &str,
        limit: usize,
        branch: Option<&str>,
    ) -> Result<Vec<CommitInfo>> {
        let repo = Repository::discover(Path::new(cwd))
            .context("not a git repository")?;
        let mut revwalk = repo.revwalk()?;
        revwalk.set_sorting(git2::Sort::TIME)?;
        match branch {
            Some(b) => {
                let oid = repo
                    .find_branch(b, BranchType::Local)
                    .with_context(|| format!("branch '{b}' not found"))?
                    .get()
                    .target()
                    .ok_or_else(|| anyhow!("branch has no target"))?;
                revwalk.push(oid)?;
            }
            None => match repo.head() {
                Ok(_) => revwalk.push_head()?,
                Err(_) => return Ok(Vec::new()),
            },
        }

        let mut out = Vec::with_capacity(limit.min(64));
        for (i, item) in revwalk.enumerate() {
            if i >= limit {
                break;
            }
            let oid = match item {
                Ok(o) => o,
                Err(_) => continue,
            };
            let Ok(commit) = repo.find_commit(oid) else {
                continue;
            };
            let oid_str = oid.to_string();
            let short = oid_str.chars().take(7).collect::<String>();
            out.push(CommitInfo {
                oid: oid_str,
                short_oid: short,
                author: commit
                    .author()
                    .name()
                    .unwrap_or("")
                    .to_string(),
                email: commit
                    .author()
                    .email()
                    .unwrap_or("")
                    .to_string(),
                time_seconds: commit.time().seconds(),
                summary: commit.summary().unwrap_or("").to_string(),
                parents: commit.parent_count(),
            });
        }
        Ok(out)
    }

    pub fn delete_branch(&self, cwd: &str, branch: &str) -> Result<()> {
        let repo = Repository::discover(Path::new(cwd))
            .context("not a git repository")?;
        let mut b = repo
            .find_branch(branch, BranchType::Local)
            .with_context(|| format!("branch '{branch}' not found"))?;
        if b.is_head() {
            return Err(anyhow!("cannot delete the currently checked-out branch"));
        }
        b.delete().context("could not delete branch")?;
        Ok(())
    }

    pub fn pull(&self, cwd: &str) -> Result<String> {
        let output = std::process::Command::new("git")
            .args(["pull"])
            .current_dir(Path::new(cwd))
            .output()
            .context("failed to run git pull")?;
        let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        if !output.status.success() {
            let msg = if !stderr.trim().is_empty() { stderr } else { stdout };
            return Err(anyhow!("{}", msg.trim()));
        }
        // git pull reports remote info to stderr; merge result goes to stdout
        let combined = format!("{}{}", stderr, stdout);
        Ok(combined.trim().to_string())
    }
}

fn sanitize_branch(branch: &str) -> String {
    let mut out: String = branch
        .chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' => c,
            _ => '-',
        })
        .collect();
    // Collapse repeated separators and trim leading/trailing dashes.
    while out.contains("--") {
        out = out.replace("--", "-");
    }
    out.trim_matches('-').to_string()
}

fn resolve_commit<'a>(repo: &'a Repository, refname: &str) -> Result<git2::Commit<'a>> {
    if let Ok(branch) = repo.find_branch(refname, BranchType::Local) {
        return Ok(branch.get().peel_to_commit()?);
    }
    if let Ok(branch) = repo.find_branch(refname, BranchType::Remote) {
        return Ok(branch.get().peel_to_commit()?);
    }
    let obj = repo.revparse_single(refname)?;
    Ok(obj.peel_to_commit()?)
}

fn branch_is_checked_out(repo: &Repository, branch: &str) -> Result<bool> {
    let target_ref = format!("refs/heads/{branch}");

    // Main repo HEAD.
    if let Ok(head) = repo.head() {
        if head.name() == Some(&target_ref) {
            return Ok(true);
        }
    }

    // Other worktrees' HEAD files.
    if let Ok(worktrees) = repo.worktrees() {
        for name in worktrees.iter().flatten() {
            let Ok(wt) = repo.find_worktree(name) else {
                continue;
            };
            // Each worktree has its own HEAD in <commondir>/worktrees/<name>/HEAD.
            let head_file = wt.path().join(".git");
            // wt.path() is the workdir; the gitdir for the worktree contains HEAD.
            // Easier: open the worktree as a repo and check HEAD.
            let _ = head_file; // not used directly
            if let Ok(wt_repo) = Repository::open_from_worktree(&wt) {
                if let Ok(head) = wt_repo.head() {
                    if head.name() == Some(&target_ref) {
                        return Ok(true);
                    }
                }
            }
        }
    }
    Ok(false)
}

fn prune_repo_worktrees(repo: &Repository) {
    let Ok(worktrees) = repo.worktrees() else {
        return;
    };
    for name in worktrees.iter().flatten() {
        let Ok(wt) = repo.find_worktree(name) else {
            continue;
        };
        if let Ok(true) = wt.is_prunable(None) {
            let mut opts = WorktreePruneOptions::new();
            opts.working_tree(true);
            let _ = wt.prune(Some(&mut opts));
        }
    }
}

fn ensure_excluded(repo: &Repository, entry: &str) -> Result<()> {
    // `repo.path()` is the gitdir; for the main worktree this is also the
    // commondir, which is where info/exclude lives.
    let exclude_path = repo.path().join("info").join("exclude");
    if let Some(parent) = exclude_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let existing = std::fs::read_to_string(&exclude_path).unwrap_or_default();
    if existing.lines().any(|l| l.trim() == entry) {
        return Ok(());
    }
    let mut content = existing;
    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }
    content.push_str(entry);
    content.push('\n');
    std::fs::write(&exclude_path, content)?;
    Ok(())
}

fn same_path(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

fn compute_diff(
    repo: &Repository,
    path: Option<&str>,
    staged: bool,
) -> Result<DiffResult> {
    let mut opts = DiffOptions::new();
    if let Some(p) = path {
        opts.pathspec(p);
    }
    if !staged {
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .show_untracked_content(true);
    }

    let mut diff = if staged {
        let head_tree = match repo.head() {
            Ok(h) => Some(h.peel_to_tree()?),
            Err(_) => None,
        };
        let index = repo.index()?;
        repo.diff_tree_to_index(head_tree.as_ref(), Some(&index), Some(&mut opts))?
    } else {
        let index = repo.index()?;
        repo.diff_index_to_workdir(Some(&index), Some(&mut opts))?
    };

    // Detect renames so the diff reads naturally.
    let mut find_opts = DiffFindOptions::new();
    find_opts.renames(true);
    let _ = diff.find_similar(Some(&mut find_opts));

    // Collect via foreach. RefCells let us mutate through &mut closures
    // without fighting the borrow checker.
    let result = RefCell::new(DiffResult::default());
    let current_file: RefCell<Option<DiffFile>> = RefCell::new(None);
    let current_hunk: RefCell<Option<DiffHunk>> = RefCell::new(None);

    let flush_hunk = |file: &mut Option<DiffFile>, hunk: &mut Option<DiffHunk>| {
        if let (Some(f), Some(h)) = (file.as_mut(), hunk.take()) {
            f.hunks.push(h);
        }
    };

    let flush_file =
        |result: &RefCell<DiffResult>, file: &mut Option<DiffFile>| {
            if let Some(f) = file.take() {
                result.borrow_mut().files.push(f);
            }
        };

    diff.foreach(
        &mut |delta, _progress| {
            {
                let mut hunk = current_hunk.borrow_mut();
                let mut file = current_file.borrow_mut();
                flush_hunk(&mut file, &mut hunk);
                flush_file(&result, &mut file);
            }
            let new_path = delta
                .new_file()
                .path()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            let old_path = delta
                .old_file()
                .path()
                .map(|p| p.to_string_lossy().into_owned());
            let path = if !new_path.is_empty() {
                new_path
            } else {
                old_path.clone().unwrap_or_default()
            };
            let renamed_old = match (delta.status(), &old_path) {
                (Delta::Renamed, Some(op)) if Some(op.as_str()) != Some(&path) => {
                    Some(op.clone())
                }
                _ => None,
            };
            *current_file.borrow_mut() = Some(DiffFile {
                path,
                old_path: renamed_old,
                is_binary: delta.flags().contains(DiffFlags::BINARY),
                is_new: matches!(
                    delta.status(),
                    Delta::Added | Delta::Untracked | Delta::Copied
                ),
                is_deleted: matches!(delta.status(), Delta::Deleted),
                hunks: Vec::new(),
            });
            true
        },
        None,
        Some(&mut |_delta, hunk| {
            {
                let mut h = current_hunk.borrow_mut();
                let mut f = current_file.borrow_mut();
                flush_hunk(&mut f, &mut h);
            }
            *current_hunk.borrow_mut() = Some(DiffHunk {
                header: String::from_utf8_lossy(hunk.header()).into_owned(),
                old_start: hunk.old_start(),
                old_lines: hunk.old_lines(),
                new_start: hunk.new_start(),
                new_lines: hunk.new_lines(),
                lines: Vec::new(),
            });
            true
        }),
        Some(&mut |_delta, _hunk, line| {
            if let Some(h) = current_hunk.borrow_mut().as_mut() {
                let origin = line.origin();
                let content = String::from_utf8_lossy(line.content()).into_owned();
                h.lines.push(DiffLine {
                    origin: origin.to_string(),
                    content,
                    old_lineno: line.old_lineno(),
                    new_lineno: line.new_lineno(),
                });
            }
            true
        }),
    )?;

    {
        let mut hunk = current_hunk.borrow_mut();
        let mut file = current_file.borrow_mut();
        flush_hunk(&mut file, &mut hunk);
        flush_file(&result, &mut file);
    }

    Ok(result.into_inner())
}

fn repo_is_dirty(repo: &Repository) -> Result<bool> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(true).include_ignored(false);
    let statuses = repo.statuses(Some(&mut opts))?;
    Ok(!statuses.is_empty())
}

fn compute_status(repo: &Repository) -> Result<GitStatus> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| anyhow!("bare repository"))?
        .to_string_lossy()
        .into_owned();
    let head = repo.head().ok();
    let detached = head.as_ref().map(|h| !h.is_branch()).unwrap_or(true);
    let branch = head.as_ref().and_then(|h| {
        if h.is_branch() {
            h.shorthand().map(String::from)
        } else {
            None
        }
    });

    let (upstream, ahead, behind) = upstream_info(repo, branch.as_deref());

    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .include_ignored(false)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);
    let statuses = repo.statuses(Some(&mut opts))?;

    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut untracked = Vec::new();
    let mut conflicted = Vec::new();

    for entry in statuses.iter() {
        let path = match entry.path() {
            Some(p) => p.to_string(),
            None => continue,
        };
        let s = entry.status();

        if s.is_conflicted() {
            conflicted.push(FileEntry {
                path: path.clone(),
                status: "conflicted",
            });
            continue;
        }

        if let Some(kind) = staged_kind(s) {
            staged.push(FileEntry {
                path: path.clone(),
                status: kind,
            });
        }
        if let Some(kind) = workdir_kind(s) {
            if kind == "untracked" {
                untracked.push(FileEntry {
                    path: path.clone(),
                    status: kind,
                });
            } else {
                unstaged.push(FileEntry {
                    path: path.clone(),
                    status: kind,
                });
            }
        }
    }

    Ok(GitStatus {
        repo_root: workdir,
        branch,
        detached,
        upstream,
        ahead,
        behind,
        staged,
        unstaged,
        untracked,
        conflicted,
    })
}

fn upstream_info(
    repo: &Repository,
    branch_name: Option<&str>,
) -> (Option<String>, usize, usize) {
    let Some(name) = branch_name else {
        return (None, 0, 0);
    };
    let Ok(local) = repo.find_branch(name, BranchType::Local) else {
        return (None, 0, 0);
    };
    let Ok(upstream) = local.upstream() else {
        return (None, 0, 0);
    };

    let upstream_name = upstream
        .name()
        .ok()
        .flatten()
        .map(String::from);
    let local_oid = local.get().target();
    let upstream_oid = upstream.get().target();

    let (ahead, behind) = match (local_oid, upstream_oid) {
        (Some(l), Some(u)) => repo.graph_ahead_behind(l, u).unwrap_or((0, 0)),
        _ => (0, 0),
    };
    (upstream_name, ahead, behind)
}

fn staged_kind(s: Status) -> Option<&'static str> {
    if s.contains(Status::INDEX_NEW) {
        Some("added")
    } else if s.contains(Status::INDEX_MODIFIED) {
        Some("modified")
    } else if s.contains(Status::INDEX_DELETED) {
        Some("deleted")
    } else if s.contains(Status::INDEX_RENAMED) {
        Some("renamed")
    } else if s.contains(Status::INDEX_TYPECHANGE) {
        Some("typechange")
    } else {
        None
    }
}

fn workdir_kind(s: Status) -> Option<&'static str> {
    if s.contains(Status::WT_NEW) {
        Some("untracked")
    } else if s.contains(Status::WT_MODIFIED) {
        Some("modified")
    } else if s.contains(Status::WT_DELETED) {
        Some("deleted")
    } else if s.contains(Status::WT_RENAMED) {
        Some("renamed")
    } else if s.contains(Status::WT_TYPECHANGE) {
        Some("typechange")
    } else {
        None
    }
}
